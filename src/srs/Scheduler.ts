import { fsrs, FSRS, Rating, Card } from "ts-fsrs";
import type { ReviewState } from "../types";

/**
 * FSRS scheduler wrapper for flashcard reviews.
 */
export class Scheduler {
	private fsrs: FSRS;

	constructor() {
		// Use default FSRS parameters
		this.fsrs = fsrs();
	}

	/**
	 * Convert our ReviewState to ts-fsrs Card format.
	 */
	private toFsrsCard(state: ReviewState): Card {
		return {
			due: new Date(state.due),
			stability: state.stability,
			difficulty: state.difficulty,
			elapsed_days: state.elapsed_days,
			scheduled_days: state.scheduled_days,
			reps: state.reps,
			lapses: state.lapses,
			state: state.state,
			last_review: state.last_review
				? new Date(state.last_review)
				: undefined,
			learning_steps: 0,
		};
	}

	/**
	 * Convert ts-fsrs Card back to our ReviewState format.
	 */
	private toReviewState(card: Card): ReviewState {
		return {
			due: card.due.toISOString(),
			stability: card.stability,
			difficulty: card.difficulty,
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			elapsed_days: card.elapsed_days,
			scheduled_days: card.scheduled_days,
			reps: card.reps,
			lapses: card.lapses,
			state: card.state,
			last_review: card.last_review?.toISOString(),
		};
	}

	/**
	 * Process a review and get the new state for each possible rating.
	 * Returns an object with the new state and next review date for each rating.
	 */
	getNextStates(currentState: ReviewState): {
		again: { state: ReviewState; interval: string };
		hard: { state: ReviewState; interval: string };
		good: { state: ReviewState; interval: string };
		easy: { state: ReviewState; interval: string };
	} {
		const card = this.toFsrsCard(currentState);
		const now = new Date();
		const scheduling = this.fsrs.repeat(card, now);

		return {
			again: {
				state: this.toReviewState(scheduling[Rating.Again].card),
				interval: this.formatInterval(
					scheduling[Rating.Again].card.due,
					now,
				),
			},
			hard: {
				state: this.toReviewState(scheduling[Rating.Hard].card),
				interval: this.formatInterval(
					scheduling[Rating.Hard].card.due,
					now,
				),
			},
			good: {
				state: this.toReviewState(scheduling[Rating.Good].card),
				interval: this.formatInterval(
					scheduling[Rating.Good].card.due,
					now,
				),
			},
			easy: {
				state: this.toReviewState(scheduling[Rating.Easy].card),
				interval: this.formatInterval(
					scheduling[Rating.Easy].card.due,
					now,
				),
			},
		};
	}

	/**
	 * Process a review with the given rating and return the new state.
	 */
	review(currentState: ReviewState, rating: Rating): ReviewState {
		const card = this.toFsrsCard(currentState);
		const now = new Date();
		const scheduling = this.fsrs.repeat(card, now);

		// Access the scheduling result based on rating
		let result;
		switch (rating) {
			case Rating.Again:
				result = scheduling[Rating.Again];
				break;
			case Rating.Hard:
				result = scheduling[Rating.Hard];
				break;
			case Rating.Good:
				result = scheduling[Rating.Good];
				break;
			case Rating.Easy:
				result = scheduling[Rating.Easy];
				break;
			default:
				throw new Error(`Invalid rating: ${rating}`);
		}

		return this.toReviewState(result.card);
	}

	/**
	 * Format an interval for display (e.g., "1m", "10m", "1d", "5d").
	 */
	private formatInterval(dueDate: Date, now: Date): string {
		const diffMs = dueDate.getTime() - now.getTime();
		const diffMins = Math.round(diffMs / (1000 * 60));
		const diffHours = Math.round(diffMs / (1000 * 60 * 60));
		const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
		const diffMonths = Math.round(diffDays / 30);
		const diffYears = Math.round(diffDays / 365);

		if (diffMins < 1) return "<1m";
		if (diffMins < 60) return `${diffMins}m`;
		if (diffHours < 24) return `${diffHours}h`;
		if (diffDays < 30) return `${diffDays}d`;
		if (diffMonths < 12) return `${diffMonths}mo`;
		return `${diffYears}y`;
	}
}

// Re-export Rating for convenience
export { Rating };
