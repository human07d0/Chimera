export function sanitizeForLog(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return body;
  const obj = body as Record<string, unknown>;
  return {
    error: obj["error"],
    message: obj["message"],
    code: obj["code"],
    type: obj["type"],
  };
}
