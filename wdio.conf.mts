import * as path from "path";
import { readFile, mkdir, rm, cp, open, writeFile, stat } from "fs/promises";
import { browser } from "@wdio/globals";
import {
	parseObsidianVersions,
	obsidianBetaAvailable,
} from "wdio-obsidian-service";
import { env } from "process";

// wdio-obsidian-service will download Obsidian versions into this directory
const cacheDir = path.resolve(".obsidian-cache");
const vaultBaseDir = path.resolve("test/vaults/e2e");
const vaultRootDir = path.resolve(".wdio-vaults");
const vaultReadyFile = path.join(vaultRootDir, ".ready");
const vaultLockFile = path.join(vaultRootDir, ".lock");

// Choose Obsidian versions to test
// Default: test on manifest minAppVersion and latest
const manifestPath = path.resolve("manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
	minAppVersion?: string;
};
const minAppVersion = manifest.minAppVersion ?? "1.11.5";
let defaultVersions = `${minAppVersion}/${minAppVersion} latest/latest`;
const includeBeta = env.OBSIDIAN_INCLUDE_BETA === "true";
if (includeBeta && (await obsidianBetaAvailable({ cacheDir }))) {
	defaultVersions += " latest-beta/latest";
}
const desktopVersions = await parseObsidianVersions(
	env.OBSIDIAN_VERSIONS ?? defaultVersions,
	{ cacheDir },
);

const sanitizeVersion = (version: string) =>
	version.replaceAll(".", "_").replaceAll("/", "-");

const buildVaultPath = (appVersion: string, installerVersion: string) =>
	path.join(
		vaultRootDir,
		`e2e-${sanitizeVersion(appVersion)}-${sanitizeVersion(installerVersion)}`,
	);

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const prepareVaults = async () => {
	await mkdir(vaultRootDir, { recursive: true });

	const expectedVaults = desktopVersions.map(
		([appVersion, installerVersion]) =>
			buildVaultPath(appVersion, installerVersion),
	);

	const readyMatches = async () => {
		try {
			const raw = await readFile(vaultReadyFile, "utf8");
			const parsed = JSON.parse(raw) as {
				versions?: Array<[string, string]>;
			};
			const versionsMatch =
				JSON.stringify(parsed.versions ?? []) ===
				JSON.stringify(desktopVersions);
			if (!versionsMatch) return false;

			for (const vaultPath of expectedVaults) {
				await stat(vaultPath);
			}
			return true;
		} catch {
			return false;
		}
	};

	if (await readyMatches()) return;

	let lockHandle = await open(vaultLockFile, "wx").catch(() => null);
	if (!lockHandle) {
		const timeoutAt = Date.now() + 30_000;
		while (Date.now() < timeoutAt) {
			try {
				await stat(vaultReadyFile);
				return;
			} catch {
				// Keep waiting for the other process to finish.
			}
			await delay(200);
		}

		lockHandle = await open(vaultLockFile, "wx").catch(() => null);
		if (!lockHandle) return;
	}

	try {
		await rm(vaultReadyFile, { force: true });
		await Promise.all(
			desktopVersions.map(async ([appVersion, installerVersion]) => {
				const vaultPath = buildVaultPath(appVersion, installerVersion);
				await rm(vaultPath, { recursive: true, force: true });
				await cp(vaultBaseDir, vaultPath, { recursive: true });
			}),
		);
		await writeFile(
			vaultReadyFile,
			JSON.stringify(
				{ versions: desktopVersions, timestamp: new Date().toISOString() },
				null,
				2,
			),
		);
	} finally {
		await lockHandle.close();
		await rm(vaultLockFile, { force: true });
	}
};

await prepareVaults();

if (env.CI) {
	// Print the resolved Obsidian versions to use as the workflow cache key
	console.log("obsidian-cache-key:", JSON.stringify([desktopVersions]));
}

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",

	specs: ["./test/specs/**/*.e2e.ts"],

	// How many instances of Obsidian should be launched in parallel during testing.
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 4),

	capabilities: desktopVersions.map<WebdriverIO.Capabilities>(
		([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			"wdio:obsidianOptions": {
				appVersion,
				installerVersion,
				plugins: ["."],
				vault: buildVaultPath(appVersion, installerVersion),
			},
		}),
	),

	services: ["obsidian"],
	// obsidian reporter wraps spec reporter to show the Obsidian version
	reporters: ["obsidian"],

	mochaOpts: {
		ui: "bdd",
		timeout: 60 * 1000,
		// Retry flaky tests once
		retries: 1,
	},
	waitforInterval: 250,
	waitforTimeout: 5 * 1000,
	logLevel: "warn",

	cacheDir: cacheDir,

	injectGlobals: false, // import describe/expect etc explicitly to make eslint happy

	afterTest: async function (
		test,
		context,
		{ error, result, duration, passed, retries },
	) {
		if (!passed) {
			const timestamp = new Date().toISOString().replace(/:/g, "-");
			const screenshotPath = path.join(
				"errorShots",
				`${sanitizeVersion(test.title)} - ${timestamp}.png`,
			);
			await mkdir("errorShots", { recursive: true });
			await (browser as any).saveScreenshot(screenshotPath);
			console.log(`Saved screenshot: ${screenshotPath}`);
		}
	},
};
