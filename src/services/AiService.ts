import { App, normalizePath } from "obsidian";
import { generateText, generateImage } from "ai";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { FlashcardsPluginSettings } from "../types";
import type { AiCacheService } from "./AiCacheService";

/**
 * Supported AI provider types.
 */
export type AiProviderType = "openai" | "anthropic" | "google";

/**
 * Configuration for a single AI provider.
 */
export interface AiProviderConfig {
	type: AiProviderType;
	/** Model ID for text generation (e.g., "gpt-4o", "claude-sonnet-4-20250514") */
	textModel?: string;
	/** Model ID for image generation (e.g., "dall-e-3") */
	imageModel?: string;
	/** Model ID for speech generation (e.g., "tts-1") */
	speechModel?: string;
	/** Voice ID for speech generation (e.g., "alloy") */
	speechVoice?: string;
	/** Optional custom base URL */
	baseUrl?: string;
}

/**
 * Context passed to AI pipe filters during rendering.
 */
export interface AiPipeContext {
	/** Skip cache and force fresh generation */
	skipCache: boolean;
	/** Card file path for context (used for attachment saving) */
	cardPath?: string;
}

/**
 * Queue item for parallel AI processing.
 */
interface QueueItem<T> {
	task: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

/**
 * Service for AI-powered template pipes.
 *
 * Provides:
 * - Provider management (OpenAI, Anthropic, Google)
 * - Text generation (askAi pipe)
 * - Image generation (generateImage pipe)
 * - Speech generation (generateSpeech pipe)
 * - Parallel queue with concurrency control
 * - Integration with cache service
 */
export class AiService {
	private app: App;
	private settings: FlashcardsPluginSettings;
	private cacheService: AiCacheService;
	private getApiKey: (provider: AiProviderType) => string | null;

	// Parallel processing queue
	private queue: QueueItem<unknown>[] = [];
	private activeCount = 0;
	private readonly maxConcurrency = 3;

	constructor(
		app: App,
		settings: FlashcardsPluginSettings,
		cacheService: AiCacheService,
		getApiKey: (provider: AiProviderType) => string | null,
	) {
		this.app = app;
		this.settings = settings;
		this.cacheService = cacheService;
		this.getApiKey = getApiKey;
	}

	/**
	 * Update settings reference.
	 */
	updateSettings(settings: FlashcardsPluginSettings): void {
		this.settings = settings;
	}

	/**
	 * Get the provider config for a specific pipe type.
	 */
	private getProviderForPipe(
		pipeType: "askAi" | "generateImage" | "generateSpeech",
	): AiProviderConfig | null {
		const providerId = this.settings.aiPipeProviders?.[pipeType];
		if (!providerId) return null;
		return this.settings.aiProviders?.[providerId] ?? null;
	}

	/**
	 * Create a provider instance based on type and API key.
	 */
	private createProvider(config: AiProviderConfig) {
		const apiKey = this.getApiKey(config.type);
		if (!apiKey) {
			throw new Error(
				`No API key configured for provider: ${config.type}`,
			);
		}

		switch (config.type) {
			case "openai":
				return createOpenAI({
					apiKey,
					baseURL: config.baseUrl,
				});
			case "anthropic":
				return createAnthropic({
					apiKey,
					baseURL: config.baseUrl,
				});
			case "google":
				return createGoogleGenerativeAI({
					apiKey,
					baseURL: config.baseUrl,
				});
			default: {
				const exhaustiveCheck: never = config.type;
				throw new Error(`Unknown provider type: ${exhaustiveCheck as string}`);
			}
		}
	}

	/**
	 * Enqueue a task for parallel processing.
	 */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.queue.push({
				task,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.processQueue();
		});
	}

	/**
	 * Process queued tasks with concurrency control.
	 */
	private processQueue(): void {
		while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
			const item = this.queue.shift()!;
			this.activeCount++;

			item
				.task()
				.then((result) => {
					item.resolve(result);
				})
				.catch((error) => {
					item.reject(error);
				})
				.finally(() => {
					this.activeCount--;
					this.processQueue();
				});
		}
	}

	/**
	 * Generate text using AI (askAi pipe).
	 *
	 * @param prompt The prompt to send to the AI
	 * @param context Pipe context (skipCache, cardPath)
	 * @returns The generated text
	 */
	async askAi(prompt: string, context: AiPipeContext): Promise<string> {
		const pipeType = "askAi" as const;

		// Check cache first (unless skipCache)
		if (!context.skipCache) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				prompt,
			);
			const cached = this.cacheService.get(cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const config = this.getProviderForPipe(pipeType);
		if (!config) {
			throw new Error("No provider configured for askAi pipe");
		}

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = this.createProvider(config);
			const modelId = config.textModel ?? this.getDefaultTextModel(config.type);

			const response = await generateText({
				model: provider(modelId),
				prompt,
			});

			return response.text;
		});

		// Cache the result
		const cacheKey = await this.cacheService.generateKey(pipeType, prompt);
		this.cacheService.set(cacheKey, result, pipeType);

		return result;
	}

	/**
	 * Generate an image using AI (generateImage pipe).
	 *
	 * @param prompt The prompt describing the image
	 * @param context Pipe context (skipCache, cardPath)
	 * @returns Markdown link to the generated image (e.g., "![[image.png]]")
	 */
	async generateImagePipe(
		prompt: string,
		context: AiPipeContext,
	): Promise<string> {
		const pipeType = "generateImage" as const;

		// Check cache first (unless skipCache)
		if (!context.skipCache) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				prompt,
			);
			const cached = this.cacheService.get(cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const config = this.getProviderForPipe(pipeType);
		if (!config) {
			throw new Error("No provider configured for generateImage pipe");
		}

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = this.createProvider(config);
			const modelId = config.imageModel ?? this.getDefaultImageModel(config.type);

			// Only OpenAI supports image generation via AI SDK currently
			if (config.type !== "openai") {
				throw new Error(
					`Image generation not supported for provider: ${config.type}`,
				);
			}

			const openaiProvider = provider as ReturnType<typeof createOpenAI>;
			const response = await generateImage({
				model: openaiProvider.image(modelId),
				prompt,
			});

			// Save the image to attachment folder
			const imageData = response.image.uint8Array;
			const filename = await this.saveAttachment(
				imageData,
				"png",
				context.cardPath,
			);

			return `![[${filename}]]`;
		});

		// Cache the result (stores the markdown link, not the blob)
		const cacheKey = await this.cacheService.generateKey(pipeType, prompt);
		this.cacheService.set(cacheKey, result, pipeType);

		return result;
	}

	/**
	 * Generate speech using AI (generateSpeech pipe).
	 *
	 * @param text The text to convert to speech
	 * @param context Pipe context (skipCache, cardPath)
	 * @returns Markdown link to the generated audio (e.g., "![[audio.mp3]]")
	 */
	async generateSpeechPipe(
		text: string,
		context: AiPipeContext,
	): Promise<string> {
		const pipeType = "generateSpeech" as const;

		// Check cache first (unless skipCache)
		if (!context.skipCache) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				text,
			);
			const cached = this.cacheService.get(cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const config = this.getProviderForPipe(pipeType);
		if (!config) {
			throw new Error("No provider configured for generateSpeech pipe");
		}

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = this.createProvider(config);
			const modelId = config.speechModel ?? this.getDefaultSpeechModel(config.type);
			const voice = config.speechVoice ?? "alloy";

			// Only OpenAI supports speech generation via AI SDK currently
			if (config.type !== "openai") {
				throw new Error(
					`Speech generation not supported for provider: ${config.type}`,
				);
			}

			const openaiProvider = provider as ReturnType<typeof createOpenAI>;
			const response = await generateSpeech({
				model: openaiProvider.speech(modelId),
				text,
				voice,
			});

			// Save the audio to attachment folder
			const audioData = response.audio.uint8Array;
			const filename = await this.saveAttachment(
				audioData,
				"mp3",
				context.cardPath,
			);

			return `![[${filename}]]`;
		});

		// Cache the result (stores the markdown link, not the blob)
		const cacheKey = await this.cacheService.generateKey(pipeType, text);
		this.cacheService.set(cacheKey, result, pipeType);

		return result;
	}

	/**
	 * Save binary data as an attachment file.
	 *
	 * @param data The binary data to save
	 * @param extension File extension (e.g., "png", "mp3")
	 * @param cardPath Optional card path for context
	 * @returns The filename of the saved attachment
	 */
	private async saveAttachment(
		data: Uint8Array,
		extension: string,
		cardPath?: string,
	): Promise<string> {
		const attachmentFolder = this.settings.attachmentFolder || "attachments";

		// Ensure folder exists
		const folderPath = normalizePath(attachmentFolder);
		if (!(await this.app.vault.adapter.exists(folderPath))) {
			await this.app.vault.createFolder(folderPath);
		}

		// Generate UUID filename
		const uuid = crypto.randomUUID();
		const filename = `${uuid}.${extension}`;
		const filePath = normalizePath(`${folderPath}/${filename}`);

		// Save the file
		await this.app.vault.createBinary(filePath, data);

		return filename;
	}

	/**
	 * Get default text model for a provider.
	 */
	private getDefaultTextModel(type: AiProviderType): string {
		switch (type) {
			case "openai":
				return "gpt-4o";
			case "anthropic":
				return "claude-sonnet-4-20250514";
			case "google":
				return "gemini-1.5-flash";
			default:
				return "gpt-4o";
		}
	}

	/**
	 * Get default image model for a provider.
	 */
	private getDefaultImageModel(type: AiProviderType): string {
		switch (type) {
			case "openai":
				return "dall-e-3";
			default:
				return "dall-e-3";
		}
	}

	/**
	 * Get default speech model for a provider.
	 */
	private getDefaultSpeechModel(type: AiProviderType): string {
		switch (type) {
			case "openai":
				return "tts-1";
			default:
				return "tts-1";
		}
	}

	/**
	 * Check if a provider is configured for a pipe type.
	 */
	isProviderConfigured(
		pipeType: "askAi" | "generateImage" | "generateSpeech",
	): boolean {
		const config = this.getProviderForPipe(pipeType);
		return config !== null;
	}

	/**
	 * Get the current queue length.
	 */
	getQueueLength(): number {
		return this.queue.length;
	}

	/**
	 * Get the number of active tasks.
	 */
	getActiveCount(): number {
		return this.activeCount;
	}
}
