/**
 * Integration tests for FuriganaService using the real kuromoji dictionary files.
 *
 * These tests verify the complete furigana conversion pipeline using actual
 * dictionary data from resources/dict/.
 */
/* eslint-disable import/no-nodejs-modules */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as kuromoji from "@patdx/kuromoji";
import type { Tokenizer } from "@patdx/kuromoji";
import pako from "pako";

type FuriganaFormat = "curly" | "ruby" | "parentheses" | "brackets";

/**
 * Get the path to the dictionary directory.
 */
function getDictPath(): string {
	// eslint-disable-next-line no-undef
	return join(process.cwd(), "resources", "dict");
}

/**
 * Check if text contains kanji characters.
 */
function containsKanji(text: string): boolean {
	return /[\u4e00-\u9faf]/.test(text);
}

/**
 * Convert katakana to hiragana.
 */
function katakanaToHiragana(str: string): string {
	return str.replace(/[\u30a1-\u30f6]/g, (match) => {
		return String.fromCharCode(match.charCodeAt(0) - 0x60);
	});
}

/**
 * Format furigana based on the configured format.
 */
function formatFurigana(
	kanji: string,
	reading: string,
	format: FuriganaFormat,
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
 * Convert text to furigana using the tokenizer.
 * Replicates FuriganaService.convert() logic for testing.
 */
function convertToFurigana(
	tokenizer: Tokenizer,
	text: string,
	format: FuriganaFormat = "ruby",
): string {
	if (!text || text.trim().length === 0) {
		return text;
	}

	const tokens = tokenizer.tokenize(text);
	let result = "";

	for (const token of tokens) {
		const surface = token.surface_form;
		const reading = token.reading;

		// If no reading or doesn't contain kanji, use surface as-is
		if (!reading || !containsKanji(surface)) {
			result += surface;
			continue;
		}

		// Convert reading from katakana to hiragana
		const hiraganaReading = katakanaToHiragana(reading);

		// If reading equals surface, no furigana needed
		if (surface === hiraganaReading) {
			result += surface;
			continue;
		}

		// Add furigana annotation
		result += formatFurigana(surface, hiraganaReading, format);
	}

	return result;
}

describe("Furigana Conversion Integration", () => {
	let tokenizer: Tokenizer;

	beforeAll(async () => {
		const dictPath = getDictPath();

		// Create custom loader that uses Node.js fs
		const customLoader = {
			loadArrayBuffer: async (url: string): Promise<ArrayBufferLike> => {
				const filename = url.split("/").pop() ?? url;
				const filePath = join(dictPath, filename);

				// Read compressed file
				const compressedData = readFileSync(filePath);

				// Decompress gzip data using pako
				const decompressed = pako.ungzip(
					new Uint8Array(compressedData),
				);
				return decompressed.buffer;
			},
		};

		// Build tokenizer with custom loader
		tokenizer = await kuromoji
			.builder({
				dicPath: dictPath,
				loader: customLoader,
			})
			.build();
	});

	describe("containsKanji", () => {
		it("should detect kanji in text", () => {
			expect(containsKanji("日本語")).toBe(true);
			expect(containsKanji("漢字")).toBe(true);
			expect(containsKanji("私")).toBe(true);
		});

		it("should return false for hiragana only", () => {
			expect(containsKanji("ひらがな")).toBe(false);
			expect(containsKanji("あいうえお")).toBe(false);
		});

		it("should return false for katakana only", () => {
			expect(containsKanji("カタカナ")).toBe(false);
			expect(containsKanji("アイウエオ")).toBe(false);
		});

		it("should return false for ASCII", () => {
			expect(containsKanji("hello")).toBe(false);
			expect(containsKanji("123")).toBe(false);
		});

		it("should return false for empty string", () => {
			expect(containsKanji("")).toBe(false);
		});

		it("should detect kanji in mixed text", () => {
			expect(containsKanji("hello日本")).toBe(true);
			expect(containsKanji("ひらがな漢字")).toBe(true);
		});
	});

	describe("katakanaToHiragana", () => {
		it("should convert katakana to hiragana", () => {
			expect(katakanaToHiragana("カタカナ")).toBe("かたかな");
			expect(katakanaToHiragana("アイウエオ")).toBe("あいうえお");
		});

		it("should leave hiragana unchanged", () => {
			expect(katakanaToHiragana("ひらがな")).toBe("ひらがな");
		});

		it("should handle mixed content", () => {
			expect(katakanaToHiragana("カタひらガナ")).toBe("かたひらがな");
		});

		it("should leave ASCII unchanged", () => {
			expect(katakanaToHiragana("hello")).toBe("hello");
			expect(katakanaToHiragana("123")).toBe("123");
		});

		it("should handle empty string", () => {
			expect(katakanaToHiragana("")).toBe("");
		});
	});

	describe("formatFurigana", () => {
		const kanji = "漢字";
		const reading = "かんじ";

		it("should format as curly braces (default)", () => {
			expect(formatFurigana(kanji, reading, "curly")).toBe(
				"{漢字|かんじ}",
			);
		});

		it("should format as ruby HTML", () => {
			expect(formatFurigana(kanji, reading, "ruby")).toBe(
				"<ruby>漢字<rt>かんじ</rt></ruby>",
			);
		});

		it("should format with parentheses", () => {
			expect(formatFurigana(kanji, reading, "parentheses")).toBe(
				"漢字(かんじ)",
			);
		});

		it("should format with brackets", () => {
			expect(formatFurigana(kanji, reading, "brackets")).toBe(
				"漢字[かんじ]",
			);
		});
	});

	describe("convertToFurigana - basic conversions", () => {
		it("should convert simple kanji word", () => {
			const result = convertToFurigana(tokenizer, "日本");
			// Both にほん and にっぽん are valid readings for 日本
			expect(result).toMatch(
				/<ruby>日本<rt>(にほん|にっぽん)<\/rt><\/ruby>/,
			);
		});

		it("should convert multiple kanji words", () => {
			const result = convertToFurigana(tokenizer, "日本語");
			expect(result).toBe("<ruby>日本語<rt>にほんご</rt></ruby>");
		});

		it("should handle sentence with particles", () => {
			const result = convertToFurigana(tokenizer, "私は学生です");
			// Should annotate kanji but leave hiragana particles alone
			expect(result).toContain("<ruby>私<rt>わたし</rt></ruby>");
			expect(result).toContain("は");
			expect(result).toContain("<ruby>学生<rt>がくせい</rt></ruby>");
			expect(result).toContain("です");
		});

		it("should leave hiragana-only text unchanged", () => {
			const result = convertToFurigana(tokenizer, "ひらがな");
			expect(result).toBe("ひらがな");
		});

		it("should leave katakana-only text unchanged", () => {
			const result = convertToFurigana(tokenizer, "カタカナ");
			expect(result).toBe("カタカナ");
		});

		it("should leave ASCII text unchanged", () => {
			const result = convertToFurigana(tokenizer, "hello world");
			expect(result).toBe("hello world");
		});
	});

	describe("convertToFurigana - output formats", () => {
		it("should output ruby format by default", () => {
			const result = convertToFurigana(tokenizer, "漢字");
			expect(result).toBe("<ruby>漢字<rt>かんじ</rt></ruby>");
		});

		it("should output ruby format", () => {
			const result = convertToFurigana(tokenizer, "漢字", "ruby");
			expect(result).toBe("<ruby>漢字<rt>かんじ</rt></ruby>");
		});

		it("should output parentheses format", () => {
			const result = convertToFurigana(tokenizer, "漢字", "parentheses");
			expect(result).toBe("漢字(かんじ)");
		});

		it("should output brackets format", () => {
			const result = convertToFurigana(tokenizer, "漢字", "brackets");
			expect(result).toBe("漢字[かんじ]");
		});
	});

	describe("convertToFurigana - edge cases", () => {
		it("should return empty string unchanged", () => {
			expect(convertToFurigana(tokenizer, "")).toBe("");
		});

		it("should return whitespace-only unchanged", () => {
			expect(convertToFurigana(tokenizer, "   ")).toBe("   ");
		});

		it("should handle mixed Japanese and ASCII", () => {
			const result = convertToFurigana(tokenizer, "Hello日本World");
			expect(result).toContain("Hello");
			// Both にほん and にっぽん are valid readings
			expect(result).toMatch(
				/<ruby>日本<rt>(にほん|にっぽん)<\/rt><\/ruby>/,
			);
			expect(result).toContain("World");
		});

		it("should handle numbers mixed with kanji", () => {
			const result = convertToFurigana(tokenizer, "2024年");
			expect(result).toContain("2024");
			expect(result).toContain("<ruby>年<rt>ねん</rt></ruby>");
		});

		it("should handle punctuation", () => {
			const result = convertToFurigana(tokenizer, "今日は、元気ですか？");
			expect(result).toContain("、");
			expect(result).toContain("？");
		});

		it("should handle common vocabulary correctly", () => {
			// Kuromoji may tokenize as whole words or stems+endings
			const taberu = convertToFurigana(tokenizer, "食べる");
			expect(taberu).toContain("たべ"); // Reading for 食べ portion

			const nomu = convertToFurigana(tokenizer, "飲む");
			expect(nomu).toContain("の"); // Reading for 飲

			const miru = convertToFurigana(tokenizer, "見る");
			expect(miru).toContain("み"); // Reading for 見
		});

		it("should handle compound words", () => {
			const result = convertToFurigana(tokenizer, "東京駅");
			// Tokyo Station - may be tokenized as 東京 + 駅 or as one token
			expect(result).toMatch(
				/<ruby>東京<rt>とうきょう<\/rt><\/ruby>|<ruby>東京駅<rt>とうきょうえき<\/rt><\/ruby>/,
			);
		});
	});

	describe("convertToFurigana - real-world sentences", () => {
		it("should convert a greeting", () => {
			const result = convertToFurigana(tokenizer, "おはようございます");
			// All hiragana, should be unchanged
			expect(result).toBe("おはようございます");
		});

		it("should convert a simple question", () => {
			const result = convertToFurigana(tokenizer, "何を食べますか");
			expect(result).toContain("<ruby>何<rt>なに</rt></ruby>");
			// Kuromoji tokenizes 食べ as a unit
			expect(result).toContain("たべ");
		});

		it("should handle polite speech patterns", () => {
			const result = convertToFurigana(tokenizer, "ありがとうございます");
			expect(result).toBe("ありがとうございます");
		});

		it("should convert time expressions", () => {
			const result = convertToFurigana(tokenizer, "今日");
			expect(result).toBe("<ruby>今日<rt>きょう</rt></ruby>");
		});
	});
});
