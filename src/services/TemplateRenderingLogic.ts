/**
 * Pure template rendering logic extracted for testability.
 * These functions have no Obsidian dependencies and can be unit tested directly.
 */
import nunjucks from "nunjucks";
import type { TemplateVariable } from "../types";
import { PROTECTION_COMMENT } from "../types";

/**
 * Parsed template content with optional frontmatter.
 */
export interface ParsedTemplate {
	/** Raw YAML frontmatter string (without delimiters), or null if none */
	rawYaml: string | null;
	/** Template body (content after frontmatter) */
	body: string;
}

// Internal markers for line pruning
const LINE_START_MARKER = "__ANKER_LINE_START__";
const LINE_END_MARKER = "__ANKER_LINE_END__";

/**
 * Parse template content to separate frontmatter from body.
 * Returns raw YAML string (for caller to parse) and the body.
 */
export function parseTemplateContent(content: string): ParsedTemplate {
	// Match frontmatter: starts with ---, ends with --- (with optional trailing newline)
	// Handles cases where body may be empty or start immediately after ---
	const fmMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/,
	);
	if (!fmMatch) {
		// No frontmatter, entire content is the body
		return { rawYaml: null, body: content };
	}

	const rawYaml = fmMatch[1] ?? "";
	const body = (fmMatch[2] ?? "").trim();

	return { rawYaml, body };
}

/**
 * Extract variable names from a Nunjucks template body.
 * Matches {{ variable }} and {{ variable | filter }} patterns.
 * Ignores variables inside HTML comments.
 */
export function extractVariables(templateBody: string): TemplateVariable[] {
	// Strip HTML comments before parsing to ignore commented-out examples
	const contentWithoutComments = templateBody.replace(/<!--[\s\S]*?-->/g, "");

	const variableRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
	const variables = new Map<string, TemplateVariable>();

	let match;
	while ((match = variableRegex.exec(contentWithoutComments)) !== null) {
		const name = match[1];
		if (!name) continue;
		// Skip built-in Nunjucks variables and loop variables
		if (
			!["loop", "super", "self", "true", "false", "none"].includes(name)
		) {
			if (!variables.has(name)) {
				variables.set(name, { name });
			}
		}
	}

	return Array.from(variables.values());
}

/**
 * Find invalid variable names used in the template.
 * Focuses on simple identifiers that include hyphens (e.g., {{ my-var }}).
 */
export function findInvalidVariables(templateBody: string): string[] {
	const contentWithoutComments = templateBody.replace(/<!--[\s\S]*?-->/g, "");
	const allVariablePatterns = /\{\{\s*([^{}|]+?)(?:\s*\|[^}]*)?\s*\}\}/g;
	const simpleToken = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
	const builtins = new Set([
		"loop",
		"super",
		"self",
		"true",
		"false",
		"none",
	]);
	const invalid = new Set<string>();

	let match;
	while (
		(match = allVariablePatterns.exec(contentWithoutComments)) !== null
	) {
		const rawName = match[1]?.trim();
		if (!rawName) {
			continue;
		}
		if (builtins.has(rawName)) {
			continue;
		}
		if (!simpleToken.test(rawName)) {
			continue;
		}
		if (rawName.includes("-")) {
			invalid.add(rawName);
		}
	}

	return Array.from(invalid.values());
}

/**
 * Detect whether the template uses any dynamic pipe filters.
 */
export function usesDynamicPipes(templateBody: string): boolean {
	const contentWithoutComments = templateBody.replace(/<!--[\s\S]*?-->/g, "");
	return /\|\s*(askAi|generateImage|generateSpeech|searchImage|furigana)\b/.test(
		contentWithoutComments,
	);
}

/**
 * Create a configured Nunjucks environment for template rendering.
 */
export function createNunjucksEnv(): nunjucks.Environment {
	return new nunjucks.Environment(null, {
		autoescape: false,
		trimBlocks: true,
		lstripBlocks: true,
	});
}

/**
 * Prepare template for line pruning by marking variable-only lines.
 */
export function prepareTemplateForLinePruning(templateContent: string): string {
	const lines = templateContent.split(/\r?\n/);
	const variableOnlyLine = /^\s*(\{\{[^}]+\}\}\s*)+$/;
	return lines
		.map((line) => {
			if (!variableOnlyLine.test(line)) {
				return line;
			}
			return `${LINE_START_MARKER}${line}${LINE_END_MARKER}`;
		})
		.join("\n");
}

/**
 * Clean up rendered output by removing empty lines and markers.
 */
export function cleanupRenderedOutput(rendered: string): string {
	const withoutMarkers = rendered
		.replaceAll(LINE_START_MARKER, "")
		.replaceAll(LINE_END_MARKER, "");
	const lines = withoutMarkers.split(/\r?\n/);
	const cleaned: string[] = [];
	let lastWasBlank = false;
	for (const line of lines) {
		const isBlank = line.trim().length === 0;
		if (isBlank) {
			if (cleaned.length === 0) {
				continue;
			}
			if (lastWasBlank) {
				continue;
			}
			lastWasBlank = true;
			cleaned.push("");
			continue;
		}

		lastWasBlank = false;
		cleaned.push(line);
	}

	// Remove trailing blank lines
	while (cleaned.length > 0) {
		const lastLine = cleaned[cleaned.length - 1] ?? "";
		if (lastLine.trim().length > 0) {
			break;
		}
		cleaned.pop();
	}

	return cleaned.join("\n");
}

/**
 * Synchronous render for templates without AI filters.
 * Use this when you know the template doesn't use dynamic pipes.
 */
export function renderSync(
	env: nunjucks.Environment,
	templateContent: string,
	fields: Record<string, string>,
): string {
	const prepared = prepareTemplateForLinePruning(templateContent);
	const rendered = env.renderString(prepared, fields);
	return cleanupRenderedOutput(rendered);
}

/**
 * Order frontmatter keys with system properties first.
 */
export function orderFrontmatter(
	frontmatter: Record<string, unknown>,
): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	const systemKeys = ["_type", "_template", "_review", "_cache"];

	for (const key of systemKeys) {
		if (key in frontmatter) {
			ordered[key] = frontmatter[key];
		}
	}

	for (const key of Object.keys(frontmatter)) {
		if (systemKeys.includes(key)) {
			continue;
		}
		ordered[key] = frontmatter[key];
	}

	return ordered;
}

/**
 * Build file content from frontmatter and rendered body.
 * Uses the provided stringifyYaml function for YAML serialization.
 */
export function buildFileContent(
	frontmatter: Record<string, unknown>,
	body: string,
	stringifyYaml: (obj: unknown) => string,
): string {
	const orderedFrontmatter = orderFrontmatter(frontmatter);
	const yamlContent = stringifyYaml(orderedFrontmatter);
	return `---\n${yamlContent}---\n\n${PROTECTION_COMMENT}\n\n${body}`;
}
