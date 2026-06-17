import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5273,
    // FS-1b SSO dev: truy cập qua `web.localhost:5273` để cookie `Domain=.localhost` chạy giống prod.
    allowedHosts: [".localhost"],
  },
});
