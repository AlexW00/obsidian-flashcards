# Anker

An Obsidian **native** flashcards plugin using the FSRS algorithm.

DISCLAIMER: Alpha! Planning to release it as a beta soon tho!

-> [todos](todo.md)

https://github.com/user-attachments/assets/30173ecd-e0e3-4e80-a01d-f1c3a2e3f397

## Features

- **FSRS Scheduling** — Uses the Free Spaced Repetition Scheduler algorithm via `ts-fsrs` for optimal review timing
- **Template-based Cards** — Create flashcard templates with Nunjucks syntax (`{{ variable }}`) for consistent card formats
- **Hydration Model** — Card content is generated from templates; edit the frontmatter fields, and the body regenerates automatically
- **Multi-side Cards** — Split card content with `---` separators for question/answer or multi-step reveals
- **Deck Organization** — Organize cards into folders (decks) with hierarchical stats display
- **Keyboard Shortcuts** — Review cards quickly with Space (reveal/Good) and 1-4 (rating keys)
- **Anki-style due behavior** — All cards due today are reviewable, ordered by due time

## Installation

### From Community Plugins

Not available yet!

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `<YourVault>/.obsidian/plugins/anker/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin in **Settings → Community plugins**

## Getting Started

### 1. Create a Template

Templates define the structure of your flashcards. By default, templates are stored in `Anker/Templates/`.

1. Run command **Anker: Create new template** (or check the folder for an existing one)
2. Enter a name (e.g., "Vocabulary")
3. Edit the template using `{{ variable }}` placeholders:

```markdown
# {{ word }}

_{{ part_of_speech }}_

---

**Definition:** {{ definition }}

**Example:** {{ example }}
```

### 2. Create Cards

1. Run command **Anker: Create new card** (or click the ribbon icon)
2. Select a deck (folder) for the card
3. Select a template
4. Fill in the field values
5. Click **Create** or **Create & add another**

### 3. Study Cards

1. Open the **Anker dashboard** from the ribbon icon or command palette
2. Click **Study** on any deck with due cards
3. Use keyboard shortcuts to review:
    - **Space** — Reveal next side / Rate as Good
    - **1** — Again (forgot)
    - **2** — Hard
    - **3** — Good
    - **4** — Easy
    - **E** — Edit current card

Note: Cards due later today are treated as due immediately (Anki-style). If a card’s next due time is still today, it can reappear during the same session.

## Commands

| Command                                       | Description                                  |
| --------------------------------------------- | -------------------------------------------- |
| **Anker: Open dashboard**                     | Show the main Anker dashboard                |
| **Anker: Create new card**                    | Start the card creation flow                 |
| **Anker: Start review**                       | Select a deck and begin studying             |
| **Anker: Regenerate current card**            | Re-render the current card from its template |
| **Anker: Create new template**                | Create a new flashcard template              |
| **Anker: Regenerate all cards from template** | Batch regenerate all cards using a template  |
| **Anker: Delete unused attachments**          | Find and delete unused attachments           |

## Settings

| Setting                      | Description                                                              | Default           |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------- |
| **Template folder**          | Folder containing template files                                         | `Anker/Templates` |
| **Note name template**       | Filename pattern for new cards (`{{date}}`, `{{time}}`, `{{timestamp}}`) | `{{timestamp}}`   |
| **Auto-regenerate debounce** | Seconds to wait before auto-regenerating after edits                     | `1`               |
| **Show only current side**   | Show only the current card side during review (vs. cumulative)           | `false`           |
| **Open card after creation** | Open new cards in edit view after creation                               | `true`            |
| **Deck view columns**        | Columns displayed in deck base views                                     | Various           |

## Card Structure

Cards are Markdown files with YAML frontmatter:

```yaml
---
type: flashcard
template: "[[Anker/Templates/Basic]]"
fields:
    front: "What is the capital of France?"
    back: "Paris"
review:
    due: "2024-01-15T10:00:00.000Z"
    state: 0
    stability: 4.93
    difficulty: 5.0
    reps: 0
    lapses: 0
---
<!-- flashcard-content: DO NOT EDIT BELOW - Edit the frontmatter above instead! -->


# What is the capital of France?

---
Paris
```

**Important:** Edit the `fields` in frontmatter, not the body content. The body is regenerated from the template.

## Template Syntax

Templates use [Nunjucks](https://mozilla.github.io/nunjucks/) syntax:

- `{{ variable }}` — Insert a field value
- `---` — Separate card sides (question/answer)

### Example Templates

**Basic (Front/Back):**

```markdown
# {{ front }}

---

{{ back }}
```

**Cloze-style:**

```markdown
{{ context_before }} [...] {{ context_after }}

---

{{ context_before }} **{{ answer }}** {{ context_after }}
```

**Vocabulary:**

```markdown
# {{ word }}

_{{ pronunciation }}_

---

**Definition:** {{ definition }}

**Examples:**
{{ examples }}
```

## Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Watch mode for development
npm run dev

# Typecheck
npm run typecheck

# Lint
npm run lint
```

## License

MIT License. See [LICENSE](LICENSE) for details.
