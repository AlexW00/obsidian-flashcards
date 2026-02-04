import { App, TFile, TFolder, parseYaml } from "obsidian";
import nunjucks from "nunjucks";
import type { FlashcardTemplate, TemplateVariable } from "../types";
import { DEFAULT_BASIC_TEMPLATE } from "../types";

/**
 * Parsed template content with optional frontmatter.
 */
export interface ParsedTemplate {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

/**
 * Service for managing flashcard templates and Nunjucks rendering.
 */
export class TemplateService {
	private app: App;
	private env: nunjucks.Environment;
	private defaultTemplateContent: string;

	constructor(app: App, defaultTemplateContent?: string) {
		this.app = app;
		this.defaultTemplateContent =
			defaultTemplateContent ?? DEFAULT_BASIC_TEMPLATE;
		// Configure Nunjucks with autoescape disabled (we're generating Markdown, not HTML)
		this.env = new nunjucks.Environment(null, {
			autoescape: false,
			trimBlocks: true,
			lstripBlocks: true,
		});
	}

	/**
	 * Parse template content to separate frontmatter from body.
	 * Returns both the frontmatter (as object) and the body (template content).
	 */
	parseTemplateContent(content: string): ParsedTemplate {
		// Match frontmatter: starts with ---, ends with --- (with optional trailing newline)
		// Handles cases where body may be empty or start immediately after ---
		const fmMatch = content.match(
			/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/,
		);
		if (!fmMatch) {
			console.debug("[Anker] template-parse: no frontmatter found");
			// No frontmatter, entire content is the body
			return { frontmatter: null, body: content };
		}

		const yamlContent = fmMatch[1] ?? "";
		const body = (fmMatch[2] ?? "").trim();

		try {
			const frontmatter = parseYaml(yamlContent) as Record<
				string,
				unknown
			>;
			const keys = frontmatter ? Object.keys(frontmatter) : [];
			console.debug("[Anker] template-parse: frontmatter keys", keys);
			return { frontmatter, body };
		} catch {
			console.debug("[Anker] template-parse: invalid YAML frontmatter");
			// Invalid YAML, treat as no frontmatter
			return { frontmatter: null, body: content };
		}
	}

	/**
	 * Update the default template content (when settings change).
	 */
	setDefaultTemplateContent(content: string): void {
		this.defaultTemplateContent = content;
	}

	/**
	 * Extract variable names from a Nunjucks template using regex.
	 * Matches {{ variable }} and {{ variable | filter }} patterns.
	 * Ignores variables inside HTML comments.
	 * Automatically strips frontmatter before extracting variables.
	 */
	extractVariables(templateContent: string): TemplateVariable[] {
		// Strip frontmatter before extracting variables
		const { body } = this.parseTemplateContent(templateContent);

		// Strip HTML comments before parsing to ignore commented-out examples
		const contentWithoutComments = body.replace(/<!--[\s\S]*?-->/g, "");

		const variableRegex =
			/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
		const fieldsAccessRegex = /_fields\s*\[\s*["']([^"']+)["']\s*\]/g;
		const variables = new Map<string, TemplateVariable>();

		let match;
		while ((match = variableRegex.exec(contentWithoutComments)) !== null) {
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

			while (
				(match = fieldsAccessRegex.exec(contentWithoutComments)) !==
				null
			) {
				const name = match[1];
				if (!name) continue;
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
		return this.env.renderString(templateContent, {
			...fields,
			_fields: fields,
		});
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
				const { frontmatter, body } =
					this.parseTemplateContent(content);
				templates.push({
					path: file.path,
					name: file.basename,
					variables: this.extractVariables(content),
					content,
					body,
					frontmatter,
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
		console.debug("[Anker] template-load: start", templatePath);
		// Handle WikiLink format: [[path]] or [[path|alias]]
		const cleanPath = this.resolveWikiLink(templatePath);

		const file = this.app.vault.getAbstractFileByPath(cleanPath);
		if (!(file instanceof TFile)) {
			// Try adding .md extension
			const fileWithExt = this.app.vault.getAbstractFileByPath(
				cleanPath + ".md",
			);
			if (!(fileWithExt instanceof TFile)) {
				console.debug(
					"[Anker] template-load: file not found",
					templatePath,
				);
				return null;
			}
			const content = await this.app.vault.read(fileWithExt);
			const { frontmatter, body } = this.parseTemplateContent(content);
			console.debug("[Anker] template-load: parsed", {
				path: fileWithExt.path,
				frontmatterKeys: frontmatter ? Object.keys(frontmatter) : [],
				bodyLength: body.length,
			});
			return {
				path: fileWithExt.path,
				name: fileWithExt.basename,
				variables: this.extractVariables(content),
				content,
				body,
				frontmatter,
			};
		}

		const content = await this.app.vault.read(file);
		const { frontmatter, body } = this.parseTemplateContent(content);
		console.debug("[Anker] template-load: parsed", {
			path: file.path,
			frontmatterKeys: frontmatter ? Object.keys(frontmatter) : [],
			bodyLength: body.length,
		});
		return {
			path: file.path,
			name: file.basename,
			variables: this.extractVariables(content),
			content,
			body,
			frontmatter,
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

	/**
	 * Ensure the template folder exists and contains at least a Basic template.
	 * Creates the folder and Basic template if they don't exist.
	 */
	async ensureDefaultTemplate(templateFolder: string): Promise<void> {
		// Check if folder exists
		let folder = this.app.vault.getAbstractFileByPath(templateFolder);

		// Create folder if it doesn't exist
		if (!folder) {
			try {
				await this.app.vault.createFolder(templateFolder);
			} catch {
				// Folder may already exist on disk but not indexed yet
			}
			folder = this.app.vault.getAbstractFileByPath(templateFolder);
		}

		if (!(folder instanceof TFolder)) {
			return;
		}

		// Check if folder has any template files
		const hasTemplates = folder.children.some(
			(file) => file instanceof TFile && file.extension === "md",
		);

		if (!hasTemplates) {
			await this.createBasicTemplate(templateFolder);
		}
	}

	/**
	 * Create a new template with the given name using the basic template as a starter.
	 * Returns the path to the created template file.
	 */
	async createTemplate(
		templateFolder: string,
		name: string,
	): Promise<string> {
		// Ensure folder exists
		let folder = this.app.vault.getAbstractFileByPath(templateFolder);
		if (!folder) {
			try {
				await this.app.vault.createFolder(templateFolder);
			} catch {
				// Folder may already exist on disk but not indexed yet
			}
		}

		const templatePath = `${templateFolder}/${name}.md`;

		// Check if template already exists
		const existing = this.app.vault.getAbstractFileByPath(templatePath);
		if (existing) {
			throw new Error(`A template named "${name}" already exists.`);
		}

		await this.app.vault.create(templatePath, this.defaultTemplateContent);
		return templatePath;
	}

	/**
	 * Create the default Basic template with usage tips.
	 */
	private async createBasicTemplate(templateFolder: string): Promise<void> {
		const basicTemplatePath = `${templateFolder}/Basic.md`;
		await this.app.vault.create(
			basicTemplatePath,
			this.defaultTemplateContent,
		);
	}
}
