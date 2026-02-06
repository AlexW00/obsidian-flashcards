export type DueCard = {
	path: string;
	id?: string;
};

export type AnkerPluginLike = {
	settings: {
		templateFolder: string;
		fsrsEnableShortTerm?: boolean;
		fsrsLearningSteps?: Array<string | number>;
		fsrsRelearningSteps?: Array<string | number>;
	};
	manifest?: {
		id: string;
	};
	saveSettings: () => Promise<void>;
	startReview?: (deckPath: string) => void | Promise<void>;
	deckService?: {
		getDueCards: (deckPath: string) => DueCard[];
	};
	reviewLogStore?: {
		reset: () => Promise<number>;
	};
};

export type ObsidianAppLike = {
	vault: {
		configDir: string;
		getAbstractFileByPath: (path: string) => unknown;
		createFolder: (path: string) => Promise<unknown>;
		getMarkdownFiles: () => unknown[];
		adapter: {
			exists: (path: string) => Promise<boolean>;
			read: (path: string) => Promise<string>;
		};
	};
	workspace: {
		getLeavesOfType: (type: string) => Array<{ view: unknown }>;
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
