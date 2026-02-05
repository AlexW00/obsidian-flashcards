import { App, Modal, Notice } from "obsidian";
import type { DictionaryManager, DictDownloadProgress } from "../services/DictionaryManager";

/**
 * Modal for confirming dictionary download when enabling Furigana.
 */
export class FuriganaDictModal extends Modal {
    private dictManager: DictionaryManager;
    private onConfirm: () => Promise<void>;
    private progressEl: HTMLElement | null = null;

    constructor(
        app: App,
        dictManager: DictionaryManager,
        onConfirm: () => Promise<void>,
    ) {
        super(app);
        this.dictManager = dictManager;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: "Enable furigana" });

        contentEl.createEl("p", {
            text: "To enable furigana support, the plugin needs to download dictionary files (~18 mb) to your vault.",
        });

        contentEl.createEl("p", {
            text: "This is a one-time download. The files will be stored in your plugin folder.",
            cls: "setting-item-description",
        });

        // Progress area (hidden initially)
        this.progressEl = contentEl.createDiv({ cls: "furigana-download-progress" });
        this.progressEl.classList.add("is-hidden");

        // Button container
        const buttonContainer = contentEl.createDiv({
            cls: "modal-button-container",
        });

        // Cancel button
        buttonContainer.createEl("button", { text: "Cancel" }).addEventListener(
            "click",
            () => {
                this.close();
            },
        );

        // Download button
        const downloadBtn = buttonContainer.createEl("button", {
            text: "Download",
            cls: "mod-cta",
        });
        downloadBtn.addEventListener("click", () => {
            void this.startDownload(downloadBtn);
        });
    }

    private async startDownload(downloadBtn: HTMLButtonElement): Promise<void> {
        // Disable button and show progress
        downloadBtn.disabled = true;
        downloadBtn.setText("Downloading...");

        if (this.progressEl) {
            this.progressEl.classList.remove("is-hidden");
            this.progressEl.setText("Starting download...");
        }

        const onProgress: DictDownloadProgress = (current, total) => {
            if (this.progressEl) {
                this.progressEl.setText(`Downloading file ${current} of ${total}...`);
            }
        };

        try {
            await this.dictManager.downloadDictionary(onProgress);
            new Notice("Furigana dictionary downloaded successfully!");
            await this.onConfirm();
            this.close();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown error";
            new Notice(`Failed to download dictionary: ${message}`);
            downloadBtn.disabled = false;
            downloadBtn.setText("Retry download");
            if (this.progressEl) {
                this.progressEl.setText(`Error: ${message}`);
            }
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
