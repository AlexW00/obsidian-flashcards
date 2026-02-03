# Obsidian Flashcards - MVP Implementation Plan

## Overview

Transform Obsidian notes into a spaced repetition system using Nunjucks templating for card creation and FSRS for intelligent scheduling.

## Design Decisions

- **Template variables**: Discovered via regex scan of `{{ variable }}` patterns
- **Deck model**: A deck is a folder containing ≥1 flashcard; parent folders inherit deck status
- **Card creation flow**: Deck selector (existing decks + new folder option) → Template selector → Field form
- **Review flow**: Always requires deck selection first (no global review)
- **UI approach**: Native Obsidian elements only (fits themes, feels like core plugin)

---

## Implementation Phases

### Phase 1: Foundation ✅

- [x] Create mvp.plan.md
- [x] Install dependencies (`ts-fsrs`, `nunjucks`)
- [x] Create `src/types.ts` - Core interfaces (FlashcardFrontmatter, ReviewState, etc.)
- [x] Rewrite `src/settings.ts` - Plugin settings interface

### Phase 2: Core Services ✅

- [x] Create `src/flashcards/TemplateService.ts` - Nunjucks integration, variable extraction
- [x] Create `src/flashcards/CardService.ts` - Card CRUD, frontmatter parsing, hydration
- [x] Create `src/flashcards/DeckService.ts` - Deck discovery, stats calculation
- [x] Create `src/srs/Scheduler.ts` - FSRS wrapper, review queue management

### Phase 3: UI Components ✅

- [x] Create `src/ui/SettingsTab.ts` (in settings.ts) - Settings tab component
- [x] Create `src/ui/DeckSelectorModal.ts` - Deck/folder selection modal
- [x] Create `src/ui/TemplateSelectorModal.ts` - Template picker
- [x] Create `src/ui/CardCreationModal.ts` - Dynamic form from template variables
- [x] Create `src/ui/DashboardView.ts` - Main view with deck list and stats
- [x] Create `src/ui/ReviewView.ts` - Card review with rating buttons

### Phase 4: Integration ✅

- [x] Rewrite `src/main.ts` - Register commands, views, clean up sample code
- [x] Implement `styles.css` - Styling for review UI and dashboard

### Phase 5: Polish (In Progress)

- [ ] Test full card lifecycle (create → review → regenerate)
- [ ] Keyboard shortcuts (Space to reveal, rating hotkeys) ✅ (implemented)
- [ ] Error handling and edge cases

---

## File Structure (Implemented)

```
src/
  main.ts                    # Plugin entry, lifecycle, command registration
  types.ts                   # TypeScript interfaces
  settings.ts                # Settings interface, defaults, and settings tab
  flashcards/
    TemplateService.ts       # Nunjucks rendering, variable extraction
    CardService.ts           # Card CRUD operations
    DeckService.ts           # Deck discovery and stats
  srs/
    Scheduler.ts             # FSRS integration
  ui/
    DeckSelectorModal.ts     # Deck/folder picker
    TemplateSelectorModal.ts # Template picker
    CardCreationModal.ts     # Dynamic card creation form
    DashboardView.ts         # Main dashboard view
    ReviewView.ts            # Study mode view
```

---

## Commands Registered

- `Flashcards: Open dashboard` - Opens the main dashboard view
- `Flashcards: Create new card` - Quick card creation flow
- `Flashcards: Start review` - Select deck and start reviewing
- `Flashcards: Regenerate current card` - Regenerate card from template (when viewing a flashcard)

---

## Progress Log

### Session 1 - Foundation & Core Implementation

- Created implementation plan
- Installed ts-fsrs and nunjucks dependencies
- Implemented all core types (FlashcardFrontmatter, ReviewState, Deck, etc.)
- Implemented TemplateService with Nunjucks integration and regex variable extraction
- Implemented CardService for card CRUD and hydration
- Implemented DeckService for deck discovery and stats
- Implemented Scheduler with FSRS integration
- Implemented all UI components (Dashboard, Review, Modals)
- Implemented styles for native Obsidian look
- All TypeScript compiles successfully

### Next Steps

1. Create a sample template in the vault to test
2. Test the full flow: create deck → create card → review → rate
3. Fix any runtime issues discovered during testing
