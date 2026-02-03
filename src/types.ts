import { State } from "ts-fsrs";

/**
 * Review state stored in flashcard frontmatter.
 * Matches the ts-fsrs Card shape but uses JSON-friendly primitives.
 */
export interface ReviewState {
	due: string; // ISO timestamp
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	reps: number;
	lapses: number;
	state: State; // 0=New, 1=Learning, 2=Review, 3=Relearning
	last_review?: string; // ISO timestamp
}

/**
 * Flashcard frontmatter structure.
 * This is the source of truth for all card data.
 */
export interface FlashcardFrontmatter {
	type: "flashcard";
	template: string; // WikiLink to template file, e.g. "[[Templates/Vocab Card]]"
	fields: Record<string, string>; // Raw data variables
	review: ReviewState;
	dueAt?: string; // Convenience field, mirrors review.due
}

/**
 * A flashcard with its file path and parsed frontmatter.
 */
export interface Flashcard {
	path: string;
	frontmatter: FlashcardFrontmatter;
}

/**
 * Deck statistics for display in dashboard.
 */
export interface DeckStats {
	new: number; // Cards never reviewed (state = New)
	learning: number; // Cards in learning/relearning (state = Learning | Relearning)
	due: number; // Cards due for review (state = Review, due <= now)
	total: number; // Total cards in deck
}

/**
 * A deck (folder) containing flashcards.
 */
export interface Deck {
	path: string; // Folder path
	name: string; // Display name (folder name)
	stats: DeckStats;
	isParent: boolean; // True if this deck only contains child decks, not direct cards
}

/**
 * Template variable extracted from a Nunjucks template.
 */
export interface TemplateVariable {
	name: string;
	defaultValue?: string;
}

/**
 * A template file with its parsed variables.
 */
export interface FlashcardTemplate {
	path: string;
	name: string;
	variables: TemplateVariable[];
	content: string;
}
