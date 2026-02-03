import {
	ButtonComponent,
	ItemView,
	WorkspaceLeaf,
	setIcon,
	debounce,
} from "obsidian";
import type FlashcardsPlugin from "../main";
import type { Deck } from "../types";
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
	private collapsedDeckPaths = new Set<string>();

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

		const renderDeck = (deck: Deck, depth: number, parent: HTMLElement) => {
			const deckEl = parent.createDiv({ cls: "flashcard-deck-item" });
			deckEl.style.paddingLeft = `${depth * 20}px`;

			const children = childDecks.get(deck.path) ?? [];
			const hasChildren = children.length > 0;
			const isCollapsed = hasChildren
				? this.collapsedDeckPaths.has(deck.path)
				: false;

			// Deck info
			const infoEl = deckEl.createDiv({ cls: "flashcard-deck-info" });

			const nameEl = infoEl.createSpan({ cls: "flashcard-deck-name" });
			const iconEl = nameEl.createSpan({
				cls: "flashcard-deck-toggle",
			});
			setIcon(
				iconEl,
				hasChildren
					? isCollapsed
						? "folder-closed"
						: "folder-open"
					: "folder",
			);
			if (hasChildren) {
				iconEl.setAttr("role", "button");
				iconEl.setAttr("tabindex", "0");
				iconEl.setAttr("aria-expanded", String(!isCollapsed));
				iconEl.setAttr(
					"aria-label",
					isCollapsed ? "Expand deck" : "Collapse deck",
				);
			} else {
				iconEl.addClass("flashcard-deck-toggle-disabled");
				iconEl.setAttr("aria-hidden", "true");
			}

			const linkEl = nameEl.createSpan({
				cls: "flashcard-deck-name-link",
				text: deck.name,
			});
			linkEl.setAttr("role", "button");
			linkEl.setAttr("tabindex", "0");
			linkEl.setAttr("title", "View cards in deck");
			linkEl.setAttr("aria-label", "View cards in deck");
			linkEl.addEventListener("click", (event) => {
				event.stopPropagation();
				void this.deckBaseViewService.openDeckBaseView(
					deck.path,
					deck.name,
				);
			});
			linkEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					void this.deckBaseViewService.openDeckBaseView(
						deck.path,
						deck.name,
					);
				}
			});

			let childrenEl: HTMLDivElement | null = null;
			const updateCollapseState = (collapsed: boolean) => {
				if (!hasChildren) return;
				if (collapsed) {
					this.collapsedDeckPaths.add(deck.path);
				} else {
					this.collapsedDeckPaths.delete(deck.path);
				}
				setIcon(iconEl, collapsed ? "folder-closed" : "folder-open");
				iconEl.setAttr("aria-expanded", String(!collapsed));
				iconEl.setAttr(
					"aria-label",
					collapsed ? "Expand deck" : "Collapse deck",
				);
				if (childrenEl) {
					childrenEl.style.display = collapsed ? "none" : "";
				}
			};

			if (hasChildren) {
				const handleToggle = (event: Event) => {
					event.stopPropagation();
					updateCollapseState(
						!this.collapsedDeckPaths.has(deck.path),
					);
				};
				iconEl.addEventListener("click", handleToggle);
				iconEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						handleToggle(event);
					}
				});
			}
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
			if (hasChildren) {
				childrenEl = parent.createDiv({
					cls: "flashcard-deck-children",
				});
				childrenEl.style.display = isCollapsed ? "none" : "";
				for (const child of children) {
					renderDeck(child, depth + 1, childrenEl);
				}
			}
		};

		for (const deck of rootDecks) {
			renderDeck(deck, 0, container);
		}
	}

	private startCardCreation() {
		// Open the CardCreationModal directly with embedded deck/template selectors
		showCardCreationModal(
			this.app,
			this.plugin.cardService,
			this.plugin.deckService,
			this.plugin.templateService,
			this.plugin.settings,
			this.plugin.state,
			() => this.plugin.saveState(),
			{ onRefresh: () => this.render() },
		);
	}
}
