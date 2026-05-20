import { Request } from "express";

/**
 * Checks whether the request originated from a local loopback address.
 *
 * Coverage:
 * - 127.0.0.0/8 (IPv4)
 * - ::1 (IPv6 loopback)
 * - ::ffff:127.x.x.x (IPv4-mapped IPv6)
 *
 * Uses `req.socket.remoteAddress` (TCP-layer address), which is unaffected
 * by trust proxy settings and cannot be spoofed via X-Forwarded-For.
 *
 * Returns `true` when `remoteAddress` is undefined or empty (e.g. Unix
 * domain socket), treating such connections as local.
 */
export function isLocalRequest(req: Request): boolean {
  const addr = req.socket.remoteAddress;

  if (!addr) {
    return true;
  }

  if (addr === "::1") {
    return true;
  }

  if (addr.startsWith("::ffff:")) {
    return addr.slice(7).startsWith("127.");
  }

  return addr.startsWith("127.");
}
