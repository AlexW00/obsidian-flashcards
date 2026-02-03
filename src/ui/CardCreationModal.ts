import { App, Modal, Setting } from "obsidian";
import type { FlashcardTemplate } from "../types";

/**
 * Modal for creating a flashcard with a dynamic form based on template variables.
 */
export class CardCreationModal extends Modal {
	private template: FlashcardTemplate;
	private deckPath: string;
	private onSubmit: (
		fields: Record<string, string>,
		createAnother: boolean,
	) => void;
	private fields: Record<string, string> = {};

	constructor(
		app: App,
		template: FlashcardTemplate,
		deckPath: string,
		onSubmit: (
			fields: Record<string, string>,
			createAnother: boolean,
		) => void,
	) {
		super(app);
		this.template = template;
		this.deckPath = deckPath;
		this.onSubmit = onSubmit;

		// Initialize fields with empty values
		for (const variable of template.variables) {
			this.fields[variable.name] = variable.defaultValue || "";
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-creation-modal");

		// Header
		contentEl.createEl("h2", { text: `New Card: ${this.template.name}` });
		contentEl.createEl("p", {
			text: `Creating in: ${this.deckPath}`,
			cls: "flashcard-modal-subtitle",
		});

		// Dynamic form fields
		for (const variable of this.template.variables) {
			new Setting(contentEl)
				.setName(this.formatFieldName(variable.name))
				.addTextArea((text) => {
					text.setPlaceholder(`Enter ${variable.name}...`)
						.setValue(this.fields[variable.name] ?? "")
						.onChange((value) => {
							this.fields[variable.name] = value;
						});
					// Make textarea larger
					text.inputEl.rows = 3;
					text.inputEl.addClass("flashcard-textarea-full-width");
				});
		}

		// Button container
		const buttonContainer = contentEl.createDiv({
			cls: "flashcard-modal-buttons",
		});

		// Create button
		const createBtn = buttonContainer.createEl("button", {
			text: "Create",
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", () => {
			this.close();
			this.onSubmit(this.fields, false);
		});

		// Create & Add Another button
		const createAnotherBtn = buttonContainer.createEl("button", {
			text: "Create & add another",
		});
		createAnotherBtn.addEventListener("click", () => {
			this.onSubmit({ ...this.fields }, true);
			// Clear fields for next card
			for (const variable of this.template.variables) {
				this.fields[variable.name] = "";
			}
			this.onOpen(); // Refresh the form
		});

		// Cancel button
		const cancelBtn = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelBtn.addEventListener("click", () => this.close());

		// Focus first field
		const firstInput = contentEl.querySelector("textarea");
		if (firstInput) {
			firstInput.focus();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	/**
	 * Format field name for display (snake_case -> Title Case).
	 */
	private formatFieldName(name: string): string {
		return name
			.replace(/_/g, " ")
			.replace(/([A-Z])/g, " $1")
			.replace(/^./, (str) => str.toUpperCase())
			.trim();
	}
}
