import { App, TFile, MarkdownView, Events, WorkspaceLeaf } from "obsidian";
import type { Flashcard, ReviewState } from "../types";
import type { DeckService } from "../flashcards/DeckService";
import type { CardService } from "../flashcards/CardService";
import { Rating, Scheduler } from "../srs/Scheduler";
import type { ReviewLogStore } from "../srs/ReviewLogStore";
import { debugLog } from "../types";

/**
 * Session state for tracking review progress.
 */
export interface ReviewSession {
	deckPath: string;
	cards: Flashcard[];
	currentCardPath: string;
	currentSide: number;
	totalSides: number;
	initialTotal: number;
	reviewedCount: number;
	reviewsPerformed: number;
}

/**
 * Events emitted by the ReviewSessionManager.
 */
export interface ReviewSessionEvents {
	"session-started": (session: ReviewSession) => void;
	"session-ended": () => void;
	"card-changed": (session: ReviewSession) => void;
	"side-revealed": (session: ReviewSession) => void;
	"session-complete": () => void;
}

/**
 * Global manager for review sessions.
 * Handles session state, navigation between cards, and rating.
 * Emits events for UI components to react to state changes.
 */
export class ReviewSessionManager extends Events {
	private app: App;
	private deckService: DeckService;
	private cardService: CardService;
	private scheduler: Scheduler;
	private reviewLogStore: ReviewLogStore;
	private session: ReviewSession | null = null;
	private sessionLeaf: WorkspaceLeaf | null = null;

	constructor(
		app: App,
		deckService: DeckService,
		cardService: CardService,
		scheduler: Scheduler,
		reviewLogStore: ReviewLogStore,
	) {
		super();
		this.app = app;
		this.deckService = deckService;
		this.cardService = cardService;
		this.scheduler = scheduler;
		this.reviewLogStore = reviewLogStore;
	}

	/**
	 * Check if a review session is active.
	 */
	isSessionActive(): boolean {
		return this.session !== null;
	}

	/**
	 * Get the current session state.
	 */
	getSession(): ReviewSession | null {
		return this.session;
	}

	/**
	 * Get the leaf (tab) associated with the current review session.
	 */
	getSessionLeaf(): WorkspaceLeaf | null {
		return this.sessionLeaf;
	}

	/**
	 * Get the deck name for the current session.
	 */
	getSessionDeckName(): string | null {
		if (!this.session) return null;
		// Extract folder name from deck path
		const parts = this.session.deckPath.split("/");
		return parts[parts.length - 1] || this.session.deckPath;
	}

	/**
	 * Check if a file is the currently reviewed card.
	 */
	isCurrentCard(filePath: string): boolean {
		return this.session?.currentCardPath === filePath;
	}

	/**
	 * Get card sides for the current card.
	 */
	async getCardSides(file: TFile): Promise<string[]> {
		const content = await this.app.vault.read(file);
		return this.cardService.getCardSides(content);
	}

	/**
	 * Start a new review session for a deck.
	 */
	async startSession(deckPath: string): Promise<void> {
		const dueCards = await this.deckService.getDueCardsFresh(deckPath);

		if (dueCards.length === 0) {
			this.trigger("session-complete");
			return;
		}

		const firstCard = dueCards[0];
		if (!firstCard) return;

		const file = this.app.vault.getAbstractFileByPath(firstCard.path);
		let totalSides = 1;
		if (file instanceof TFile) {
			const sides = await this.getCardSides(file);
			totalSides = sides.length;
		}

		this.session = {
			deckPath,
			cards: dueCards,
			currentCardPath: firstCard.path,
			currentSide: 0,
			totalSides,
			initialTotal: dueCards.length,
			reviewedCount: 0,
			reviewsPerformed: 0,
		};

		// Add body class for CSS-based content hiding (prevents flicker)
		document.body.classList.add("anker-review-session-active");
		debugLog("review: session started", deckPath, firstCard.path);

		this.trigger("session-started", this.session);

		// Open the first card in preview mode
		await this.openCardInPreview(firstCard.path);
	}

	/**
	 * End the current review session.
	 */
	endSession(): void {
		this.session = null;
		this.sessionLeaf = null;
		// Remove body class for CSS-based content hiding
		document.body.classList.remove("anker-review-session-active");
		document.body.classList.remove("anker-review-card-loading");
		debugLog("review: session ended");
		this.trigger("session-ended");
	}

	/**
	 * Reveal the next side of the current card.
	 */
	revealNext(): void {
		if (!this.session) return;

		if (this.session.currentSide < this.session.totalSides - 1) {
			this.session.currentSide++;
			this.trigger("side-revealed", this.session);
		}
	}

	/**
	 * Check if the current card is on its last side.
	 */
	isLastSide(): boolean {
		if (!this.session) return false;
		return this.session.currentSide >= this.session.totalSides - 1;
	}

	/**
	 * Get the next states for rating buttons.
	 */
	getNextStates(): {
		again: { interval: string };
		hard: { interval: string };
		good: { interval: string };
		easy: { interval: string };
	} | null {
		if (!this.session) return null;

		const card = this.session.cards.find(
			(c) => c.path === this.session!.currentCardPath,
		);
		if (!card) return null;

		return this.scheduler.getNextStates(card.frontmatter._review);
	}

	/**
	 * Rate the current card and move to the next one.
	 */
	async rateCard(rating: Rating): Promise<void> {
		if (!this.session) return;

		const card = this.session.cards.find(
			(c) => c.path === this.session!.currentCardPath,
		);
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		let newState: ReviewState | null = null;

		if (file instanceof TFile) {
			const reviewResult = this.scheduler.review(
				card.frontmatter._review,
				rating,
			);
			newState = reviewResult.state;

			await this.cardService.updateReviewState(file, reviewResult.state);

			// Persist review log entry
			await this.reviewLogStore.addEntry(card.id, reviewResult.logEntry);
		}

		this.session.reviewsPerformed++;

		const isDue = newState ? this.deckService.isReviewDue(newState) : false;

		if (newState && !isDue) {
			this.session.reviewedCount++;
		}

		// Get fresh due cards
		let nextDueCards = await this.deckService.getDueCardsFresh(
			this.session.deckPath,
		);

		// Filter out the current card if it's no longer due
		if (newState && !isDue) {
			nextDueCards = nextDueCards.filter((c) => c.path !== card.path);
		}

		if (nextDueCards.length === 0) {
			this.session = null;
			document.body.classList.remove("anker-review-session-active");
			document.body.classList.remove("anker-review-card-loading");
			debugLog("review: session complete");
			this.trigger("session-complete");
			return;
		}

		// Find next card
		const currentIndex = nextDueCards.findIndex(
			(c) => c.path === card.path,
		);
		const nextIndex =
			currentIndex >= 0 ? (currentIndex + 1) % nextDueCards.length : 0;
		const nextCard = nextDueCards[nextIndex];
		if (!nextCard) return;

		// Update session
		this.session.cards = nextDueCards;
		this.session.currentCardPath = nextCard.path;
		this.session.currentSide = 0;

		// Load sides for new card
		const nextFile = this.app.vault.getAbstractFileByPath(nextCard.path);
		if (nextFile instanceof TFile) {
			const sides = await this.getCardSides(nextFile);
			this.session.totalSides = sides.length;
		}

		this.trigger("card-changed", this.session);
		debugLog("review: card changed", nextCard.path);

		// Open the next card
		await this.openCardInPreview(nextCard.path);
	}

	/**
	 * Update session when the user navigates to a flashcard file.
	 * Only relevant if a session is active.
	 */
	async handleFileNavigation(filePath: string): Promise<void> {
		if (!this.session) return;

		// Check if this file is in the current session's due cards
		const card = this.session.cards.find((c) => c.path === filePath);
		if (!card) return;

		// Update current card in session
		this.session.currentCardPath = filePath;
		this.session.currentSide = 0;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const sides = await this.getCardSides(file);
			this.session.totalSides = sides.length;
		}

		this.trigger("card-changed", this.session);
	}

	/**
	 * Open a card file in preview mode in the active leaf.
	 */
	private async openCardInPreview(cardPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(cardPath);
		if (!(file instanceof TFile)) return;

		// Get the active leaf or create one
		let leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
		}

		// Track the session leaf for cleanup
		this.sessionLeaf = leaf;

		document.body.classList.add("anker-review-card-loading");
		debugLog("review: open card", cardPath);
		await leaf.openFile(file, { state: { mode: "preview" } });
	}

	/**
	 * Get progress as a percentage (0-100).
	 */
	getProgress(): number {
		if (!this.session) return 0;
		return (this.session.reviewedCount / this.session.initialTotal) * 100;
	}
}
