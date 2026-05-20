import { describe, it, expect } from "vitest";
import { Request } from "express";
import { isLocalRequest } from "../isLocalRequest";

function mockReqWithIp(ip: string | undefined): Request {
  return {
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe("isLocalRequest", () => {
  it("returns true for IPv4 loopback 127.0.0.1", () => {
    expect(isLocalRequest(mockReqWithIp("127.0.0.1"))).toBe(true);
  });

  it("returns true for IPv4 loopback range 127.0.0.2", () => {
    expect(isLocalRequest(mockReqWithIp("127.0.0.2"))).toBe(true);
  });

  it("returns true for IPv4 loopback range 127.255.255.255", () => {
    expect(isLocalRequest(mockReqWithIp("127.255.255.255"))).toBe(true);
  });

  it("returns true for IPv6 loopback ::1", () => {
    expect(isLocalRequest(mockReqWithIp("::1"))).toBe(true);
  });

  it("returns true for IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
    expect(isLocalRequest(mockReqWithIp("::ffff:127.0.0.1"))).toBe(true);
  });

  it("returns true for IPv4-mapped IPv6 ::ffff:127.255.255.255", () => {
    expect(isLocalRequest(mockReqWithIp("::ffff:127.255.255.255"))).toBe(true);
  });

  it("returns true for undefined remoteAddress (Unix domain socket)", () => {
    expect(isLocalRequest(mockReqWithIp(undefined))).toBe(true);
  });

  it("returns true for empty string remoteAddress", () => {
    expect(isLocalRequest(mockReqWithIp(""))).toBe(true);
  });

  it("returns false for private non-loopback 10.0.0.1", () => {
    expect(isLocalRequest(mockReqWithIp("10.0.0.1"))).toBe(false);
  });

  it("returns false for private non-loopback 192.168.1.100", () => {
    expect(isLocalRequest(mockReqWithIp("192.168.1.100"))).toBe(false);
  });

  it("returns false for public IP 203.0.113.1", () => {
    expect(isLocalRequest(mockReqWithIp("203.0.113.1"))).toBe(false);
  });

  it("returns false for IPv6-mapped non-loopback ::ffff:10.0.0.1", () => {
    expect(isLocalRequest(mockReqWithIp("::ffff:10.0.0.1"))).toBe(false);
  });
});
