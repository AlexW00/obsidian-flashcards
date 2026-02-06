import { App } from "obsidian";
import type { ReviewLogEntry } from "../types";
import { debugLog } from "../types";

/**
 * File name for the review history JSONL stored in the plugin folder.
 */
const REVIEW_LOG_FILENAME = "review-history.jsonl";

/**
 * Shape of the in-memory review history data.
 *
 * Keys are stable card IDs (UUID v4 from frontmatter._id);
 * values are arrays of review entries.
 */
export interface ReviewLogData {
	[cardId: string]: ReviewLogEntry[];
}

/**
 * Centralized store for review history, persisted as a JSONL file
 * in the plugin's config folder (`.obsidian/plugins/anker/`).
 *
 * This keeps review log data out of the Markdown frontmatter so
 * card files stay clean. The file can be reset from settings.
 */
export class ReviewLogStore {
	private app: App;
	private pluginId: string;
	private data: ReviewLogData = {};
	private dirty = false;

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginId = pluginId;
	}

	/**
	 * Load review history from disk. Call once during plugin init.
	 */
	async load(): Promise<void> {
		const path = this.filePath();
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) {
				this.data = {};
				return;
			}
			await this.loadJsonl(path);
			debugLog(
				"ReviewLogStore: loaded %d cards from %s",
				Object.keys(this.data).length,
				path,
			);
		} catch {
			debugLog("ReviewLogStore: failed to load, starting fresh");
			this.data = {};
		}
	}

	/**
	 * Persist current data to disk by rewriting the JSONL file.
	 */
	async save(): Promise<void> {
		if (!this.dirty) return;
		const path = this.filePath();
		await this.writeFullJsonl(path);
		this.dirty = false;
	}

	/**
	 * Append a review log entry for a card.
	 */
	async addEntry(cardId: string, entry: ReviewLogEntry): Promise<void> {
		if (!this.data[cardId]) {
			this.data[cardId] = [];
		}
		this.data[cardId].push(entry);
		await this.appendEntry(cardId, entry);
	}

	/**
	 * Get all entries for a specific card.
	 */
	getEntries(cardId: string): ReviewLogEntry[] {
		return this.data[cardId] ?? [];
	}

	/**
	 * Get the full review log data.
	 */
	getAllData(): ReviewLogData {
		return this.data;
	}

	/**
	 * Get statistics about stored review data.
	 */
	getStats(totalCards: number): {
		cardsWithHistory: number;
		totalReviews: number;
		totalCards: number;
		canOptimize: boolean;
	} {
		let cardsWithHistory = 0;
		let totalReviews = 0;

		for (const entries of Object.values(this.data)) {
			if (entries.length > 0) {
				cardsWithHistory++;
				totalReviews += entries.length;
			}
		}

		return {
			cardsWithHistory,
			totalReviews,
			totalCards,
			canOptimize: totalReviews >= 50,
		};
	}

	/**
	 * Delete all review history. Returns number of cards cleared.
	 */
	async reset(): Promise<number> {
		const count = Object.keys(this.data).length;
		this.data = {};
		this.dirty = true;
		await this.save();
		return count;
	}

	/**
	 * Resolve the file path inside the plugin config folder.
	 */
	private filePath(): string {
		return `${this.app.vault.configDir}/plugins/${this.pluginId}/${REVIEW_LOG_FILENAME}`;
	}

	private logDirPath(): string {
		return `${this.app.vault.configDir}/plugins/${this.pluginId}`;
	}

	private async ensureLogDir(): Promise<void> {
		const path = this.logDirPath();
		const exists = await this.app.vault.adapter.exists(path);
		if (!exists) {
			await this.app.vault.adapter.mkdir(path);
		}
	}

	private async loadJsonl(path: string): Promise<void> {
		const raw = await this.app.vault.adapter.read(path);
		this.data = {};
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as {
					cardId?: string;
					entry?: ReviewLogEntry;
				};
				if (!parsed.cardId || !parsed.entry) continue;
				if (!this.data[parsed.cardId]) {
					this.data[parsed.cardId] = [];
				}
				this.data[parsed.cardId]!.push(parsed.entry);
			} catch {
				// Skip malformed lines to avoid failing the whole load.
				continue;
			}
		}
	}

	private async writeFullJsonl(path: string): Promise<void> {
		await this.ensureLogDir();
		const lines: string[] = [];
		for (const [cardId, entries] of Object.entries(this.data)) {
			for (const entry of entries) {
				lines.push(JSON.stringify({ cardId, entry }));
			}
		}
		const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
		await this.app.vault.adapter.write(path, content);
	}

	private async appendEntry(
		cardId: string,
		entry: ReviewLogEntry,
	): Promise<void> {
		await this.ensureLogDir();
		const path = this.filePath();
		const line = `${JSON.stringify({ cardId, entry })}\n`;
		const exists = await this.app.vault.adapter.exists(path);
		if (!exists) {
			await this.app.vault.adapter.write(path, line);
			return;
		}
		await this.app.vault.adapter.append(path, line);
	}
}
