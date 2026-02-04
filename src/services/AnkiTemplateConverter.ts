import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { AnkiModel, AnkiCardTemplate } from "../types";

/**
 * Converted template result.
 */
export interface ConvertedTemplate {
	/** Template name (from Anki model name + template name) */
	name: string;
	/** Nunjucks template body content */
	body: string;
	/** Variable names extracted from the template */
	variables: string[];
	/** Original Anki model ID */
	modelId: string;
	/** Original template ordinal */
	templateOrd: number;
}

/**
 * Service for converting Anki HTML templates to Nunjucks Markdown templates.
 *
 * Conversion pipeline:
 * 1. Tokenize Anki {{Field}} placeholders with safe markers
 * 2. Convert HTML to Markdown via Turndown
 * 3. Restore placeholders and transpile to Nunjucks syntax
 */
export class AnkiTemplateConverter {
	private turndown: TurndownService;
	private placeholderPrefix = "ANKITOKEN";
	private placeholderSuffix = "END";

	constructor() {
		this.turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			emDelimiter: "*",
			bulletListMarker: "-",
		});

		// Add GFM support
		this.turndown.use(gfm);

		// Configure rules
		this.configureRules();
	}

	/**
	 * Configure Turndown rules for template conversion.
	 */
	private configureRules(): void {
		// Remove style tags
		this.turndown.addRule("removeStyle", {
			filter: ["style"],
			replacement: () => "",
		});

		// Remove script tags
		this.turndown.addRule("removeScript", {
			filter: ["script"],
			replacement: () => "",
		});

		// Handle <hr id=answer> (Anki's answer separator)
		this.turndown.addRule("answerSeparator", {
			filter: (node: HTMLElement): boolean => {
				return (
					node.nodeName.toLowerCase() === "hr" && node.id === "answer"
				);
			},
			replacement: () => "\n\n---\n\n",
		});

		// Strip class/style from divs but keep content
		this.turndown.addRule("stripDiv", {
			filter: (node: HTMLElement): boolean => {
				return node.nodeName.toLowerCase() === "div";
			},
			replacement: (content: string): string => {
				return content + "\n";
			},
		});

		// Strip spans but keep content
		this.turndown.addRule("stripSpan", {
			filter: (node: HTMLElement): boolean => {
				return node.nodeName.toLowerCase() === "span";
			},
			replacement: (content: string): string => {
				return content;
			},
		});
	}

	/**
	 * Convert an Anki model to Nunjucks templates.
	 * Creates one template per card template in the model.
	 */
	convertModel(
		model: AnkiModel,
		fieldNameMap?: Map<string, string>,
	): ConvertedTemplate[] {
		const templates: ConvertedTemplate[] = [];

		for (const tmpl of model.tmpls) {
			const converted = this.convertTemplate(model, tmpl, fieldNameMap);
			templates.push(converted);
		}

		return templates;
	}

	/**
	 * Convert a single Anki card template to Nunjucks format.
	 */
	convertTemplate(
		model: AnkiModel,
		tmpl: AnkiCardTemplate,
		fieldNameMap?: Map<string, string>,
	): ConvertedTemplate {
		// Get field names for variable extraction
		const fieldNames = model.flds.map((f) => f.name);

		// Convert front and back templates
		const frontMd = this.convertTemplateHtml(
			tmpl.qfmt,
			fieldNames,
			fieldNameMap,
		);
		const backMd = this.convertTemplateHtml(
			tmpl.afmt,
			fieldNames,
			fieldNameMap,
		);

		// Build combined template body
		// Replace {{FrontSide}} in back with the front content
		const processedBack = backMd.replace(
			/\{\{\s*FrontSide\s*\}\}/gi,
			frontMd.trim(),
		);

		// Combine with separator (--- already in template from <hr id=answer>)
		// If no separator exists in the back, add one
		let body: string;
		if (processedBack.includes("---")) {
			body = processedBack;
		} else {
			body = `${frontMd.trim()}\n\n---\n\n${processedBack.trim()}`;
		}

		// Extract unique variables
		const variables = this.extractVariables(body);

		// Generate template name
		const name =
			model.tmpls.length > 1
				? `${model.name} - ${tmpl.name}`
				: model.name;

		return {
			name: this.sanitizeTemplateName(name),
			body,
			variables,
			modelId: model.id,
			templateOrd: tmpl.ord,
		};
	}

	/**
	 * Convert Anki template HTML to Nunjucks Markdown.
	 */
	private convertTemplateHtml(
		html: string,
		fieldNames: string[],
		fieldNameMap?: Map<string, string>,
	): string {
		// Step 1: Tokenize Anki placeholders with safe markers
		const { tokenized, tokens } = this.tokenizePlaceholders(
			html,
			fieldNames,
		);

		// Step 2: Convert HTML to Markdown
		let markdown = this.turndown.turndown(tokenized);

		// Step 3: Restore and transpile placeholders
		markdown = this.restorePlaceholders(markdown, tokens, fieldNameMap);

		// Clean up
		markdown = this.cleanupWhitespace(markdown);

		return markdown;
	}

	/**
	 * Tokenize Anki template placeholders with safe markers.
	 * This prevents the HTML parser from corrupting them.
	 */
	private tokenizePlaceholders(
		html: string,
		fieldNames: string[],
	): { tokenized: string; tokens: Map<string, string> } {
		const tokens = new Map<string, string>();
		let counter = 0;

		// Pattern matches all Anki template syntax:
		// {{{Field}}} (triple braces for unescaped HTML)
		// {{{Field}} (malformed triple braces - 3 open, 2 close - seen in some Anki exports)
		// {{Field}}, {{#Field}}, {{^Field}}, {{/Field}}, {{FrontSide}}, {{cloze:Field}}
		// Order matters: triple braces (and malformed variants) must match first
		const placeholderRegex = /\{\{\{([^{}]+)\}\}\}|\{\{\{([^{}]+)\}\}|\{\{([#^/])?([^{}]+)\}\}/g;

		const tokenized = html.replace(
			placeholderRegex,
			(
				match,
				tripleContent: string | undefined,
				malformedTripleContent: string | undefined,
				prefix: string | undefined,
				content: string | undefined,
			) => {
				const token = `${this.placeholderPrefix}${counter}${this.placeholderSuffix}`;
				counter++;

				// Store the original match for restoration
				// For triple braces (well-formed or malformed), normalize to double braces
				if (tripleContent !== undefined) {
					// Triple braces {{{Field}}} -> store as normalized double braces
					tokens.set(token, `{{${tripleContent.trim()}}}`);
				} else if (malformedTripleContent !== undefined) {
					// Malformed triple braces {{{Field}} -> store as normalized double braces
					tokens.set(token, `{{${malformedTripleContent.trim()}}}`);
				} else {
					tokens.set(token, match);
				}

				return token;
			},
		);

		return { tokenized, tokens };
	}

	/**
	 * Restore placeholders and transpile to Nunjucks syntax.
	 */
	private restorePlaceholders(
		markdown: string,
		tokens: Map<string, string>,
		fieldNameMap?: Map<string, string>,
	): string {
		let result = markdown;

		for (const [token, original] of tokens) {
			const transpiled = this.transpileToNunjucks(original, fieldNameMap);
			result = result.split(token).join(transpiled);
		}

		return result;
	}

	/**
	 * Transpile Anki template syntax to Nunjucks.
	 *
	 * Mappings:
	 * - {{Field}} -> {{ Field }}
	 * - {{#Field}} -> {% if Field %}
	 * - {{^Field}} -> {% if not Field %}
	 * - {{/Field}} -> {% endif %}
	 * - {{cloze:Field}} -> {{ Field }} (cloze handled in content converter)
	 * - {{FrontSide}} -> {{ FrontSide }} (special, replaced later)
	 */
	private transpileToNunjucks(
		ankiSyntax: string,
		fieldNameMap?: Map<string, string>,
	): string {
		// Extract components
		const match = ankiSyntax.match(/\{\{([#^/])?([^{}]+)\}\}/);
		if (!match) return ankiSyntax;

		const prefix = match[1];
		const content = match[2]?.trim() ?? "";

		// Handle special prefixes
		if (prefix === "#") {
			// Conditional (if field exists/has content)
			return `{% if ${this.mapFieldName(content, fieldNameMap)} %}`;
		} else if (prefix === "^") {
			// Negation (if field doesn't exist/empty)
			return `{% if not ${this.mapFieldName(content, fieldNameMap)} %}`;
		} else if (prefix === "/") {
			// End conditional
			return "{% endif %}";
		}

		// Handle special field types
		if (content.toLowerCase() === "frontside") {
			// Will be replaced with front template content
			return "{{ FrontSide }}";
		}

		// Handle cloze and other filters: cloze:Field, type:Field, etc.
		if (content.includes(":")) {
			const parts = content.split(":");
			const fieldName = parts[parts.length - 1]?.trim() ?? content;
			return `{{ ${this.mapFieldName(fieldName, fieldNameMap)} }}`;
		}

		// Regular field reference
		return `{{ ${this.mapFieldName(content, fieldNameMap)} }}`;
	}

	/**
	 * Map a field name to its normalized identifier.
	 */
	private mapFieldName(
		fieldName: string,
		fieldNameMap?: Map<string, string>,
	): string {
		const trimmed = fieldName.trim();
		return fieldNameMap?.get(trimmed) ?? trimmed;
	}

	/**
	 * Extract unique variable names from a Nunjucks template.
	 */
	private extractVariables(template: string): string[] {
		const variableRegex =
			/\{\{\s*([a-zA-Z_][a-zA-Z0-9_\s]*)\s*(?:\|[^}]*)?\}\}/g;
		const variables = new Set<string>();

		let match;
		while ((match = variableRegex.exec(template)) !== null) {
			const name = match[1]?.trim();
			if (!name) continue;

			// Skip Nunjucks builtins and special values
			const skip = [
				"loop",
				"super",
				"self",
				"true",
				"false",
				"none",
				"FrontSide",
			];
			if (!skip.includes(name)) {
				variables.add(name);
			}
		}

		return Array.from(variables);
	}

	/**
	 * Clean up whitespace in converted template.
	 */
	private cleanupWhitespace(markdown: string): string {
		return (
			markdown
				// Replace multiple blank lines with double newline
				.replace(/\n{3,}/g, "\n\n")
				// Remove trailing whitespace on lines
				.replace(/[ \t]+$/gm, "")
				// Trim
				.trim()
		);
	}

	/**
	 * Sanitize template name for use as filename.
	 */
	private sanitizeTemplateName(name: string): string {
		return (
			name
				// Replace problematic characters
				.replace(/[\\/:*?"<>|]/g, "-")
				// Collapse multiple dashes
				.replace(/-+/g, "-")
				// Trim dashes from ends
				.replace(/^-|-$/g, "")
				.trim()
		);
	}
}
