import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  base: "/admin/",
  build: {
    outDir: path.resolve("dist/client"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve("src/client/index.html")
    }
  },
  resolve: {
    alias: {
      "@": path.resolve("src/client/src"),
      "@shared": path.resolve("src/shared")
    }
  },
  // Allow importing shared catalog from outside Vite root (src/client)
  server: {
    fs: {
      allow: [path.resolve(".")]
    }
  }
});