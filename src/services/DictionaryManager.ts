import { App, requestUrl } from "obsidian";

/**
 * Required dictionary files for kuromoji tokenizer.
 */
const DICT_FILES = [
    "base.dat.gz",
    "cc.dat.gz",
    "check.dat.gz",
    "tid.dat.gz",
    "tid_map.dat.gz",
    "tid_pos.dat.gz",
    "unk.dat.gz",
    "unk_char.dat.gz",
    "unk_compat.dat.gz",
    "unk_invoke.dat.gz",
    "unk_map.dat.gz",
    "unk_pos.dat.gz",
] as const;

/**
 * Base URL for downloading dictionary files from GitHub.
 */
const DICT_BASE_URL =
    "https://github.com/AlexW00/anker/raw/master/resources/dict";

/**
 * Progress callback for dictionary download.
 */
export type DictDownloadProgress = (current: number, total: number) => void;

/**
 * Manages kuromoji dictionary files for the Furigana pipe.
 * Handles checking, downloading, and locating dictionary files.
 */
export class DictionaryManager {
    private app: App;
    private pluginDir: string;

    constructor(app: App, pluginDir: string) {
        this.app = app;
        this.pluginDir = pluginDir;
    }

    /**
     * Get the path to the dictionary directory within the plugin folder.
     */
    getDictPath(): string {
        return `${this.pluginDir}/resources/dict`;
    }

    /**
     * Check if all required dictionary files are present.
     */
    async isDictionaryReady(): Promise<boolean> {
        const dictPath = this.getDictPath();
        const adapter = this.app.vault.adapter;

        for (const file of DICT_FILES) {
            const filePath = `${dictPath}/${file}`;
            const exists = await adapter.exists(filePath);
            if (!exists) {
                return false;
            }
        }
        return true;
    }

    /**
     * Download all dictionary files from GitHub.
     * @param onProgress Optional callback for download progress updates
     */
    async downloadDictionary(onProgress?: DictDownloadProgress): Promise<void> {
        const dictPath = this.getDictPath();
        const adapter = this.app.vault.adapter;

        // Ensure dict directory exists
        const dictExists = await adapter.exists(dictPath);
        if (!dictExists) {
            await adapter.mkdir(dictPath);
        }

        const total = DICT_FILES.length;
        let current = 0;

        for (const file of DICT_FILES) {
            const url = `${DICT_BASE_URL}/${file}`;
            const filePath = `${dictPath}/${file}`;

            // Download file
            const response = await requestUrl({
                url,
                method: "GET",
            });

            if (response.status !== 200) {
                throw new Error(`Failed to download ${file}: HTTP ${response.status}`);
            }

            // Write to disk as binary
            await adapter.writeBinary(filePath, response.arrayBuffer);

            current++;
            onProgress?.(current, total);
        }
    }

    /**
     * Delete all dictionary files (cleanup).
     */
    async deleteDictionary(): Promise<void> {
        const dictPath = this.getDictPath();
        const adapter = this.app.vault.adapter;

        const dictExists = await adapter.exists(dictPath);
        if (dictExists) {
            // Remove each file
            for (const file of DICT_FILES) {
                const filePath = `${dictPath}/${file}`;
                const exists = await adapter.exists(filePath);
                if (exists) {
                    await adapter.remove(filePath);
                }
            }
            // Try to remove the directory
            try {
                await adapter.rmdir(dictPath, false);
            } catch {
                // Directory might not be empty or might not exist
            }
        }
    }
}
