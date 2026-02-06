---
name: e2e-testing
description: Use when working with e2e tests.
---

# End-to-End Testing (E2E)

> **🧠 Continuous Improvement:** If you discover new patterns, common pitfalls, or efficient ways to run/debug tests while working in this domain, please **update this file** to capture that knowledge for future agents.

This project uses **WebdriverIO** with the **`wdio-obsidian-service`** for end-to-end testing. Tests run a real instance of Obsidian with the Anker plugin installed.

## 📂 File Structure

- **Specs**: `test/specs/**/*.e2e.ts` (The actual test files)
- **Vault Fixtures**: `test/vaults/` (Markdown files and assets used during tests)
- **Config**: `wdio.conf.mts`

## 🚀 Running Tests

### Run all tests

This command rebuilds the plugin and runs the full suite against the latest Obsidian version.

```bash
npm run test:e2e:latest
```

### Run a specific test file

You usually need to build the plugin first so the test uses the latest code.

```bash
npm run build && npx wdio run wdio.conf.mts --spec test/specs/card-errors.e2e.ts
```

## 🛠 Common Patterns & Best Practices

### 1. Interacting with Elements (Click Interception)

Standard `.click()` often fails in Obsidian due to custom UI layers or non-standard listeners.
**Problem:** `element not interactable` or click intercepted.
**Solution:** Use JS execution to force the click.

```typescript
const btn = await $(".my-button");
// Avoid: await btn.click();
await browser.execute((el) => el.click(), btn);
```

### 2. Accessing Obsidian API

You can run code inside the Obsidian process using `executeObsidian`.

```typescript
await browser.executeObsidian(async (app) => {
	// This runs inside Obsidian's renderer process
	const file = app.vault.getAbstractFileByPath("flashcards/my-card.md");
	await app.workspace.getLeaf().openFile(file);
});
```

### 3. Running Commands

Always verify the exact Command ID in `src/main.ts`. Anker commands usually start with `anker:`.

```typescript
// Good
await browser.executeObsidianCommand("anker:open-failed-cards");
```

### 4. Waits & Timing

Obsidian is heavily asynchronous (file system, metadata cache, UI animations).

- **Avoid** `browser.pause(5000)` unless absolutely necessary.
- **Prefer** `waitForExist`, `waitForDisplayed`, or `waitUntil`.

**Example: Waiting for a modal**

```typescript
const modal = await $(".modal");
await modal.waitForDisplayed({ timeout: 5000 });
```

### 5. Hidden File Inputs

Some Obsidian modals use hidden file inputs (`display: none`). WebDriverIO cannot interact with them directly.
Use `browser.execute` to temporarily make the input visible before `setValue`.

```typescript
await browser.execute((sel: string) => {
	const input = document.querySelector(sel) as HTMLInputElement | null;
	if (input) input.style.display = "block";
}, ".my-hidden-file-input");

const fileInput = $(".my-hidden-file-input");
await fileInput.setValue(remotePath);
```

### 6. Managing Vault State

Tests share the same vault folder (`test/vaults`). Ensure you clean up or reset state in `beforeEach`.

```typescript
beforeEach(async () => {
	// Reset contents of a file to a known clean state
	await browser.executeObsidian(async (app) => {
		const file = app.vault.getAbstractFileByPath("flashcards/test-card.md");
		await app.vault.modify(file, "Initial clean content");
	});
});
```

### 7. Modal Cleanup Between Tests

If a test opens a modal, ensure it is closed in `afterEach` to avoid stacked modals and timeouts.

```typescript
afterEach(async () => {
	await browser.execute(() => {
		const buttons = document.querySelectorAll(
			".modal-container .modal-close-button",
		);
		buttons.forEach((btn) => (btn as HTMLElement).click());
	});
	await browser.pause(200);
});
```

## ⚠️ Common Pitfalls

- **Command IDs**: Using the visible name (e.g., "Show card errors") instead of the ID (`anker:open-failed-cards`).
- **Metadata Cache**: Creating a file via `app.vault.create` doesn't mean the cache is ready instantly. If your test depends on frontmatter readings immediately after creation, you might hit a race condition.
- **Template Conflicts**: Anki import can show a conflict confirmation modal if templates already exist. Clear the `templates/` folder in `beforeEach` to avoid blocking tests.
- **Modal Stacking**: A test that only opens a modal but never closes it can leave extra modals open and block later tests.
- **Linting**: e2e test files are linted.
    - Don't use `any`.
    - Don't leave unused variables.
    - Ensure promises are `await`ed.
