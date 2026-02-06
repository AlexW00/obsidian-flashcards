import {
	App,
	ButtonComponent,
	MarkdownView,
	TFile,
	Component,
	setIcon,
	Menu,
} from "obsidian";
import type { ReviewSession } from "../services/ReviewSessionManager";
import { ReviewSessionManager } from "../services/ReviewSessionManager";
import { Rating } from "../srs/Scheduler";
import type AnkerPlugin from "../main";
import { debugLog } from "../types";

/**
 * Component that decorates flashcard notes in preview mode.
 * Handles side-by-side reveal and injects review controls when in review mode.
 */
export class FlashcardPreviewComponent extends Component {
	private plugin: AnkerPlugin;
	private app: App;
	private sessionManager: ReviewSessionManager;

	// Track decorated views to avoid duplicates
	private decoratedLeaves = new WeakSet<MarkdownView>();
	private renderObservers = new WeakMap<HTMLElement, MutationObserver>();

	constructor(plugin: AnkerPlugin, sessionManager: ReviewSessionManager) {
		super();
		this.plugin = plugin;
		this.app = plugin.app;
		this.sessionManager = sessionManager;
	}

	onload(): void {
		// Listen for layout changes to decorate new views
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.decorateFlashcardViews();
			}),
		);

		// Listen for active leaf changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.decorateFlashcardViews();
			}),
		);

		// Listen for file opens
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) {
					this.decorateFlashcardViews();
				}
			}),
		);

		// Listen to session manager events
		this.registerSessionEvents();

		// Initial decoration
		this.app.workspace.onLayoutReady(() => {
			this.decorateFlashcardViews();
		});
	}

	private registerSessionEvents(): void {
		const manager = this.sessionManager;

		this.registerEvent(
			manager.on("session-started", () => {
				this.decorateFlashcardViews();
			}),
		);

		this.registerEvent(
			manager.on("session-ended", () => {
				this.decorateFlashcardViews();
			}),
		);

		this.registerEvent(
			manager.on("side-revealed", () => {
				this.decorateFlashcardViews();
			}),
		);

		this.registerEvent(
			manager.on("card-changed", () => {
				this.decorateFlashcardViews();
			}),
		);

		this.registerEvent(
			manager.on("session-complete", () => {
				this.showSessionComplete();
			}),
		);
	}

	/**
	 * Find all markdown views displaying flashcards and decorate them.
	 */
	private decorateFlashcardViews(): void {
		const markdownViews = this.app.workspace.getLeavesOfType("markdown");

		for (const leaf of markdownViews) {
			const view = leaf.view as MarkdownView;
			const file = view.file;

			if (!file) continue;

			// Check if this is a flashcard
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?._type !== "flashcard") {
				// Not a flashcard - remove any existing decorations
				this.removeDecorations(view);
				continue;
			}

			// Decorate this flashcard view
			this.decorateView(view, file);
		}
	}

	/**
	 * Decorate a single markdown view with flashcard UI.
	 */
	private decorateView(view: MarkdownView, file: TFile): void {
		const container = view.containerEl;
		const contentEl = container.querySelector(
			".markdown-reading-view",
		) as HTMLElement;
		if (!contentEl) return;

		const session = this.sessionManager.getSession();
		const sessionLeaf = this.sessionManager.getSessionLeaf();
		// Only show review mode if this is the tracked session leaf AND the file matches
		const isReviewing =
			session !== null &&
			session.currentCardPath === file.path &&
			sessionLeaf !== null &&
			view.leaf === sessionLeaf;

		this.updateReviewTabIndicator(view, isReviewing);

		// Create or get the flashcard wrapper
		let wrapper = container.querySelector(
			".anker-flashcard-wrapper",
		) as HTMLElement;

		if (!wrapper) {
			wrapper = document.createElement("div");
			wrapper.className = "anker-flashcard-wrapper";
			contentEl.parentElement?.insertBefore(wrapper, contentEl);
			wrapper.appendChild(contentEl);
		}

		// Update review mode class
		wrapper.classList.toggle("anker-review-active", isReviewing);

		// Handle progress and controls
		if (isReviewing && session) {
			this.renderProgressBar(wrapper, session);
			this.renderContent(wrapper, file, session);
			this.renderControls(wrapper, session);
		} else {
			// Normal view - remove review UI and show all content
			this.removeProgressBar(wrapper);
			this.removeControls(wrapper);
			this.showAllContent(wrapper);
		}
	}

	/**
	 * Remove decorations from a view.
	 */
	private removeDecorations(view: MarkdownView): void {
		this.updateReviewTabIndicator(view, false);

		const container = view.containerEl;
		const wrapper = container.querySelector(
			".anker-flashcard-wrapper",
		) as HTMLElement;
		if (!wrapper) return;

		// Move content out of wrapper
		const contentEl = wrapper.querySelector(
			".markdown-reading-view",
		) as HTMLElement;
		if (contentEl) {
			wrapper.parentElement?.insertBefore(contentEl, wrapper);
		}

		// Remove wrapper and UI elements
		wrapper.remove();
	}

	private updateReviewTabIndicator(
		view: MarkdownView,
		isReviewing: boolean,
	): void {
		const leaf = view.leaf;
		const tabHeaderEl = (leaf as { tabHeaderEl?: HTMLElement })
			?.tabHeaderEl;
		if (!tabHeaderEl) return;

		tabHeaderEl.classList.toggle("anker-review-tab", isReviewing);
	}

	/**
	 * Render the progress bar at the top.
	 */
	private renderProgressBar(
		wrapper: HTMLElement,
		session: ReviewSession,
	): void {
		let header = wrapper.querySelector(
			".anker-review-header",
		) as HTMLElement;

		if (!header) {
			header = document.createElement("div");
			header.className = "anker-review-header";
			wrapper.insertBefore(header, wrapper.firstChild);
		}

		header.empty();

		// Progress info
		const completedCount = Math.min(
			session.reviewedCount,
			session.initialTotal,
		);
		const progress = (completedCount / session.initialTotal) * 100;

		const progressBar = header.createDiv({ cls: "flashcard-progress-bar" });
		const fill = progressBar.createDiv({ cls: "flashcard-progress-fill" });
		fill.style.width = `${progress}%`;

		// Progress text
		const reviewsText =
			session.reviewsPerformed > completedCount
				? `${completedCount} / ${session.initialTotal} completed (${session.reviewsPerformed} reviews)`
				: `${completedCount} / ${session.initialTotal} completed`;
		header.createSpan({
			text: reviewsText,
			cls: "flashcard-progress-text",
		});

		// Menu button
		const menuButton = header.createDiv({
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
					.setTitle("End review session")
					.setIcon("x")
					.onClick(() => this.sessionManager.endSession()),
			);
			menu.showAtMouseEvent(event);
		});
	}

	/**
	 * Remove progress bar.
	 */
	private removeProgressBar(wrapper: HTMLElement): void {
		wrapper.querySelector(".anker-review-header")?.remove();
	}

	/**
	 * Control content visibility based on current side.
	 * Uses the native preview and hides content after the current side's <hr> separator.
	 */
	private renderContent(
		wrapper: HTMLElement,
		file: TFile,
		session: ReviewSession,
	): void {
		const contentEl = wrapper.querySelector(
			".markdown-reading-view",
		) as HTMLElement;
		if (!contentEl) return;

		const previewEl = contentEl.querySelector(
			".markdown-preview-view",
		) as HTMLElement;
		if (!previewEl) return;

		// Remove any custom card content from previous implementation
		wrapper.querySelector(".anker-card-content")?.remove();

		// Make sure native preview is visible
		previewEl.removeClass("anker-hidden");

		// Find the content container (usually .markdown-preview-sizer)
		const sizerEl = previewEl.querySelector(
			".markdown-preview-sizer",
		) as HTMLElement;
		if (!sizerEl) return;

		if (!this.renderObservers.has(sizerEl)) {
			const observer = new MutationObserver(() => {
				observer.disconnect();
				this.renderObservers.delete(sizerEl);
				this.decorateFlashcardViews();
			});
			observer.observe(sizerEl, { childList: true, subtree: true });
			this.renderObservers.set(sizerEl, observer);
		}

		// Keep the preview hidden while we decorate to prevent flicker.
		document.body.classList.add("anker-review-card-loading");

		// Ensure content is hidden until this pass completes
		sizerEl.classList.remove("anker-decorated");
		debugLog("review: decorate start", session.currentCardPath);

		// Hide frontmatter/metadata and inline title during review
		const metadataContainer = sizerEl.querySelector(
			".metadata-container",
		) as HTMLElement;
		if (metadataContainer) {
			metadataContainer.classList.add("anker-hidden-side");
		}

		const inlineTitle = sizerEl.querySelector(
			".inline-title",
		) as HTMLElement;
		if (inlineTitle) {
			inlineTitle.classList.add("anker-hidden-side");
		}

		// Get all direct children of the sizer (excluding metadata and title)
		const sectionEls = Array.from(
			sizerEl.querySelectorAll(":scope > .markdown-preview-section"),
		);
		const children = sectionEls.length
			? sectionEls.flatMap(
					(section) => Array.from(section.children) as HTMLElement[],
				)
			: (Array.from(sizerEl.children) as HTMLElement[]);

		if (children.length === 0) {
			return;
		}

		const findHrElement = (child: HTMLElement): HTMLElement | null => {
			if (child.tagName === "HR") {
				return child;
			}
			return child.querySelector(":scope > hr");
		};

		// Group children into sides based on <hr> positions
		let currentSideIndex = 0;
		let hasSeenContent = false;
		let separatorCount = 0;

		for (const child of children) {
			// Skip metadata and title (already hidden above)
			if (
				child.classList.contains("metadata-container") ||
				child.classList.contains("inline-title")
			) {
				continue;
			}

			// Check if this is an HR (side separator)
			const directHr = findHrElement(child);
			const isHr = directHr !== null;

			if (isHr) {
				if (!hasSeenContent) {
					// Ignore leading separators to avoid an empty first side
					child.classList.add("anker-hidden-side");
					continue;
				}
				separatorCount++;
				currentSideIndex++;
				// Style the HR as a side separator
				directHr?.classList.add("flashcard-side-separator");
			}

			// Determine visibility based on showOnlyCurrentSide setting
			const shouldShow = this.plugin.settings.showOnlyCurrentSide
				? currentSideIndex === session.currentSide
				: currentSideIndex <= session.currentSide;

			if (shouldShow) {
				child.classList.remove("anker-hidden-side");
			} else {
				child.classList.add("anker-hidden-side");
			}

			if (!isHr) {
				hasSeenContent = true;
			}
		}

		const totalSides = separatorCount + 1;
		if (session.totalSides !== totalSides) {
			session.totalSides = totalSides;
		}

		// Add click handler to content area for revealing next side
		contentEl.onclick = (e) => {
			// Don't trigger on links or interactive elements
			const target = e.target as HTMLElement;
			if (
				target.closest("a") ||
				target.closest("button") ||
				target.closest("input")
			) {
				return;
			}

			if (!this.sessionManager.isLastSide()) {
				this.sessionManager.revealNext();
			}
		};

		// Mark sizer as decorated to reveal content (prevents flicker)
		sizerEl.classList.add("anker-decorated");
		document.body.classList.remove("anker-review-card-loading");
		debugLog("review: decorate end", session.currentCardPath);
	}

	/**
	 * Show all content (non-review mode).
	 */
	private showAllContent(wrapper: HTMLElement): void {
		// Remove custom card content if any
		wrapper.querySelector(".anker-card-content")?.remove();

		// Show original preview
		const previewEl = wrapper.querySelector(
			".markdown-preview-view",
		) as HTMLElement;
		if (previewEl) {
			previewEl.removeClass("anker-hidden");
		}

		// Remove all hidden-side classes and separator styling from content
		const sizerEl = previewEl?.querySelector(
			".markdown-preview-sizer",
		) as HTMLElement;
		if (sizerEl) {
			// Remove decoration marker
			sizerEl.classList.remove("anker-decorated");

			const observer = this.renderObservers.get(sizerEl);
			if (observer) {
				observer.disconnect();
				this.renderObservers.delete(sizerEl);
			}

			// Remove hidden class from all elements
			const hiddenElements =
				sizerEl.querySelectorAll(".anker-hidden-side");
			for (const el of Array.from(hiddenElements)) {
				el.classList.remove("anker-hidden-side");
			}

			// Remove separator styling
			const separators = sizerEl.querySelectorAll(
				".flashcard-side-separator",
			);
			for (const el of Array.from(separators)) {
				el.classList.remove("flashcard-side-separator");
			}
		}

		// Remove click handler
		const contentEl = wrapper.querySelector(
			".markdown-reading-view",
		) as HTMLElement;
		if (contentEl) {
			contentEl.onclick = null;
		}
	}

	/**
	 * Render review controls at the bottom.
	 */
	private renderControls(wrapper: HTMLElement, session: ReviewSession): void {
		let footer = wrapper.querySelector(
			".anker-review-footer",
		) as HTMLElement;

		if (!footer) {
			footer = document.createElement("div");
			footer.className = "anker-review-footer";
			wrapper.appendChild(footer);
		}

		footer.empty();

		const isLastSide = session.currentSide >= session.totalSides - 1;

		if (!isLastSide) {
			// Show "Reveal" button
			new ButtonComponent(footer)
				.setButtonText("Show answer")
				.setCta()
				.setClass("flashcard-btn-reveal")
				.onClick(() => {
					this.sessionManager.revealNext();
				});

			footer.createDiv({
				cls: "flashcard-hint",
				text: "Tap or Space to show answer",
			});
		} else {
			// Show rating buttons
			this.renderRatingButtons(footer);
		}
	}

	/**
	 * Render rating buttons.
	 */
	private renderRatingButtons(container: HTMLElement): void {
		const nextStates = this.sessionManager.getNextStates();
		if (!nextStates) return;

		const buttonsContainer = container.createDiv({
			cls: "flashcard-rating-buttons",
		});

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
				.onClick(() => {
					void this.sessionManager.rateCard(rating);
				});
			btnWrapper.createSpan({
				text: interval,
				cls: "flashcard-interval",
			});
		};

		createRatingButton(
			"Again (1)",
			nextStates.again.interval,
			Rating.Again,
			"flashcard-btn-again",
		);
		createRatingButton(
			"Hard (2)",
			nextStates.hard.interval,
			Rating.Hard,
			"flashcard-btn-hard",
		);
		createRatingButton(
			"Good (3)",
			nextStates.good.interval,
			Rating.Good,
			"flashcard-btn-good",
		);
		createRatingButton(
			"Easy (4)",
			nextStates.easy.interval,
			Rating.Easy,
			"flashcard-btn-easy",
		);
	}

	/**
	 * Remove controls.
	 */
	private removeControls(wrapper: HTMLElement): void {
		wrapper.querySelector(".anker-review-footer")?.remove();
	}

	/**
	 * Show session complete message.
	 */
	private showSessionComplete(): void {
		// Get active leaf and show completion
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeLeaf) return;

		const container = activeLeaf.containerEl;
		let wrapper = container.querySelector(
			".anker-flashcard-wrapper",
		) as HTMLElement;

		// If no wrapper exists, create one around the reading view
		if (!wrapper) {
			const contentEl = container.querySelector(
				".markdown-reading-view",
			) as HTMLElement;
			if (!contentEl) return;

			wrapper = document.createElement("div");
			wrapper.className = "anker-flashcard-wrapper";
			contentEl.parentElement?.insertBefore(wrapper, contentEl);
			wrapper.appendChild(contentEl);
		}

		// Remove any existing completion overlay
		wrapper.querySelector(".anker-review-complete-overlay")?.remove();

		// Hide the native preview content
		const readingView = wrapper.querySelector(
			".markdown-reading-view",
		) as HTMLElement;
		if (readingView) {
			readingView.classList.add("anker-hidden");
		}

		// Create completion overlay
		const overlay = wrapper.createDiv({
			cls: "anker-review-complete-overlay",
		});

		const completeState = overlay.createDiv({
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
				// Clean up overlay before navigating
				overlay.remove();
				if (readingView) {
					readingView.classList.remove("anker-hidden");
				}
				void this.plugin.openDashboard();
			});

		// Remove controls and progress bar
		this.removeControls(wrapper);
		this.removeProgressBar(wrapper);
	}
}
