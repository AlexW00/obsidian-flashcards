import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	prepareFuzzySearch,
} from "obsidian";
import {
	ButtonRowComponent,
	ProgressBarComponent,
	SelectableListComponent,
} from "./components";
import type {
	AnkiDeckSelection,
	AnkiPackageData,
	FlashcardsPluginSettings,
} from "../types";
import {
	AnkiImportService,
	type ImportResult,
} from "../services/AnkiImportService";
import type { TemplateService } from "../flashcards/TemplateService";
import type { DeckService } from "../flashcards/DeckService";

/**
 * Folder search option for the destination folder picker.
 */
interface FolderSearchOption {
	path: string;
}

/**
 * Suggest class for folder path input.
 */
class FolderPathSuggest extends AbstractInputSuggest<FolderSearchOption> {
	private getOptions: () => FolderSearchOption[];
	private onSelectCallback: (option: FolderSearchOption) => void;
	private inputElement: HTMLInputElement;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		getOptions: () => FolderSearchOption[],
		onSelect: (option: FolderSearchOption) => void,
	) {
		super(app, inputEl);
		this.getOptions = getOptions;
		this.onSelectCallback = onSelect;
		this.inputElement = inputEl;

		this.inputElement.addEventListener("focus", () => {
			this.inputElement.dispatchEvent(new Event("input"));
		});
	}

	getSuggestions(query: string): FolderSearchOption[] {
		const options = this.getOptions();
		const trimmed = query.trim();

		if (!trimmed) {
			return options;
		}

		const fuzzy = prepareFuzzySearch(trimmed);
		return options
			.map((option) => ({
				option,
				match: fuzzy(option.path),
			}))
			.filter((item) => item.match)
			.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
			.map((item) => item.option);
	}

	renderSuggestion(option: FolderSearchOption, el: HTMLElement): void {
		el.addClass("flashcard-deck-suggest-item");
		el.createEl("div", {
			text: option.path,
			cls: "suggestion-title",
		});
	}

	selectSuggestion(option: FolderSearchOption): void {
		this.inputElement.value = option.path;
		this.onSelectCallback(option);
		this.close();
	}

	destroy(): void {
		this.close();
	}
}

/**
 * Modal for importing Anki .apkg backup files.
 */
export class AnkiImportModal extends Modal {
	private importService: AnkiImportService;
	private deckService: DeckService;
	private settings: FlashcardsPluginSettings;

	private selectedFile: File | null = null;
	private packageData: AnkiPackageData | null = null;
	private deckSelections: AnkiDeckSelection[] = [];
	private destinationFolder: string;
	private folderSuggest: FolderPathSuggest | null = null;

	// UI components
	private deckListContainer: HTMLElement | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private buttonRow: ButtonRowComponent | null = null;
	private selectableList: SelectableListComponent<AnkiDeckSelection> | null =
		null;

	constructor(
		app: App,
		templateService: TemplateService,
		deckService: DeckService,
		settings: FlashcardsPluginSettings,
	) {
		super(app);
		this.deckService = deckService;
		this.settings = settings;
		this.destinationFolder = settings.defaultImportFolder;
		this.importService = new AnkiImportService(
			app,
			templateService,
			settings,
		);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("anki-import-modal");

		// Header
		contentEl.createEl("h2", { text: "Import Anki backup" });
		contentEl.createDiv({ cls: "anki-import-separator" });

		// File picker section
		this.renderFilePicker(contentEl);

		// Deck list container (populated after file is selected)
		this.deckListContainer = contentEl.createDiv({
			cls: "anki-import-deck-list",
		});
		this.deckListContainer.addClass("anki-import-deck-list-hidden");

		// Destination folder selector
		this.renderFolderSelector(contentEl);

		// Progress bar (hidden initially)
		this.progressBar = new ProgressBarComponent(contentEl, {
			containerClass: "anki-import-progress",
		});

		// Button row
		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Cancel",
			onCancel: () => this.close(),
			submitText: "Import",
			onSubmit: () => {
				void this.handleImport();
			},
			submitDisabled: true,
		});
	}

	onClose() {
		this.folderSuggest?.destroy();
		this.contentEl.empty();
	}

	/**
	 * Render the file picker section.
	 */
	private renderFilePicker(container: HTMLElement): void {
		const fileSection = container.createDiv({
			cls: "anki-import-file-section",
		});

		const setting = new Setting(fileSection)
			.setName("Select an .apkg file")
			.setDesc("Import decks from Anki.");

		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".apkg,.colpkg";
		fileInput.addClass("anki-import-file-input-hidden");
		fileSection.appendChild(fileInput);

		const controlEl = setting.controlEl.createDiv({
			cls: "anki-import-file-control",
		});

		const fileButton = new ButtonComponent(controlEl)
			.setButtonText("Select .apkg file")
			.onClick(() => fileInput.click());

		const fileNameDisplay = controlEl.createSpan({
			cls: "anki-import-filename",
			text: "No file selected",
		});

		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			if (!file) return;

			this.selectedFile = file;
			fileNameDisplay.textContent = file.name;
			fileButton.setButtonText("Change file");
			this.deckListContainer?.removeClass("anki-import-deck-list-hidden");

			void this.parseSelectedFile();
		});
	}

	/**
	 * Render the destination folder selector.
	 */
	private renderFolderSelector(container: HTMLElement): void {
		const folderSection = container.createDiv({
			cls: "anki-import-folder-section",
		});

		new Setting(folderSection)
			.setName("Import to folder")
			.setDesc("Each deck will be created as a subfolder here")
			.addText((text) => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- This is a file path example
				text.setPlaceholder("Flashcards/Imported")
					.setValue(this.destinationFolder)
					.onChange((value) => {
						this.destinationFolder = value.trim();
					});

				// Add folder suggestions
				this.folderSuggest = new FolderPathSuggest(
					this.app,
					text.inputEl,
					() => this.getFolderOptions(),
					(option) => {
						this.destinationFolder = option.path;
						text.setValue(option.path);
					},
				);
			});
	}

	/**
	 * Get folder options for the destination picker.
	 */
	private getFolderOptions(): FolderSearchOption[] {
		const folders: FolderSearchOption[] = [];

		// Get all folders in the vault
		const allFolders = this.deckService.getAllFolders();
		for (const folder of allFolders) {
			if (folder.path) {
				folders.push({ path: folder.path });
			}
		}

		// Add the default import folder if not already present
		if (
			!folders.some((f) => f.path === this.settings.defaultImportFolder)
		) {
			folders.unshift({ path: this.settings.defaultImportFolder });
		}

		return folders;
	}

	/**
	 * Parse the selected .apkg file and display decks.
	 */
	private async parseSelectedFile(): Promise<void> {
		if (!this.selectedFile || !this.deckListContainer) return;

		this.deckListContainer.empty();
		this.deckListContainer.createEl("p", {
			text: "Loading...",
			cls: "anki-import-loading",
		});

		try {
			const isSupported = await this.importService.isSupportedApkg(
				this.selectedFile,
			);
			if (!isSupported) {
				throw new Error(
					"Unsupported Anki export. Please export using Anki 2.1.50+ (.anki21b)",
				);
			}

			this.packageData = await this.importService.parseApkg(
				this.selectedFile,
			);
			this.deckSelections = this.importService.buildDeckHierarchy(
				this.packageData,
			);

			// Auto-select all by default
			for (const selection of this.deckSelections) {
				selection.selected = true;
			}

			this.renderDeckList();
			this.updateImportButton();
		} catch (error) {
			this.deckListContainer.empty();
			this.deckListContainer.createEl("p", {
				text: `Error: ${(error as Error).message}`,
				cls: "anki-import-error",
			});
		}
	}

	/**
	 * Render the deck selection list using SelectableListComponent.
	 */
	private renderDeckList(): void {
		if (!this.deckListContainer) return;
		this.deckListContainer.empty();

		if (this.deckSelections.length === 0) {
			this.deckListContainer.createEl("p", {
				text: "No decks found in this file.",
				cls: "anki-import-empty",
			});
			return;
		}

		this.selectableList = new SelectableListComponent(
			this.deckListContainer,
			{
				items: this.deckSelections,
				getDisplayName: (sel) => {
					// Display only the last part for nested decks
					const nameParts = sel.deck.name.split("::");
					return nameParts[nameParts.length - 1] ?? sel.deck.name;
				},
				getSecondaryText: (sel) => `(${sel.noteCount} cards)`,
				onSelectionChange: () => this.updateImportButton(),
				initiallySelected: true,
				containerClass: "anki-import-decks",
				showCount: false,
			},
		);
	}

	/**
	 * Update the import button state based on selection.
	 */
	private updateImportButton(): void {
		const hasSelection = this.selectableList
			? this.selectableList.getSelectedCount() > 0
			: false;
		this.buttonRow?.setSubmitDisabled(!hasSelection);
	}

	/**
	 * Handle the import button click.
	 */
	private async handleImport(): Promise<void> {
		if (!this.packageData || !this.selectedFile || !this.selectableList)
			return;

		const selectedItems = this.selectableList.getSelectedItems();
		const selectedDeckIds = new Set<number>();
		for (const selection of selectedItems) {
			selectedDeckIds.add(selection.deck.id);
		}

		if (selectedDeckIds.size === 0) {
			new Notice("Please select at least one deck to import.");
			return;
		}

		// Check for template conflicts and ask user whether to overwrite
		let overwriteTemplates = false;
		const templateConflicts = this.importService.getTemplateConflicts(
			this.packageData,
			selectedDeckIds,
		);
		if (templateConflicts.length > 0) {
			const confirmed = await this.confirmTemplateConflicts(
				this.buildTemplateConflictMessage(templateConflicts),
			);
			if (!confirmed) {
				return;
			}
			// User confirmed - overwrite the conflicting templates
			overwriteTemplates = true;
		}

		// Show progress
		this.progressBar?.show();
		this.buttonRow?.setSubmitDisabled(true);

		try {
			const result = await this.importService.importDecks(
				this.packageData,
				this.selectedFile,
				selectedDeckIds,
				this.destinationFolder,
				(current, total, message) => {
					this.progressBar?.setProgress(current, total, message);
				},
				overwriteTemplates,
			);

			this.showResult(result);
		} catch (error) {
			new Notice(`Import failed: ${(error as Error).message}`);
			this.buttonRow?.setSubmitDisabled(false);
		}
	}

	private async confirmTemplateConflicts(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			let resolved = false;
			const modal = new Modal(this.app);
			modal.onOpen = () => {
				const { contentEl } = modal;
				contentEl.empty();
				contentEl.addClass("anki-import-confirm-modal");

				contentEl.createEl("h2", { text: "Template conflicts" });
				message.split(/\n\n+/).forEach((paragraph) => {
					contentEl.createEl("p", { text: paragraph });
				});

				const buttonRow = contentEl.createDiv({
					cls: "flashcard-modal-buttons",
				});
				const leftButtons = buttonRow.createDiv({
					cls: "flashcard-buttons-left",
				});
				const rightButtons = buttonRow.createDiv({
					cls: "flashcard-buttons-right",
				});

				new ButtonComponent(leftButtons)
					.setButtonText("Cancel")
					.onClick(() => {
						resolved = true;
						resolve(false);
						modal.close();
					});

				new ButtonComponent(rightButtons)
					.setButtonText("Continue")
					.setCta()
					.onClick(() => {
						resolved = true;
						resolve(true);
						modal.close();
					});
			};

			modal.onClose = () => {
				modal.contentEl.empty();
				if (!resolved) {
					resolve(false);
				}
			};

			modal.open();
		});
	}

	/**
	 * Build confirmation message for template conflicts.
	 */
	private buildTemplateConflictMessage(conflicts: string[]): string {
		const maxNames = 6;
		const shown = conflicts.slice(0, maxNames);
		const remaining = conflicts.length - shown.length;
		const list = shown.join(", ");
		const more = remaining > 0 ? ` and ${remaining} more` : "";
		return (
			"Existing templates were found with the same name(s): " +
			`${list}${more}.\n\n` +
			"Importing will overwrite those templates with the converted Anki versions. Continue?"
		);
	}

	/**
	 * Show the import result and close modal.
	 */
	private showResult(result: ImportResult): void {
		const errorCount = result.errors.length;
		const successMsg = `Imported ${result.cardsImported} cards, ${result.templatesCreated} templates, ${result.mediaImported} media files.`;

		if (errorCount > 0) {
			new Notice(`${successMsg} (${errorCount} errors - check console)`);
			console.warn("[Anker] Import errors:", result.errors);
		} else {
			new Notice(successMsg);
		}

		this.close();
	}
}
