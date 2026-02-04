import { App, stringifyYaml, TFile } from "obsidian";
import JSZip from "jszip";
import * as protobuf from "protobufjs";
import { decompress as zstdDecompress } from "fzstd";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
	AnkiCard,
	AnkiCardTemplate,
	AnkiDeck,
	AnkiDeckSelection,
	AnkiField,
	AnkiModel,
	AnkiNote,
	AnkiPackageData,
	FlashcardFrontmatter,
	FlashcardsPluginSettings,
	ImportProgressCallback,
	ReviewState,
} from "../types";
import { PROTECTION_COMMENT } from "../types";
import { AnkiContentConverter } from "./AnkiContentConverter";
import {
	AnkiTemplateConverter,
	type ConvertedTemplate,
} from "./AnkiTemplateConverter";
import type { TemplateService } from "../flashcards/TemplateService";
import { createEmptyCard } from "ts-fsrs";

/**
 * Result of the import operation.
 */
export interface ImportResult {
	cardsImported: number;
	templatesCreated: number;
	mediaImported: number;
	errors: string[];
}

/**
 * Service for importing Anki .apkg backup files.
 *
 * Flow:
 * 1. Extract ZIP archive (apkg is just a zip)
 * 2. Parse SQLite database (collection.anki21b)
 * 3. Extract decks, models, notes, and cards
 * 4. Convert templates to Nunjucks format
 * 5. Convert note content to Markdown
 * 6. Create flashcard files with proper frontmatter
 */
export class AnkiImportService {
	private app: App;
	private templateService: TemplateService;
	private contentConverter: AnkiContentConverter;
	private templateConverter: AnkiTemplateConverter;
	private settings: FlashcardsPluginSettings;
	private sqlPromise: Promise<SqlJsStatic> | null = null;
	private mediaProtoType: protobuf.Type | null = null;

	constructor(
		app: App,
		templateService: TemplateService,
		settings: FlashcardsPluginSettings,
	) {
		this.app = app;
		this.templateService = templateService;
		this.settings = settings;
		this.contentConverter = new AnkiContentConverter();
		this.templateConverter = new AnkiTemplateConverter();
	}

	/**
	 * Lazy-load sql.js WASM module.
	 */
	private async getSqlJs(): Promise<SqlJsStatic> {
		if (!this.sqlPromise) {
			this.sqlPromise = initSqlJs({
				// Use CDN for WASM file to avoid bundling issues
				locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
			});
		}
		return this.sqlPromise;
	}

	/**
	 * Parse an Anki .apkg file and extract its contents.
	 */
	async parseApkg(file: File): Promise<AnkiPackageData> {
		// Load the ZIP
		const zip = await JSZip.loadAsync(file);

		// Only support the new format (Anki 2.1.50+)
		// collection.anki21b is zstd-compressed SQLite
		const dbFile = zip.file("collection.anki21b");
		if (!dbFile) {
			throw new Error(
				"Unsupported Anki export. Please export using Anki 2.1.50+ (.anki21b)",
			);
		}

		// Load the media mapping (protobuf, possibly zstd-compressed)
		const mediaFile = zip.file("media");
		let mediaMap = new Map<string, string>();
		if (mediaFile) {
			const mediaBuffer = await mediaFile.async("arraybuffer");
			const mediaBytes = new Uint8Array(mediaBuffer);

			// Check if media is zstd compressed (magic bytes: 28 b5 2f fd)
			const isZstdCompressed =
				mediaBytes.length >= 4 &&
				mediaBytes[0] === 0x28 &&
				mediaBytes[1] === 0xb5 &&
				mediaBytes[2] === 0x2f &&
				mediaBytes[3] === 0xfd;

			let mediaData: Uint8Array;
			if (isZstdCompressed) {
				// Decompress zstd data
				mediaData = zstdDecompress(mediaBytes);
			} else {
				mediaData = mediaBytes;
			}

			// Protobuf format (Anki 2.1.50+)
			// MediaEntries { repeated MediaEntry entries = 1; }
			// MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; }
			mediaMap = this.parseMediaProtobuf(mediaData);
		}

		// Initialize SQLite
		const SQL = await this.getSqlJs();
		let dbBuffer = await dbFile.async("arraybuffer");
		const dbBytes = new Uint8Array(dbBuffer);
		// Check for zstd magic bytes (28 b5 2f fd)
		if (
			dbBytes.length >= 4 &&
			dbBytes[0] === 0x28 &&
			dbBytes[1] === 0xb5 &&
			dbBytes[2] === 0x2f &&
			dbBytes[3] === 0xfd
		) {
			const decompressed = zstdDecompress(dbBytes);
			dbBuffer = decompressed.slice().buffer;
		} else {
			throw new Error(
				"Unsupported Anki export. Expected zstd-compressed collection.anki21b",
			);
		}

		const db = new SQL.Database(new Uint8Array(dbBuffer));

		try {
			// Parse all data from the database (new schema only)
			const models = this.parseModelsNewSchema(db);
			const decks = this.parseDecksNewSchema(db);
			const notes = this.parseNotes(db);
			const cards = this.parseCards(db);

			return {
				models,
				decks,
				notes,
				cards,
				media: mediaMap,
			};
		} finally {
			db.close();
		}
	}

	/**
	 * Check if the .apkg uses the supported new format (collection.anki21b).
	 */
	async isSupportedApkg(file: File): Promise<boolean> {
		const zip = await JSZip.loadAsync(file);
		return Boolean(zip.file("collection.anki21b"));
	}

	/**
	 * Parse models (note types) from the new schema tables.
	 * New format stores models in `notetypes`, `fields`, and `templates` tables.
	 */
	private parseModelsNewSchema(db: Database): Map<string, AnkiModel> {
		const models = new Map<string, AnkiModel>();

		// Get note types
		const notetypesResult = db.exec(
			"SELECT id, name, config FROM notetypes",
		);
		if (notetypesResult.length === 0) {
			throw new Error(
				"Unsupported Anki export. Missing notetypes table.",
			);
		}

		// Get fields grouped by notetype
		const fieldsResult = db.exec(
			"SELECT ntid, ord, name FROM fields ORDER BY ntid, ord",
		);
		const fieldsByNtid = new Map<string, AnkiField[]>();
		if (fieldsResult.length > 0) {
			for (const row of fieldsResult[0]?.values ?? []) {
				const ntid = String(row[0]);
				if (!fieldsByNtid.has(ntid)) {
					fieldsByNtid.set(ntid, []);
				}
				fieldsByNtid.get(ntid)?.push({
					name: row[2] as string,
					ord: row[1] as number,
					sticky: false,
					rtl: false,
					font: "Arial",
					size: 20,
				});
			}
		}

		// Get templates grouped by notetype
		const templatesResult = db.exec(
			"SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord",
		);
		const templatesByNtid = new Map<string, AnkiCardTemplate[]>();
		if (templatesResult.length > 0) {
			for (const row of templatesResult[0]?.values ?? []) {
				const ntid = String(row[0]);
				const configBytes = row[3];

				// Parse template config from protobuf
				const { qfmt, afmt } = this.parseTemplateConfig(
					configBytes instanceof Uint8Array
						? configBytes
						: new Uint8Array(),
				);

				if (!templatesByNtid.has(ntid)) {
					templatesByNtid.set(ntid, []);
				}
				templatesByNtid.get(ntid)?.push({
					name: row[2] as string,
					ord: row[1] as number,
					qfmt,
					afmt,
					did: null,
					bqfmt: "",
					bafmt: "",
				});
			}
		}

		// Build models
		for (const row of notetypesResult[0]?.values ?? []) {
			const id = String(row[0]);
			const name = row[1] as string;
			const configBytes = row[2];

			// Parse notetype config to get type (standard vs cloze)
			const notetypeType = this.parseNotetypeConfig(
				configBytes instanceof Uint8Array
					? configBytes
					: new Uint8Array(),
			);

			const flds = fieldsByNtid.get(id) ?? [];
			const tmpls = templatesByNtid.get(id) ?? [];

			models.set(id, {
				id,
				name,
				type: notetypeType,
				flds,
				tmpls,
				css: "",
				latexPre: "",
				latexPost: "",
				mod: 0,
				did: 0,
				sortf: 0,
				tags: [],
			});
		}

		return models;
	}

	/**
	 * Parse template config from protobuf blob.
	 * The config contains qfmt (question format) and afmt (answer format).
	 */
	private parseTemplateConfig(data: Uint8Array): {
		qfmt: string;
		afmt: string;
	} {
		// The template config protobuf has:
		// field 1 = qfmt (string)
		// field 2 = afmt (string)
		// We'll parse it manually since the structure is simple

		if (data.length === 0) {
			return { qfmt: "", afmt: "" };
		}

		let qfmt = "";
		let afmt = "";
		let pos = 0;

		while (pos < data.length) {
			// Read field tag (varint)
			const tag = data[pos];
			if (tag === undefined) break;
			pos++;

			const fieldNumber = tag >> 3;
			const wireType = tag & 0x07;

			if (wireType === 2) {
				// Length-delimited (string)
				// Read length (varint)
				let length = 0;
				let shift = 0;
				while (pos < data.length) {
					const byte = data[pos];
					if (byte === undefined) break;
					pos++;
					length |= (byte & 0x7f) << shift;
					if ((byte & 0x80) === 0) break;
					shift += 7;
				}

				// Read string
				const stringBytes = data.slice(pos, pos + length);
				const str = new TextDecoder().decode(stringBytes);
				pos += length;

				if (fieldNumber === 1) {
					qfmt = str;
				} else if (fieldNumber === 2) {
					afmt = str;
				}
			} else if (wireType === 0) {
				// Varint
				// Skip varint
				while (pos < data.length && (data[pos]! & 0x80) !== 0) {
					pos++;
				}
				pos++;
			} else {
				// Unknown wire type, stop parsing
				break;
			}
		}

		return { qfmt, afmt };
	}

	/**
	 * Parse notetype config from protobuf blob to get the type (standard vs cloze).
	 */
	private parseNotetypeConfig(data: Uint8Array): number {
		// Notetype config field 4 = kind (enum: 0=normal, 1=cloze)
		// We'll look for field 4 with varint value

		if (data.length === 0) {
			return 0;
		}

		let pos = 0;
		while (pos < data.length) {
			const tag = data[pos];
			if (tag === undefined) break;
			pos++;

			const fieldNumber = tag >> 3;
			const wireType = tag & 0x07;

			if (wireType === 0) {
				// Varint
				// Read varint value
				let value = 0;
				let shift = 0;
				while (pos < data.length) {
					const byte = data[pos];
					if (byte === undefined) break;
					pos++;
					value |= (byte & 0x7f) << shift;
					if ((byte & 0x80) === 0) break;
					shift += 7;
				}

				if (fieldNumber === 4) {
					return value; // 0 = normal, 1 = cloze
				}
			} else if (wireType === 2) {
				// Length-delimited
				// Read and skip
				let length = 0;
				let shift = 0;
				while (pos < data.length) {
					const byte = data[pos];
					if (byte === undefined) break;
					pos++;
					length |= (byte & 0x7f) << shift;
					if ((byte & 0x80) === 0) break;
					shift += 7;
				}
				pos += length;
			} else {
				break;
			}
		}

		return 0;
	}

	/**
	 * Parse decks from the new schema decks table.
	 */
	private parseDecksNewSchema(db: Database): Map<number, AnkiDeck> {
		const decks = new Map<number, AnkiDeck>();

		const result = db.exec("SELECT id, name FROM decks");
		if (result.length === 0) {
			return decks;
		}

		for (const row of result[0]?.values ?? []) {
			const id = Number(row[0]);
			const name = row[1] as string;

			decks.set(id, {
				id,
				name,
				desc: "",
				mod: 0,
				dyn: 0,
				collapsed: false,
			});
		}

		return decks;
	}

	/**
	 * Parse notes from the notes table.
	 */
	private parseNotes(db: Database): AnkiNote[] {
		const notes: AnkiNote[] = [];

		const result = db.exec(
			"SELECT id, guid, mid, mod, tags, flds, sfld FROM notes",
		);
		if (result.length === 0) {
			return notes;
		}

		const rows = result[0]?.values ?? [];
		for (const row of rows) {
			const sfldValue = row[6];
			notes.push({
				id: row[0] as number,
				guid: row[1] as string,
				mid: row[2] as number,
				mod: row[3] as number,
				tags: row[4] as string,
				flds: row[5] as string,
				sfld:
					typeof sfldValue === "string"
						? sfldValue
						: typeof sfldValue === "number"
							? sfldValue.toString()
							: "",
			});
		}

		return notes;
	}

	/**
	 * Parse cards from the cards table.
	 */
	private parseCards(db: Database): AnkiCard[] {
		const cards: AnkiCard[] = [];

		const result = db.exec(
			"SELECT id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses FROM cards",
		);
		if (result.length === 0) {
			return cards;
		}

		const rows = result[0]?.values ?? [];
		for (const row of rows) {
			cards.push({
				id: row[0] as number,
				nid: row[1] as number,
				did: row[2] as number,
				ord: row[3] as number,
				mod: row[4] as number,
				type: row[5] as number,
				queue: row[6] as number,
				due: row[7] as number,
				ivl: row[8] as number,
				factor: row[9] as number,
				reps: row[10] as number,
				lapses: row[11] as number,
			});
		}

		return cards;
	}

	/**
	 * Parse media entries from protobuf format (Anki 2.1.50+).
	 *
	 * Protobuf schema:
	 * message MediaEntries { repeated MediaEntry entries = 1; }
	 * message MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; }
	 *
	 * Returns a map of index (as string) -> filename.
	 */
	private parseMediaProtobuf(data: Uint8Array): Map<string, string> {
		const mediaMap = new Map<string, string>();
		const mediaEntriesType = this.getMediaProtoType();
		const decoded = mediaEntriesType.decode(data);
		const object = mediaEntriesType.toObject(decoded, {
			defaults: false,
		}) as unknown;
		const entriesValue =
			typeof object === "object" && object !== null
				? (object as { entries?: unknown }).entries
				: undefined;
		const entries = Array.isArray(entriesValue) ? entriesValue : [];

		entries.forEach((entry, index) => {
			if (!entry || typeof entry !== "object") {
				return;
			}
			const nameValue = (entry as { name?: unknown }).name;
			if (typeof nameValue === "string" && nameValue.length > 0) {
				mediaMap.set(String(index), nameValue);
			}
		});

		return mediaMap;
	}

	/**
	 * Get the protobuf Type for Anki media entries.
	 */
	private getMediaProtoType(): protobuf.Type {
		if (this.mediaProtoType) {
			return this.mediaProtoType;
		}

		const proto = `
			syntax = "proto3";
			message MediaEntries { repeated MediaEntry entries = 1; }
			message MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; }
		`;
		const root = protobuf.parse(proto).root;
		const type = root.lookupType("MediaEntries");
		this.mediaProtoType = type;
		return type;
	}

	/**
	 * Build deck hierarchy from parsed decks for UI selection.
	 */
	buildDeckHierarchy(
		data: AnkiPackageData,
		selectedDeckIds?: Set<number>,
	): AnkiDeckSelection[] {
		// Count notes per deck
		const noteCountByDeck = new Map<number, number>();
		const cardsByNote = new Map<number, AnkiCard[]>();

		for (const card of data.cards) {
			if (!cardsByNote.has(card.nid)) {
				cardsByNote.set(card.nid, []);
			}
			cardsByNote.get(card.nid)?.push(card);
		}

		for (const card of data.cards) {
			const count = noteCountByDeck.get(card.did) ?? 0;
			noteCountByDeck.set(card.did, count + 1);
		}

		// Build tree structure
		const deckList = Array.from(data.decks.values())
			// Filter out default deck (id=1) if it has no cards
			.filter((d) => d.id !== 1 || (noteCountByDeck.get(d.id) ?? 0) > 0)
			// Filter out dynamic/filtered decks
			.filter((d) => d.dyn !== 1);

		// Sort by name for consistent ordering
		deckList.sort((a, b) => a.name.localeCompare(b.name));

		// Create flat list with depth info (Anki uses :: for hierarchy)
		const selections: AnkiDeckSelection[] = [];

		for (const deck of deckList) {
			const parts = deck.name.split("::");
			const depth = parts.length - 1;
			const noteCount = noteCountByDeck.get(deck.id) ?? 0;

			selections.push({
				deck,
				selected: selectedDeckIds?.has(deck.id) ?? false,
				noteCount,
				children: [], // Not used for flat list
				depth,
			});
		}

		return selections;
	}

	/**
	 * Import selected decks into the vault.
	 * @param overwriteTemplates If true, overwrite existing template files instead of reusing them.
	 */
	async importDecks(
		data: AnkiPackageData,
		apkgFile: File,
		selectedDeckIds: Set<number>,
		destinationFolder: string,
		onProgress?: ImportProgressCallback,
		overwriteTemplates = false,
	): Promise<ImportResult> {
		const result: ImportResult = {
			cardsImported: 0,
			templatesCreated: 0,
			mediaImported: 0,
			errors: [],
		};

		// Build note-to-deck mapping (use first card's deck for each note)
		const noteToDeck = new Map<number, number>();
		const noteToCardId = new Map<number, number>();
		for (const card of data.cards) {
			if (!noteToDeck.has(card.nid)) {
				noteToDeck.set(card.nid, card.did);
			}
			if (!noteToCardId.has(card.nid)) {
				noteToCardId.set(card.nid, card.id);
			}
		}

		// Filter notes belonging to selected decks
		const notesToImport = data.notes.filter((note) => {
			const deckId = noteToDeck.get(note.id);
			return deckId !== undefined && selectedDeckIds.has(deckId);
		});

		const totalSteps = notesToImport.length + data.models.size;
		let currentStep = 0;

		// Step 1: Create templates from models
		const templatePathMap = new Map<string, string>(); // modelId -> template path
		const fieldNameMaps = new Map<string, Map<string, string>>();
		const usedModels = new Set<string>();

		// Find which models are used by selected notes
		for (const note of notesToImport) {
			usedModels.add(String(note.mid));
		}

		for (const modelId of usedModels) {
			const model = data.models.get(modelId);
			if (!model) continue;

			const fieldNameMap = this.buildFieldNameMap(model);
			fieldNameMaps.set(modelId, fieldNameMap);

			currentStep++;
			onProgress?.(
				currentStep,
				totalSteps,
				`Creating template: ${model.name}`,
			);

			try {
				const templates = this.templateConverter.convertModel(
					model,
					fieldNameMap,
				);
				// Use first template for this model
				const template = templates[0];
				if (template) {
					const templatePath = await this.createTemplate(
						template,
						overwriteTemplates,
					);
					templatePathMap.set(modelId, templatePath);
					result.templatesCreated++;
				}
			} catch (error) {
				result.errors.push(
					`Failed to create template for ${model.name}: ${(error as Error).message}`,
				);
			}
		}

		// Step 2: Extract media files from ZIP
		const zip = await JSZip.loadAsync(apkgFile);

		// Collect all media files referenced in notes
		const referencedMedia = new Set<string>();
		for (const note of notesToImport) {
			const model = data.models.get(String(note.mid));
			if (!model) continue;

			const fields = note.flds.split("\x1f");
			for (const fieldContent of fields) {
				const { mediaFiles } = this.contentConverter.convertField(
					fieldContent,
					data.media,
				);
				for (const mediaFile of mediaFiles) {
					referencedMedia.add(mediaFile);
				}
			}
		}

		// Import referenced media
		for (const originalName of referencedMedia) {
			// Find the numeric key for this file in media map
			let numericKey: string | undefined;
			for (const [key, value] of data.media) {
				if (value === originalName) {
					numericKey = key;
					break;
				}
			}

			if (!numericKey) continue;

			const mediaZipFile = zip.file(numericKey);
			if (!mediaZipFile) continue;

			try {
				let mediaBuffer = await mediaZipFile.async("arraybuffer");
				let mediaBytes = new Uint8Array(mediaBuffer);
				// Detect zstd-compressed media (magic bytes: 28 b5 2f fd)
				if (
					mediaBytes.length >= 4 &&
					mediaBytes[0] === 0x28 &&
					mediaBytes[1] === 0xb5 &&
					mediaBytes[2] === 0x2f &&
					mediaBytes[3] === 0xfd
				) {
					const decompressed = zstdDecompress(mediaBytes);
					mediaBytes = new Uint8Array(decompressed);
					mediaBuffer = mediaBytes.buffer;
				}
				const mediaPath = `${this.settings.attachmentFolder}/${originalName}`;

				// Ensure folder exists
				await this.ensureFolderExists(this.settings.attachmentFolder);
				const existing =
					this.app.vault.getAbstractFileByPath(mediaPath);
				if (existing) {
					if (existing instanceof TFile) {
						await this.app.vault.modifyBinary(
							existing,
							mediaBuffer,
						);
					} else {
						throw new Error(
							`Cannot overwrite non-file path: ${mediaPath}`,
						);
					}
				} else {
					await this.app.vault.createBinary(mediaPath, mediaBuffer);
				}

				result.mediaImported++;
			} catch (error) {
				result.errors.push(
					`Failed to import media ${originalName}: ${(error as Error).message}`,
				);
			}
		}

		// Step 3: Create flashcard files
		for (const note of notesToImport) {
			currentStep++;
			onProgress?.(
				currentStep,
				totalSteps,
				`Importing card ${result.cardsImported + 1} of ${notesToImport.length}`,
			);

			const deckId = noteToDeck.get(note.id);
			if (deckId === undefined) continue;
			const cardId = noteToCardId.get(note.id);
			if (cardId === undefined) continue;

			const deck = data.decks.get(deckId);
			if (!deck) continue;

			const model = data.models.get(String(note.mid));
			if (!model) continue;

			const templatePath = templatePathMap.get(String(note.mid));
			if (!templatePath) continue;
			const fieldNameMap = fieldNameMaps.get(String(note.mid));

			try {
				await this.createFlashcard(
					note,
					model,
					deck,
					cardId,
					templatePath,
					destinationFolder,
					data.media,
					fieldNameMap,
				);
				result.cardsImported++;
			} catch (error) {
				result.errors.push(
					`Failed to import note ${note.id}: ${(error as Error).message}`,
				);
			}
		}

		return result;
	}

	/**
	 * Find template name conflicts for the selected decks.
	 */
	getTemplateConflicts(
		data: AnkiPackageData,
		selectedDeckIds: Set<number>,
	): string[] {
		// Build note-to-deck mapping (use first card's deck for each note)
		const noteToDeck = new Map<number, number>();
		for (const card of data.cards) {
			if (!noteToDeck.has(card.nid)) {
				noteToDeck.set(card.nid, card.did);
			}
		}

		// Filter notes belonging to selected decks
		const notesToImport = data.notes.filter((note) => {
			const deckId = noteToDeck.get(note.id);
			return deckId !== undefined && selectedDeckIds.has(deckId);
		});

		const usedModels = new Set<string>();
		for (const note of notesToImport) {
			usedModels.add(String(note.mid));
		}

		const conflicts = new Set<string>();
		const templateFolder = this.settings.templateFolder;

		for (const modelId of usedModels) {
			const model = data.models.get(modelId);
			if (!model) continue;

			const fieldNameMap = this.buildFieldNameMap(model);

			try {
				const templates = this.templateConverter.convertModel(
					model,
					fieldNameMap,
				);
				const template = templates[0];
				if (!template) continue;

				const templatePath = `${templateFolder}/${template.name}.md`;
				const existing =
					this.app.vault.getAbstractFileByPath(templatePath);
				if (existing) {
					conflicts.add(template.name);
				}
			} catch (error) {
				console.warn(
					"[Anker] Failed to check template conflict:",
					error,
				);
			}
		}

		return Array.from(conflicts).sort((a, b) => a.localeCompare(b));
	}

	/**
	 * Create a template file from converted template.
	 * @param overwrite If true, overwrite existing template file.
	 */
	private async createTemplate(
		template: ConvertedTemplate,
		overwrite = false,
	): Promise<string> {
		const templateFolder = this.settings.templateFolder;
		await this.ensureFolderExists(templateFolder);

		const templatePath = `${templateFolder}/${template.name}.md`;

		// Check if exists
		const existing = this.app.vault.getAbstractFileByPath(templatePath);
		if (existing) {
			if (overwrite && existing instanceof TFile) {
				// Overwrite existing template
				await this.app.vault.modify(existing, template.body);
				return templatePath;
			}
			// Use existing template
			return templatePath;
		}

		await this.app.vault.create(templatePath, template.body);
		return templatePath;
	}

	/**
	 * Create a flashcard file from an Anki note.
	 */
	private async createFlashcard(
		note: AnkiNote,
		model: AnkiModel,
		deck: AnkiDeck,
		cardId: number,
		templatePath: string,
		destinationFolder: string,
		media: Map<string, string>,
		fieldNameMap?: Map<string, string>,
	): Promise<void> {
		// Parse note fields
		const fieldValues = note.flds.split("\x1f");
		const fields: Record<string, string> = {};
		const frontmatterFields: Record<string, unknown> = {};

		for (let i = 0; i < model.flds.length; i++) {
			const fieldDef = model.flds[i];
			const fieldHtml = fieldValues[i] ?? "";

			if (!fieldDef) continue;

			// Convert field content to Markdown
			const { markdown } = this.contentConverter.convertField(
				fieldHtml,
				media,
			);

			const finalMarkdown = markdown;

			const fieldName = this.mapFieldName(fieldDef.name, fieldNameMap);
			fields[fieldName] = finalMarkdown;
			frontmatterFields[fieldName] = this.normalizeFrontmatterValue(
				fieldName,
				finalMarkdown,
			);
		}

		// Build deck folder path (convert :: to /)
		const deckPath = deck.name.replace(/::/g, "/");
		const fullDeckPath = `${destinationFolder}/${deckPath}`;
		await this.ensureFolderExists(fullDeckPath);

		// Load template for rendering
		const template = await this.templateService.loadTemplate(templatePath);
		if (!template) {
			throw new Error(`Template not found: ${templatePath}`);
		}

		// Render body
		const body = await this.templateService.render(template.body, fields);

		// Create frontmatter
		const reviewState = this.createInitialReviewState();
		const frontmatter: FlashcardFrontmatter = {
			_type: "flashcard",
			_template: `[[${templatePath}]]`,
			_review: reviewState,
			...frontmatterFields,
		};

		// Build file content
		const yamlContent = stringifyYaml(frontmatter);
		const content = `---\n${yamlContent}---\n\n${PROTECTION_COMMENT}\n\n${body}`;

		// Use Anki card ID as filename (overwrite if it already exists)
		const baseName = String(cardId);
		const filePath = `${fullDeckPath}/${baseName}.md`;
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) {
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
				return;
			}
			throw new Error(`Cannot overwrite non-file path: ${filePath}`);
		}

		await this.app.vault.create(filePath, content);
	}

	/**
	 * Create initial review state for imported cards.
	 */
	private createInitialReviewState(): ReviewState {
		const card = createEmptyCard();
		return {
			due: card.due.toISOString(),
			stability: card.stability,
			difficulty: card.difficulty,
			// TODO: Remove when ts-fsrs 6.0 is released
			elapsed_days: card.elapsed_days, // eslint-disable-line @typescript-eslint/no-deprecated
			scheduled_days: card.scheduled_days,
			reps: card.reps,
			lapses: card.lapses,
			state: card.state,
		};
	}

	/**
	 * Ensure a folder path exists, creating it if necessary.
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const parts = folderPath.split("/");
		let currentPath = "";

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const folder = this.app.vault.getAbstractFileByPath(currentPath);
			if (!folder) {
				try {
					await this.app.vault.createFolder(currentPath);
				} catch {
					// Folder may already exist
				}
			}
		}
	}

	/**
	 * Escape special regex characters in a string.
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	/**
	 * Build a mapping of original Anki field names to normalized identifiers.
	 */
	private buildFieldNameMap(model: AnkiModel): Map<string, string> {
		const map = new Map<string, string>();
		const used = new Set<string>();
		for (const field of model.flds) {
			const original = field.name;
			const normalized = this.normalizeFieldName(original, used);
			map.set(original, normalized);
			used.add(normalized);
		}
		return map;
	}

	/**
	 * Normalize a field name to a safe frontmatter key and Nunjucks identifier.
	 */
	private normalizeFieldName(name: string, used: Set<string>): string {
		let normalized = name
			.trim()
			.replace(/[^a-zA-Z0-9_]+/g, "_")
			.replace(/_+/g, "_")
			.replace(/^_+|_+$/g, "");

		if (!normalized) {
			normalized = "field";
		}

		if (/^\d/.test(normalized)) {
			normalized = `field_${normalized}`;
		}

		if (normalized.startsWith("_")) {
			normalized = `field${normalized}`;
		}

		const reserved = new Set([
			"loop",
			"super",
			"self",
			"true",
			"false",
			"none",
			"FrontSide",
		]);
		if (reserved.has(normalized)) {
			normalized = `field_${normalized}`;
		}

		let candidate = normalized;
		let counter = 2;
		while (used.has(candidate)) {
			candidate = `${normalized}_${counter}`;
			counter++;
		}

		return candidate;
	}

	/**
	 * Map an original field name using an optional normalization map.
	 */
	private mapFieldName(
		name: string,
		fieldNameMap?: Map<string, string>,
	): string {
		return fieldNameMap?.get(name) ?? name;
	}

	/**
	 * Normalize values that are likely to cause invalid YAML frontmatter.
	 */
	private normalizeFrontmatterValue(
		fieldName: string,
		value: string,
	): string | string[] {
		if (fieldName.toLowerCase() === "tags") {
			const parts = value
				.split(",")
				.map((part) => part.trim())
				.filter((part) => part.length > 0);
			if (parts.length > 1) {
				return parts;
			}
		}

		return value;
	}
}
