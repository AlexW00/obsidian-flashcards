import { App, Modal, TFile } from "obsidian";
import type { CardService } from "../flashcards/CardService";
import {
	ButtonRowComponent,
	ProgressBarComponent,
	SelectableListComponent,
	StatusTextComponent,
} from "./components";

/**
 * Represents a failed card with its file and error message.
 * file can be null if the file was not found.
 */
export interface FailedCard {
	file: TFile | null;
	error: string;
	/** Path to the file (useful when file is null) */
	path?: string;
}

/**
 * Result of a regeneration operation from this modal.
 */
export interface FailedCardsRegenResult {
	successCount: number;
	failedCards: FailedCard[];
	cancelled: boolean;
}

/**
 * Modal that displays a list of cards that failed to regenerate.
 * Users can select which cards to retry, and clicking a card name opens it.
 */
export class FailedCardsModal extends Modal {
	private failedCards: FailedCard[];
	private cardService: CardService;
	private onComplete?: (result: FailedCardsRegenResult) => void;

	private selectableList: SelectableListComponent<FailedCard> | null = null;
	private buttonRow: ButtonRowComponent | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private statusText: StatusTextComponent | null = null;

	private isRegenerating = false;
	private isCancelled = false;
	private isClosed = false; // Whether modal has been closed
	private useCache = true;
	private didComplete = false;

	constructor(
		app: App,
		failedCards: FailedCard[],
		cardService: CardService,
		onComplete?: (result: FailedCardsRegenResult) => void,
	) {
		super(app);
		this.failedCards = failedCards;
		this.cardService = cardService;
		this.onComplete = onComplete;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-failed-modal");

		contentEl.createEl("h2", { text: "Failed cards" });

		const cardLabel = this.failedCards.length === 1 ? "card" : "cards";
		contentEl.createEl("p", {
			text: `The following ${this.failedCards.length} ${cardLabel} failed to regenerate. Select which ones to retry.`,
		});

		// Selectable list with cards
		this.selectableList = new SelectableListComponent<FailedCard>(
			contentEl,
			{
				items: this.failedCards,
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
				containerClass: "flashcard-failed-list",
			},
		);

		// Button row with cache checkbox and regenerate button
		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Close",
			onCancel: () => this.handleCancel(),
			submitText: this.getRegenerateButtonText(),
			onSubmit: () => {
				void this.handleRegenerate();
			},
			checkboxes: [
				{
					label: "Cache AI results",
					checked: this.useCache,
					onChange: (checked) => {
						this.useCache = checked;
					},
					tooltip:
						"When enabled, AI filter results are cached and reused. Disable to force fresh AI generation.",
				},
			],
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
				failedCards: [],
				cancelled: true,
			});
		}

		this.contentEl.empty();
	}

	/**
	 * Open a card file in the editor.
	 */
	private openCard(item: FailedCard): void {
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
		const failedCards: FailedCard[] = [];

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
					failedCards.push({
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
					console.error(`Failed to regenerate ${file.path}:`, error);

					try {
						await this.cardService.setCardError(file, errorMessage);
					} catch (writeError) {
						console.error(
							`Failed to write error to ${file.path}:`,
							writeError,
						);
					}
					failedCards.push({ file, error: errorMessage });
				}
			}
		} finally {
			const result: FailedCardsRegenResult = {
				successCount,
				failedCards,
				cancelled: this.isCancelled,
			};

			// Guard against double-invocation (can happen if modal closed while regenerating)
			if (!this.didComplete) {
				this.didComplete = true;
				this.onComplete?.(result);
			}
			this.close();

			// If there are still failures, open a new modal to show them
			// Only if not cancelled (user explicitly closed, so don't show another)
			// Note: use result.cancelled, not this.isCancelled, because close() sets isCancelled=true
			if (failedCards.length > 0 && !result.cancelled) {
				new FailedCardsModal(
					this.app,
					failedCards,
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
		this.buttonRow?.setCheckboxDisabled("Cache AI results", isRegenerating);

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
