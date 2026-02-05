import { browser } from "@wdio/globals";

export const waitForVaultReady = async () => {
	await browser.waitUntil(
		async () => {
			return await browser.executeObsidian(({ app }) => {
				const files = app.vault.getMarkdownFiles();
				if (files.length === 0) return false;

				const plugin = (app as any).plugins?.getPlugin?.("anker");
				if (!plugin) return false;

				return files.every((file) =>
					Boolean(app.metadataCache.getFileCache(file)),
				);
			});
		},
		{
			timeout: 15000,
			interval: 500,
			timeoutMsg: "Vault files or metadata not ready",
		},
	);
};
