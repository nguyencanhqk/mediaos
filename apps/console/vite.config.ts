import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * S10-PERF-LOADPATH-1 — tách vendor lõi ra chunk riêng.
         *
         * KHÔNG giảm byte lần tải đầu: mọi thứ ở đây đều statically reachable từ `main.tsx`, chia nhỏ
         * chỉ đổi 1 request thành N request cùng tổng byte. Cái nó mua là CACHE THEO NHỊP ĐỔI — deploy
         * sửa code app không thổi bay react/tanstack/i18next đã nằm sẵn trong trình duyệt. Chỉ có
         * nghĩa khi đi CẶP với `public/_headers` (assets `immutable`); thiếu vế đó thì vô ích.
         *
         * pnpm đặt gói ở `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/` nên phép so phải neo vào
         * `node_modules/<pkg>/` PHÍA TRONG. Dấu phân tách cuối là BẮT BUỘC: thiếu nó thì `react` nuốt
         * luôn `react-dom`, `react-i18next`, `react-hook-form`…
         */
        manualChunks(id) {
          // rollup CHUẨN HOÁ mọi module id về dấu `/`, kể cả trên Windows — nên so chuỗi thẳng là đủ,
          // không cần regex (và khỏi bẫy escape `[\/]` trong character class).
          const inPkg = (pkg: string) => id.includes(`/node_modules/${pkg}/`);
          if (!id.includes("/node_modules/")) return undefined;
          if (inPkg("react") || inPkg("react-dom") || inPkg("scheduler")) return "vendor-react";
          if (id.includes("/node_modules/@tanstack/")) return "vendor-tanstack";
          if (inPkg("i18next") || inPkg("react-i18next")) return "vendor-i18n";
          if (
            inPkg("socket.io-client") ||
            inPkg("socket.io-parser") ||
            inPkg("engine.io-client") ||
            inPkg("engine.io-parser")
          ) {
            return "vendor-realtime";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    // FS-4 SSO dev: app Hệ thống (tenant, aud=user) phục vụ trên origin riêng `console.localhost:5278`
    // để cookie phiên `Domain=.localhost` chạy giống prod. TÁCH BẠCH operator plane apps/admin (:5274).
    port: 5278,
    // dev-online (VITE_TUNNEL_HOST set): bind dual-stack `::` để cloudflared quay `localhost` không treo IPv4.
    host: process.env.VITE_TUNNEL_HOST ? "::" : undefined,
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
    port: 5278,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
