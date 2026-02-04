import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Result of converting Anki content to Markdown.
 */
export interface ConvertedContent {
	/** The converted Markdown content */
	markdown: string;
	/** Media files referenced in the content (original filename -> will be renamed to UUID) */
	mediaFiles: Set<string>;
}

/**
 * Service for converting Anki HTML content to clean Markdown.
 * Handles media references, cloze deletions, and HTML cleanup.
 */
export class AnkiContentConverter {
	private turndown: TurndownService;

	constructor() {
		this.turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			emDelimiter: "*",
			bulletListMarker: "-",
			listIndentSize: 1,
		} as TurndownService.Options);

		// Add GFM support (tables, strikethrough, task lists)
		this.turndown.use(gfm);

		// Configure rules to strip unwanted elements
		this.configureRules();
	}

	/**
	 * Configure Turndown rules for Anki-specific handling.
	 */
	private configureRules(): void {
		const listIndent = (content: string, indentLength: number): string => {
			const indent = " ".repeat(Math.max(0, indentLength));
			return content
				.replace(/^\n+/, "")
				.replace(/\n+$/, "\n")
				.replace(/\n/gm, `\n${indent}`);
		};

		// Remove style tags completely
		this.turndown.addRule("removeStyle", {
			filter: ["style"],
			replacement: () => "",
		});

		// Remove script tags completely
		this.turndown.addRule("removeScript", {
			filter: ["script"],
			replacement: () => "",
		});

		// Strip class and style attributes from divs/spans but keep content
		this.turndown.addRule("stripDivSpan", {
			filter: (node: HTMLElement): boolean => {
				const tagName = node.nodeName.toLowerCase();
				return tagName === "div" || tagName === "span";
			},
			replacement: (content: string, node: Node): string => {
				const element = node as HTMLElement;
				// Check if it's a block-level div that should have newlines
				if (element.nodeName.toLowerCase() === "div") {
					return content + "\n";
				}
				return content;
			},
		});

		// Handle Anki's [sound:filename.mp3] syntax
		this.turndown.addRule("ankiSound", {
			filter: (node: HTMLElement): boolean => {
				return (
					node.nodeType === 3 &&
					/\[sound:[^\]]+\]/.test(node.textContent ?? "")
				);
			},
			replacement: (content: string): string => {
				return content.replace(
					/\[sound:([^\]]+)\]/g,
					(_match: string, filename: string) => `![[${filename}]]`,
				);
			},
		});

		// Customize list item indentation to avoid extra spaces after bullets
		this.turndown.addRule("listItem", {
			filter: "li",
			replacement: (
				content: string,
				node: HTMLElement,
				options: TurndownService.Options,
			): string => {
				const parent = node.parentNode as HTMLElement | null;
				let marker = options.bulletListMarker ?? "-";
				if (parent?.nodeName === "OL") {
					const start = parent.getAttribute("start");
					const index = Array.prototype.indexOf.call(
						parent.children,
						node,
					);
					marker = `${start ? Number(start) + index : index + 1}.`;
				}

				const listIndentSize =
					typeof (options as { listIndentSize?: number }).listIndentSize ===
						"number"
						? (options as { listIndentSize?: number }).listIndentSize ?? 3
						: 3;
				const space = " ".repeat(
					1 + Math.max(0, listIndentSize - marker.length),
				);
				const prefix = `${marker}${space}`;
				const liContent = listIndent(content, prefix.length);
				const trailNl =
					node.nextSibling && !/\n$/.test(liContent) ? "\n" : "";
				return `${prefix}${liContent}${trailNl}`;
			},
		});
	}

	/**
	 * Convert Anki HTML content to Markdown.
	 * Extracts media references and converts cloze deletions.
	 */
	convert(html: string, mediaMap: Map<string, string>): ConvertedContent {
		const mediaFiles = new Set<string>();

		// Pre-process: Extract and track media files
		let processed = this.processMediaReferences(html, mediaMap, mediaFiles);

		// Pre-process: Handle Anki sound references
		processed = this.processSoundReferences(processed, mediaFiles);

		// Convert HTML to Markdown
		let markdown = this.turndown.turndown(processed);

		// Post-process: Convert cloze deletions to highlights
		markdown = this.convertClozes(markdown);

		// Post-process: Unescape Obsidian embed wiki links
		markdown = this.unescapeWikiEmbeds(markdown);

		// Clean up excessive whitespace
		markdown = this.cleanupWhitespace(markdown);

		return { markdown, mediaFiles };
	}

	/**
	 * Convert a single field value from Anki HTML to Markdown.
	 */
	convertField(
		fieldHtml: string,
		mediaMap: Map<string, string>,
	): ConvertedContent {
		return this.convert(fieldHtml, mediaMap);
	}

	/**
	 * Process image, video, and audio references in HTML.
	 * Updates src attributes to WikiLink format and tracks media files.
	 */
	private processMediaReferences(
		html: string,
		mediaMap: Map<string, string>,
		mediaFiles: Set<string>,
	): string {
		// Match img, video, audio tags and their src attributes
		// Anki stores media with original filenames in src
		const mediaRegex =
			/<(img|video|audio)[^>]*\s+src=["']([^"']+)["'][^>]*>/gi;

		return html.replace(mediaRegex, (match, tag: string, src: string) => {
			// Decode URL-encoded filenames
			const decodedSrc = decodeURIComponent(src);

			// Track the media file
			mediaFiles.add(decodedSrc);

			// Convert to WikiLink format
			const tagLower = tag.toLowerCase();
			if (tagLower === "img") {
				return `![[${decodedSrc}]]`;
			} else {
				// For audio/video, use the same embedding syntax
				return `![[${decodedSrc}]]`;
			}
		});
	}

	/**
	 * Process Anki [sound:filename] references.
	 */
	private processSoundReferences(
		html: string,
		mediaFiles: Set<string>,
	): string {
		return html.replace(/\[sound:([^\]]+)\]/g, (_, filename: string) => {
			mediaFiles.add(filename);
			return `![[${filename}]]`;
		});
	}

	/**
	 * Convert Anki cloze deletions to highlight syntax.
	 * {{c1::answer}} -> ==answer==
	 * {{c1::answer::hint}} -> ==answer== (hint discarded)
	 */
	private convertClozes(markdown: string): string {
		// Match cloze patterns: {{c1::answer}} or {{c1::answer::hint}}
		// The hint part is optional and will be discarded
		const clozeRegex = /\{\{c\d+::([^:}]+)(?:::[^}]*)?\}\}/g;

		return markdown.replace(clozeRegex, (_, answer: string) => {
			return `==${answer.trim()}==`;
		});
	}

	/**
	 * Clean up excessive whitespace from converted Markdown.
	 */
	private cleanupWhitespace(markdown: string): string {
		return (
			markdown
				// Replace multiple blank lines with double newline
				.replace(/\n{3,}/g, "\n\n")
				// Trim leading/trailing whitespace
				.trim()
		);
	}

	/**
	 * Unescape Obsidian embed wiki links like !\[\[file\]\] -> ![[file]].
	 */
	private unescapeWikiEmbeds(markdown: string): string {
		const unescaped = markdown
			.replace(/!\\\[\\\[/g, "![[")
			.replace(/\\\]\\\]/g, "]]");

		return unescaped.replace(/!\[\[([^\]]+)\]\]/g, (match, target) => {
			const cleanedTarget = String(target).replace(/\\_/g, "_");
			return `![[${cleanedTarget}]]`;
		});
	}
}
