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
    // FS-4 SSO dev: app Hệ thống (tenant, aud=user) phục vụ trên origin riêng `console.localhost:5278`
    // để cookie phiên `Domain=.localhost` chạy giống prod. TÁCH BẠCH operator plane apps/admin (:5274).
    port: 5278,
    allowedHosts: [".localhost"],
  },
});
