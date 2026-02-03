# Refactoring Plan

**Started:** 2026-02-03  
**Status:** ✅ Complete

## Problem Statement

The codebase had grown organically ("vibe coded") with:
- `main.ts` at **888 lines** (4x the 200-300 line guideline)
- `ReviewView.ts` at **481 lines** (borderline)
- Duplicated card creation logic in `main.ts` and `DashboardView.ts`
- Duplicated `extractFlashcardBody` / `extractBody` implementations
- Dead code (`replaceBody` in CardService was unused)
- README.md contained planning doc, not actual documentation
- Many `console.debug` calls with no way to toggle them off

## Refactoring Tasks

### Phase 1: Infrastructure
- [x] Add `DEBUG` flag and `debugLog()` utility to `types.ts`
- [x] Add `PROTECTION_COMMENT` constant to `types.ts`

### Phase 2: Extract from main.ts (888 → 349 lines)
- [x] Create `src/services/CardRegenService.ts` - Combined auto-regeneration + template watching
  - All caching maps (`autoRegenerateTimers`, `frontmatterCache`, `bodyContentCache`, etc.)
  - `handleMetadataChange()` - frontmatter change detection
  - `handleFlashcardBodyChange()` - unauthorized body edit detection  
  - `handleTemplateFileChange()` - template modification watching
  - `regenerateAllCardsFromTemplate()` - bulk regeneration
  - `extractFlashcardBody()` - body extraction utility
  - Status bar management

### Phase 3: Consolidate UI Flows
- [x] Create `src/ui/CardCreationFlow.ts` - Unified card creation
  - Consolidated `showCardCreationModal` from both `main.ts` and `DashboardView.ts`
  - Single source of truth for creation → modal → save flow

### Phase 4: Split ReviewView.ts (481 → 420 lines)
- [x] Create `src/ui/ReviewHotkeys.ts` - Hotkey registration helper
  - Extracted `registerHotkeys()` into standalone function

### Phase 5: Cleanup
- [x] Remove unused `replaceBody()` from `CardService.ts`
- [x] Replace `console.debug` calls with `debugLog()`
- [x] Update imports in all affected files

### Phase 6: Documentation
- [x] Rewrite `README.md` as user documentation

### Phase 7: Verify
- [x] Run `npm run lint` ✅ No errors
- [x] Run `npm run build` ✅ Builds successfully

## Final File Stats

### New Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/services/CardRegenService.ts` | 574 | Auto-regen + template watching |
| `src/ui/CardCreationFlow.ts` | 71 | Unified card creation UI flow |
| `src/ui/ReviewHotkeys.ts` | 100 | Hotkey registration |

### Modified Files
| File | Before | After | Change |
|------|--------|-------|--------|
| `src/main.ts` | 888 | 349 | -539 lines (61% reduction) |
| `src/types.ts` | 226 | 248 | +22 lines (DEBUG, PROTECTION_COMMENT) |
| `src/ui/ReviewView.ts` | 481 | 420 | -61 lines (13% reduction) |
| `src/ui/DashboardView.ts` | 336 | 310 | -26 lines (uses CardCreationFlow) |
| `src/flashcards/CardService.ts` | 294 | 279 | -15 lines (removed dead code, uses shared constant) |
| `README.md` | 150 | 148 | Rewritten as user documentation |

## Summary

- **Total code reduction in main.ts:** 61% (888 → 349 lines)
- **New service layer:** `src/services/` for cross-cutting concerns
- **Eliminated duplication:** Card creation flow now in single location
- **Debug toggle:** `DEBUG` constant for toggling verbose logging
- **Shared constants:** `PROTECTION_COMMENT` now defined once in types.ts
- **Documentation:** README now serves as user documentation
