import { App, TFile, TFolder } from "obsidian";

/**
 * Service for finding orphaned attachments in the configured attachment folder.
 */
export class AttachmentCleanupService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Find attachments under the given folder that are not referenced by any markdown file.
	 */
	async findOrphanAttachments(attachmentFolder: string): Promise<TFile[]> {
		const normalizedFolder = attachmentFolder.replace(/\/+$/, "");
		const folder = this.app.vault.getAbstractFileByPath(normalizedFolder);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const attachmentFiles = this.collectFiles(folder);
		if (attachmentFiles.length === 0) {
			return [];
		}

		const usedPaths = this.collectUsedAttachmentPaths(normalizedFolder);
		return attachmentFiles.filter((file) => !usedPaths.has(file.path));
	}

	private collectFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectFiles(child));
			}
		}
		return files;
	}

	private collectUsedAttachmentPaths(attachmentFolder: string): Set<string> {
		const used = new Set<string>();
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const folderPrefix = `${attachmentFolder}/`;

		for (const file of markdownFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const links = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
			for (const link of links) {
				const dest = this.app.metadataCache.getFirstLinkpathDest(
					link.link,
					file.path,
				);
				if (dest instanceof TFile) {
					if (
						dest.path === attachmentFolder ||
						dest.path.startsWith(folderPrefix)
					) {
						used.add(dest.path);
					}
				}
			}
		}

		return used;
	}
}
