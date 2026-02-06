import { browser } from "@wdio/globals";
import type {
	ObsidianAppLike,
	ReviewSessionState,
} from "../helpers/obsidianTypes";

/**
 * CSS selectors for the native review system.
 * The review UI decorates native Markdown preview with these classes.
 */
export const REVIEW_SELECTORS = {
	/** Main wrapper around the note content during review */
	wrapper: ".anker-flashcard-wrapper",
	/** Active review state (wrapper has this when reviewing) */
	activeWrapper: ".anker-flashcard-wrapper.anker-review-active",
	/** Header containing progress bar */
	header: ".anker-review-header",
	/** Footer containing controls (reveal button, rating buttons) */
	footer: ".anker-review-footer",
	/** "Show answer" button - the button has the class directly */
	revealButton: ".anker-review-footer button.flashcard-btn-reveal",
	/** Container for rating buttons */
	ratingButtons: ".anker-review-footer .flashcard-rating-buttons",
	/** Individual rating buttons - ButtonComponent applies class to the button */
	againButton: ".anker-review-footer button.flashcard-btn-again",
	hardButton: ".anker-review-footer button.flashcard-btn-hard",
	goodButton: ".anker-review-footer button.flashcard-btn-good",
	easyButton: ".anker-review-footer button.flashcard-btn-easy",
	/** Progress text showing "X / Y completed" */
	progressText: ".flashcard-progress-text",
	/** Session complete overlay */
	completeOverlay: ".anker-review-complete-overlay",
	/** Menu button in header */
	menuButton: ".flashcard-review-menu",
	/** Tab indicator class */
	tabIndicator: ".anker-review-tab",
	/** Body class during active session */
	bodySessionActive: "body.anker-review-session-active",
	/** Hint text ("Tap or Space to show answer") */
	hint: ".flashcard-hint",
	/** Modal background overlay */
	modalBg: ".modal-bg",
	/** Modal container */
	modal: ".modal",
} as const;

/**
 * Wait for the review UI to become active.
 * This replaces waiting for the old `.flashcard-review` view.
 */
export async function waitForReviewActive(
	timeout: number = 10000,
): Promise<void> {
	const wrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
	await wrapper.waitForExist({
		timeout,
		timeoutMsg: "Review wrapper did not become active",
	});
}

/**
 * Check if a review session is currently active.
 */
export async function isSessionActive(): Promise<boolean> {
	return await browser.executeObsidian(({ app }) => {
		const obsidianApp = app as ObsidianAppLike;
		const plugin = obsidianApp.plugins?.getPlugin?.("anker");
		return plugin?.reviewSessionManager?.isSessionActive() ?? false;
	});
}

/**
 * Get the current review session state.
 */
export async function getSessionState(): Promise<ReviewSessionState | null> {
	return await browser.executeObsidian(({ app }) => {
		const obsidianApp = app as ObsidianAppLike;
		const plugin = obsidianApp.plugins?.getPlugin?.("anker");
		const session = plugin?.reviewSessionManager?.getSession();
		if (!session) return null;
		return {
			deckPath: session.deckPath,
			currentCardPath: session.currentCardPath,
			currentSide: session.currentSide,
			totalSides: session.totalSides,
			initialTotal: session.initialTotal,
			reviewedCount: session.reviewedCount,
			reviewsPerformed: session.reviewsPerformed,
		};
	});
}

/**
 * End the current review session programmatically.
 */
export async function endSession(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const obsidianApp = app as ObsidianAppLike;
		const plugin = obsidianApp.plugins?.getPlugin?.("anker");
		plugin?.reviewSessionManager?.endSession();
	});
}

/**
 * Close any open modal by pressing Escape.
 */
export async function closeModal(): Promise<void> {
	const modal = browser.$(REVIEW_SELECTORS.modal);
	if (await modal.isExisting()) {
		await browser.keys(["Escape"]);
		// Wait for modal to close
		await browser
			.waitUntil(async () => !(await modal.isExisting()), {
				timeout: 3000,
			})
			.catch(() => {
				// Modal might already be closed
			});
	}
}

/**
 * Start a review session for a deck.
 * If a session is already active, ends it first to avoid modal prompts.
 * Includes a workaround for a race condition where session-started fires
 * before the reading view is fully ready.
 */
export async function startReviewSession(deckPath: string): Promise<void> {
	// End any existing session first to avoid confirmation modal
	if (await isSessionActive()) {
		await endSession();
		await browser.pause(100);
	}

	// Close any modal that might be open
	await closeModal();

	await browser.executeObsidian(async ({ app }, path) => {
		const obsidianApp = app as ObsidianAppLike;
		const plugin = obsidianApp.plugins?.getPlugin?.("anker");
		if (plugin?.startReview) {
			await plugin.startReview(path);
		}
	}, deckPath);

	// Wait for reading view to be ready and force re-decoration.
	// This handles the race condition where session-started fires before
	// the markdown preview is fully rendered.
	await browser.waitUntil(
		async () => {
			return await browser.executeObsidian(({ app }) => {
				const obsidianApp = app as ObsidianAppLike;
				const readingView = document.querySelector(
					".markdown-reading-view",
				);
				if (!readingView) return false;

				// Force re-decoration
				const plugin = obsidianApp.plugins?.getPlugin?.("anker");
				const previewComponent = (
					plugin as unknown as {
						flashcardPreviewComponent?: {
							decorateFlashcardViews: () => void;
						};
					}
				)?.flashcardPreviewComponent;
				previewComponent?.decorateFlashcardViews?.();

				// Check if decoration was applied
				return (
					document.querySelector(
						".anker-flashcard-wrapper.anker-review-active",
					) !== null
				);
			});
		},
		{
			timeout: 10000,
			interval: 100,
			timeoutMsg:
				"Review decoration did not apply after starting session",
		},
	);
}

/**
 * Trigger start-review command without any cleanup.
 * Use this for testing modal confirmation behavior when a session is already active.
 */
export async function triggerStartReviewCommand(): Promise<void> {
	await browser.executeObsidianCommand("anker:start-review");
}

/**
 * Click the reveal button to show the answer.
 * Waits for the button to exist first.
 */
export async function revealAnswer(timeout: number = 5000): Promise<boolean> {
	const revealButton = browser.$(REVIEW_SELECTORS.revealButton);
	try {
		await revealButton.waitForExist({ timeout });
		await revealButton.click();
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait for rating buttons to appear and click one.
 */
export async function rateCard(
	rating: "again" | "hard" | "good" | "easy",
	timeout: number = 5000,
): Promise<void> {
	const selectorMap = {
		again: REVIEW_SELECTORS.againButton,
		hard: REVIEW_SELECTORS.hardButton,
		good: REVIEW_SELECTORS.goodButton,
		easy: REVIEW_SELECTORS.easyButton,
	} as const;

	const buttonSelector = selectorMap[rating];
	const button = browser.$(buttonSelector);

	await button.waitForExist({ timeout });
	await button.click();
}

/**
 * Get the progress text from the review header.
 */
export async function getProgressText(): Promise<string> {
	const progressEl = browser.$(REVIEW_SELECTORS.progressText);
	if (await progressEl.isExisting()) {
		return await progressEl.getText();
	}
	return "";
}

/**
 * Check if review UI is currently displayed.
 */
export async function isReviewUIDisplayed(): Promise<boolean> {
	const wrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
	return await wrapper.isExisting();
}

/**
 * Wait for session complete overlay to appear.
 */
export async function waitForSessionComplete(
	timeout: number = 10000,
): Promise<void> {
	const overlay = browser.$(REVIEW_SELECTORS.completeOverlay);
	await overlay.waitForExist({
		timeout,
		timeoutMsg: "Session complete overlay did not appear",
	});
}

/**
 * Check if the deck selector modal is open.
 */
export async function isDeckSelectorOpen(): Promise<boolean> {
	const promptInput = browser.$(".prompt-input");
	return await promptInput.isExisting();
}

/**
 * Close the deck selector modal if open.
 */
export async function closeDeckSelector(): Promise<void> {
	if (await isDeckSelectorOpen()) {
		await browser.keys(["Escape"]);
	}
}

/**
 * Select first deck from the deck selector modal.
 */
export async function selectFirstDeck(): Promise<boolean> {
	const promptInput = browser.$(".prompt-input");
	if (!(await promptInput.isExisting())) return false;

	const suggestion = browser.$(".suggestion-container .suggestion-item");
	try {
		await suggestion.waitForExist({ timeout: 5000 });
		await suggestion.click();
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait for either deck selector or review UI to appear.
 */
export async function waitForDeckSelectorOrReview(
	timeout: number = 10000,
): Promise<"deck-selector" | "review" | null> {
	try {
		await browser.waitUntil(
			async () => {
				const promptInput = browser.$(".prompt-input");
				if (await promptInput.isExisting()) return true;
				const reviewWrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
				if (await reviewWrapper.isExisting()) return true;
				return false;
			},
			{
				timeout,
				interval: 250,
				timeoutMsg: "Deck selector or review did not appear",
			},
		);

		// Determine which one appeared
		const promptInput = browser.$(".prompt-input");
		if (await promptInput.isExisting()) return "deck-selector";

		const reviewWrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
		if (await reviewWrapper.isExisting()) return "review";

		return null;
	} catch {
		return null;
	}
}
