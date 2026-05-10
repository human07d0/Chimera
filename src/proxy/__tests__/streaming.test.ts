import { describe, it, expect, vi } from "vitest";
import { pipeSSEStream } from "../streaming";

function createMockUpstreamResponse(chunks: string[]): globalThis.Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return {
    body: stream,
    status: 200,
    ok: true,
    headers: new Headers(),
  } as unknown as globalThis.Response;
}

function createMockClientRes(): any {
  const written: string[] = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string | Buffer) => {
      written.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }),
    end: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    _written: written,
  };
}

describe("pipeSSEStream", () => {
  it("produces correct SSE format — no triple newlines (I1)", async () => {
    const upstream = createMockUpstreamResponse(['data: {"model":"m"}\n\n']);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).not.toContain("\n\n\n");
  });

  it("handles [DONE] event correctly", async () => {
    const upstream = createMockUpstreamResponse(["data: [DONE]\n\n"]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain("data: [DONE]");
    expect(allWritten).not.toContain("\n\n\n");
  });

  it("handles multiple events without extra newlines", async () => {
    const chunk = 'data: {"model":"m"}\n\ndata: {"model":"m"}\n\ndata: [DONE]\n\n';
    const upstream = createMockUpstreamResponse([chunk]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    // Should have exactly 3 data blocks, each with \n\n terminator
    const dataBlocks = allWritten.split("data: ").filter(Boolean);
    expect(dataBlocks.length).toBe(3);
    expect(allWritten).not.toContain("\n\n\n");
  });
});
