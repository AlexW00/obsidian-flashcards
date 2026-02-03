import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginWithSettings } from "./types";
import { DEFAULT_BASIC_TEMPLATE } from "./types";

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

		new Setting(containerEl).setName("Flashcards").setHeading();

		new Setting(containerEl)
			.setName("Template folder")
			.setDesc("Folder containing your flashcard templates")
			.addText((text) =>
				text
					.setPlaceholder("Path/to/templates")
					.setValue(this.plugin.settings.templateFolder)
					.onChange(async (value) => {
						this.plugin.settings.templateFolder = value;
						await this.plugin.saveSettings();
					}),
			);

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
						this.plugin.settings.noteNameTemplate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default template content")
			.setDesc(
				"Content used when creating new templates. Use {{ variable }} for fields. Content in HTML comments (<!-- -->) is ignored when parsing variables.",
			)
			.addTextArea((text) => {
				text
					.setPlaceholder(DEFAULT_BASIC_TEMPLATE)
					.setValue(this.plugin.settings.defaultTemplateContent)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplateContent = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 12;
				text.inputEl.cols = 50;
				text.inputEl.addClass("flashcard-settings-template-textarea");
			});

		// Reset to default button
		new Setting(containerEl)
			.setName("Reset default template")
			.setDesc("Reset the default template content to the built-in basic template")
			.addButton((button) =>
				button
					.setButtonText("Reset")
					.onClick(async () => {
						this.plugin.settings.defaultTemplateContent = DEFAULT_BASIC_TEMPLATE;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show reset value
					}),
			);
	}
}
