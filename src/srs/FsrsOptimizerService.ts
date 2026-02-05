import type { ReviewLogData } from "./ReviewLogStore";

/**
 * Result of FSRS parameter optimization.
 */
export interface OptimizationResult {
	/** Optimized FSRS weights (19 or 21 values depending on short-term setting) */
	weights: number[];
	/** Number of cards with review history used for optimization */
	cardsUsed: number;
	/** Total number of reviews used for optimization */
	reviewsUsed: number;
}

/**
 * Progress callback for optimization.
 */
export type OptimizationProgressCallback = (
	current: number,
	total: number,
) => void;

/**
 * Service for optimizing FSRS parameters based on review history.
 *
 * Uses fsrs-browser WebAssembly module for browser-compatible optimization.
 */
export class FsrsOptimizerService {
	private initialized = false;
	private FsrsClass: typeof import("fsrs-browser/fsrs_browser").Fsrs | null =
		null;
	private ProgressClass:
		| typeof import("fsrs-browser/fsrs_browser").Progress
		| null = null;

	/**
	 * Initialize the WASM module. Must be called before optimization.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			const fsrsBrowser = await import("fsrs-browser/fsrs_browser");
			await fsrsBrowser.default();
			this.FsrsClass = fsrsBrowser.Fsrs;
			this.ProgressClass = fsrsBrowser.Progress;
			this.initialized = true;
		} catch (error) {
			throw new Error(
				`Failed to initialize FSRS optimizer: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Check if the optimizer has been initialized.
	 */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Optimize FSRS parameters from review log data.
	 *
	 * @param reviewLogData - Review history keyed by card path
	 * @param enableShortTerm - Whether to include short-term learning data
	 * @param onProgress - Optional progress callback
	 * @returns Optimization result with new weights
	 */
	async optimize(
		reviewLogData: ReviewLogData,
		enableShortTerm: boolean = true,
		onProgress?: OptimizationProgressCallback,
	): Promise<OptimizationResult> {
		if (!this.initialized || !this.FsrsClass || !this.ProgressClass) {
			await this.initialize();
		}

		// Collect review data
		const { ratings, deltaDays, lengths, cardsUsed, reviewsUsed } =
			this.collectReviewData(reviewLogData);

		if (reviewsUsed < 50) {
			throw new Error(
				`Insufficient review data for optimization. Need at least 50 reviews, found ${reviewsUsed}. Keep reviewing cards to collect more data.`,
			);
		}

		// Create FSRS optimizer instance
		const fsrs = new this.FsrsClass!();
		const progress = this.ProgressClass!.new();

		try {
			// Run optimization
			const parameters = fsrs.computeParameters(
				new Uint32Array(ratings),
				new Uint32Array(deltaDays),
				new Uint32Array(lengths),
				progress,
				enableShortTerm,
			);

			// Convert Float32Array to regular number array
			const weights = Array.from(parameters);

			return {
				weights,
				cardsUsed,
				reviewsUsed,
			};
		} finally {
			// Clean up WASM resources
			fsrs.free();
		}
	}

	/**
	 * Collect and format review data for optimization.
	 *
	 * The fsrs-browser computeParameters expects:
	 * - ratings: flat array of ratings for all cards (1-4)
	 * - deltaDays: flat array of days since previous review (0 for first)
	 * - lengths: array with number of reviews per card
	 */
	private collectReviewData(reviewLogData: ReviewLogData): {
		ratings: number[];
		deltaDays: number[];
		lengths: number[];
		cardsUsed: number;
		reviewsUsed: number;
	} {
		const ratings: number[] = [];
		const deltaDays: number[] = [];
		const lengths: number[] = [];
		let cardsUsed = 0;
		let reviewsUsed = 0;

		for (const entries of Object.values(reviewLogData)) {
			if (!entries || entries.length === 0) {
				continue;
			}

			// Add reviews for this card
			for (const entry of entries) {
				ratings.push(entry.rating);
				deltaDays.push(Math.floor(entry.elapsed_days));
			}

			lengths.push(entries.length);
			cardsUsed++;
			reviewsUsed += entries.length;
		}

		return { ratings, deltaDays, lengths, cardsUsed, reviewsUsed };
	}
}
