import { App, Modal, Notice } from "obsidian";
import type { TFile } from "obsidian";
import { ButtonRowComponent, SelectableListComponent } from "./components";

export class OrphanAttachmentsModal extends Modal {
	private files: TFile[];
	private attachmentFolder: string;
	private onConfirm: (files: TFile[]) => Promise<void>;
	private buttonRow: ButtonRowComponent | null = null;
	private selectableList: SelectableListComponent<TFile> | null = null;

	constructor(
		app: App,
		files: TFile[],
		attachmentFolder: string,
		onConfirm: (files: TFile[]) => Promise<void>,
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

		const listContainer = contentEl.createDiv({
			cls: "flashcard-orphan-list-container",
		});
		this.selectableList = new SelectableListComponent<TFile>(
			listContainer,
			{
				items: this.files,
				getDisplayName: (file) => file.path,
				onItemClick: (file) => this.openAttachment(file),
				onSelectionChange: () => this.updateDeleteButton(),
				initiallySelected: true,
				containerClass: "flashcard-orphan-list",
				showCount: true,
			},
		);

		this.buttonRow = new ButtonRowComponent(contentEl, {
			cancelText: "Cancel",
			onCancel: () => this.close(),
			submitText: "Delete selected",
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

		this.updateDeleteButton();
	}

	private openAttachment(file: TFile): void {
		void this.app.workspace.getLeaf().openFile(file);
		this.close();
	}

	private updateDeleteButton(): void {
		const selectedCount = this.selectableList?.getSelectedCount() ?? 0;
		this.buttonRow?.setSubmitDisabled(selectedCount === 0);
	}

	private async handleDelete(): Promise<void> {
		const selectedFiles = this.selectableList?.getSelectedItems() ?? [];
		if (selectedFiles.length === 0) {
			return;
		}

		this.buttonRow?.setCancelDisabled(true);
		this.buttonRow?.setSubmitDisabled(true);
		this.buttonRow?.setSubmitLoading(true);

		try {
			await this.onConfirm(selectedFiles);
			new Notice(
				`Deleted ${selectedFiles.length} unused attachment${
					selectedFiles.length === 1 ? "" : "s"
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
