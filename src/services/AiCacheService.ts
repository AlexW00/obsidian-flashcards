import { App } from "obsidian";

/**
 * Cache entry storing the rendered output text for an AI pipe call.
 * We store only the rendered text (e.g., "![[image.png]]"), not the blob itself.
 * This means if the user deletes the attachment and regenerates, the cache hit
 * will return the old text reference. User can invalidate cache to re-generate.
 */
export interface AiCacheEntry {
	/** The rendered output text (what gets inserted into the template) */
	output: string;
	/** Timestamp when this entry was cached */
	cachedAt: number;
	/** The pipe type that generated this entry */
	pipeType: "askAi" | "generateImage" | "generateSpeech";
}

/**
 * The cache structure stored in the plugin's data.json
 */
export interface AiCacheData {
	/** Version for future migrations */
	version: 1;
	/** Cache entries keyed by SHA-256 hash of (pipeType + input args) */
	entries: Record<string, AiCacheEntry>;
}

const EMPTY_CACHE: AiCacheData = {
	version: 1,
	entries: {},
};

/**
 * Service for caching AI pipe outputs.
 *
 * Stores rendered text output (not blobs) keyed by hash of pipe inputs.
 * Uses plugin's data.json via loadData/saveData API.
 */
export class AiCacheService {
	private app: App;
	private cache: AiCacheData = EMPTY_CACHE;
	private dirty = false;
	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Callbacks for persisting cache - set by main plugin
	private loadDataFn: (() => Promise<unknown>) | null = null;
	private saveDataFn: ((data: unknown) => Promise<void>) | null = null;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Set the persistence callbacks from the main plugin.
	 */
	setPersistence(
		loadData: () => Promise<unknown>,
		saveData: (data: unknown) => Promise<void>,
	): void {
		this.loadDataFn = loadData;
		this.saveDataFn = saveData;
	}

	/**
	 * Load cache from plugin data.
	 */
	async load(): Promise<void> {
		if (!this.loadDataFn) {
			console.warn("AiCacheService: No loadData function set");
			return;
		}

		try {
			const data = (await this.loadDataFn()) as {
				aiCache?: AiCacheData;
			} | null;
			if (data?.aiCache && data.aiCache.version === 1) {
				this.cache = data.aiCache;
			} else {
				this.cache = { ...EMPTY_CACHE };
			}
		} catch (error) {
			console.error("AiCacheService: Failed to load cache", error);
			this.cache = { ...EMPTY_CACHE };
		}
	}

	/**
	 * Save cache to plugin data (debounced).
	 */
	async save(): Promise<void> {
		if (!this.saveDataFn || !this.loadDataFn) {
			console.warn("AiCacheService: No saveData function set");
			return;
		}

		// Clear any pending debounce
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
		}

		// Debounce saves to avoid excessive writes
		this.saveDebounceTimer = setTimeout(() => {
			void (async () => {
				try {
					// Load current data to merge with
					const currentData =
						((await this.loadDataFn!()) as Record<string, unknown>) ||
						{};
					await this.saveDataFn!({
						...currentData,
						aiCache: this.cache,
					});
					this.dirty = false;
				} catch (error) {
					console.error("AiCacheService: Failed to save cache", error);
				}
			})();
		}, 1000);
	}

	/**
	 * Force immediate save (for shutdown).
	 */
	async forceSave(): Promise<void> {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}

		if (!this.dirty || !this.saveDataFn || !this.loadDataFn) {
			return;
		}

		try {
			const currentData =
				((await this.loadDataFn()) as Record<string, unknown>) || {};
			await this.saveDataFn({
				...currentData,
				aiCache: this.cache,
			});
			this.dirty = false;
		} catch (error) {
			console.error("AiCacheService: Failed to force save cache", error);
		}
	}

	/**
	 * Generate a cache key from pipe type and input arguments.
	 * Uses SHA-256 hash of the concatenated inputs.
	 */
	async generateKey(
		pipeType: "askAi" | "generateImage" | "generateSpeech",
		...args: unknown[]
	): Promise<string> {
		const input = JSON.stringify({ pipeType, args });
		const encoder = new TextEncoder();
		const data = encoder.encode(input);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * Get a cached entry if it exists.
	 */
	get(key: string): AiCacheEntry | null {
		return this.cache.entries[key] ?? null;
	}

	/**
	 * Set a cache entry.
	 */
	set(
		key: string,
		output: string,
		pipeType: "askAi" | "generateImage" | "generateSpeech",
	): void {
		this.cache.entries[key] = {
			output,
			cachedAt: Date.now(),
			pipeType,
		};
		this.dirty = true;
		void this.save();
	}

	/**
	 * Delete a specific cache entry.
	 */
	delete(key: string): boolean {
		if (key in this.cache.entries) {
			delete this.cache.entries[key];
			this.dirty = true;
			void this.save();
			return true;
		}
		return false;
	}

	/**
	 * Clear all cache entries.
	 */
	clearAll(): void {
		this.cache = { ...EMPTY_CACHE };
		this.dirty = true;
		void this.save();
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): { entryCount: number; oldestEntry: number | null } {
		const entries = Object.values(this.cache.entries);
		const oldestEntry =
			entries.length > 0
				? Math.min(...entries.map((e) => e.cachedAt))
				: null;
		return {
			entryCount: entries.length,
			oldestEntry,
		};
	}
}
