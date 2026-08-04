// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat config dùng chung cho cả monorepo. Mỗi package `lint` = `eslint .` → tự tìm config này ở root.
// Dùng preset KHÔNG type-checked (không cần parserOptions.project) → CI nhanh, không kén thứ tự build.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // S6-REL-1 (D3): snapshot BẤT BIẾN của dist dùng cho deploy PROD — JS đã biên dịch, cùng loại
      // với dist. Không loại trừ thì mỗi lần snapshot sẽ đổ hàng nghìn lỗi lint giả (require()/
      // no-cond-assign của output tsc) và làm ĐỎ cổng verify.
      "apps/api/releases/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.config.{js,mjs,cjs}",
      "apps/web/src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Node scripts thuần (seed/demo .js|.mjs|.cjs) — cấp node + fetch globals để no-undef không báo nhầm
    // (block ts/tsx ở trên chỉ phủ *.{ts,tsx}; *.config.{js,mjs,cjs} đã ignore ở đầu file).
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Frontend: quy tắc hooks + fast-refresh.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // S7-CHAT-FE-1 — `socket.io-client` CHỈ được import ở ĐÚNG MỘT file singleton dùng chung app-shell.
    //
    // Namespace `/ws` chở CẢ `chat:*` LẪN `notification:*`. Một `io()` thứ hai ở bất kỳ đâu sẽ mở kết
    // nối song song, nhân đôi mọi sự kiện vào store và phá dedupe theo `id` — hỏng theo kiểu chỉ lộ ra
    // dưới tải, không lộ ra khi mở một tab test. Ép bằng lint chứ KHÔNG bằng quy ước trong DoD: một
    // dòng grep review-time bỏ sót ngay lần đầu có người thêm file mới.
    //
    // ⚠️ `files` chỉ phủ 2 nơi khai dưới đây. Có app FE thứ tư dùng CHAT/NOTI thì PHẢI mở rộng mảng này
    // cùng lúc — block không tự động phủ (`apps/lms` là app Next.js RIÊNG, có socket của nó, cố ý ngoài).
    files: ["apps/app/src/**/*.{ts,tsx}", "packages/web-core/src/**/*.{ts,tsx}"],
    ignores: ["packages/web-core/src/lib/realtime-socket.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "socket.io-client",
              message:
                "Dùng getAppSocket() từ @mediaos/web-core — KHÔNG tự io() (docs/plans/S7-CHAT-FE-1.md §1.2).",
            },
          ],
        },
      ],
    },
  },
);
