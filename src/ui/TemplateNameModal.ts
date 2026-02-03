import { App, ButtonComponent, Modal, Setting } from "obsidian";

/**
 * Modal for entering a template name when creating a new template.
 */
export class TemplateNameModal extends Modal {
	private templateName: string = "";
	private onSubmit: (name: string) => void;

	constructor(app: App, onSubmit: (name: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-template-name-modal");

		// Header
		contentEl.createEl("h2", { text: "Create new template" });
		contentEl.createEl("p", {
			text: "Enter a name for your new flashcard template.",
			cls: "flashcard-modal-subtitle",
		});

		// Template name input
		new Setting(contentEl).setName("Template name").addText((text) => {
			text.setPlaceholder("E.g., vocabulary, cloze, definition")
				.setValue(this.templateName)
				.onChange((value) => {
					this.templateName = value;
				});

			// Focus the input field
			text.inputEl.focus();

			// Submit on Enter
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && this.templateName.trim()) {
					e.preventDefault();
					this.submit();
				}
			});
		});

		// Button row
		const buttonContainer = contentEl.createDiv({
			cls: "flashcard-modal-buttons",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		new ButtonComponent(buttonContainer)
			.setButtonText("Create")
			.setCta()
			.onClick(() => this.submit());
	}

	private submit() {
		const name = this.templateName.trim();
		if (name) {
			this.close();
			this.onSubmit(name);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
