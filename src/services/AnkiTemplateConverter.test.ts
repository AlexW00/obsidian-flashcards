import { describe, it, expect, beforeEach } from "vitest";
import { AnkiTemplateConverter } from "./AnkiTemplateConverter";
import type { AnkiCardTemplate, AnkiField, AnkiModel } from "../types";

type MockModelOverrides = Partial<Omit<AnkiModel, "flds" | "tmpls">> & {
	flds?: Array<Partial<AnkiField>>;
	tmpls?: Array<Partial<AnkiCardTemplate>>;
};

function createField(field: Partial<AnkiField>, ord: number): AnkiField {
	return {
		name: field.name ?? `Field ${ord}`,
		ord: field.ord ?? ord,
		sticky: field.sticky ?? false,
		rtl: field.rtl ?? false,
		font: field.font ?? "Arial",
		size: field.size ?? 20,
	};
}

function createTemplate(
	template: Partial<AnkiCardTemplate>,
	ord: number,
): AnkiCardTemplate {
	return {
		name: template.name ?? `Card ${ord + 1}`,
		qfmt: template.qfmt ?? "",
		afmt: template.afmt ?? "",
		ord: template.ord ?? ord,
		did: template.did ?? null,
		bqfmt: template.bqfmt ?? "",
		bafmt: template.bafmt ?? "",
	};
}

/**
 * Create a minimal mock AnkiModel for testing.
 */
function createMockModel(overrides: MockModelOverrides = {}): AnkiModel {
	const defaultFields = [
		createField({ name: "Front", ord: 0 }, 0),
		createField({ name: "Back", ord: 1 }, 1),
	];
	const defaultTemplates = [
		createTemplate(
			{
				name: "Card 1",
				qfmt: "<div>{{Front}}</div>",
				afmt: '<hr id="answer">{{FrontSide}}<div>{{Back}}</div>',
				ord: 0,
			},
			0,
		),
	];

	const {
		flds: overrideFields,
		tmpls: overrideTemplates,
		...modelOverrides
	} = overrides;

	const model: AnkiModel = {
		id: "123456",
		name: "Basic",
		type: 0,
		flds: defaultFields,
		tmpls: defaultTemplates,
		css: "",
		latexPre: "",
		latexPost: "",
		mod: 0,
		did: 0,
		sortf: 0,
		tags: [],
		...modelOverrides,
	};

	const fldsSource = overrideFields ?? model.flds;
	const tmplsSource = overrideTemplates ?? model.tmpls;

	return {
		...model,
		flds: fldsSource.map((field, index) => createField(field, index)),
		tmpls: tmplsSource.map((template, index) =>
			createTemplate(template, index),
		),
	};
}

describe("AnkiTemplateConverter", () => {
	let converter: AnkiTemplateConverter;

	beforeEach(() => {
		converter = new AnkiTemplateConverter();
	});

	describe("convertModel", () => {
		it("should convert a simple model to templates", () => {
			const model = createMockModel();
			const templates = converter.convertModel(model);

			expect(templates).toHaveLength(1);
			expect(templates[0]!.name).toBe("Basic");
			expect(templates[0]!.modelId).toBe("123456");
			expect(templates[0]!.templateOrd).toBe(0);
		});

		it("should create multiple templates for multi-card models", () => {
			const model = createMockModel({
				name: "Basic (and reversed)",
				tmpls: [
					{
						name: "Card 1",
						qfmt: "{{Front}}",
						afmt: "{{Back}}",
						ord: 0,
					},
					{
						name: "Card 2",
						qfmt: "{{Back}}",
						afmt: "{{Front}}",
						ord: 1,
					},
				],
			});

			const templates = converter.convertModel(model);

			expect(templates).toHaveLength(2);
			expect(templates[0]!.name).toBe("Basic (and reversed) - Card 1");
			expect(templates[1]!.name).toBe("Basic (and reversed) - Card 2");
		});

		it("should extract variables from templates", () => {
			const model = createMockModel();
			const templates = converter.convertModel(model);

			expect(templates[0]!.variables).toContain("Front");
			expect(templates[0]!.variables).toContain("Back");
		});

		it("should apply field name mapping", () => {
			const model = createMockModel();
			const fieldNameMap = new Map([
				["Front", "question"],
				["Back", "answer"],
			]);

			const templates = converter.convertModel(model, fieldNameMap);

			expect(templates[0]!.body).toContain("{{ question }}");
			expect(templates[0]!.body).toContain("{{ answer }}");
			expect(templates[0]!.variables).toContain("question");
			expect(templates[0]!.variables).toContain("answer");
		});
	});

	describe("convertTemplate (transpileToNunjucks)", () => {
		it("should convert simple field reference", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("{{ Front }}");
			expect(templates[0]!.body).toContain("{{ Back }}");
		});

		it("should convert conditional (if field)", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{#Extra}}Has extra: {{Extra}}{{/Extra}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
				flds: [
					{ name: "Front", ord: 0 },
					{ name: "Back", ord: 1 },
					{ name: "Extra", ord: 2 },
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("{% if Extra %}");
			expect(templates[0]!.body).toContain("{% endif %}");
		});

		it("should convert negation (if not field)", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{^Extra}}No extra{{/Extra}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
				flds: [
					{ name: "Front", ord: 0 },
					{ name: "Back", ord: 1 },
					{ name: "Extra", ord: 2 },
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("{% if not Extra %}");
			expect(templates[0]!.body).toContain("{% endif %}");
		});

		it("should handle cloze: prefix", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Cloze",
						qfmt: "{{cloze:Text}}",
						afmt: "{{cloze:Text}}",
						ord: 0,
					},
				],
				flds: [{ name: "Text", ord: 0 }],
			});

			const templates = converter.convertModel(model);
			// cloze: prefix should be stripped, just output the field
			expect(templates[0]!.body).toContain("{{ Text }}");
		});

		it("should handle type: prefix", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Type",
						qfmt: "{{type:Answer}}",
						afmt: "{{Answer}}",
						ord: 0,
					},
				],
				flds: [
					{ name: "Question", ord: 0 },
					{ name: "Answer", ord: 1 },
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("{{ Answer }}");
		});

		it("should replace {{FrontSide}} with front template content", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "<div>{{Front}}</div>",
						afmt: "{{FrontSide}}<div>{{Back}}</div>",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			// FrontSide should be replaced with the front content
			expect(templates[0]!.body).toContain("{{ Front }}");
			expect(templates[0]!.body).toContain("{{ Back }}");
			// Should not contain literal FrontSide
			expect(templates[0]!.body).not.toContain("{{ FrontSide }}");
		});
	});

	describe("tokenizePlaceholders", () => {
		it("should handle triple braces (unescaped HTML)", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{{Front}}}",
						afmt: "{{{Back}}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			// Triple braces should be normalized to double
			expect(templates[0]!.body).toContain("{{ Front }}");
			expect(templates[0]!.body).toContain("{{ Back }}");
		});

		it("should handle malformed triple braces (3 open, 2 close)", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{{Front}}",
						afmt: "{{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			// Malformed triple braces should be normalized
			expect(templates[0]!.body).toContain("{{ Front }}");
		});
	});

	describe("extractVariables", () => {
		it("should extract unique variables", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front}} and {{Front}} again",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			// Should not have duplicates
			const frontCount = templates[0]!.variables.filter(
				(v) => v === "Front",
			).length;
			expect(frontCount).toBe(1);
		});

		it("should skip Nunjucks builtins", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);

			// These should never appear as variables
			expect(templates[0]!.variables).not.toContain("loop");
			expect(templates[0]!.variables).not.toContain("self");
			expect(templates[0]!.variables).not.toContain("true");
			expect(templates[0]!.variables).not.toContain("false");
		});

		it("should skip FrontSide special variable", () => {
			const model = createMockModel();
			const templates = converter.convertModel(model);

			expect(templates[0]!.variables).not.toContain("FrontSide");
		});
	});

	describe("sanitizeTemplateName", () => {
		it("should remove invalid filename characters", () => {
			const model = createMockModel({
				name: "Test: A/B <Card>",
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.name).not.toContain(":");
			expect(templates[0]!.name).not.toContain("/");
			expect(templates[0]!.name).not.toContain("<");
			expect(templates[0]!.name).not.toContain(">");
		});

		it("should collapse multiple dashes", () => {
			const model = createMockModel({
				name: "Test---Card",
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.name).not.toContain("---");
		});

		it("should trim dashes from ends", () => {
			const model = createMockModel({
				name: "-Card Name-",
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.name).not.toMatch(/^-/);
			expect(templates[0]!.name).not.toMatch(/-$/);
		});
	});

	describe("HTML to Markdown conversion", () => {
		it("should convert <hr id=answer> to separator", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front}}",
						afmt: '<hr id="answer">{{Back}}',
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("---");
		});

		it("should strip style tags", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "<style>.card{color:red}</style>{{Front}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).not.toContain("<style>");
			expect(templates[0]!.body).not.toContain("color");
		});

		it("should strip script tags", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "<script>console.log('hi')</script>{{Front}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).not.toContain("<script>");
			expect(templates[0]!.body).not.toContain("console.log");
		});

		it("should strip div classes but keep content", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: '<div class="front">{{Front}}</div>',
						afmt: '<div class="back">{{Back}}</div>',
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).not.toContain("class=");
			expect(templates[0]!.body).toContain("{{ Front }}");
			expect(templates[0]!.body).toContain("{{ Back }}");
		});

		it("should preserve bold and italic", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Test",
						qfmt: "<b>{{Front}}</b>",
						afmt: "<i>{{Back}}</i>",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("**{{ Front }}**");
			expect(templates[0]!.body).toContain("*{{ Back }}*");
		});
	});

	describe("complex templates", () => {
		it("should handle real-world Anki template", () => {
			const model = createMockModel({
				name: "Vocabulary",
				flds: [
					{ name: "Word", ord: 0 },
					{ name: "Meaning", ord: 1 },
					{ name: "Example", ord: 2 },
					{ name: "Audio", ord: 3 },
				],
				tmpls: [
					{
						name: "Recognition",
						qfmt: `
							<div class="word">{{Word}}</div>
							{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}
						`,
						afmt: `
							{{FrontSide}}
							<hr id="answer">
							<div class="meaning">{{Meaning}}</div>
							{{#Example}}<div class="example">{{Example}}</div>{{/Example}}
						`,
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);

			expect(templates[0]!.name).toBe("Vocabulary");
			expect(templates[0]!.body).toContain("{{ Word }}");
			expect(templates[0]!.body).toContain("{{ Meaning }}");
			expect(templates[0]!.body).toContain("{% if Audio %}");
			expect(templates[0]!.body).toContain("{% if Example %}");
			expect(templates[0]!.body).toContain("---");
			expect(templates[0]!.variables).toEqual(
				expect.arrayContaining(["Word", "Meaning", "Example", "Audio"]),
			);
		});

		it("should handle nested conditionals", () => {
			const model = createMockModel({
				flds: [
					{ name: "Front", ord: 0 },
					{ name: "Back", ord: 1 },
					{ name: "Hint", ord: 2 },
				],
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front}}{{#Hint}}<div>Hint: {{Hint}}</div>{{/Hint}}",
						afmt: "{{Back}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);

			expect(templates[0]!.body).toContain("{{ Front }}");
			expect(templates[0]!.body).toContain("{% if Hint %}");
			expect(templates[0]!.body).toContain("{{ Hint }}");
			expect(templates[0]!.body).toContain("{% endif %}");
		});
	});

	describe("edge cases", () => {
		it("should handle empty template", () => {
			const model = createMockModel({
				tmpls: [
					{
						name: "Empty",
						qfmt: "",
						afmt: "",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates).toHaveLength(1);
			expect(templates[0]!.body).toBeDefined();
		});

		it("should handle fields with spaces in names", () => {
			const model = createMockModel({
				flds: [
					{ name: "Front Side", ord: 0 },
					{ name: "Back Side", ord: 1 },
				],
				tmpls: [
					{
						name: "Test",
						qfmt: "{{Front Side}}",
						afmt: "{{Back Side}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.body).toContain("{{ Front Side }}");
		});

		it("should handle unicode in template", () => {
			const model = createMockModel({
				name: "日本語カード",
				flds: [
					{ name: "表", ord: 0 },
					{ name: "裏", ord: 1 },
				],
				tmpls: [
					{
						name: "カード",
						qfmt: "{{表}}",
						afmt: "{{裏}}",
						ord: 0,
					},
				],
			});

			const templates = converter.convertModel(model);
			expect(templates[0]!.name).toContain("日本語カード");
			expect(templates[0]!.body).toContain("{{ 表 }}");
			expect(templates[0]!.body).toContain("{{ 裏 }}");
		});
	});
});
