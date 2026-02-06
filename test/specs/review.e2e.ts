import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import {
	REVIEW_SELECTORS,
	waitForReviewActive,
	waitForDeckSelectorOrReview,
	closeDeckSelector,
	selectFirstDeck,
	startReviewSession,
	revealAnswer,
	rateCard,
	isReviewUIDisplayed,
	endSession,
	closeModal,
} from "../helpers/reviewHelpers";

import type {
	ObsidianAppLike,
	WorkspaceLeafLike,
} from "../helpers/obsidianTypes";

describe("Review Session", function () {
	beforeEach(async function () {
		// End any existing review session
		await endSession();
		// Close any open modals
		await closeModal();

		// Close dashboard and extra tabs to ensure clean slate
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;

			// Close all dashboard views
			const dashboardLeaves = (
				obsidianApp.workspace as unknown as {
					getLeavesOfType: (type: string) => WorkspaceLeafLike[];
				}
			).getLeavesOfType("anker-dashboard");
			for (const leaf of dashboardLeaves) {
				leaf.detach();
			}

			// Close all but one markdown leaves
			const mdLeaves = obsidianApp.workspace.getLeavesOfType("markdown");
			for (let i = 1; i < mdLeaves.length; i++) {
				mdLeaves[i]?.detach();
			}
		});

		// Reset vault to initial state (includes sample cards with due dates)
		await obsidianPage.resetVault();
		await waitForVaultReady();
		// Give a moment for UI to stabilize after reset
		await browser.pause(200);
	});

	it("starts review session via command", async function () {
		// Execute the start-review command
		await browser.executeObsidianCommand("anker:start-review");

		// A deck selector prompt or review view should appear
		const result = await waitForDeckSelectorOrReview();

		// If the deck selector is open, verify it and close it
		if (result === "deck-selector") {
			const promptInput = browser.$(".prompt-input");
			await expect(promptInput).toExist();
			await closeDeckSelector();
		} else if (result === "review") {
			const reviewWrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
			await expect(reviewWrapper).toExist();
		}
	});

	it("opens review view with cards", async function () {
		// First, open the dashboard to access review
		await browser.executeObsidianCommand("anker:open-dashboard");

		// Wait for dashboard
		const dashboard = browser.$(".flashcard-dashboard");
		await dashboard.waitForExist({ timeout: 5000 });

		// Find a study button and click it
		const studyButton = browser.$(
			".flashcard-dashboard .flashcard-deck-item button",
		);
		if (await studyButton.isExisting()) {
			await studyButton.click();

			const result = await waitForDeckSelectorOrReview();
			if (result === "deck-selector") {
				await selectFirstDeck();
			}

			await waitForReviewActive();
			const reviewWrapper = browser.$(REVIEW_SELECTORS.activeWrapper);
			await expect(reviewWrapper).toExist();
		}
	});

	it("rates card and advances to next", async function () {
		// Start a review session
		await startReviewSession("flashcards");

		// Verify review UI is displayed
		await waitForReviewActive();
		const footer = browser.$(REVIEW_SELECTORS.footer);
		await expect(footer).toExist();

		// Reveal answer if needed
		await revealAnswer();

		// Rate the card with Good
		await rateCard("good");

		// Wait a bit for UI to update
		await browser.pause(500);

		// Either still reviewing or completed - both are valid
		const stillInReview = await isReviewUIDisplayed();
		expect(stillInReview).toBe(true);
	});
});
