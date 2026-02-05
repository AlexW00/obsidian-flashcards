# Anker Plugin

## Index

- **Entry point**: [src/main.ts](src/main.ts)
- **Settings**: [src/settings.ts](src/settings.ts)
- **Types**: [src/types.ts](src/types.ts)
- **Flashcards**: [src/flashcards/](src/flashcards/)
- **SRS**: [src/srs/](src/srs/)
- **UI**: [src/ui/](src/ui/)
- **Services**: [src/services/](src/services/)
- **Docs**: [docs/dev/](docs/dev/)
- **Build config**: [esbuild.config.mjs](esbuild.config.mjs)
- **Plugin metadata**: [manifest.json](manifest.json), [versions.json](versions.json)
- **Resources**: `resources/` - mainly contains data used for testing like e.g. an anki export package.

## Project overview

Obsidian community plugin for spaced repetition flashcards using FSRS. The plugin uses a **hydration model**: frontmatter is the source of truth and the Markdown body is generated from templates.

## How it works (high level)

- Card creation writes frontmatter and regenerates body from templates.
- Reviews update scheduling in frontmatter.
- Review history is stored in a separate JSONL file (`review-history.jsonl`) in the plugin folder, **not** in the Markdown files. This keeps card files clean while collecting data for FSRS parameter optimization.
- Template changes regenerate body.
- No database - all card data is stored in Markdown files (mainly frontmatter). Plugin operational data (review history, settings) lives in the plugin config folder.

## Hooks (run after changes)

- **Lint**: `npm run lint`
- **Typecheck**: `npm run typecheck`
- **Test (unit + integration)**: `npm test -- --run`
- **Build (when needed)**: `npm run build`

## Key conventions

- Flashcards live in Markdown files with frontmatter fields like `_type`, `_template`, `_review`.
- Template variables use Nunjucks `{{ variable }}` syntax.
- Generated content starts with `<!-- flashcard-content: DO NOT EDIT BELOW -->`.

## Best practices

- Keep [src/main.ts](src/main.ts) minimal (lifecycle + registration only).
- Prefer Obsidian UI components (modals, settings, inputs) over custom HTML/CSS when possible.
- Use `this.register*` helpers to clean up listeners and intervals.
- Avoid unnecessary network calls. If required, document and provide opt-in.
- Keep changes mobile-safe
- Use Obsidian CSS variables for colors, fonts, spacing, etc. - don't create a "theme" for the plugin - it should look like a built in plugin.
- Create re-usable components for repeated UI patterns (e.g. lists etc) so that the plugin looks consistent and shares code.
- Write high value unit tests for logic that does not depend on the Obsidian API.

## Testing guidelines

- After any code changes, run lint, typecheck, and unit + integration tests.
- E2E tests are not required locally; they run in CI/CD because they are resource intensive.
- Unit tests cover pure logic that does not require the Obsidian API.
- Integration tests also avoid the Obsidian API, but can exercise file interactions like Anki packages, templates, or markdown fixtures.
- E2E tests validate end-to-end user flows in Obsidian; keep them focused on high-value paths.
- Follow the Pareto principle for coverage: prioritize high-impact scenarios over exhaustive coverage.

## Obsidian API reference

- API docs: https://docs.obsidian.md (see for components, functions etc.)
- When unsure about an API or UI pattern, consult the docs and reuse official components before building custom UI.
