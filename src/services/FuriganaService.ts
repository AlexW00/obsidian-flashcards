import type { App } from "obsidian";
import type { Tokenizer } from "@patdx/kuromoji";
import type { DictionaryManager } from "./DictionaryManager";
import * as kuromoji from "@patdx/kuromoji";
import pako from "pako";

/**
 * Service for converting Japanese text to furigana format.
 * Uses kuromoji tokenizer to identify kanji and their readings.
 */
export class FuriganaService {
	private tokenizer: Tokenizer | null = null;
	private initPromise: Promise<void> | null = null;
	private isReady = false;
	private app: App;
	private dictManager: DictionaryManager;

	constructor(app: App, dictManager: DictionaryManager) {
		this.app = app;
		this.dictManager = dictManager;
	}

	/**
	 * Initialize the tokenizer. Called lazily on first use.
	 */
	private async initialize(): Promise<void> {
		if (this.isReady) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			const dictPath = this.dictManager.getDictPath();

			// Create custom loader that uses Obsidian's file system API
			const adapter = this.app.vault.adapter;
			const customLoader = {
				loadArrayBuffer: async (
					url: string,
				): Promise<ArrayBufferLike> => {
					// Extract filename from URL (kuromoji passes full URLs)
					const filename = url.split("/").pop() ?? url;
					const filePath = `${dictPath}/${filename}`;

					// Read compressed file using Obsidian's adapter
					const compressedData = await adapter.readBinary(filePath);

					// Decompress gzip data using pako
					const decompressed = pako.ungzip(
						new Uint8Array(compressedData),
					);
					return decompressed.buffer;
				},
			};

			// Build tokenizer with custom loader
			const tokenizer = await kuromoji
				.builder({
					dicPath: dictPath,
					loader: customLoader,
				})
				.build();

			this.tokenizer = tokenizer;
			this.isReady = true;
		})();

		return this.initPromise;
	}

	/**
	 * Check if the kanji has mixed readings (contains kanji).
	 */
	private containsKanji(text: string): boolean {
		// Kanji Unicode range: 4E00-9FAF (CJK Unified Ideographs)
		return /[\u4e00-\u9faf]/.test(text);
	}

	/**
	 * Convert katakana to hiragana.
	 */
	private katakanaToHiragana(str: string): string {
		return str.replace(/[\u30a1-\u30f6]/g, (match) => {
			return String.fromCharCode(match.charCodeAt(0) - 0x60);
		});
	}

	/**
	 * Format furigana based on the configured format.
	 */
	private formatFurigana(
		kanji: string,
		reading: string,
		format: "curly" | "ruby" | "parentheses" | "brackets",
	): string {
		switch (format) {
			case "ruby":
				return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
			case "parentheses":
				return `${kanji}(${reading})`;
			case "brackets":
				return `${kanji}[${reading}]`;
			case "curly":
			default:
				return `{${kanji}|${reading}}`;
		}
	}

	/**
	 * Convert Japanese text to furigana format.
	 * @param text Input text that may contain kanji
	 * @param format Output format for furigana
	 * @returns Text with furigana annotations
	 */
	async convert(
		text: string,
		format: "curly" | "ruby" | "parentheses" | "brackets" = "ruby",
	): Promise<string> {
		if (!text || text.trim().length === 0) {
			return text;
		}

		// Initialize tokenizer if not ready
		await this.initialize();

		if (!this.tokenizer) {
			throw new Error("Tokenizer failed to initialize");
		}

		// Tokenize the text
		const tokens = this.tokenizer.tokenize(text);

		// Build result with furigana annotations
		let result = "";
		for (const token of tokens) {
			const surface = token.surface_form;
			const reading = token.reading;

			// If no reading or doesn't contain kanji, use surface as-is
			if (!reading || !this.containsKanji(surface)) {
				result += surface;
				continue;
			}

			// Convert reading from katakana to hiragana
			const hiraganaReading = this.katakanaToHiragana(reading);

			// If reading equals surface, no furigana needed
			if (surface === hiraganaReading) {
				result += surface;
				continue;
			}

			// Add furigana annotation using configured format
			result += this.formatFurigana(surface, hiraganaReading, format);
		}

		return result;
	}

	/**
	 * Check if the service is initialized and ready.
	 */
	getIsReady(): boolean {
		return this.isReady;
	}
}
