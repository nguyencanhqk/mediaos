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
    // FS-4 SSO dev: app HÃ¡Â»Â thÃ¡Â»Âng (tenant, aud=user) phÃ¡Â»Â¥c vÃ¡Â»Â¥ trÃÂªn origin riÃÂªng `console.localhost:5278`
    // ÃÂÃ¡Â»Â cookie phiÃÂªn `Domain=.localhost` chÃ¡ÂºÂ¡y giÃ¡Â»Âng prod. TÃÂCH BÃ¡ÂºÂ CH operator plane apps/admin (:5274).
    port: 5278,
    // dev-online (VITE_TUNNEL_HOST set): bind dual-stack `::` ÃÂÃ¡Â»Â cloudflared quay `localhost` khÃÂ´ng treo IPv4.
    host: process.env.VITE_TUNNEL_HOST ? "::" : undefined,
    // dev-online: cho phÃÂ©p host cloudflared + HMR qua wss:443 khi VITE_TUNNEL_HOST set (m dev-online).
    allowedHosts: process.env.VITE_TUNNEL_HOST
      ? [".localhost", process.env.VITE_TUNNEL_HOST]
      : [".localhost"],
    hmr: process.env.VITE_TUNNEL_HOST
      ? { host: process.env.VITE_TUNNEL_HOST, protocol: "wss", clientPort: 443 }
      : undefined,
  },
  // dev-online-fast: serve bÃ¡ÂºÂ£n build qua `vite preview` cÃÂ¹ng cÃ¡Â»Âng dev (xem apps/app/vite.config.ts).
  preview: {
    // Dual-stack (IPv4 + IPv6) ÃÂÃ¡Â»Â cloudflared quay `localhost` khÃÂ´ng treo IPv4 Ã¢ÂÂ xem apps/app/vite.config.ts.
    host: "::",
    port: 5278,
    allowedHosts: [".localhost", ".funtimemediacorp.com"],
  },
});
