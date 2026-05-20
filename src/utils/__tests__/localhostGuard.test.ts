import { describe, it, expect, vi, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { localhostGuard } from "../localhostGuard";

vi.mock("../logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../logger";

function mockReq(ip: string | undefined): Request {
  return {
    headers: {},
    socket: { remoteAddress: ip },
    method: "GET",
    path: "/test/path",
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("localhostGuard", () => {
  it("calls next() for local request from 127.0.0.1", () => {
    const req = mockReq("127.0.0.1");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("calls next() for local request from ::1", () => {
    const req = mockReq("::1");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() for local request from ::ffff:127.0.0.1", () => {
    const req = mockReq("::ffff:127.0.0.1");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() for request with undefined remoteAddress (Unix socket)", () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 and does not call next() for non-local request (192.168.1.100)", () => {
    const req = mockReq("192.168.1.100");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalled();
  });

  it("returns correct JSON body for non-local request (203.0.113.1)", () => {
    const req = mockReq("203.0.113.1");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "The requested endpoint does not exist",
        type: "invalid_request_error",
        code: "endpoint_not_found",
      },
    });
  });

  it("logs a warning with ip, path, and method for non-local requests", () => {
    const req = mockReq("10.0.0.1");
    const res = mockRes();
    const next = vi.fn();

    localhostGuard(req, res, next);

    const warnMock = logger.warn as Mock;
    expect(warnMock).toHaveBeenCalledWith(
      "Non-local request blocked by localhostGuard",
      expect.objectContaining({
        ip: "10.0.0.1",
        path: "/test/path",
        method: "GET",
      }),
    );
  });
});
