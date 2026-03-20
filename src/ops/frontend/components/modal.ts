/**
 * 模态框组件
 */

interface ModalOptions {
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

class Modal {
  private currentModal: HTMLElement | null = null;

  show(options: ModalOptions): void {
    this.close();

    const {
      title,
      content,
      confirmText = "确认",
      cancelText = "取消",
      danger = false,
      onConfirm,
      onCancel,
    } = options;

    // Overlay
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    // Modal
    const modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML = `
      <div class="modal-title">${title}</div>
      <div class="modal-body">${content}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">${cancelText}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="modal-confirm">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.currentModal = overlay;

    // Events
    modal.querySelector("#modal-confirm")?.addEventListener("click", () => {
      this.close();
      onConfirm?.();
    });

    modal.querySelector("#modal-cancel")?.addEventListener("click", () => {
      this.close();
      onCancel?.();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        this.close();
        onCancel?.();
      }
    });
  }

  close(): void {
    if (this.currentModal) {
      this.currentModal.remove();
      this.currentModal = null;
    }
  }

  confirm(title: string, content: string, onConfirm: () => void): void {
    this.show({ title, content, onConfirm });
  }

  danger(
    title: string,
    content: string,
    onConfirm: () => void
  ): void {
    this.show({ title, content, danger: true, onConfirm });
  }
}

export const modal = new Modal();