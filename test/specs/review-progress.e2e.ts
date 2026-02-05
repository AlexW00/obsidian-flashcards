import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike } from "../helpers/obsidianTypes";

describe("Review Progress & Settings", function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await waitForVaultReady();

		// Ensure deterministic scheduling for E2E (avoid short-term steps).
		await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (!plugin) return;
			plugin.settings.fsrsEnableShortTerm = false;
			plugin.settings.fsrsLearningSteps = [];
			plugin.settings.fsrsRelearningSteps = [];
			await plugin.saveSettings();
		});
	});

	/**
	 * Helper: start a review session for the "flashcards" deck via the plugin
	 * API so we avoid the suggest-modal timing issues.
	 */
	const startReviewSession = async () => {
		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 10000 });
	};

	/**
	 * Helper: reveal the answer side then rate with the given button class.
	 * @param ratingClass e.g. ".flashcard-btn-good", ".flashcard-btn-again"
	 */
	const revealAndRate = async (ratingClass: string) => {
		// Reveal answer using JS click to avoid interception
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		await revealButton.waitForExist({ timeout: 5000 });
		await browser.execute(() => {
			const btn = document.querySelector(
				".flashcard-review .flashcard-btn-reveal",
			) as HTMLButtonElement;
			btn?.click();
		});

		// Wait for rating buttons container to appear
		const ratingButtons = browser.$(".flashcard-rating-buttons");
		await ratingButtons.waitForExist({ timeout: 5000 });

		// Click the rating button using JS with the class
		await browser.execute((cls: string) => {
			const btn = document.querySelector(
				`${cls} button`,
			) as HTMLButtonElement;
			btn?.click();
		}, ratingClass);

		// Wait for either next card or completion state
		await browser.waitUntil(
			async () => {
				// Check if session completed
				const complete = browser.$(
					".flashcard-complete-state",
				);
				if (await complete.isExisting()) return true;

				// Check if new reveal button appeared (next card)
				const reveal = browser.$(
					".flashcard-review .flashcard-btn-reveal",
				);
				return reveal.isExisting();
			},
			{ timeout: 5000, interval: 100 },
		);
	};

	/**
	 * Helper: read the current progress text (e.g. "1 / 7").
	 */
	const getProgressText = async (): Promise<string> => {
		const progressText = browser.$(".flashcard-progress-text");
		await progressText.waitForExist({ timeout: 5000 });
		return progressText.getText();
	};

	/**
	 * Helper: read the progress fill bar width style.
	 */
	const getProgressFillWidth = async (): Promise<string> => {
		const fill = browser.$(".flashcard-progress-fill");
		await fill.waitForExist({ timeout: 5000 });
		const widthProp = await fill.getCSSProperty("width");
		return widthProp.value ?? "";
	};

	/**
	 * Helper: read the optimize-parameters description text from the
	 * settings tab.  We open settings via the internal Obsidian API
	 * (app.setting) so we can target the Anker tab directly.
	 */
	const getOptimizeDescription = async (): Promise<string> => {
		// Open Obsidian settings and navigate to the Anker plugin tab
		await browser.executeObsidian(({ app }) => {
			// Access internal settings API (not public, so use type assertion)
			const appWithSetting = app as unknown as {
				setting: {
					open: () => void;
					openTabById: (id: string) => void;
				};
			};
			appWithSetting.setting.open();
			appWithSetting.setting.openTabById("anker");
		});

		// Wait for the settings container to render
		await browser.pause(1000);

		// Find the "Optimize parameters" setting and grab its description
		const descText = await browser.execute(() => {
			const settings = Array.from(
				document.querySelectorAll(".setting-item"),
			);
			for (const item of settings) {
				const name = item.querySelector(".setting-item-name");
				if (
					name &&
					name.textContent?.trim() === "Optimize parameters"
				) {
					const desc = item.querySelector(
						".setting-item-description",
					);
					return desc?.textContent?.trim() ?? "";
				}
			}
			return "";
		});

		// Close the settings modal
		await browser.keys(["Escape"]);
		await browser.pause(300);

		return descText;
	};

	it("progress bar advances when reviewing cards", async function () {
		await startReviewSession();

		// Capture initial progress
		const initialText = await getProgressText();
		const initialWidth = await getProgressFillWidth();

		// The initial state should show "0 / N completed"
		expect(initialText).toMatch(/^0\s*\/\s*\d+\s*completed$/);

		// Rate the current card "Easy" so it leaves the due queue entirely
		// (bypasses learning steps and schedules for days later)
		await revealAndRate(".flashcard-btn-easy");

		// After rating, the review view should still exist (more cards remain)
		const reviewView = browser.$(".flashcard-review");
		const isStillReviewing = await reviewView.isExisting();

		if (isStillReviewing) {
			// Check for either progress text change or completion
			const completeState = browser.$(".flashcard-complete-state");
			if (await completeState.isExisting()) {
				// If all cards were completed, that's still a valid outcome
				return;
			}

			// Wait for progress to actually update (poll until changed)
			await browser.waitUntil(
				async () => {
					const afterText = await getProgressText();
					const afterWidth = await getProgressFillWidth();
					return afterText !== initialText || afterWidth !== initialWidth;
				},
				{ timeout: 5000, interval: 100, timeoutMsg: "Progress did not update after rating" },
			);
		}
	});

	it("progress bar reflects cards leaving the queue", async function () {
		await startReviewSession();

		// Read total card count from the initial progress text
		const initialText = await getProgressText();
		const initialMatch = initialText.match(
			/(\d+)\s*\/\s*(\d+)\s*completed/,
		);
		expect(initialMatch).not.toBe(null);
		const initialCompleted = Number(initialMatch![1]);
		const initialTotal = Number(initialMatch![2]);

		// Rate the card "Easy" so it leaves the due queue (bypasses learning
		// steps and schedules for days later, not just minutes)
		await revealAndRate(".flashcard-btn-easy");

		// Either: still reviewing with fewer cards, or session complete
		const completeState = browser.$(".flashcard-complete-state");
		const isComplete = await completeState.isExisting();

		if (!isComplete) {
			// Wait for completed count to increase (poll until updated)
			await browser.waitUntil(
				async () => {
					const afterText = await getProgressText();
					const afterMatch = afterText.match(
						/(\d+)\s*\/\s*(\d+)\s*completed/,
					);
					if (!afterMatch) return false;
					const afterCompleted = Number(afterMatch[1]);
					return afterCompleted > initialCompleted;
				},
				{ timeout: 5000, interval: 100, timeoutMsg: "Completed count did not increase after rating" },
			);

			// Final verification
			const afterText = await getProgressText();
			const afterMatch = afterText.match(
				/(\d+)\s*\/\s*(\d+)\s*completed/,
			);
			expect(afterMatch).not.toBe(null);
			const afterTotal = Number(afterMatch![2]);

			// The total should stay stable
			expect(afterTotal).toEqual(initialTotal);
		}
		// If complete, that's fine — all cards were reviewed
	});

	it("settings optimize text changes after reviews", async function () {
		// 1. Read the initial optimizer description (0 reviews)
		const initialDesc = await getOptimizeDescription();
		expect(initialDesc).toContain("Found");
		expect(initialDesc).toContain("reviews");

		// 2. Run a review session and rate several cards
		await startReviewSession();

		// Rate a few cards to generate review history
		for (let i = 0; i < 3; i++) {
			// Check if review is still active
			const reviewView = browser.$(".flashcard-review");
			if (!(await reviewView.isExisting())) break;

			const completeState = browser.$(".flashcard-complete-state");
			if (await completeState.isExisting()) break;

			const revealButton = browser.$(
				".flashcard-review .flashcard-btn-reveal",
			);
			if (!(await revealButton.isExisting())) break;

			await revealAndRate(".flashcard-btn-again");
		}

		// 3. Read the optimizer description again — it should now reflect
		//    the reviews we just performed.
		const afterDesc = await getOptimizeDescription();
		expect(afterDesc).toContain("Found");
		expect(afterDesc).toContain("reviews");

		// The counts should have changed — the initial description had
		// 0 reviews whereas now we have at least some.
		expect(afterDesc).not.toEqual(initialDesc);
	});
});
