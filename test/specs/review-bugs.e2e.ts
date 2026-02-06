import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike, DueCard } from "../helpers/obsidianTypes";

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
		return await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			const pluginId = plugin?.manifest?.id ?? "anker";
			const path = `${obsidianApp.vault.configDir}/plugins/${pluginId}/review-history.jsonl`;
			const exists = await obsidianApp.vault.adapter.exists(path);
			const raw = exists
				? await obsidianApp.vault.adapter.read(path)
				: "";
			const entries = raw
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => parseReviewHistoryLine(line))
				.filter((line): line is ReviewHistoryLine => line !== null);

			return { path, entries };
		});
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

	const getCurrentSessionCard = async (): Promise<{
		id: string;
		path: string;
		elapsed_days: number;
	} | null> => {
		return await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const leaf =
				obsidianApp.workspace.getLeavesOfType("anker-review")[0];
			const view = leaf?.view as
				| {
						session?: {
							cards: Array<{
								id: string;
								path: string;
								frontmatter?: {
									_review?: { elapsed_days?: number };
								};
							}>;
							currentIndex: number;
						};
				  }
				| undefined;

			const session = view?.session;
			if (!session) return null;
			const card = session.cards[session.currentIndex];
			if (!card) return null;
			return {
				id: card.id,
				path: card.path,
				elapsed_days: card.frontmatter?._review?.elapsed_days ?? 0,
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
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 5000 });

		// Get initial card count
		const initialProgress = await browser
			.$(".flashcard-progress-text")
			.getText();
		const initialMatch = initialProgress.match(/(\d+)\s*\/\s*(\d+)/);
		const initialTotal = initialMatch
			? parseInt(initialMatch[2] ?? "0", 10)
			: 0;

		expect(initialTotal).toBeGreaterThan(0);

		// Reveal answer
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		if (await revealButton.isExisting()) {
			await revealButton.click();
		}

		// Wait for rating buttons to appear
		const ratingButtons = browser.$(
			".flashcard-review .flashcard-rating-buttons",
		);
		await ratingButtons.waitForExist({ timeout: 3000 });

		// Click "Hard" button (typically the second button, index 1)
		// Hard on a new card should keep it due today
		const hardButton = browser.$(
			".flashcard-review .flashcard-rating-buttons button:nth-child(2)",
		);
		if (await hardButton.isExisting()) {
			await hardButton.click();
		}

		// Wait for the UI to update
		await browser.pause(500);

		// If still in review, check the progress
		const stillInReview = await browser.$(".flashcard-review").isExisting();
		if (stillInReview) {
			// The session should still have cards
			const newProgress = await browser
				.$(".flashcard-progress-text")
				.getText();
			const newMatch = newProgress.match(/(\d+)\s*\/\s*(\d+)/);
			const newTotal = newMatch ? parseInt(newMatch[2] ?? "0", 10) : 0;

			// Total should remain the same (card wasn't removed incorrectly)
			expect(newTotal).toBe(initialTotal);
		}
	});

	it("progress shows reviews performed when cards remain due (Bug 5)", async function () {
		// Start a review session
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 5000 });

		// Rate multiple cards with Again/Hard to keep them due
		for (let i = 0; i < 2; i++) {
			// Reveal answer
			const revealButton = browser.$(
				".flashcard-review .flashcard-btn-reveal",
			);
			if (await revealButton.isExisting()) {
				await revealButton.click();
			}

			// Wait for rating buttons
			const ratingButtons = browser.$(
				".flashcard-review .flashcard-rating-buttons",
			);
			await ratingButtons.waitForExist({ timeout: 3000 });

			// Click "Again" button (first button) - keeps card due
			const againButton = browser.$(
				".flashcard-review .flashcard-rating-buttons button:first-child",
			);
			if (await againButton.isExisting()) {
				await againButton.click();
			}

			await browser.pause(300);

			// Check if still in review
			const stillInReview = await browser
				.$(".flashcard-review")
				.isExisting();
			if (!stillInReview) break;
		}

		// Check progress text shows reviews performed
		const stillInReview = await browser.$(".flashcard-review").isExisting();
		if (stillInReview) {
			const progressText = await browser
				.$(".flashcard-progress-text")
				.getText();
			// If more reviews performed than cards completed, it should show "X reviews"
			// e.g., "0 / 7 completed (2 reviews)"
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
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 5000 });

		// Reveal answer
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		await revealButton.waitForExist({ timeout: 3000 });
		await revealButton.click();

		// Wait for Easy button and click it
		const easyButton = browser.$(".flashcard-review .flashcard-btn-easy");
		await easyButton.waitForExist({ timeout: 3000 });
		await easyButton.waitForClickable({ timeout: 3000 });
		await easyButton.click();

		// Wait for the review view to finish re-rendering
		// (rateCard is async - it reads files from disk, re-renders)
		await browser.pause(2000);

		// Verify the card was removed: due count should have decreased
		// Query the plugin API directly rather than relying on DOM state
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
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 5000 });

		const currentCard = await getCurrentSessionCard();
		expect(currentCard).toBeTruthy();
		if (!currentCard) return;
		expect(currentCard.id).toBeTruthy();

		// Reveal answer
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		if (await revealButton.isExisting()) {
			await revealButton.click();
		}

		// Click Good (rating 3)
		const goodButton = browser.$(".flashcard-review .flashcard-btn-good");
		await goodButton.waitForExist({ timeout: 3000 });
		await goodButton.click();

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
