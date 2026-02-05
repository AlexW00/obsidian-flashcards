// Type declarations for modules without @types packages

declare module "turndown-plugin-gfm" {
	import TurndownService from "turndown";
	export function gfm(turndownService: TurndownService): void;
	export function tables(turndownService: TurndownService): void;
	export function strikethrough(turndownService: TurndownService): void;
	export function taskListItems(turndownService: TurndownService): void;
}

declare module "sql.js" {
	export interface SqlJsStatic {
		Database: new (data?: ArrayLike<number>) => Database;
	}

	export interface Database {
		run(sql: string, params?: unknown[]): Database;
		exec(sql: string, params?: unknown[]): QueryExecResult[];
		each(
			sql: string,
			params: unknown[],
			callback: (row: unknown) => void,
			done: () => void,
		): void;
		prepare(sql: string): Statement;
		export(): Uint8Array;
		close(): void;
		getRowsModified(): number;
		create_function(
			name: string,
			func: (...args: unknown[]) => unknown,
		): void;
	}

	export interface Statement {
		bind(params?: unknown[]): boolean;
		step(): boolean;
		getAsObject(params?: unknown): Record<string, unknown>;
		get(params?: unknown[]): unknown[];
		run(params?: unknown[]): void;
		reset(): void;
		free(): void;
		getColumnNames(): string[];
	}

	export interface QueryExecResult {
		columns: string[];
		values: unknown[][];
	}

	export interface SqlJsConfig {
		locateFile?: (file: string) => string;
		wasmBinary?: ArrayBuffer;
	}

	function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
	export default initSqlJs;
}

declare module "fzstd" {
	/**
	 * Decompress zstd-compressed data.
	 * @param data The compressed data as a Uint8Array
	 * @returns The decompressed data as a Uint8Array
	 */
	export function decompress(data: Uint8Array): Uint8Array;
}

declare module "@patdx/kuromoji" {
	export interface TokenizerToken {
		surface_form: string;
		reading?: string;
		word_type: string;
	}

	export interface Tokenizer {
		tokenize(text: string): TokenizerToken[];
	}

	export interface Builder {
		build(): Promise<Tokenizer>;
	}

	export function builder(config: {
		dicPath: string;
		loader?: {
			loadArrayBuffer: (url: string) => Promise<ArrayBufferLike>;
		};
	}): Builder;
}
