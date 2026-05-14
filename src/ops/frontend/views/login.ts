/**
 * 登录视图
 */

import { opsApi } from "../api";
import { store } from "../store";
import { router } from "../router";
import { toast } from "../components/toast";

export function renderLoginView(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <header class="header">
      <h1>Chimera <span style="color: var(--text-secondary); font-weight: 400; font-size: 14px; margin-left: 8px;">Ops</span></h1>
      <div class="header-actions">
        <a class="nav-link" href="../">Monitor</a>
        <a class="nav-link" href="../debug/">Debug</a>
        <a class="nav-link active" href="#/login">Ops</a>
        <a class="nav-link" href="../playground/">Playground</a>
      </div>
    </header>
    <div class="login-container">
      <div class="login-box">
        <h2>Ops</h2>
        <p>Enter ops password</p>
        <form id="login-form">
          <div class="form-group">
            <input
              type="password"
              id="password"
              placeholder="Password"
              required
              autocomplete="current-password"
            />
          </div>
          <div id="login-error" class="alert alert-error hidden"></div>
          <button type="submit" class="btn btn-primary" style="width: 100%;">
            Login
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
      errorEl.textContent = "Please enter password";
      errorEl.classList.remove("hidden");
      return;
    }

    // 验证密码
    opsApi.setToken(password);
    const response = await opsApi.getStatus();

    if (response.success) {
      store.setToken(password);
      toast.success("Login successful");
      router.navigate("/dashboard");
    } else {
      opsApi.clearToken();
      errorEl.textContent = response.error || "Invalid password";
      errorEl.classList.remove("hidden");
    }
  });
}

export function renderDisabledView(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <header class="header">
      <h1>Chimera <span style="color: var(--text-secondary); font-weight: 400; font-size: 14px; margin-left: 8px;">Ops</span></h1>
      <div class="header-actions">
        <a class="nav-link" href="../">Monitor</a>
        <a class="nav-link" href="../debug/">Debug</a>
        <a class="nav-link active" href="#/">Ops</a>
        <a class="nav-link" href="../playground/">Playground</a>
      </div>
    </header>
    <div class="disabled-container">
      <div class="disabled-box">
        <div class="icon">&#x1f512;</div>
        <h2>Ops Not Enabled</h2>
        <p>Set OPS_PASSWORD in .env to enable the ops interface</p>
        <div class="mt-4">
          <code>OPS_PASSWORD=your_password_here</code>
        </div>
      </div>
    </div>
  `;
}
