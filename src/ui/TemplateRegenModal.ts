import { App, ButtonComponent, Modal, TFile } from "obsidian";
import type {
	Flashcard,
	FlashcardTemplate,
} from "../types";
import type { CardService } from "../flashcards/CardService";
import { FailedCardsModal, type FailedCard } from "./FailedCardsModal";

/**
 * Item representing a card in the regeneration list.
 */
interface CardListItem {
	card: Flashcard;
	selected: boolean;
}

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

	private cardItems: CardListItem[] = [];
	private isRegenerating = false;
	private isCancelled = false;
	private useCache = true; // Whether to use AI cache (checked by default)
	private didComplete = false; // Whether onComplete was already called

	// UI elements
	private cardListContainer: HTMLElement | null = null;
	private regenerateButton: ButtonComponent | null = null;
	private cancelButton: ButtonComponent | null = null;
	private statusTextEl: HTMLElement | null = null;
	private progressContainer: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private cacheCheckbox: HTMLInputElement | null = null;

	// Virtual scrolling
	private static readonly ITEM_HEIGHT = 32; // Height of each row in pixels
	private static readonly BUFFER_SIZE = 10; // Extra items to render above/below viewport
	private visibleStartIndex = 0;
	private visibleEndIndex = 0;

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

		// Initialize all cards as selected
		this.cardItems = cards.map((card) => ({
			card,
			selected: true,
		}));
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

		// Controls row (select all / deselect all)
		const controlRow = contentEl.createDiv({
			cls: "template-regen-controls",
		});

		new ButtonComponent(controlRow)
			.setButtonText("Select all")
			.onClick(() => {
				for (const item of this.cardItems) {
					item.selected = true;
				}
				this.renderCardList();
				this.updateRegenerateButton();
			});

		new ButtonComponent(controlRow)
			.setButtonText("Deselect all")
			.onClick(() => {
				for (const item of this.cardItems) {
					item.selected = false;
				}
				this.renderCardList();
				this.updateRegenerateButton();
			});

		// Card count display
		const countDisplay = controlRow.createSpan({
			cls: "template-regen-count",
		});
		this.updateCountDisplay(countDisplay);

		// Card list container with virtual scrolling
		this.cardListContainer = contentEl.createDiv({
			cls: "template-regen-card-list",
		});
		this.renderCardList();

		// Button row
		const buttonRow = contentEl.createDiv({
			cls: "flashcard-modal-buttons-v2",
		});

		const leftButtons = buttonRow.createDiv({
			cls: "flashcard-buttons-left",
		});
		this.cancelButton = new ButtonComponent(leftButtons)
			.setButtonText("Cancel")
			.onClick(() => this.handleCancel());

		const rightButtons = buttonRow.createDiv({
			cls: "flashcard-buttons-right",
		});

		// Cache AI results checkbox
		const cacheLabel = rightButtons.createEl("label", {
			cls: "template-regen-cache-toggle",
			attr: {
				title:
					"When enabled, AI filter results are cached and reused. Disable to force fresh AI generation.",
			},
		});
		this.cacheCheckbox = cacheLabel.createEl("input", {
			type: "checkbox",
		});
		this.cacheCheckbox.checked = this.useCache;
		this.cacheCheckbox.addEventListener("change", () => {
			if (this.cacheCheckbox) {
				this.useCache = this.cacheCheckbox.checked;
			}
		});
		cacheLabel.createSpan({ text: "Cache AI results" });

		this.regenerateButton = new ButtonComponent(rightButtons)
			.setButtonText("Regenerate")
			.setCta()
			.onClick(() => this.handleRegenerate());

		this.updateRegenerateButton();

		// Progress container (hidden initially)
		this.progressContainer = contentEl.createDiv({
			cls: "template-regen-progress template-regen-progress-hidden",
		});

		const progressBarContainer = this.progressContainer.createDiv({
			cls: "flashcard-progress-bar",
		});
		this.progressBar = progressBarContainer.createDiv({
			cls: "flashcard-progress-fill",
		});

		// Status text
		this.statusTextEl = contentEl.createDiv({
			cls: "flashcard-modal-status-text",
		});
	}

	onClose() {
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
	 * Render the card list with virtual scrolling for performance.
	 */
	private renderCardList(): void {
		if (!this.cardListContainer) return;
		this.cardListContainer.empty();

		// For small lists, render all items directly
		if (this.cardItems.length <= 100) {
			this.renderAllCards();
			return;
		}

		// For large lists, use virtual scrolling
		this.setupVirtualScrolling();
	}

	/**
	 * Render all cards directly (for small lists).
	 */
	private renderAllCards(): void {
		if (!this.cardListContainer) return;

		const listEl = this.cardListContainer.createDiv({
			cls: "template-regen-cards",
		});

		for (const item of this.cardItems) {
			this.renderCardRow(listEl, item);
		}
	}

	/**
	 * Set up virtual scrolling for large lists.
	 */
	private setupVirtualScrolling(): void {
		if (!this.cardListContainer) return;

		const container = this.cardListContainer;
		const totalHeight = this.cardItems.length * TemplateRegenModal.ITEM_HEIGHT;

		// Create scrollable container with total height
		const scrollContainer = container.createDiv({
			cls: "template-regen-virtual-scroll",
		});
		scrollContainer.setCssProps({
			"--virtual-scroll-height": `${totalHeight}px`,
		});

		// Visible items container
		const visibleContainer = scrollContainer.createDiv({
			cls: "template-regen-visible-items",
		});

		// Initial render
		this.updateVisibleItems(container, visibleContainer, 0);

		// Handle scroll events
		container.addEventListener("scroll", () => {
			this.updateVisibleItems(
				container,
				visibleContainer,
				container.scrollTop,
			);
		});
	}

	/**
	 * Update which items are visible based on scroll position.
	 */
	private updateVisibleItems(
		container: HTMLElement,
		visibleContainer: HTMLElement,
		scrollTop: number,
	): void {
		const viewportHeight = container.clientHeight;
		const itemHeight = TemplateRegenModal.ITEM_HEIGHT;
		const bufferSize = TemplateRegenModal.BUFFER_SIZE;

		// Calculate visible range
		const startIndex = Math.max(
			0,
			Math.floor(scrollTop / itemHeight) - bufferSize,
		);
		const endIndex = Math.min(
			this.cardItems.length,
			Math.ceil((scrollTop + viewportHeight) / itemHeight) + bufferSize,
		);

		// Only re-render if range changed
		if (startIndex === this.visibleStartIndex && endIndex === this.visibleEndIndex) {
			return;
		}

		this.visibleStartIndex = startIndex;
		this.visibleEndIndex = endIndex;

		// Clear and re-render visible items
		visibleContainer.empty();
		visibleContainer.setCssProps({
			"--visible-items-top": `${startIndex * itemHeight}px`,
		});

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.cardItems[i];
			if (item) {
				this.renderCardRow(visibleContainer, item);
			}
		}
	}

	/**
	 * Render a single card row.
	 */
	private renderCardRow(container: HTMLElement, item: CardListItem): void {
		const row = container.createDiv({ cls: "template-regen-card-row" });
		row.style.height = `${TemplateRegenModal.ITEM_HEIGHT}px`;

		// Checkbox
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.className = "template-regen-checkbox";
		checkbox.checked = item.selected;
		checkbox.disabled = this.isRegenerating;
		checkbox.addEventListener("change", () => {
			item.selected = checkbox.checked;
			this.updateRegenerateButton();
			this.updateCountDisplayFromContainer();
		});
		row.appendChild(checkbox);

		// Card name (file basename without extension)
		const fileName = item.card.path.split("/").pop() ?? item.card.path;
		const displayName = fileName.endsWith(".md")
			? fileName.slice(0, -3)
			: fileName;

		row.createSpan({
			text: displayName,
			cls: "template-regen-card-name",
		});
	}

	/**
	 * Update the card count display.
	 */
	private updateCountDisplay(el: HTMLElement): void {
		const selectedCount = this.cardItems.filter((i) => i.selected).length;
		el.textContent = `${selectedCount} of ${this.cardItems.length} selected`;
	}

	/**
	 * Update the count display from within the modal.
	 */
	private updateCountDisplayFromContainer(): void {
		const countEl = this.contentEl.querySelector(".template-regen-count");
		if (countEl instanceof HTMLElement) {
			this.updateCountDisplay(countEl);
		}
	}

	/**
	 * Update the regenerate button state.
	 */
	private updateRegenerateButton(): void {
		const hasSelection = this.cardItems.some((i) => i.selected);
		const selectedCount = this.cardItems.filter((i) => i.selected).length;
		this.regenerateButton?.setDisabled(!hasSelection || this.isRegenerating);

		if (!this.isRegenerating) {
			const buttonText = selectedCount === 1
				? "Regenerate 1 card"
				: `Regenerate ${selectedCount} cards`;
			this.regenerateButton?.setButtonText(buttonText);
		}
	}

	/**
	 * Handle cancel button click.
	 */
	private handleCancel(): void {
		if (this.isRegenerating) {
			this.isCancelled = true;
			this.setStatusText("Cancelling...");
		} else {
			this.close();
		}
	}

	/**
	 * Handle regenerate button click.
	 */
	private async handleRegenerate(): Promise<void> {
		const selectedItems = this.cardItems.filter((i) => i.selected);
		if (selectedItems.length === 0) return;

		this.setRegenerating(true);

		let successCount = 0;
		const failedCards: FailedCard[] = [];

		// Show progress
		this.showProgress();

		try {
			for (let i = 0; i < selectedItems.length; i++) {
				// Check for cancellation
				if (this.isCancelled) {
					break;
				}

				const item = selectedItems[i];
				if (!item) continue;

				const cardPath = item.card.path;
				const file = this.app.vault.getAbstractFileByPath(cardPath);

				// Update progress
				const progress = (i + 1) / selectedItems.length;
				this.updateProgress(progress);

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
				this.setStatusText(`Regenerating ${i + 1}/${selectedItems.length}: ${fileName}`);

				try {
					await this.cardService.regenerateCard(file, {
						skipCache: !this.useCache,
						onStatusUpdate: (fieldStatus) => {
							this.setStatusText(
								`Regenerating ${i + 1}/${selectedItems.length}: ${fileName} - ${fieldStatus}`,
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

			this.didComplete = true;
			this.onComplete?.(result);
			this.close();

			// Show result modal if there were failures
			if (failedCards.length > 0) {
				new FailedCardsModal(this.app, failedCards).open();
			}
		}
	}

	/**
	 * Show progress bar.
	 */
	private showProgress(): void {
		this.progressContainer?.removeClass("template-regen-progress-hidden");
	}

	/**
	 * Update progress bar.
	 */
	private updateProgress(fraction: number): void {
		if (this.progressBar) {
			this.progressBar.style.width = `${fraction * 100}%`;
		}
	}

	/**
	 * Set the status text.
	 */
	private setStatusText(text: string): void {
		if (this.statusTextEl) {
			this.statusTextEl.textContent = text;
			this.statusTextEl.toggleClass("is-visible", text.length > 0);
		}
	}

	/**
	 * Set regenerating state and update UI accordingly.
	 */
	private setRegenerating(isRegenerating: boolean): void {
		this.isRegenerating = isRegenerating;

		// Update button states
		this.regenerateButton?.setDisabled(isRegenerating);
		this.cancelButton?.setButtonText(isRegenerating ? "Cancel" : "Close");

		if (isRegenerating) {
			this.regenerateButton?.setButtonText("Regenerating...");
			if (this.regenerateButton?.buttonEl) {
				this.regenerateButton.buttonEl.addClass("flashcard-button-loading");
			}
		}

		// Disable cache checkbox during regeneration
		if (this.cacheCheckbox) {
			this.cacheCheckbox.disabled = isRegenerating;
		}

		// Disable checkboxes during regeneration
		this.contentEl
			.querySelectorAll<HTMLInputElement>(".template-regen-checkbox")
			.forEach((checkbox) => {
				checkbox.disabled = isRegenerating;
			});

		// Disable select all / deselect all buttons
		this.contentEl
			.querySelectorAll<HTMLButtonElement>(".template-regen-controls button")
			.forEach((btn) => {
				btn.disabled = isRegenerating;
			});
	}
}
