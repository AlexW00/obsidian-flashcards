import { App, TFile, stringifyYaml } from "obsidian";
import type { Flashcard, FlashcardFrontmatter, ReviewState } from "../types";
import { TemplateService } from "./TemplateService";
import { createEmptyCard } from "ts-fsrs";

const PROTECTION_COMMENT =
	"<!-- flashcard-content: DO NOT EDIT BELOW - Edit the frontmatter above instead! -->";

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

		// Generate note name
		const noteName =
			this.templateService.generateNoteName(noteNameTemplate);
		const filePath = `${deckPath}/${noteName}.md`;

		// Render template body (without frontmatter)
		const body = this.templateService.render(template.body, fields);

		// Create system frontmatter (these always take precedence)
		const systemFrontmatter: FlashcardFrontmatter = {
			type: "flashcard",
			template: `[[${template.path}]]`,
			fields,
			review: this.createInitialReviewState(),
		};

		// Merge template frontmatter with system frontmatter
		// Template frontmatter is the base, system props always overwrite
		const mergedFrontmatter = this.mergeTemplateFrontmatter(
			template.frontmatter,
			systemFrontmatter,
		);

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
	): Record<string, unknown> {
		if (!templateFrontmatter) {
			return { ...systemFrontmatter };
		}

		// Start with template frontmatter as base
		const merged: Record<string, unknown> = { ...templateFrontmatter };

		// System properties always overwrite template properties
		merged.type = systemFrontmatter.type;
		merged.template = systemFrontmatter.template;
		merged.fields = systemFrontmatter.fields;
		merged.review = systemFrontmatter.review;

		return merged;
	}

	/**
	 * Regenerate a flashcard's body from its template and fields.
	 */
	async regenerateCard(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as FlashcardFrontmatter | undefined;

		if (fm?.type !== "flashcard") {
			throw new Error("Not a flashcard");
		}

		// Load template
		const template = await this.templateService.loadTemplate(fm.template);
		if (!template) {
			throw new Error(`Template not found: ${fm.template}`);
		}

		// Render new body (use template.body which excludes template frontmatter)
		const body = this.templateService.render(template.body, fm.fields);

		// Update file content (preserve frontmatter, replace body)
		const content = await this.app.vault.read(file);
		const newContent = this.replaceBody(content, body);

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

		if (fm?.type !== "flashcard") {
			throw new Error("Not a flashcard");
		}

		// Update frontmatter with new review state
		const updatedFm: FlashcardFrontmatter = {
			...fm,
			review: reviewState,
		};

		// Extract body (everything after frontmatter)
		const body = this.extractBody(content);
		const newContent = this.buildFileContent({ ...updatedFm }, body);

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
	 * Replace the body of a flashcard file while preserving frontmatter.
	 */
	private replaceBody(content: string, newBody: string): string {
		// Find the end of frontmatter
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
		if (!fmMatch) {
			throw new Error("Invalid flashcard format: missing frontmatter");
		}

		return `${fmMatch[0]}\n${PROTECTION_COMMENT}\n\n${newBody}`;
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

		if (fm?.type !== "flashcard") {
			return null;
		}

		return {
			path: file.path,
			frontmatter: fm as FlashcardFrontmatter,
		};
	}
}
