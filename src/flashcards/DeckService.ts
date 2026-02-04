import { App, TFile, TFolder } from "obsidian";
import type {
	Deck,
	DeckStats,
	Flashcard,
	FlashcardFrontmatter,
} from "../types";
import { State } from "ts-fsrs";

/**
 * Service for managing decks (folders containing flashcards).
 */
export class DeckService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Cards are considered due if their due date is before the end of today.
	 * This mirrors Anki's behavior where all cards due "today" are reviewable.
	 */
	private isDueToday(dueDate: Date): boolean {
		const endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);
		return dueDate <= endOfToday;
	}

	/**
	 * Check whether a review state is due today.
	 * New cards (no review state) are treated as due.
	 */
	isReviewDue(review: FlashcardFrontmatter["_review"]): boolean {
		if (!review) return true;
		const dueDate = new Date(review.due);
		return this.isDueToday(dueDate);
	}

	/**
	 * Get the due date for a card, used for sorting.
	 * New cards (no review state) are treated as earliest due.
	 */
	private getCardDueDate(card: Flashcard): Date {
		const review = card.frontmatter._review;
		if (!review) return new Date(0);
		return new Date(review.due);
	}

	/**
	 * Check if a file is a flashcard based on its frontmatter.
	 */
	isFlashcard(file: TFile): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?._type === "flashcard";
	}

	/**
	 * Parse a flashcard file into a Flashcard object.
	 */
	parseFlashcard(file: TFile): Flashcard | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		if (fm?._type !== "flashcard") {
			return null;
		}

		return {
			path: file.path,
			frontmatter: fm as FlashcardFrontmatter,
		};
	}

	/**
	 * Get all flashcards in a folder (recursively).
	 */
	getFlashcardsInFolder(folderPath: string): Flashcard[] {
		const flashcards: Flashcard[] = [];
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			return flashcards;
		}

		const processFolder = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFile && child.extension === "md") {
					const card = this.parseFlashcard(child);
					if (card) {
						flashcards.push(card);
					}
				} else if (child instanceof TFolder) {
					processFolder(child);
				}
			}
		};

		processFolder(folder);
		return flashcards;
	}

	/**
	 * Get all flashcards in the vault.
	 */
	getAllFlashcards(): Flashcard[] {
		const flashcards: Flashcard[] = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const card = this.parseFlashcard(file);
			if (card) {
				flashcards.push(card);
			}
		}

		return flashcards;
	}

	/**
	 * Calculate stats for a set of flashcards.
	 */
	calculateStats(flashcards: Flashcard[]): DeckStats {
		let newCount = 0;
		let learnCount = 0;
		let relearnCount = 0;
		let reviewCount = 0;

		for (const card of flashcards) {
			const review = card.frontmatter._review;
			if (!review) {
				newCount++;
				continue;
			}

			const state = review.state;
			if (state === State.New) {
				newCount++;
			} else if (state === State.Learning) {
				learnCount++;
			} else if (state === State.Relearning) {
				relearnCount++;
			} else if (state === State.Review) {
				const dueDate = new Date(review.due);
				if (this.isDueToday(dueDate)) {
					reviewCount++;
				}
			}
		}

		return {
			new: newCount,
			learn: learnCount,
			relearn: relearnCount,
			review: reviewCount,
			total: flashcards.length,
		};
	}

	/**
	 * Discover all decks (folders containing flashcards).
	 * A deck is a folder with at least one flashcard.
	 * Parent folders of decks are also considered decks.
	 */
	discoverDecks(): Deck[] {
		const flashcards = this.getAllFlashcards();
		const deckPaths = new Set<string>();

		// Collect all folder paths that contain flashcards
		for (const card of flashcards) {
			const parts = card.path.split("/");
			parts.pop(); // Remove filename

			// Add all parent paths as potential decks
			let currentPath = "";
			for (const part of parts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				deckPaths.add(currentPath);
			}
		}

		// Build deck objects with stats
		const decks: Deck[] = [];
		for (const path of deckPaths) {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (!(folder instanceof TFolder)) continue;

			const cardsInDeck = this.getFlashcardsInFolder(path);
			const directCards = cardsInDeck.filter((c) => {
				const cardFolder = c.path.split("/").slice(0, -1).join("/");
				return cardFolder === path;
			});

			decks.push({
				path,
				name: folder.name,
				stats: this.calculateStats(cardsInDeck),
				isParent: directCards.length === 0,
			});
		}

		// Sort by path for hierarchical display
		decks.sort((a, b) => a.path.localeCompare(b.path));
		return decks;
	}

	/**
	 * Get cards due for review in a specific deck.
	 */
	getDueCards(deckPath: string): Flashcard[] {
		const flashcards = this.getFlashcardsInFolder(deckPath);

		const dueCards = flashcards.filter((card) => {
			const review = card.frontmatter._review;
			return this.isReviewDue(review);
		});

		return dueCards.sort(
			(a, b) =>
				this.getCardDueDate(a).getTime() -
				this.getCardDueDate(b).getTime(),
		);
	}

	/**
	 * Get all folders in the vault for folder selection.
	 */
	getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];

		const processFolder = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					processFolder(child);
				}
			}
		};

		const root = this.app.vault.getRoot();
		for (const child of root.children) {
			if (child instanceof TFolder) {
				processFolder(child);
			}
		}

		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * Get all flashcards using a specific template.
	 * @param templatePath The template path to match (can be in wikilink format)
	 */
	getFlashcardsByTemplate(templatePath: string): Flashcard[] {
		const allCards = this.getAllFlashcards();

		// Normalize template path for comparison
		const normalizedTemplatePath = this.normalizeTemplatePath(templatePath);

		return allCards.filter((card) => {
			const cardTemplatePath = this.normalizeTemplatePath(
				card.frontmatter._template,
			);
			return cardTemplatePath === normalizedTemplatePath;
		});
	}

	/**
	 * Normalize a template path for comparison.
	 * Removes wikilink syntax and .md extension.
	 */
	private normalizeTemplatePath(templatePath: string): string {
		// Remove [[ and ]] if present
		let path = templatePath.replace(/^\[\[|\]\]$/g, "");
		// Remove alias if present (everything after |)
		const parts = path.split("|");
		path = (parts[0] ?? path).trim();
		// Remove .md extension for comparison
		if (path.endsWith(".md")) {
			path = path.slice(0, -3);
		}
		return path;
	}
}
