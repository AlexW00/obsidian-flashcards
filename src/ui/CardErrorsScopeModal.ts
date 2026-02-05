import { App, FuzzySuggestModal } from "obsidian";
import type { Deck } from "../types";
import { DeckService } from "../flashcards/DeckService";

type CardErrorsScopeOption =
	| { type: "deck"; path: string; display: string }
	| { type: "all"; display: string }
	| { type: "template"; display: string };

export type CardErrorsScopeResult =
	| { type: "deck"; path: string }
	| { type: "all" }
	| { type: "template" };

/**
 * Modal for selecting which scope to show card errors for.
 */
export class CardErrorsScopeModal extends FuzzySuggestModal<CardErrorsScopeOption> {
	private deckService: DeckService;
	private decks: Deck[];
	private onChoose: (scope: CardErrorsScopeResult) => void;

	constructor(
		app: App,
		deckService: DeckService,
		onChoose: (scope: CardErrorsScopeResult) => void,
	) {
		super(app);
		this.deckService = deckService;
		this.decks = deckService.discoverDecks();
		this.onChoose = onChoose;
		this.setPlaceholder("Select a deck or option...");
	}

	/**
	 * Count card errors in a deck (cards with _error in frontmatter).
	 */
	private countCardErrors(deckPath: string): number {
		const cards = this.deckService.getFlashcardsInFolder(deckPath);
		return cards.filter((card) => {
			const fm = card.frontmatter as unknown as Record<string, unknown>;
			const error = fm._error;
			return (
				error !== undefined &&
				error !== null &&
				String(error).trim() !== ""
			);
		}).length;
	}

	getItems(): CardErrorsScopeOption[] {
		const deckOptions: CardErrorsScopeOption[] = this.decks.map((deck) => {
			const errorCount = this.countCardErrors(deck.path);
			const errorText =
				errorCount === 0
					? "no errors"
					: errorCount === 1
						? "1 error"
						: `${errorCount} errors`;
			return {
				type: "deck",
				path: deck.path,
				display: `${deck.path} (${errorText})`,
			};
		});

		return [
			...deckOptions,
			{ type: "all", display: "All decks" },
			{ type: "template", display: "Choose a template..." },
		];
	}

	getItemText(item: CardErrorsScopeOption): string {
		return item.display;
	}

	onChooseItem(
		item: CardErrorsScopeOption,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		if (item.type === "deck") {
			this.onChoose({ type: "deck", path: item.path });
			return;
		}
		this.onChoose({ type: item.type });
	}
}
