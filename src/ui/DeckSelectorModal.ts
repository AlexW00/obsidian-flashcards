import { App, FuzzySuggestModal, TFolder } from "obsidian";
import type { Deck } from "../types";
import { DeckService } from "../flashcards/DeckService";

type DeckSelectorResult =
	| { type: "existing"; path: string }
	| { type: "new"; path: string };

interface DeckOption {
	display: string;
	path: string;
	isNew: boolean;
	isFolder?: boolean;
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
	private allFolders: TFolder[];
	private showingFolders: boolean = false;

	constructor(
		app: App,
		deckService: DeckService,
		onChoose: (result: DeckSelectorResult) => void,
		showFolders: boolean = false,
	) {
		super(app);
		this.deckService = deckService;
		this.onChooseCb = onChoose;
		this.decks = deckService.discoverDecks();
		this.allFolders = deckService.getAllFolders();
		this.showingFolders = showFolders;

		// If no decks exist, start in folder selection mode
		if (this.decks.length === 0) {
			this.showingFolders = true;
		}

		this.setPlaceholder(
			this.showingFolders
				? "Select a folder for your new deck..."
				: "Select a deck or create new...",
		);
	}

	getItems(): DeckOption[] {
		if (this.showingFolders) {
			// Show all folders for new deck creation
			return this.allFolders.map((folder) => ({
				display: folder.path || "/",
				path: folder.path,
				isNew: true,
				isFolder: true,
			}));
		}

		// Show existing decks + new folder option
		const options: DeckOption[] = this.decks.map((deck) => ({
			display: `${deck.path} (${deck.stats.new} new, ${deck.stats.learning} learning, ${deck.stats.due} due)`,
			path: deck.path,
			isNew: false,
		}));

		// Add "Create in new folder" option at the end
		options.push({
			display: "📁 Create in new folder...",
			path: "",
			isNew: true,
		});

		return options;
	}

	getItemText(item: DeckOption): string {
		return item.display;
	}

	onChooseItem(item: DeckOption, _evt: MouseEvent | KeyboardEvent): void {
		if (item.isNew && !item.isFolder) {
			// User selected "Create in new folder", open a new modal for folder selection
			this.close();
			new DeckSelectorModal(
				this.app,
				this.deckService,
				this.onChooseCb,
				true, // showFolders
			).open();
			return;
		}

		this.onChooseCb({
			type: item.isNew ? "new" : "existing",
			path: item.path,
		});
	}
}
