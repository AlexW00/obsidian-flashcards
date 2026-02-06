import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike } from "../helpers/obsidianTypes";
import {
	REVIEW_SELECTORS,
	waitForReviewActive,
	startReviewSession,
	revealAnswer,
	isSessionActive,
	getSessionState,
	endSession,
	closeModal,
} from "../helpers/reviewHelpers";

/**
 * E2E tests for review session lifecycle.
 * Tests session management, UI elements, and basic navigation.
 */
describe("Review Session Lifecycle", function () {
	beforeEach(async function () {
		// End any existing session first
		await endSession();
		// Close any open modals
		await closeModal();

		// Reset vault
		await obsidianPage.resetVault();
		await waitForVaultReady();
		await browser.pause(200);
	});

	it("applies body class during active session", async function () {
		// Initially no session active
		const initialBodyClass = await browser.execute(() => {
			return document.body.classList.contains(
				"anker-review-session-active",
			);
		});
		expect(initialBodyClass).toBe(false);

		// Start session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Body should have the session class
		const duringSessionClass = await browser.execute(() => {
			return document.body.classList.contains(
				"anker-review-session-active",
			);
		});
		expect(duringSessionClass).toBe(true);

		// End session
		await endSession();

		// Wait for class to be removed
		await browser.waitUntil(
			async () => {
				return await browser.execute(() => {
					return !document.body.classList.contains(
						"anker-review-session-active",
					);
				});
			},
			{ timeout: 5000 },
		);
	});

	it("session ends when tab is closed", async function () {
		// Start session
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Verify session is active
		expect(await isSessionActive()).toBe(true);

		// Close the active tab
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const leaves = obsidianApp.workspace.getLeavesOfType("markdown");
			if (leaves[0]) {
				leaves[0].detach();
			}
		});

		// Wait a bit for cleanup
		await browser.pause(500);

		// Session should be ended
		const isActive = await isSessionActive();
		expect(isActive).toBe(false);
	});

	it("review header shows progress information", async function () {
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Header should exist
		const header = browser.$(REVIEW_SELECTORS.header);
		await expect(header).toExist();

		// Progress text should show X / Y format
		const progressText = browser.$(REVIEW_SELECTORS.progressText);
		await expect(progressText).toExist();

		const text = await progressText.getText();
		expect(text).toMatch(/\d+\s*\/\s*\d+/);
	});

	it("review footer shows reveal button initially", async function () {
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Footer should exist
		const footer = browser.$(REVIEW_SELECTORS.footer);
		await expect(footer).toExist();

		// Reveal button should be visible initially
		const revealButton = browser.$(REVIEW_SELECTORS.revealButton);
		await expect(revealButton).toExist();
	});

	it("rating buttons appear after revealing answer", async function () {
		await startReviewSession("flashcards");
		await waitForReviewActive();

		// Reveal the answer
		await revealAnswer();

		// Now rating buttons should appear
		const ratingButtons = browser.$(REVIEW_SELECTORS.ratingButtons);
		await ratingButtons.waitForExist({ timeout: 3000 });

		// Check individual buttons exist
		const againButton = browser.$(REVIEW_SELECTORS.againButton);
		const hardButton = browser.$(REVIEW_SELECTORS.hardButton);
		const goodButton = browser.$(REVIEW_SELECTORS.goodButton);
		const easyButton = browser.$(REVIEW_SELECTORS.easyButton);

		await expect(againButton).toExist();
		await expect(hardButton).toExist();
		await expect(goodButton).toExist();
		await expect(easyButton).toExist();
	});

	it("session has valid initial state", async function () {
		await startReviewSession("flashcards");
		await waitForReviewActive();

		const session = await getSessionState();
		expect(session).toBeTruthy();
		expect(session?.deckPath).toBe("flashcards");
		expect(session?.currentSide).toBe(0);
		expect(session?.reviewedCount).toBe(0);
		expect(session?.initialTotal).toBeGreaterThan(0);
	});
});
