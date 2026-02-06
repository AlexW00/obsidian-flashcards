/* eslint-disable import/no-nodejs-modules */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable obsidianmd/no-static-styles-assignment */
import { describe, it, beforeEach, afterEach } from "mocha";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitForVaultReady } from "../helpers/waitForVaultReady";
import type { ObsidianAppLike } from "../helpers/obsidianTypes";
import path from "node:path";
import process from "node:process";

// Path to the example apkg file for testing
const EXAMPLE_APKG_PATH = path.resolve(
	process.cwd(),
	"resources/example-export.apkg",
);

/**
 * Helper to set file on a hidden file input.
 * Makes the input visible temporarily so WebDriverIO can interact with it.
 */
async function setFileOnHiddenInput(
	selector: string,
	remotePath: string,
): Promise<void> {
	// Make the input visible so WebDriverIO can interact with it
	await browser.execute((sel: string) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		if (input) {
			input.style.display = "block";
		}
	}, selector);

	const fileInput = browser.$(selector);
	await fileInput.setValue(remotePath);
}

describe("Anki Import", function () {
	beforeEach(async function () {
		// Close any leftover modals from previous tests
		await browser.execute(() => {
			const closeButtons = document.querySelectorAll(
				".modal-container .modal-close-button",
			);
			closeButtons.forEach((btn) => (btn as HTMLElement).click());
		});
		await browser.pause(200);

		// Reset vault state before each test
		await obsidianPage.resetVault();
		await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;

			// Clear and recreate templates folder to avoid conflicts
			const templateFolder =
				obsidianApp.vault.getAbstractFileByPath("templates");
			if (templateFolder) {
				// Delete all files in templates folder
				const children = (templateFolder as { children?: unknown[] })
					.children;
				if (Array.isArray(children)) {
					for (const child of [...children]) {
						const childObj = child as { path?: string };
						if (childObj.path) {
							const file =
								obsidianApp.vault.getAbstractFileByPath(
									childObj.path,
								);
							if (file) await obsidianApp.vault.delete(file);
						}
					}
				}
			} else {
				await obsidianApp.vault.createFolder("templates");
			}

			// Clear and recreate imported folder
			const importedFolder =
				obsidianApp.vault.getAbstractFileByPath("imported");
			if (importedFolder) {
				// Delete and recreate to clear all contents
				await obsidianApp.vault.delete(importedFolder, true);
			}
			await obsidianApp.vault.createFolder("imported");

			// Configure settings
			const plugin = obsidianApp.plugins?.getPlugin?.("anker");
			if (plugin) {
				plugin.settings.templateFolder = "templates";
				plugin.settings.defaultImportFolder = "imported";
				await plugin.saveSettings();
			}
		});
		await waitForVaultReady();
	});

	afterEach(async function () {
		// Close any open modals to prevent test interference
		await browser.execute(() => {
			const closeButtons = document.querySelectorAll(
				".modal-container .modal-close-button",
			);
			closeButtons.forEach((btn) => (btn as HTMLElement).click());
		});
		// Give modals time to close
		await browser.pause(200);
	});

	it("opens import modal via command", async function () {
		// Execute the import command
		await browser.executeObsidianCommand("anker:import-anki-backup");

		// Wait for the modal to appear
		const modal = browser.$(".modal-container .flashcard-card-modal");
		await modal.waitForExist({ timeout: 10000 });
		await expect(modal).toExist();

		// Verify modal header
		const header = browser.$(".modal-container h2");
		await expect(header).toHaveText("Import Anki backup");
	});

	it("parses apkg file and displays deck list", async function () {
		// Open import modal
		await browser.executeObsidianCommand("anker:import-anki-backup");
		const modal = browser.$(".modal-container .flashcard-card-modal");
		await modal.waitForExist({ timeout: 10000 });

		// Upload the example apkg file
		const remotePath = await browser.uploadFile(EXAMPLE_APKG_PATH);

		// Set file on the hidden input
		await setFileOnHiddenInput(
			".anki-import-file-input-hidden",
			remotePath,
		);

		// Wait for deck items to appear (parsing is async)
		await browser.waitUntil(
			async () => {
				const items = browser.$$(
					".anki-import-deck-list .selectable-list-item",
				);
				const count = await items.length;
				return count >= 2;
			},
			{
				timeout: 20000,
				timeoutMsg: "Deck items did not appear after parsing",
			},
		);

		// Verify decks are displayed - should have at least 2 decks (nested deck, neighbor)
		const deckItems = browser.$$(
			".anki-import-deck-list .selectable-list-item",
		);
		const itemCount = await deckItems.length;
		expect(itemCount).toBeGreaterThanOrEqual(2);
	});

	it("imports selected decks and creates files", async function () {
		// Open import modal
		await browser.executeObsidianCommand("anker:import-anki-backup");
		const modal = browser.$(".modal-container .flashcard-card-modal");
		await modal.waitForExist({ timeout: 10000 });

		// Upload the example apkg file
		const remotePath = await browser.uploadFile(EXAMPLE_APKG_PATH);

		// Set file on the hidden input
		await setFileOnHiddenInput(
			".anki-import-file-input-hidden",
			remotePath,
		);

		// Wait for deck items to appear (parsing is async)
		await browser.waitUntil(
			async () => {
				const items = browser.$$(
					".anki-import-deck-list .selectable-list-item",
				);
				const count = await items.length;
				return count > 0;
			},
			{
				timeout: 20000,
				timeoutMsg: "Deck items did not appear after parsing",
			},
		);

		// Items are selected by default, just wait for Import button to be enabled
		const importBtn = browser.$(".modal-container button.mod-cta");
		await browser.waitUntil(
			async () => {
				const disabled = await importBtn.getAttribute("disabled");
				return disabled === null;
			},
			{
				timeout: 5000,
				timeoutMsg: "Import button did not become enabled",
			},
		);

		// Click the Import button
		await browser.execute((el) => el.click(), await importBtn);

		// Wait for import to complete (modal closes after success)
		await browser.waitUntil(
			async () => {
				const modalExists = await modal.isExisting();
				return !modalExists;
			},
			{
				timeout: 60000,
				timeoutMsg: "Import did not complete within timeout",
			},
		);

		// Verify templates were created
		const templatesExist = await browser.executeObsidian(
			async ({ app }) => {
				const obsidianApp = app as ObsidianAppLike;
				const templateFolder =
					obsidianApp.vault.getAbstractFileByPath("templates");
				if (!templateFolder) return { count: 0, names: [] };

				const children = (templateFolder as { children?: unknown[] })
					.children;
				if (!Array.isArray(children)) return { count: 0, names: [] };

				const templateFiles = children.filter(
					(f: unknown) =>
						f &&
						typeof f === "object" &&
						"extension" in f &&
						(f as { extension: string }).extension === "md",
				);
				return {
					count: templateFiles.length,
					names: templateFiles.map((f: unknown) =>
						f &&
						typeof f === "object" &&
						"name" in f &&
						typeof (f as { name: string }).name === "string"
							? (f as { name: string }).name
							: "",
					),
				};
			},
		);

		expect(templatesExist.count).toBeGreaterThan(0);

		// Verify flashcard files were created in imported folder
		const cardsExist = await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;

			// Recursively find all markdown files in imported folder
			const findMarkdownFiles = (
				folder: unknown,
			): { path: string; name: string }[] => {
				const results: { path: string; name: string }[] = [];
				if (!folder || typeof folder !== "object") return results;

				const children = (folder as { children?: unknown[] }).children;
				if (!Array.isArray(children)) return results;

				for (const child of children) {
					if (!child || typeof child !== "object") continue;

					const childObj = child as unknown as Record<
						string,
						unknown
					>;
					if ("extension" in childObj) {
						const ext = childObj.extension as string;
						const childPath = childObj.path as string;
						const childName = childObj.name as string;
						if (ext === "md") {
							results.push({ path: childPath, name: childName });
						}
					} else if ("children" in childObj) {
						results.push(...findMarkdownFiles(child));
					}
				}
				return results;
			};

			const importedFolder =
				obsidianApp.vault.getAbstractFileByPath("imported");
			const files = findMarkdownFiles(importedFolder);

			return {
				count: files.length,
				paths: files.map((f) => f.path),
			};
		});

		expect(cardsExist.count).toBeGreaterThan(0);
	});

	it("imported cards have correct frontmatter", async function () {
		// Open import modal
		await browser.executeObsidianCommand("anker:import-anki-backup");
		const modal = browser.$(".modal-container .flashcard-card-modal");
		await modal.waitForExist({ timeout: 10000 });

		// Upload and parse file
		const remotePath = await browser.uploadFile(EXAMPLE_APKG_PATH);
		await setFileOnHiddenInput(
			".anki-import-file-input-hidden",
			remotePath,
		);

		// Wait for deck items to appear (parsing is async)
		await browser.waitUntil(
			async () => {
				const items = browser.$$(
					".anki-import-deck-list .selectable-list-item",
				);
				const count = await items.length;
				return count > 0;
			},
			{
				timeout: 20000,
				timeoutMsg: "Deck items did not appear after parsing",
			},
		);

		// Items are selected by default, just wait for Import button to be enabled
		const importBtn2 = browser.$(".modal-container button.mod-cta");
		await browser.waitUntil(
			async () => {
				const disabled = await importBtn2.getAttribute("disabled");
				return disabled === null;
			},
			{
				timeout: 5000,
				timeoutMsg: "Import button did not become enabled",
			},
		);

		// Click the Import button
		await browser.execute((el) => el.click(), await importBtn2);

		// Wait for import to complete
		await browser.waitUntil(async () => !(await modal.isExisting()), {
			timeout: 60000,
		});

		// Find and read a card file to verify frontmatter
		const cardContent = await browser.executeObsidian(async ({ app }) => {
			const obsidianApp = app as ObsidianAppLike;

			// Find first markdown file in imported folder recursively
			const findFirstCard = (folder: unknown): string | null => {
				if (!folder || typeof folder !== "object") return null;

				const children = (folder as { children?: unknown[] }).children;
				if (!Array.isArray(children)) return null;

				for (const child of children) {
					if (!child || typeof child !== "object") continue;

					const childObj = child as unknown as Record<
						string,
						unknown
					>;
					if ("extension" in childObj) {
						const ext = childObj.extension as string;
						const childPath = childObj.path as string;
						if (ext === "md") {
							return childPath;
						}
					} else if ("children" in childObj) {
						const found = findFirstCard(child);
						if (found) return found;
					}
				}
				return null;
			};

			const importedFolder =
				obsidianApp.vault.getAbstractFileByPath("imported");
			const cardPath = findFirstCard(importedFolder);
			if (!cardPath) return null;

			const file = obsidianApp.vault.getAbstractFileByPath(cardPath);
			if (!file) return null;
			const fileObj = file as unknown as Record<string, unknown>;
			if (!("extension" in fileObj)) return null;

			// Read the file content
			const filePath = fileObj.path as string;
			const content = await obsidianApp.vault.adapter.read(filePath);
			return content;
		});

		// Verify we got content
		expect(cardContent).toBeTruthy();
		const content = cardContent as string;

		// Verify frontmatter structure
		expect(content).toContain("_type: flashcard");
		expect(content).toContain("_template:");
		expect(content).toContain("_id:");
	});

	it("displays file name after selection", async function () {
		// Open import modal
		await browser.executeObsidianCommand("anker:import-anki-backup");
		const modal = browser.$(".modal-container .flashcard-card-modal");
		await modal.waitForExist({ timeout: 10000 });

		// Initially should show "No file selected"
		const fileNameDisplay = browser.$(".anki-import-filename");
		await expect(fileNameDisplay).toHaveText("No file selected");

		// Upload file
		const remotePath = await browser.uploadFile(EXAMPLE_APKG_PATH);
		await setFileOnHiddenInput(
			".anki-import-file-input-hidden",
			remotePath,
		);

		// Should now show the filename
		await browser.waitUntil(
			async () => {
				const text = await fileNameDisplay.getText();
				return text.includes("example-export.apkg");
			},
			{ timeout: 5000, timeoutMsg: "File name not displayed" },
		);
	});
});
