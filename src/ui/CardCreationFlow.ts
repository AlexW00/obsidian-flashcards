import { App, Notice } from "obsidian";
import type { FlashcardTemplate, FlashcardsPluginSettings } from "../types";
import type { CardService } from "../flashcards/CardService";
import { CardCreationModal } from "./CardCreationModal";

/**
 * Callback invoked after a card is created.
 */
export interface CardCreationCallbacks {
	/** Called after the dashboard should refresh (if applicable) */
	onRefresh?: () => Promise<void>;
}

/**
 * Handles the card creation modal flow, used by both main.ts and DashboardView.
 * Consolidates the duplicated showCardCreationModal logic.
 */
export function showCardCreationModal(
	app: App,
	cardService: CardService,
	settings: FlashcardsPluginSettings,
	saveSettings: () => Promise<void>,
	template: FlashcardTemplate,
	deckPath: string,
	callbacks?: CardCreationCallbacks,
): void {
	new CardCreationModal(
		app,
		template,
		deckPath,
		(fields, createAnother) => {
			void cardService
				.createCard(
					deckPath,
					template.path,
					fields,
					settings.noteNameTemplate,
				)
				.then(async (file) => {
					new Notice("Card created!");

					// Update last used deck
					settings.lastUsedDeck = deckPath;
					await saveSettings();

					// Refresh dashboard if callback provided
					if (callbacks?.onRefresh) {
						await callbacks.onRefresh();
					}

					if (createAnother) {
						// Recursive call for "Create & add another"
						showCardCreationModal(
							app,
							cardService,
							settings,
							saveSettings,
							template,
							deckPath,
							callbacks,
						);
					} else if (settings.openCardAfterCreation) {
						await app.workspace.getLeaf().openFile(file);
					}
				})
				.catch((error: Error) => {
					new Notice(`Failed to create card: ${error.message}`);
				});
		},
	).open();
}
