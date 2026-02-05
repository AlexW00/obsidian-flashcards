import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { AnkerSettingTab } from "./settings";
import {
	DEFAULT_SETTINGS,
	DEFAULT_STATE,
	type FlashcardsPluginSettings,
	type FlashcardsPluginState,
	type FlashcardTemplate,
	type Flashcard,
	debugLog,
} from "./types";
import { TemplateService } from "./flashcards/TemplateService";
import { CardService } from "./flashcards/CardService";
import { DeckService } from "./flashcards/DeckService";
import { Scheduler } from "./srs/Scheduler";
import { CardRegenService } from "./services/CardRegenService";
import { AttachmentCleanupService } from "./services/AttachmentCleanupService";
import { AiCacheService } from "./services/AiCacheService";
import { AiService } from "./services/AiService";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./ui/DashboardView";
import { ReviewView, REVIEW_VIEW_TYPE } from "./ui/ReviewView";
import { DeckSelectorModal } from "./ui/DeckSelectorModal";
import { TemplateSelectorModal } from "./ui/TemplateSelectorModal";
import { TemplateNameModal } from "./ui/TemplateNameModal";
import {
	showCardCreationModal,
	showCardEditModal,
} from "./ui/CardCreationFlow";
import { OrphanAttachmentsModal } from "./ui/OrphanAttachmentsModal";
import { CardErrorsModal, type CardError } from "./ui/CardErrorsModal";
import { AnkiImportModal } from "./ui/AnkiImportModal";
import { CardErrorsScopeModal } from "./ui/CardErrorsScopeModal";

/** Key prefix for storing API keys in SecretStorage */
const API_KEY_PREFIX = "anker-ai-api-key-";

export default class AnkerPlugin extends Plugin {
	settings: FlashcardsPluginSettings;
	state: FlashcardsPluginState;
	templateService: TemplateService;
	cardService: CardService;
	deckService: DeckService;
	scheduler: Scheduler;

	/** Status bar item for showing regeneration status */
	private statusBarItem: HTMLElement | null = null;
	/** Service for auto-regeneration and template watching */
	private cardRegenService: CardRegenService | null = null;
	/** Service for finding and deleting unused attachments */
	private attachmentCleanupService: AttachmentCleanupService | null = null;
	/** Service for AI-powered template filters */
	private aiService: AiService | null = null;
	/** Service for caching AI responses */
	private aiCacheService: AiCacheService | null = null;

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
		this.scheduler = new Scheduler(this.settings);
		this.attachmentCleanupService = new AttachmentCleanupService(this.app);

		// Initialize AI cache service
		this.aiCacheService = new AiCacheService(this.app);
		this.aiCacheService.setPersistence(
			() => this.loadData(),
			(data) => this.saveData(data),
		);
		await this.aiCacheService.load();

		// Initialize AI service
		this.aiService = new AiService(
			this.app,
			this.settings,
			this.aiCacheService,
			(provider) => this.getApiKey(provider),
		);

		// Connect AI service to template service
		this.templateService.setAiService(this.aiService);

		// Initialize card regeneration service
		this.cardRegenService = new CardRegenService({
			app: this.app,
			settings: this.settings,
			cardService: this.cardService,
			deckService: this.deckService,
			templateService: this.templateService,
			statusBarItem: this.statusBarItem,
		});

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
				this.cardRegenService?.handleMetadataChange(file);
			}),
		);

		// Register fast template change listener while editing
		this.registerEvent(
			this.app.workspace.on(
				"editor-change",
				(_editor: Editor, view: MarkdownView) => {
					const file = view?.file;
					if (file instanceof TFile) {
						this.cardRegenService?.trackEditorChange(file.path);
						this.cardRegenService?.handleTemplateFileChange(
							file,
							"editor",
						);
					}
				},
			),
		);

		// Register listener for template file and flashcard body changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.cardRegenService?.handleTemplateFileChange(
						file,
						"vault",
					);
					this.cardRegenService?.handleFlashcardBodyChange(file);
				}
			}),
		);

		// Add ribbon icon
		this.addRibbonIcon("layers", "Anker", () => {
			void this.openDashboard();
		});

		// Register commands
		this.registerCommands();

		// Add settings tab
		this.addSettingTab(new AnkerSettingTab(this.app, this));
	}

	onunload() {
		// Clean up card regeneration service
		this.cardRegenService?.destroy();
		this.cardRegenService = null;
		// Save AI cache before unload
		void this.aiCacheService?.forceSave();
		this.aiService = null;
		this.aiCacheService = null;
		// Views are automatically cleaned up
	}

	async loadSettings() {
		type FlashcardsPluginData = {
			settings?: Partial<FlashcardsPluginSettings>;
			state?: Partial<FlashcardsPluginState>;
		};

		const data = (await this.loadData()) as FlashcardsPluginData | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data?.settings ?? {},
		);
		this.state = Object.assign({}, DEFAULT_STATE, data?.state ?? {});
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			state: this.state,
		});
		// Update settings in dependent services
		this.cardRegenService?.updateSettings(this.settings);
		this.scheduler?.updateSettings(this.settings);
		this.aiService?.updateSettings(this.settings);
	}

	async saveState() {
		await this.saveData({
			settings: this.settings,
			state: this.state,
		});
	}

	/**
	 * Convert a provider ID to a valid SecretStorage key.
	 * SecretStorage requires: lowercase letters, numbers, and dashes only.
	 */
	private toSecretKey(providerId: string): string {
		// Replace underscores with dashes to make valid key
		return `${API_KEY_PREFIX}${providerId.replace(/_/g, "-")}`;
	}

	/**
	 * Get an API key from SecretStorage.
	 */
	async getApiKey(providerId: string): Promise<string | null> {
		const key = this.toSecretKey(providerId);
		// Use Obsidian's SecretStorage API - available in 1.11.4+
		const secretStorage = (
			this.app as unknown as {
				secretStorage?: {
					getSecret(id: string): string | null;
					setSecret(id: string, secret: string): void;
					listSecrets(): string[];
				};
			}
		).secretStorage;
		debugLog("SecretStorage get: %s available=%s", key, !!secretStorage);
		if (!secretStorage) {
			return null;
		}
		const value = secretStorage.getSecret(key);
		debugLog(
			"SecretStorage get result: %s (len=%s)",
			key,
			value ? String(value).length : 0,
		);
		return value ?? null;
	}

	/**
	 * Store an API key in SecretStorage.
	 */
	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		const key = this.toSecretKey(providerId);
		// Use Obsidian's SecretStorage API - available in 1.11.4+
		const secretStorage = (
			this.app as unknown as {
				secretStorage?: {
					getSecret(id: string): string | null;
					setSecret(id: string, secret: string): void;
					listSecrets(): string[];
				};
			}
		).secretStorage;
		debugLog(
			"SecretStorage set: %s available=%s (len=%s)",
			key,
			!!secretStorage,
			apiKey.length,
		);
		if (!secretStorage) {
			return;
		}
		secretStorage.setSecret(key, apiKey);
	}

	/**
	 * Delete an API key from SecretStorage.
	 */
	async deleteApiKey(providerId: string): Promise<void> {
		const key = this.toSecretKey(providerId);
		// Use Obsidian's SecretStorage API - available in 1.11.4+
		const secretStorage = (
			this.app as unknown as {
				secretStorage?: {
					getSecret(id: string): string | null;
					setSecret(id: string, secret: string): void;
					listSecrets(): string[];
				};
			}
		).secretStorage;
		debugLog("SecretStorage delete: %s available=%s", key, !!secretStorage);
		if (!secretStorage) {
			return;
		}
		// SecretStorage doesn't have deleteSecret, so set to empty string
		secretStorage.setSecret(key, "");
	}

	/**
	 * Register all plugin commands.
	 */
	private registerCommands() {
		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: () => this.openDashboard(),
		});

		this.addCommand({
			id: "create-card",
			name: "Create new card",
			callback: () => {
				void this.createCard();
			},
		});

		this.addCommand({
			id: "edit-card",
			name: "Edit current card",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file && this.deckService.isFlashcard(file)) {
					if (!checking) {
						void this.editCard(file);
					}
					return true;
				}
				return false;
			},
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
				if (file && this.deckService.isFlashcard(file)) {
					if (!checking) {
						void this.regenerateCard(file, false);
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

		this.addCommand({
			id: "delete-unused-attachments",
			name: "Delete unused attachments",
			callback: () => this.deleteUnusedAttachments(),
		});

		this.addCommand({
			id: "import-anki-backup",
			name: "Import Anki backup",
			callback: () => this.importAnkiBackup(),
		});

		this.addCommand({
			id: "clear-ai-cache",
			name: "Clear dynamic pipe cache",
			callback: () => {
				this.aiCacheService?.clearAll();
				new Notice("Dynamic pipe cache cleared");
			},
		});

		this.addCommand({
			id: "open-failed-cards",
			name: "Show card errors",
			callback: () => this.openCardErrorsCommand(),
		});
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
	 * Open the edit modal for an existing flashcard file.
	 */
	async editCard(file: TFile): Promise<void> {
		await showCardEditModal(
			this.app,
			this.cardService,
			this.deckService,
			this.templateService,
			this.settings,
			file,
		);
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
	 * Opens the CardFormModal directly with deck/template selectors embedded.
	 */
	private async createCard() {
		let initialTemplate: FlashcardTemplate | undefined;
		let initialDeckPath: string | undefined;
		const activeFile = this.app.workspace.getActiveFile();

		if (activeFile) {
			if (this.isTemplateFile(activeFile)) {
				initialTemplate =
					(await this.templateService.loadTemplate(
						activeFile.path,
					)) ?? undefined;
			} else if (this.isDeckBaseFile(activeFile)) {
				// Extract deck path from base file (e.g., "deck/path/flashcards.base" -> "deck/path")
				initialDeckPath = activeFile.parent?.path;
			}
		}

		showCardCreationModal(
			this.app,
			this.cardService,
			this.deckService,
			this.templateService,
			this.settings,
			this.state,
			() => this.saveState(),
			undefined,
			initialDeckPath,
			initialTemplate,
		);
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
	 * Check if a file is a deck base view file (flashcards.base or flashcards-{filter}.base).
	 */
	private isDeckBaseFile(file: TFile): boolean {
		return (
			file.extension === "base" &&
			/^flashcards(-\w+)?$/.test(file.basename)
		);
	}

	/**
	 * Regenerate a flashcard from its template.
	 * @param file The flashcard file to regenerate
	 * @param skipCache If true, skip AI cache and force fresh generation
	 */
	private async regenerateCard(file: TFile, skipCache = false) {
		try {
			await this.cardService.regenerateCard(file, { skipCache });
			const cacheNote = skipCache ? " (cache skipped)" : "";
			new Notice(`Card regenerated!${cacheNote}`);
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
	 * Show template selector for regeneration.
	 */
	private selectTemplateForRegeneration() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && this.isTemplateFile(activeFile)) {
			void this.cardRegenService?.regenerateAllCardsFromTemplate(
				activeFile.path,
			);
			return;
		}

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
					void this.cardRegenService?.regenerateAllCardsFromTemplate(
						template.path,
					);
				}).open();
			});
	}

	/**
	 * Find and delete unused attachments in the configured attachment folder.
	 */
	private async deleteUnusedAttachments() {
		if (!this.attachmentCleanupService) {
			new Notice("Attachment cleanup service not available");
			return;
		}

		const attachmentFolder = this.settings.attachmentFolder;
		let orphans: TFile[] = [];
		try {
			orphans =
				await this.attachmentCleanupService.findOrphanAttachments(
					attachmentFolder,
				);
		} catch (error) {
			console.error("Failed to scan attachments", error);
			new Notice("Failed to scan attachments");
			return;
		}

		if (orphans.length === 0) {
			new Notice("No unused attachments found");
			return;
		}

		new OrphanAttachmentsModal(
			this.app,
			orphans,
			attachmentFolder,
			async () => {
				for (const file of orphans) {
					await this.app.fileManager.trashFile(file);
				}
			},
		).open();
	}

	/**
	 * Open the Anki import modal.
	 */
	private importAnkiBackup() {
		new AnkiImportModal(
			this.app,
			this.templateService,
			this.deckService,
			this.settings,
		).open();
	}

	/**
	 * Command entry: open card errors with smart defaults and scope selection.
	 */
	private openCardErrorsCommand(): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			if (this.isDeckBaseFile(activeFile)) {
				const deckPath = activeFile.parent?.path;
				if (deckPath) {
					this.openCardErrorsForDeck(deckPath);
					return;
				}
			}
			if (this.isTemplateFile(activeFile)) {
				this.openCardErrorsForTemplate(activeFile.path);
				return;
			}
		}

		new CardErrorsScopeModal(this.app, this.deckService, (scope) => {
			if (scope.type === "all") {
				this.openCardErrorsForAll();
				return;
			}
			if (scope.type === "deck") {
				this.openCardErrorsForDeck(scope.path);
				return;
			}

			void this.templateService
				.getTemplates(this.settings.templateFolder)
				.then((templates) => {
					if (templates.length === 0) {
						new Notice(
							`No templates found in "${this.settings.templateFolder}".`,
						);
						return;
					}
					new TemplateSelectorModal(this.app, templates, (template) =>
						this.openCardErrorsForTemplate(template.path),
					).open();
				});
		}).open();
	}

	private openCardErrorsForAll(): void {
		const cards = this.deckService.getAllFlashcards();
		this.openCardErrorsFromCards(cards, "No card errors found");
	}

	private openCardErrorsForDeck(deckPath: string): void {
		const cards = this.deckService.getFlashcardsInFolder(deckPath);
		this.openCardErrorsFromCards(
			cards,
			`No card errors found in "${deckPath}"`,
		);
	}

	private openCardErrorsForTemplate(templatePath: string): void {
		const cards = this.deckService.getFlashcardsByTemplate(templatePath);
		this.openCardErrorsFromCards(
			cards,
			"No card errors found for this template",
		);
	}

	/**
	 * Build and open CardErrorsModal from a set of flashcards.
	 */
	private openCardErrorsFromCards(
		cards: Flashcard[],
		emptyMessage: string,
	): void {
		const cardErrors = this.buildCardErrors(cards);

		if (cardErrors.length === 0) {
			new Notice(emptyMessage);
			return;
		}

		cardErrors.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));

		if (this.cardRegenService) {
			this.cardRegenService.openCardErrorsModal(cardErrors);
			return;
		}

		new CardErrorsModal(this.app, cardErrors, this.cardService).open();
	}

	private buildCardErrors(cards: Flashcard[]): CardError[] {
		const cardErrors: CardError[] = [];

		for (const card of cards) {
			const rawError = (card.frontmatter as Record<string, unknown>)
				._error;
			if (rawError === undefined || rawError === null) {
				continue;
			}
			const errorMessage =
				typeof rawError === "string"
					? rawError
					: (() => {
							try {
								return JSON.stringify(rawError);
							} catch {
								if (rawError instanceof Error) {
									return rawError.message;
								}
								if (rawError === null) {
									return "null";
								}
								switch (typeof rawError) {
									case "string":
										return rawError;
									case "number":
									case "boolean":
									case "bigint":
										return rawError.toString();
									case "symbol":
										return rawError.description ?? rawError.toString();
									case "undefined":
										return "undefined";
									case "function":
										return rawError.name
											? `[function ${rawError.name}]`
											: "[function]";
									case "object":
									default:
										return Object.prototype.toString.call(rawError);
								}
							}
						})();
			const trimmedError = errorMessage.trim();
			if (!trimmedError) {
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(card.path);
			cardErrors.push({
				file: file instanceof TFile ? file : null,
				path: card.path,
				error: trimmedError,
			});
		}

		return cardErrors;
	}
}
