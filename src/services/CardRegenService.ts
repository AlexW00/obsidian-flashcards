import { App, ButtonComponent, Notice, TFile } from "obsidian";
import type {
	FlashcardsPluginSettings,
	FlashcardFrontmatter,
} from "../types";
import { debugLog, PROTECTION_COMMENT } from "../types";
import type { CardService } from "../flashcards/CardService";
import type { DeckService } from "../flashcards/DeckService";
import type { TemplateService } from "../flashcards/TemplateService";

/**
 * Configuration for the CardRegenService.
 */
export interface CardRegenServiceConfig {
	app: App;
	settings: FlashcardsPluginSettings;
	cardService: CardService;
	deckService: DeckService;
	templateService: TemplateService;
	statusBarItem: HTMLElement | null;
}

/**
 * Service responsible for auto-regeneration of flashcards when:
 * - Frontmatter fields change
 * - Body content is edited directly (unauthorized edits)
 * - Template files are modified
 *
 * Combines the previously separate auto-regeneration and template watching logic.
 */
export class CardRegenService {
	private app: App;
	private settings: FlashcardsPluginSettings;
	private cardService: CardService;
	private deckService: DeckService;
	private templateService: TemplateService;
	private statusBarItem: HTMLElement | null;

	// Debounce timers for auto-regeneration, keyed by file path
	private autoRegenerateTimers: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	// Cache of frontmatter fields to detect changes
	private frontmatterCache: Map<string, string> = new Map();
	// Cache of flashcard body content to detect unauthorized edits
	private bodyContentCache: Map<string, string> = new Map();
	// Incrementing version per file to prevent stale regenerations
	private autoRegenerateVersions: Map<string, number> = new Map();
	// Track if a bulk regeneration is currently in progress
	private isRegeneratingAll = false;
	// Debounce timer for template change notifications
	private templateChangeTimer: ReturnType<typeof setTimeout> | null = null;
	// Cache of template content to detect changes
	private templateContentCache: Map<string, string> = new Map();
	// Active template change notice (to prevent duplicates)
	private activeTemplateNotice: Notice | null = null;
	// Track recent editor changes to avoid duplicate vault modify handling
	private recentTemplateEditorChangeAt: Map<string, number> = new Map();

	constructor(config: CardRegenServiceConfig) {
		this.app = config.app;
		this.settings = config.settings;
		this.cardService = config.cardService;
		this.deckService = config.deckService;
		this.templateService = config.templateService;
		this.statusBarItem = config.statusBarItem;
	}

	/**
	 * Update settings reference (called when settings change).
	 */
	updateSettings(settings: FlashcardsPluginSettings): void {
		this.settings = settings;
	}

	/**
	 * Clean up all timers and caches.
	 */
	destroy(): void {
		for (const timer of this.autoRegenerateTimers.values()) {
			clearTimeout(timer);
		}
		this.autoRegenerateTimers.clear();
		this.frontmatterCache.clear();
		this.bodyContentCache.clear();
		this.autoRegenerateVersions.clear();
		this.templateContentCache.clear();
		if (this.templateChangeTimer) {
			clearTimeout(this.templateChangeTimer);
			this.templateChangeTimer = null;
		}
		if (this.activeTemplateNotice) {
			this.activeTemplateNotice.hide();
			this.activeTemplateNotice = null;
		}
	}

	/**
	 * Handle metadata cache changes for auto-regeneration.
	 * Triggers regeneration when flashcard frontmatter changes (excluding review).
	 */
	handleMetadataChange(file: TFile): void {
		// Skip if auto-regenerate is disabled
		if (this.settings.autoRegenerateDebounce <= 0) {
			return;
		}

		// Check if this is a flashcard
		if (!this.deckService.isFlashcard(file)) {
			return;
		}

		// Get current frontmatter fields
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (!fm) {
			return;
		}

		// Create a hash of frontmatter (excluding review) to detect changes
		const { review, ...rest } = fm as unknown as Record<string, unknown>;
		void review;
		const frontmatterHash = JSON.stringify(rest);
		const cachedHash = this.frontmatterCache.get(file.path);

		// Skip if frontmatter hasn't changed
		if (frontmatterHash === cachedHash) {
			return;
		}

		// Update cache
		this.frontmatterCache.set(file.path, frontmatterHash);

		// Increment version to invalidate any pending regeneration
		const nextVersion =
			(this.autoRegenerateVersions.get(file.path) ?? 0) + 1;
		this.autoRegenerateVersions.set(file.path, nextVersion);

		// Clear existing timer for this file
		const existingTimer = this.autoRegenerateTimers.get(file.path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Update status bar
		if (this.statusBarItem) {
			this.statusBarItem.setText("Flashcards: update pending...");
		}

		// Set up debounced regeneration
		const timer = setTimeout(() => {
			const currentTimer = this.autoRegenerateTimers.get(file.path);
			const currentVersion = this.autoRegenerateVersions.get(file.path);

			// Skip if a newer change occurred or a newer timer exists
			if (currentTimer !== timer || currentVersion !== nextVersion) {
				return;
			}

			this.autoRegenerateTimers.delete(file.path);

			if (this.statusBarItem) {
				this.statusBarItem.setText("Flashcards: regenerating...");
			}

			void (async () => {
				try {
					await this.cardService.regenerateCard(file);
					// Update body cache after regeneration
					const newContent = await this.app.vault.read(file);
					const newBody = this.extractFlashcardBody(newContent);
					this.bodyContentCache.set(file.path, newBody);
				} catch (error) {
					console.error("Auto-regeneration failed:", error);
				} finally {
					if (
						this.statusBarItem &&
						this.autoRegenerateTimers.size === 0
					) {
						this.statusBarItem.setText("");
					}
				}
			})();
		}, this.settings.autoRegenerateDebounce * 1000);

		this.autoRegenerateTimers.set(file.path, timer);
	}

	/**
	 * Handle flashcard body content changes.
	 * If the body is edited directly (not via frontmatter changes),
	 * regenerate the card to restore the template-generated content.
	 */
	handleFlashcardBodyChange(file: TFile): void {
		// Skip if auto-regenerate is disabled
		if (this.settings.autoRegenerateDebounce <= 0) {
			return;
		}

		// Check if this is a flashcard
		if (!this.deckService.isFlashcard(file)) {
			return;
		}

		// Read the file content
		void this.app.vault.read(file).then((content) => {
			// Extract the body (everything after frontmatter and protection comment)
			const body = this.extractFlashcardBody(content);
			const cachedBody = this.bodyContentCache.get(file.path);

			// Update cache if this is the first time we're seeing this file
			if (cachedBody === undefined) {
				this.bodyContentCache.set(file.path, body);
				return;
			}

			// Skip if body hasn't changed
			if (body === cachedBody) {
				return;
			}

			// Check if a regeneration is already pending for this file (from frontmatter change)
			// If so, skip - the pending regeneration will update the body cache
			if (this.autoRegenerateTimers.has(file.path)) {
				return;
			}

			debugLog("body-change: detected unauthorized body edit", file.path);

			// Update cache immediately (will be updated again after regeneration)
			this.bodyContentCache.set(file.path, body);

			// Increment version to invalidate any pending regeneration
			const nextVersion =
				(this.autoRegenerateVersions.get(file.path) ?? 0) + 1;
			this.autoRegenerateVersions.set(file.path, nextVersion);

			// Update status bar
			if (this.statusBarItem) {
				this.statusBarItem.setText("Flashcards: restoring content...");
			}

			// Set up debounced regeneration
			const timer = setTimeout(() => {
				const currentTimer = this.autoRegenerateTimers.get(file.path);
				const currentVersion = this.autoRegenerateVersions.get(
					file.path,
				);

				// Skip if a newer change occurred or a newer timer exists
				if (currentTimer !== timer || currentVersion !== nextVersion) {
					return;
				}

				this.autoRegenerateTimers.delete(file.path);

				if (this.statusBarItem) {
					this.statusBarItem.setText("Flashcards: regenerating...");
				}

				void (async () => {
					try {
						await this.cardService.regenerateCard(file);
						// Update body cache after regeneration
						const newContent = await this.app.vault.read(file);
						const newBody = this.extractFlashcardBody(newContent);
						this.bodyContentCache.set(file.path, newBody);
					} catch (error) {
						console.error("Auto-regeneration failed:", error);
					} finally {
						if (
							this.statusBarItem &&
							this.autoRegenerateTimers.size === 0
						) {
							this.statusBarItem.setText("");
						}
					}
				})();
			}, this.settings.autoRegenerateDebounce * 1000);

			this.autoRegenerateTimers.set(file.path, timer);
		});
	}

	/**
	 * Check if a file is a template file (in the template folder).
	 */
	private isTemplateFile(file: TFile): boolean {
		const templateFolder = this.settings.templateFolder;
		return (
			file.path.startsWith(templateFolder + "/") ||
			file.path === templateFolder
		);
	}

	/**
	 * Handle template file changes with debounced regeneration offer.
	 * Debouncing happens immediately on the event, content comparison happens when timer fires.
	 */
	handleTemplateFileChange(file: TFile, source: "editor" | "vault"): void {
		debugLog("template-change: start", file.path, source);

		// Skip if auto-regenerate is disabled
		if (this.settings.autoRegenerateDebounce <= 0) {
			debugLog("template-change: skipped (autoRegenerateDebounce <= 0)");
			return;
		}

		// If this is a vault modify shortly after an editor change, skip it
		if (source === "vault") {
			const lastEditorChange =
				this.recentTemplateEditorChangeAt.get(file.path) ?? 0;
			const sinceEditorChange = Date.now() - lastEditorChange;
			const coalesceWindowMs =
				this.settings.autoRegenerateDebounce * 1000 + 250;
			if (
				sinceEditorChange >= 0 &&
				sinceEditorChange <= coalesceWindowMs
			) {
				debugLog(
					"template-change: skipped (coalesced vault modify)",
					file.path,
					{ sinceEditorChange },
				);
				return;
			}
		}

		// Check if this is a template file
		if (!this.isTemplateFile(file)) {
			debugLog(
				"template-change: skipped (not a template file)",
				file.path,
			);
			return;
		}

		// Skip if a bulk regeneration is already running
		if (this.isRegeneratingAll) {
			debugLog("template-change: skipped (bulk regeneration running)");
			return;
		}

		// Clear existing timer immediately (debounce starts here, not after async read)
		if (this.templateChangeTimer) {
			clearTimeout(this.templateChangeTimer);
			debugLog("template-change: cleared timer");
		}

		// Capture file path for the closure
		const filePath = file.path;
		const fileBasename = file.basename;

		// Set up debounced notification - timer starts immediately on modify event
		this.templateChangeTimer = setTimeout(() => {
			this.templateChangeTimer = null;
			debugLog("template-change: timer fired", filePath);

			// Double-check that regeneration isn't running
			if (this.isRegeneratingAll) {
				debugLog(
					"template-change: skipped (bulk regeneration running)",
				);
				return;
			}

			// If a template notice is already visible, don't show another
			if (this.activeTemplateNotice) {
				debugLog("template-change: skipped (notice already visible)");
				return;
			}

			// Now read the file and check for actual changes (only when timer fires)
			const templateFile = this.app.vault.getAbstractFileByPath(filePath);
			if (!(templateFile instanceof TFile)) {
				debugLog("template-change: skipped (file missing)", filePath);
				return;
			}

			void this.app.vault.read(templateFile).then((content) => {
				const cachedContent = this.templateContentCache.get(filePath);
				debugLog("template-change: content read", filePath, {
					hasCache: cachedContent !== undefined,
				});

				// Skip if content hasn't changed
				if (content === cachedContent) {
					debugLog(
						"template-change: skipped (content unchanged)",
						filePath,
					);
					return;
				}

				// Update cache
				this.templateContentCache.set(filePath, content);

				// Skip if this is the first time we're seeing this file (initial cache population)
				if (cachedContent === undefined) {
					debugLog(
						"template-change: skipped (initial cache population)",
						filePath,
					);
					return;
				}

				// Check if any cards use this template
				const cards =
					this.deckService.getFlashcardsByTemplate(filePath);
				if (cards.length === 0) {
					debugLog(
						"template-change: skipped (no cards for template)",
						filePath,
					);
					return;
				}
				debugLog("template-change: showing notice", filePath, {
					cards: cards.length,
				});

				// Show notice with action button (auto-dismiss after 6s)
				const cardLabel = cards.length === 1 ? "card" : "cards";
				const notice = new Notice("", 6000);

				// Build the notice content
				notice.messageEl.empty();
				const container = notice.messageEl.createDiv({
					cls: "flashcard-notice-container",
				});

				// Text
				container.createSpan({
					text: `Template "${fileBasename}" changed.`,
					cls: "flashcard-notice-text",
				});

				// Buttons container
				const buttons = container.createDiv({
					cls: "flashcard-notice-buttons",
				});

				// Regenerate button
				new ButtonComponent(buttons)
					.setButtonText(`Regenerate ${cards.length} ${cardLabel}`)
					.setCta()
					.onClick(() => {
						notice.hide();
						this.activeTemplateNotice = null;
						void this.regenerateAllCardsFromTemplate(filePath);
					});

				this.activeTemplateNotice = notice;
				// Clear active notice after auto-dismiss
				window.setTimeout(() => {
					if (this.activeTemplateNotice === notice) {
						this.activeTemplateNotice = null;
						debugLog(
							"template-change: notice auto-dismissed",
							filePath,
						);
					}
				}, 6000);
			});
		}, this.settings.autoRegenerateDebounce * 1000);
	}

	/**
	 * Track a recent editor change (to coalesce with vault modify events).
	 */
	trackEditorChange(filePath: string): void {
		this.recentTemplateEditorChangeAt.set(filePath, Date.now());
	}

	/**
	 * Regenerate all cards that use a specific template.
	 */
	async regenerateAllCardsFromTemplate(templatePath: string): Promise<void> {
		// Prevent concurrent regenerations
		if (this.isRegeneratingAll) {
			new Notice("A regeneration is already in progress.");
			return;
		}

		const cards = this.deckService.getFlashcardsByTemplate(templatePath);

		if (cards.length === 0) {
			new Notice("No cards found using this template.");
			return;
		}

		this.isRegeneratingAll = true;

		// Get template name for display
		const template =
			await this.templateService.loadTemplate(templatePath);
		const templateName = template?.name ?? templatePath;

		let successCount = 0;
		let errorCount = 0;

		// Show initial progress notice
		const notice = new Notice(
			`Regenerating 0/${cards.length} cards from "${templateName}"...`,
			0,
		);

		try {
			for (let i = 0; i < cards.length; i++) {
				const card = cards[i];
				if (!card) continue;

				try {
					const file = this.app.vault.getAbstractFileByPath(
						card.path,
					);
					if (file instanceof TFile) {
						await this.cardService.regenerateCard(file);
						successCount++;
					} else {
						errorCount++;
					}
				} catch (error) {
					console.error(
						`Failed to regenerate card ${card.path}:`,
						error,
					);
					errorCount++;
				}

				// Update progress notice
				notice.setMessage(
					`Regenerating ${i + 1}/${cards.length} cards from "${templateName}"...`,
				);
			}
		} finally {
			this.isRegeneratingAll = false;
			notice.hide();

			// Show completion notice
			if (errorCount === 0) {
				new Notice(
					`Successfully regenerated ${successCount} card${successCount > 1 ? "s" : ""} from "${templateName}".`,
				);
			} else {
				new Notice(
					`Regenerated ${successCount} card${successCount > 1 ? "s" : ""}, ${errorCount} failed.`,
				);
			}
		}
	}

	/**
	 * Extract the body content from a flashcard file (everything after frontmatter).
	 */
	extractFlashcardBody(content: string): string {
		// Find the end of frontmatter
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
		if (!fmMatch) {
			return content;
		}

		let body = content.slice(fmMatch[0].length);

		// Remove protection comment if present
		body = body.replace(
			new RegExp(
				`^\\s*${PROTECTION_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
			),
			"",
		);

		return body.trim();
	}
}
