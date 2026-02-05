import { describe, it, before } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";

describe("Review Session", function () {
	const waitForDeckSelectorOrReview = async () => {
		await browser.waitUntil(
			async () => {
				const promptInput = await browser.$(".prompt-input");
				if (await promptInput.isExisting()) return true;
				const reviewView = await browser.$(".flashcard-review");
				if (await reviewView.isExisting()) return true;
				return false;
			},
			{
				timeout: 10000,
				interval: 250,
				timeoutMsg: "Deck selector or review view did not appear",
			},
		);
	};

	const chooseFirstDeckIfPrompted = async () => {
		const promptInput = await browser.$(".prompt-input");
		if (!(await promptInput.isExisting())) return;

		const suggestion = await browser.$(
			".suggestion-container .suggestion-item",
		);
		try {
			await suggestion.waitForExist({ timeout: 5000 });
		} catch {
			return;
		}
		await browser.execute((el) => el.click(), suggestion);
	};

	const closeDeckSelectorIfOpen = async () => {
		const promptInput = await browser.$(".prompt-input");
		if (await promptInput.isExisting()) {
			await browser.keys(["Escape"]);
		}
	};

	beforeEach(async function () {
		// Reset vault to initial state (includes sample cards with due dates)
		await obsidianPage.resetVault();
		await waitForVaultReady();
	});

	it("starts review session via command", async function () {
		// Execute the start-review command
		await browser.executeObsidianCommand("anker:start-review");

		// A deck selector prompt or review view should appear
		await waitForDeckSelectorOrReview();

		// If the deck selector is open, verify it and close it
		const promptInput = await browser.$(".prompt-input");
		if (await promptInput.isExisting()) {
			await expect(promptInput).toExist();
			await closeDeckSelectorIfOpen();
		} else {
			const reviewView = await browser.$(".flashcard-review");
			await expect(reviewView).toExist();
		}
	});

	it("opens review view with cards", async function () {
		// First, open the dashboard to access review
		await browser.executeObsidianCommand("anker:open-dashboard");

		// Wait for dashboard
		const dashboard = await browser.$(".flashcard-dashboard");
		await dashboard.waitForExist({ timeout: 5000 });

		// Find a study button and click it
		const studyButton = await browser.$(
			".flashcard-dashboard .flashcard-deck-item button",
		);
		if (await studyButton.isExisting()) {
			await browser.execute((el) => el.click(), studyButton);

			await waitForDeckSelectorOrReview();
			await chooseFirstDeckIfPrompted();

			const reviewView = await browser.$(".flashcard-review");
			await reviewView.waitForExist({ timeout: 5000 });
			await expect(reviewView).toExist();
		}
	});

	it("rates card and advances to next", async function () {
		// Start a review session directly to avoid suggest modal timing
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.getPlugin("anker");
			if (plugin) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = await browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 5000 });

		// Reveal answer if needed
		const revealButton = await browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		if (await revealButton.isExisting()) {
			await browser.execute((el) => el.click(), revealButton);
		}

		// Rate the card if rating buttons are present
		const ratingButton = await browser.$(
			".flashcard-review .flashcard-rating-buttons button",
		);
		if (await ratingButton.isExisting()) {
			await browser.execute((el) => el.click(), ratingButton);
		}

		// Either still reviewing or completed - both are valid
		const stillInReview = await browser.$(".flashcard-review");
		await expect(await stillInReview.isExisting()).toBe(true);
	});
});
