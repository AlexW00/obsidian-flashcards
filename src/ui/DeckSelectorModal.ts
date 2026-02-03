import { App, FuzzySuggestModal } from "obsidian";
import type { Deck } from "../types";
import { DeckService } from "../flashcards/DeckService";

type DeckSelectorResult = { type: "existing"; path: string };

interface DeckOption {
	display: string;
	path: string;
}

/**
 * Modal for selecting a deck (existing or new folder).
 *
 * Flow:
 * - If decks exist: Show list of existing decks + "Create in new folder..." option
 * - If no decks: Skip directly to folder selection
 */
export class DeckSelectorModal extends FuzzySuggestModal<DeckOption> {
	private deckService: DeckService;
	private onChooseCb: (result: DeckSelectorResult) => void;
	private decks: Deck[];

	constructor(
		app: App,
		deckService: DeckService,
		onChoose: (result: DeckSelectorResult) => void,
	) {
		super(app);
		this.deckService = deckService;
		this.onChooseCb = onChoose;
		this.decks = deckService.discoverDecks();

		this.setPlaceholder("Select a deck...");
	}

	getItems(): DeckOption[] {
		// Show existing decks
		const options: DeckOption[] = this.decks.map((deck) => ({
			display: `${deck.path} (${deck.stats.new} new, ${deck.stats.learn} learn, ${deck.stats.relearn} relearn, ${deck.stats.review} review)`,
			path: deck.path,
		}));
		return options;
	}

	getItemText(item: DeckOption): string {
		return item.display;
	}

	onChooseItem(item: DeckOption, _evt: MouseEvent | KeyboardEvent): void {
		this.onChooseCb({
			type: "existing",
			path: item.path,
		});
	}
}
