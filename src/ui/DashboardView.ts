import {
	ButtonComponent,
	ItemView,
	WorkspaceLeaf,
	setIcon,
	Notice,
	debounce,
} from "obsidian";
import type FlashcardsPlugin from "../main";
import type { Deck } from "../types";
import { DeckSelectorModal } from "./DeckSelectorModal";
import { TemplateSelectorModal } from "./TemplateSelectorModal";
import { showCardCreationModal } from "./CardCreationFlow";
import { DeckBaseViewService, type StateFilter } from "./DeckBaseViewService";

export const DASHBOARD_VIEW_TYPE = "flashcards-dashboard";

/**
 * Main dashboard view showing decks and their stats.
 */
export class DashboardView extends ItemView {
	plugin: FlashcardsPlugin;
	private debouncedRender: () => void;
	private deckBaseViewService: DeckBaseViewService;

	constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.debouncedRender = debounce(() => void this.render(), 300, true);
		this.deckBaseViewService = new DeckBaseViewService(
			this.app,
			this.plugin.settings,
		);
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
		// Register vault events for auto-refresh
		this.registerEvent(
			this.app.vault.on("create", () => this.debouncedRender()),
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.debouncedRender()),
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.debouncedRender()),
		);
		this.registerEvent(
			this.app.vault.on("modify", () => this.debouncedRender()),
		);

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

			const nameEl = infoEl.createSpan({
				cls: "flashcard-deck-name flashcard-deck-name-link",
			});
			setIcon(nameEl, "folder");
			nameEl.createSpan({ text: ` ${deck.name}` });
			nameEl.setAttr("role", "button");
			nameEl.setAttr("tabindex", "0");
			nameEl.setAttr("title", "View cards in deck");
			nameEl.setAttr("aria-label", "View cards in deck");
			nameEl.addEventListener("click", (event) => {
				event.stopPropagation();
				void this.deckBaseViewService.openDeckBaseView(
					deck.path,
					deck.name,
				);
			});
			nameEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					void this.deckBaseViewService.openDeckBaseView(
						deck.path,
						deck.name,
					);
				}
			});
			const statsEl = infoEl.createDiv({ cls: "flashcard-deck-stats" });

			// Helper to create clickable stat badges
			const createStatBadge = (
				count: number,
				filter: StateFilter,
				cls: string,
				label: string,
			) => {
				if (count <= 0) return;
				const badge = statsEl.createSpan({
					text: `${count} ${label}`,
					cls: `flashcard-stat ${cls} flashcard-stat-clickable`,
				});
				badge.setAttr("role", "button");
				badge.setAttr("tabindex", "0");
				badge.setAttr("title", `View ${label} cards`);
				badge.setAttr("aria-label", `View ${label} cards`);
				badge.addEventListener("click", (event) => {
					event.stopPropagation();
					void this.deckBaseViewService.openDeckBaseView(
						deck.path,
						deck.name,
						filter,
					);
				});
				badge.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						void this.deckBaseViewService.openDeckBaseView(
							deck.path,
							deck.name,
							filter,
						);
					}
				});
			};

			createStatBadge(deck.stats.new, "new", "flashcard-stat-new", "new");
			createStatBadge(
				deck.stats.learn,
				"learn",
				"flashcard-stat-learning",
				"learn",
			);
			createStatBadge(
				deck.stats.relearn,
				"relearn",
				"flashcard-stat-relearn",
				"relearn",
			);
			createStatBadge(
				deck.stats.review,
				"review",
				"flashcard-stat-due",
				"review",
			);

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
					.getTemplates(this.plugin.settings.templateFolder)
					.then((templates) => {
						if (templates.length === 0) {
							// No templates found - show error
							const templateFolder =
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
								showCardCreationModal(
									this.app,
									this.plugin.cardService,
									this.plugin.settings,
									() => this.plugin.saveSettings(),
									template,
									deckPath,
									{ onRefresh: () => this.render() },
								);
							}
						} else {
							new TemplateSelectorModal(
								this.app,
								templates,
								(template) => {
									showCardCreationModal(
										this.app,
										this.plugin.cardService,
										this.plugin.settings,
										() => this.plugin.saveSettings(),
										template,
										deckPath,
										{ onRefresh: () => this.render() },
									);
								},
							).open();
						}
					});
			},
		).open();
	}
}
