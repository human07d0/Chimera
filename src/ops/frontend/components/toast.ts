/**
 * Toast 通知组件
 */

type ToastType = "success" | "error" | "warning" | "info";

interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

class Toast {
  private container: HTMLElement | null = null;

  private init(): void {
    if (this.container) return;
    this.container = document.createElement("div");
    this.container.className = "toast-container";
    document.body.appendChild(this.container);
  }

  show(message: string, options: ToastOptions = {}): void {
    this.init();
    const { type = "info", duration = 3000 } = options;

    const toast = document.createElement("div");
    toast.className = `toast alert-${type}`;
    toast.textContent = message;

    this.container!.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = "slideIn 0.3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  success(message: string): void {
    this.show(message, { type: "success" });
  }

  error(message: string): void {
    this.show(message, { type: "error" });
  }

  warning(message: string): void {
    this.show(message, { type: "warning" });
  }

  info(message: string): void {
    this.show(message, { type: "info" });
  }
}

export const toast = new Toast();