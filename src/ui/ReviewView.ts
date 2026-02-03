import {
	ButtonComponent,
	ItemView,
	MarkdownRenderer,
	Scope,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";
import type FlashcardsPlugin from "../main";
import type { Flashcard } from "../types";
import { Rating } from "../srs/Scheduler";
import { registerReviewHotkeys } from "./ReviewHotkeys";

export const REVIEW_VIEW_TYPE = "flashcards-review";

interface ReviewSession {
	deckPath: string;
	cards: Flashcard[];
	currentIndex: number;
	currentSide: number;
	totalSides: number;
}

/**
 * Review view for studying flashcards.
 */
export class ReviewView extends ItemView {
	plugin: FlashcardsPlugin;
	private session: ReviewSession | null = null;
	private currentContent: string[] = [];
	private debouncedReloadCard: () => void;

	constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Debounce reload to avoid excessive updates during editing
		this.debouncedReloadCard = debounce(
			() => void this.reloadCurrentCard(),
			300,
			true,
		);

		// Set up keyboard shortcuts for review view
		this.scope = new Scope(this.app.scope);
		registerReviewHotkeys(this.scope, {
			getSession: () =>
				this.session
					? {
							currentSide: this.session.currentSide,
							totalSides: this.session.totalSides,
						}
					: null,
			revealNext: () => this.revealNext(),
			rateCard: (rating) => this.rateCard(rating),
			editCurrentCard: () => this.editCurrentCard(),
		});
	}

	getViewType(): string {
		return REVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Review";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen() {
		this.registerFileChangeListener();
		this.renderEmpty();
	}

	/**
	 * Register listener for file modifications to auto-update the current card.
	 */
	private registerFileChangeListener() {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.session) return;
				const currentCard =
					this.session.cards[this.session.currentIndex];
				if (currentCard && file.path === currentCard.path) {
					this.debouncedReloadCard();
				}
			}),
		);
	}

	/**
	 * Reload the current card content and re-render.
	 */
	private async reloadCurrentCard() {
		if (!this.session) return;
		await this.loadCurrentCard();
		this.render();
	}

	async onClose() {
		this.session = null;
	}

	/**
	 * Start a review session for a deck.
	 */
	async startSession(deckPath: string) {
		const dueCards = this.plugin.deckService.getDueCards(deckPath);

		if (dueCards.length === 0) {
			this.renderComplete();
			return;
		}

		// Shuffle cards
		const shuffled = [...dueCards].sort(() => Math.random() - 0.5);

		this.session = {
			deckPath,
			cards: shuffled,
			currentIndex: 0,
			currentSide: 0,
			totalSides: 0,
		};

		await this.loadCurrentCard();
		void this.render();
	}

	private async loadCurrentCard() {
		if (!this.session) return;

		const card = this.session.cards[this.session.currentIndex];
		if (!card) {
			this.currentContent = ["Error: No card at current index"];
			this.session.totalSides = 1;
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(card.path);

		if (!(file instanceof TFile)) {
			this.currentContent = ["Error: Card file not found"];
			this.session.totalSides = 1;
			return;
		}

		const content = await this.app.vault.read(file);
		this.currentContent = this.plugin.cardService.getCardSides(content);
		this.session.totalSides = this.currentContent.length;
		this.session.currentSide = 0;
	}

	private render() {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;

		container.empty();
		container.addClass("flashcard-review");

		if (!this.session) {
			this.renderEmpty();
			return;
		}

		const currentCard = this.session.cards[this.session.currentIndex];
		if (!currentCard) {
			this.renderEmpty();
			return;
		}

		// Progress bar
		const progressContainer = container.createDiv({
			cls: "flashcard-review-progress",
		});
		const progress =
			(this.session.currentIndex / this.session.cards.length) * 100;
		const progressBar = progressContainer.createDiv({
			cls: "flashcard-progress-bar",
		});
		progressBar.createDiv({
			cls: "flashcard-progress-fill",
		}).style.width = `${progress}%`;
		progressContainer.createSpan({
			text: `${this.session.currentIndex + 1} / ${this.session.cards.length}`,
			cls: "flashcard-progress-text",
		});

		// Card container
		const cardContainer = container.createDiv({
			cls: "flashcard-card-container",
		});
		const cardEl = cardContainer.createDiv({ cls: "flashcard-card" });

		// Render sides based on setting
		const showOnlyCurrentSide = this.plugin.settings.showOnlyCurrentSide;

		if (showOnlyCurrentSide) {
			// Only show current side
			const sideContent =
				this.currentContent[this.session.currentSide] || "";
			const renderTarget = cardEl.createDiv({
				cls: "flashcard-card-content",
			});
			void MarkdownRenderer.render(
				this.app,
				sideContent,
				renderTarget,
				currentCard.path,
				this,
			);
		} else {
			// Show all sides up to and including the current side
			for (let i = 0; i <= this.session.currentSide; i++) {
				const sideContent = this.currentContent[i] || "";
				const renderTarget = cardEl.createDiv({
					cls: "flashcard-card-content",
				});
				void MarkdownRenderer.render(
					this.app,
					sideContent,
					renderTarget,
					currentCard.path,
					this,
				);

				// Add separator between sides (but not after the last one)
				if (i < this.session.currentSide) {
					cardEl.createEl("hr", { cls: "flashcard-side-separator" });
				}
			}
		}

		// Controls
		const controlsContainer = container.createDiv({
			cls: "flashcard-controls",
		});

		const actionsContainer = controlsContainer.createDiv({
			cls: "flashcard-actions",
		});

		const isLastSide =
			this.session.currentSide >= this.session.totalSides - 1;

		if (!isLastSide) {
			// Show "Reveal" button
			new ButtonComponent(actionsContainer)
				.setButtonText("Show answer")
				.setCta()
				.setClass("flashcard-btn-reveal")
				.onClick(() => this.revealNext());
			actionsContainer.createDiv({
				cls: "flashcard-hint",
				text: "Space to show answer • E to edit",
			});
		} else {
			// Show rating buttons
			this.renderRatingButtons(actionsContainer, currentCard);
		}
	}

	private renderRatingButtons(container: HTMLElement, card: Flashcard) {
		if (!this.session) return;

		const reviewState = card.frontmatter.review;
		const nextStates = this.plugin.scheduler.getNextStates(reviewState);

		const buttonsContainer = container.createDiv({
			cls: "flashcard-rating-buttons",
		});

		// Helper to create rating button with interval
		const createRatingButton = (
			label: string,
			interval: string,
			rating: Rating,
			className: string,
		) => {
			const btnWrapper = buttonsContainer.createDiv({ cls: className });
			new ButtonComponent(btnWrapper)
				.setButtonText(label)
				.setClass(className)
				.onClick(() => void this.rateCard(rating));
			btnWrapper.createSpan({
				text: interval,
				cls: "flashcard-interval",
			});
		};

		// Again button
		createRatingButton(
			"Again (1)",
			nextStates.again.interval,
			Rating.Again,
			"flashcard-btn-again",
		);

		// Hard button
		createRatingButton(
			"Hard (2)",
			nextStates.hard.interval,
			Rating.Hard,
			"flashcard-btn-hard",
		);

		// Good button
		createRatingButton(
			"Good (3)",
			nextStates.good.interval,
			Rating.Good,
			"flashcard-btn-good",
		);

		// Easy button
		createRatingButton(
			"Easy (4)",
			nextStates.easy.interval,
			Rating.Easy,
			"flashcard-btn-easy",
		);
	}

	private revealNext() {
		if (!this.session) return;

		if (this.session.currentSide < this.session.totalSides - 1) {
			this.session.currentSide++;
			this.render();
		}
	}

	private async rateCard(rating: Rating) {
		if (!this.session) return;

		const card = this.session.cards[this.session.currentIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);

		if (file instanceof TFile) {
			const newState = this.plugin.scheduler.review(
				card.frontmatter.review,
				rating,
			);
			await this.plugin.cardService.updateReviewState(file, newState);
		}

		// Move to next card
		this.session.currentIndex++;

		if (this.session.currentIndex >= this.session.cards.length) {
			this.renderComplete();
		} else {
			await this.loadCurrentCard();
			this.render();
		}
	}

	private async editCurrentCard() {
		if (!this.session) return;

		const card = this.session.cards[this.session.currentIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);

		if (file instanceof TFile) {
			await this.app.workspace.getLeaf("tab").openFile(file);
		}
	}

	private renderEmpty() {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;

		container.empty();
		container.addClass("flashcard-review");

		const emptyState = container.createDiv({
			cls: "flashcard-empty-state",
		});
		emptyState.createEl("h3", { text: "No review session active" });
		emptyState.createEl("p", {
			text: "Select a deck from the dashboard to start reviewing.",
		});
	}

	private renderComplete() {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;

		container.empty();
		container.addClass("flashcard-review");

		const completeState = container.createDiv({
			cls: "flashcard-complete-state",
		});
		setIcon(
			completeState.createDiv({ cls: "flashcard-complete-icon" }),
			"check-circle",
		);
		completeState.createEl("h3", { text: "Review complete!" });
		completeState.createEl("p", {
			text: "You've reviewed all due cards in this deck.",
		});

		new ButtonComponent(completeState)
			.setButtonText("Back to dashboard")
			.setCta()
			.onClick(() => {
				void this.plugin.openDashboard();
			});

		this.session = null;
	}
}
