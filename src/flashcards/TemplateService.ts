import { App, TFile, TFolder, parseYaml } from "obsidian";
import nunjucks from "nunjucks";
import type { FlashcardTemplate, TemplateVariable, FuriganaFormat } from "../types";
import { DEFAULT_BASIC_TEMPLATE } from "../types";
import type { AiService, DynamicPipeContext } from "../services/AiService";
import type { FuriganaService } from "../services/FuriganaService";

/**
 * Parsed template content with optional frontmatter.
 */
export interface ParsedTemplate {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

/**
 * Options for template rendering.
 */
export interface RenderOptions {
	/** Skip AI cache and force fresh generation */
	skipCache?: boolean;
	/** Card file path for context (used for attachment saving) */
	cardPath?: string;
	/** Callback for status updates during AI operations */
	onStatusUpdate?: (status: string) => void;
}

/**
 * Service for managing flashcard templates and Nunjucks rendering.
 */
export class TemplateService {
	private app: App;
	private env: nunjucks.Environment;
	private defaultTemplateContent: string;
	private readonly lineStartMarker = "__ANKER_LINE_START__";
	private readonly lineEndMarker = "__ANKER_LINE_END__";
	private aiService: AiService | null = null;
	private furiganaService: FuriganaService | null = null;
	private furiganaFormat: FuriganaFormat = "curly";
	private currentRenderContext: DynamicPipeContext | null = null;

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

		// Register dynamic pipe filters (async filters)
		this.registerAiFilters();
	}

	/**
	 * Set the AI service for AI-powered filters.
	 * Must be called after construction if AI features are enabled.
	 */
	setAiService(aiService: AiService): void {
		this.aiService = aiService;
	}

	/**
	 * Set the Furigana service for Japanese text conversion.
	 * Must be called after construction if Furigana is enabled.
	 */
	setFuriganaService(furiganaService: FuriganaService, format: FuriganaFormat = "curly"): void {
		this.furiganaService = furiganaService;
		this.furiganaFormat = format;
	}

	/**
	 * Update the furigana format setting.
	 */
	setFuriganaFormat(format: FuriganaFormat): void {
		this.furiganaFormat = format;
	}

	/**
	 * Flush pending cache writes and return them.
	 * Called by CardService after render to merge into frontmatter.
	 */
	flushPendingCacheWrites(): Map<string, string> {
		if (!this.aiService) {
			return new Map();
		}
		return this.aiService.flushPendingCacheWrites();
	}

	/**
	 * Clear pending cache writes without flushing (e.g., on render error).
	 */
	clearPendingCacheWrites(): void {
		this.aiService?.clearPendingCacheWrites();
	}

	/**
	 * Register async AI filters with Nunjucks.
	 * These filters call the AI service and are async.
	 */
	private registerAiFilters(): void {
		// askAi filter: {{ prompt | askAi }}
		this.env.addFilter(
			"askAi",
			(
				prompt: string,
				callback: (err: Error | null, result?: string) => void,
			) => {
				const safePrompt = typeof prompt === "string" ? prompt : "";
				if (safePrompt.trim().length === 0) {
					callback(null, "");
					return;
				}
				if (!this.aiService) {
					callback(
						new Error(
							"AI service not configured. Please configure an AI provider in settings.",
						),
					);
					return;
				}
				if (!this.currentRenderContext) {
					callback(new Error("No render context available"));
					return;
				}

				// Notify status update
				this.currentRenderContext.onStatusUpdate?.("Asking AI...");

				this.aiService
					.askAi(safePrompt, this.currentRenderContext)
					.then((result) => callback(null, result))
					.catch((err) =>
						callback(
							err instanceof Error ? err : new Error(String(err)),
						),
					);
			},
			true, // Mark as async filter
		);

		// generateImage filter: {{ prompt | generateImage }}
		this.env.addFilter(
			"generateImage",
			(
				prompt: string,
				callback: (err: Error | null, result?: string) => void,
			) => {
				const safePrompt = typeof prompt === "string" ? prompt : "";
				if (safePrompt.trim().length === 0) {
					callback(null, "");
					return;
				}
				if (!this.aiService) {
					callback(
						new Error(
							"AI service not configured. Please configure an AI provider in settings.",
						),
					);
					return;
				}
				if (!this.currentRenderContext) {
					callback(new Error("No render context available"));
					return;
				}

				// Notify status update
				this.currentRenderContext.onStatusUpdate?.(
					"Generating image...",
				);

				this.aiService
					.generateImageDynamicPipe(
						safePrompt,
						this.currentRenderContext,
					)
					.then((result) => callback(null, result))
					.catch((err) =>
						callback(
							err instanceof Error ? err : new Error(String(err)),
						),
					);
			},
			true, // Mark as async filter
		);

		// generateSpeech filter: {{ text | generateSpeech }}
		this.env.addFilter(
			"generateSpeech",
			(
				text: string,
				callback: (err: Error | null, result?: string) => void,
			) => {
				const safeText = typeof text === "string" ? text : "";
				if (safeText.trim().length === 0) {
					callback(null, "");
					return;
				}
				if (!this.aiService) {
					callback(
						new Error(
							"AI service not configured. Please configure an AI provider in settings.",
						),
					);
					return;
				}
				if (!this.currentRenderContext) {
					callback(new Error("No render context available"));
					return;
				}

				// Notify status update
				this.currentRenderContext.onStatusUpdate?.(
					"Generating speech...",
				);

				this.aiService
					.generateSpeechDynamicPipe(
						safeText,
						this.currentRenderContext,
					)
					.then((result) => callback(null, result))
					.catch((err) =>
						callback(
							err instanceof Error ? err : new Error(String(err)),
						),
					);
			},
			true, // Mark as async filter
		);

		// searchImage filter: {{ query | searchImage }}
		this.env.addFilter(
			"searchImage",
			(
				query: string,
				callback: (err: Error | null, result?: string) => void,
			) => {
				const safeQuery = typeof query === "string" ? query : "";
				if (safeQuery.trim().length === 0) {
					callback(null, "");
					return;
				}
				if (!this.aiService) {
					callback(
						new Error(
							"AI service not configured. Please configure a Pexels provider in settings.",
						),
					);
					return;
				}
				if (!this.currentRenderContext) {
					callback(new Error("No render context available"));
					return;
				}

				// Notify status update
				this.currentRenderContext.onStatusUpdate?.(
					"Searching image...",
				);

				this.aiService
					.searchImageDynamicPipe(
						safeQuery,
						this.currentRenderContext,
					)
					.then((result) => callback(null, result))
					.catch((err) =>
						callback(
							err instanceof Error ? err : new Error(String(err)),
						),
					);
			},
			true, // Mark as async filter
		);

		// furigana filter: {{ text | furigana }}
		this.env.addFilter(
			"furigana",
			(
				text: string,
				callback: (err: Error | null, result?: string) => void,
			) => {
				const safeText = typeof text === "string" ? text : "";
				if (safeText.trim().length === 0) {
					callback(null, "");
					return;
				}
				if (!this.furiganaService) {
					// If furigana service not available, return original text
					callback(null, safeText);
					return;
				}

				// Notify status update
				this.currentRenderContext?.onStatusUpdate?.(
					"Converting to furigana...",
				);

				this.furiganaService
					.convert(safeText, this.furiganaFormat)
					.then((result) => callback(null, result))
					.catch((err) =>
						callback(
							err instanceof Error ? err : new Error(String(err)),
						),
					);
			},
			true, // Mark as async filter
		);
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
		}

		return Array.from(variables.values());
	}

	/**
	 * Find invalid variable names used in the template.
	 * Focuses on simple identifiers that include hyphens (e.g., {{ my-var }}).
	 */
	findInvalidVariables(templateContent: string): string[] {
		const { body } = this.parseTemplateContent(templateContent);
		const contentWithoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
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
	 * Strips frontmatter and HTML comments before testing.
	 */
	usesDynamicPipes(templateContent: string): boolean {
		const { body } = this.parseTemplateContent(templateContent);
		const contentWithoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
		return /\|\s*(askAi|generateImage|generateSpeech|searchImage|furigana)\b/.test(
			contentWithoutComments,
		);
	}

	/**
	 * Render a template with the given fields.
	 * This is now async to support AI-powered filters.
	 */
	async render(
		templateContent: string,
		fields: Record<string, string>,
		options: RenderOptions = {},
	): Promise<string> {
		// Set the render context for AI filters
		this.currentRenderContext = {
			skipCache: options.skipCache ?? false,
			cardPath: options.cardPath,
			onStatusUpdate: options.onStatusUpdate,
		};

		try {
			const prepared =
				this.prepareTemplateForLinePruning(templateContent);

			// Use callback-based renderString for async filter support
			const rendered = await new Promise<string>((resolve, reject) => {
				this.env.renderString(prepared, fields, (err, result) => {
					if (err) {
						reject(err);
					} else {
						resolve(result ?? "");
					}
				});
			});

			return this.cleanupRenderedOutput(rendered);
		} finally {
			// Clear the render context
			this.currentRenderContext = null;
		}
	}

	/**
	 * Synchronous render for templates without AI filters.
	 * Use this when you know the template doesn't use dynamic pipes.
	 */
	renderSync(
		templateContent: string,
		fields: Record<string, string>,
	): string {
		const prepared = this.prepareTemplateForLinePruning(templateContent);
		const rendered = this.env.renderString(prepared, fields);
		return this.cleanupRenderedOutput(rendered);
	}

	/**
	 * Remove lines that only contain empty variables.
	 */
	private prepareTemplateForLinePruning(templateContent: string): string {
		const lines = templateContent.split(/\r?\n/);
		const variableOnlyLine = /^\s*(\{\{[^}]+\}\}\s*)+$/;
		return lines
			.map((line) => {
				if (!variableOnlyLine.test(line)) {
					return line;
				}
				return `${this.lineStartMarker}${line}${this.lineEndMarker}`;
			})
			.join("\n");
	}

	private cleanupRenderedOutput(rendered: string): string {
		const withoutMarkers = rendered
			.replaceAll(this.lineStartMarker, "")
			.replaceAll(this.lineEndMarker, "");
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
