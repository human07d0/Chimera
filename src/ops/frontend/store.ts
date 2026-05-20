/**
 * 简单状态管理
 */

import type { OpsInfo, OpsStatus, ConfigSchema, CurrentConfig } from "./api";

export interface AppState {
  initialized: boolean;
  opsEnabled: boolean;
  debugEnabled: boolean;
  debugAccessible: boolean;
  loggedIn: boolean;
  token: string | null;
  status: OpsStatus | null;
  schema: ConfigSchema | null;
  config: CurrentConfig | null;
  loading: boolean;
  error: string | null;
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = {
    initialized: false,
    opsEnabled: false,
    debugEnabled: false,
    debugAccessible: false,
    loggedIn: false,
    token: null,
    status: null,
    schema: null,
    config: null,
    loading: false,
    error: null,
  };

  private listeners: Set<Listener> = new Set();

  getState(): AppState {
    return this.state;
  }

  setState(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  // Token 管理
  setToken(token: string): void {
    this.setState({ token, loggedIn: true });
    try {
      sessionStorage.setItem("ops_token", token);
    } catch (err) {
      console.warn("Failed to persist OPS token to sessionStorage", err);
    }
  }

  loadToken(): string | null {
    try {
      const token = sessionStorage.getItem("ops_token");
      if (token) {
        this.setState({ token, loggedIn: true });
      }
      return token;
    } catch (err) {
      console.warn("Failed to read OPS token from sessionStorage", err);
      return null;
    }
  }

  clearToken(): void {
    this.setState({ token: null, loggedIn: false });
    try {
      sessionStorage.removeItem("ops_token");
    } catch (err) {
      console.warn("Failed to remove OPS token from sessionStorage", err);
    }
  }
}

export const store = new Store();