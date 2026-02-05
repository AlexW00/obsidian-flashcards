import { describe, it, before } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";

describe("Dashboard", function () {
    before(async function () {
        // Reset vault to initial state before tests
        await obsidianPage.resetVault();
        await waitForVaultReady();
    });

    it("plugin loads successfully", async function () {
        // Verify the Anker plugin is loaded
        const isEnabled = await browser.executeObsidian(({ app }) => {
            // Use type assertion for internal plugins API
            const plugins = (app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins;
            const plugin = plugins.getPlugin("anker");
            return plugin !== null && plugin !== undefined;
        });

        expect(isEnabled).toBe(true);
    });

    it("opens dashboard via command", async function () {
        // Execute the open-dashboard command
        await browser.executeObsidianCommand("anker:open-dashboard");

        // Wait for the dashboard view to appear
        const dashboardView = browser.$(".flashcard-dashboard");
        await expect(dashboardView).toExist();
    });

    it("displays deck statistics", async function () {
        // The dashboard should show the flashcards folder as a deck
        const deckItem = browser.$(".flashcard-dashboard .flashcard-deck-item");
        await expect(deckItem).toExist();
    });
});
