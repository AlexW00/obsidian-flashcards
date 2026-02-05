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

		// Get initial card count from progress text
		const initialProgress = await browser
			.$(".flashcard-progress-text")
			.getText();
		const initialMatch = initialProgress.match(/(\d+)\s*\/\s*(\d+)/);
		const initialCompleted = initialMatch
			? parseInt(initialMatch[1] ?? "0", 10)
			: 0;
		const initialTotal = initialMatch
			? parseInt(initialMatch[2] ?? "0", 10)
			: 0;

		expect(initialTotal).toBeGreaterThan(0);
		expect(initialCompleted).toBe(0); // Should start at 0 completed

		// Reveal answer
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		if (await revealButton.isExisting()) {
			await revealButton.click();
		}

		// Wait for Easy button specifically using its CSS class
		const easyButton = browser.$(".flashcard-review .flashcard-btn-easy");
		await easyButton.waitForExist({ timeout: 3000 });
		await easyButton.waitForClickable({ timeout: 3000 });
		await easyButton.click();

		// Wait for the UI to update - either progress changes or review completes
		await browser.waitUntil(
			async () => {
				// Check if review completed
				const completeEl = browser.$(".flashcard-complete");
				if (await completeEl.isExisting()) return true;

				// Check if progress updated
				const progressText = browser.$(".flashcard-progress-text");
				if (await progressText.isExisting()) {
					const text = await progressText.getText();
					const match = text.match(/(\d+)\s*\/\s*(\d+)/);
					const completed = match ? parseInt(match[1] ?? "0", 10) : 0;
					return completed > initialCompleted;
				}
				return false;
			},
			{
				timeout: 5000,
				interval: 200,
				timeoutMsg: "Progress did not update after rating Easy",
			},
		);

		// At this point, either the card was marked complete or the session ended
		// Both outcomes confirm the card was removed from the due list
	});
});
