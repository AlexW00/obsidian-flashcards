import { describe, it, expect, beforeEach } from "vitest";
import { Scheduler, Rating } from "./Scheduler";
import { State } from "ts-fsrs";
import type { FlashcardsPluginSettings, ReviewState } from "../types";

/**
 * Create minimal mock settings for Scheduler tests.
 */
function createMockSettings(
	overrides: Partial<FlashcardsPluginSettings> = {},
): FlashcardsPluginSettings {
	return {
		fsrsRequestRetention: 0.9,
		fsrsMaximumInterval: 36500,
		fsrsEnableFuzz: false, // Disable fuzz for deterministic tests
		fsrsEnableShortTerm: true,
		fsrsLearningSteps: ["1m", "10m"], // Must be strings like "1m", "10m"
		fsrsRelearningSteps: ["10m"],
		fsrsWeights: [],
		...overrides,
	} as FlashcardsPluginSettings;
}

/**
 * Create a new card state (never reviewed).
 */
function createNewCardState(): ReviewState {
	return {
		due: new Date().toISOString(),
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 0,
		lapses: 0,
		state: State.New,
		last_review: undefined,
	};
}

/**
 * Create a card in Review state with some history.
 */
function createReviewCardState(): ReviewState {
	const lastReview = new Date();
	lastReview.setDate(lastReview.getDate() - 5);

	return {
		due: new Date().toISOString(),
		stability: 10,
		difficulty: 5,
		elapsed_days: 5,
		scheduled_days: 5,
		reps: 5,
		lapses: 0,
		state: State.Review,
		last_review: lastReview.toISOString(),
	};
}

describe("Scheduler", () => {
	let scheduler: Scheduler;

	beforeEach(() => {
		scheduler = new Scheduler(createMockSettings());
	});

	describe("formatInterval", () => {
		// We need to test the private formatInterval method indirectly through getNextStates
		// or make it accessible. For now, we'll test it via getNextStates output.

		it("should format intervals for new card states", () => {
			const state = createNewCardState();
			const nextStates = scheduler.getNextStates(state);

			// All intervals should be string format with unit suffix
			expect(nextStates.again.interval).toMatch(/^(<1m|\d+[mhd]|mo|y)$/);
			expect(nextStates.hard.interval).toMatch(/^(<1m|\d+[mhd]|mo|y)$/);
			expect(nextStates.good.interval).toMatch(/^(<1m|\d+[mhd]|mo|y)$/);
			expect(nextStates.easy.interval).toMatch(/^(<1m|\d+[mhd]|mo|y)$/);
		});

		it("should produce progressively longer intervals for better ratings", () => {
			const state = createReviewCardState();
			const nextStates = scheduler.getNextStates(state);

			// Parse intervals to compare (need to handle different units)
			const parseInterval = (s: string): number => {
				if (s === "<1m") return 0;
				const num = parseInt(s);
				if (s.endsWith("m")) return num;
				if (s.endsWith("h")) return num * 60;
				if (s.endsWith("d")) return num * 60 * 24;
				if (s.endsWith("mo")) return num * 60 * 24 * 30;
				if (s.endsWith("y")) return num * 60 * 24 * 365;
				return num;
			};

			const againMins = parseInterval(nextStates.again.interval);
			const hardMins = parseInterval(nextStates.hard.interval);
			const goodMins = parseInterval(nextStates.good.interval);
			const easyMins = parseInterval(nextStates.easy.interval);

			// For a card in review state, ratings should produce progressively longer intervals
			// (Again resets learning, so it's shortest)
			expect(againMins).toBeLessThanOrEqual(hardMins);
			expect(hardMins).toBeLessThanOrEqual(goodMins);
			expect(goodMins).toBeLessThanOrEqual(easyMins);
		});
	});

	describe("getNextStates", () => {
		it("should return states for all four ratings", () => {
			const state = createNewCardState();
			const nextStates = scheduler.getNextStates(state);

			expect(nextStates).toHaveProperty("again");
			expect(nextStates).toHaveProperty("hard");
			expect(nextStates).toHaveProperty("good");
			expect(nextStates).toHaveProperty("easy");
		});

		it("should return valid ReviewState objects", () => {
			const state = createNewCardState();
			const nextStates = scheduler.getNextStates(state);

			for (const rating of ["again", "hard", "good", "easy"] as const) {
				const result = nextStates[rating].state;
				expect(result.due).toBeDefined();
				expect(typeof result.stability).toBe("number");
				expect(typeof result.difficulty).toBe("number");
				expect(typeof result.reps).toBe("number");
				expect(typeof result.lapses).toBe("number");
				expect(result.state).toBeGreaterThanOrEqual(0);
				expect(result.state).toBeLessThanOrEqual(3);
			}
		});

		it("should increment reps for non-Again ratings on new cards", () => {
			const state = createNewCardState();
			const nextStates = scheduler.getNextStates(state);

			// Good and Easy should increment reps
			expect(nextStates.good.state.reps).toBeGreaterThan(state.reps);
			expect(nextStates.easy.state.reps).toBeGreaterThan(state.reps);
		});

		it("should update due date to the future", () => {
			const state = createNewCardState();
			const now = new Date();
			const nextStates = scheduler.getNextStates(state);

			for (const rating of ["again", "hard", "good", "easy"] as const) {
				const dueDate = new Date(nextStates[rating].state.due);
				expect(dueDate.getTime()).toBeGreaterThanOrEqual(now.getTime());
			}
		});
	});

	describe("review", () => {
		it("should process Again rating correctly", () => {
			const state = createReviewCardState();
			const result = scheduler.review(state, Rating.Again);

			// Again increases lapses
			expect(result.state.lapses).toBe(state.lapses + 1);
			// State changes to Relearning
			expect(result.state.state).toBe(State.Relearning);
		});

		it("should process Good rating correctly", () => {
			const state = createNewCardState();
			const result = scheduler.review(state, Rating.Good);

			// Reps should increase
			expect(result.state.reps).toBe(state.reps + 1);
			// Due date should be in the future
			const dueDate = new Date(String(result.state.due));
			expect(dueDate.getTime()).toBeGreaterThan(
				new Date().getTime() - 1000,
			);
		});

		it("should process Easy rating correctly", () => {
			const state = createNewCardState();
			const result = scheduler.review(state, Rating.Easy);

			// Reps should increase
			expect(result.state.reps).toBe(state.reps + 1);
			// Easy on new card should transition to Review state
			expect(result.state.state).toBe(State.Review);
		});

		it("should set last_review timestamp", () => {
			const state = createNewCardState();
			const before = new Date();
			const result = scheduler.review(state, Rating.Good);
			const after = new Date();

			expect(result.state.last_review).toBeDefined();
			const lastReview = new Date(String(result.state.last_review));
			expect(lastReview.getTime()).toBeGreaterThanOrEqual(
				before.getTime() - 1000,
			);
			expect(lastReview.getTime()).toBeLessThanOrEqual(
				after.getTime() + 1000,
			);
		});

		it("should return log entry with review data", () => {
			const state = createReviewCardState();
			state.elapsed_days = 7;
			const before = new Date();
			const result = scheduler.review(state, Rating.Good);
			const after = new Date();

			// Log entry should capture the review
			expect(result.logEntry).toBeDefined();
			expect(result.logEntry.rating).toBe(Rating.Good);
			expect(result.logEntry.elapsed_days).toBe(7);

			const logTime = new Date(result.logEntry.timestamp);
			expect(logTime.getTime()).toBeGreaterThanOrEqual(
				before.getTime() - 1000,
			);
			expect(logTime.getTime()).toBeLessThanOrEqual(
				after.getTime() + 1000,
			);
		});

		it("should throw for invalid rating", () => {
			const state = createNewCardState();
			// @ts-expect-error Testing invalid input
			expect(() => scheduler.review(state, 99)).toThrow("Invalid rating");
		});
	});

	describe("updateSettings", () => {
		it("should apply new retention settings", () => {
			const state = createReviewCardState();

			// Get intervals with default 0.9 retention
			const normalIntervals = scheduler.getNextStates(state);

			// Update to lower retention (0.7)
			scheduler.updateSettings(
				createMockSettings({ fsrsRequestRetention: 0.7 }),
			);
			const lowRetentionIntervals = scheduler.getNextStates(state);

			// Lower retention = longer intervals (easier to maintain)
			// Parse the "good" interval to compare
			const parseInterval = (s: string): number => {
				if (s === "<1m") return 0;
				const num = parseInt(s);
				if (s.endsWith("m")) return num;
				if (s.endsWith("h")) return num * 60;
				if (s.endsWith("d")) return num * 60 * 24;
				if (s.endsWith("mo")) return num * 60 * 24 * 30;
				if (s.endsWith("y")) return num * 60 * 24 * 365;
				return num;
			};

			const normalGood = parseInterval(normalIntervals.good.interval);
			const lowRetentionGood = parseInterval(
				lowRetentionIntervals.good.interval,
			);

			// With lower desired retention, FSRS schedules longer intervals
			expect(lowRetentionGood).toBeGreaterThanOrEqual(normalGood);
		});
	});

	describe("state transitions", () => {
		it("New -> Learning (on first review)", () => {
			const state = createNewCardState();
			expect(state.state).toBe(State.New);

			const result = scheduler.review(state, Rating.Good);
			// With short-term scheduling enabled, Good on New goes to Learning
			expect([State.Learning, State.Review]).toContain(result.state.state);
		});

		it("Learning -> Review (after graduating)", () => {
			// Simulate a card in learning
			const learningState: ReviewState = {
				due: new Date().toISOString(),
				stability: 1,
				difficulty: 5,
				elapsed_days: 0,
				scheduled_days: 0,
				reps: 1,
				lapses: 0,
				state: State.Learning,
				last_review: new Date().toISOString(),
			};

			// Multiple Good ratings should eventually graduate to Review
			let current = learningState;
			for (let i = 0; i < 5; i++) {
				const result = scheduler.review(current, Rating.Easy);
				current = result.state;
				if (current.state === State.Review) break;
			}

			// Easy should eventually graduate
			expect(current.state).toBe(State.Review);
		});

		it("Review -> Relearning (on Again)", () => {
			const state = createReviewCardState();
			expect(state.state).toBe(State.Review);

			const result = scheduler.review(state, Rating.Again);
			expect(result.state.state).toBe(State.Relearning);
			expect(result.state.lapses).toBe(state.lapses + 1);
		});
	});
});
