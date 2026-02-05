import { App, Modal, TFile } from "obsidian";
import type { Flashcard, FlashcardTemplate } from "../types";
import type { CardService } from "../flashcards/CardService";
import { FailedCardsModal, type FailedCard } from "./FailedCardsModal";
import {
	ButtonRowComponent,
	ProgressBarComponent,
	SelectableListComponent,
	StatusTextComponent,
} from "./components";

/**
 * Result of a regeneration operation.
 */
export interface RegenResult {
	successCount: number;
	failedCards: FailedCard[];
	cancelled: boolean;
}

/**
 * Modal for selecting and regenerating cards from a template.
 * Supports large card lists (3000+) with efficient rendering.
 */
export class TemplateRegenModal extends Modal {
	private template: FlashcardTemplate;
	private cards: Flashcard[];
	private cardService: CardService;
	private onComplete?: (result: RegenResult) => void;

	private isRegenerating = false;
	private isCancelled = false;
	private isClosed = false; // Whether modal has been closed
	private useCache = true; // Whether to use AI cache (checked by default)
	private didComplete = false; // Whether onComplete was already called

	// UI components
	private selectableList: SelectableListComponent<Flashcard> | null = null;
	private buttonRow: ButtonRowComponent | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private statusText: StatusTextComponent | null = null;

	constructor(
		app: App,
		template: FlashcardTemplate,
		cards: Flashcard[],
		cardService: CardService,
		onComplete?: (result: RegenResult) => void,
	) {
		super(app);
		this.template = template;
		this.cards = cards;
		this.cardService = cardService;
		this.onComplete = onComplete;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("template-regen-modal");

		// Header
		const headerRow = contentEl.createDiv({
			cls: "flashcard-modal-header-row",
		});
		headerRow.createSpan({
			text: `Regenerate cards from "${this.template.name}"`,
			cls: "flashcard-modal-header-text",
		});

		// Separator
		contentEl.createDiv({ cls: "flashcard-modal-header-separator" });

		// Description
		const description = contentEl.createEl("p", {
			cls: "template-regen-description",
		});
		const cardLabel = this.cards.length === 1 ? "card" : "cards";
		description.textContent = `${this.cards.length} ${cardLabel} will be regenerated using the updated template. This may take a while if AI filters are used.`;

		// Card list with select all/deselect all using SelectableListComponent
		const listContainer = contentEl.createDiv({
			cls: "template-regen-list-container",
		});
		this.selectableList = new SelectableListComponent(listContainer, {
			items: this.cards,
			getDisplayName: (card) => {
				const fileName = card.path.split("/").pop() ?? card.path;
				return fileName.endsWith(".md")
					? fileName.slice(0, -3)
					: fileName;
			},
			onSelectionChange: () => this.updateRegenerateButton(),
			onItemClick: (card) => this.openCard(card),
			initiallySelected: true,
			containerClass: "template-regen-card-list",
			showCount: true,
		});

		// Button row with components
		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Cancel",
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
		this.progressBar = new ProgressBarComponent(contentEl, {
			containerClass: "template-regen-progress",
			showText: false,
		});

		// Status text
		this.statusText = new StatusTextComponent(contentEl);
	}

	onClose() {
		// Guard against multiple close calls
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;

		// If regeneration is in progress, mark as cancelled
		if (this.isRegenerating) {
			this.isCancelled = true;
		}

		// If modal was closed without completing regeneration, notify with cancelled result
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
	private openCard(card: Flashcard): void {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf().openFile(file);
			this.close();
		}
	}

	/**
	 * Get the regenerate button text based on selection count.
	 */
	private getRegenerateButtonText(): string {
		const selectedCount =
			this.selectableList?.getSelectedCount() ?? this.cards.length;
		return selectedCount === 1
			? "Regenerate 1 card"
			: `Regenerate ${selectedCount} cards`;
	}

	/**
	 * Update the regenerate button state.
	 */
	private updateRegenerateButton(): void {
		const selectedCount = this.selectableList?.getSelectedCount() ?? 0;
		const hasSelection = selectedCount > 0;
		this.buttonRow?.setSubmitDisabled(!hasSelection || this.isRegenerating);

		if (!this.isRegenerating) {
			this.buttonRow?.setSubmitText(this.getRegenerateButtonText());
		}
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
		const selectedCards = this.selectableList?.getSelectedItems() ?? [];
		if (selectedCards.length === 0) return;

		this.setRegenerating(true);

		let successCount = 0;
		const failedCards: FailedCard[] = [];

		// Show progress
		this.progressBar?.show();

		try {
			for (let i = 0; i < selectedCards.length; i++) {
				// Check for cancellation
				if (this.isCancelled) {
					break;
				}

				const card = selectedCards[i];
				if (!card) continue;

				const cardPath = card.path;
				const file = this.app.vault.getAbstractFileByPath(cardPath);

				// Update progress
				const progress = (i + 1) / selectedCards.length;
				this.progressBar?.setFraction(progress);

				if (!(file instanceof TFile)) {
					failedCards.push({
						file: null,
						path: cardPath,
						error: `File not found: ${cardPath}`,
					});
					continue;
				}

				// Update status with current card name
				const fileName = file.basename;
				this.statusText?.setText(
					`Regenerating ${i + 1}/${selectedCards.length}: ${fileName}`,
				);

				try {
					await this.cardService.regenerateCard(file, {
						skipCache: !this.useCache,
						onStatusUpdate: (fieldStatus) => {
							this.statusText?.setText(
								`Regenerating ${i + 1}/${selectedCards.length}: ${fileName} - ${fieldStatus}`,
							);
						},
					});

					// Clear any previous error
					await this.cardService.clearCardError(file);
					successCount++;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(`Failed to regenerate ${cardPath}:`, error);

					// Write error to card frontmatter
					try {
						await this.cardService.setCardError(file, errorMessage);
					} catch (writeError) {
						console.error(
							`Failed to write error to ${cardPath}:`,
							writeError,
						);
					}
					failedCards.push({ file, error: errorMessage });
				}
			}
		} finally {
			const result: RegenResult = {
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

			// Show result modal if there were failures AND not cancelled
			// (if cancelled, user explicitly closed the modal so don't show another)
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

		// Update button states
		this.buttonRow?.setSubmitDisabled(isRegenerating);
		this.buttonRow?.setCancelText(isRegenerating ? "Cancel" : "Close");

		if (isRegenerating) {
			this.buttonRow?.setSubmitText("Regenerating...");
			this.buttonRow?.setSubmitLoading(true);
		}

		// Disable cache checkbox during regeneration
		this.buttonRow?.setCheckboxDisabled("Cache AI results", isRegenerating);

		// Disable checkboxes in selectable list during regeneration
		this.selectableList?.setDisabled(isRegenerating);
	}
}
