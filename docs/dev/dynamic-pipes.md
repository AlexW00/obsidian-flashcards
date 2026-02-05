# Dynamic pipes (high-level)

## Overview

Dynamic pipes enable dynamic content generation inside flashcard templates using Nunjucks filters. The implementation provides four filters:

- **askAi**: Generates text from a prompt.
- **generateImage**: Generates an image from a prompt and inserts an attachment reference.
- **generateSpeech**: Generates speech audio from text and inserts an attachment reference.
- **searchImage**: Searches Pexels for a photo and inserts an attachment reference.

All dynamic pipes are async and run during template rendering.

## Provider configuration

Providers are configured in **Settings → Dynamic pipes**.

### AI Providers

AI providers support text, image, and speech generation:

- Provider type (OpenAI, Anthropic, Google, OpenRouter)
- Text model (for askAi)
- Image model (OpenAI only)
- Speech model + voice (OpenAI only)
- Optional custom base URL

### Image Search Providers

Image search providers support photo search and download:

- Provider type (Pexels)
- API key (free at pexels.com/api)
- Rate limit: 200 requests/hour

Per-pipe provider selection is configured in **Pipe assignments**.

API keys are stored in Obsidian’s SecretStorage (not in the settings file).

Default model IDs are centralized in [src/services/aiModelDefaults.ts](src/services/aiModelDefaults.ts) for easy editing.

## Caching

A cache stores outputs based on a hash of pipe inputs. The cache stores only the rendered text (e.g., `![[image.png]]`), not the binary data.

- Cache hits avoid repeated API calls.
- If a generated attachment is deleted, the cached text may reference a missing file. Users can regenerate with cache disabled to recreate attachments.

Cache invalidation is supported via commands:

- **Regenerate current card (no cache)**
- **Regenerate all cards from template (no cache)**
- **Clear dynamic pipe cache**

## Attachments

Generated media is stored in the configured attachment folder with UUID filenames. The rendered output inserts standard Obsidian links like `![[uuid.png]]` or `![[uuid.mp3]]`.

## Parallel processing

AI calls are queued with bounded concurrency. Bulk regeneration from templates runs in parallel batches to keep the queue utilized and avoid long serial runs.

## Key components

- **AiService**: Provider setup, dynamic pipe execution, parallel queue, attachment saving.
- **PexelsService**: Pexels API integration for image search.
- **AiCacheService**: Hash-based cache persistence.
- **TemplateService**: Registers async Nunjucks filters and renders templates asynchronously.
- **CardService / CardRegenService**: Propagate cache-bypass flags and parallel template regeneration.

## Template usage

Examples:

- `{{ "Explain entropy" | askAi }}`
- `{{ "A neon city at night" | generateImage }}`
- `{{ "Bonjour" | generateSpeech }}`
- `{{ "sunset landscape" | searchImage }}`
