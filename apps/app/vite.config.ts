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
    // dev-online: cho phép host cloudflared + HMR qua wss:443 khi VITE_TUNNEL_HOST set (m dev-online).
    allowedHosts: process.env.VITE_TUNNEL_HOST
      ? [".localhost", process.env.VITE_TUNNEL_HOST]
      : [".localhost"],
    hmr: process.env.VITE_TUNNEL_HOST
      ? { host: process.env.VITE_TUNNEL_HOST, protocol: "wss", clientPort: 443 }
      : undefined,
  },
  // dev-online-fast (m dev-online-fast): serve BẢN BUILD qua `vite preview` trên CÙNG cổng dev → tunnel
  // ingress giữ nguyên. Bundle ⇒ 2-3 request/trang thay vì hàng trăm module rời (dev-mode waterfall qua
  // tunnel ~200-350ms/request là nguồn "chuyển trang chậm"). Không HMR — cần HMR dùng `m dev-online`.
  preview: {
    port: 5273,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
