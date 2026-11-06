/**
 * S19-OPS-ZOD4-1 — cấu hình vite-node cho TIẾN TRÌNH CON của census default (`zod-default-census-local.ts`).
 *
 * Census nạp tệp schema cục bộ của app/console, mà các tệp đó import `@mediaos/web-core`. package.json của web-core trỏ
 * `dist/` — job API CI chỉ build `@mediaos/contracts`, KHÔNG build web-core ⇒ không resolve được gói ⇒ census báo
 * «tệp không nạp được» (fail-closed, đúng nhưng đỏ oan theo thứ tự build). Ánh xạ thẳng về MÃ NGUỒN để census không phụ
 * thuộc thứ tự build của từng job. `@mediaos/contracts` giữ đường dist (mọi job đều build nó trước test).
 */
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");

// Object thường (không `defineConfig`): apps/api không phụ thuộc trực tiếp `vite`, Vite nhận config dạng object.
export default {
  resolve: {
    alias: {
      "@mediaos/web-core": path.join(repoRoot, "packages", "web-core", "src", "index.ts"),
    },
  },
};
