/**
 * 登录视图
 */

import { opsApi } from "../api";
import { store } from "../store";
import { toast } from "../components/toast";

export function renderLoginView(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="login-container">
      <div class="login-box">
        <h2>🔧 Ops 运维界面</h2>
        <p>请输入运维密码</p>
        <form id="login-form">
          <div class="form-group">
            <input
              type="password"
              id="password"
              placeholder="输入运维密码"
              required
              autocomplete="current-password"
            />
          </div>
          <div id="login-error" class="alert alert-error hidden"></div>
          <button type="submit" class="btn btn-primary" style="width: 100%;">
            登录
          </button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById("login-form") as HTMLFormElement;
  const errorEl = document.getElementById("login-error") as HTMLElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");

    const passwordInput = document.getElementById("password") as HTMLInputElement;
    const password = passwordInput.value.trim();

    if (!password) {
      errorEl.textContent = "请输入密码";
      errorEl.classList.remove("hidden");
      return;
    }

    // 验证密码
    opsApi.setToken(password);
    const response = await opsApi.getStatus();

    if (response.success) {
      store.setToken(password);
      toast.success("登录成功");
      // 导航到主页
      window.location.hash = "#/dashboard";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      opsApi.clearToken();
      errorEl.textContent = response.error || "密码错误";
      errorEl.classList.remove("hidden");
    }
  });
}

export function renderDisabledView(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="disabled-container">
      <div class="disabled-box">
        <div class="icon">🔒</div>
        <h2>运维界面未启用</h2>
        <p>请在 .env 中配置 OPS_PASSWORD 来启用运维界面</p>
        <div class="mt-4">
          <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">
            OPS_PASSWORD=your_password_here
          </code>
        </div>
      </div>
    </div>
  `;
}