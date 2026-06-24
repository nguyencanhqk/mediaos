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
    // FS-4 SSO dev: vỏ nghiệp vụ hợp nhất (tenant, aud=user) phục vụ trên origin riêng `web.localhost:5273`
    // để cookie phiên `Domain=.localhost` chạy giống prod. Đây là app đích mặc định sau đăng nhập (apps/auth).
    port: 5273,
    allowedHosts: [".localhost"],
  },
});
