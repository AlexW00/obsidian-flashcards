import { App, Modal, Notice } from "obsidian";
import type { TFile } from "obsidian";
import { ButtonRowComponent, FileListComponent } from "./components";

export class OrphanAttachmentsModal extends Modal {
	private files: TFile[];
	private attachmentFolder: string;
	private onConfirm: () => Promise<void>;
	private buttonRow: ButtonRowComponent | null = null;

	constructor(
		app: App,
		files: TFile[],
		attachmentFolder: string,
		onConfirm: () => Promise<void>,
	) {
		super(app);
		this.files = files;
		this.attachmentFolder = attachmentFolder;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flashcard-orphan-modal");

		contentEl.createEl("h2", { text: "Delete unused attachments" });
		contentEl.createEl("p", {
			text: `Found ${this.files.length} unused attachment${
				this.files.length === 1 ? "" : "s"
			} in "${this.attachmentFolder}".`,
		});

		// Convert files to FileListItem format
		const items = this.files.map((file) => ({
			file,
			displayName: file.path,
		}));

		new FileListComponent(this.app, contentEl, {
			items,
			containerClass: "flashcard-orphan-list",
			closeModalOnClick: false, // Don't close when clicking to preview
		});

		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Cancel",
			onCancel: () => this.close(),
			submitText: "Delete all",
			onSubmit: () => {
				void this.handleDelete();
			},
			submitCta: false, // Use warning style instead
		});

		// Apply warning style to the delete button
		const submitBtn = this.buttonRow.element.querySelector(
			".flashcard-buttons-right .mod-cta",
		);
		if (submitBtn) {
			submitBtn.removeClass("mod-cta");
			submitBtn.addClass("mod-warning");
		}
	}

	private async handleDelete(): Promise<void> {
		this.buttonRow?.setCancelDisabled(true);
		this.buttonRow?.setSubmitDisabled(true);
		this.buttonRow?.setSubmitLoading(true);

		try {
			await this.onConfirm();
			new Notice(
				`Deleted ${this.files.length} unused attachment${
					this.files.length === 1 ? "" : "s"
				}.`,
			);
			this.close();
		} catch (error) {
			console.error("Failed to delete attachments", error);
			new Notice("Failed to delete unused attachments");
			this.buttonRow?.setCancelDisabled(false);
			this.buttonRow?.setSubmitDisabled(false);
			this.buttonRow?.setSubmitLoading(false);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
