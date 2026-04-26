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
  private lastActiveElement: HTMLElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  show(options: ModalOptions): void {
    // Remember focused element to restore focus when modal closes
    this.lastActiveElement = document.activeElement as HTMLElement | null;
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

    // Accessibility: role/aria and focus trap
    const titleEl = modal.querySelector('.modal-title') as HTMLElement | null;
    const titleId = `modal-title-${Date.now()}`;
    if (titleEl) titleEl.id = titleId;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    (modal as HTMLElement).tabIndex = -1;

    const focusableSelectors = 'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(modal.querySelectorAll(focusableSelectors)) as HTMLElement[];
    const firstFocusable = focusable[0] || null;
    const lastFocusable = focusable[focusable.length - 1] || null;

    if (firstFocusable) firstFocusable.focus();
    else (modal as HTMLElement).focus();

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        options.onCancel?.();
        return;
      }
      if (e.key === 'Tab') {
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable?.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable?.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

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
      if (this.keydownHandler) {
        document.removeEventListener('keydown', this.keydownHandler);
        this.keydownHandler = null;
      }
      this.currentModal.remove();
      this.currentModal = null;
      if (this.lastActiveElement && typeof (this.lastActiveElement.focus) === 'function') {
        this.lastActiveElement.focus();
      }
      this.lastActiveElement = null;
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