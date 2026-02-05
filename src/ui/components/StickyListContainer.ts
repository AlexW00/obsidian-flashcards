export interface StickyListContainerOptions {
	scrollClass?: string;
	headerClass?: string;
	contentClass?: string;
	maxHeight?: string;
}

/**
 * Shared list container with a sticky header and scrollable content.
 */
export class StickyListContainer {
	private scrollEl: HTMLElement;
	private headerEl: HTMLElement;
	private contentEl: HTMLElement;

	constructor(parent: HTMLElement, options: StickyListContainerOptions = {}) {
		const scrollClasses = ["flashcard-sticky-list"];
		if (options.scrollClass) {
			scrollClasses.push(options.scrollClass);
		}

		this.scrollEl = parent.createDiv({ cls: scrollClasses.join(" ") });
		if (options.maxHeight) {
			this.scrollEl.style.maxHeight = options.maxHeight;
		}

		const headerClasses = ["flashcard-sticky-list-header"];
		if (options.headerClass) {
			headerClasses.push(options.headerClass);
		}
		this.headerEl = this.scrollEl.createDiv({
			cls: headerClasses.join(" "),
		});

		const contentClasses = ["flashcard-sticky-list-content"];
		if (options.contentClass) {
			contentClasses.push(options.contentClass);
		}
		this.contentEl = this.scrollEl.createDiv({
			cls: contentClasses.join(" "),
		});
	}

	getScrollEl(): HTMLElement {
		return this.scrollEl;
	}

	getHeaderEl(): HTMLElement {
		return this.headerEl;
	}

	getContentEl(): HTMLElement {
		return this.contentEl;
	}

	removeHeader(): void {
		this.headerEl.remove();
	}
}
