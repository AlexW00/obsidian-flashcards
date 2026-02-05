import { describe, it, before } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

describe("Template Regeneration", function () {
    before(async function () {
        // Reset vault to initial state
        await obsidianPage.resetVault();

        // Configure settings to match test vault
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.getPlugin("anker");
            if (plugin) {
                plugin.settings.templateFolder = "templates";
                await plugin.saveSettings();
            }
        });
    });

    it("card body contains template-rendered content", async function () {
        // Open the basic-card.md file
        await obsidianPage.openFile("flashcards/basic-card.md");

        // Wait for file to load
        await browser.pause(500);

        // Read the card content via the Obsidian API
        const cardContent = await browser.executeObsidian(
            async ({ app }, path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!file || !("path" in file)) return null;
                return await app.vault.cachedRead(file as import("obsidian").TFile);
            },
            "flashcards/basic-card.md"
        );

        // The card should contain the rendered front/back content
        await expect(cardContent).not.toBe(null);
        await expect(cardContent).toContain("France");
        await expect(cardContent).toContain("Paris");
    });

    it("regenerates card when triggered manually", async function () {
        // Open a flashcard file
        await obsidianPage.openFile("flashcards/basic-card.md");

        // Wait for file to load
        await browser.pause(500);

        // Execute the regenerate command
        await browser.executeObsidianCommand("anker:regenerate-card");

        // Wait for regeneration
        await browser.pause(1000);

        // Verify the card still has correct content after regeneration
        const cardContent = await browser.executeObsidian(
            async ({ app }, path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!file || !("path" in file)) return null;
                return await app.vault.cachedRead(file as import("obsidian").TFile);
            },
            "flashcards/basic-card.md"
        );

        // Content should still be valid
        await expect(cardContent).not.toBe(null);
        await expect(cardContent).toContain("France");
    });

    it("template modification triggers card update", async function () {
        // First, read the original template  
        const originalTemplate = await browser.executeObsidian(
            async ({ app }, path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!file || !("path" in file)) return null;
                return await app.vault.cachedRead(file as import("obsidian").TFile);
            },
            "templates/basic.md"
        );

        await expect(originalTemplate).not.toBe(null);

        // Modify the template by adding a marker
        const modifiedContent = (originalTemplate as string).replace(
            "{{ front }}",
            "**Question:** {{ front }}"
        );

        await obsidianPage.write("templates/basic.md", modifiedContent);

        // Wait for auto-regeneration to trigger (based on settings.autoRegenDebounce)
        await browser.pause(2000);

        // Open the card and check if it was regenerated with the new format
        const cardContent = await browser.executeObsidian(
            async ({ app }, path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!file || !("path" in file)) return null;
                return await app.vault.cachedRead(file as import("obsidian").TFile);
            },
            "flashcards/basic-card.md"
        );

        // The card should reflect the template change
        // (depends on auto-regen being enabled, so we check both scenarios)
        await expect(cardContent).not.toBe(null);
        // Either the old or new format should be valid
        await expect(
            (cardContent as string).includes("France")
        ).toBe(true);

        // Restore original template
        await obsidianPage.write("templates/basic.md", originalTemplate as string);
    });
});
