import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        ...Object.fromEntries(["/api", "/uploads"].map((path) => [
          path,
          {
            target: process.env.VITE_API_PROXY ?? env.VITE_API_PROXY ?? "http://127.0.0.1:4000",
            changeOrigin: true,
          },
        ])),
      },
    },
  };
});
