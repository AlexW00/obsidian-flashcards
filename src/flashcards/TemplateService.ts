import { App, TFile, TFolder } from "obsidian";
import nunjucks from "nunjucks";
import type { FlashcardTemplate, TemplateVariable } from "../types";

/**
 * Service for managing flashcard templates and Nunjucks rendering.
 */
export class TemplateService {
	private app: App;
	private env: nunjucks.Environment;

	constructor(app: App) {
		this.app = app;
		// Configure Nunjucks with autoescape disabled (we're generating Markdown, not HTML)
		this.env = new nunjucks.Environment(null, {
			autoescape: false,
			trimBlocks: true,
			lstripBlocks: true,
		});
	}

	/**
	 * Extract variable names from a Nunjucks template using regex.
	 * Matches {{ variable }} and {{ variable | filter }} patterns.
	 */
	extractVariables(templateContent: string): TemplateVariable[] {
		const variableRegex =
			/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
		const variables = new Map<string, TemplateVariable>();

		let match;
		while ((match = variableRegex.exec(templateContent)) !== null) {
			const name = match[1];
			if (!name) continue;
			// Skip built-in Nunjucks variables and loop variables
			if (
				!["loop", "super", "self", "true", "false", "none"].includes(
					name,
				)
			) {
				if (!variables.has(name)) {
					variables.set(name, { name });
				}
			}
		}

		return Array.from(variables.values());
	}

	/**
	 * Render a template with the given fields.
	 */
	render(templateContent: string, fields: Record<string, string>): string {
		return this.env.renderString(templateContent, fields);
	}

	/**
	 * Get all template files from the specified folder.
	 */
	async getTemplates(templateFolder: string): Promise<FlashcardTemplate[]> {
		const templates: FlashcardTemplate[] = [];
		const folder = this.app.vault.getAbstractFileByPath(templateFolder);

		if (!(folder instanceof TFolder)) {
			return templates;
		}

		for (const file of folder.children) {
			if (file instanceof TFile && file.extension === "md") {
				const content = await this.app.vault.read(file);
				templates.push({
					path: file.path,
					name: file.basename,
					variables: this.extractVariables(content),
					content,
				});
			}
		}

		return templates;
	}

	/**
	 * Load a template by path.
	 */
	async loadTemplate(
		templatePath: string,
	): Promise<FlashcardTemplate | null> {
		// Handle WikiLink format: [[path]] or [[path|alias]]
		const cleanPath = this.resolveWikiLink(templatePath);

		const file = this.app.vault.getAbstractFileByPath(cleanPath);
		if (!(file instanceof TFile)) {
			// Try adding .md extension
			const fileWithExt = this.app.vault.getAbstractFileByPath(
				cleanPath + ".md",
			);
			if (!(fileWithExt instanceof TFile)) {
				return null;
			}
			const content = await this.app.vault.read(fileWithExt);
			return {
				path: fileWithExt.path,
				name: fileWithExt.basename,
				variables: this.extractVariables(content),
				content,
			};
		}

		const content = await this.app.vault.read(file);
		return {
			path: file.path,
			name: file.basename,
			variables: this.extractVariables(content),
			content,
		};
	}

	/**
	 * Resolve a WikiLink to a clean file path.
	 * Handles [[path]], [[path|alias]], and plain paths.
	 */
	private resolveWikiLink(link: string): string {
		// Remove [[ and ]] if present
		const path = link.replace(/^\[\[|\]\]$/g, "");
		// Remove alias if present (everything after |)
		const parts = path.split("|");
		return (parts[0] ?? path).trim();
	}

	/**
	 * Generate a note name from the template.
	 */
	generateNoteName(template: string): string {
		const now = new Date();
		const date = now.toISOString().split("T")[0] ?? "unknown"; // YYYY-MM-DD
		const timeParts = now.toTimeString().split(" ");
		const time = (timeParts[0] ?? "00-00-00").replace(/:/g, "-"); // HH-MM-SS
		const timestamp = now.getTime().toString();

		return template
			.replace(/\{\{date\}\}/g, date)
			.replace(/\{\{time\}\}/g, time)
			.replace(/\{\{timestamp\}\}/g, timestamp);
	}
}
