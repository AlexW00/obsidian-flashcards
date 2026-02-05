import { requestUrl } from "obsidian";
import { debugLog } from "../types";

/**
 * Pexels photo source sizes.
 */
interface PexelsPhotoSrc {
	original: string;
	large2x: string;
	large: string;
	medium: string;
	small: string;
	portrait: string;
	landscape: string;
	tiny: string;
}

/**
 * Pexels photo object from API response.
 */
interface PexelsPhoto {
	id: number;
	width: number;
	height: number;
	url: string;
	photographer: string;
	photographer_url: string;
	photographer_id: number;
	avg_color: string;
	src: PexelsPhotoSrc;
	liked: boolean;
	alt: string;
}

/**
 * Pexels search API response.
 */
interface PexelsSearchResponse {
	total_results: number;
	page: number;
	per_page: number;
	photos: PexelsPhoto[];
	next_page?: string;
}

/**
 * Result from searching and downloading an image.
 */
export interface PexelsImageResult {
	data: Uint8Array;
	extension: string;
	photographer: string;
	photographerUrl: string;
	pexelsUrl: string;
}

/**
 * Service for searching and downloading images from Pexels.
 *
 * Rate limit: 200 requests per hour (default).
 * See: https://www.pexels.com/api/documentation/
 */
export class PexelsService {
	private static readonly API_BASE = "https://api.pexels.com/v1";
	private static readonly MAX_FALLBACK_ATTEMPTS = 3;

	/**
	 * Search for photos and download the first available one.
	 *
	 * @param query Search query (e.g., "sunset landscape")
	 * @param apiKey Pexels API key
	 * @returns Image data and metadata
	 * @throws Error if no photos found or all download attempts fail
	 */
	async searchAndDownload(
		query: string,
		apiKey: string,
	): Promise<PexelsImageResult> {
		// Search for photos
		const searchUrl = `${PexelsService.API_BASE}/search?query=${encodeURIComponent(query)}&per_page=${PexelsService.MAX_FALLBACK_ATTEMPTS}`;

		debugLog("Pexels search: %s", searchUrl);

		const searchResponse = await requestUrl({
			url: searchUrl,
			method: "GET",
			headers: {
				Authorization: apiKey,
			},
		});

		if (searchResponse.status !== 200) {
			throw new Error(
				`Pexels API error: ${searchResponse.status} - ${searchResponse.text}`,
			);
		}

		const searchData = searchResponse.json as PexelsSearchResponse;

		if (!searchData.photos || searchData.photos.length === 0) {
			throw new Error(`No photos found for query: "${query}"`);
		}

		debugLog(
			"Pexels found %d photos for query: %s",
			searchData.photos.length,
			query,
		);

		// Try to download photos with fallback
		let lastError: Error | null = null;

		for (
			let i = 0;
			i < Math.min(searchData.photos.length, PexelsService.MAX_FALLBACK_ATTEMPTS);
			i++
		) {
			const photo = searchData.photos[i];
			if (!photo) continue;

			try {
				const result = await this.downloadPhoto(photo);
				debugLog(
					"Pexels downloaded photo %d by %s",
					photo.id,
					photo.photographer,
				);
				return result;
			} catch (error) {
				debugLog(
					"Pexels download failed for photo %d: %s",
					photo.id,
					error instanceof Error ? error.message : String(error),
				);
				lastError =
					error instanceof Error ? error : new Error(String(error));
			}
		}

		throw new Error(
			`Failed to download any photo for query "${query}": ${lastError?.message ?? "Unknown error"}`,
		);
	}

	/**
	 * Download a single photo from Pexels.
	 *
	 * @param photo Pexels photo object
	 * @returns Image data and metadata
	 */
	private async downloadPhoto(photo: PexelsPhoto): Promise<PexelsImageResult> {
		// Use medium size for good balance of quality and file size
		const imageUrl = photo.src.medium;

		// Extract extension from URL (typically .jpeg or .png)
		// URL format: https://images.pexels.com/photos/123/pexels-photo-123.jpeg?auto=compress...
		const urlPath = new URL(imageUrl).pathname;
		const extensionMatch = urlPath.match(/\.(\w+)$/);
		const extension = extensionMatch?.[1] ?? "jpg";

		debugLog("Pexels downloading: %s", imageUrl);

		const imageResponse = await requestUrl({
			url: imageUrl,
			method: "GET",
		});

		if (imageResponse.status !== 200) {
			throw new Error(
				`Failed to download image: ${imageResponse.status}`,
			);
		}

		return {
			data: new Uint8Array(imageResponse.arrayBuffer),
			extension,
			photographer: photo.photographer,
			photographerUrl: photo.photographer_url,
			pexelsUrl: photo.url,
		};
	}
}
