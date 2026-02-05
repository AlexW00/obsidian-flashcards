import { App, FuzzySuggestModal } from "obsidian";
import type { Deck } from "../types";
import { DeckService } from "../flashcards/DeckService";

function stringifyErrorValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		if (value instanceof Error) {
			return value.message;
		}
		if (value === null) {
			return "null";
		}
		switch (typeof value) {
			case "number":
			case "boolean":
			case "bigint":
				return value.toString();
			case "symbol":
				return value.description ?? value.toString();
			case "undefined":
				return "undefined";
			case "function":
				return value.name ? `[function ${value.name}]` : "[function]";
			case "object":
			default:
				return Object.prototype.toString.call(value);
		}
	}
}

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
				stringifyErrorValue(error).trim() !== ""
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
