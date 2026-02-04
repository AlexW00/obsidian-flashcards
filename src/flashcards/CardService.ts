import { App, TFile, stringifyYaml } from "obsidian";
import type { Flashcard, FlashcardFrontmatter, ReviewState } from "../types";
import { debugLog, PROTECTION_COMMENT } from "../types";
import { TemplateService } from "./TemplateService";
import { createEmptyCard } from "ts-fsrs";

/**
 * Service for creating and managing flashcard files.
 */
export class CardService {
	private app: App;
	private templateService: TemplateService;

	constructor(app: App, templateService: TemplateService) {
		this.app = app;
		this.templateService = templateService;
	}

	/**
	 * Create initial review state for a new card.
	 */
	private createInitialReviewState(): ReviewState {
		const card = createEmptyCard();
		return {
			due: card.due.toISOString(),
			stability: card.stability,
			difficulty: card.difficulty,
			// TODO: Remove when ts-fsrs 6.0 is released
			elapsed_days: card.elapsed_days, // eslint-disable-line @typescript-eslint/no-deprecated
			scheduled_days: card.scheduled_days,
			reps: card.reps,
			lapses: card.lapses,
			state: card.state,
		};
	}

	/**
	 * Create a new flashcard file.
	 */
	async createCard(
		deckPath: string,
		templatePath: string,
		fields: Record<string, string>,
		noteNameTemplate: string,
	): Promise<TFile> {
		// Load template
		const template = await this.templateService.loadTemplate(templatePath);
		if (!template) {
			throw new Error(`Template not found: ${templatePath}`);
		}
		debugLog("create-card: template loaded", {
			path: template.path,
			frontmatterKeys: template.frontmatter
				? Object.keys(template.frontmatter)
				: [],
			bodyLength: template.body.length,
		});

		// Generate note name
		const noteName =
			this.templateService.generateNoteName(noteNameTemplate);
		const filePath = `${deckPath}/${noteName}.md`;

		// Render template body (without frontmatter)
		const body = this.templateService.render(template.body, fields);

		// Create system frontmatter (these always take precedence)
		// User fields are spread at the top level, plugin properties are prefixed with _
		const systemFrontmatter: FlashcardFrontmatter = {
			_type: "flashcard",
			_template: `[[${template.path}]]`,
			_review: this.createInitialReviewState(),
			...fields,
		};

		// Merge template frontmatter with system frontmatter
		// Template frontmatter is the base, system props always overwrite
		const mergedFrontmatter = this.mergeTemplateFrontmatter(
			template.frontmatter,
			systemFrontmatter,
		);
		debugLog("create-card: merged frontmatter keys", {
			keys: Object.keys(mergedFrontmatter),
		});

		// Build file content
		const content = this.buildFileContent(mergedFrontmatter, body);

		// Create file
		const file = await this.app.vault.create(filePath, content);
		return file;
	}

	/**
	 * Merge template frontmatter with system frontmatter.
	 * Template frontmatter provides the base, system props always overwrite.
	 */
	private mergeTemplateFrontmatter(
		templateFrontmatter: Record<string, unknown> | null,
		systemFrontmatter: FlashcardFrontmatter,
		existingFrontmatter?: Record<string, unknown>,
	): Record<string, unknown> {
		const merged: Record<string, unknown> = {
			...(existingFrontmatter ?? {}),
			...(templateFrontmatter ?? {}),
			...systemFrontmatter,
		};

		debugLog("merge-frontmatter: result keys", {
			keys: Object.keys(merged),
		});

		return merged;
	}

	/**
	 * Regenerate a flashcard's body from its template and fields.
	 */
	async regenerateCard(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (fm?._type !== "flashcard") {
			throw new Error("Not a flashcard");
		}

		// Load template
		const template = await this.templateService.loadTemplate(fm._template);
		if (!template) {
			throw new Error(`Template not found: ${fm._template}`);
		}
		debugLog("regenerate-card: template loaded", {
			path: template.path,
			frontmatterKeys: template.frontmatter
				? Object.keys(template.frontmatter)
				: [],
			bodyLength: template.body.length,
		});

		// Extract user fields (all non-underscore prefixed properties)
		const userFields = this.extractUserFields(fm);

		// Build system frontmatter from current card (always takes precedence)
		const systemFrontmatter: FlashcardFrontmatter = {
			_type: "flashcard",
			_template: fm._template,
			_review: fm._review,
			...userFields,
		};

		// Render new body (use template.body which excludes template frontmatter)
		const body = this.templateService.render(template.body, userFields);

		// Merge existing frontmatter + template frontmatter + system overrides
		const mergedFrontmatter = this.mergeTemplateFrontmatter(
			template.frontmatter,
			systemFrontmatter,
			fm as unknown as Record<string, unknown>,
		);
		debugLog("regenerate-card: merged frontmatter keys", {
			keys: Object.keys(mergedFrontmatter),
		});

		// Update file content (write merged frontmatter + new body)
		const newContent = this.buildFileContent(mergedFrontmatter, body);

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Update the review state of a flashcard.
	 */
	async updateReviewState(
		file: TFile,
		reviewState: ReviewState,
	): Promise<void> {
		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (fm?._type !== "flashcard") {
			throw new Error("Not a flashcard");
		}

		// Update frontmatter with new review state
		const updatedFm: FlashcardFrontmatter = {
			...fm,
			_review: reviewState,
		};

		// Extract body (everything after frontmatter)
		const body = this.extractBody(content);
		const newContent = this.buildFileContent({ ...updatedFm }, body);

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Update user fields for a flashcard and regenerate its body.
	 */
	async updateCardFields(
		file: TFile,
		fields: Record<string, string>,
		templatePath?: string,
		deckPath?: string,
	): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (fm?._type !== "flashcard") {
			throw new Error("Not a flashcard");
		}

		const resolvedTemplatePath = templatePath ?? fm._template;

		// Load template
		const template = await this.templateService.loadTemplate(
			resolvedTemplatePath,
		);
		if (!template) {
			throw new Error(`Template not found: ${resolvedTemplatePath}`);
		}

		// Build system frontmatter from current card (always takes precedence)
		const systemFrontmatter: FlashcardFrontmatter = {
			_type: "flashcard",
			_template: `[[${template.path}]]`,
			_review: fm._review,
			...fields,
		};

		// Render new body with updated fields
		const body = this.templateService.render(template.body, fields);

		// Merge existing frontmatter + template frontmatter + system overrides
		const mergedFrontmatter = this.mergeTemplateFrontmatter(
			template.frontmatter,
			systemFrontmatter,
			fm as unknown as Record<string, unknown>,
		);

		const newContent = this.buildFileContent(mergedFrontmatter, body);
		if (deckPath && deckPath !== file.parent?.path) {
			const targetPath = `${deckPath}/${file.basename}.md`;
			await this.app.vault.rename(file, targetPath);
		}
		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Build file content from frontmatter and body.
	 * Accepts Record<string, unknown> to support merged template frontmatter.
	 */
	private buildFileContent(
		frontmatter: Record<string, unknown>,
		body: string,
	): string {
		const yamlContent = stringifyYaml(frontmatter);
		return `---\n${yamlContent}---\n\n${PROTECTION_COMMENT}\n\n${body}`;
	}

	/**
	 * Extract the body from a flashcard file (everything after frontmatter).
	 */
	private extractBody(content: string): string {
		// Find the end of frontmatter
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
		if (!fmMatch) {
			return content;
		}

		let body = content.slice(fmMatch[0].length);

		// Remove protection comment if present
		body = body.replace(
			new RegExp(
				`^\\s*${PROTECTION_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
			),
			"",
		);

		return body.trim();
	}

	/**
	 * Get the card sides (split by ---).
	 * Ignores --- that appear inside HTML comments.
	 */
	getCardSides(content: string): string[] {
		const body = this.extractBody(content);
		// Remove HTML comments before splitting to avoid treating --- inside comments as separators
		const bodyWithoutComments = body.replace(
			/<!--[\s\S]*?-->/g,
			(match) => {
				// Replace comment content with placeholder that preserves line count but has no ---
				return match.replace(/---/g, "___COMMENT_HR___");
			},
		);
		// Split by horizontal rule (---)
		const commentFreeParts = bodyWithoutComments.split(/\n---\n/);
		// Now split the original body at the same positions
		const sides: string[] = [];
		let currentPos = 0;
		for (let i = 0; i < commentFreeParts.length; i++) {
			const part = commentFreeParts[i];
			if (part === undefined) continue;
			const partLength = part.length;
			const originalPart = body.slice(
				currentPos,
				currentPos + partLength,
			);
			sides.push(originalPart);
			// Skip past this part and the separator (\n---\n = 5 chars)
			currentPos += partLength + 5;
		}
		return sides.map((s) => s.trim()).filter((s) => s.length > 0);
	}

	/**
	 * Get card from file.
	 */
	getCard(file: TFile): Flashcard | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		if (fm?._type !== "flashcard") {
			return null;
		}

		return {
			path: file.path,
			frontmatter: fm as FlashcardFrontmatter,
		};
	}

	/**
	 * Extract user fields from frontmatter (all non-underscore prefixed properties).
	 */
	extractUserFields(fm: FlashcardFrontmatter): Record<string, string> {
		const userFields: Record<string, string> = {};
		for (const key of Object.keys(fm)) {
			// Skip plugin properties (underscore prefixed)
			if (key.startsWith("_")) continue;
			// Only include string values
			const value = fm[key];
			if (typeof value === "string") {
				userFields[key] = value;
			}
		}
		return userFields;
	}
}
