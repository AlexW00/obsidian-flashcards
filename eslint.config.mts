import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.js", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	{
		files: ["test/specs/**/*.e2e.ts"],
		languageOptions: {
			globals: {
				...globals.mocha,
			},
		},
	},
	...obsidianmd.configs.recommended,
	globalIgnores([
		"node_modules",
		"dist",
		"coverage",
		"esbuild.config.mjs",
		"eslint.config.js",
		"vitest.config.ts",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
