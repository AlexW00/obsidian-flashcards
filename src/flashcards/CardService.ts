import { App, TFile, stringifyYaml } from "obsidian";
import type { Flashcard, FlashcardFrontmatter, ReviewState } from "../types";
import { TemplateService } from "./TemplateService";
import { createEmptyCard } from "ts-fsrs";

const PROTECTION_COMMENT =
	"<!-- flashcard-content: DO NOT EDIT BELOW - Generated from template -->";

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
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			elapsed_days: card.elapsed_days,
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

		// Render template content
		const body = this.templateService.render(template.content, fields);

		// Create frontmatter
		const frontmatter: FlashcardFrontmatter = {
			type: "flashcard",
			template: `[[${template.path}]]`,
			fields,
			review: this.createInitialReviewState(),
		};
		frontmatter.dueAt = frontmatter.review.due;

		// Build file content
		const content = this.buildFileContent(frontmatter, body);

		// Create file
		const file = await this.app.vault.create(filePath, content);
		return file;
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

		// Render new body
		const body = this.templateService.render(template.content, fm.fields);

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
			dueAt: reviewState.due,
		};

		// Extract body (everything after frontmatter)
		const body = this.extractBody(content);
		const newContent = this.buildFileContent(updatedFm, body);

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Build file content from frontmatter and body.
	 */
	private buildFileContent(
		frontmatter: FlashcardFrontmatter,
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
	 */
	getCardSides(content: string): string[] {
		const body = this.extractBody(content);
		// Split by horizontal rule (---)
		const sides = body.split(/\n---\n/);
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
