/**
 * Integration tests for TemplateRenderingLogic using fixture files.
 *
 * These tests verify the template parsing, variable extraction, and rendering
 * logic using actual template and flashcard fixtures from resources/example-notes/.
 */
/* eslint-disable import/no-nodejs-modules */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import {
	parseTemplateContent,
	extractVariables,
	findInvalidVariables,
	usesDynamicPipes,
	createNunjucksEnv,
	renderSync,
	buildFileContent,
	orderFrontmatter,
	prepareTemplateForLinePruning,
	cleanupRenderedOutput,
} from "./TemplateRenderingLogic";
import { PROTECTION_COMMENT } from "../types";
import type nunjucks from "nunjucks";

/** Type for parsed template frontmatter in tests */
interface TemplateFrontmatter {
	tags?: string[];
	difficulty?: string;
	audio_enabled?: boolean;
}

/** Type for parsed card frontmatter in tests */
interface CardFrontmatter {
	_type: "flashcard";
	_template: string;
	_review: Record<string, unknown>;
	front?: string;
	back?: string;
	word?: string;
	reading?: string;
	meaning?: string;
	example?: string;
}

/**
 * Get the path to the example-notes directory.
 */
function getFixturePath(...parts: string[]): string {
	// eslint-disable-next-line no-undef
	return join(process.cwd(), "resources", "example-notes", ...parts);
}

/**
 * Load a fixture file as a string.
 */
function loadFixture(...parts: string[]): string {
	return readFileSync(getFixturePath(...parts), "utf-8");
}

describe("TemplateRenderingLogic Integration Tests", () => {
	// Fixtures loaded once before all tests
	let basicTemplate: string;
	let vocabTemplate: string;
	let withFrontmatterTemplate: string;
	let conditionalTemplate: string;
	let basicCard: string;
	let vocabCard: string;
	let nunjucksEnv: nunjucks.Environment;

	beforeAll(() => {
		// Load all fixtures
		basicTemplate = loadFixture("templates", "basic.md");
		vocabTemplate = loadFixture("templates", "vocab.md");
		withFrontmatterTemplate = loadFixture(
			"templates",
			"with-frontmatter.md",
		);
		conditionalTemplate = loadFixture("templates", "conditional.md");
		basicCard = loadFixture("flashcards", "basic-card.md");
		vocabCard = loadFixture("flashcards", "vocab-card.md");

		// Create Nunjucks environment
		nunjucksEnv = createNunjucksEnv();
	});

	describe("parseTemplateContent", () => {
		it("parses basic template with frontmatter", () => {
			const result = parseTemplateContent(basicTemplate);

			expect(result.rawYaml).not.toBeNull();
			expect(result.body).toContain("{{ front }}");
			expect(result.body).toContain("{{ back }}");

			// Parse the YAML to verify structure
			const frontmatter = parseYaml(
				result.rawYaml!,
			) as TemplateFrontmatter;
			expect(frontmatter).toHaveProperty("tags");
		});

		it("parses template with complex frontmatter", () => {
			const result = parseTemplateContent(withFrontmatterTemplate);

			expect(result.rawYaml).not.toBeNull();
			const frontmatter = parseYaml(
				result.rawYaml!,
			) as TemplateFrontmatter;
			expect(frontmatter).toHaveProperty("difficulty", "normal");
			expect(frontmatter).toHaveProperty("audio_enabled", true);
		});

		it("parses vocab template frontmatter", () => {
			const result = parseTemplateContent(vocabTemplate);

			expect(result.rawYaml).not.toBeNull();
			const frontmatter = parseYaml(
				result.rawYaml!,
			) as TemplateFrontmatter;
			expect(frontmatter.tags).toContain("flashcard-template");
			expect(frontmatter.tags).toContain("vocabulary");
		});

		it("handles content without frontmatter", () => {
			const noFrontmatter = "# Just a heading\n\nSome content";
			const result = parseTemplateContent(noFrontmatter);

			expect(result.rawYaml).toBeNull();
			expect(result.body).toBe(noFrontmatter);
		});

		it("handles invalid YAML gracefully in tests", () => {
			// This tests the raw parsing - the TemplateService handles YAML errors
			const invalidYaml = "---\ninvalid: [unclosed\n---\n\nBody content";
			const result = parseTemplateContent(invalidYaml);

			// The pure function just returns raw YAML, caller handles parsing
			expect(result.rawYaml).toBe("invalid: [unclosed");
			expect(result.body).toBe("Body content");
		});
	});

	describe("extractVariables", () => {
		it("extracts variables from basic template body", () => {
			const { body } = parseTemplateContent(basicTemplate);
			const variables = extractVariables(body);

			expect(variables).toHaveLength(2);
			expect(variables.map((v) => v.name)).toContain("front");
			expect(variables.map((v) => v.name)).toContain("back");
		});

		it("extracts variables from vocab template body", () => {
			const { body } = parseTemplateContent(vocabTemplate);
			const variables = extractVariables(body);

			expect(variables).toHaveLength(4);
			const names = variables.map((v) => v.name);
			expect(names).toContain("word");
			expect(names).toContain("reading");
			expect(names).toContain("meaning");
			expect(names).toContain("example");
		});

		it("extracts variables from conditional template", () => {
			const { body } = parseTemplateContent(conditionalTemplate);
			const variables = extractVariables(body);

			const names = variables.map((v) => v.name);
			expect(names).toContain("question");
			expect(names).toContain("answer");
			expect(names).toContain("notes");
			expect(names).toContain("source");
		});

		it("ignores variables inside HTML comments", () => {
			const templateWithComment = `{{ visible }}
<!-- {{ hidden }} -->
{{ another }}`;
			const variables = extractVariables(templateWithComment);

			expect(variables).toHaveLength(2);
			expect(variables.map((v) => v.name)).toContain("visible");
			expect(variables.map((v) => v.name)).toContain("another");
			expect(variables.map((v) => v.name)).not.toContain("hidden");
		});

		it("handles variables with filters", () => {
			const templateWithFilters =
				"{{ name | upper }} and {{ title | trim }}";
			const variables = extractVariables(templateWithFilters);

			expect(variables).toHaveLength(2);
			expect(variables.map((v) => v.name)).toContain("name");
			expect(variables.map((v) => v.name)).toContain("title");
		});

		it("skips built-in Nunjucks variables", () => {
			const templateWithBuiltins =
				"{{ loop.index }} {{ self }} {{ true }}";
			const variables = extractVariables(templateWithBuiltins);

			expect(variables).toHaveLength(0);
		});

		it("deduplicates repeated variables", () => {
			const templateWithDupes =
				"{{ name }} {{ name }} {{ name | upper }}";
			const variables = extractVariables(templateWithDupes);

			expect(variables).toHaveLength(1);
			expect(variables[0]?.name).toBe("name");
		});
	});

	describe("findInvalidVariables", () => {
		it("returns empty array for valid templates", () => {
			const { body } = parseTemplateContent(basicTemplate);
			const invalid = findInvalidVariables(body);

			expect(invalid).toHaveLength(0);
		});

		it("detects hyphenated variable names", () => {
			const templateWithHyphens = "{{ my-variable }} {{ another-one }}";
			const invalid = findInvalidVariables(templateWithHyphens);

			expect(invalid).toHaveLength(2);
			expect(invalid).toContain("my-variable");
			expect(invalid).toContain("another-one");
		});

		it("ignores valid underscored variables", () => {
			const templateWithUnderscores =
				"{{ my_variable }} {{ another_one }}";
			const invalid = findInvalidVariables(templateWithUnderscores);

			expect(invalid).toHaveLength(0);
		});

		it("ignores commented hyphenated variables", () => {
			const templateWithCommentedHyphen =
				"{{ valid }}\n<!-- {{ my-hidden }} -->";
			const invalid = findInvalidVariables(templateWithCommentedHyphen);

			expect(invalid).toHaveLength(0);
		});
	});

	describe("usesDynamicPipes", () => {
		it("returns false for basic template", () => {
			const { body } = parseTemplateContent(basicTemplate);
			expect(usesDynamicPipes(body)).toBe(false);
		});

		it("returns false for vocab template", () => {
			const { body } = parseTemplateContent(vocabTemplate);
			expect(usesDynamicPipes(body)).toBe(false);
		});

		it("detects askAi pipe", () => {
			const templateWithAi = "{{ prompt | askAi }}";
			expect(usesDynamicPipes(templateWithAi)).toBe(true);
		});

		it("detects furigana pipe", () => {
			const templateWithFurigana = "{{ word | furigana }}";
			expect(usesDynamicPipes(templateWithFurigana)).toBe(true);
		});

		it("detects generateImage pipe", () => {
			const templateWithImage = "{{ description | generateImage }}";
			expect(usesDynamicPipes(templateWithImage)).toBe(true);
		});

		it("detects searchImage pipe", () => {
			const templateWithSearch = "{{ query | searchImage }}";
			expect(usesDynamicPipes(templateWithSearch)).toBe(true);
		});

		it("detects generateSpeech pipe", () => {
			const templateWithSpeech = "{{ text | generateSpeech }}";
			expect(usesDynamicPipes(templateWithSpeech)).toBe(true);
		});

		it("ignores dynamic pipes in comments", () => {
			const templateWithComment =
				"{{ normal }}\n<!-- {{ prompt | askAi }} -->";
			expect(usesDynamicPipes(templateWithComment)).toBe(false);
		});
	});

	describe("renderSync", () => {
		it("renders basic template with fields", () => {
			const { body } = parseTemplateContent(basicTemplate);
			const fields = {
				front: "What is the capital of France?",
				back: "Paris",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("What is the capital of France?");
			expect(rendered).toContain("Paris");
			expect(rendered).toContain("---"); // Card separator
		});

		it("renders vocab template with all fields", () => {
			const { body } = parseTemplateContent(vocabTemplate);
			const fields = {
				word: "食べる",
				reading: "たべる",
				meaning: "to eat",
				example: "毎日野菜を食べます。",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("## 食べる");
			expect(rendered).toContain("たべる");
			expect(rendered).toContain("**Meaning:** to eat");
			expect(rendered).toContain("毎日野菜を食べます。");
		});

		it("renders conditional template with notes", () => {
			const { body } = parseTemplateContent(conditionalTemplate);
			const fields = {
				question: "What is 2+2?",
				answer: "4",
				notes: "Basic arithmetic",
				source: "",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("What is 2+2?");
			expect(rendered).toContain("4");
			expect(rendered).toContain("> **Notes:** Basic arithmetic");
			expect(rendered).not.toContain("*Source:");
		});

		it("renders conditional template without notes", () => {
			const { body } = parseTemplateContent(conditionalTemplate);
			const fields = {
				question: "What is 2+2?",
				answer: "4",
				notes: "",
				source: "",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("What is 2+2?");
			expect(rendered).toContain("4");
			expect(rendered).not.toContain("> **Notes:**");
		});

		it("renders conditional template with source only", () => {
			const { body } = parseTemplateContent(conditionalTemplate);
			const fields = {
				question: "Question",
				answer: "Answer",
				notes: "",
				source: "Wikipedia",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("*Source: Wikipedia*");
			expect(rendered).not.toContain("> **Notes:**");
		});

		it("handles empty optional fields gracefully", () => {
			const { body } = parseTemplateContent(vocabTemplate);
			const fields = {
				word: "猫",
				reading: "",
				meaning: "cat",
				example: "",
			};

			const rendered = renderSync(nunjucksEnv, body, fields);

			expect(rendered).toContain("## 猫");
			expect(rendered).toContain("**Meaning:** cat");
			// Empty fields should result in clean output (no extra blank lines)
		});
	});

	describe("prepareTemplateForLinePruning", () => {
		it("marks variable-only lines", () => {
			const template = "Some text\n{{ variable }}\nMore text";
			const result = prepareTemplateForLinePruning(template);

			expect(result).toContain("__ANKER_LINE_START__");
			expect(result).toContain("__ANKER_LINE_END__");
		});

		it("does not mark lines with text and variables", () => {
			const template = "Some {{ variable }} text";
			const result = prepareTemplateForLinePruning(template);

			expect(result).not.toContain("__ANKER_LINE_START__");
			expect(result).not.toContain("__ANKER_LINE_END__");
		});
	});

	describe("cleanupRenderedOutput", () => {
		it("removes line markers", () => {
			const input = "__ANKER_LINE_START__content__ANKER_LINE_END__";
			const result = cleanupRenderedOutput(input);

			expect(result).toBe("content");
		});

		it("collapses multiple blank lines", () => {
			const input = "Line 1\n\n\n\nLine 2";
			const result = cleanupRenderedOutput(input);

			expect(result).toBe("Line 1\n\nLine 2");
		});

		it("removes leading blank lines", () => {
			const input = "\n\n\nContent";
			const result = cleanupRenderedOutput(input);

			expect(result).toBe("Content");
		});

		it("removes trailing blank lines", () => {
			const input = "Content\n\n\n";
			const result = cleanupRenderedOutput(input);

			expect(result).toBe("Content");
		});
	});

	describe("orderFrontmatter", () => {
		it("puts system keys first", () => {
			const frontmatter = {
				word: "test",
				_type: "flashcard",
				meaning: "test meaning",
				_template: "[[template]]",
				_review: { state: 0 },
			};

			const ordered = orderFrontmatter(frontmatter);
			const keys = Object.keys(ordered);

			expect(keys[0]).toBe("_type");
			expect(keys[1]).toBe("_template");
			expect(keys[2]).toBe("_review");
		});

		it("preserves user fields after system keys", () => {
			const frontmatter = {
				alpha: "a",
				_type: "flashcard",
				beta: "b",
			};

			const ordered = orderFrontmatter(frontmatter);
			const keys = Object.keys(ordered);

			expect(keys[0]).toBe("_type");
			expect(keys).toContain("alpha");
			expect(keys).toContain("beta");
		});
	});

	describe("buildFileContent", () => {
		it("builds complete flashcard file content", () => {
			const frontmatter = {
				_type: "flashcard" as const,
				_template: "[[templates/basic]]",
				_review: { state: 0 },
				front: "Question",
				back: "Answer",
			};
			const body = "Question\n\n---\n\nAnswer";

			const content = buildFileContent(frontmatter, body, stringifyYaml);

			expect(content).toContain("---\n");
			expect(content).toContain("_type: flashcard");
			expect(content).toContain("_template:");
			expect(content).toContain(PROTECTION_COMMENT);
			expect(content).toContain("Question\n\n---\n\nAnswer");
		});

		it("includes _cache when present", () => {
			const frontmatter = {
				_type: "flashcard" as const,
				_template: "[[test]]",
				_review: { state: 0 },
				_cache: { hash123: "cached value" },
			};
			const body = "Content";

			const content = buildFileContent(frontmatter, body, stringifyYaml);

			expect(content).toContain("_cache:");
			expect(content).toContain("hash123:");
		});
	});

	describe("Integration: Full Card Rendering Pipeline", () => {
		it("renders a complete basic flashcard matching expected output", () => {
			// Parse the template
			const { body: templateBody } = parseTemplateContent(basicTemplate);

			// Extract expected fields from the fixture card
			const { rawYaml: cardYaml } = parseTemplateContent(basicCard);
			const cardFrontmatter = parseYaml(cardYaml!) as CardFrontmatter;

			// Render with the fields from the card
			const fields = {
				front: cardFrontmatter.front!,
				back: cardFrontmatter.back!,
			};
			const rendered = renderSync(nunjucksEnv, templateBody, fields);

			// The rendered content should match the expected body (after protection comment)
			expect(rendered).toContain(fields.front);
			expect(rendered).toContain(fields.back);
		});

		it("renders a complete vocab flashcard matching expected output", () => {
			// Parse the template
			const { body: templateBody } = parseTemplateContent(vocabTemplate);

			// Extract expected fields from the fixture card
			const { rawYaml: cardYaml } = parseTemplateContent(vocabCard);
			const cardFrontmatter = parseYaml(cardYaml!) as CardFrontmatter;

			// Render with the fields from the card
			const fields = {
				word: cardFrontmatter.word!,
				reading: cardFrontmatter.reading!,
				meaning: cardFrontmatter.meaning!,
				example: cardFrontmatter.example!,
			};
			const rendered = renderSync(nunjucksEnv, templateBody, fields);

			// Verify rendered output contains all expected content
			expect(rendered).toContain("## 食べる");
			expect(rendered).toContain("たべる");
			expect(rendered).toContain("**Meaning:** to eat");
			expect(rendered).toContain("毎日野菜を食べます。");
		});
	});
});
