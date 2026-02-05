import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike, DueCard } from "../helpers/obsidianTypes";

describe("Review Progress & Settings", function () {
	// Debug helpers for browser logs
	/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
	const captureBrowserLogs = async () => {
		await browser.execute(() => {
			(window as any).__logs = [];
			const originalDebug = console.debug;
			// eslint-disable-next-line no-console
			const originalLog = console.log;
			const originalWarn = console.warn;
			const originalError = console.error;

			const pushLog = (level: string, args: any[]) => {
				(window as any).__logs.push({
					level,
					message: args
						.map((a: any) =>
							typeof a === "object" ? JSON.stringify(a) : String(a),
						)
						.join(" "),
					time: new Date().toISOString(),
				});
			};

			console.debug = (...args) => {
				pushLog("DEBUG", args);
				originalDebug.apply(console, args);
			};
			// eslint-disable-next-line no-console
			console.log = (...args) => {
				pushLog("LOG", args);
				originalLog.apply(console, args);
			};
			console.warn = (...args) => {
				pushLog("WARN", args);
				originalWarn.apply(console, args);
			};
			console.error = (...args) => {
				pushLog("ERROR", args);
				originalError.apply(console, args);
			};
		});
	};

	const dumpBrowserLogs = async () => {
		const logs = await browser.execute(
			() => ((window as any).__logs || []) as any[],
		);
		logs.forEach((log: any) => {
			if (
				log.message.includes("[Anker") ||
				log.level === "ERROR" ||
				log.level === "WARN"
			) {
				console.debug(`[BROWSER][${log.level}] ${log.message}`);
			}
		});
		await browser.execute(() => {
			(window as any).__logs = [];
		});
	};
	/* eslint-enable */

	beforeEach(async function () {
		await obsidianPage.resetVault();
		await waitForVaultReady();
		await captureBrowserLogs();

		// Ensure deterministic scheduling for E2E (avoid short-term steps).
		const settingsApplied = await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (!plugin) return { error: "Plugin not found" };
			plugin.settings.fsrsEnableShortTerm = false;
			plugin.settings.fsrsLearningSteps = [];
			plugin.settings.fsrsRelearningSteps = [];
			await plugin.saveSettings();

			// Return settings for debugging
			return {
				fsrsEnableShortTerm: plugin.settings.fsrsEnableShortTerm,
				fsrsLearningSteps: plugin.settings.fsrsLearningSteps,
				fsrsRelearningSteps: plugin.settings.fsrsRelearningSteps,
			};
		});
		console.debug(`[DEBUG] Settings applied:`, settingsApplied);

		// Verify settings were actually applied
		if (settingsApplied && "error" in settingsApplied) {
			throw new Error(`Failed to apply settings: ${settingsApplied.error}`);
		}
	});

	/**
	 * Helper: start a review session for the "flashcards" deck via the plugin
	 * API so we avoid the suggest-modal timing issues.
	 */
	const startReviewSession = async () => {
		// Log deck info before starting
		const deckInfo = await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (!plugin?.deckService) return { error: "No deck service" };
			
			const dueCards: DueCard[] = plugin.deckService.getDueCards("flashcards");
			return {
				dueCardCount: dueCards.length,
				dueCardPaths: dueCards.map((c) => c.path),
			};
		});
		console.debug(`[DEBUG] Deck info before review:`, deckInfo);

		await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin?.startReview) {
				void plugin.startReview("flashcards");
			}
		});

		const reviewView = browser.$(".flashcard-review");
		await reviewView.waitForExist({ timeout: 10000 });
		console.debug(`[DEBUG] Review session started`);
	};

	/**
	 * Helper: get the first line of card content (the question) for change detection.
	 * Using only the question avoids false positives when the answer is revealed.
	 */
	const getCardQuestion = async (): Promise<string> => {
		const question = await browser.execute(() => {
			// Get the first flashcard-card-content div (the question side)
			const contentEl = document.querySelector(".flashcard-card .flashcard-card-content");
			return contentEl?.textContent?.trim() ?? "";
		});
		return question;
	};

	/**
	 * Helper: reveal the answer side then rate with the given button class.
	 * @param ratingClass e.g. ".flashcard-btn-good", ".flashcard-btn-again"
	 */
	const revealAndRate = async (ratingClass: string) => {
		// Capture progress BEFORE rating
		const progressBefore = await getProgressText();
		console.debug(`[E2E] Before reveal: progress="${progressBefore}"`);

		// Dump full DOM structure of controls area for debugging
		const controlsDom = await browser.execute(() => {
			const controls = document.querySelector(".flashcard-controls");
			return controls?.innerHTML?.substring(0, 500) ?? "NO .flashcard-controls FOUND";
		});
		console.debug(`[E2E] Controls DOM before reveal:`, controlsDom);

		// Reveal answer using WebDriver click
		const revealButton = browser.$(
			".flashcard-review .flashcard-btn-reveal",
		);
		await revealButton.waitForExist({ timeout: 5000 });

		// Log reveal button details
		const revealTag = await revealButton.getTagName();
		const revealClass = await revealButton.getAttribute("class");
		const revealDisplayed = await revealButton.isDisplayed();
		const revealClickable = await revealButton.isClickable();
		console.debug(`[E2E] Reveal button: tag=${revealTag}, class="${revealClass}", displayed=${revealDisplayed}, clickable=${revealClickable}`);

		await revealButton.click();
		console.debug(`[E2E] Reveal button clicked`);
		await dumpBrowserLogs();

		// Wait for rating buttons container to appear
		const ratingButtonsEl = browser.$(".flashcard-rating-buttons");
		await ratingButtonsEl.waitForExist({ timeout: 5000 });
		console.debug(`[E2E] Rating buttons container appeared`);

		// Dump the rating buttons DOM
		const ratingsDom = await browser.execute(() => {
			const container = document.querySelector(".flashcard-rating-buttons");
			if (!container) return "NO .flashcard-rating-buttons FOUND";
			const buttons = container.querySelectorAll("button");
			const info: string[] = [];
			buttons.forEach((btn, i) => {
				info.push(`btn[${i}]: tag=${btn.tagName}, class="${btn.className}", text="${btn.textContent?.trim()}", parent.class="${btn.parentElement?.className}"`);
			});
			return info.join(" | ");
		});
		console.debug(`[E2E] Rating buttons DOM:`, ratingsDom);

		// Capture the QUESTION content AFTER reveal but BEFORE rating
		const questionBefore = await getCardQuestion();
		console.debug(`[E2E] After reveal, before rating: question="${questionBefore.substring(0, 60)}"`);

		// Try to find the rating button with the specific class
		const ratingButton = browser.$(`${ratingClass} button`);
		const buttonExists = await ratingButton.isExisting();
		console.debug(`[E2E] Rating button "${ratingClass} button" exists: ${buttonExists}`);

		if (buttonExists) {
			const btnTag = await ratingButton.getTagName();
			const btnClass = await ratingButton.getAttribute("class");
			const btnText = await ratingButton.getText();
			const btnDisplayed = await ratingButton.isDisplayed();
			const btnClickable = await ratingButton.isClickable();
			const btnLocation = await ratingButton.getLocation();
			const btnSize = await ratingButton.getSize();
			console.debug(`[E2E] Rating button details: tag=${btnTag}, class="${btnClass}", text="${btnText}", displayed=${btnDisplayed}, clickable=${btnClickable}, location=`, btnLocation, `size=`, btnSize);
		}

		if (!buttonExists) {
			// Try alternative selectors
			const altButton = browser.$(`.flashcard-rating-buttons button`);
			const altExists = await altButton.isExisting();
			console.debug(`[E2E] Fallback ".flashcard-rating-buttons button" exists: ${altExists}`);
			throw new Error(`Rating button not found for selector: ${ratingClass} button`);
		}

		// Check plugin state BEFORE clicking
		const preClickState = await browser.execute(() => {
			const progressEl = document.querySelector(".flashcard-progress-text");
			const question = document.querySelector(".flashcard-card .flashcard-card-content");
			return {
				progress: progressEl?.textContent ?? "N/A",
				question: question?.textContent?.substring(0, 50) ?? "N/A",
			};
		});
		console.debug(`[E2E] Pre-click state:`, preClickState);

		await ratingButton.click();
		await dumpBrowserLogs();
		console.debug(`[E2E] Rating button clicked via WebDriver`);

		// Immediately check state after click
		await browser.pause(500);
		const postClickState = await browser.execute(() => {
			const progressEl = document.querySelector(".flashcard-progress-text");
			const question = document.querySelector(".flashcard-card .flashcard-card-content");
			const complete = document.querySelector(".flashcard-complete-state");
			const ratingBtns = document.querySelector(".flashcard-rating-buttons");
			const revealBtn = document.querySelector(".flashcard-btn-reveal");
			return {
				progress: progressEl?.textContent ?? "N/A",
				question: question?.textContent?.substring(0, 50) ?? "N/A",
				completeExists: !!complete,
				ratingBtnsExist: !!ratingBtns,
				revealBtnExists: !!revealBtn,
			};
		});
		console.debug(`[E2E] Post-click state (500ms):`, postClickState);

		// Check DOM state details
		const domState = await browser.execute(() => {
			const revealBtn = document.querySelector(".flashcard-btn-reveal");
			return {
				hasRevealBtn: !!revealBtn,
				controlsHTML: document.querySelector(".flashcard-controls")?.innerHTML?.substring(0, 300) ?? "N/A"
			};
		});
		console.debug(`[E2E] DOM state check:`, domState);

		// Wait for actual state change: either completion, different question (new card), or progress update
		await browser.waitUntil(
			async () => {
				// Check if session completed
				const complete = browser.$(".flashcard-complete-state");
				if (await complete.isExisting()) {
					console.debug(`[E2E] Session completed`);
					return true;
				}

				// Check if we moved to a new card (question changed)
				const questionAfter = await getCardQuestion();
				if (questionAfter !== questionBefore) {
					console.debug(`[E2E] Card changed to: "${questionAfter.substring(0, 50)}..."`);
					return true;
				}

				// Check if progress text updated
				const progressAfter = await getProgressText();
				if (progressAfter !== progressBefore) {
					console.debug(`[E2E] Progress updated: "${progressBefore}" -> "${progressAfter}"`);
					return true;
				}

				return false;
			},
			{ timeout: 10000, interval: 200, timeoutMsg: `Rating did not cause state change. Question: "${questionBefore.substring(0, 50)}"` },
		);

		// Additional small delay to ensure render completes
		await browser.pause(100);
		const progressAfter = await getProgressText();
		console.debug(`[E2E] After rating settled: progress="${progressAfter}"`);
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
		console.debug(`[DEBUG] Initial state: text="${initialText}", width="${initialWidth}"`);

		// The initial state should show "0 / N completed"
		expect(initialText).toMatch(/^0\s*\/\s*\d+\s*completed$/);

		// Rate the current card "Easy" so it leaves the due queue entirely
		// (bypasses learning steps and schedules for days later)
		console.debug(`[DEBUG] About to rate card as Easy...`);
		await revealAndRate(".flashcard-btn-easy");
		console.debug(`[DEBUG] Rating complete, checking review state...`);

		// After rating, the review view should still exist (more cards remain)
		const reviewView = browser.$(".flashcard-review");
		const isStillReviewing = await reviewView.isExisting();
		console.debug(`[DEBUG] Still reviewing: ${isStillReviewing}`);

		if (isStillReviewing) {
			// Check for either progress text change or completion
			const completeState = browser.$(".flashcard-complete-state");
			if (await completeState.isExisting()) {
				console.debug(`[DEBUG] All cards completed`);
				// If all cards were completed, that's still a valid outcome
				return;
			}

			// Wait for progress to actually update (poll until changed)
			console.debug(`[DEBUG] Waiting for progress change from: text="${initialText}", width="${initialWidth}"`);
			await browser.waitUntil(
				async () => {
					const afterText = await getProgressText();
					const afterWidth = await getProgressFillWidth();
					console.debug(`[DEBUG] Checking: text="${afterText}", width="${afterWidth}"`);
					return afterText !== initialText || afterWidth !== initialWidth;
				},
				{ timeout: 10000, interval: 200, timeoutMsg: `Progress did not update after rating. Initial: "${initialText}", "${initialWidth}"` },
			);
			console.debug(`[DEBUG] Progress updated successfully`);
		}
	});

	it("progress bar reflects cards leaving the queue", async function () {
		await startReviewSession();

		// Read total card count from the initial progress text
		const initialText = await getProgressText();
		console.debug(`[DEBUG] Initial progress text: "${initialText}"`);
		const initialMatch = initialText.match(
			/(\d+)\s*\/\s*(\d+)\s*completed/,
		);
		expect(initialMatch).not.toBe(null);
		const initialCompleted = Number(initialMatch![1]);
		const initialTotal = Number(initialMatch![2]);
		console.debug(`[DEBUG] Initial completed=${initialCompleted}, total=${initialTotal}`);

		// Rate the card "Easy" so it leaves the due queue (bypasses learning
		// steps and schedules for days later, not just minutes)
		console.debug(`[DEBUG] About to rate card as Easy...`);
		await revealAndRate(".flashcard-btn-easy");
		console.debug(`[DEBUG] Rating complete`);

		// Either: still reviewing with fewer cards, or session complete
		const completeState = browser.$(".flashcard-complete-state");
		const isComplete = await completeState.isExisting();
		console.debug(`[DEBUG] Session complete: ${isComplete}`);

		if (!isComplete) {
			// Wait for completed count to increase (poll until updated)
			console.debug(`[DEBUG] Waiting for completed count to increase from ${initialCompleted}...`);
			await browser.waitUntil(
				async () => {
					const afterText = await getProgressText();
					const afterMatch = afterText.match(
						/(\d+)\s*\/\s*(\d+)\s*completed/,
					);
					if (!afterMatch) {
						console.debug(`[DEBUG] Progress text doesn't match pattern: "${afterText}"`);
						return false;
					}
					const afterCompleted = Number(afterMatch[1]);
					console.debug(`[DEBUG] Current completed: ${afterCompleted}`);
					return afterCompleted > initialCompleted;
				},
				{ timeout: 10000, interval: 200, timeoutMsg: `Completed count did not increase after rating. Initial: ${initialCompleted}` },
			);

			// Final verification
			const afterText = await getProgressText();
			console.debug(`[DEBUG] Final progress text: "${afterText}"`);
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
