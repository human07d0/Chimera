/**
 * 简单 Hash 路由管理（仅用于 Ops 前端）
 */

type RouteHandler = () => void;

class Router {
  private routes: Map<string, RouteHandler> = new Map();
  private currentPath = "";

  addRoute(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  navigate(path: string): void {
    if (this.currentPath === path) return;
    this.currentPath = path;
    window.location.hash = `#${path}`;
    this.handleRoute();
  }

  handleRoute(): void {
    const hash = window.location.hash || "#/";
    const normalizedPath = hash.startsWith("#") ? hash.slice(1) : hash;
    const path = normalizedPath || "/";

    const handler = this.routes.get(path) || this.routes.get("/");
    if (handler) {
      handler();
    }
  }

  start(): void {
    window.addEventListener("hashchange", () => this.handleRoute());
    this.handleRoute();
  }
}

export const router = new Router();