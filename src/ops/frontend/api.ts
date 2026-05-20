/**
 * Ops API 调用封装
 */

export interface OpsInfo {
  enabled: boolean;
  debugEnabled: boolean;
  debugAccessible: boolean;
  version: string;
}

export interface OpsProviderInfo {
  name: string;
  type: string;
  endpoint: string;
  modelCount: number;
}

export interface OpsStatus {
  uptime: number;
  pid: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    arrayBuffers: number;
  };
  watcherActive: boolean;
  nodeVersion: string;
  platform: string;
  arch: string;
  providers?: OpsProviderInfo[];
}

export interface ConfigSchema {
  [key: string]: {
    key: string;
    type: "string" | "number" | "boolean";
    description?: string;
    enum?: string[];
    min?: number;
  };
}

export interface CurrentConfig {
  [key: string]: string | number | boolean | Record<string, boolean>;
  sensitive: {
    hasMimoApiKey: boolean;
    hasProxyApiKey: boolean;
    hasOpsPassword: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

class OpsApi {
  private baseUrl = "/ops";
  private token: string | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
        };
      }

      return data as ApiResponse<T>;
    } catch (error) {
      console.warn("OPS API request failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  /** 获取 Ops 信息（公开接口） */
  async getInfo(): Promise<ApiResponse<OpsInfo>> {
    return this.request<OpsInfo>("/info");
  }

  /** 获取服务状态 */
  async getStatus(): Promise<ApiResponse<OpsStatus>> {
    return this.request<OpsStatus>("/status");
  }

  /** 获取当前配置 */
  async getConfig(): Promise<ApiResponse<CurrentConfig>> {
    return this.request<CurrentConfig>("/config");
  }

  /** 获取配置项 Schema */
  async getConfigSchema(): Promise<ApiResponse<ConfigSchema>> {
    return this.request<ConfigSchema>("/config/schema");
  }

  /** 更新配置 */
  async updateConfig(
    updates: Record<string, string | number | boolean>
  ): Promise<ApiResponse<CurrentConfig>> {
    return this.request<CurrentConfig>("/config", {
      method: "POST",
      body: JSON.stringify(updates),
    });
  }

  /** 停机 */
  async shutdown(): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>("/shutdown", {
      method: "POST",
    });
  }

  /** 重启 */
  async restart(): Promise<ApiResponse<{ message: string; hint?: string }>> {
    return this.request<{ message: string; hint?: string }>("/restart", {
      method: "POST",
    });
  }
}

export const opsApi = new OpsApi();