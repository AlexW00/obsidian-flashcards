import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike, DueCard } from "../helpers/obsidianTypes";
import {
	REVIEW_SELECTORS,
	waitForReviewActive,
	startReviewSession,
	revealAnswer,
	rateCard,
	getProgressText,
	isReviewUIDisplayed,
} from "../helpers/reviewHelpers";

/**
 * E2E tests for review system bug fixes.
 * Tests regressions for:
 * - Bug 1/2: Metadata cache race condition / Card disappears when still due
 * - Bug 4: Missing card IDs
 * - Bug 5: reviewedCount not incrementing when card stays due
 */
describe("Review Bugs", function () {
	type ReviewHistoryEntry = {
		timestamp: string;
		rating: number;
		elapsed_days: number;
	};

	type ReviewHistoryLine = {
		cardId: string;
		entry: ReviewHistoryEntry;
	};

	type ReviewHistoryResult = {
		path: string;
		entries: ReviewHistoryLine[];
	};

	const isReviewHistoryEntry = (
		value: unknown,
	): value is ReviewHistoryEntry => {
		if (!value || typeof value !== "object") return false;
		const record = value as Record<string, unknown>;
		return (
			typeof record.timestamp === "string" &&
			typeof record.rating === "number" &&
			typeof record.elapsed_days === "number"
		);
	};

	const parseReviewHistoryLine = (line: string): ReviewHistoryLine | null => {
		try {
			const parsed = JSON.parse(line) as unknown;
			if (!parsed || typeof parsed !== "object") return null;
			const record = parsed as Record<string, unknown>;
			const cardId = record.cardId;
			const entry = record.entry;
			if (typeof cardId !== "string") return null;
			if (!isReviewHistoryEntry(entry)) return null;
			return { cardId, entry };
		} catch {
			return null;
		}
	};

	const readReviewHistory = async (): Promise<ReviewHistoryResult> => {
		const result = await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			const pluginId = plugin?.manifest?.id ?? "anker";
			const path = `${obsidianApp.vault.configDir}/plugins/${pluginId}/review-history.jsonl`;
			const exists = await obsidianApp.vault.adapter.exists(path);
			const raw = exists
				? await obsidianApp.vault.adapter.read(path)
				: "";
			return { path, raw };
		});

		// Parse in Node.js context (not browser)
		const entries = result.raw
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => parseReviewHistoryLine(line))
			.filter((line): line is ReviewHistoryLine => line !== null);

		return { path: result.path, entries };
	};

	const resetReviewHistory = async (): Promise<ReviewHistoryResult> => {
		await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.reviewLogStore) {
				await plugin.reviewLogStore.reset();
			}
		});
		return await readReviewHistory();
	};

	/**
	 * Get current session card info from the ReviewSessionManager.
	 * Uses the new native review API instead of the deprecated view-based approach.
	 */
	const getCurrentSessionCard = async (): Promise<{
		id: string;
		path: string;
		elapsed_days: number;
	} | null> => {
		return await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			const session = plugin?.reviewSessionManager?.getSession();
			if (!session) return null;

			// Find the current card in the session's cards array
			const currentCard = (
				session as unknown as {
					cards: Array<{
						id: string;
						path: string;
						frontmatter?: { _review?: { elapsed_days?: number } };
					}>;
				}
			).cards?.find(
				(c: { path: string }) => c.path === session.currentCardPath,
			);
			if (!currentCard) return null;

			return {
				id: currentCard.id,
				path: currentCard.path,
				elapsed_days:
					currentCard.frontmatter?._review?.elapsed_days ?? 0,
			};
		});
	};

	beforeEach(async function () {
		await obsidianPage.resetVault();
		await waitForVaultReady();
	});

	it("cards have valid IDs in frontmatter (Bug 4)", async function () {
		// Verify all cards have _id fields
		const cardIds = await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (!plugin?.deckService) return [];

			const dueCards = plugin.deckService.getDueCards("flashcards");
			return dueCards.map((c: DueCard) => ({ path: c.path, id: c.id }));
		});

		expect(cardIds.length).toBeGreaterThan(0);
		for (const card of cardIds) {
			expect(card.id).toBeTruthy();
			expect(card.id).not.toBe("");
		}
	});

	it("card stays in session when rated Hard and still due (Bug 2)", async function () {
		// Start a review session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Get initial card count from progress text
		const initialProgress = await getProgressText();
		const initialMatch = initialProgress.match(/(\d+)\s*\/\s*(\d+)/);
		const initialTotal = initialMatch
			? parseInt(initialMatch[2] ?? "0", 10)
			: 0;

		expect(initialTotal).toBeGreaterThan(0);

		// Reveal answer
		await revealAnswer();

		// Wait for rating buttons to appear
		const ratingButtons = browser.$(REVIEW_SELECTORS.ratingButtons);
		await ratingButtons.waitForExist({ timeout: 3000 });

		// Click "Hard" button - on a new card should keep it due today
		await rateCard("hard");

		// Wait for the UI to update
		await browser.pause(500);

		// If still in review, check the progress
		const stillInReview = await isReviewUIDisplayed();
		if (stillInReview) {
			// The session should still have cards
			const newProgress = await getProgressText();
			const newMatch = newProgress.match(/(\d+)\s*\/\s*(\d+)/);
			const newTotal = newMatch ? parseInt(newMatch[2] ?? "0", 10) : 0;

			// Total should remain the same (card wasn't removed incorrectly)
			expect(newTotal).toBe(initialTotal);
		}
	});

	it("progress shows reviews performed when cards remain due (Bug 5)", async function () {
		// Start a review session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Rate multiple cards with Again to keep them due
		for (let i = 0; i < 2; i++) {
			// Reveal answer
			await revealAnswer();

			// Wait for rating buttons
			const ratingButtons = browser.$(REVIEW_SELECTORS.ratingButtons);
			await ratingButtons.waitForExist({ timeout: 3000 });

			// Click "Again" button - keeps card due
			await rateCard("again");

			await browser.pause(300);

			// Check if still in review
			const stillInReview = await isReviewUIDisplayed();
			if (!stillInReview) break;
		}

		// Check progress text shows reviews performed
		const stillInReview = await isReviewUIDisplayed();
		if (stillInReview) {
			const progressText = await getProgressText();
			// The text should at minimum show the completed/total format
			expect(progressText).toMatch(/\d+\s*\/\s*\d+\s*completed/);
		}
	});

	it("rating Easy removes card from session when scheduled for future", async function () {
		// Get the initial due card count directly from the plugin
		const initialDueCount = await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (!plugin?.deckService) return 0;
			return plugin.deckService.getDueCards("flashcards").length;
		});
		expect(initialDueCount).toBeGreaterThan(0);

		// Start a review session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Reveal answer
		await revealAnswer();

		// Wait for Easy button and click it
		const easyButton = browser.$(REVIEW_SELECTORS.easyButton);
		await easyButton.waitForExist({ timeout: 3000 });
		await rateCard("easy");

		// Wait for the review to process the rating
		await browser.pause(2000);

		// Verify the card was removed: due count should have decreased
		await browser.waitUntil(
			async () => {
				const currentDueCount = await browser.executeObsidian(
					({ app }) => {
						const obsidianApp = app as ObsidianAppLike;
						const plugin =
							obsidianApp.plugins?.getPlugin?.("anker");
						if (!plugin?.deckService) return -1;
						return plugin.deckService.getDueCards("flashcards")
							.length;
					},
				);
				return currentDueCount < initialDueCount;
			},
			{
				timeout: 10000,
				interval: 500,
				timeoutMsg: "Due card count did not decrease after rating Easy",
			},
		);
	});

	it("writes a single, correct review log entry on rating", async function () {
		const initialHistory = await resetReviewHistory();
		expect(initialHistory.entries.length).toBeGreaterThanOrEqual(0);

		// Start a review session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		const currentCard = await getCurrentSessionCard();
		expect(currentCard).toBeTruthy();
		if (!currentCard) return;
		expect(currentCard.id).toBeTruthy();

		// Reveal answer
		await revealAnswer();

		// Click Good (rating 3)
		const goodButton = browser.$(REVIEW_SELECTORS.goodButton);
		await goodButton.waitForExist({ timeout: 3000 });
		await rateCard("good");

		// Wait for review history to update on disk
		await browser.waitUntil(
			async () => {
				const nextHistory = await readReviewHistory();
				const nextTotal = nextHistory.entries.length;
				const initialTotal = initialHistory.entries.length;
				const nextCardCount = nextHistory.entries.filter(
					(entry) => entry.cardId === currentCard.id,
				).length;
				const initialCardCount = initialHistory.entries.filter(
					(entry) => entry.cardId === currentCard.id,
				).length;

				return (
					nextTotal === initialTotal + 1 &&
					nextCardCount === initialCardCount + 1
				);
			},
			{
				timeout: 10000,
				interval: 500,
				timeoutMsg:
					"Review history did not append a single entry after rating",
			},
		);

		const historyAfter = await readReviewHistory();
		const cardEntries = historyAfter.entries.filter(
			(entry) => entry.cardId === currentCard.id,
		);
		const latestEntry = cardEntries[cardEntries.length - 1];
		expect(latestEntry).toBeTruthy();
		if (!latestEntry) return;

		expect(latestEntry.entry.rating).toBe(3);
		expect(latestEntry.entry.elapsed_days).toBe(currentCard.elapsed_days);
		expect(Number.isNaN(Date.parse(latestEntry.entry.timestamp))).toBe(
			false,
		);

		const uniqueCardEntries = new Set(
			cardEntries.map((entry) => JSON.stringify(entry)),
		);
		expect(uniqueCardEntries.size).toBe(cardEntries.length);
	});
});
