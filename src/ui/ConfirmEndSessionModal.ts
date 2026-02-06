import { App, Modal } from "obsidian";

/**
 * Modal for confirming end of an active review session when starting a new one.
 */
export class ConfirmEndSessionModal extends Modal {
	private deckName: string;
	private onNavigate?: () => void;
	private resolvePromise: ((value: boolean) => void) | null = null;
	private resolved = false;

	constructor(app: App, deckName: string, onNavigate?: () => void) {
		super(app);
		this.deckName = deckName;
		this.onNavigate = onNavigate;
	}

	/**
	 * Show the modal and wait for user response.
	 * Returns true if user confirms, false if cancelled.
	 */
	confirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl("h2", { text: "Review session in progress" });

		contentEl.createEl("p", {
			text: `A review session for "${this.deckName}" is already in progress.`,
		});

		contentEl.createEl("p", {
			text: "Starting a new session will close that tab and end the current session.",
			cls: "setting-item-description",
		});

		// Button container
		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";
		buttonContainer.style.alignItems = "center";

		const leftButtons = buttonContainer.createDiv();
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "8px";

		// Cancel button (left side)
		leftButtons
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.resolve(false);
			});

		// Navigate button (right side)
		if (this.onNavigate) {
				rightButtons
					.createEl("button", { text: "Open existing" })
				.addEventListener("click", () => {
					this.onNavigate?.();
					this.resolve(false);
				});
		}

		// Confirm button (right side)
			rightButtons
			.createEl("button", {
				text: "Start new",
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				this.resolve(true);
			});
	}

	private resolve(value: boolean): void {
		this.resolved = true;
		this.resolvePromise?.(value);
		this.close();
	}

	onClose(): void {
		// If closed without explicit resolution (e.g., clicking outside), treat as cancel
		if (!this.resolved) {
			this.resolvePromise?.(false);
		}
	}
}
