/**
 * Pure parser for Anki .apkg files (Anki 2.1.50+ format).
 *
 * This module contains the extraction and parsing logic that doesn't depend on
 * Obsidian APIs. It can be tested independently and used by AnkiImportService.
 */
import JSZip from "jszip";
import * as protobuf from "protobufjs";
import { decompress as zstdDecompress } from "fzstd";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
	AnkiCard,
	AnkiCardTemplate,
	AnkiDeck,
	AnkiField,
	AnkiModel,
	AnkiNote,
	AnkiPackageData,
} from "../types";

/**
 * Options for initializing sql.js
 */
export interface SqlJsInitOptions {
	/**
	 * Function to locate the WASM file.
	 * Default uses CDN: https://sql.js.org/dist/
	 */
	locateFile?: (file: string) => string;
}

/**
 * Parser for Anki .apkg package files.
 * Extracts and parses all data without Obsidian dependencies.
 */
export class AnkiPackageParser {
	private sqlPromise: Promise<SqlJsStatic> | null = null;
	private mediaProtoType: protobuf.Type | null = null;
	private sqlJsOptions: SqlJsInitOptions;

	constructor(options: SqlJsInitOptions = {}) {
		this.sqlJsOptions = options;
	}

	/**
	 * Lazy-load sql.js WASM module.
	 */
	private async getSqlJs(): Promise<SqlJsStatic> {
		if (!this.sqlPromise) {
			this.sqlPromise = initSqlJs({
				locateFile:
					this.sqlJsOptions.locateFile ??
					((file: string) => `https://sql.js.org/dist/${file}`),
			});
		}
		return this.sqlPromise;
	}

	/**
	 * Parse an Anki .apkg file from an ArrayBuffer.
	 */
	async parse(buffer: ArrayBuffer): Promise<AnkiPackageData> {
		// Load the ZIP
		const zip = await JSZip.loadAsync(buffer);

		// Only support the new format (Anki 2.1.50+)
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
				mediaData = zstdDecompress(mediaBytes);
			} else {
				mediaData = mediaBytes;
			}

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
	 * Check if the ArrayBuffer represents a supported .apkg format.
	 */
	async isSupported(buffer: ArrayBuffer): Promise<boolean> {
		const zip = await JSZip.loadAsync(buffer);
		return Boolean(zip.file("collection.anki21b"));
	}

	/**
	 * Extract a media file from the apkg.
	 * Returns the decompressed file data or null if not found.
	 */
	async extractMediaFile(
		buffer: ArrayBuffer,
		numericKey: string,
	): Promise<Uint8Array | null> {
		const zip = await JSZip.loadAsync(buffer);
		const mediaZipFile = zip.file(numericKey);
		if (!mediaZipFile) return null;

		const mediaBuffer = await mediaZipFile.async("arraybuffer");
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
		}

		return mediaBytes;
	}

	/**
	 * Parse models (note types) from the new schema tables.
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
	 */
	private parseTemplateConfig(data: Uint8Array): {
		qfmt: string;
		afmt: string;
	} {
		if (data.length === 0) {
			return { qfmt: "", afmt: "" };
		}

		let qfmt = "";
		let afmt = "";
		let pos = 0;

		while (pos < data.length) {
			const tag = data[pos];
			if (tag === undefined) break;
			pos++;

			const fieldNumber = tag >> 3;
			const wireType = tag & 0x07;

			if (wireType === 2) {
				// Length-delimited (string)
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

				const stringBytes = data.slice(pos, pos + length);
				const str = new TextDecoder().decode(stringBytes);
				pos += length;

				if (fieldNumber === 1) {
					qfmt = str;
				} else if (fieldNumber === 2) {
					afmt = str;
				}
			} else if (wireType === 0) {
				// Varint - skip
				while (pos < data.length && (data[pos]! & 0x80) !== 0) {
					pos++;
				}
				pos++;
			} else {
				break;
			}
		}

		return { qfmt, afmt };
	}

	/**
	 * Parse notetype config from protobuf blob to get the type (standard vs cloze).
	 * Field 1 = kind (0 = normal, 1 = cloze)
	 */
	private parseNotetypeConfig(data: Uint8Array): number {
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

				// Field 1 is the kind: 0 = normal, 1 = cloze
				if (fieldNumber === 1) {
					return value;
				}
			} else if (wireType === 2) {
				// Length-delimited - skip
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
}
