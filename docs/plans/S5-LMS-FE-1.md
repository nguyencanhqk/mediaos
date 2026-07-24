# S5-LMS-FE-1 — FE `/me`: card "Đào tạo" + trang `/me/training`

> Zone **vàng** · LIGHT gate (typescript + react + quality-gate) · depends_on **S5-LMS-BE-3 ✓** (PR #266).
> Nguồn: `docs/plans/S5-LMS-WAVE.md §4 B06`. Contract DTO = `packages/contracts/src/me-training.ts` (đã ship BE-3).

## 1. Mục tiêu (done_when)

1. Card "Đào tạo" trong `MeOverviewPage` — số khoá + % gần nhất, **fail-soft** (403/502/no_account KHÔNG kéo sập overview, mirror 5 section hiện có, SPEC-09 §18.2).
2. Trang `/me/training` — danh sách khoá (title · % · completed/total · thời lượng) + tổng hợp + nút **"Mở LMS" → /lms**; đủ 3 trạng thái loading/error/empty.
3. Gate `access:lms` bằng `useCan`/`PermissionGate` (KHÔNG hard-code role) — không có quyền ⇒ KHÔNG thấy card lẫn menu.
4. i18n namespace `me` (vi) đầy đủ; unit test 2 component chính; LIGHT gate xanh.

## 2. Bất biến áp dụng

- **Masking = việc SERVER** (CLAUDE.md §2/§5): FE chỉ render field DTO server trả — contract `me-training.ts` đã `.strip()` field lạ/PII ở tầng BE. FE KHÔNG khai type cục bộ, import lại từ `@mediaos/contracts`.
- **Fail-soft chảy ngược** (SPEC-09 §18.2): 1 nguồn lỗi (LMS chết → 502, hoặc no_account) KHÔNG phá cả trang `/me`. Card training tự khoanh vùng trạng thái của nó (query RIÊNG, tách khỏi `GET /me/overview`).
- Envelope BE khác section-envelope: `{status: 'ok'|'no_account', progress}` — `no_account` = fail-soft empty (KHÔNG lỗi), `progress=null`.

## 3. Thay đổi theo tầng (additive)

| Tầng | File | Thay đổi |
| --- | --- | --- |
| contracts | `me-training.ts` | ĐÃ có (BE-3) — chỉ rebuild dist |
| web-core | `lib/me-api.ts` | `meApi.getTraining()` → `apiFetch('/me/training', meTrainingResponseSchema)` |
| web-core | `lib/query-keys.ts` | `meKeys.training()` |
| web-core | `lib/registry.ts` | ROUTE_REGISTRY `me.training` (path `/me/training`, gate `access:lms`) |
| web-core | `i18n/.../nav.ts` | `routeTitle.meTraining` |
| app | `routes/me/components/MeTrainingCard.tsx` | Card overview (own query, fail-soft, gated) |
| app | `routes/me/MeTrainingPage.tsx` | Trang danh sách + nút Mở LMS |
| app | `routes/me/MeOverviewPage.tsx` | Mount `<MeTrainingCard />` (chỉ khi `useCan(access,lms)`) |
| app | `routes/me/constants.ts` | `LMS_ACCESS_PAIR` + `ME_LMS_OPEN_PATH='/lms'` |
| app | `layouts/workspace/sidebar-registry.ts` | ME_SIDEBAR entry `me.training` (group "Đào tạo", gate `access:lms`) |
| app | `router.tsx` | `meTrainingRoute` + đăng ký cây |
| app | `i18n/locales/vi/me.ts` | `trainingCard.*` + `trainingPage.*` |

## 4. Bẫy đã biết (memory)

- `apifetch-drops-pagination-bare-array`: response `{status,progress}` (object) — apiFetch giữ nguyên object (KHÔNG phải `{data,meta}` envelope), parse qua `meTrainingResponseSchema`. Không dùng field `data`.
- `fe-theme-light-dark-system`: thanh tiến độ + màu dùng theme token (`bg-brand`, `bg-muted`), KHÔNG hard-code hex.
- `web-core-stale-dist-white-page` / `stale-contracts-dist-typecheck-false-red`: sau khi sửa web-core + contracts phải `pnpm --filter @mediaos/contracts build` rồi `--filter @mediaos/web-core build` trước typecheck app.

## 5. Test

- `MeTrainingCard.spec.tsx`: thiếu access:lms → KHÔNG render/gọi API · loading · ok (số khoá + %) · no_account (empty) · error 502 (fail-soft, có retry).
- `MeTrainingPage.spec.tsx`: gate forbidden · loading · error+retry · empty(no_account/0 khoá) · ok render danh sách + nút "Mở LMS" navigate `/lms`.
