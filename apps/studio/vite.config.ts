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
    // FS-3 SSO dev: app Sản xuất phục vụ trên origin riêng `studio.localhost:5276`
    // để cookie phiên `Domain=.localhost` chạy giống prod (xem frontend-split-plan §7).
    port: 5276,
    allowedHosts: [".localhost"],
  },
});
