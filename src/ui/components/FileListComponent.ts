import { App } from "obsidian";
import type { TFile } from "obsidian";

/**
 * Represents an item in the file list.
 */
export interface FileListItem {
	/** The file to link to (can be null if file doesn't exist). */
	file: TFile | null;
	/** Display name for the item. */
	displayName: string;
	/** Optional secondary text (e.g., error message, path). */
	secondaryText?: string;
	/** Optional path (useful when file is null). */
	path?: string;
}

/**
 * Configuration for the FileListComponent.
 */
export interface FileListOptions {
	/** Items to display. */
	items: FileListItem[];
	/** Callback when an item is clicked. */
	onItemClick?: (item: FileListItem) => void;
	/** Whether clicking an item should close the modal. Defaults to true. */
	closeModalOnClick?: boolean;
	/** CSS class for the list container. */
	containerClass?: string;
}

/**
 * Reusable file list component with clickable links and secondary text.
 * Used for displaying lists of files (e.g., card errors, orphan attachments).
 */
export class FileListComponent {
	private app: App;
	private containerEl: HTMLElement;
	private listEl: HTMLElement;
	private options: FileListOptions;
	private closeModal?: () => void;

	constructor(
		app: App,
		container: HTMLElement,
		options: FileListOptions,
		closeModal?: () => void,
	) {
		this.app = app;
		this.options = options;
		this.closeModal = closeModal;
		this.containerEl = container;

		const listClass = options.containerClass ?? "file-list";
		this.listEl = this.containerEl.createEl("ul", { cls: listClass });

		this.render();
	}

	private render(): void {
		for (const item of this.options.items) {
			this.renderItem(item);
		}
	}

	private renderItem(item: FileListItem): void {
		const listItem = this.listEl.createEl("li", { cls: "file-list-item" });

		if (item.file) {
			// Clickable link for existing files
			const link = listItem.createEl("a", {
				text: item.displayName,
				cls: "file-list-link",
				href: "#",
			});

			link.addEventListener("click", (event) => {
				event.preventDefault();
				this.handleItemClick(item);
			});
		} else {
			// Non-clickable text for missing files
			listItem.createSpan({
				text: item.displayName,
				cls: "file-list-name",
			});
		}

		// Secondary text (e.g., error message)
		if (item.secondaryText) {
			listItem.createSpan({
				text: ` — ${item.secondaryText}`,
				cls: "file-list-secondary",
			});
		}
	}

	private handleItemClick(item: FileListItem): void {
		// Custom callback
		this.options.onItemClick?.(item);

		// Default behavior: open file
		if (item.file) {
			void this.app.workspace.getLeaf().openFile(item.file);
		}

		// Close modal if configured
		if (this.options.closeModalOnClick !== false && this.closeModal) {
			this.closeModal();
		}
	}

	/**
	 * Get the container element.
	 */
	get element(): HTMLElement {
		return this.containerEl;
	}
}
