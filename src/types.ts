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
	content: string; // Full raw content including any frontmatter
	body: string; // Template body (Nunjucks content without frontmatter)
	frontmatter: Record<string, unknown> | null; // Parsed frontmatter from template (if any)
}

/**
 * Available columns for deck base view.
 */
export type DeckViewColumn =
	| "file.name"
	| "template"
	| "state"
	| "due"
	| "stability"
	| "difficulty"
	| "reps"
	| "lapses"
	| "last_review"
	| "scheduled_days"
	| "elapsed_days";

/** Human-readable labels for deck view columns */
export const DECK_VIEW_COLUMN_LABELS: Record<DeckViewColumn, string> = {
	"file.name": "File Name",
	template: "Template",
	state: "State",
	due: "Due",
	stability: "Stability",
	difficulty: "Difficulty",
	reps: "Repetitions",
	lapses: "Lapses",
	last_review: "Last Review",
	scheduled_days: "Scheduled Days",
	elapsed_days: "Elapsed Days",
};

/** All available deck view columns */
export const ALL_DECK_VIEW_COLUMNS: DeckViewColumn[] = [
	"file.name",
	"template",
	"state",
	"due",
	"stability",
	"difficulty",
	"reps",
	"lapses",
	"last_review",
	"scheduled_days",
	"elapsed_days",
];

/**
 * Plugin settings interface.
 */
export interface FlashcardsPluginSettings {
	/** Path to folder containing template files */
	templateFolder: string;
	/** Template for flashcard note names. Supports {{date}}, {{time}}, {{timestamp}} */
	noteNameTemplate: string;
	/** Last used deck path for quick access */
	lastUsedDeck: string;
	/** Default template content used when creating new templates */
	defaultTemplateContent: string;
	/** Seconds to wait before auto-regenerating after edits (cards or templates). Set to 0 to disable. */
	autoRegenerateDebounce: number;
	/** If true, only show the current side during review. If false, show all sides up to the current one. */
	showOnlyCurrentSide: boolean;
	/** Columns to display in deck base view */
	deckViewColumns: DeckViewColumn[];
}

/** Default basic template content */
export const DEFAULT_BASIC_TEMPLATE = `# {{ front }}

---

{{ back }}

<!--
## Template Tips

This is a Basic flashcard template using Nunjucks syntax.

### How templates work:
- Variables are wrapped in {{ double_braces }}
- When creating a card, you'll be prompted to fill in each variable
- The content above the --- is shown as the question
- The content below the --- is revealed as the answer

### Creating your own templates:
1. Create a new .md file in this folder
2. Use {{ variable_name }} for any fields you want to fill in
3. Use --- to separate the front (question) from the back (answer)

### Example: Vocabulary Template
# {{ word }}

*{{ part_of_speech }}*

---

**Definition:** {{ definition }}

**Example:** {{ example_sentence }}

### Example: Cloze Template
{{ context_before }} [...] {{ context_after }}

---

{{ context_before }} **{{ answer }}** {{ context_after }}

For more information, see the plugin documentation.
-->
`;

export const DEFAULT_SETTINGS: FlashcardsPluginSettings = {
	templateFolder: "Templates/Flashcards",
	noteNameTemplate: "{{timestamp}}",
	lastUsedDeck: "",
	defaultTemplateContent: DEFAULT_BASIC_TEMPLATE,
	autoRegenerateDebounce: 1,
	showOnlyCurrentSide: false,
	deckViewColumns: [
		"file.name",
		"template",
		"state",
		"due",
		"reps",
		"lapses",
	],
};

/**
 * Interface for plugin functionality needed by settings tab.
 * Avoids circular dependency between main.ts and settings.ts.
 */
export interface PluginWithSettings {
	settings: FlashcardsPluginSettings;
	saveSettings(): Promise<void>;
}
