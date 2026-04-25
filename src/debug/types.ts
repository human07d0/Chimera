export interface DebugEvent {
  request_id: string;
  ts_start: number;
  ts_end: number;
  path: string;
  method: string;
  status_code: number;
  model_requested: string;
  model_upstream: string;
  stream: boolean;
  /** 完整请求体（JSON 序列化后的字符串） */
  request_body: string;
  /** 完整响应体（非流式为 JSON 字符串，流式为所有 SSE chunk 拼接后的 JSON） */
  response_body: string;
  /** 错误信息（如有） */
  error_type: string | null;
  error_body: string | null;
}

export interface DebugQueryParams {
  limit?: number;
  offset?: number;
  model?: string;
  search?: string;
}