import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appPort = Number.parseInt(env.PORT || "3000", 10) || 3000;

  return {
    root: resolve(__dirname, "src/ops/frontend"),
    base: "/ops/",
    build: {
      outDir: resolve(__dirname, "dist/ops"),
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, "src/ops/frontend/index.html"),
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/ops/frontend"),
      },
    },
    // 单体部署默认与主服务保持同一端口语义（PORT）
    // 注：本项目常态由 Express 托管 dist/ops，Vite dev server 仅用于前端开发调试。
    server: {
      port: appPort,
      strictPort: true,
    },
  };
});