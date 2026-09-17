# S15-PAYROLL-DEBT-1 — Trả nợ vệ sinh S15 (2 file > 800 · prettier · comment · ConfirmDialog · xoá ngân sách · test 054 · download-blob · use-local-pref)

> 🟡 LIGHT gate · không migration · không đổi hành vi BE. Owner chốt phạm vi 17/09/2026: «vệ sinh + FE nhỏ»;
> tính năng / hot-file / vùng đỏ tách WO riêng.

## 1. Kiểm kê nợ S15 (đo lại trên master `4d3a3463`)

| #   | Nợ                                                                                       | Nguồn          | Xử lý                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/app/src/i18n/locales/vi/payroll.ts` 879 dòng                                       | FE-2           | ✅ tách track C → `payroll-disbursement.ts` (spread) ⇒ 686 + 207                                                                |
| 2   | `packages/contracts/src/payroll.ts` 865 dòng                                             | BE-1→BE-4      | ✅ tách §6 → `payroll-bonus-penalties.ts`, §7 → `payroll-readiness.ts` ⇒ 698 + 88 + 96                                          |
| 3   | `s15-payroll-be4-batches.int-spec.ts` 945 dòng                                           | BE-4B §4       | ↩️ **BỎ khỏi WO** — bản tách bằng helper dùng chung làm ĐỎ CI (`supertest-listen-ratchet`, xem §2 D2) ⇒ chuyển `done_when` QA-1 |
| 4   | Prettier lệch `system.ts` · `api-params.ts` · `two-factor-api.spec.ts`                   | FE-1 N2        | ✅ `prettier --write` (`StatusBadges.tsx` đã sạch từ trước)                                                                     |
| 5   | Comment `auth.service.ts` ghi CHECK `active\|suspended` (mig 0430)                       | BE-4B §4       | ✅ sửa: `active\|invited\|suspended` (0002) + `locked` (0450) — chỉ comment                                                     |
| 6   | `ConfirmDialog` không có slot `children`                                                 | FE-3           | ✅ thêm `children?` + hộp «hoàn tất đợt» dùng lại                                                                               |
| 7   | `BudgetFormDialog` thiếu xoá mềm (075 `{delete:true}`)                                   | FE-3           | ✅ nút xoá HAI bước (khuôn `DependentFormDialog`), gác `manage:payroll-budget`                                                  |
| 8   | Không có ca render dialog xem trước 054                                                  | FE-2           | ✅ 5 ca ở `payroll-debt-dialogs.spec.tsx`                                                                                       |
| 9   | `triggerBlobDownload` 3 bản sao + 1 inline, payroll import chéo từ attendance            | FE-3 N4        | ✅ một bản `apps/app/src/lib/download-blob.ts`                                                                                  |
| 10  | `use-local-pref.ts` sinh đôi app ↔ `packages/ui`                                         | UI-SHELL-1     | ✅ app re-export `@mediaos/ui`                                                                                                  |
| 11  | G3 — không có màn sửa/xoá phiên bản hồ sơ lương (022)                                    | FE-1 §6        | ➡️ WO mới `S15-PAYROLL-FE-5` (tính năng)                                                                                        |
| 12  | `sidebar-registry.ts` 1439 dòng                                                          | UI-SHELL-1     | ➡️ WO mới `S15-UI-SHELL-2` (hot-file)                                                                                           |
| 13  | Nợ BE-2 không WO: N+1 `assertGraphsAfterEdit` · catalog không trần · 6 CHECK · precision | BE-2 review    | ➡️ WO mới `S15-PAYROLL-BE-2B` (🔴 — chạm máy tính lương)                                                                        |
| 14  | Tổng cột toàn kỳ (> 20 dòng) · spec T4–T6 · đột biến (k) NOTI-027                        | FE-2/FE-3/BE-4 | ➡️ ghi thêm `done_when` của `S15-PAYROLL-BE-5` và `S15-PAYROLL-QA-1`                                                            |

## 2. Quyết định

- **D1 — tách file giữ nguyên hợp đồng công khai.** i18n: khoá vẫn ở GỐC namespace (spread như
  `payroll-catalog.ts`). Contracts: file mới import NGƯỢC từ `./payroll`, không re-export tên của nó
  (luật sẵn có ở `index.ts` — trùng tên ở hai star-export là lỗi mơ hồ lúc build).
- **D2 — KHÔNG tách int-spec be4-batches ở WO này (sửa sau CI #516 đỏ).** Bản tách đầu dùng helper
  `payroll-be4-batches-suite.ts` boot app + dựng `request(app.getHttpServer())` dùng chung. Cổng
  `test/foundation/supertest-listen-ratchet.unit-spec.ts` chỉ phân tích từng file nên có chốt «không helper dùng
  chung nào chạm `getHttpServer`» ⇒ ĐỎ ở cả hai job API (1 ca / 13 017). Local chỉ chạy 2 int-spec nên sót.
  Owner chọn khôi phục file như master; việc tách chuyển QA-1 kèm ràng buộc: mỗi file tự boot app + tự dựng
  request, helper chỉ giữ phần gieo DB (hoặc nâng census xuyên file trước).
- **D3 — download-blob về `apps/app/src/lib/`** (hạ tầng trung lập, không phải coupling feature↔feature).
  Giữ đúng thân của 3 bản giống hệt (revoke ngay trong `finally`). `recruit/PipelinePage` giữ bản inline
  RIÊNG (revoke trễ qua `setTimeout`) — biến thể có chủ đích, KHÔNG gộp ở WO này.
- **D4 — xoá ngân sách HAI bước trong chính dialog sửa**, như `DependentFormDialog` (không mở hộp lồng
  hộp). `mutationFn` fail-closed khi thiếu hàng — không PATCH tới id rỗng.
- **D5 — `ConfirmDialog.children` tuỳ chọn**: vắng ⇒ thân như cũ (tiêu đề `sr-only`), 36 nơi gọi không đổi.

## 3. Bằng chứng (đo 17/09/2026)

| Cổng                                                       | Kết quả                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| i18n `payroll` trước/sau tách                              | object sâu BẰNG NHAU (dump tsx, so JSON sắp khoá)                                                                                                                                                                                                                                                                                                                                   |
| contracts export trước/sau tách                            | danh sách tên + hình zod (typeName/values/shape keys) GIỐNG HỆT (1 374 dòng)                                                                                                                                                                                                                                                                                                        |
| `pnpm turbo run typecheck` api · web-core · app            | ✅ 6/6                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm turbo run build --filter=@mediaos/app...` (gồm vite) | ✅ 4/4                                                                                                                                                                                                                                                                                                                                                                              |
| `@mediaos/contracts` vitest                                | ✅ 635/635                                                                                                                                                                                                                                                                                                                                                                          |
| `@mediaos/app` vitest                                      | ✅ **286 file / 2 851 test** (spec mới: `payroll-debt-dialogs` 9 · `ConfirmDialog` 3)                                                                                                                                                                                                                                                                                               |
| `@mediaos/web-core` · `@mediaos/ui` vitest                 | ✅ 742 · 178                                                                                                                                                                                                                                                                                                                                                                        |
| Đột biến: gỡ `canDelete &&` ở nút xoá                      | ❌ đỏ đúng ca DENY «thiếu manage:payroll-budget»                                                                                                                                                                                                                                                                                                                                    |
| Đột biến: gỡ `!latestRate` khỏi khoá nút «Tính thử»        | ❌ đỏ đúng 2 ca (thiếu quyền tỉ lệ · chưa có bản tỉ lệ)                                                                                                                                                                                                                                                                                                                             |
| CI #516 lượt 1                                             | ❌ 1 ca đỏ `supertest-listen-ratchet` (helper int-spec) ⇒ bỏ phần tách; ratchet local 14/14 sau khi khôi phục                                                                                                                                                                                                                                                                       |
| `bash harness/check.sh --quick`                            | ✅ XANH (secret-literals · lint · typecheck · migration-no-drop · tooling 177)                                                                                                                                                                                                                                                                                                      |
| LIGHT gate `typescript-reviewer`                           | **PASS mục 1–2** (helper suite · xoá ngân sách — chặt hơn khuôn Dependent); reviewer DỪNG SỚM theo hook chi phí. Mục còn lại tự soát bằng lệnh: `ConfirmDialog` giữ `onClose` no-op khi `busy` · 0 import/mock trỏ path đã xoá (vá 1 comment chết ở `recruit/PipelinePage`) · `depends_on` 4 WO mới đều tồn tại + `id-uniqueness` 14/14 · spec không rỗng nghĩa (2 đột biến ở trên) |

## 4. Nợ để lại

- Bản inline `recruit/PipelinePage` (revoke trễ) chưa gộp — nếu revoke trễ là đúng thì nên áp cho bản `lib/`
  luôn; cần một ca đo trên trình duyệt thật, không đo được trong jsdom.
- 3 (int-spec 945 dòng), 11–13 và 14 như bảng §1 (đã có WO / `done_when`).
- Bài học: WO chạm `apps/api/test/**` phải chạy cả `test/foundation/*.unit-spec.ts` (cổng tĩnh) trước khi PR, không chỉ file int-spec đã đổi.
