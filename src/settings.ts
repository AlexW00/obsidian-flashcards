import { App, Plugin, PluginSettingTab, Setting, Notice, Menu } from "obsidian";
import type {
	PluginWithSettings,
	AiProviderType,
	AiProviderConfig,
	ImageSearchProviderType,
	ImageSearchProviderConfig,
} from "./types";
import {
	ALL_DECK_VIEW_COLUMNS,
	DECK_VIEW_COLUMN_LABELS,
	DEFAULT_BASIC_TEMPLATE,
	DEFAULT_SETTINGS,
	debugLog,
} from "./types";
import { getDefaultTextModel } from "./services/aiModelDefaults";

export { DEFAULT_SETTINGS } from "./types";
export type { FlashcardsPluginSettings } from "./types";

/**
 * Extended plugin interface for settings tab with SecretStorage access.
 */
export interface PluginWithSettingsAndSecrets extends PluginWithSettings {
	getApiKey(providerId: string): Promise<string | null>;
	setApiKey(providerId: string, key: string): Promise<void>;
	deleteApiKey(providerId: string): Promise<void>;
}

export class AnkerSettingTab extends PluginSettingTab {
	plugin: Plugin & PluginWithSettingsAndSecrets;

	constructor(app: App, plugin: Plugin & PluginWithSettingsAndSecrets) {
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
					.setPlaceholder("Example: anker/templates")
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
					.setPlaceholder("Example: anker/attachments")
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default import folder")
			.setDesc("Default destination folder when importing Anki backups")
			.addText((text) =>
				text
					.setPlaceholder("Example: anker/imported")
					.setValue(this.plugin.settings.defaultImportFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultImportFolder = value.trim();
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

		new Setting(containerEl).setName("Scheduling (fsrs)").setHeading();

		new Setting(containerEl)
			.setName("Request retention")
			.setDesc("Target recall probability (0 to 1).")
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.fsrsRequestRetention),
					)
					.setValue(String(this.plugin.settings.fsrsRequestRetention))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num > 0 && num <= 1) {
							this.plugin.settings.fsrsRequestRetention = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Maximum interval (days)")
			.setDesc("Maximum scheduled interval in days.")
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.fsrsMaximumInterval),
					)
					.setValue(String(this.plugin.settings.fsrsMaximumInterval))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.fsrsMaximumInterval = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Enable fuzz")
			.setDesc("Add randomness to long intervals to reduce clumping.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fsrsEnableFuzz)
					.onChange(async (value) => {
						this.plugin.settings.fsrsEnableFuzz = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Enable short-term learning")
			.setDesc("Use short-term learning steps before long-term review.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fsrsEnableShortTerm)
					.onChange(async (value) => {
						this.plugin.settings.fsrsEnableShortTerm = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Learning steps")
			.setDesc("Comma-separated list, e.g., 1m, 10m.")
			.addText((text) =>
				text
					.setPlaceholder("1m, 10m")
					.setValue(
						this.formatSteps(
							this.plugin.settings.fsrsLearningSteps,
						),
					)
					.onChange(async (value) => {
						this.plugin.settings.fsrsLearningSteps =
							this.parseSteps(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Relearning steps")
			.setDesc("Comma-separated list, e.g., 10m.")
			.addText((text) =>
				text
					.setPlaceholder("10m")
					.setValue(
						this.formatSteps(
							this.plugin.settings.fsrsRelearningSteps,
						),
					)
					.onChange(async (value) => {
						this.plugin.settings.fsrsRelearningSteps =
							this.parseSteps(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Weights (w)")
			.setDesc(
				"Comma-separated list of numbers. Leave blank to use defaults.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("0.1, 1.2, ...")
					.setValue(this.plugin.settings.fsrsWeights.join(", "))
					.onChange(async (value) => {
						const weights = this.parseWeights(value);
						if (weights) {
							this.plugin.settings.fsrsWeights = weights;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.rows = 3;
			});

		new Setting(containerEl)
			.setName("Reset fsrs parameters")
			.setDesc("Restore default scheduling parameters.")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.fsrsRequestRetention =
						DEFAULT_SETTINGS.fsrsRequestRetention;
					this.plugin.settings.fsrsMaximumInterval =
						DEFAULT_SETTINGS.fsrsMaximumInterval;
					this.plugin.settings.fsrsEnableFuzz =
						DEFAULT_SETTINGS.fsrsEnableFuzz;
					this.plugin.settings.fsrsEnableShortTerm =
						DEFAULT_SETTINGS.fsrsEnableShortTerm;
					this.plugin.settings.fsrsLearningSteps = [
						...DEFAULT_SETTINGS.fsrsLearningSteps,
					];
					this.plugin.settings.fsrsRelearningSteps = [
						...DEFAULT_SETTINGS.fsrsRelearningSteps,
					];
					this.plugin.settings.fsrsWeights = [
						...DEFAULT_SETTINGS.fsrsWeights,
					];
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		// Dynamic pipes section
		new Setting(containerEl).setName("Dynamic pipes").setHeading();

		// Render AI provider settings
		const aiContainer = containerEl.createDiv();
		this.renderAiProviderSettings(aiContainer);

		new Setting(containerEl).setName("Deck view").setHeading();

		new Setting(containerEl)
			.setName("Columns")
			.setDesc(
				"Select which columns to display when viewing a deck. Column order is fixed.",
			);

		const columnsContainer = containerEl.createDiv();
		this.renderColumnSettings(columnsContainer);
	}

	private getDynamicPipeProviders(): Record<string, string | undefined> {
		const settings = this.plugin.settings as unknown as {
			dynamicPipeProviders?: Record<string, string | undefined>;
		};
		return settings.dynamicPipeProviders ?? {};
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

	/**
	 * Render AI provider settings section.
	 * @param scrollToId Optional provider ID to scroll into view after rendering
	 */
	private renderAiProviderSettings(
		container: HTMLElement,
		scrollToId?: string,
	): void {
		container.empty();

		const providers = this.plugin.settings.aiProviders ?? {};
		const providerIds = Object.keys(providers);

		new Setting(container)
			.setName("About dynamic pipes")
			.setDesc(
				"Dynamic pipes can be used to generate dynamic content in your flashcards.",
			);

		new Setting(container)
			.setName("Ask AI provider")
			.setDesc("Provider for {{ prompt | askAi }} filter")
			.addDropdown((dropdown) => {
				const dynamicPipeProviders = this.getDynamicPipeProviders();
				dropdown.addOption("", "Select provider...");
				for (const id of providerIds) {
					const config = providers[id];
					dropdown.addOption(
						id,
						`${config?.type ?? "unknown"} (${config?.textModel ?? "default"})`,
					);
				}
				dropdown.setValue(dynamicPipeProviders.askAi ?? "");
				dropdown.onChange(async (value) => {
					const currentDynamicPipeProviders =
						this.getDynamicPipeProviders();
					this.plugin.settings.dynamicPipeProviders = {
						...currentDynamicPipeProviders,
						askAi: value || undefined,
					};
					await this.plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName("Generate image provider")
			.setDesc("Provider for {{ prompt | generateImage }} filter")
			.addDropdown((dropdown) => {
				const dynamicPipeProviders = this.getDynamicPipeProviders();
				dropdown.addOption("", "Select provider...");
				for (const id of providerIds) {
					const config = providers[id];
					// Only OpenAI supports image generation
					if (config?.type === "openai") {
						dropdown.addOption(
							id,
							`${config.type} (${config.imageModel ?? "dall-e-3"})`,
						);
					}
				}
				dropdown.setValue(dynamicPipeProviders.generateImage ?? "");
				dropdown.onChange(async (value) => {
					const currentDynamicPipeProviders =
						this.getDynamicPipeProviders();
					this.plugin.settings.dynamicPipeProviders = {
						...currentDynamicPipeProviders,
						generateImage: value || undefined,
					};
					await this.plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName("Generate speech provider")
			.setDesc("Provider for {{ text | generateSpeech }} filter")
			.addDropdown((dropdown) => {
				const dynamicPipeProviders = this.getDynamicPipeProviders();
				dropdown.addOption("", "Select provider...");
				for (const id of providerIds) {
					const config = providers[id];
					// Only OpenAI supports speech generation
					if (config?.type === "openai") {
						dropdown.addOption(
							id,
							`${config.type} (${config.speechModel ?? "tts-1"})`,
						);
					}
				}
				dropdown.setValue(dynamicPipeProviders.generateSpeech ?? "");
				dropdown.onChange(async (value) => {
					const currentDynamicPipeProviders =
						this.getDynamicPipeProviders();
					this.plugin.settings.dynamicPipeProviders = {
						...currentDynamicPipeProviders,
						generateSpeech: value || undefined,
					};
					await this.plugin.saveSettings();
				});
			});

		// Search image dropdown - uses image search providers
		const imageSearchProviders =
			this.plugin.settings.imageSearchProviders ?? {};
		const imageSearchProviderIds = Object.keys(imageSearchProviders);

		new Setting(container)
			.setName("Search image provider")
			.setDesc("Provider for {{ query | searchImage }} filter (Pexels)")
			.addDropdown((dropdown) => {
				const dynamicPipeProviders = this.getDynamicPipeProviders();
				dropdown.addOption("", "Select provider...");
				for (const id of imageSearchProviderIds) {
					const config = imageSearchProviders[id];
					dropdown.addOption(id, `${config?.type ?? "unknown"}`);
				}
				dropdown.setValue(dynamicPipeProviders.searchImage ?? "");
				dropdown.onChange(async (value) => {
					const currentDynamicPipeProviders =
						this.getDynamicPipeProviders();
					this.plugin.settings.dynamicPipeProviders = {
						...currentDynamicPipeProviders,
						searchImage: value || undefined,
					};
					await this.plugin.saveSettings();
				});
			});

		// Add provider button
		new Setting(container)
			.setName("Add provider")
			.setDesc("Add a new AI or image search provider")
			.addButton((button) =>
				button
					.setButtonText("Add provider")
					.setCta()
					.onClick((evt) => {
						const menu = new Menu();

						menu.addItem((item) =>
							item
								.setTitle("AI provider")
								.setIcon("sparkles")
								.onClick(async () => {
									const id = `provider_${Date.now()}`;
									this.plugin.settings.aiProviders = {
										...this.plugin.settings.aiProviders,
										[id]: {
											type: "openai",
											textModel:
												getDefaultTextModel("openai"),
										},
									};
									await this.plugin.saveSettings();
									this.renderAiProviderSettings(container, id);
								}),
						);

						menu.addItem((item) =>
							item
								// eslint-disable-next-line obsidianmd/ui/sentence-case
								.setTitle("Image search provider (Pexels)")
								.setIcon("image")
								.onClick(async () => {
									const id = `imgsearch_${Date.now()}`;
									this.plugin.settings.imageSearchProviders = {
										...this.plugin.settings.imageSearchProviders,
										[id]: {
											type: "pexels",
										},
									};
									await this.plugin.saveSettings();
									this.renderAiProviderSettings(container, id);
								}),
						);

						menu.showAtMouseEvent(evt);
					}),
			);

		if (providerIds.length > 0) {
			container.createEl("hr");
		}

		// Render each provider
		for (const id of providerIds) {
			const config = providers[id];
			if (!config) continue;

			const providerEl = this.renderSingleProvider(container, id, config);

			// Scroll to newly added provider
			if (scrollToId && id === scrollToId && providerEl) {
				setTimeout(() => {
					providerEl.scrollIntoView({
						behavior: "smooth",
						block: "start",
					});
				}, 50);
			}
		}

		// Render image search providers
		if (imageSearchProviderIds.length > 0 && providerIds.length === 0) {
			container.createEl("hr");
		}

		for (const id of imageSearchProviderIds) {
			const config = imageSearchProviders[id];
			if (!config) continue;

			const providerEl = this.renderSingleImageSearchProvider(
				container,
				id,
				config,
			);

			// Scroll to newly added provider
			if (scrollToId && id === scrollToId && providerEl) {
				setTimeout(() => {
					providerEl.scrollIntoView({
						behavior: "smooth",
						block: "start",
					});
				}, 50);
			}
		}
	}

	/**
	 * Render settings for a single AI provider.
	 * @returns The provider container element
	 */
	private renderSingleProvider(
		container: HTMLElement,
		id: string,
		config: AiProviderConfig,
	): HTMLElement {
		const providerContainer = container.createDiv({
			cls: "anker-ai-provider-settings",
		});

		// Provider header with delete button
		new Setting(providerContainer)
			.setName(`AI Provider: ${config.type}`)
			.setDesc(this.getProviderCapabilitiesDescription(config.type))
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						// Create new object without the deleted provider
						const remainingProviders = Object.fromEntries(
							Object.entries(
								this.plugin.settings.aiProviders,
							).filter(([key]) => key !== id),
						);
						this.plugin.settings.aiProviders = remainingProviders;
						// Clear dynamic pipe assignments that used this provider
						const dynamicPipeProviders =
							this.getDynamicPipeProviders();
						if (dynamicPipeProviders.askAi === id) {
							dynamicPipeProviders.askAi = undefined;
						}
						if (dynamicPipeProviders.generateImage === id) {
							dynamicPipeProviders.generateImage = undefined;
						}
						if (dynamicPipeProviders.generateSpeech === id) {
							dynamicPipeProviders.generateSpeech = undefined;
						}
						this.plugin.settings.dynamicPipeProviders =
							dynamicPipeProviders;
						// Delete API key from SecretStorage
						await this.plugin.deleteApiKey(id);
						await this.plugin.saveSettings();
						// Re-render settings to ensure UI updates
						this.display();
					}),
			);

		// Provider type
		new Setting(providerContainer)
			.setName("AI provider type")
			.addDropdown((dropdown) => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				dropdown.addOption("openai", "OpenAI");
				dropdown.addOption("anthropic", "Anthropic");
				dropdown.addOption("google", "Google");
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				dropdown.addOption("openrouter", "OpenRouter");
				dropdown.setValue(config.type);
				dropdown.onChange(async (value) => {
					// Check if provider was deleted
					if (!this.plugin.settings.aiProviders[id]) {
						return;
					}
					const nextType = value as AiProviderType;
					const trimmedTextModel = config.textModel?.trim();
					const isDefaultModel =
						!trimmedTextModel ||
						trimmedTextModel === getDefaultTextModel(config.type);
					const nextTextModel = isDefaultModel
						? getDefaultTextModel(nextType)
						: config.textModel;

					this.plugin.settings.aiProviders[id] = {
						...config,
						type: nextType,
						textModel: nextTextModel,
					};
					await this.plugin.saveSettings();
					this.renderAiProviderSettings(container);
				});
			});

		// API Key (uses SecretStorage)
		new Setting(providerContainer)
			.setName("API key")
			.setDesc("Stored securely in Obsidian's secret storage")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Enter API key...");

				// Load current key status (async)
				let currentKey: string | null = null;
				void this.plugin.getApiKey(id).then((value) => {
					currentKey = value;
					if (currentKey) {
						text.setPlaceholder("••••••••••••••••");
					}
				});

				let pendingKey = "";
				text.onChange((value) => {
					pendingKey = value.trim();
				});

				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						text.inputEl.blur();
					}
				});

				const handleApiKeyBlur = async (): Promise<void> => {
					if (!pendingKey) {
						return;
					}
					if (pendingKey === currentKey) {
						text.setValue("");
						text.setPlaceholder("••••••••••••••••");
						pendingKey = "";
						return;
					}
					debugLog(
						"Settings: saving API key for %s (len=%s)",
						id,
						pendingKey.length,
					);
					await this.plugin.setApiKey(id, pendingKey);
					currentKey = pendingKey;
					pendingKey = "";
					new Notice("API key saved securely");
					text.setValue("");
					text.setPlaceholder("••••••••••••••••");
				};
				text.inputEl.addEventListener("blur", () => {
					void handleApiKeyBlur();
				});
			})
			.addButton((button) =>
				button.setButtonText("Clear").onClick(async () => {
					await this.plugin.deleteApiKey(id);
					new Notice("API key removed");
					this.renderAiProviderSettings(container);
				}),
			);

		// Text model
		new Setting(providerContainer).setName("Text model").addText((text) =>
			text
				.setPlaceholder(getDefaultTextModel(config.type))
				.setValue(config.textModel ?? "")
				.onChange((value) => {
					pendingTextModel = value;
				}),
		);

		// System prompt (text only)
		let currentSystemPrompt = config.systemPrompt ?? "";
		let pendingSystemPrompt = currentSystemPrompt;
		new Setting(providerContainer)
			.setName("System prompt")
			.setDesc(
				"Used for text generation only. Ignored for image and speech.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("Optional system prompt...")
					.setValue(currentSystemPrompt)
					.onChange((value) => {
						pendingSystemPrompt = value;
					});
				text.inputEl.rows = 3;
				text.inputEl.addClass("flashcard-settings-system-prompt");

				// Save on blur
				const handleSystemPromptBlur = async (): Promise<void> => {
					const nextValue = pendingSystemPrompt;
					if (nextValue === currentSystemPrompt) {
						return;
					}
					// Check if provider was deleted
					if (!this.plugin.settings.aiProviders[id]) {
						return;
					}
					const normalizedValue =
						nextValue.trim().length > 0 ? nextValue : undefined;
					currentSystemPrompt = normalizedValue ?? "";
					this.plugin.settings.aiProviders[id] = {
						...config,
						systemPrompt: normalizedValue,
					};
					await this.plugin.saveSettings();
					this.renderAiProviderSettings(container);
				};
				text.inputEl.addEventListener("blur", () => {
					void handleSystemPromptBlur();
				});
			});

		let currentTextModel = config.textModel ?? "";
		let pendingTextModel = currentTextModel;
		const textModelInput =
			providerContainer.querySelector<HTMLInputElement>(
				"input[type='text']",
			);
		if (textModelInput) {
			textModelInput.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					textModelInput.blur();
				}
			});

			const handleTextModelBlur = async (): Promise<void> => {
				const nextValue = pendingTextModel.trim();
				if (nextValue === currentTextModel) {
					return;
				}
				// Check if provider was deleted
				if (!this.plugin.settings.aiProviders[id]) {
					return;
				}
				currentTextModel = nextValue;
				this.plugin.settings.aiProviders[id] = {
					...config,
					textModel: nextValue || undefined,
				};
				await this.plugin.saveSettings();
				this.renderAiProviderSettings(container);
			};
			textModelInput.addEventListener("blur", () => {
				void handleTextModelBlur();
			});
		}

		// Image model (OpenAI only)
		if (config.type === "openai") {
			new Setting(providerContainer)
				.setName("Image model")
				.addText((text) =>
					text
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						.setPlaceholder("dall-e-3")
						.setValue(config.imageModel ?? "")
						.onChange(async (value) => {
							// Check if provider was deleted
							if (!this.plugin.settings.aiProviders[id]) {
								return;
							}
							this.plugin.settings.aiProviders[id] = {
								...config,
								imageModel: value.trim() || undefined,
							};
							await this.plugin.saveSettings();
						}),
				);

			new Setting(providerContainer)
				.setName("Speech model")
				.addText((text) =>
					text
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						.setPlaceholder("tts-1")
						.setValue(config.speechModel ?? "")
						.onChange(async (value) => {
							// Check if provider was deleted
							if (!this.plugin.settings.aiProviders[id]) {
								return;
							}
							this.plugin.settings.aiProviders[id] = {
								...config,
								speechModel: value.trim() || undefined,
							};
							await this.plugin.saveSettings();
						}),
				);

			new Setting(providerContainer)
				.setName("Speech voice")
				.addDropdown((dropdown) => {
					dropdown.addOption("alloy", "Alloy");
					dropdown.addOption("echo", "Echo");
					dropdown.addOption("fable", "Fable");
					dropdown.addOption("onyx", "Onyx");
					dropdown.addOption("nova", "Nova");
					dropdown.addOption("shimmer", "Shimmer");

					dropdown.setValue(config.speechVoice ?? "alloy");
					dropdown.onChange(async (value) => {
						// Check if provider was deleted
						if (!this.plugin.settings.aiProviders[id]) {
							return;
						}
						this.plugin.settings.aiProviders[id] = {
							...config,
							speechVoice: value,
						};
						await this.plugin.saveSettings();
					});
				});
		}

		// Custom base URL (optional)
		new Setting(providerContainer)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Custom base url")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Optional: Override the API endpoint")
			.addText((text) =>
				text
					.setPlaceholder("https://api.openai.com/v1")
					.setValue(config.baseUrl ?? "")
					.onChange(async (value) => {
						// Check if provider was deleted
						if (!this.plugin.settings.aiProviders[id]) {
							return;
						}
						this.plugin.settings.aiProviders[id] = {
							...config,
							baseUrl: value.trim() || undefined,
						};
						await this.plugin.saveSettings();
					}),
			);

		// Visual separator
		providerContainer.createEl("hr");

		return providerContainer;
	}

	/**
	 * Render settings for a single image search provider (e.g., Pexels).
	 * @returns The provider container element
	 */
	private renderSingleImageSearchProvider(
		container: HTMLElement,
		id: string,
		config: ImageSearchProviderConfig,
	): HTMLElement {
		const providerContainer = container.createDiv({
			cls: "anker-ai-provider-settings",
		});

		// Provider header with delete button
		new Setting(providerContainer)
			.setName(`Image Search Provider: ${config.type}`)
			.setDesc(this.getImageSearchProviderDescription(config.type))
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						// Create new object without the deleted provider
						const remainingProviders = Object.fromEntries(
							Object.entries(
								this.plugin.settings.imageSearchProviders,
							).filter(([key]) => key !== id),
						);
						this.plugin.settings.imageSearchProviders =
							remainingProviders;
						// Clear dynamic pipe assignments that used this provider
						const dynamicPipeProviders =
							this.getDynamicPipeProviders();
						if (dynamicPipeProviders.searchImage === id) {
							dynamicPipeProviders.searchImage = undefined;
						}
						this.plugin.settings.dynamicPipeProviders =
							dynamicPipeProviders;
						// Delete API key from SecretStorage
						await this.plugin.deleteApiKey(id);
						await this.plugin.saveSettings();
						// Re-render settings to ensure UI updates
						this.display();
					}),
			);

		// Provider type (only Pexels for now)
		new Setting(providerContainer)
			.setName("Image search provider type")
			.addDropdown((dropdown) => {
				dropdown.addOption("pexels", "Pexels");
				dropdown.setValue(config.type);
				dropdown.onChange(async (value) => {
					// Check if provider was deleted
					if (!this.plugin.settings.imageSearchProviders[id]) {
						return;
					}
					const nextType = value as ImageSearchProviderType;
					this.plugin.settings.imageSearchProviders[id] = {
						...config,
						type: nextType,
					};
					await this.plugin.saveSettings();
					// Re-render to update header
					this.display();
				});
			});

		// API Key (uses SecretStorage)
		new Setting(providerContainer)
			.setName("API key")
			.setDesc("Stored securely in Obsidian's secret storage")
			.addText((text) => {
				text.inputEl.type = "password";
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text.setPlaceholder("Enter Pexels API key...");

				// Load current key status (async)
				void this.plugin.getApiKey(id).then((key) => {
					if (key) {
						text.setValue("••••••••");
						text.inputEl.placeholder = "API key set";
					}
				});

				// Track blur to detect when user finishes editing
				let pendingValue = "";

				text.inputEl.addEventListener("focus", () => {
					// Clear placeholder dots when focused
					if (text.getValue() === "••••••••") {
						text.setValue("");
					}
				});

				text.onChange((value) => {
					pendingValue = value;
				});

				text.inputEl.addEventListener("blur", () => {
					if (pendingValue && pendingValue !== "••••••••") {
						void (async () => {
							await this.plugin.setApiKey(id, pendingValue);
							text.setValue("••••••••");
							new Notice("API key saved");
						})();
					}
				});
			})
			.addButton((button) =>
				button.setButtonText("Clear").onClick(async () => {
					await this.plugin.deleteApiKey(id);
					new Notice("API key cleared");
					this.display();
				}),
			);

		// Visual separator
		providerContainer.createEl("hr");

		return providerContainer;
	}

	/**
	 * Get description for image search provider type.
	 */
	private getImageSearchProviderDescription(
		type: ImageSearchProviderType,
	): string {
		switch (type) {
			case "pexels":
				return "Free stock photos. Rate limit: 200 requests/hour.";
			default:
				return "Image search provider.";
		}
	}

	private formatSteps(steps: Array<string | number>): string {
		return steps.map((step) => String(step)).join(", ");
	}

	private getProviderCapabilitiesDescription(type: AiProviderType): string {
		switch (type) {
			case "openai":
				return "Text, image, and speech (supports all dynamic pipes).";
			case "anthropic":
			case "google":
			case "openrouter":
				return "Text only (not available for image or speech dynamic pipes).";
			default:
				return "Text only.";
		}
	}

	private parseSteps(value: string): Array<string | number> {
		const parts = value
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part.length > 0);

		return parts.map((part) => {
			const num = Number(part);
			const isNumeric = !isNaN(num) && /^-?\d+(?:\.\d+)?$/.test(part);
			return isNumeric ? num : part;
		});
	}

	private parseWeights(value: string): number[] | null {
		const parts = value
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part.length > 0);

		if (parts.length === 0) {
			return [];
		}

		const weights = parts.map((part) => Number(part));
		if (weights.some((num) => isNaN(num))) {
			return null;
		}
		return weights;
	}
}
