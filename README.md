# Obsidian Flashcards

# Obsidian Flashcard Plugin: Architectural Plan

## 1. Core Data Structure

- **Flashcard Note:** A standard Markdown file.
- **Separators:** Content sides split by `---` (standard horizontal rules).
- **Frontmatter (The Source of Truth):**
    - `type`: `flashcard` (identifier).
    - `template`: `[[Templates/Vocab Card]]` (WikiLink to the template file).
    - `fields`: Object containing the raw data variables (e.g., `{ word: "Cat", meaning: "Gato" }`).
    - `review`: Object containing the persisted scheduler state (source of truth for scheduling).
        - Uses the `Card` shape from [`ts-fsrs`](https://www.npmjs.com/package/ts-fsrs) (stored as JSON-friendly primitives):
            - `due`: ISO timestamp for next review
            - `stability`: number
            - `difficulty`: number
            - `elapsed_days`: number
            - `scheduled_days`: number
            - `learning_steps`: number
            - `reps`: number
            - `lapses`: number
            - `state`: `New` | `Learning` | `Review` | `Relearning` (string or numeric enum)
            - `last_review` (optional): ISO timestamp
    - _Note:_ The body content is considered a "Hydration Artifact"—it can be overwritten by the plugin based on the fields and template.

## 2. Templating Engine (Nunjucks)

- **Engine:** [Nunjucks](https://mozilla.github.io/nunjucks/) (Mozilla).
- **Why:** Familiar syntax (`{{ variable }}`), safe defaults, and a powerful filter system.
- **Field Types:**
    - Defined implicitly by usage in the template, or explicitly via a "Template Config" block in the template file (optional future feature).

## 3. Card Lifecycle (Hydration Model)

- **Creation:**
    1.  User fills out a form (Modal).
    2.  Plugin saves `fields` to Frontmatter.
    3.  Plugin runs `render(template, fields)` to generate the Markdown body.
- **Updates (Regeneration):**
    - **Trigger:** User edits the _Template file_ or modifies the _Fields_ in the card's frontmatter.
    - **Action:** "Regenerate Card" command/button.
    - **Process:**
        1.  Read `frontmatter.template` (resolve WikiLink).
        2.  Read `frontmatter.fields`.
        3.  Re-render the Nunjucks template.
        4.  **Overwrite** the Markdown body (everything below the frontmatter) with the new result.
- **Protection:** The plugin should insert a comment at the top of the body: ``.

## 4. Settings

- **General:**
    - **Flashcard Note Name:** Template string (default: `{{date}}-{{time}}` or Unix timestamp).
    - **Template Folder:** Path to folder containing `.md` template files.

## 5. Dashboard View

- **Toolbar:**
    - **Add Card:**
        - Dropdown: Select Template (scans Template Folder).
        - Modal: Dynamic form generation based on variables found in the Nunjucks template (regex scan of variables) OR a defined schema.
        - Folder Picker: Defaults to current deck or last used.
        - "Create & Add Another": Keeps modal open for rapid entry.
    - **Browse:** Switches view to a standard Obsidian search/table view filtered by `type: flashcard`.
- **Main Body (Deck View):**
    - Hierarchical list of folders containing flashcards.
    - Stats per deck: New (Blue), Learning (Red), To Review (Green).
- **Deck Details:**
    - "Study Now" button -> Launches Review Mode.
    - "Regenerate All" button -> Batch hydrates all cards in deck (useful after template edits).

## 6. Review View (The "Study" Mode)

- **Rendering:**
    - Standard `MarkdownRenderer.render()` (supports images, math, standard Obsidian plugins).
    - Splits content by `---`.
    - Shows Side 1 -> User interaction -> Shows Side 2 -> ... -> Rating.
- **Rating System:**
    - Standard buttons: Again, Hard, Good, Easy.
    - Engine: FSRS (Free Spaced Repetition Scheduler) via `ts-fsrs`.
    - Parameters: use `ts-fsrs` defaults for MVP (future: expose FSRS parameters in plugin settings).
- **Interactions:**
    - `Space`: Reveal / Next.
    - `Cmd+E` / Edit Button: Opens the underlying Markdown file for manual fixes (user should edit Frontmatter `fields`, not body).

## 7. Commands (Palette)

- `Flashcards: Open Dashboard`
- `Flashcards: Create new card` (Quick add)
- `Flashcards: Start Review` (Selector for deck)
- `Flashcards: Regenerate current card` (For use when editing a single note)

## 8. Future (Post-MVP)

- **AI-assisted templating (optional):**
    - **Custom Nunjucks Filters:** Implement an async filter `| aiGenerate`.
        - _Usage:_ `{{ "Translate this to french" | aiGenerate }}`
        - _Implementation:_ Plugin registers an async Nunjucks filter that calls the configured AI provider API.
- **AI Integration Settings:**
    - **Provider:** (OpenAI, Anthropic, Local, etc.)
    - **API Key:** Secure storage.
    - **Model:** Select model (e.g., GPT-4o, Claude 3.5).
- Update Dashboard so that:
    - folders can be collapsed/expanded
    - gray bg of folder items is gone
- add regenerate all cards from template option as command; when triggered, it shows the progress in a toast
- when editing a template, offer to regenerate all cards that use that template (as an obsidian toast) -> triggers the command above; make sure that if a edit? is already running, it doesn't start a new one
