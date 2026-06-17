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
    // FS-2 SSO dev: app Nhân sự phục vụ trên origin riêng `people.localhost:5277`
    // để cookie phiên `Domain=.localhost` chạy giống prod (xem frontend-split-plan §7).
    port: 5277,
    allowedHosts: [".localhost"],
  },
});
