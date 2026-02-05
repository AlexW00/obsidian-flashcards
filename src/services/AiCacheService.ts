import { App, TFile, stringifyYaml } from "obsidian";
import type { DynamicPipeCacheEntry, FlashcardFrontmatter } from "../types";

/**
 * Service for caching dynamic pipe outputs in flashcard frontmatter.
 *
 * Stores rendered text output (not blobs) keyed by hash of pipe inputs.
 * Cache is stored per-card in the `_cache` frontmatter property.
 */
export class AiCacheService {
	private app: App;

	/**
	 * Pending cache writes during a single render operation.
	 * Accumulated here and flushed to frontmatter after render completes.
	 */
	private pendingWrites: Map<string, DynamicPipeCacheEntry> = new Map();

	constructor(app: App) {
		this.app = app;
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
	 * Get a cached entry from a card's frontmatter.
	 * @param cardPath Path to the flashcard file
	 * @param key Cache key (hash)
	 * @returns The cached entry or null if not found
	 */
	get(cardPath: string, key: string): DynamicPipeCacheEntry | null {
		// First check pending writes from current render
		const pending = this.pendingWrites.get(key);
		if (pending) {
			return pending;
		}

		// Then check persisted frontmatter cache
		const file = this.app.vault.getAbstractFileByPath(cardPath);
		if (!(file instanceof TFile)) {
			return null;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;
		return fm?._cache?.[key] ?? null;
	}

	/**
	 * Queue a cache entry to be written after render completes.
	 * @param key Cache key (hash)
	 * @param output The rendered output text
	 */
	set(key: string, output: string): void {
		this.pendingWrites.set(key, {
			output,
			cachedAt: Date.now(),
		});
	}

	/**
	 * Get all pending cache writes and clear them.
	 * Called by CardService after render to merge into frontmatter.
	 */
	flushPendingWrites(): Map<string, DynamicPipeCacheEntry> {
		const writes = this.pendingWrites;
		this.pendingWrites = new Map();
		return writes;
	}

	/**
	 * Clear pending writes without flushing (e.g., on render error).
	 */
	clearPendingWrites(): void {
		this.pendingWrites.clear();
	}

	/**
	 * Clear cache for a specific card by removing `_cache` from its frontmatter.
	 * @param file The flashcard file
	 */
	async clearForFile(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (!fm?._cache || Object.keys(fm._cache).length === 0) {
			return; // No cache to clear
		}

		// Remove _cache from frontmatter
		const updatedFm = { ...fm };
		delete updatedFm._cache;

		// Rebuild file content
		const body = this.extractBody(content);
		const newContent = this.buildFileContent(updatedFm, body);

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Clear cache from all flashcards in the vault.
	 * @param getAllFlashcardPaths Function to get all flashcard file paths
	 */
	async clearAll(
		getAllFlashcardPaths: () => string[],
	): Promise<{ cleared: number; total: number }> {
		const paths = getAllFlashcardPaths();
		let cleared = 0;

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(file);
				const fm = cache?.frontmatter as
					| FlashcardFrontmatter
					| undefined;
				if (fm?._cache && Object.keys(fm._cache).length > 0) {
					await this.clearForFile(file);
					cleared++;
				}
			}
		}

		return { cleared, total: paths.length };
	}

	/**
	 * Extract body content from a flashcard file (everything after frontmatter).
	 */
	private extractBody(content: string): string {
		const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
		if (frontmatterMatch) {
			return content.slice(frontmatterMatch[0].length);
		}
		return content;
	}

	/**
	 * Build file content from frontmatter and body.
	 */
	private buildFileContent(
		frontmatter: Record<string, unknown>,
		body: string,
	): string {
		const yamlContent = stringifyYaml(frontmatter);
		return `---\n${yamlContent}---\n${body}`;
	}
}
