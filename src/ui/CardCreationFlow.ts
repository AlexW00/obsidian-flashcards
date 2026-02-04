import { App, Notice, TFile } from "obsidian";
import type {
	FlashcardTemplate,
	FlashcardsPluginSettings,
	FlashcardsPluginState,
} from "../types";
import type { CardService } from "../flashcards/CardService";
import type { DeckService } from "../flashcards/DeckService";
import type { TemplateService } from "../flashcards/TemplateService";
import { CardFormModal } from "./CardFormModal";

/**
 * Callback invoked after a card is created.
 */
export interface CardCreationCallbacks {
	/** Called after the dashboard should refresh (if applicable) */
	onRefresh?: () => Promise<void>;
}

/**
 * Opens the card creation modal directly, with deck/template selection embedded in the modal.
 * This is the main entry point for creating flashcards.
 */
export function showCardCreationModal(
	app: App,
	cardService: CardService,
	deckService: DeckService,
	templateService: TemplateService,
	settings: FlashcardsPluginSettings,
	state: FlashcardsPluginState,
	saveState: () => Promise<void>,
	callbacks?: CardCreationCallbacks,
	/** Optional initial deck path override */
	initialDeckPath?: string,
	/** Optional initial template override */
	initialTemplate?: FlashcardTemplate,
): void {
	new CardFormModal({
		app,
		deckService,
		templateService,
		templateFolder: settings.templateFolder,
		attachmentFolder: settings.attachmentFolder,
		lastUsedDeck: state.lastUsedDeck,
		lastUsedTemplate: state.lastUsedTemplate,
		initialDeckPath,
		initialTemplate,
		onSubmit: (fields, deckPath, templatePath, createAnother) => {
			void cardService
				.createCard(
					deckPath,
					templatePath,
					fields,
					settings.noteNameTemplate,
				)
				.then(async (file) => {
					new Notice("Card created!");

					// Update last used deck and template
					state.lastUsedDeck = deckPath;
					state.lastUsedTemplate = templatePath;
					await saveState();

					// Refresh dashboard if callback provided
					if (callbacks?.onRefresh) {
						await callbacks.onRefresh();
					}

					if (!createAnother && settings.openCardAfterCreation) {
						await app.workspace.getLeaf().openFile(file);
					}
				})
				.catch((error: Error) => {
					new Notice(`Failed to create card: ${error.message}`);
				});
		},
	}).open();
}

/**
 * Opens the card creation modal in edit mode for an existing flashcard file.
 */
export async function showCardEditModal(
	app: App,
	cardService: CardService,
	deckService: DeckService,
	templateService: TemplateService,
	settings: FlashcardsPluginSettings,
	file: TFile,
	callbacks?: CardCreationCallbacks,
): Promise<void> {
	const card = cardService.getCard(file);
	if (!card) {
		new Notice("This file is not a flashcard.");
		return;
	}

	const template = await templateService.loadTemplate(
		card.frontmatter._template,
	);
	if (!template) {
		new Notice("Template not found for this card.");
		return;
	}

	const deckPath = file.parent?.path ?? "";
	const initialFields = cardService.extractUserFields(card.frontmatter);

	new CardFormModal({
		app,
		deckService,
		templateService,
		templateFolder: settings.templateFolder,
		attachmentFolder: settings.attachmentFolder,
		mode: "edit",
		initialDeckPath: deckPath,
		initialTemplate: template,
		initialFields,
		onSubmit: () => {
			// Not used in edit mode
		},
		onUpdate: (fields, updatedDeckPath, updatedTemplatePath) => {
			void cardService
				.updateCardFields(file, fields, updatedTemplatePath, updatedDeckPath)
				.then(async () => {
					new Notice("Card updated!");
					if (callbacks?.onRefresh) {
						await callbacks.onRefresh();
					}
				})
				.catch((error: Error) => {
					new Notice(`Failed to update card: ${error.message}`);
				});
		},
	}).open();
}
