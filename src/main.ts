import {
	ButtonComponent,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from "obsidian";
import { FlashcardsSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type FlashcardsPluginSettings } from "./types";
import { TemplateService } from "./flashcards/TemplateService";
import { CardService } from "./flashcards/CardService";
import { DeckService } from "./flashcards/DeckService";
import { Scheduler } from "./srs/Scheduler";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./ui/DashboardView";
import { ReviewView, REVIEW_VIEW_TYPE } from "./ui/ReviewView";
import { DeckSelectorModal } from "./ui/DeckSelectorModal";
import { TemplateSelectorModal } from "./ui/TemplateSelectorModal";
import { CardCreationModal } from "./ui/CardCreationModal";
import { TemplateNameModal } from "./ui/TemplateNameModal";

export default class FlashcardsPlugin extends Plugin {
	settings: FlashcardsPluginSettings;
	templateService: TemplateService;
	cardService: CardService;
	deckService: DeckService;
	scheduler: Scheduler;

	/** Debounce timers for auto-regeneration, keyed by file path */
	private autoRegenerateTimers: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	/** Cache of frontmatter fields to detect changes */
	private frontmatterCache: Map<string, string> = new Map();
	/** Incrementing version per file to prevent stale regenerations */
	private autoRegenerateVersions: Map<string, number> = new Map();
	/** Status bar item for showing regeneration status */
	private statusBarItem: HTMLElement | null = null;
	/** Track if a bulk regeneration is currently in progress */
	private isRegeneratingAll = false;
	/** Debounce timer for template change notifications */
	private templateChangeTimer: ReturnType<typeof setTimeout> | null = null;
	/** Cache of template content to detect changes */
	private templateContentCache: Map<string, string> = new Map();
	/** Active template change notice (to prevent duplicates) */
	private activeTemplateNotice: Notice | null = null;
	/** Track recent editor changes to avoid duplicate vault modify handling */
	private recentTemplateEditorChangeAt: Map<string, number> = new Map();

	async onload() {
		await this.loadSettings();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();

		// Initialize services
		this.templateService = new TemplateService(
			this.app,
			this.settings.defaultTemplateContent,
		);
		this.cardService = new CardService(this.app, this.templateService);
		this.deckService = new DeckService(this.app);
		this.scheduler = new Scheduler();

		// Ensure default template exists once the vault cache is ready
		this.app.workspace.onLayoutReady(() => {
			void this.templateService.ensureDefaultTemplate(
				this.settings.templateFolder,
			);
		});

		// Register views
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new DashboardView(leaf, this),
		);
		this.registerView(
			REVIEW_VIEW_TYPE,
			(leaf) => new ReviewView(leaf, this),
		);

		// Register auto-regenerate listener for frontmatter changes
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.handleMetadataChange(file);
			}),
		);

		// Register fast template change listener while editing
		this.registerEvent(
			this.app.workspace.on(
				"editor-change",
				(_editor: Editor, view: MarkdownView) => {
					const file = view?.file;
					if (file instanceof TFile) {
						this.recentTemplateEditorChangeAt.set(
							file.path,
							Date.now(),
						);
						console.debug("[Flashcards] editor-change", file.path);
						this.handleTemplateFileChange(file, "editor");
					}
				},
			),
		);

		// Register listener for template file changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					console.debug("[Flashcards] vault-modify", file.path);
					this.handleTemplateFileChange(file, "vault");
				}
			}),
		);

		// Add ribbon icon
		this.addRibbonIcon("layers", "Flashcards", () => {
			void this.openDashboard();
		});

		// Register commands
		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: () => this.openDashboard(),
		});

		this.addCommand({
			id: "create-card",
			name: "Create new card",
			callback: () => this.createCard(),
		});

		this.addCommand({
			id: "start-review",
			name: "Start review",
			callback: () => this.selectDeckForReview(),
		});

		this.addCommand({
			id: "regenerate-card",
			name: "Regenerate current card",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file && this.isFlashcard(file)) {
					if (!checking) {
						void this.regenerateCard(file);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "create-template",
			name: "Create new template",
			callback: () => this.createTemplate(),
		});

		this.addCommand({
			id: "regenerate-all-from-template",
			name: "Regenerate all cards from template",
			callback: () => this.selectTemplateForRegeneration(),
		});

		// Add settings tab
		this.addSettingTab(new FlashcardsSettingTab(this.app, this));
	}

	onunload() {
		// Clean up auto-regenerate timers
		for (const timer of this.autoRegenerateTimers.values()) {
			clearTimeout(timer);
		}
		this.autoRegenerateTimers.clear();
		this.frontmatterCache.clear();
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
		// Views are automatically cleaned up
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<FlashcardsPluginSettings> | null,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Handle metadata cache changes for auto-regeneration.
	 * Only triggers regeneration when flashcard fields change.
	 */
	private handleMetadataChange(file: TFile): void {
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
		const fm = cache?.frontmatter as
			| import("./types").FlashcardFrontmatter
			| undefined;

		if (!fm?.fields) {
			return;
		}

		// Create a hash of the fields to detect changes
		const fieldsHash = JSON.stringify(fm.fields);
		const cachedHash = this.frontmatterCache.get(file.path);

		// Skip if fields haven't changed
		if (fieldsHash === cachedHash) {
			return;
		}

		// Update cache
		this.frontmatterCache.set(file.path, fieldsHash);

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
	 * Open the flashcards dashboard view.
	 */
	async openDashboard() {
		const existing =
			this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		const existingLeaf = existing[0];

		if (existingLeaf) {
			void this.app.workspace.revealLeaf(existingLeaf);
		} else {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
			});
		}
	}

	/**
	 * Start a review session for a deck.
	 */
	async startReview(deckPath: string) {
		let leaf = this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE)[0];

		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: REVIEW_VIEW_TYPE,
				active: true,
			});
		}

		void this.app.workspace.revealLeaf(leaf);

		const view = leaf.view as ReviewView;
		await view.startSession(deckPath);
	}

	/**
	 * Show deck selector and start review.
	 */
	private selectDeckForReview() {
		const decks = this.deckService.discoverDecks();

		if (decks.length === 0) {
			new Notice("No flashcard decks found. Create some cards first!");
			return;
		}

		new DeckSelectorModal(this.app, this.deckService, (result) => {
			void this.startReview(result.path);
		}).open();
	}

	/**
	 * Start the card creation flow.
	 */
	private createCard() {
		new DeckSelectorModal(this.app, this.deckService, (deckResult) => {
			const deckPath = deckResult.path;

			void this.templateService
				.getTemplates(this.settings.templateFolder)
				.then((templates) => {
					if (templates.length === 0) {
						new Notice(
							`No templates found in "${this.settings.templateFolder}". Please create a template first.`,
						);
						return;
					}

					if (templates.length === 1) {
						const template = templates[0];
						if (template) {
							this.showCardCreationModal(template, deckPath);
						}
					} else {
						new TemplateSelectorModal(
							this.app,
							templates,
							(template) => {
								this.showCardCreationModal(template, deckPath);
							},
						).open();
					}
				});
		}).open();
	}

	private showCardCreationModal(
		template: import("./types").FlashcardTemplate,
		deckPath: string,
	) {
		new CardCreationModal(
			this.app,
			template,
			deckPath,
			(fields, createAnother) => {
				void this.cardService
					.createCard(
						deckPath,
						template.path,
						fields,
						this.settings.noteNameTemplate,
					)
					.then(() => {
						new Notice("Card created!");

						this.settings.lastUsedDeck = deckPath;
						void this.saveSettings();

						if (createAnother) {
							this.showCardCreationModal(template, deckPath);
						}
					})
					.catch((error: Error) => {
						new Notice(`Failed to create card: ${error.message}`);
					});
			},
		).open();
	}

	/**
	 * Check if a file is a flashcard.
	 */
	private isFlashcard(file: TFile): boolean {
		return this.deckService.isFlashcard(file);
	}

	/**
	 * Regenerate a flashcard from its template.
	 */
	private async regenerateCard(file: TFile) {
		try {
			await this.cardService.regenerateCard(file);
			new Notice("Card regenerated!");
		} catch (error) {
			new Notice(`Failed to regenerate: ${(error as Error).message}`);
		}
	}

	/**
	 * Create a new template with a user-provided name.
	 */
	private createTemplate() {
		new TemplateNameModal(this.app, (name) => {
			void this.templateService
				.createTemplate(this.settings.templateFolder, name)
				.then((templatePath) => {
					new Notice(`Template "${name}" created!`);
					// Open the new template for editing
					const file =
						this.app.vault.getAbstractFileByPath(templatePath);
					if (file instanceof TFile) {
						void this.app.workspace.getLeaf().openFile(file);
					}
				})
				.catch((error: Error) => {
					new Notice(`Failed to create template: ${error.message}`);
				});
		}).open();
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
	private handleTemplateFileChange(
		file: TFile,
		source: "editor" | "vault",
	): void {
		console.debug("[Flashcards] template-change: start", file.path, source);
		// Skip if auto-regenerate is disabled
		if (this.settings.autoRegenerateDebounce <= 0) {
			console.debug(
				"[Flashcards] template-change: skipped (autoRegenerateDebounce <= 0)",
			);
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
				console.debug(
					"[Flashcards] template-change: skipped (coalesced vault modify)",
					file.path,
					{ sinceEditorChange },
				);
				return;
			}
		}

		// Check if this is a template file
		if (!this.isTemplateFile(file)) {
			console.debug(
				"[Flashcards] template-change: skipped (not a template file)",
				file.path,
			);
			return;
		}

		// Skip if a bulk regeneration is already running
		if (this.isRegeneratingAll) {
			console.debug(
				"[Flashcards] template-change: skipped (bulk regeneration running)",
			);
			return;
		}

		// Clear existing timer immediately (debounce starts here, not after async read)
		if (this.templateChangeTimer) {
			clearTimeout(this.templateChangeTimer);
			console.debug("[Flashcards] template-change: cleared timer");
		}

		// Capture file path for the closure
		const filePath = file.path;
		const fileBasename = file.basename;

		// Set up debounced notification - timer starts immediately on modify event
		this.templateChangeTimer = setTimeout(() => {
			this.templateChangeTimer = null;
			console.debug(
				"[Flashcards] template-change: timer fired",
				filePath,
			);

			// Double-check that regeneration isn't running
			if (this.isRegeneratingAll) {
				console.debug(
					"[Flashcards] template-change: skipped (bulk regeneration running)",
				);
				return;
			}

			// If a template notice is already visible, don't show another
			if (this.activeTemplateNotice) {
				console.debug(
					"[Flashcards] template-change: skipped (notice already visible)",
				);
				return;
			}

			// Now read the file and check for actual changes (only when timer fires)
			const templateFile = this.app.vault.getAbstractFileByPath(filePath);
			if (!(templateFile instanceof TFile)) {
				console.debug(
					"[Flashcards] template-change: skipped (file missing)",
					filePath,
				);
				return;
			}

			void this.app.vault.read(templateFile).then((content) => {
				const cachedContent = this.templateContentCache.get(filePath);
				console.debug(
					"[Flashcards] template-change: content read",
					filePath,
					{ hasCache: cachedContent !== undefined },
				);

				// Skip if content hasn't changed
				if (content === cachedContent) {
					console.debug(
						"[Flashcards] template-change: skipped (content unchanged)",
						filePath,
					);
					return;
				}

				// Update cache
				this.templateContentCache.set(filePath, content);

				// Skip if this is the first time we're seeing this file (initial cache population)
				if (cachedContent === undefined) {
					console.debug(
						"[Flashcards] template-change: skipped (initial cache population)",
						filePath,
					);
					return;
				}

				// Check if any cards use this template
				const cards =
					this.deckService.getFlashcardsByTemplate(filePath);
				if (cards.length === 0) {
					console.debug(
						"[Flashcards] template-change: skipped (no cards for template)",
						filePath,
					);
					return;
				}
				console.debug(
					"[Flashcards] template-change: showing notice",
					filePath,
					{ cards: cards.length },
				);

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
						console.debug(
							"[Flashcards] template-change: notice auto-dismissed",
							filePath,
						);
					}
				}, 6000);
			});
		}, this.settings.autoRegenerateDebounce * 1000);
	}

	/**
	 * Show template selector for regeneration.
	 */
	private selectTemplateForRegeneration() {
		void this.templateService
			.getTemplates(this.settings.templateFolder)
			.then((templates) => {
				if (templates.length === 0) {
					new Notice(
						`No templates found in "${this.settings.templateFolder}".`,
					);
					return;
				}

				new TemplateSelectorModal(this.app, templates, (template) => {
					void this.regenerateAllCardsFromTemplate(template.path);
				}).open();
			});
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
		const template = await this.templateService.loadTemplate(templatePath);
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
}
