import * as path from "path";
import { readFile } from "fs/promises";
import { parseObsidianVersions, obsidianBetaAvailable } from "wdio-obsidian-service";
import { env } from "process";

// wdio-obsidian-service will download Obsidian versions into this directory
const cacheDir = path.resolve(".obsidian-cache");

// Choose Obsidian versions to test
// Default: test on manifest minAppVersion and latest
const manifestPath = path.resolve("manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    minAppVersion?: string;
};
const minAppVersion = manifest.minAppVersion ?? "1.11.5";
let defaultVersions = `${minAppVersion}/${minAppVersion} latest/latest`;
if (await obsidianBetaAvailable({ cacheDir })) {
    defaultVersions += " latest-beta/latest";
}
const desktopVersions = await parseObsidianVersions(
    env.OBSIDIAN_VERSIONS ?? defaultVersions,
    { cacheDir },
);

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
                vault: "test/vaults/e2e",
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
};
