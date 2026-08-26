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
    // FS-4 SSO dev: vỏ nghiệp vụ hợp nhất (tenant, aud=user) phục vụ trên origin riêng `web.localhost:5273`
    // để cookie phiên `Domain=.localhost` chạy giống prod. Đây là app đích mặc định sau đăng nhập (apps/auth).
    port: 5273,
    // dev-online (VITE_TUNNEL_HOST set): bind dual-stack `::` để cloudflared quay `localhost` không treo
    // IPv4 rồi mới fallback IPv6 (xem khối preview). Local `m dev` giữ mặc định (localhost).
    host: process.env.VITE_TUNNEL_HOST ? "::" : undefined,
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
    // Nghe DUAL-STACK (IPv4 + IPv6). Vite mặc định bind `localhost` → trên Windows chỉ ra `[::1]` (IPv6).
    // cloudflared quay số `http://localhost:PORT` và thường thử IPv4 `127.0.0.1` TRƯỚC → gặp socket chết,
    // treo ~2s rồi mới fallback IPv6 ⇒ "load lâu khi khởi động" + thỉnh thoảng ERR_CONNECTION_CLOSED khi
    // lần thử IPv4 timeout. Bind `::` (Node dual-stack) phục vụ cả `127.0.0.1` lẫn `[::1]` ⇒ hết treo.
    host: "::",
    port: 5273,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
