import { App, PluginSettingTab, Setting } from "obsidian";
import type FlashcardsPlugin from "./main";

export interface FlashcardsPluginSettings {
	/** Path to folder containing template files */
	templateFolder: string;
	/** Template for flashcard note names. Supports {{date}}, {{time}}, {{timestamp}} */
	noteNameTemplate: string;
	/** Last used deck path for quick access */
	lastUsedDeck: string;
}

export const DEFAULT_SETTINGS: FlashcardsPluginSettings = {
	templateFolder: "Templates/Flashcards",
	noteNameTemplate: "{{timestamp}}",
	lastUsedDeck: "",
};

export class FlashcardsSettingTab extends PluginSettingTab {
	plugin: FlashcardsPlugin;

	constructor(app: App, plugin: FlashcardsPlugin) {
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
	}
}
