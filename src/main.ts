import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { FlashcardsSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type FlashcardsPluginSettings } from "./types";
import { TemplateService } from "./flashcards/TemplateService";
import { CardService } from "./flashcards/CardService";
import { DeckService } from "./flashcards/DeckService";
import { Scheduler } from "./srs/Scheduler";
import { CardRegenService } from "./services/CardRegenService";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./ui/DashboardView";
import { ReviewView, REVIEW_VIEW_TYPE } from "./ui/ReviewView";
import { DeckSelectorModal } from "./ui/DeckSelectorModal";
import { TemplateSelectorModal } from "./ui/TemplateSelectorModal";
import { TemplateNameModal } from "./ui/TemplateNameModal";
import { showCardCreationModal } from "./ui/CardCreationFlow";

export default class FlashcardsPlugin extends Plugin {
	settings: FlashcardsPluginSettings;
	templateService: TemplateService;
	cardService: CardService;
	deckService: DeckService;
	scheduler: Scheduler;

	/** Status bar item for showing regeneration status */
	private statusBarItem: HTMLElement | null = null;
	/** Service for auto-regeneration and template watching */
	private cardRegenService: CardRegenService | null = null;

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
		this.addRibbonIcon("layers", "Flashcards", () => {
			void this.openDashboard();
		});

		// Register commands
		this.registerCommands();

		// Add settings tab
		this.addSettingTab(new FlashcardsSettingTab(this.app, this));
	}

	onunload() {
		// Clean up card regeneration service
		this.cardRegenService?.destroy();
		this.cardRegenService = null;
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
		// Update settings in dependent services
		this.cardRegenService?.updateSettings(this.settings);
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
				if (file && this.deckService.isFlashcard(file)) {
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
							showCardCreationModal(
								this.app,
								this.cardService,
								this.settings,
								() => this.saveSettings(),
								template,
								deckPath,
							);
						}
					} else {
						new TemplateSelectorModal(
							this.app,
							templates,
							(template) => {
								showCardCreationModal(
									this.app,
									this.cardService,
									this.settings,
									() => this.saveSettings(),
									template,
									deckPath,
								);
							},
						).open();
					}
				});
		}).open();
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
					void this.cardRegenService?.regenerateAllCardsFromTemplate(
						template.path,
					);
				}).open();
			});
	}
}
