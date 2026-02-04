import {
	State,
	default_enable_fuzz,
	default_enable_short_term,
	default_learning_steps,
	default_maximum_interval,
	default_relearning_steps,
	default_request_retention,
	default_w,
} from "ts-fsrs";

/**
 * Enable debug logging throughout the plugin.
 * Set to true for development, false for production.
 */
export const DEBUG = false;

/**
 * Log a debug message if DEBUG is enabled.
 * Use this instead of console.debug for togglable logging.
 */
export function debugLog(message: string, ...args: unknown[]): void {
	if (DEBUG) {
		// eslint-disable-next-line no-console
		console.log(`[Anker] ${message}`, ...args);
	}
	// eslint-disable-next-line no-console
	console.log(`[Anker] ${message}`, ...args);
}

/**
 * Protection comment inserted at the top of flashcard body content.
 * Warns users not to edit the generated content directly.
 */
export const PROTECTION_COMMENT =
	"<!-- flashcard-content: DO NOT EDIT BELOW - Edit the frontmatter above instead! -->";

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
 *
 * Plugin properties are prefixed with underscore to avoid conflicts with user fields.
 * User fields are stored at the top level (flattened from the template variables).
 *
 * Example:
 * ```yaml
 * _type: flashcard
 * _template: "[[Templates/Basic]]"
 * _review:
 *   due: "2024-01-15T10:00:00.000Z"
 *   state: 0
 * front: "Question"
 * back: "Answer"
 * ```
 */
export interface FlashcardFrontmatter {
	_type: "flashcard";
	_template: string; // WikiLink to template file, e.g. "[[Templates/Vocab Card]]"
	_review: ReviewState;
	// User fields are stored at the top level (indexed by string)
	[key: string]: unknown;
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
	learn: number; // Cards in learn state (state = Learning)
	relearn: number; // Cards in relearn state (state = Relearning)
	review: number; // Cards due for review (state = Review, due <= now)
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
	| "file.ctime"
	| "file.mtime"
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
	"file.ctime": "Created",
	"file.mtime": "Modified",
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
	"file.ctime",
	"file.mtime",
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
 * Supported AI provider types.
 */
export type AiProviderType = "openai" | "anthropic" | "google" | "openrouter";

/**
 * Configuration for a single AI provider.
 */
export interface AiProviderConfig {
	type: AiProviderType;
	/** Optional system prompt prepended to text generation requests */
	systemPrompt?: string;
	/** Model ID for text generation (e.g., "gpt-4o", "claude-sonnet-4-20250514") */
	textModel?: string;
	/** Model ID for image generation (e.g., "dall-e-3") */
	imageModel?: string;
	/** Model ID for speech generation (e.g., "tts-1") */
	speechModel?: string;
	/** Voice ID for speech generation (e.g., "alloy") */
	speechVoice?: string;
	/** Optional custom base URL */
	baseUrl?: string;
}

/**
 * Per-pipe provider selection.
 */
export interface AiPipeProviders {
	/** Provider ID for askAi pipe */
	askAi?: string;
	/** Provider ID for generateImage pipe */
	generateImage?: string;
	/** Provider ID for generateSpeech pipe */
	generateSpeech?: string;
}

/**
 * Plugin settings interface.
 */
export interface FlashcardsPluginSettings {
	/** Path to folder containing template files */
	templateFolder: string;
	/** Template for flashcard note names. Supports {{date}}, {{time}}, {{timestamp}} */
	noteNameTemplate: string;
	/** Default template content used when creating new templates */
	defaultTemplateContent: string;
	/** Seconds to wait before auto-regenerating after edits (cards or templates). Set to 0 to disable. */
	autoRegenerateDebounce: number;
	/** If true, only show the current side during review. If false, show all sides up to the current one. */
	showOnlyCurrentSide: boolean;
	/** Columns to display in deck base view */
	deckViewColumns: DeckViewColumn[];
	/** If true, open the created card in edit view after creation (unless 'Create & add another' is used) */
	openCardAfterCreation: boolean;
	/** Folder path for storing pasted/uploaded media attachments. Relative to vault root. */
	attachmentFolder: string;
	/** Default folder for importing Anki decks. Relative to vault root. */
	defaultImportFolder: string;
	/** FSRS request retention target (0-1). */
	fsrsRequestRetention: number;
	/** FSRS maximum interval in days. */
	fsrsMaximumInterval: number;
	/** FSRS enable fuzzing of intervals. */
	fsrsEnableFuzz: boolean;
	/** FSRS enable short-term learning. */
	fsrsEnableShortTerm: boolean;
	/** FSRS learning steps (e.g., ["1m", "10m"]). */
	fsrsLearningSteps: Array<string | number>;
	/** FSRS relearning steps (e.g., ["10m"]). */
	fsrsRelearningSteps: Array<string | number>;
	/** FSRS weights array. */
	fsrsWeights: number[];
	/** Configured AI providers, keyed by user-defined ID */
	aiProviders: Record<string, AiProviderConfig>;
	/** Provider selection for each AI pipe */
	aiPipeProviders: AiPipeProviders;
}

/**
 * Plugin state that should persist but is not user-configurable.
 */
export interface FlashcardsPluginState {
	/** Last used deck path for quick access */
	lastUsedDeck: string;
	/** Last used template path for quick access */
	lastUsedTemplate: string;
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
	templateFolder: "Anker/Templates",
	noteNameTemplate: "{{timestamp}}",
	defaultTemplateContent: DEFAULT_BASIC_TEMPLATE,
	autoRegenerateDebounce: 1,
	showOnlyCurrentSide: false,
	deckViewColumns: [
		"file.name",
		"file.ctime",
		"file.mtime",
		"template",
		"state",
		"due",
		"reps",
		"lapses",
	],
	openCardAfterCreation: true,
	attachmentFolder: "Anker/Attachments",
	defaultImportFolder: "Anker/Imported",
	fsrsRequestRetention: default_request_retention,
	fsrsMaximumInterval: default_maximum_interval,
	fsrsEnableFuzz: default_enable_fuzz,
	fsrsEnableShortTerm: default_enable_short_term,
	fsrsLearningSteps: [...default_learning_steps],
	fsrsRelearningSteps: [...default_relearning_steps],
	fsrsWeights: [...default_w],
	aiProviders: {},
	aiPipeProviders: {},
};

export const DEFAULT_STATE: FlashcardsPluginState = {
	lastUsedDeck: "",
	lastUsedTemplate: "",
};

/**
 * Interface for plugin functionality needed by settings tab.
 * Avoids circular dependency between main.ts and settings.ts.
 */
export interface PluginWithSettings {
	settings: FlashcardsPluginSettings;
	saveSettings(): Promise<void>;
}

// ============================================================================
// Anki Import Types
// ============================================================================

/**
 * Anki model field definition.
 */
export interface AnkiField {
	name: string;
	ord: number;
	sticky: boolean;
	rtl: boolean;
	font: string;
	size: number;
}

/**
 * Anki card template definition.
 */
export interface AnkiCardTemplate {
	name: string;
	qfmt: string; // Question (front) format HTML
	afmt: string; // Answer (back) format HTML
	ord: number;
	did: number | null;
	bqfmt: string; // Browser question format
	bafmt: string; // Browser answer format
}

/**
 * Anki model (note type) definition from col.models JSON.
 */
export interface AnkiModel {
	id: string;
	name: string;
	type: number; // 0 = standard, 1 = cloze
	flds: AnkiField[];
	tmpls: AnkiCardTemplate[];
	css: string;
	latexPre: string;
	latexPost: string;
	mod: number;
	did: number;
	sortf: number;
	tags: string[];
}

/**
 * Anki deck definition from col.decks JSON.
 */
export interface AnkiDeck {
	id: number;
	name: string; // May contain "::" for nested decks
	desc: string;
	mod: number;
	dyn: number; // 1 if filtered/dynamic deck
	collapsed: boolean;
}

/**
 * Anki note from notes table.
 */
export interface AnkiNote {
	id: number;
	guid: string;
	mid: number; // Model ID
	mod: number;
	tags: string;
	flds: string; // Fields separated by \x1f
	sfld: string; // Sort field
}

/**
 * Anki card from cards table.
 */
export interface AnkiCard {
	id: number;
	nid: number; // Note ID
	did: number; // Deck ID
	ord: number; // Template ordinal
	mod: number;
	type: number; // 0=new, 1=learning, 2=review, 3=relearning
	queue: number;
	due: number;
	ivl: number;
	factor: number;
	reps: number;
	lapses: number;
}

/**
 * Parsed Anki package data.
 */
export interface AnkiPackageData {
	models: Map<string, AnkiModel>;
	decks: Map<number, AnkiDeck>;
	notes: AnkiNote[];
	cards: AnkiCard[];
	media: Map<string, string>; // numeric filename -> original filename
}

/**
 * Deck selection for import UI.
 */
export interface AnkiDeckSelection {
	deck: AnkiDeck;
	selected: boolean;
	noteCount: number;
	children: AnkiDeckSelection[];
	depth: number;
}

/**
 * Progress callback for import operations.
 */
export type ImportProgressCallback = (
	current: number,
	total: number,
	message: string,
) => void;
