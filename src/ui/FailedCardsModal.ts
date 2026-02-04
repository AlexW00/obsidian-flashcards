import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";

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
 * Modal that displays a list of cards that failed to regenerate.
 * Each card is shown as a clickable link that opens the card file.
 */
export class FailedCardsModal extends Modal {
	private failedCards: FailedCard[];

	constructor(app: App, failedCards: FailedCard[]) {
		super(app);
		this.failedCards = failedCards;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-failed-modal");

		contentEl.createEl("h2", { text: "Failed cards" });
		contentEl.createEl("p", {
			text: `The following ${this.failedCards.length} card${this.failedCards.length === 1 ? "" : "s"} failed to regenerate. Click to view the error in the note's frontmatter.`,
		});

		const list = contentEl.createEl("ul", {
			cls: "flashcard-failed-list",
		});

		for (const { file, error, path } of this.failedCards) {
			const item = list.createEl("li");
			
			// Get display name from file or path
			const displayName = file
				? file.basename
				: (path?.split("/").pop()?.replace(/\.md$/, "") ?? "Unknown");

			if (file) {
				const link = item.createEl("a", {
					text: displayName,
					cls: "flashcard-failed-link",
					href: "#",
				});
				link.addEventListener("click", (event) => {
					event.preventDefault();
					this.close();
					void this.app.workspace.getLeaf().openFile(file);
				});
			} else {
				item.createSpan({
					text: displayName,
					cls: "flashcard-failed-name",
				});
			}

			// Show truncated error as hint
			const truncatedError =
				error.length > 80 ? error.slice(0, 77) + "..." : error;
			item.createSpan({
				text: ` — ${truncatedError}`,
				cls: "flashcard-failed-error-hint",
			});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
