import {
	ButtonComponent,
	ItemView,
	WorkspaceLeaf,
	setIcon,
	Notice,
} from "obsidian";
import type FlashcardsPlugin from "../main";
import type { Deck } from "../types";
import { DeckSelectorModal } from "./DeckSelectorModal";
import { TemplateSelectorModal } from "./TemplateSelectorModal";
import { CardCreationModal } from "./CardCreationModal";

export const DASHBOARD_VIEW_TYPE = "flashcards-dashboard";

/**
 * Main dashboard view showing decks and their stats.
 */
export class DashboardView extends ItemView {
	plugin: FlashcardsPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Flashcards";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen() {
		await this.render();
	}

	async onClose() {
		// Cleanup if needed
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;

		container.empty();
		container.addClass("flashcard-dashboard");

		// Header with toolbar
		const header = container.createDiv({
			cls: "flashcard-dashboard-header",
		});

		header.createEl("h2", { text: "Flashcards" });

		const toolbar = header.createDiv({
			cls: "flashcard-dashboard-toolbar",
		});

		// Add Card button
		new ButtonComponent(toolbar)
			.setButtonText("Add card")
			.setIcon("plus")
			.setCta()
			.onClick(() => this.startCardCreation());

		// Refresh button
		new ButtonComponent(toolbar)
			.setIcon("refresh-cw")
			.setTooltip("Refresh")
			.onClick(() => void this.render());

		// Deck list
		const deckList = container.createDiv({ cls: "flashcard-deck-list" });

		const decks = this.plugin.deckService.discoverDecks();

		if (decks.length === 0) {
			const emptyState = deckList.createDiv({
				cls: "flashcard-empty-state",
			});
			emptyState.createEl("p", { text: "No flashcards yet." });
			emptyState.createEl("p", {
				text: "Create your first card to get started!",
			});

			new ButtonComponent(emptyState)
				.setButtonText("Create first card")
				.setCta()
				.onClick(() => this.startCardCreation());
		} else {
			this.renderDeckList(deckList, decks);
		}
	}

	private renderDeckList(container: HTMLElement, decks: Deck[]) {
		// Group decks by depth for hierarchical display
		const rootDecks = decks.filter((d) => !d.path.includes("/"));
		const childDecks = new Map<string, Deck[]>();

		for (const deck of decks) {
			if (deck.path.includes("/")) {
				const parentPath = deck.path.split("/").slice(0, -1).join("/");
				if (!childDecks.has(parentPath)) {
					childDecks.set(parentPath, []);
				}
				childDecks.get(parentPath)!.push(deck);
			}
		}

		const renderDeck = (deck: Deck, depth: number = 0) => {
			const deckEl = container.createDiv({ cls: "flashcard-deck-item" });
			deckEl.style.paddingLeft = `${depth * 20}px`;

			// Deck info
			const infoEl = deckEl.createDiv({ cls: "flashcard-deck-info" });

			const nameEl = infoEl.createSpan({ cls: "flashcard-deck-name" });
			setIcon(nameEl, "folder");
			nameEl.createSpan({ text: ` ${deck.name}` });

			// Stats badges
			const statsEl = infoEl.createDiv({ cls: "flashcard-deck-stats" });

			if (deck.stats.new > 0) {
				statsEl.createSpan({
					text: `${deck.stats.new}`,
					cls: "flashcard-stat flashcard-stat-new",
				});
			}
			if (deck.stats.learning > 0) {
				statsEl.createSpan({
					text: `${deck.stats.learning}`,
					cls: "flashcard-stat flashcard-stat-learning",
				});
			}
			if (deck.stats.due > 0) {
				statsEl.createSpan({
					text: `${deck.stats.due}`,
					cls: "flashcard-stat flashcard-stat-due",
				});
			}

			// Actions
			const actionsEl = deckEl.createDiv({
				cls: "flashcard-deck-actions",
			});

			const studyBtnComponent = new ButtonComponent(actionsEl)
				.setButtonText("Study")
				.setClass("flashcard-btn-small")
				.onClick(() => {
					void this.plugin.startReview(deck.path);
				});
			// Stop propagation on the button element
			studyBtnComponent.buttonEl.addEventListener("click", (e) =>
				e.stopPropagation(),
			);

			// Render children
			const children = childDecks.get(deck.path);
			if (children) {
				for (const child of children) {
					renderDeck(child, depth + 1);
				}
			}
		};

		for (const deck of rootDecks) {
			renderDeck(deck);
		}
	}

	private startCardCreation() {
		// Step 1: Select deck
		new DeckSelectorModal(
			this.app,
			this.plugin.deckService,
			(deckResult) => {
				const deckPath = deckResult.path;

				// Step 2: Select template
				void this.plugin.templateService
					// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
					.getTemplates(this.plugin.settings.templateFolder)
					.then((templates) => {
						if (templates.length === 0) {
							// No templates found - show error
							// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
							const templateFolder =
								// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
								this.plugin.settings.templateFolder;
							new Notice(
								`No templates found in "${templateFolder}". Please create a template first.`,
							);
							return;
						}

						if (templates.length === 1) {
							// Only one template, use it directly
							const template = templates[0];
							if (template) {
								this.showCardCreationModal(template, deckPath);
							}
						} else {
							new TemplateSelectorModal(
								this.app,
								templates,
								(template) => {
									this.showCardCreationModal(
										template,
										deckPath,
									);
								},
							).open();
						}
					});
			},
		).open();
	}

	private showCardCreationModal(
		template: import("../types").FlashcardTemplate,
		deckPath: string,
	) {
		new CardCreationModal(
			this.app,
			template,
			deckPath,
			(fields, createAnother) => {
				void this.plugin.cardService
					.createCard(
						deckPath,
						template.path,
						fields,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
						this.plugin.settings.noteNameTemplate,
					)
					.then(async () => {
						new Notice("Card created!");

						// Update last used deck
						// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
						this.plugin.settings.lastUsedDeck = deckPath;
						await this.plugin.saveSettings();

						// Refresh dashboard
						await this.render();

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
}
