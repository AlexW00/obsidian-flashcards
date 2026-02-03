import { App, FuzzySuggestModal } from "obsidian";
import type { FlashcardTemplate } from "../types";

/**
 * Modal for selecting a flashcard template.
 */
export class TemplateSelectorModal extends FuzzySuggestModal<FlashcardTemplate> {
	private templates: FlashcardTemplate[];
	private onChoose: (template: FlashcardTemplate) => void;

	constructor(
		app: App,
		templates: FlashcardTemplate[],
		onChoose: (template: FlashcardTemplate) => void,
	) {
		super(app);
		this.templates = templates;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a template...");
	}

	getItems(): FlashcardTemplate[] {
		return this.templates;
	}

	getItemText(item: FlashcardTemplate): string {
		const varNames = item.variables.map((v) => v.name).join(", ");
		return `${item.name}${varNames ? ` (${varNames})` : ""}`;
	}

	onChooseItem(
		item: FlashcardTemplate,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		this.onChoose(item);
	}
}
