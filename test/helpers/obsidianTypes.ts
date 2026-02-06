export type DueCard = {
	path: string;
	id?: string;
};

/**
 * Simplified session state for test assertions.
 */
export type ReviewSessionState = {
	deckPath: string;
	currentCardPath: string;
	currentSide: number;
	totalSides: number;
	initialTotal: number;
	reviewedCount: number;
	reviewsPerformed: number;
};

/**
 * Review session manager interface for tests.
 */
export type ReviewSessionManagerLike = {
	isSessionActive: () => boolean;
	getSession: () => ReviewSessionState | null;
	endSession: () => void;
};

export type AnkerPluginLike = {
	settings: {
		templateFolder: string;
		defaultImportFolder?: string;
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
	reviewSessionManager?: ReviewSessionManagerLike;
};

export type WorkspaceLeafLike = {
	view: unknown;
	detach: () => void;
};

export type ObsidianAppLike = {
	vault: {
		configDir: string;
		getAbstractFileByPath: (path: string) => unknown;
		createFolder: (path: string) => Promise<unknown>;
		delete: (file: unknown, force?: boolean) => Promise<void>;
		getMarkdownFiles: () => unknown[];
		adapter: {
			exists: (path: string) => Promise<boolean>;
			read: (path: string) => Promise<string>;
		};
	};
	workspace: {
		getLeavesOfType: (type: string) => WorkspaceLeafLike[];
		getActiveViewOfType: (type: unknown) => unknown;
		setActiveLeaf: (
			leaf: WorkspaceLeafLike,
			options?: { focus?: boolean },
		) => void;
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
