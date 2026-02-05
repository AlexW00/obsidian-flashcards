# Anki import format (Anki 2.1.50+)

## Supported export

- **Only** Anki 2.1.50+ exports are supported.
- The package must contain **collection.anki21b** (zstd-compressed SQLite).
- Older formats (**collection.anki21**, **collection.anki2**) are not supported.

## Database format (anki21b)

- The SQLite DB is **zstd-compressed** and must be decompressed before opening.
- Schema is **new-style** (no JSON blobs in `col`).

### Key tables used

- `notetypes` — note type definitions (config protobuf)
- `fields` — field names by notetype
- `templates` — card templates by notetype (config protobuf)
- `notes` — note content (fields separated by `\x1f`)
- `cards` — card instances (deck id, template ordinal)
- `decks` — deck names

### Template config (protobuf)

- `templates.config` is a protobuf blob:
    - field 1 = `qfmt` (front / question HTML)
    - field 2 = `afmt` (back / answer HTML)

### Notetype config (protobuf)

- `notetypes.config` contains the note kind:
    - field 1 = kind (`0` = normal, `1` = cloze)

## Media mapping

- `media` file is protobuf (may be zstd-compressed).
- Maps numeric filenames in the ZIP to original media filenames.

## Conversion pipeline summary

1. Load ZIP, ensure `collection.anki21b` exists.
2. Decompress DB (zstd) and open SQLite.
3. Read `notetypes`, `fields`, `templates`, `notes`, `cards`, `decks`.
4. Convert template HTML to Nunjucks markdown.
5. Convert note field HTML to markdown and map media references.
6. Create flashcard files with frontmatter + rendered body.

## Test fixture: example-export.apkg

The file `resources/example-export.apkg` is used for integration testing. It contains a variety of data to exercise the import pipeline.

### Contents

**Decks (2)**

| ID | Name |
|----|------|
| 1 | Default |
| 1770302890374 | Default::nested deck |

**Note Types (3)**

| Name | Type | Fields |
|------|------|--------|
| Basic | Standard (0) | Front, Back |
| Cloze | Cloze (1) | Text, Back Extra |
| Custom | Standard (0) | Front, Back, Comment, Image |

**Notes (3)**

1. **Custom note** — Contains:
   - HTML formatting (`<ul>`, `<b>`, `<br>`)
   - Furigana with ruby annotation
   - Image reference (`<img src="...png">`)
   - Tags: `ddd`, `tag2`

2. **Cloze note** — Contains:
   - Cloze deletion: `{{c1::hidden}}`
   - Back Extra field

3. **Basic note** — Simple text in Front/Back fields

**Cards (3)** — One card per note, linked to respective decks.

**Media (1)**

| Key | Filename |
|-----|----------|
| 0 | 9f1b5b46aed533f5386cf276ab2cdce48cbd2e25.png |

The media file is zstd-compressed in the ZIP and is a PNG image.

### Inspecting the fixture

To manually inspect the apkg contents:

```bash
# Extract the ZIP
unzip resources/example-export.apkg -d /tmp/apkg-explore

# Decompress and open the database
cd /tmp/apkg-explore
zstd -d collection.anki21b -o collection.db
sqlite3 collection.db

# Useful queries
.tables
SELECT id, name FROM decks;
SELECT id, name FROM notetypes;
SELECT ntid, ord, name FROM fields ORDER BY ntid, ord;
SELECT id, mid, tags, flds FROM notes;
```

### Adding test data

When adding new test cases to the fixture:

1. Create content in Anki Desktop (2.1.50+)
2. Export with "Include media" enabled
3. Replace `resources/example-export.apkg`
4. Update this documentation section
5. Update integration tests in `src/services/AnkiImport.integration.test.ts`
