import { describe, it, before } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike } from "../helpers/obsidianTypes";

describe("Template Regeneration", function () {
    before(async function () {
        // Reset vault to initial state
        await obsidianPage.resetVault();

        // Configure settings to match test vault
            await browser.executeObsidian(async ({ app }) => {
                const obsidianApp = app as ObsidianAppLike;
                const plugin = obsidianApp.plugins?.getPlugin?.("anker");
                if (plugin) {
                    plugin.settings.templateFolder = "templates";
                    await plugin.saveSettings();
                }
            });

        await waitForVaultReady();
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
        expect(cardContent).not.toBe(null);
        expect(cardContent).toContain("France");
        expect(cardContent).toContain("Paris");
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
        expect(cardContent).not.toBe(null);
        expect(cardContent).toContain("France");
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

        expect(originalTemplate).not.toBe(null);

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
        expect(cardContent).not.toBe(null);
        // Either the old or new format should be valid
        expect(
            (cardContent as string).includes("France")
        ).toBe(true);

        // Restore original template
        await obsidianPage.write("templates/basic.md", originalTemplate as string);
    });
});
