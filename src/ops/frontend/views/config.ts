/**
 * 配置管理视图
 */

import {
  opsApi,
  ConfigSchema,
  CurrentConfig,
} from "../api";
import { store } from "../store";
import { toast } from "../components/toast";

let currentSchema: ConfigSchema | null = null;
let currentConfig: CurrentConfig | null = null;
let hasChanges = false;

export function renderConfigView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">Configuration</h3>
      <div id="config-loading" class="loading-screen" style="min-height: 100px;">
        <div class="spinner"></div>
      </div>
      <div id="config-content" class="hidden">
        <div id="config-form" class="config-grid"></div>
        <div id="config-actions" class="mt-4">
          <button class="btn btn-primary" id="btn-save-config" disabled>
            Save Config
          </button>
          <span id="unsaved-indicator" class="hidden" style="margin-left: 12px; color: var(--warning);">
            Unsaved changes
          </span>
        </div>
      </div>
      <div id="config-error" class="alert alert-error hidden"></div>
    </div>
  `;
}

export async function loadConfigData(): Promise<void> {
  const loadingEl = document.getElementById("config-loading");
  const contentEl = document.getElementById("config-content");
  const errorEl = document.getElementById("config-error");
  const formEl = document.getElementById("config-form") as HTMLElement;

  if (!loadingEl || !contentEl || !errorEl || !formEl) return;

  // 并行加载 schema 和 config
  const [schemaRes, configRes] = await Promise.all([
    opsApi.getConfigSchema(),
    opsApi.getConfig(),
  ]);

  if (!schemaRes.success || !configRes.success) {
    loadingEl.classList.add("hidden");
    errorEl.textContent = schemaRes.error || configRes.error || "加载失败";
    errorEl.classList.remove("hidden");
    return;
  }

  currentSchema = schemaRes.data!;
  currentConfig = configRes.data!;

  // 生成表单
  formEl.innerHTML = "";

  for (const [key, schema] of Object.entries(currentSchema)) {
    const value = currentConfig![key] as string | number | boolean | undefined;
    const item = createConfigItem(key, schema, value);
    formEl.appendChild(item);
  }

  loadingEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
}

function escapeAttr(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createConfigItem(
  key: string,
  schema: ConfigSchema[string],
  value: string | number | boolean | undefined
): HTMLElement {
  const item = document.createElement("div");
  item.className = "config-item";

  const inputId = `config-${key}`;
  let inputHtml = "";

  if (schema.type === "boolean") {
    inputHtml = `
      <label for="${inputId}">
        <input type="checkbox" id="${inputId}" data-key="${key}" ${value ? "checked" : ""} />
        <span>${schema.description || key}</span>
      </label>
    `;
  } else if (schema.enum) {
    inputHtml = `
      <label>
        <span style="display: block; margin-bottom: 6px;">${schema.description || key}</span>
        <select id="${inputId}" data-key="${key}">
          ${schema.enum.map((opt) => `
            <option value="${opt}" ${value === opt ? "selected" : ""}>${opt}</option>
          `).join("")}
        </select>
      </label>
    `;
  } else if (schema.type === "number") {
    inputHtml = `
      <label>
        <span style="display: block; margin-bottom: 6px;">${schema.description || key}</span>
        <input type="number" id="${inputId}" data-key="${key}" 
          value="${escapeAttr(value)}" ${schema.min !== undefined ? `min="${schema.min}"` : ""} />
      </label>
    `;
  } else {
    inputHtml = `
      <label>
        <span style="display: block; margin-bottom: 6px;">${schema.description || key}</span>
        <input type="text" id="${inputId}" data-key="${key}" value="${escapeAttr(value)}" />
      </label>
    `;
  }

  item.innerHTML = inputHtml;

  // 监听变更
  const input = item.querySelector("input, select") as HTMLInputElement | HTMLSelectElement;
  if (input) {
    const eventType = input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventType, () => {
      markChanged();
    });
  }

  return item;
}

function markChanged(): void {
  hasChanges = true;
  const saveBtn = document.getElementById("btn-save-config") as HTMLButtonElement;
  const indicator = document.getElementById("unsaved-indicator") as HTMLElement;

  if (saveBtn) saveBtn.disabled = false;
  if (indicator) indicator.classList.remove("hidden");
}

export async function saveConfig(): Promise<void> {
  if (!currentSchema) return;

  const saveBtn = document.getElementById("btn-save-config") as HTMLButtonElement;
  const indicator = document.getElementById("unsaved-indicator") as HTMLElement;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  // 收集变更
  const updates: Record<string, string | number | boolean> = {};

  for (const key of Object.keys(currentSchema)) {
    const input = document.getElementById(`config-${key}`) as
      | HTMLInputElement
      | HTMLSelectElement
      | undefined;

    if (!input) continue;

    let value: string | number | boolean;

    if (input.type === "checkbox") {
      value = (input as HTMLInputElement).checked;
    } else if (input.type === "number") {
      value = parseFloat(input.value) || 0;
    } else {
      value = input.value;
    }

    // 只提交有变更的
    if (value !== currentConfig![key]) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    toast.info("No changes to save");
    resetSaveButton();
    return;
  }

  const response = await opsApi.updateConfig(updates);

  if (response.success) {
    toast.success("Config saved, restart to apply");
    currentConfig = response.data!;
    hasChanges = false;
    resetSaveButton();

    if ("debugEnabled" in updates) {
      const enabled = !!updates.debugEnabled;
      store.setState({ debugEnabled: enabled });
      const debugLink = document.getElementById("nav-debug");
      if (debugLink) {
        debugLink.hidden = !enabled;
      }
    }
  } else {
    toast.error(response.error || "Save failed");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Config";
    }
  }
}

function resetSaveButton(): void {
  const saveBtn = document.getElementById("btn-save-config") as HTMLButtonElement;
  const indicator = document.getElementById("unsaved-indicator") as HTMLElement;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Save Config";
  }
  if (indicator) indicator.classList.add("hidden");
}

// 初始化保存按钮
let saveBtnInitialized = false;
export function initSaveButton(): void {
  if (saveBtnInitialized) return;
  saveBtnInitialized = true;

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.id === "btn-save-config" || target.closest("#btn-save-config")) {
      void saveConfig();
    }
  });
}