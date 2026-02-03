import {
	ItemView,
	MarkdownRenderer,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type FlashcardsPlugin from "../main";
import type { Flashcard } from "../types";
import { Rating } from "../srs/Scheduler";

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

	constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
		super(leaf);
		this.plugin = plugin;
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
		this.renderEmpty();
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

		// Render current side
		const sideContent = this.currentContent[this.session.currentSide] || "";
		const renderTarget = cardEl.createDiv({
			cls: "flashcard-card-content",
		});

		// Use Obsidian's markdown renderer
		void MarkdownRenderer.render(
			this.app,
			sideContent,
			renderTarget,
			currentCard.path,
			this,
		);

		// Controls
		const controlsContainer = container.createDiv({
			cls: "flashcard-controls",
		});

		const isLastSide =
			this.session.currentSide >= this.session.totalSides - 1;

		if (!isLastSide) {
			// Show "Reveal" button
			const revealBtn = controlsContainer.createEl("button", {
				text: "Show answer",
				cls: "flashcard-btn flashcard-btn-reveal mod-cta",
			});
			revealBtn.addEventListener("click", () => this.revealNext());

			// Keyboard hint
			controlsContainer.createSpan({
				text: "Press Space to reveal",
				cls: "flashcard-hint",
			});
		} else {
			// Show rating buttons
			this.renderRatingButtons(controlsContainer, currentCard);
		}

		// Edit button (always visible)
		const editBtn = container.createEl("button", {
			cls: "flashcard-btn flashcard-btn-edit",
		});
		setIcon(editBtn, "edit");
		editBtn.addEventListener("click", () => void this.editCurrentCard());

		// Register keyboard shortcuts
		this.registerKeyboardShortcuts(container);
	}

	private renderRatingButtons(container: HTMLElement, card: Flashcard) {
		if (!this.session) return;

		const reviewState = card.frontmatter.review;
		const nextStates = this.plugin.scheduler.getNextStates(reviewState);

		const buttonsContainer = container.createDiv({
			cls: "flashcard-rating-buttons",
		});

		// Again button
		const againBtn = buttonsContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-again",
		});
		againBtn.createSpan({ text: "Again" });
		againBtn.createSpan({
			text: nextStates.again.interval,
			cls: "flashcard-interval",
		});
		againBtn.addEventListener(
			"click",
			() => void this.rateCard(Rating.Again),
		);

		// Hard button
		const hardBtn = buttonsContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-hard",
		});
		hardBtn.createSpan({ text: "Hard" });
		hardBtn.createSpan({
			text: nextStates.hard.interval,
			cls: "flashcard-interval",
		});
		hardBtn.addEventListener(
			"click",
			() => void this.rateCard(Rating.Hard),
		);

		// Good button
		const goodBtn = buttonsContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-good",
		});
		goodBtn.createSpan({ text: "Good" });
		goodBtn.createSpan({
			text: nextStates.good.interval,
			cls: "flashcard-interval",
		});
		goodBtn.addEventListener(
			"click",
			() => void this.rateCard(Rating.Good),
		);

		// Easy button
		const easyBtn = buttonsContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-easy",
		});
		easyBtn.createSpan({ text: "Easy" });
		easyBtn.createSpan({
			text: nextStates.easy.interval,
			cls: "flashcard-interval",
		});
		easyBtn.addEventListener(
			"click",
			() => void this.rateCard(Rating.Easy),
		);

		// Keyboard hints
		const hintsEl = container.createDiv({ cls: "flashcard-rating-hints" });
		hintsEl.createSpan({ text: "1: Again" });
		hintsEl.createSpan({ text: "2: Hard" });
		hintsEl.createSpan({ text: "3: Good" });
		hintsEl.createSpan({ text: "4: Easy" });
	}

	private registerKeyboardShortcuts(container: HTMLElement) {
		const handler = (e: KeyboardEvent) => {
			if (!this.session) return;

			const isLastSide =
				this.session.currentSide >= this.session.totalSides - 1;

			if (e.code === "Space") {
				e.preventDefault();
				if (!isLastSide) {
					this.revealNext();
				}
			} else if (isLastSide) {
				if (e.code === "Digit1" || e.code === "Numpad1") {
					e.preventDefault();
					void this.rateCard(Rating.Again);
				} else if (e.code === "Digit2" || e.code === "Numpad2") {
					e.preventDefault();
					void this.rateCard(Rating.Hard);
				} else if (e.code === "Digit3" || e.code === "Numpad3") {
					e.preventDefault();
					void this.rateCard(Rating.Good);
				} else if (e.code === "Digit4" || e.code === "Numpad4") {
					e.preventDefault();
					void this.rateCard(Rating.Easy);
				}
			}

			// Edit shortcut (Cmd/Ctrl + E)
			if ((e.metaKey || e.ctrlKey) && e.code === "KeyE") {
				e.preventDefault();
				void this.editCurrentCard();
			}
		};

		container.addEventListener("keydown", handler);
		container.setAttribute("tabindex", "0");
		container.focus();
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

		const backBtn = completeState.createEl("button", {
			text: "Back to dashboard",
			cls: "mod-cta",
		});
		backBtn.addEventListener("click", () => {
			void this.plugin.openDashboard();
		});

		this.session = null;
	}
}
