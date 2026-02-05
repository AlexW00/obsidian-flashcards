import { App, Modal, Notice, TFile } from "obsidian";
import type { CardService } from "../flashcards/CardService";
import {
	ButtonRowComponent,
	type CheckboxConfig,
	ProgressBarComponent,
	SelectableListComponent,
	StatusTextComponent,
} from "./components";

/**
 * Represents a card with a regeneration error.
 * file can be null if the file was not found.
 */
export interface CardError {
	file: TFile | null;
	error: string;
	/** Path to the file (useful when file is null) */
	path?: string;
}

/**
 * Result of a regeneration operation from this modal.
 */
export interface CardErrorsRegenResult {
	successCount: number;
	cardErrors: CardError[];
	cancelled: boolean;
}

/**
 * Modal that displays a list of cards with regeneration errors.
 * Users can select which cards to retry, and clicking a card name opens it.
 */
export class CardErrorsModal extends Modal {
	private cardErrors: CardError[];
	private cardService: CardService;
	private onComplete?: (result: CardErrorsRegenResult) => void;

	private selectableList: SelectableListComponent<CardError> | null = null;
	private buttonRow: ButtonRowComponent | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private statusText: StatusTextComponent | null = null;

	private isRegenerating = false;
	private isCancelled = false;
	private isClosed = false; // Whether modal has been closed
	private showCacheCheckbox = false;
	private useCache = true;
	private didComplete = false;

	constructor(
		app: App,
		cardErrors: CardError[],
		cardService: CardService,
		onComplete?: (result: CardErrorsRegenResult) => void,
	) {
		super(app);
		this.cardErrors = cardErrors;
		this.cardService = cardService;
		this.onComplete = onComplete;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-error-modal");

		contentEl.createEl("h2", { text: "Card errors" });

		const cardLabel =
			this.cardErrors.length === 1 ? "card has" : "cards have";
		contentEl.createEl("p", {
			text: `The following ${this.cardErrors.length} ${cardLabel} regeneration errors. Select which ones to retry.`,
		});

		// Selectable list with cards
		const listContainer = contentEl.createDiv({
			cls: "flashcard-error-list-container",
		});
		this.selectableList = new SelectableListComponent<CardError>(
			listContainer,
			{
				items: this.cardErrors,
				getDisplayName: (item) => {
					if (item.file) {
						return item.file.basename;
					}
					const fileName = item.path?.split("/").pop() ?? "Unknown";
					return fileName.endsWith(".md")
						? fileName.slice(0, -3)
						: fileName;
				},
				getSecondaryText: (item) => {
					// Truncate error for display
					return item.error.length > 60
						? item.error.slice(0, 57) + "..."
						: item.error;
				},
				onSelectionChange: () => this.updateButtonState(),
				onItemClick: (item) => this.openCard(item),
				initiallySelected: true,
				containerClass: "flashcard-error-list",
			},
		);

		this.showCacheCheckbox = await this.determineShowCacheCheckbox();

		// Button row with cache checkbox and regenerate button
		const checkboxes: CheckboxConfig[] = this.showCacheCheckbox
			? [
				{
					label: "Cache AI results",
					checked: this.useCache,
					onChange: (checked: boolean) => {
						this.useCache = checked;
					},
					tooltip:
						"When enabled, AI filter results are cached and reused. Disable to force fresh AI generation.",
				},
			]
			: [];

		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Close",
			onCancel: () => this.handleCancel(),
			submitText: this.getRegenerateButtonText(),
			onSubmit: () => {
				void this.handleRegenerate();
			},
			checkboxes: checkboxes.length > 0 ? checkboxes : undefined,
		});

		// Progress bar (hidden initially)
		this.progressBar = new ProgressBarComponent(contentEl);

		// Status text
		this.statusText = new StatusTextComponent(contentEl);

		this.updateButtonState();
	}

	onClose() {
		// Guard against multiple close calls
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;

		if (this.isRegenerating) {
			this.isCancelled = true;
		}

		if (!this.didComplete) {
			this.didComplete = true;
			this.onComplete?.({
				successCount: 0,
				cardErrors: [],
				cancelled: true,
			});
		}

		this.contentEl.empty();
	}

	private async determineShowCacheCheckbox(): Promise<boolean> {
		const files = this.cardErrors
			.map((item) => {
				if (item.file) {
					return item.file;
				}
				if (!item.path) {
					return null;
				}
				const file = this.app.vault.getAbstractFileByPath(item.path);
				return file instanceof TFile ? file : null;
			})
			.filter((file): file is TFile => Boolean(file));

		if (files.length === 0) {
			return false;
		}

		return this.cardService.anyCardsUseDynamicPipes(files);
	}

	/**
	 * Open a card file in the editor.
	 */
	private openCard(item: CardError): void {
		if (item.file) {
			void this.app.workspace.getLeaf().openFile(item.file);
			this.close();
		} else if (item.path) {
			// Try to find the file by path
			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (file instanceof TFile) {
				void this.app.workspace.getLeaf().openFile(file);
				this.close();
			}
		}
	}

	/**
	 * Get the regenerate button text based on selection count.
	 */
	private getRegenerateButtonText(): string {
		const count = this.selectableList?.getSelectedCount() ?? 0;
		if (count === 0) return "Regenerate";
		return count === 1 ? "Regenerate 1 card" : `Regenerate ${count} cards`;
	}

	/**
	 * Update the button state based on selection.
	 */
	private updateButtonState(): void {
		const count = this.selectableList?.getSelectedCount() ?? 0;
		this.buttonRow?.setSubmitDisabled(count === 0 || this.isRegenerating);
		this.buttonRow?.setSubmitText(this.getRegenerateButtonText());
	}

	/**
	 * Handle cancel button click.
	 */
	private handleCancel(): void {
		if (this.isRegenerating) {
			this.isCancelled = true;
			this.statusText?.setText("Cancelling...");
		} else {
			this.close();
		}
	}

	/**
	 * Handle regenerate button click.
	 */
	private async handleRegenerate(): Promise<void> {
		const selectedItems = this.selectableList?.getSelectedItems() ?? [];
		if (selectedItems.length === 0) return;

		this.setRegenerating(true);
		this.progressBar?.show();

		let successCount = 0;
		const cardErrors: CardError[] = [];

		try {
			for (let i = 0; i < selectedItems.length; i++) {
				if (this.isCancelled) break;

				const item = selectedItems[i];
				if (!item) continue;

				this.progressBar?.setProgress(
					i + 1,
					selectedItems.length,
					`${i + 1}/${selectedItems.length}`,
				);

				// Get the file
				let file = item.file;
				if (!file && item.path) {
					const abstractFile = this.app.vault.getAbstractFileByPath(
						item.path,
					);
					if (abstractFile instanceof TFile) {
						file = abstractFile;
					}
				}

				if (!file) {
					cardErrors.push({
						file: null,
						path: item.path,
						error: `File not found: ${item.path ?? "unknown"}`,
					});
					continue;
				}

				const fileName = file.basename;
				this.statusText?.setText(
					`Regenerating ${i + 1}/${selectedItems.length}: ${fileName}`,
				);

				try {
					await this.cardService.regenerateCard(file, {
						skipCache: !this.useCache,
						onStatusUpdate: (fieldStatus) => {
							this.statusText?.setText(
								`Regenerating ${i + 1}/${selectedItems.length}: ${fileName} - ${fieldStatus}`,
							);
						},
					});
					await this.cardService.clearCardError(file);
					successCount++;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(
						`Regeneration error for ${file.path}:`,
						error,
					);

					try {
						await this.cardService.setCardError(file, errorMessage);
					} catch (writeError) {
						console.error(
							`Failed to write error to ${file.path}:`,
							writeError,
						);
					}
					cardErrors.push({ file, error: errorMessage });
				}
			}
		} finally {
			const result: CardErrorsRegenResult = {
				successCount,
				cardErrors,
				cancelled: this.isCancelled,
			};

			if (!result.cancelled && cardErrors.length === 0) {
				new Notice(
					`Successfully regenerated ${successCount} card${successCount !== 1 ? "s" : ""}.`,
				);
			}

			// Guard against double-invocation (can happen if modal closed while regenerating)
			if (!this.didComplete) {
				this.didComplete = true;
				this.onComplete?.(result);
			}
			this.close();

			// If there are still errors, open a new modal to show them
			// Only if not cancelled (user explicitly closed, so don't show another)
			// Note: use result.cancelled, not this.isCancelled, because close() sets isCancelled=true
			if (cardErrors.length > 0 && !result.cancelled) {
				new CardErrorsModal(
					this.app,
					cardErrors,
					this.cardService,
				).open();
			}
		}
	}

	/**
	 * Set regenerating state and update UI accordingly.
	 */
	private setRegenerating(isRegenerating: boolean): void {
		this.isRegenerating = isRegenerating;

		this.selectableList?.setDisabled(isRegenerating);
		this.buttonRow?.setSubmitDisabled(isRegenerating);
		this.buttonRow?.setCancelText(isRegenerating ? "Cancel" : "Close");
		if (this.showCacheCheckbox) {
			this.buttonRow?.setCheckboxDisabled(
				"Cache AI results",
				isRegenerating,
			);
		}

		if (isRegenerating) {
			this.buttonRow?.setSubmitText("Regenerating...");
			this.buttonRow?.setSubmitLoading(true);
		}

		// Disable select all / deselect all buttons
		this.contentEl
			.querySelectorAll<HTMLButtonElement>(
				".selectable-list-controls button",
			)
			.forEach((btn) => {
				btn.disabled = isRegenerating;
			});
	}
}
