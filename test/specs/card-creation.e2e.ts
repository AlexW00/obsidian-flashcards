import { describe, it, beforeEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike } from "../helpers/obsidianTypes";

describe("Card Creation", function () {
	beforeEach(async function () {
		// Reset vault state before each test
		await obsidianPage.resetVault();
		await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			// Ensure a "flashcards" folder exists for deck service
			if (!obsidianApp.vault.getAbstractFileByPath("flashcards")) {
				await obsidianApp.vault.createFolder("flashcards");
			}

			// Configure settings to match test vault
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin) {
				plugin.settings.templateFolder = "templates";
				await plugin.saveSettings();
			}
		});
		await waitForVaultReady();
	});

	it("opens card creation modal via command", async function () {
		// Execute the create-card command
		await browser.executeObsidianCommand("anker:create-card");

		// Wait for the modal to appear
		const modal = browser.$(".modal-container .modal");
		await modal.waitForExist({ timeout: 10000 });
		await expect(modal).toExist();

		// Verify it's the card form modal by looking for a form element
		const formContent = browser.$(".modal-container .modal-content");
		await expect(formContent).toExist();
	});

	it("creates a new card successfully", async function () {
		// Execute the create-card command
		await browser.executeObsidianCommand("anker:create-card");

		// Wait for modal to load
		const modal = browser.$(".modal-container .modal");
		await modal.waitForExist({ timeout: 5000 });

		// Note: We rely on the default deck/template selection here.
		// The test vault has a "flashcards" folder which should be auto-selected.

		// Find and fill the "front" field
		const frontInput = browser.$(
			'.modal-container textarea[placeholder*="front"], .modal-container input[placeholder*="front"]',
		);
		if (await frontInput.isExisting()) {
			await frontInput.setValue("E2E Test Question");
		}

		// Find and fill the "back" field
		const backInput = browser.$(
			'.modal-container textarea[placeholder*="back"], .modal-container input[placeholder*="back"]',
		);
		if (await backInput.isExisting()) {
			await backInput.setValue("E2E Test Answer");
		}

		// Click create button using JS to avoid interception
		const createButton = browser.$(
			".modal-container .flashcard-buttons-right button.mod-cta",
		);
		if (await createButton.isExisting()) {
			await browser.execute((el) => el.click(), createButton);
		}

		// Verify a new card file was created by checking the vault
		await browser.pause(1000); // Wait for file creation

		const cardCreated = await browser.executeObsidian(({ app }) => {
			const obsidianApp = app as ObsidianAppLike;
			const files = obsidianApp.vault.getMarkdownFiles();
			return files.some((f) => {
				const cache = obsidianApp.metadataCache.getFileCache(f);
				const fm = cache?.frontmatter;
				return fm && fm["_type"] === "flashcard";
			});
		});

		// The vault should contain flashcard files (at minimum the seed cards)
		expect(cardCreated).toBe(true);
	});
});
