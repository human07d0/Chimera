export interface DebugMediaItem {
  id: string;
  location: "request" | "response";
  path: string;
  kind: "image" | "audio" | "video" | "unknown";
  media_type: string;
  encoding: "base64";
  byte_length: number;
  data_base64: string;
}

export interface DebugEvent {
  request_id: string;
  ts_start: number;
  ts_end: number;
  path: string;
  method: string;
  status_code: number;
  model_requested: string;
  model_upstream: string;
  provider_name: string;
  stream: boolean;
  /** 完整请求体（JSON 序列化后的字符串，base64 媒体已替换为摘要占位符） */
  request_body: string;
  /** 完整响应体（非流式为 JSON 字符串，流式为拼接后的完整响应对象 JSON，base64 媒体已替换为摘要占位符） */
  response_body: string;
  error_type: string | null;
  error_body: string | null;
  media?: DebugMediaItem[];
}

export interface DebugQueryParams {
  limit?: number;
  offset?: number;
  model?: string;
  search?: string;
}