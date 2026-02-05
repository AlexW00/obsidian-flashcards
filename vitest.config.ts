import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: [
				"src/srs/**/*.ts",
				"src/services/AnkiContentConverter.ts",
				"src/services/AnkiTemplateConverter.ts",
				"src/services/AnkiPackageParser.ts",
			],
			exclude: ["src/**/*.test.ts"],
		},
	},
});
