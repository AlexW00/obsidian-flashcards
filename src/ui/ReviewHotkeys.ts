import { Scope } from "obsidian";
import { Rating } from "../srs/Scheduler";

/**
 * Session state required for hotkey handling.
 */
export interface ReviewSessionState {
	currentSide: number;
	totalSides: number;
}

/**
 * Callbacks for hotkey actions.
 */
export interface ReviewHotkeyCallbacks {
	getSession: () => ReviewSessionState | null;
	revealNext: () => void;
	rateCard: (rating: Rating) => Promise<void>;
	editCurrentCard: () => Promise<void>;
	openCurrentCard: () => Promise<void>;
}

/**
 * Register keyboard shortcuts for the review view.
 * These are scoped to the view and only active when it's focused.
 *
 * Hotkeys:
 * - Space: reveal next side or rate as "Good"
 * - E: edit current card
 * - O: open current card note
 * - 1: rate as Again
 * - 2: rate as Hard
 * - 3: rate as Good
 * - 4: rate as Easy
 */
export function registerReviewHotkeys(
	scope: Scope,
	callbacks: ReviewHotkeyCallbacks,
): void {
	// Space - reveal next side or rate as "Good"
	scope.register([], " ", () => {
		const session = callbacks.getSession();
		if (!session) return;
		const isLastSide = session.currentSide >= session.totalSides - 1;
		if (!isLastSide) {
			callbacks.revealNext();
		} else {
			void callbacks.rateCard(Rating.Good);
		}
		return false;
	});

	// E - edit current card
	scope.register([], "e", () => {
		void callbacks.editCurrentCard();
		return false;
	});

	// O - open current card note
	scope.register([], "o", () => {
		void callbacks.openCurrentCard();
		return false;
	});

	// 1 - rate as Again
	scope.register([], "1", () => {
		const session = callbacks.getSession();
		if (!session) return;
		const isLastSide = session.currentSide >= session.totalSides - 1;
		if (isLastSide) {
			void callbacks.rateCard(Rating.Again);
		}
		return false;
	});

	// 2 - rate as Hard
	scope.register([], "2", () => {
		const session = callbacks.getSession();
		if (!session) return;
		const isLastSide = session.currentSide >= session.totalSides - 1;
		if (isLastSide) {
			void callbacks.rateCard(Rating.Hard);
		}
		return false;
	});

	// 3 - rate as Good
	scope.register([], "3", () => {
		const session = callbacks.getSession();
		if (!session) return;
		const isLastSide = session.currentSide >= session.totalSides - 1;
		if (isLastSide) {
			void callbacks.rateCard(Rating.Good);
		}
		return false;
	});

	// 4 - rate as Easy
	scope.register([], "4", () => {
		const session = callbacks.getSession();
		if (!session) return;
		const isLastSide = session.currentSide >= session.totalSides - 1;
		if (isLastSide) {
			void callbacks.rateCard(Rating.Easy);
		}
		return false;
	});
}
