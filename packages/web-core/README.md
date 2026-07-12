# @mediaos/web-core

Auth store · api-client · `useCan()` · i18n dùng chung cho `apps/app`, `apps/console`, `apps/auth`.

## Bẫy stale-dist khi chạy test FE (đọc trước khi báo FE đỏ)

`apps/app`/`apps/console`/`apps/auth` import `@mediaos/web-core` qua `dist/` (build output), KHÔNG qua `src/`
trực tiếp (xem `main`/`module`/`exports` trong `package.json`). Nếu bạn vừa sửa `packages/web-core/src/**`
(vd. thêm key vào `query-keys.ts`) rồi chạy thẳng:

```bash
pnpm --filter @mediaos/app test
```

lệnh này gọi `vitest run` qua **pnpm workspace filter**, KHÔNG qua Turbo pipeline — nên **KHÔNG** tự resolve
`dependsOn: ["^build"]` (khai ở `turbo.json`). Nếu `dist/` chưa build lại, test FE sẽ đỏ với lỗi runtime kiểu
`X is not a function` dù `src/` đã đúng — không phải regression FE thật.

**Trước khi chạy test/verify FE sau khi sửa `web-core/src`, luôn 1 trong 2:**

1. Rebuild thủ công trước:
   ```bash
   pnpm --filter @mediaos/web-core build
   pnpm --filter @mediaos/app test
   ```
2. Hoặc dùng lệnh gốc qua Turbo (tự resolve `^build` theo dependency graph, khuyến nghị cho acceptance/CI):
   ```bash
   pnpm test
   # hoặc scoped: pnpm exec turbo run test --filter=@mediaos/app
   ```

Xem thêm ghi chú lỗi tương tự: memory lesson `web-core-stale-dist-white-page`.
