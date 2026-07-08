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
    // dev-online (VITE_TUNNEL_HOST set): bind dual-stack `::` để cloudflared quay `localhost` không treo IPv4.
    host: process.env.VITE_TUNNEL_HOST ? "::" : undefined,
    // Vite cho phép host `.localhost` mặc định; khai tường minh để chắc chắn dev *.localhost không bị chặn.
    // dev-online: cho phép host cloudflared + HMR qua wss:443 khi VITE_TUNNEL_HOST set (m dev-online).
    allowedHosts: process.env.VITE_TUNNEL_HOST
      ? [".localhost", process.env.VITE_TUNNEL_HOST]
      : [".localhost"],
    hmr: process.env.VITE_TUNNEL_HOST
      ? { host: process.env.VITE_TUNNEL_HOST, protocol: "wss", clientPort: 443 }
      : undefined,
  },
  // dev-online-fast: serve bản build qua `vite preview` cùng cổng dev (xem apps/app/vite.config.ts).
  preview: {
    // Dual-stack (IPv4 + IPv6) để cloudflared quay `localhost` không treo IPv4 — xem apps/app/vite.config.ts.
    host: "::",
    port: 5275,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
