/**
 * 状态面板视图
 */

import { opsApi, OpsStatus } from "../api";
import { toast } from "../components/toast";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分钟`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} 秒`);

  return parts.join(" ");
}

export function renderStatusView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">Service Status</h3>
      <div id="status-loading" class="loading-screen" style="min-height: 100px;">
        <div class="spinner"></div>
      </div>
      <div id="status-content" class="hidden">
        <div class="grid grid-3">
          <div class="stat-item">
            <span class="stat-label">运行时间</span>
            <span class="stat-value" id="stat-uptime">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">进程 ID</span>
            <span class="stat-value" id="stat-pid">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Watcher</span>
            <span class="stat-value" id="stat-watcher">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Node.js 版本</span>
            <span class="stat-value" id="stat-node">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">平台</span>
            <span class="stat-value" id="stat-platform">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">架构</span>
            <span class="stat-value" id="stat-arch">-</span>
          </div>
        </div>
        <h4 class="mt-4 mb-4">Memory Usage</h4>
        <div class="grid grid-2">
          <div class="stat-item">
            <span class="stat-label">堆内存已用</span>
            <span class="stat-value" id="stat-heap-used">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">堆内存总量</span>
            <span class="stat-value" id="stat-heap-total">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">外部内存</span>
            <span class="stat-value" id="stat-external">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">RSS</span>
            <span class="stat-value" id="stat-rss">-</span>
          </div>
        </div>
        <div class="text-right mt-4">
          <div class="refresh-indicator">
            <span class="dot"></span>
            <span id="last-updated">最后更新: -</span>
          </div>
        </div>
      </div>
      <div id="status-error" class="alert alert-error hidden"></div>
    </div>
  `;
}

export async function loadStatusData(): Promise<void> {
  const loadingEl = document.getElementById("status-loading");
  const contentEl = document.getElementById("status-content");
  const errorEl = document.getElementById("status-error");

  if (!loadingEl || !contentEl || !errorEl) return;

  const response = await opsApi.getStatus();

  if (response.success && response.data) {
    const status: OpsStatus = response.data;

    // 更新状态
    (document.getElementById("stat-uptime") as HTMLElement).textContent =
      formatUptime(status.uptime);
    (document.getElementById("stat-pid") as HTMLElement).textContent =
      String(status.pid);
    (document.getElementById("stat-watcher") as HTMLElement).textContent =
      status.watcherActive ? "Running" : "Stopped";
    (document.getElementById("stat-node") as HTMLElement).textContent =
      status.nodeVersion;
    (document.getElementById("stat-platform") as HTMLElement).textContent =
      `${status.platform}`;
    (document.getElementById("stat-arch") as HTMLElement).textContent =
      `${status.arch}`;

    // 内存信息
    (document.getElementById("stat-heap-used") as HTMLElement).textContent =
      formatBytes(status.memory.heapUsed);
    (document.getElementById("stat-heap-total") as HTMLElement).textContent =
      formatBytes(status.memory.heapTotal);
    (document.getElementById("stat-external") as HTMLElement).textContent =
      formatBytes(status.memory.external);
    (document.getElementById("stat-rss") as HTMLElement).textContent =
      formatBytes(status.memory.rss);

    // 更新时间
    const now = new Date();
    (document.getElementById("last-updated") as HTMLElement).textContent =
      `最后更新: ${now.toLocaleTimeString("zh-CN")}`;

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
    errorEl.classList.add("hidden");
  } else {
    loadingEl.classList.add("hidden");
    contentEl.classList.add("hidden");
    errorEl.textContent = response.error || "加载失败";
    errorEl.classList.remove("hidden");
  }
}