import {
	ButtonComponent,
	ItemView,
	MarkdownRenderer,
	Menu,
	Scope,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";
import type AnkerPlugin from "../main";
import type { Flashcard, ReviewState } from "../types";
import { Rating } from "../srs/Scheduler";
import { registerReviewHotkeys } from "./ReviewHotkeys";

export const REVIEW_VIEW_TYPE = "anker-review";

interface ReviewSession {
	deckPath: string;
	cards: Flashcard[];
	currentIndex: number;
	currentSide: number;
	totalSides: number;
	initialTotal: number;
	reviewedCount: number;
	reviewsPerformed: number;
}

/**
 * Review view for studying flashcards.
 */
export class ReviewView extends ItemView {
	plugin: AnkerPlugin;
	private session: ReviewSession | null = null;
	private currentContent: string[] = [];
	private debouncedReloadCard: () => void;

	// State tracking for partial updates
	private lastRenderedIndex = -1;
	private lastRenderedSide = -1;
	private lastCardPath = "";

	constructor(leaf: WorkspaceLeaf, plugin: AnkerPlugin) {
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
			openCurrentCard: () => this.openCurrentCard(),
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
		this.render();
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
		// Force full re-render for this card
		this.lastCardPath = "";
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
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:startSession] deckPath=${deckPath}, dueCards=${dueCards.length}`,
		);
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:startSession] cards:`,
			dueCards.map((c) => ({
				path: c.path,
				due: c.frontmatter._review?.due,
				state: c.frontmatter._review?.state,
			})),
		);

		if (dueCards.length === 0) {
			// eslint-disable-next-line no-console
			console.log(`[Anker:startSession] no due cards, showing complete`);
			this.renderComplete();
			return;
		}

		this.session = {
			deckPath,
			cards: dueCards,
			currentIndex: 0,
			currentSide: 0,
			totalSides: 0,
			initialTotal: dueCards.length,
			reviewedCount: 0,
			reviewsPerformed: 0,
		};

		// Reset state
		this.lastRenderedIndex = -1;
		this.lastRenderedSide = -1;
		this.lastCardPath = "";

		await this.loadCurrentCard();
		console.debug(
			`[Anker:startSession] loadCurrentCard done, totalSides=${this.session.totalSides}, contentSides=${this.currentContent.length}`,
		);
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

		if (!this.session) {
			this.renderEmpty(container);
			return;
		}

		container.addClass("flashcard-review");
		// Remove empty state class if present from previous renders
		container.removeClass("flashcard-empty-state-container");

		// Ensure persistent structure exists
		let progressContainer = container.querySelector(
			".flashcard-review-progress",
		) as HTMLElement;
		let cardContainer = container.querySelector(
			".flashcard-card-container",
		) as HTMLElement;
		let controlsContainer = container.querySelector(
			".flashcard-controls",
		) as HTMLElement;

		if (!progressContainer || !cardContainer || !controlsContainer) {
			container.empty();

			progressContainer = container.createDiv({
				cls: "flashcard-review-progress",
			});

			const scrollWrapper = container.createDiv({
				cls: "flashcard-scroll-wrapper",
			});
			// Fades
			scrollWrapper.createDiv({ cls: "flashcard-fade-top" });
			cardContainer = scrollWrapper.createDiv({
				cls: "flashcard-card-container",
			});
			cardContainer.addEventListener("click", () => {
				if (!this.session) return;
				if (this.session.currentSide < this.session.totalSides - 1) {
					this.revealNext();
				}
			});
			scrollWrapper.createDiv({ cls: "flashcard-fade-bottom" });

			controlsContainer = container.createDiv({
				cls: "flashcard-controls",
			});
		}

		const currentCard = this.session.cards[this.session.currentIndex];
		if (!currentCard) {
			this.renderEmpty(container);
			return;
		}

		this.renderProgress(progressContainer);
		this.renderCard(cardContainer, currentCard);
		this.renderControls(controlsContainer, currentCard);

		// Update tracking state
		this.lastRenderedIndex = this.session.currentIndex;
		this.lastRenderedSide = this.session.currentSide;
		this.lastCardPath = currentCard.path;
	}

	private renderProgress(container: HTMLElement) {
		if (!this.session) return;

		container.empty();

		const completedCount = Math.min(
			this.session.reviewedCount,
			this.session.initialTotal,
		);
		const progress = (completedCount / this.session.initialTotal) * 100;
		const progressBar = container.createDiv({
			cls: "flashcard-progress-bar",
		});
		progressBar.createDiv({
			cls: "flashcard-progress-fill",
		}).style.width = `${progress}%`;

		// Show reviews performed along with cards completed
		const reviewsText =
			this.session.reviewsPerformed > completedCount
				? `${completedCount} / ${this.session.initialTotal} completed (${this.session.reviewsPerformed} reviews)`
				: `${completedCount} / ${this.session.initialTotal} completed`;
		container.createSpan({
			text: reviewsText,
			cls: "flashcard-progress-text",
		});
		const menuButton = container.createDiv({
			cls: "flashcard-review-menu",
			attr: {
				"aria-label": "More actions",
				role: "button",
				tabindex: "0",
			},
		});
		setIcon(menuButton, "more-horizontal");
		menuButton.addEventListener("click", (event) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Edit card")
					.setIcon("pencil")
					.onClick(() => void this.editCurrentCard()),
			);
			menu.addItem((item) =>
				item
					.setTitle("Open note")
					.setIcon("file-text")
					.onClick(() => void this.openCurrentCard()),
			);
			menu.showAtMouseEvent(event);
		});
	}

	private renderCard(container: HTMLElement, currentCard: Flashcard) {
		if (!this.session) return;

		const isNewCard =
			this.session.currentIndex !== this.lastRenderedIndex ||
			currentCard.path !== this.lastCardPath;
		const isNextSide =
			!isNewCard && this.session.currentSide > this.lastRenderedSide;
		const showOnlyCurrentSide = this.plugin.settings.showOnlyCurrentSide;

		let cardEl = container.querySelector(".flashcard-card") as HTMLElement;

		if (isNewCard || showOnlyCurrentSide || !cardEl) {
			// Full render
			container.empty();
			cardEl = container.createDiv({ cls: "flashcard-card" });

			if (showOnlyCurrentSide) {
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

					if (i < this.session.currentSide) {
						cardEl.createEl("hr", {
							cls: "flashcard-side-separator",
						});
					}
				}
			}
			// Reset scroll for new card content
			container.scrollTop = 0;
		} else if (isNextSide) {
			// Incremental append
			for (
				let i = this.lastRenderedSide + 1;
				i <= this.session.currentSide;
				i++
			) {
				const sideContent = this.currentContent[i] || "";

				// Append separator before new content
				cardEl.createEl("hr", { cls: "flashcard-side-separator" });

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
			}

			// Scroll down smoothly to show new content
			setTimeout(() => {
				container.scrollTo({
					top: container.scrollHeight,
					behavior: "smooth",
				});
			}, 0);
		}
	}

	private renderControls(container: HTMLElement, currentCard: Flashcard) {
		if (!this.session) return;
		container.empty();

		const actionsContainer = container.createDiv({
			cls: "flashcard-actions",
		});

		const isLastSide =
			this.session.currentSide >= this.session.totalSides - 1;

		console.debug(
			`[Anker:renderControls] card=${currentCard.path}, currentSide=${this.session.currentSide}, totalSides=${this.session.totalSides}, isLastSide=${isLastSide}`,
		);

		if (!isLastSide) {
			// Show "Reveal" button
			new ButtonComponent(actionsContainer)
				.setButtonText("Show answer")
				.setCta()
				.setClass("flashcard-btn-reveal")
				.onClick(() => {
					console.debug(`[Anker:revealBtn] onClick fired`);
					this.revealNext();
				});
			actionsContainer.createDiv({
				cls: "flashcard-hint",
				text: "Tap or Space to show answer • E to edit • O to open",
			});
		} else {
			// Show rating buttons
			this.renderRatingButtons(actionsContainer, currentCard);
		}
	}

	private renderRatingButtons(container: HTMLElement, card: Flashcard) {
		if (!this.session) return;

		const reviewState = card.frontmatter._review;
		const nextStates = this.plugin.scheduler.getNextStates(reviewState);
		console.debug(
			`[Anker:renderRatingButtons] card=${card.path}, reviewState=`,
			reviewState,
		);

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
			const btnComponent = new ButtonComponent(btnWrapper)
				.setButtonText(label)
				.setClass(className)
				.onClick(() => {
					console.debug(
						`[Anker:ratingBtnClick] ${className} onClick fired, rating=${rating}`,
					);
					void this.rateCard(rating);
				});
			console.debug(
				`[Anker:renderRatingButtons] created ${className} button, el=`,
				btnComponent.buttonEl?.tagName,
				`classes=`,
				btnComponent.buttonEl?.className,
			);
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
		console.debug(
			`[Anker:revealNext] called, session=`,
			this.session
				? `side=${this.session.currentSide}/${this.session.totalSides}`
				: "null",
		);
		if (!this.session) return;

		if (this.session.currentSide < this.session.totalSides - 1) {
			this.session.currentSide++;
			this.render();
		}
	}

	private async rateCard(rating: Rating) {
		const rateStartTime = Date.now();
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] START t=0ms rating=${rating}, session=`,
			this.session
				? `idx=${this.session.currentIndex}, reviewed=${this.session.reviewedCount}, initialTotal=${this.session.initialTotal}`
				: "null",
		);
		if (!this.session) {
			// eslint-disable-next-line no-console
			console.log(`[Anker:rateCard] ABORT: no session`);
			return;
		}

		const card = this.session.cards[this.session.currentIndex];
		if (!card) {
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] ABORT: no card at index ${this.session.currentIndex}`,
			);
			return;
		}

		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] card=${card.path}, id=${card.id}, sessionCards=${this.session.cards.length}`,
		);
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] card frontmatter._review BEFORE:`,
			JSON.stringify(card.frontmatter._review),
		);

		const file = this.app.vault.getAbstractFileByPath(card.path);
		let newState: ReviewState | null = null;

		if (file instanceof TFile) {
			// Check metadata cache state BEFORE update
			const cacheBefore =
				this.app.metadataCache.getFileCache(file)?.frontmatter;
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] t=${Date.now() - rateStartTime}ms metadataCache BEFORE update:`,
				JSON.stringify(cacheBefore?._review),
			);

			const reviewResult = this.plugin.scheduler.review(
				card.frontmatter._review,
				rating,
			);
			newState = reviewResult.state;
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] t=${Date.now() - rateStartTime}ms newState due=${newState.due}, state=${newState.state}`,
			);
			await this.plugin.cardService.updateReviewState(
				file,
				reviewResult.state,
			);
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] t=${Date.now() - rateStartTime}ms updateReviewState done`,
			);

			// Persist review log entry to centralized store
			await this.plugin.reviewLogStore.addEntry(
				card.id,
				reviewResult.logEntry,
			);
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] t=${Date.now() - rateStartTime}ms addEntry done`,
			);
		} else {
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] file NOT found or not TFile for path=${card.path}`,
			);
		}

		const isDue = newState
			? this.plugin.deckService.isReviewDue(newState)
			: null;
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] t=${Date.now() - rateStartTime}ms isDue=${isDue} (based on newState, not cache)`,
		);

		// Always increment reviewsPerformed when any rating is made
		this.session.reviewsPerformed++;

		if (newState && !isDue) {
			this.session.reviewedCount++;
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] reviewedCount incremented to ${this.session.reviewedCount}/${this.session.initialTotal}`,
			);
		}

		// Use fresh read from disk to avoid stale metadata cache
		let nextDueCards = await this.plugin.deckService.getDueCardsFresh(
			this.session.deckPath,
		);
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] t=${Date.now() - rateStartTime}ms getDueCardsFresh returned ${nextDueCards.length} cards: [${nextDueCards.map((c) => c.path).join(", ")}]`,
		);

		if (newState && !isDue) {
			nextDueCards = nextDueCards.filter(
				(nextCard) => nextCard.path !== card.path,
			);
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] filtered out ${card.path} (not due), remaining: ${nextDueCards.length}`,
			);
		}

		if (nextDueCards.length === 0) {
			// eslint-disable-next-line no-console
			console.log(
				`[Anker:rateCard] t=${Date.now() - rateStartTime}ms no cards left, rendering complete`,
			);
			this.renderComplete();
			return;
		}

		const currentPath = card.path;
		const currentIndexInNext = nextDueCards.findIndex(
			(nextCard) => nextCard.path === currentPath,
		);

		const nextIndex =
			currentIndexInNext >= 0
				? (currentIndexInNext + 1) % nextDueCards.length
				: 0;

		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] t=${Date.now() - rateStartTime}ms nextIndex=${nextIndex}, nextCard=${nextDueCards[nextIndex]?.path}`,
		);
		this.session.cards = nextDueCards;
		this.session.currentIndex = nextIndex;
		await this.loadCurrentCard();
		this.render();
		// eslint-disable-next-line no-console
		console.log(
			`[Anker:rateCard] END - render complete, reviewedCount=${this.session?.reviewedCount}/${this.session?.initialTotal}, sessionCards=${this.session?.cards.length}`,
		);
	}

	private async editCurrentCard() {
		if (!this.session) return;

		const card = this.session.cards[this.session.currentIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);

		if (file instanceof TFile) {
			await this.plugin.editCard(file);
		}
	}

	private async openCurrentCard() {
		if (!this.session) return;

		const card = this.session.cards[this.session.currentIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf("tab").openFile(file);
		}
	}

	private renderEmpty(container: HTMLElement) {
		if (!container) return;
		container.empty();
		container.addClass("flashcard-review");
		container.addClass("flashcard-empty-state-container");

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
