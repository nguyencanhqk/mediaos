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
    // App đăng nhập trung tâm — cổng riêng (không trùng web :5273 / admin :5274). Dev truy cập qua
    // subdomain `auth.localhost:5275` để cookie `Domain=.localhost` (SSO) chạy giống prod (plan §6 Phase 1.4).
    port: 5275,
    // Vite cho phép host `.localhost` mặc định; khai tường minh để chắc chắn dev *.localhost không bị chặn.
    allowedHosts: [".localhost"],
  },
});
