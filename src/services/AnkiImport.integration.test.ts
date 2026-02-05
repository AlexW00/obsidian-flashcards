/**
 * Integration tests for Anki import using the real example-export.apkg file.
 *
 * These tests verify the complete parsing and conversion pipeline using actual
 * Anki export data. See docs/dev/anki-import.md for details on the test fixture.
 */
/* eslint-disable import/no-nodejs-modules */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnkiPackageParser } from "./AnkiPackageParser";
import { AnkiContentConverter } from "./AnkiContentConverter";
import { AnkiTemplateConverter } from "./AnkiTemplateConverter";
import type { AnkiPackageData } from "../types";

/**
 * Load the example apkg file as an ArrayBuffer.
 */
function loadExampleApkg(): ArrayBuffer {
	// eslint-disable-next-line no-undef
	const apkgPath = join(process.cwd(), "resources", "example-export.apkg");
	const buffer = readFileSync(apkgPath);
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	);
}

/**
 * Get the path to the sql.js WASM file in node_modules.
 */
function getSqlWasmPath(file: string): string {
	// eslint-disable-next-line no-undef
	return join(process.cwd(), "node_modules", "sql.js", "dist", file);
}

describe("Anki Import Integration", () => {
	let apkgBuffer: ArrayBuffer;
	let parser: AnkiPackageParser;
	let packageData: AnkiPackageData;

	beforeAll(async () => {
		apkgBuffer = loadExampleApkg();
		parser = new AnkiPackageParser({
			// Use local WASM file from node_modules for Node.js tests
			locateFile: getSqlWasmPath,
		});
		packageData = await parser.parse(apkgBuffer);
	});

	describe("AnkiPackageParser", () => {
		describe("isSupported", () => {
			it("should detect supported apkg format", async () => {
				const result = await parser.isSupported(apkgBuffer);
				expect(result).toBe(true);
			});
		});

		describe("parse - decks", () => {
			it("should parse all decks", () => {
				expect(packageData.decks.size).toBe(2);
			});

			it("should parse Default deck", () => {
				const defaultDeck = packageData.decks.get(1);
				expect(defaultDeck).toBeDefined();
				expect(defaultDeck?.name).toBe("Default");
			});

			it("should parse nested deck with hierarchy separator", () => {
				// Find the nested deck (id is not 1)
				const nestedDeck = Array.from(packageData.decks.values()).find(
					(d) => d.id !== 1,
				);
				expect(nestedDeck).toBeDefined();
				// Anki uses \x1f as hierarchy separator
				expect(nestedDeck?.name).toContain("nested deck");
			});
		});

		describe("parse - notetypes (models)", () => {
			it("should parse all note types", () => {
				expect(packageData.models.size).toBe(3);
			});

			it("should parse Basic notetype with correct fields", () => {
				const basic = Array.from(packageData.models.values()).find(
					(m) => m.name === "Basic",
				);
				expect(basic).toBeDefined();
				expect(basic?.flds).toHaveLength(2);
				expect(basic?.flds[0]?.name).toBe("Front");
				expect(basic?.flds[1]?.name).toBe("Back");
				expect(basic?.type).toBe(0); // Standard type
			});

			it("should parse Cloze notetype", () => {
				const cloze = Array.from(packageData.models.values()).find(
					(m) => m.name === "Cloze",
				);
				expect(cloze).toBeDefined();
				expect(cloze?.flds).toHaveLength(2);
				expect(cloze?.flds[0]?.name).toBe("Text");
				expect(cloze?.flds[1]?.name).toBe("Back Extra");
				expect(cloze?.type).toBe(1); // Cloze type
			});

			it("should parse Custom notetype with extra fields", () => {
				const custom = Array.from(packageData.models.values()).find(
					(m) => m.name === "Custom",
				);
				expect(custom).toBeDefined();
				expect(custom?.flds).toHaveLength(4);
				expect(custom?.flds.map((f) => f.name)).toEqual([
					"Front",
					"Back",
					"Comment",
					"Image",
				]);
			});

			it("should parse template qfmt and afmt from protobuf config", () => {
				const basic = Array.from(packageData.models.values()).find(
					(m) => m.name === "Basic",
				);
				expect(basic?.tmpls).toHaveLength(1);
				expect(basic?.tmpls[0]?.qfmt).toBeTruthy();
				expect(basic?.tmpls[0]?.afmt).toBeTruthy();
			});
		});

		describe("parse - notes", () => {
			it("should parse all notes", () => {
				expect(packageData.notes).toHaveLength(3);
			});

			it("should parse note with HTML content", () => {
				// The Custom note has HTML with bullets, bold, etc.
				const customNote = packageData.notes.find((n) => {
					const model = packageData.models.get(String(n.mid));
					return model?.name === "Custom";
				});
				expect(customNote).toBeDefined();
				expect(customNote?.flds).toContain("<ul>");
				expect(customNote?.flds).toContain("<b>");
			});

			it("should parse note with cloze deletion", () => {
				const clozeNote = packageData.notes.find((n) => {
					const model = packageData.models.get(String(n.mid));
					return model?.name === "Cloze";
				});
				expect(clozeNote).toBeDefined();
				expect(clozeNote?.flds).toContain("{{c1::hidden}}");
			});

			it("should parse note with tags", () => {
				const taggedNote = packageData.notes.find((n) =>
					n.tags.includes("tag2"),
				);
				expect(taggedNote).toBeDefined();
			});

			it("should parse note fields separated by unit separator", () => {
				const basicNote = packageData.notes.find((n) => {
					const model = packageData.models.get(String(n.mid));
					return model?.name === "Basic";
				});
				expect(basicNote).toBeDefined();
				// Fields are separated by \x1f (unit separator)
				const fields = basicNote?.flds.split("\x1f");
				expect(fields).toHaveLength(2);
			});
		});

		describe("parse - cards", () => {
			it("should parse all cards", () => {
				expect(packageData.cards).toHaveLength(3);
			});

			it("should link cards to notes", () => {
				const noteIds = new Set(packageData.notes.map((n) => n.id));
				for (const card of packageData.cards) {
					expect(noteIds.has(card.nid)).toBe(true);
				}
			});

			it("should link cards to decks", () => {
				const deckIds = new Set(packageData.decks.keys());
				for (const card of packageData.cards) {
					expect(deckIds.has(card.did)).toBe(true);
				}
			});
		});

		describe("parse - media", () => {
			it("should parse media mapping", () => {
				expect(packageData.media.size).toBe(1);
			});

			it("should map numeric key to original filename", () => {
				const filename = packageData.media.get("0");
				expect(filename).toBeDefined();
				expect(filename).toMatch(/\.png$/);
				expect(filename).toBe(
					"9f1b5b46aed533f5386cf276ab2cdce48cbd2e25.png",
				);
			});
		});

		describe("extractMediaFile", () => {
			it("should extract and decompress media file", async () => {
				const mediaData = await parser.extractMediaFile(apkgBuffer, "0");
				expect(mediaData).not.toBeNull();
				expect(mediaData!.length).toBeGreaterThan(0);
				// PNG magic bytes: 89 50 4E 47
				expect(mediaData![0]).toBe(0x89);
				expect(mediaData![1]).toBe(0x50);
				expect(mediaData![2]).toBe(0x4e);
				expect(mediaData![3]).toBe(0x47);
			});

			it("should return null for non-existent media key", async () => {
				const mediaData = await parser.extractMediaFile(
					apkgBuffer,
					"999",
				);
				expect(mediaData).toBeNull();
			});
		});
	});

	describe("Content Conversion Pipeline", () => {
		let contentConverter: AnkiContentConverter;

		beforeAll(() => {
			contentConverter = new AnkiContentConverter();
		});

		it("should convert HTML note content to markdown", () => {
			const customNote = packageData.notes.find((n) => {
				const model = packageData.models.get(String(n.mid));
				return model?.name === "Custom";
			});
			expect(customNote).toBeDefined();

			// Get the front field (first field)
			const frontField = customNote!.flds.split("\x1f")[0]!;
			const result = contentConverter.convert(
				frontField,
				packageData.media,
			);

			// Should convert HTML lists to markdown
			expect(result.markdown).toContain("-"); // Bullet point
			expect(result.markdown).toContain("**"); // Bold
		});

		it("should convert cloze deletions to highlights", () => {
			const clozeNote = packageData.notes.find((n) => {
				const model = packageData.models.get(String(n.mid));
				return model?.name === "Cloze";
			});
			expect(clozeNote).toBeDefined();

			const textField = clozeNote!.flds.split("\x1f")[0]!;
			const result = contentConverter.convert(
				textField,
				packageData.media,
			);

			// Cloze {{c1::hidden}} should become ==hidden==
			expect(result.markdown).toContain("==hidden==");
		});

		it("should track media file references", () => {
			const customNote = packageData.notes.find((n) => {
				const model = packageData.models.get(String(n.mid));
				return model?.name === "Custom";
			});
			expect(customNote).toBeDefined();

			// The Image field (4th field) has an img tag
			const imageField = customNote!.flds.split("\x1f")[3]!;
			const result = contentConverter.convert(
				imageField,
				packageData.media,
			);

			expect(result.mediaFiles.size).toBe(1);
			expect(
				result.mediaFiles.has(
					"9f1b5b46aed533f5386cf276ab2cdce48cbd2e25.png",
				),
			).toBe(true);
		});
	});

	describe("Template Conversion Pipeline", () => {
		let templateConverter: AnkiTemplateConverter;

		beforeAll(() => {
			templateConverter = new AnkiTemplateConverter();
		});

		it("should convert Basic model to Nunjucks template", () => {
			const basic = Array.from(packageData.models.values()).find(
				(m) => m.name === "Basic",
			);
			expect(basic).toBeDefined();

			const templates = templateConverter.convertModel(basic!);

			expect(templates).toHaveLength(1);
			expect(templates[0]?.name).toBe("Basic");
			expect(templates[0]?.variables).toContain("Front");
			expect(templates[0]?.variables).toContain("Back");
			// Should use Nunjucks syntax
			expect(templates[0]?.body).toContain("{{ Front }}");
			expect(templates[0]?.body).toContain("{{ Back }}");
		});

		it("should convert Custom model preserving all fields", () => {
			const custom = Array.from(packageData.models.values()).find(
				(m) => m.name === "Custom",
			);
			expect(custom).toBeDefined();

			const templates = templateConverter.convertModel(custom!);

			expect(templates).toHaveLength(1);
			expect(templates[0]?.variables).toContain("Front");
			expect(templates[0]?.variables).toContain("Back");
			expect(templates[0]?.variables).toContain("Comment");
			expect(templates[0]?.variables).toContain("Image");
		});

		it("should apply field name mapping", () => {
			const basic = Array.from(packageData.models.values()).find(
				(m) => m.name === "Basic",
			);
			expect(basic).toBeDefined();

			const fieldNameMap = new Map([
				["Front", "question"],
				["Back", "answer"],
			]);

			const templates = templateConverter.convertModel(
				basic!,
				fieldNameMap,
			);

			expect(templates[0]?.variables).toContain("question");
			expect(templates[0]?.variables).toContain("answer");
			expect(templates[0]?.body).toContain("{{ question }}");
			expect(templates[0]?.body).toContain("{{ answer }}");
		});
	});

	describe("Full Conversion Pipeline", () => {
		it("should parse apkg, convert templates, and convert note content", () => {
			const contentConverter = new AnkiContentConverter();
			const templateConverter = new AnkiTemplateConverter();

			// For each note, verify we can:
			// 1. Find its model
			// 2. Convert the model to a template
			// 3. Convert the note fields to markdown

			for (const note of packageData.notes) {
				const model = packageData.models.get(String(note.mid));
				expect(model).toBeDefined();

				// Convert model to template
				const templates = templateConverter.convertModel(model!);
				expect(templates.length).toBeGreaterThan(0);
				expect(templates[0]?.body).toBeTruthy();

				// Convert each field
				const fields = note.flds.split("\x1f");
				expect(fields.length).toBe(model!.flds.length);

				for (const fieldContent of fields) {
					const result = contentConverter.convert(
						fieldContent,
						packageData.media,
					);
					// Should return valid markdown (may be empty for empty fields)
					expect(typeof result.markdown).toBe("string");
				}
			}
		});
	});
});
