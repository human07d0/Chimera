/**
 * 操作控制视图
 */

import { opsApi } from "../api";
import { toast } from "../components/toast";
import { modal } from "../components/modal";

export function renderControlView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">🎮 操作控制</h3>
      <div class="control-grid">
        <div class="control-item">
          <div class="icon">🔄</div>
          <h3>重启服务</h3>
          <p>优雅重启服务，会自动启动新的主进程</p>
          <button class="btn btn-primary" id="btn-restart">
            重启
          </button>
        </div>
        <div class="control-item">
          <div class="icon">🛑</div>
          <h3>停止服务</h3>
          <p>优雅停止服务，所有请求处理完毕后关闭</p>
          <button class="btn btn-danger" id="btn-shutdown">
            停止
          </button>
        </div>
      </div>
    </div>
  `;

  // 绑定事件
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    modal.danger(
      "确认重启",
      "确定要重启服务吗？重启期间服务将不可用。",
      () => {
        void handleRestart();
      }
    );
  });

  document.getElementById("btn-shutdown")?.addEventListener("click", () => {
    modal.danger(
      "确认停止",
      "确定要停止服务吗？此操作无法远程恢复。",
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
    btn.textContent = "重启中...";
  }

  toast.info("正在请求重启...");

  const response = await opsApi.restart();

  if (response.success) {
    toast.success(response.message || "重启请求已发送");
    if (response.data?.hint) {
      toast.info(response.data.hint);
    }
    // 提示用户等待
    setTimeout(() => {
      toast.warning("服务可能正在重启，请稍后刷新页面");
    }, 3000);
  } else {
    toast.error(response.error || "重启请求失败");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "重启";
    }
  }
}

async function handleShutdown(): Promise<void> {
  const btn = document.getElementById("btn-shutdown") as HTMLButtonElement;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "停止中...";
  }

  toast.info("正在请求停止服务...");

  const response = await opsApi.shutdown();

  if (response.success) {
    toast.success("停止请求已发送");
    setTimeout(() => {
      toast.warning("服务正在停止，页面即将断开连接");
    }, 2000);
  } else {
    toast.error(response.error || "停止请求失败");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "停止";
    }
  }
}