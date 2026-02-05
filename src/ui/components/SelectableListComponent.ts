import { ButtonComponent } from "obsidian";
import { StickyListContainer } from "./StickyListContainer";

/**
 * Item wrapper with selection state for the SelectableListComponent.
 */
export interface SelectableItem<T> {
	item: T;
	selected: boolean;
}

/**
 * Configuration for the SelectableListComponent.
 */
export interface SelectableListOptions<T> {
	/** Initial items to display. */
	items: T[];
	/** Function to get display name for an item. */
	getDisplayName: (item: T) => string;
	/** Optional function to get secondary text (shown after display name). */
	getSecondaryText?: (item: T) => string;
	/** Optional function to get indent level for an item (0 = no indent). */
	getIndent?: (item: T) => number;
	/** Optional function to check if an item should be disabled (non-selectable). */
	isItemDisabled?: (item: T) => boolean;
	/** Number of items above which virtual scrolling is enabled. Defaults to 100. */
	virtualScrollThreshold?: number;
	/** Callback when selection changes. */
	onSelectionChange?: (selectedItems: T[]) => void;
	/** Callback when an item's display name is clicked. */
	onItemClick?: (item: T) => void;
	/** Whether all items are initially selected. Defaults to true. */
	initiallySelected?: boolean;
	/** CSS class for the list container. */
	containerClass?: string;
	/** Whether to show Select all / Deselect all buttons. Defaults to true. */
	showControls?: boolean;
	/** Whether to show the selection count. Defaults to true. */
	showCount?: boolean;
}

/**
 * Virtual scroll configuration.
 */
interface VirtualScrollState {
	container: HTMLElement;
	visibleContainer: HTMLElement;
	itemHeight: number;
	bufferSize: number;
	visibleStartIndex: number;
	visibleEndIndex: number;
}

/**
 * Reusable selectable list component with checkboxes, select all/deselect all,
 * and virtual scrolling for large lists.
 *
 * Key improvement over previous implementations: checkbox state updates are done
 * in-place without rebuilding the entire list, fixing the virtual scroll bug.
 */
export class SelectableListComponent<T> {
	private containerEl: HTMLElement;
	private scrollEl: HTMLElement;
	private listEl: HTMLElement;
	private headerEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private options: SelectableListOptions<T>;
	private selectableItems: SelectableItem<T>[] = [];
	private virtualScroll: VirtualScrollState | null = null;
	private checkboxElements: Map<number, HTMLInputElement> = new Map();
	private isDisabled = false;
	private stickyContainer: StickyListContainer;

	private static readonly DEFAULT_ITEM_HEIGHT = 32;
	private static readonly BUFFER_SIZE = 10;
	private static readonly DEFAULT_THRESHOLD = 100;

	constructor(container: HTMLElement, options: SelectableListOptions<T>) {
		this.options = options;
		this.containerEl = container;

		// Initialize items with selection state
		const initiallySelected = options.initiallySelected !== false;
		this.selectableItems = options.items.map((item) => ({
			item,
			// Disabled items are never initially selected
			selected:
				initiallySelected && !(options.isItemDisabled?.(item) ?? false),
		}));

		this.render();
	}

	private render(): void {
		const contentClasses = ["selectable-list-items"];
		if (this.options.containerClass) {
			contentClasses.push(this.options.containerClass);
		}

		this.stickyContainer = new StickyListContainer(this.containerEl, {
			scrollClass: "selectable-list",
			headerClass: "selectable-list-header",
			contentClass: contentClasses.join(" "),
		});
		this.scrollEl = this.stickyContainer.getScrollEl();
		this.listEl = this.stickyContainer.getContentEl();

		// Controls row (select all / deselect all)
		if (this.options.showControls !== false) {
			this.headerEl = this.stickyContainer.getHeaderEl();
			const controlRow = this.headerEl.createDiv({
				cls: "selectable-list-controls",
			});

			new ButtonComponent(controlRow)
				.setButtonText("Select all")
				.onClick(() => this.selectAll());

			new ButtonComponent(controlRow)
				.setButtonText("Deselect all")
				.onClick(() => this.deselectAll());

			// Count display
			if (this.options.showCount !== false) {
				this.countEl = controlRow.createSpan({
					cls: "selectable-list-count",
				});
				this.updateCountDisplay();
			}
		} else {
			this.stickyContainer.removeHeader();
		}

		this.renderList();
	}

	private renderList(): void {
		this.listEl.empty();
		this.checkboxElements.clear();

		const threshold =
			this.options.virtualScrollThreshold ??
			SelectableListComponent.DEFAULT_THRESHOLD;

		if (this.selectableItems.length <= threshold) {
			this.renderAllItems();
		} else {
			this.setupVirtualScrolling();
		}
	}

	private renderAllItems(): void {
		for (let i = 0; i < this.selectableItems.length; i++) {
			this.renderItemRow(this.listEl, i);
		}
	}

	private setupVirtualScrolling(): void {
		// Measure item height first
		const measureContainer = this.listEl.createDiv({
			cls: "selectable-list-measure",
		});
		const measureRow = this.renderItemRow(measureContainer, 0, true);
		const itemHeight =
			measureRow.offsetHeight ||
			SelectableListComponent.DEFAULT_ITEM_HEIGHT;
		measureContainer.remove();

		// Set up virtual scroll container
		const totalHeight = this.selectableItems.length * itemHeight;
		this.listEl.style.setProperty(
			"--virtual-total-height",
			`${totalHeight}px`,
		);
		this.listEl.addClass("selectable-list-virtual");

		// Create spacer to establish scrollable height
		const spacer = this.listEl.createDiv({
			cls: "selectable-list-spacer",
		});
		spacer.style.height = `${totalHeight}px`;

		const visibleContainer = this.listEl.createDiv({
			cls: "selectable-list-visible",
		});

		this.virtualScroll = {
			container: this.scrollEl,
			visibleContainer,
			itemHeight,
			bufferSize: SelectableListComponent.BUFFER_SIZE,
			visibleStartIndex: -1,
			visibleEndIndex: -1,
		};

		// Initial render
		this.updateVisibleItems(0);

		// Scroll handler
		this.scrollEl.addEventListener("scroll", () => {
			if (this.virtualScroll) {
				this.updateVisibleItems(this.scrollEl.scrollTop);
			}
		});
	}

	private updateVisibleItems(scrollTop: number): void {
		if (!this.virtualScroll) return;

		const { itemHeight, bufferSize, visibleContainer } = this.virtualScroll;
		const headerHeight = this.headerEl?.offsetHeight ?? 0;
		const scrollTopAdjusted = Math.max(0, scrollTop - headerHeight);
		const containerHeight = Math.max(
			0,
			this.scrollEl.clientHeight - headerHeight,
		);

		const startIndex = Math.max(
			0,
			Math.floor(scrollTopAdjusted / itemHeight) - bufferSize,
		);
		const visibleCount = Math.ceil(containerHeight / itemHeight);
		const endIndex = Math.min(
			this.selectableItems.length - 1,
			startIndex + visibleCount + bufferSize * 2,
		);

		// Skip if range hasn't changed
		if (
			startIndex === this.virtualScroll.visibleStartIndex &&
			endIndex === this.virtualScroll.visibleEndIndex
		) {
			return;
		}

		this.virtualScroll.visibleStartIndex = startIndex;
		this.virtualScroll.visibleEndIndex = endIndex;

		// Clear and re-render visible items
		visibleContainer.empty();
		this.checkboxElements.clear();

		// Position visible container using transform for smooth scrolling
		const topOffset = startIndex * itemHeight;
		visibleContainer.style.transform = `translateY(${topOffset}px)`;

		for (let i = startIndex; i <= endIndex; i++) {
			this.renderItemRow(visibleContainer, i);
		}
	}

	private renderItemRow(
		container: HTMLElement,
		index: number,
		forMeasure = false,
	): HTMLElement {
		const selectableItem = this.selectableItems[index];
		const row = container.createDiv({ cls: "selectable-list-item" });

		// Guard against undefined (shouldn't happen but TypeScript requires it)
		if (!selectableItem) {
			return row;
		}

		// Apply indentation if getIndent is provided
		if (this.options.getIndent) {
			const indent = this.options.getIndent(selectableItem.item);
			if (indent > 0) {
				row.style.setProperty("--sl-indent", String(indent));
			}
		}

		// Check if item is disabled (non-selectable)
		const isItemDisabled =
			this.options.isItemDisabled?.(selectableItem.item) ?? false;
		if (isItemDisabled) {
			row.addClass("selectable-list-item-disabled");
		}

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.checked = selectableItem.selected;
		checkbox.disabled = this.isDisabled || isItemDisabled;
		if (isItemDisabled) {
			checkbox.addClass("selectable-list-checkbox-hidden");
		}

		if (!forMeasure) {
			this.checkboxElements.set(index, checkbox);

			checkbox.addEventListener("change", () => {
				selectableItem.selected = checkbox.checked;
				this.onSelectionChanged();
			});
		}

		const displayName = this.options.getDisplayName(selectableItem.item);
		const nameEl = row.createSpan({
			text: displayName,
			cls: "selectable-list-item-name",
		});

		// Make name clickable if onItemClick is provided
		if (this.options.onItemClick && !forMeasure) {
			nameEl.addClass("selectable-list-item-name-clickable");
			nameEl.addEventListener("click", (e) => {
				e.stopPropagation();
				this.options.onItemClick?.(selectableItem.item);
			});
		}

		if (this.options.getSecondaryText) {
			const secondaryText = this.options.getSecondaryText(
				selectableItem.item,
			);
			if (secondaryText) {
				row.createSpan({
					text: secondaryText,
					cls: "selectable-list-item-secondary",
				});
			}
		}

		return row;
	}

	private onSelectionChanged(): void {
		this.updateCountDisplay();
		this.options.onSelectionChange?.(this.getSelectedItems());
	}

	private updateCountDisplay(): void {
		if (this.countEl) {
			const selected = this.getSelectedCount();
			const total = this.selectableItems.length;
			this.countEl.textContent = `${selected} of ${total} selected`;
		}
	}

	/**
	 * Update all checkboxes in the DOM to match their data state.
	 * This is called after selectAll/deselectAll to update visible checkboxes
	 * without rebuilding the entire list.
	 */
	private syncCheckboxesToData(): void {
		for (const [index, checkbox] of this.checkboxElements) {
			const item = this.selectableItems[index];
			if (item) {
				checkbox.checked = item.selected;
			}
		}
	}

	/**
	 * Select all items (skips disabled items).
	 */
	selectAll(): void {
		for (const item of this.selectableItems) {
			if (!(this.options.isItemDisabled?.(item.item) ?? false)) {
				item.selected = true;
			}
		}
		this.syncCheckboxesToData();
		this.onSelectionChanged();
	}

	/**
	 * Deselect all items.
	 */
	deselectAll(): void {
		for (const item of this.selectableItems) {
			item.selected = false;
		}
		this.syncCheckboxesToData();
		this.onSelectionChanged();
	}

	/**
	 * Update selection state for a set of items.
	 */
	setItemsSelected(
		items: T[],
		selected: boolean,
		options?: { notify?: boolean },
	): void {
		if (items.length === 0) return;

		const itemSet = new Set(items);
		let changed = false;

		for (const item of this.selectableItems) {
			if (!itemSet.has(item.item)) continue;
			if (this.options.isItemDisabled?.(item.item) ?? false) continue;
			if (item.selected !== selected) {
				item.selected = selected;
				changed = true;
			}
		}

		if (!changed) return;

		this.syncCheckboxesToData();
		if (options?.notify === false) {
			this.updateCountDisplay();
			return;
		}
		this.onSelectionChanged();
	}

	/**
	 * Get all selected items.
	 */
	getSelectedItems(): T[] {
		return this.selectableItems
			.filter((si) => si.selected)
			.map((si) => si.item);
	}

	/**
	 * Get the count of selected items.
	 */
	getSelectedCount(): number {
		return this.selectableItems.filter((si) => si.selected).length;
	}

	/**
	 * Set whether the list is disabled (checkboxes become non-interactive).
	 */
	setDisabled(disabled: boolean): void {
		this.isDisabled = disabled;
		for (const checkbox of this.checkboxElements.values()) {
			checkbox.disabled = disabled;
		}
	}

	/**
	 * Get the container element.
	 */
	get element(): HTMLElement {
		return this.containerEl;
	}

	/**
	 * Get all selectable items with their selection state.
	 */
	getSelectableItems(): SelectableItem<T>[] {
		return this.selectableItems;
	}
}
