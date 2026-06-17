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
    // Port riêng cho app admin — KHÔNG trùng apps/web (:5273). App admin phục vụ trên
    // hostname/origin riêng (xem PRD v2 §3.1 isolation), nên cố tình tách cổng dev.
    port: 5274,
  },
});
