export type AnkerPluginLike = {
	settings: {
		templateFolder: string;
		fsrsEnableShortTerm?: boolean;
		fsrsLearningSteps?: Array<string | number>;
		fsrsRelearningSteps?: Array<string | number>;
	};
	saveSettings: () => Promise<void>;
	startReview?: (deckPath: string) => void | Promise<void>;
};

export type ObsidianAppLike = {
	vault: {
		getAbstractFileByPath: (path: string) => unknown;
		createFolder: (path: string) => Promise<unknown>;
		getMarkdownFiles: () => unknown[];
	};
	metadataCache: {
		getFileCache: (
			file: unknown,
		) => { frontmatter?: Record<string, unknown> } | null | undefined;
	};
	plugins?: {
		getPlugin?: (name: string) => AnkerPluginLike | null | undefined;
	};
};
