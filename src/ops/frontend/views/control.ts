/**
 * 操作控制视图
 */

import { opsApi } from "../api";
import { toast } from "../components/toast";
import { modal } from "../components/modal";

export function renderControlView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">Operations</h3>
      <div class="control-grid">
        <div class="control-item">
          <div class="icon" style="color: var(--accent);">&#x21bb;</div>
          <h3>Restart</h3>
          <p>Gracefully restart the service</p>
          <button class="btn btn-primary" id="btn-restart">Restart</button>
        </div>
        <div class="control-item">
          <div class="icon" style="color: var(--danger);">&#x25a0;</div>
          <h3>Shutdown</h3>
          <p>Gracefully stop the service</p>
          <button class="btn btn-danger" id="btn-shutdown">Shutdown</button>
        </div>
      </div>
    </div>
  `;

  // 绑定事件
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    modal.danger(
      "Confirm Restart",
      "Are you sure you want to restart the service?",
      () => {
        void handleRestart();
      }
    );
  });

  document.getElementById("btn-shutdown")?.addEventListener("click", () => {
    modal.danger(
      "Confirm Shutdown",
      "Are you sure you want to stop the service? This cannot be undone remotely.",
      () => {
        void handleShutdown();
      }
    );
  });
}

async function handleRestart(): Promise<void> {
  const btn = document.getElementById("btn-restart") as HTMLButtonElement;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Restarting...";
  }

    toast.info("Requesting restart...");

  const response = await opsApi.restart();

  if (response.success) {
    toast.success(response.message || "Restart request sent");
    if (response.data?.hint) {
      toast.info(response.data.hint);
    }
    // 提示用户等待
    setTimeout(() => {
      toast.warning("Service may be restarting, please refresh later");
    }, 3000);
  } else {
    toast.error(response.error || "Restart request failed");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Restart";
    }
  }
}

async function handleShutdown(): Promise<void> {
  const btn = document.getElementById("btn-shutdown") as HTMLButtonElement;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Stopping...";
  }

    toast.info("Requesting shutdown...");

  const response = await opsApi.shutdown();

  if (response.success) {
    toast.success("Shutdown request sent");
    setTimeout(() => {
      toast.warning("Service is stopping, connection will be lost");
    }, 2000);
  } else {
    toast.error(response.error || "Shutdown request failed");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Shutdown";
    }
  }
}