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
    // PM-1 dev SSO: app Dự án (tenant, aud=user) phục vụ trên origin riêng `projects.localhost:5279`
    // để cookie phiên `Domain=.localhost` chạy giống prod. Mirror console/studio/people.
    port: 5279,
    allowedHosts: [".localhost"],
  },
});
