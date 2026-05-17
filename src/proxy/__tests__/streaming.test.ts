import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
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
    locals: {},
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

  it("rewrites model field in JSON data chunks", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"original","choices":[]}\n\n',
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "virtual-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain('"model":"virtual-model"');
    expect(allWritten).not.toContain('"model":"original"');
  });

  it("tracks token usage from usage field", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m","usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n',
    ]);
    const clientRes = createMockClientRes();

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
  });

  it("tracks cache_hit from usage field", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m","usage":{"prompt_tokens":5,"completion_tokens":5,"cache_hit":true}}\n\n',
    ]);
    const clientRes = createMockClientRes();

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    expect(result.cacheHit).toBe(true);
  });

  it("skips empty lines by default", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m"}\n\n\ndata: {"model":"m2"}\n\n',
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    const dataBlocks = allWritten.split("data: ").filter(Boolean);
    expect(dataBlocks.length).toBe(2);
  });

  it("sends error chunk on stream error when sendErrorChunk is true", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"model":"m"}\n\n'));
        controller.error(new Error("stream broke"));
      },
    });
    const upstream = {
      body: stream,
      status: 200,
      ok: true,
      headers: new Headers(),
    } as unknown as globalThis.Response;
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain("upstream_error");
    expect(allWritten).toContain("data: [DONE]");
  });

  it("does not send error chunk when sendErrorChunk is false", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream broke"));
      },
    });
    const upstream = {
      body: stream,
      status: 200,
      ok: true,
      headers: new Headers(),
    } as unknown as globalThis.Response;
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model", {
      sendErrorChunk: false,
    });

    const allWritten = clientRes._written.join("");
    expect(allWritten).not.toContain("upstream_error");
  });

  it("writes empty lines when skipEmptyLines is false", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m"}\n\n\ndata: {"model":"m2"}\n\n',
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model", {
      skipEmptyLines: false,
    });

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain("\n\n");
    const writeCalls = clientRes._written;
    const emptyLineCalls = writeCalls.filter(
      (w: string) => w.trim() === "" || w === "\n"
    );
    expect(emptyLineCalls.length).toBeGreaterThan(0);
  });

  it("calls onChunk callback for each line", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m"}\n\n',
    ]);
    const clientRes = createMockClientRes();
    const onChunk = vi.fn((line: string) => line);

    await pipeSSEStream(upstream, clientRes, "test-model", {
      onChunk,
    });

    expect(onChunk).toHaveBeenCalled();
    const firstCall = onChunk.mock.calls[0][0];
    expect(firstCall).toContain("data:");
  });

  it("skips line when onChunk returns null", async () => {
    const upstream = createMockUpstreamResponse([
      'event: message\ndata: {"model":"m"}\n\n',
    ]);
    const clientRes = createMockClientRes();
    const onChunk = vi.fn((line: string) => {
      if (line.startsWith("event:")) return null;
      return line;
    });

    await pipeSSEStream(upstream, clientRes, "test-model", {
      onChunk,
    });

    const allWritten = clientRes._written.join("");
    expect(allWritten).not.toContain("event:");
    expect(allWritten).toContain("data:");
  });

  it("sets SSE headers with charset=utf-8", async () => {
    const upstream = createMockUpstreamResponse(["data: [DONE]\n\n"]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    expect(clientRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/event-stream; charset=utf-8"
    );
    expect(clientRes.setHeader).toHaveBeenCalledWith(
      "X-Accel-Buffering",
      "no"
    );
  });

  it("returns zero tokens when no usage in response", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m","choices":[]}\n\n',
    ]);
    const clientRes = createMockClientRes();

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheHit).toBe(false);
  });

  it("writes [DONE] and returns zeros when body is null", async () => {
    const upstream = {
      body: null,
      status: 200,
      ok: true,
      headers: new Headers(),
    } as unknown as globalThis.Response;
    const clientRes = createMockClientRes();

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, cacheHit: false });
    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain("data: [DONE]");
  });

  it("forwards non-data lines as-is", async () => {
    const upstream = createMockUpstreamResponse([
      "event: message\ndata: {\"model\":\"m\"}\n\n",
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain("event: message");
  });

  it("handles chunks split across multiple reads", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"mod',
      'el":"m"}\n\ndata: [DONE]\n',
      "\n",
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain('"model":"test-model"');
    expect(allWritten).toContain("data: [DONE]");
  });

  it("sets res.locals._sseChunk after parsing a data chunk", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"original","choices":[]}\n\n',
    ]);
    const clientRes = createMockClientRes();
    const capturedLocals: any[] = [];
    clientRes.write.mockImplementation((chunk: string) => {
      capturedLocals.push(JSON.parse(JSON.stringify(clientRes.locals)));
      return true;
    });

    await pipeSSEStream(upstream, clientRes, "virtual-model");

    const localsAfterWrite = capturedLocals.find(l => l._sseChunk !== undefined);
    expect(localsAfterWrite).toBeDefined();
    expect(localsAfterWrite._sseChunk.parsed.model).toBe("virtual-model");
    expect(localsAfterWrite._sseChunk.raw).toBe('{"model":"original","choices":[]}');
    expect(localsAfterWrite._sseChunk.model).toBe("virtual-model");
  });

  it("sets res.locals._sseChunk for onChunk path", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m","choices":[]}\n\n',
    ]);
    const clientRes = createMockClientRes();
    const capturedLocals: any[] = [];
    clientRes.write.mockImplementation((chunk: string) => {
      capturedLocals.push(JSON.parse(JSON.stringify(clientRes.locals)));
      return true;
    });
    const onChunk = vi.fn((line: string) => line);

    await pipeSSEStream(upstream, clientRes, "test-model", { onChunk });

    const localsAfterWrite = capturedLocals.find(l => l._sseChunk !== undefined);
    expect(localsAfterWrite).toBeDefined();
    expect(localsAfterWrite._sseChunk.parsed.model).toBe("m");
  });

  it("does not set res.locals._sseChunk for [DONE] events", async () => {
    const upstream = createMockUpstreamResponse([
      'data: [DONE]\n\n',
    ]);
    const clientRes = createMockClientRes();

    await pipeSSEStream(upstream, clientRes, "test-model");

    expect(clientRes.locals._sseChunk).toBeUndefined();
  });
});

function createMockClientResWithBackpressure() {
  const emitter = new EventEmitter();
  const written: string[] = [];
  let writeReturnValues: boolean[] = [];
  let writeCallIndex = 0;

  const mock: any = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string | Buffer) => {
      written.push(typeof chunk === "string" ? chunk : chunk.toString());
      const val =
        writeCallIndex < writeReturnValues.length
          ? writeReturnValues[writeCallIndex]
          : true;
      writeCallIndex++;
      return val;
    }),
    end: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      emitter.on(event, handler);
      return mock;
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      emitter.off(event, handler);
      return mock;
    }),
    once: vi.fn((event: string, handler: (...args: any[]) => void) => {
      emitter.once(event, handler);
      return mock;
    }),
    removeListener: vi.fn(
      (event: string, handler: (...args: any[]) => void) => {
        emitter.removeListener(event, handler);
        return mock;
      }
    ),
    emit: emitter.emit.bind(emitter),
    locals: {},
    _written: written,
    _setWriteReturnValues: (values: boolean[]) => {
      writeReturnValues = values;
      writeCallIndex = 0;
    },
  };

  return mock;
}

describe("pipeSSEStream backpressure", () => {
  it("continues normally when write returns true (no backpressure)", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m1"}\n\ndata: {"model":"m2"}\n\ndata: [DONE]\n\n',
    ]);
    const clientRes = createMockClientResWithBackpressure();
    clientRes._setWriteReturnValues([true, true, true]);

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain('"model":"test-model"');
    expect(allWritten).toContain("data: [DONE]");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("pauses reading when write returns false and resumes on drain", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m1"}\n\ndata: {"model":"m2"}\n\ndata: [DONE]\n\n',
    ]);
    const clientRes = createMockClientResWithBackpressure();
    clientRes._setWriteReturnValues([true, false, true]);

    setTimeout(() => clientRes.emit("drain"), 0);

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain('"model":"test-model"');
    expect(allWritten).toContain("data: [DONE]");
  });

  it("exits loop when client disconnects during backpressure wait", async () => {
    const upstream = createMockUpstreamResponse([
      'data: {"model":"m1"}\n\ndata: {"model":"m2"}\n\ndata: [DONE]\n\n',
    ]);
    const clientRes = createMockClientResWithBackpressure();
    clientRes._setWriteReturnValues([false]);

    setTimeout(() => clientRes.emit("close"), 0);

    const result = await pipeSSEStream(upstream, clientRes, "test-model");

    const allWritten = clientRes._written.join("");
    expect(allWritten).toContain('"model":"test-model"');
    expect(allWritten).not.toContain('"model":"m2"');
    expect(allWritten).not.toContain("data: [DONE]");
  });
});
