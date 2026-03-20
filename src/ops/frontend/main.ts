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
      <h1>🔧 Mimo Proxy 运维中心</h1>
      <div class="header-actions">
        <button class="btn btn-secondary btn-sm" id="btn-refresh">
          🔄 刷新数据
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-logout">
          🚪 退出登录
        </button>
      </div>
    </header>
    <div class="container">
      <div class="grid grid-2">
        <div id="status-panel"></div>
        <div id="control-panel"></div>
      </div>
      <div id="config-panel"></div>
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