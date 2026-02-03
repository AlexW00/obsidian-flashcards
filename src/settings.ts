import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginWithSettings } from "./types";
import {
	ALL_DECK_VIEW_COLUMNS,
	DECK_VIEW_COLUMN_LABELS,
	DEFAULT_BASIC_TEMPLATE,
} from "./types";

export { DEFAULT_SETTINGS } from "./types";
export type { FlashcardsPluginSettings } from "./types";

export class FlashcardsSettingTab extends PluginSettingTab {
	plugin: Plugin & PluginWithSettings;

	constructor(app: App, plugin: Plugin & PluginWithSettings) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Template folder")
			.setDesc("Folder for flashcard templates")
			.addText((text) =>
				text
					.setPlaceholder("Flashcards/templates")
					.setValue(this.plugin.settings.templateFolder)
					.onChange(async (value) => {
						this.plugin.settings.templateFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Attachment folder")
			.setDesc("Folder for pasted images and media")
			.addText((text) =>
				text
					.setPlaceholder("Flashcards/attachments")
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Card creation").setHeading();

		new Setting(containerEl)
			.setName("Note name template")
			.setDesc(
				"Template for new flashcard file names. Available: {{date}}, {{time}}, {{timestamp}}",
			)
			.addText((text) =>
				text
					.setPlaceholder("{{timestamp}}")
					.setValue(this.plugin.settings.noteNameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.noteNameTemplate = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default template content")
			.setDesc(
				"Content used when creating new templates. Use {{ variable }} for fields. Content in HTML comments (<!-- -->) is ignored when parsing variables.",
			)
			.addTextArea((text) => {
				text.setPlaceholder(DEFAULT_BASIC_TEMPLATE)
					.setValue(this.plugin.settings.defaultTemplateContent)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplateContent = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 12;
				text.inputEl.cols = 50;
				text.inputEl.addClass("flashcard-settings-template-textarea");
			});

		new Setting(containerEl)
			.setName("Reset default template")
			.setDesc(
				"Reset the default template content to the built-in basic template",
			)
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.defaultTemplateContent =
						DEFAULT_BASIC_TEMPLATE;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Open card after creation")
			.setDesc(
				"When enabled, the newly created card will be opened in the editor. Does not apply when creating multiple cards.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openCardAfterCreation)
					.onChange(async (value) => {
						this.plugin.settings.openCardAfterCreation = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Review").setHeading();

		new Setting(containerEl)
			.setName("Show only current side")
			.setDesc(
				"When enabled, only the current side is shown during review. When disabled, all sides up to the current one are shown.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showOnlyCurrentSide)
					.onChange(async (value) => {
						this.plugin.settings.showOnlyCurrentSide = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-regenerate debounce")
			.setDesc(
				"Delay before regenerating cards after edits (0 to disable).",
			)
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(
						String(this.plugin.settings.autoRegenerateDebounce),
					)
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.autoRegenerateDebounce = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl).setName("Deck view").setHeading();

		new Setting(containerEl)
			.setName("Columns")
			.setDesc(
				"Select which columns to display when viewing a deck. Column order is fixed.",
			);

		const columnsContainer = containerEl.createDiv();
		this.renderColumnSettings(columnsContainer);
	}

	/**
	 * Render the column toggle settings with drag-to-reorder support.
	 */
	private renderColumnSettings(container: HTMLElement): void {
		container.empty();

		const selectedColumns = this.plugin.settings.deckViewColumns;

		// Render each column as a toggle in order
		for (const column of ALL_DECK_VIEW_COLUMNS) {
			const isSelected = selectedColumns.includes(column);

			new Setting(container)
				.setName(DECK_VIEW_COLUMN_LABELS[column])
				.addToggle((toggle) =>
					toggle.setValue(isSelected).onChange(async (value) => {
						if (value) {
							// Add column to end of list
							this.plugin.settings.deckViewColumns.push(column);
						} else {
							// Remove column from list
							this.plugin.settings.deckViewColumns =
								this.plugin.settings.deckViewColumns.filter(
									(c) => c !== column,
								);
						}
						await this.plugin.saveSettings();
					}),
				);
		}
	}
}
