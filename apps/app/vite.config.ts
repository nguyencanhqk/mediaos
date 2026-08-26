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
         * S10-PERF-LOADPATH-1 â tÃ¡ch vendor lÃµi ra chunk riÃªng.
         *
         * KHÃNG giáº£m byte láº§n táº£i Äáº§u: má»i thá»© á» ÄÃ¢y Äá»u statically reachable tá»« `main.tsx`, chia nhá»
         * chá» Äá»i 1 request thÃ nh N request cÃ¹ng tá»ng byte. CÃ¡i nÃ³ mua lÃ  CACHE THEO NHá»P Äá»I â deploy
         * sá»­a code app khÃ´ng thá»i bay react/tanstack/i18next ÄÃ£ náº±m sáºµn trong trÃ¬nh duyá»t. Chá» cÃ³
         * nghÄ©a khi Äi Cáº¶P vá»i `public/_headers` (assets `immutable`); thiáº¿u váº¿ ÄÃ³ thÃ¬ vÃ´ Ã­ch.
         *
         * pnpm Äáº·t gÃ³i á» `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/` nÃªn regex pháº£i neo vÃ o
         * `node_modules/<pkg>/` PHÃA TRONG. Dáº¥u phÃ¢n tÃ¡ch cuá»i lÃ  Báº®T BUá»C: thiáº¿u nÃ³ thÃ¬ `react` nuá»t
         * luÃ´n `react-dom`, `react-i18next`, `react-hook-form`â¦
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
    // FS-4 SSO dev: vÃ¡Â»Â nghiÃ¡Â»Âp vÃ¡Â»Â¥ hÃ¡Â»Â£p nhÃ¡ÂºÂ¥t (tenant, aud=user) phÃ¡Â»Â¥c vÃ¡Â»Â¥ trÃÂªn origin riÃÂªng `web.localhost:5273`
    // ÃÂÃ¡Â»Â cookie phiÃÂªn `Domain=.localhost` chÃ¡ÂºÂ¡y giÃ¡Â»Âng prod. ÃÂÃÂ¢y lÃÂ  app ÃÂÃÂ­ch mÃ¡ÂºÂ·c ÃÂÃ¡Â»Ânh sau ÃÂÃÂng nhÃ¡ÂºÂ­p (apps/auth).
    port: 5273,
    // dev-online (VITE_TUNNEL_HOST set): bind dual-stack `::` ÃÂÃ¡Â»Â cloudflared quay `localhost` khÃÂ´ng treo
    // IPv4 rÃ¡Â»Âi mÃ¡Â»Âi fallback IPv6 (xem khÃ¡Â»Âi preview). Local `m dev` giÃ¡Â»Â¯ mÃ¡ÂºÂ·c ÃÂÃ¡Â»Ânh (localhost).
    host: process.env.VITE_TUNNEL_HOST ? "::" : undefined,
    // dev-online: cho phÃÂ©p host cloudflared + HMR qua wss:443 khi VITE_TUNNEL_HOST set (m dev-online).
    allowedHosts: process.env.VITE_TUNNEL_HOST
      ? [".localhost", process.env.VITE_TUNNEL_HOST]
      : [".localhost"],
    hmr: process.env.VITE_TUNNEL_HOST
      ? { host: process.env.VITE_TUNNEL_HOST, protocol: "wss", clientPort: 443 }
      : undefined,
  },
  // dev-online-fast (m dev-online-fast): serve BÃ¡ÂºÂ¢N BUILD qua `vite preview` trÃÂªn CÃÂNG cÃ¡Â»Âng dev Ã¢ÂÂ tunnel
  // ingress giÃ¡Â»Â¯ nguyÃÂªn. Bundle Ã¢ÂÂ 2-3 request/trang thay vÃÂ¬ hÃÂ ng trÃÂm module rÃ¡Â»Âi (dev-mode waterfall qua
  // tunnel ~200-350ms/request lÃÂ  nguÃ¡Â»Ân "chuyÃ¡Â»Ân trang chÃ¡ÂºÂ­m"). KhÃÂ´ng HMR Ã¢ÂÂ cÃ¡ÂºÂ§n HMR dÃÂ¹ng `m dev-online`.
  preview: {
    // Nghe DUAL-STACK (IPv4 + IPv6). Vite mÃ¡ÂºÂ·c ÃÂÃ¡Â»Ânh bind `localhost` Ã¢ÂÂ trÃÂªn Windows chÃ¡Â»Â ra `[::1]` (IPv6).
    // cloudflared quay sÃ¡Â»Â `http://localhost:PORT` vÃÂ  thÃÂ°Ã¡Â»Âng thÃ¡Â»Â­ IPv4 `127.0.0.1` TRÃÂ¯Ã¡Â»ÂC Ã¢ÂÂ gÃ¡ÂºÂ·p socket chÃ¡ÂºÂ¿t,
    // treo ~2s rÃ¡Â»Âi mÃ¡Â»Âi fallback IPv6 Ã¢ÂÂ "load lÃÂ¢u khi khÃ¡Â»Âi ÃÂÃ¡Â»Âng" + thÃ¡Â»Ânh thoÃ¡ÂºÂ£ng ERR_CONNECTION_CLOSED khi
    // lÃ¡ÂºÂ§n thÃ¡Â»Â­ IPv4 timeout. Bind `::` (Node dual-stack) phÃ¡Â»Â¥c vÃ¡Â»Â¥ cÃ¡ÂºÂ£ `127.0.0.1` lÃ¡ÂºÂ«n `[::1]` Ã¢ÂÂ hÃ¡ÂºÂ¿t treo.
    host: "::",
    port: 5273,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
