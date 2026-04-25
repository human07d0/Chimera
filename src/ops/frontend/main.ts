/**
 * Ops 运维界面入口
 */

import { opsApi } from "./api";
import { store } from "./store";
import { router } from "./router";
import { renderLoginView, renderDisabledView } from "./views/login";
import { renderStatusView, loadStatusData } from "./views/status";
import { renderConfigView, loadConfigData, initSaveButton } from "./views/config";
import { renderControlView } from "./views/control";

// 全局状态刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 初始化应用
 */
async function init(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  // 显示加载
  app.innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>初始化中...</p>
    </div>
  `;

  try {
    // 检查 Ops 是否启用
    const infoRes = await opsApi.getInfo();

    if (!infoRes.success || !infoRes.data?.enabled) {
      renderDisabledView();
      return;
    }

    store.setState({ opsEnabled: true, initialized: true });

    // 尝试恢复登录状态
    const savedToken = store.loadToken();
    if (savedToken) {
      opsApi.setToken(savedToken);
      const statusRes = await opsApi.getStatus();
      if (!statusRes.success) {
        store.clearToken();
      }
    }

    // 设置路由
    setupRoutes();

    // 启动路由
    router.start();

    // 初始导航
    if (window.location.hash === "" || window.location.hash === "#/") {
      if (store.getState().loggedIn) {
        router.navigate("/dashboard");
      } else {
        router.navigate("/login");
      }
    }
  } catch (error) {
    app.innerHTML = `
      <div class="loading-screen">
        <p style="color: var(--danger); margin-bottom: 16px;">初始化失败: ${error instanceof Error ? error.message : "未知错误"}</p>
        <button class="btn btn-primary" onclick="location.reload()">重试</button>
      </div>
    `;
  }
}

/**
 * 设置路由
 */
function setupRoutes(): void {
  router.addRoute("/login", () => {
    renderLoginView();
  });

  router.addRoute("/dashboard", () => {
    if (!store.getState().loggedIn) {
      router.navigate("/login");
      return;
    }
    renderDashboard();
  });

  // 默认重定向
  router.addRoute("/", () => {
    if (store.getState().loggedIn) {
      router.navigate("/dashboard");
    } else {
      router.navigate("/login");
    }
  });
}

/**
 * 渲染主仪表盘
 */
async function renderDashboard(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <header class="header">
      <h1>Mimo Proxy <span style="color: var(--text-secondary); font-weight: 400; font-size: 14px; margin-left: 8px;">Ops</span></h1>
      <div class="header-actions">
        <a class="nav-link" href="../">Monitor</a>
        <a class="nav-link" href="../debug/">Debug</a>
        <a class="nav-link active" href="#/dashboard">Ops</a>
        <button class="btn btn-secondary btn-sm" id="btn-refresh">Refresh</button>
        <button class="btn btn-secondary btn-sm" id="btn-logout">Logout</button>
      </div>
    </header>
    <div class="container">
      <div class="ops-layout">
        <div id="status-panel"></div>
        <div class="ops-right">
          <div id="control-panel"></div>
          <div id="config-panel"></div>
        </div>
      </div>
    </div>
  `;

  // 渲染各面板
  const statusPanel = document.getElementById("status-panel");
  const configPanel = document.getElementById("config-panel");
  const controlPanel = document.getElementById("control-panel");

  if (statusPanel) {
    renderStatusView(statusPanel);
    void loadStatusData();
  }

  if (configPanel) {
    renderConfigView(configPanel);
    initSaveButton();
    void loadConfigData();
  }

  if (controlPanel) {
    renderControlView(controlPanel);
  }

  // 绑定按钮事件
  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    void refreshData();
  });

  document.getElementById("btn-logout")?.addEventListener("click", () => {
    stopAutoRefresh();
    store.clearToken();
    opsApi.clearToken();
    router.navigate("/login");
  });

  // 启动自动刷新（每 30 秒）
  startAutoRefresh();
}

/**
 * 刷新数据
 */
async function refreshData(): Promise<void> {
  await Promise.all([loadStatusData(), loadConfigData()]);
}

/**
 * 启动自动刷新
 */
function startAutoRefresh(): void {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    void loadStatusData();
  }, 30000);
}

/**
 * 停止自动刷新
 */
function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// 启动应用
init().catch(console.error);