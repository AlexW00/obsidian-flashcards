import { App, normalizePath, requestUrl } from "obsidian";
import { generateText, generateImage } from "ai";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProviderConfig, FlashcardsPluginSettings } from "../types";
import { debugLog } from "../types";
import type { AiCacheService } from "./AiCacheService";
import {
	getDefaultImageModel,
	getDefaultSpeechModel,
	getDefaultTextModel,
} from "./aiModelDefaults";

/**
 * Custom fetch wrapper using Obsidian's requestUrl to bypass CORS restrictions.
 * This is necessary because Obsidian runs in an Electron environment where
 * direct fetch calls to external APIs are blocked by CORS policy.
 */
async function obsidianFetch(
	url: RequestInfo | URL,
	options?: RequestInit,
): Promise<Response> {
	const isSharedArrayBuffer = (value: unknown): value is SharedArrayBuffer =>
		typeof SharedArrayBuffer !== "undefined" &&
		value instanceof SharedArrayBuffer;

	const urlString =
		typeof url === "string"
			? url
			: url instanceof URL
				? url.toString()
				: url.url;
	const method = options?.method ?? "GET";

	// Convert headers to Record<string, string> format
	// Headers can be: Headers object, array of tuples, or plain object
	let headers: Record<string, string> | undefined;
	if (options?.headers) {
		if (options.headers instanceof Headers) {
			headers = {};
			options.headers.forEach((value, key) => {
				headers![key] = value;
			});
		} else if (Array.isArray(options.headers)) {
			headers = {};
			for (const [key, value] of options.headers) {
				headers[key] = value;
			}
		} else {
			headers = { ...options.headers };
		}
	}

	// Parse body - handle string, ArrayBuffer, or other types
	let body: string | ArrayBuffer | undefined;
	if (options?.body) {
		if (typeof options.body === "string") {
			body = options.body;
		} else if (options.body instanceof ArrayBuffer) {
			body = options.body;
		} else if (isSharedArrayBuffer(options.body)) {
			const sharedBuffer = options.body as unknown as SharedArrayBuffer;
			const copy = new Uint8Array(sharedBuffer.byteLength);
			copy.set(new Uint8Array(sharedBuffer));
			body = copy.buffer;
		} else if (options.body instanceof Uint8Array) {
			body = new Uint8Array(options.body).buffer;
		} else if (options.body instanceof Blob) {
			body = await options.body.arrayBuffer();
		} else if (options.body instanceof URLSearchParams) {
			body = options.body.toString();
		} else {
			throw new Error("Unsupported request body type in obsidianFetch");
		}
	}

	const response = await requestUrl({
		url: urlString,
		method,
		headers,
		body,
		throw: false, // Don't throw on non-2xx, let us handle it
	});

	// Convert Obsidian response to standard Response
	// Use arrayBuffer for binary compatibility (works for both text and binary)
	return new Response(response.arrayBuffer, {
		status: response.status,
		headers: new Headers(response.headers),
	});
}

/**
 * Context passed to dynamic pipe filters during rendering.
 */
export interface DynamicPipeContext {
	/** Skip cache and force fresh generation */
	skipCache: boolean;
	/** Card file path for context (used for attachment saving) */
	cardPath?: string;
	/** Callback for status updates during AI operations */
	onStatusUpdate?: (status: string) => void;
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
 * Service for AI-powered template dynamic pipes.
 *
 * Provides:
 * - Provider management (OpenAI, Anthropic, Google)
 * - Text generation (askAi dynamic pipe)
 * - Image generation (generateImage dynamic pipe)
 * - Speech generation (generateSpeech dynamic pipe)
 * - Parallel queue with concurrency control
 * - Integration with cache service
 */
export class AiService {
	private app: App;
	private settings: FlashcardsPluginSettings;
	private cacheService: AiCacheService;
	private getApiKey: (providerId: string) => Promise<string | null>;

	// Parallel processing queue
	private queue: QueueItem<unknown>[] = [];
	private activeCount = 0;
	private readonly maxConcurrency = 3;

	constructor(
		app: App,
		settings: FlashcardsPluginSettings,
		cacheService: AiCacheService,
		getApiKey: (providerId: string) => Promise<string | null>,
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
	 * Flush pending cache writes and return them.
	 * Called by CardService after render to merge into frontmatter.
	 */
	flushPendingCacheWrites(): Map<
		string,
		{ output: string; cachedAt: number }
	> {
		return this.cacheService.flushPendingWrites();
	}

	/**
	 * Clear pending cache writes without flushing (e.g., on render error).
	 */
	clearPendingCacheWrites(): void {
		this.cacheService.clearPendingWrites();
	}

	/**
	 * Get the provider config for a specific dynamic pipe type.
	 */
	private getProviderForDynamicPipe(
		pipeType: "askAi" | "generateImage" | "generateSpeech",
	): { id: string; config: AiProviderConfig } | null {
		const settings = this.settings as unknown as {
			dynamicPipeProviders?: Record<string, string | undefined>;
			aiProviders?: Record<string, AiProviderConfig>;
		};
		const providerId = settings.dynamicPipeProviders?.[pipeType];
		if (!providerId) {
			debugLog("Dynamic pipe %s: no provider assigned", pipeType);
			return null;
		}
		const config = settings.aiProviders?.[providerId] ?? null;
		debugLog(
			"Dynamic pipe %s: providerId=%s type=%s",
			pipeType,
			providerId,
			config?.type ?? "missing",
		);
		if (!config) {
			return null;
		}
		return { id: providerId, config };
	}

	/**
	 * Create a provider instance based on type and API key.
	 */
	private async createProvider(providerId: string, config: AiProviderConfig) {
		const apiKey = await this.getApiKey(providerId);
		debugLog(
			"AI provider %s (id=%s): apiKey present=%s",
			config.type,
			providerId,
			!!apiKey,
		);
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
					fetch: obsidianFetch,
				});
			case "anthropic":
				return createAnthropic({
					apiKey,
					baseURL: config.baseUrl,
					fetch: obsidianFetch,
				});
			case "google":
				return createGoogleGenerativeAI({
					apiKey,
					baseURL: config.baseUrl,
					fetch: obsidianFetch,
				});
			case "openrouter":
				return createOpenRouter({
					apiKey,
					baseURL: config.baseUrl,
					compatibility: "strict",
					fetch: obsidianFetch,
				});
			default: {
				const exhaustiveCheck: never = config.type;
				throw new Error(
					`Unknown provider type: ${exhaustiveCheck as string}`,
				);
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
		while (
			this.activeCount < this.maxConcurrency &&
			this.queue.length > 0
		) {
			const item = this.queue.shift()!;
			this.activeCount++;

			item.task()
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
	 * Generate text using AI (askAi dynamic pipe).
	 *
	 * @param prompt The prompt to send to the AI
	 * @param context Dynamic pipe context (skipCache, cardPath)
	 * @returns The generated text
	 */
	async askAi(prompt: string, context: DynamicPipeContext): Promise<string> {
		const pipeType = "askAi" as const;
		const systemPrompt =
			this.getProviderForDynamicPipe(pipeType)?.config.systemPrompt;

		// Check cache first (unless skipCache)
		if (!context.skipCache && context.cardPath) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				prompt,
				systemPrompt ?? "",
			);
			const cached = this.cacheService.get(context.cardPath, cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const providerResult = this.getProviderForDynamicPipe(pipeType);
		if (!providerResult) {
			throw new Error("No provider configured for askAi dynamic pipe");
		}
		const { id: providerId, config } = providerResult;

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = await this.createProvider(providerId, config);
			const modelId =
				config.textModel ?? getDefaultTextModel(config.type);

			// Use .chat() for OpenAI to avoid CORS issues with Responses API
			const model =
				config.type === "openai"
					? (provider as ReturnType<typeof createOpenAI>).chat(
							modelId,
						)
					: provider(modelId);

			const response = await generateText({
				model,
				prompt,
				system: config.systemPrompt?.trim() || undefined,
			});

			return response.text;
		});

		// Cache the result
		const cacheKey = await this.cacheService.generateKey(
			pipeType,
			prompt,
			config.systemPrompt ?? "",
		);
		this.cacheService.set(cacheKey, result);

		return result;
	}

	/**
	 * Generate an image using AI (generateImage dynamic pipe).
	 *
	 * @param prompt The prompt describing the image
	 * @param context Dynamic pipe context (skipCache, cardPath)
	 * @returns Markdown link to the generated image (e.g., "![[image.png]]")
	 */
	async generateImageDynamicPipe(
		prompt: string,
		context: DynamicPipeContext,
	): Promise<string> {
		const pipeType = "generateImage" as const;

		// Check cache first (unless skipCache)
		if (!context.skipCache && context.cardPath) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				prompt,
			);
			const cached = this.cacheService.get(context.cardPath, cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const providerResult = this.getProviderForDynamicPipe(pipeType);
		if (!providerResult) {
			throw new Error(
				"No provider configured for generateImage dynamic pipe",
			);
		}
		const { id: providerId, config } = providerResult;

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = await this.createProvider(providerId, config);
			const modelId =
				config.imageModel ?? getDefaultImageModel(config.type);

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
		this.cacheService.set(cacheKey, result);

		return result;
	}

	/**
	 * Generate speech using AI (generateSpeech dynamic pipe).
	 *
	 * @param text The text to convert to speech
	 * @param context Dynamic pipe context (skipCache, cardPath)
	 * @returns Markdown link to the generated audio (e.g., "![[audio.mp3]]")
	 */
	async generateSpeechDynamicPipe(
		text: string,
		context: DynamicPipeContext,
	): Promise<string> {
		const pipeType = "generateSpeech" as const;

		// Check cache first (unless skipCache)
		if (!context.skipCache && context.cardPath) {
			const cacheKey = await this.cacheService.generateKey(
				pipeType,
				text,
			);
			const cached = this.cacheService.get(context.cardPath, cacheKey);
			if (cached) {
				return cached.output;
			}
		}

		// Get provider config
		const providerResult = this.getProviderForDynamicPipe(pipeType);
		if (!providerResult) {
			throw new Error(
				"No provider configured for generateSpeech dynamic pipe",
			);
		}
		const { id: providerId, config } = providerResult;

		// Enqueue the API call
		const result = await this.enqueue(async () => {
			const provider = await this.createProvider(providerId, config);
			const modelId =
				config.speechModel ?? getDefaultSpeechModel(config.type);
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
		this.cacheService.set(cacheKey, result);

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
		const attachmentFolder =
			this.settings.attachmentFolder || "attachments";

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
		const buffer =
			data.buffer instanceof ArrayBuffer
				? data.buffer.slice(
						data.byteOffset,
						data.byteOffset + data.byteLength,
					)
				: new Uint8Array(data).buffer;
		await this.app.vault.createBinary(filePath, buffer);

		return filename;
	}

	/**
	 * Check if a provider is configured for a dynamic pipe type.
	 */
	isProviderConfigured(
		pipeType: "askAi" | "generateImage" | "generateSpeech",
	): boolean {
		const config = this.getProviderForDynamicPipe(pipeType);
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
