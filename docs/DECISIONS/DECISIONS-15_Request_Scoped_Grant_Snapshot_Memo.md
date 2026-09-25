# DECISIONS-15 — Memo ảnh chụp grant-kèm-scope THEO REQUEST (`getCompanyRoleGrantsWithScope`)

| | |
| --- | --- |
| **Trạng thái** | 🟡 **D1–D3 ĐÃ CHỐT 2026-09-25** (owner ký) · D4–D11 đề xuất, chờ `plan-reviewer` + FULL gate — thi hành trong WO `S16-SOCIAL-PERMMEMO-1` |
| **Ngày** | 2026-09-25 |
| **Bối cảnh** | Đo 24/09 (`S16-SOCIAL-ATTDEBT-1` §9.1): một PATCH bài có đính kèm nạp ảnh chụp grant **3 lần**, mỗi lần 1 transaction. SOCIAL có ≥6 hàm, mỗi hàm +1 transaction |
| **Vùng** | 🔴 ĐỎ — tầng permission, bán kính = MỌI module gọi `resolveStrongestScope(s)` / `getCapabilityScopes` |
| **Phạm vi** | `permission.cache.ts` (một method + `invalidateUser`) · `grant-snapshot-memo.ts` (mới) · middleware mới + `main.ts` · một biến env. **KHÔNG** migration, **KHÔNG** đổi `can()`, **KHÔNG** sửa call site nghiệp vụ |

---

## 1. Quyết định bị đảo — phát biểu cho ĐÚNG

S2-AUTH-BE-1 cố ý để `CachedPermissionRepository.getCompanyRoleGrantsWithScope` là **passthrough**: «scopes chỉ dùng cho /auth/me bootstrap, ít gọi, không nằm trên hot-path ⇒ bỏ cache để tránh thêm khoá + vòng invalidation». Tiền đề «ít gọi» nay SAI: `resolveStrongestScope(s)` đã thành cổng scope của HR, RECRUIT, DASH, AUDIT, SOCIAL, PAYROLL. Mỗi lời gọi là một `db.withTenant` thật.

Cái KHÔNG đảo: vẫn **không** cache GIỮA các request (không Valkey, không khoá chia sẻ). Mỗi request vẫn đọc DB ở lần đầu.

## 2. Ba hướng đã cân nhắc

| Hướng | Mô tả | Kết luận |
| --- | --- | --- |
| **A** | Gom batch tại từng call site (khuôn DASHACTOR-1, ATTDEBT-1, PERMCOST-1) | **LOẠI làm lời giải chung.** Đã làm 3 lần; mỗi module mới là một lần quên. Vẫn giữ các batch đã có |
| **B** | Cache Valkey TTL như `getCompanyRoleGrants` | **LOẠI.** Kéo cửa sổ thu hồi của đường scope từ 0 lên tới 300s khi DEL lỗi; thêm khoá, dính bẫy môi trường chung Valkey (VALKEYSCOPE-1) |
| **C** | Memo trong tiến trình, **theo request**, trần tuổi ngắn | **CHỌN** |

## 3. Thiết kế đã chốt

| Mục | Quyết định | Lý do |
| --- | --- | --- |
| **D1 — Ngữ nghĩa thu hồi** (owner ký) | ẢNH CHỤP + TRẦN TUỔI. Lượt đọc đầu trong request cố định grant; entry hết hạn sau **`GRANT_MEMO_MAX_AGE_MS = 2000`**; vô hiệu NGAY khi tiến trình này gọi `invalidateUser` | xem §4 |
| **D2 — Tầng** (owner ký) | Trong `CachedPermissionRepository`, CHỈ `getCompanyRoleGrantsWithScope`, khoá `(companyId, userId)`, store AsyncLocalStorage RIÊNG mở bởi `grantMemoMiddleware` | call site không đổi; mọi module hưởng |
| **D3 — Không memo `getCompanyRoleGrants`** (owner ký) | đường `can()` giữ Valkey TTL 300s như cũ | tách bán kính |
| D4 — ALS riêng | KHÔNG mở rộng store `{requestId}` của `common/logger/request-context.ts` | logger là tầng quan sát; kill-switch memo không được tắt log |
| D5 — Khoá | `companyId\u0000userId`; store tách theo instance memo; tối đa **64** khoá/request | bất biến #1; chặn rò bộ nhớ |
| D6 — Epoch toàn tiến trình | `invalidateUser` bump ở DÒNG ĐẦU (trước DEL Valkey có thể ném); entry chụp epoch lúc BẮT ĐẦU đọc | handler outbox chạy ngoài request, nên «xoá store hiện tại» không với tới request nào |
| D7 — Single-flight | lưu PROMISE; promise reject bị gỡ khỏi memo ngay | một lỗi hạ tầng không đầu độc phần còn lại của request |
| D8 — Bất biến dữ liệu | clone mỗi lần trả (kể cả caller đầu); `Date` được sao mới | `Object.freeze` không đóng băng `Date` |
| D9 — Ngoài request | passthrough y hệt hôm nay (job, outbox, WS, bootstrap) | D2 owner |
| D10 — Đồng hồ | `performance.now()` đơn điệu, tiêm được | đồng hồ tường lùi giờ có thể kéo dài memo |
| D11 — Kill-switch | `PERMISSION_GRANT_MEMO_ENABLED` mặc định `"true"`; `"false"` ⇒ không đăng ký middleware ⇒ passthrough | tắt = nhiều DB read hơn, KHÔNG BAO GIỜ nới quyền ⇒ không cần chặn ở production |

## 4. Biên thu hồi — con số và vì sao là 2000ms

- **Cửa sổ có sẵn của `can()`:** sau khi thu hồi commit, `permission.changed` chỉ được xử lý ở nhịp outbox kế tiếp (`OUTBOX_POLL_MS` mặc định 5000ms). Tức là HÔM NAY guard đã có thể cho qua ≤~5s, và tới 300s nếu DEL Valkey lỗi.
- **Trần 2000ms < 5000ms:** memo không bao giờ là cửa sổ dài nhất hệ thống.
- **p95 PROD ≤30ms** (DEVOPS-15): request thường đọc đúng MỘT lần; export/PDF lô chạy dài sẽ đọc lại mỗi 2s.
- **Nói thẳng:** vì outbox trễ 0–5s, trong THỰC TẾ phần lớn thu hồi sẽ bị chặn bởi TRẦN TUỔI, không phải `invalidateUser`. `invalidateUser` là lớp phụ, vẫn bắt buộc (test đo).
- `decideStrongestScope` kiểm `expiresAt` với `new Date()` ở MỖI lượt ⇒ grant hết hạn theo giờ không sống nhờ memo.

## 5. Đa tiến trình

- Epoch là **per-process**: `invalidateUser` ở tiến trình A không chạm tiến trình B. **Trần tuổi là biên liên tiến trình duy nhất**, và nó đủ vì ≤ cửa sổ outbox.
- PROD hôm nay là **MỘT tiến trình** (service NSSM «MediaOS-API», outbox + scheduler cùng tiến trình). dev-online là tiến trình khác, DB khác. Memo không có trạng thái chia sẻ, nên KHÔNG dính bẫy khoá chung Valkey PROD↔dev-online (VALKEYSCOPE-1).
- Khi scale ra nhiều instance (DEVOPS-01 §8.1 mục 4): KHÔNG cần đổi thiết kế; biên vẫn là max(trần 2s, cửa sổ outbox).

### 5.1 Lệch có chủ đích so với DECISIONS-12

- **ADR-12 D7 (state per-instance):** memo trong store vẫn per-instance; riêng **epoch** là toàn module, vì nguồn vô hiệu (outbox, luật §6.3) không có DI tới instance. Sai hướng chỉ gây thừa-vô-hiệu (thêm lượt đọc), không bao giờ thiếu.
- **ADR-12 D6 (promise chia sẻ không reject):** ở đây ĐƯỢC reject, vì mỗi entry luôn có caller `await`, và `try/catch` fail-closed + log của `PermissionService` là điểm xử lý lỗi có sẵn. Dùng sentinel sẽ đổi ngữ nghĩa lỗi của 3 hàm.

## 6. Hệ quả và LUẬT cho code tương lai

1. `getCompanyRoleGrantsWithScope` KHÔNG còn là «mỗi lời gọi = 1 round-trip» TRONG request HTTP. Gom batch tại call site vẫn đáng giá cho đường ngoài request (job, WS).
2. Đường outbox, job, WS gateway **không hưởng** memo (D9). Đây là chủ đích, không phải lỗi.
3. 🔴 **LUẬT:** code ghi `user_roles`/`role_permissions` rồi ĐỌC scope trong CÙNG request PHẢI gọi `bumpGrantSnapshotEpoch()` **SAU commit**. Bump trước commit là vô hiệu: lượt đọc lại thấy dữ liệu cũ và memo nó dưới epoch mới. Đo 25/09: KHÔNG có đường nào như vậy (`revokeRole` đọc scope TRƯỚC write-tx).
4. Code mới ghi grant vẫn phải phát `permission.changed` (hợp đồng `permission.module.ts`). Nợ có sẵn: ghi `role_permissions` ở role-admin KHÔNG phát; memo không làm tệ thêm (biên 2s), nhưng `can()` vẫn lệch ≤300s. Ngoài phạm vi ADR này.
5. Int-spec dựng app bằng `createNestApplication` không đăng ký middleware ⇒ chạy passthrough. Muốn đo memo phải `app.use(grantMemoMiddleware)` như `main.ts`.

## 7. Ngoài phạm vi — ghi tường minh

- Memo `getCompanyRoleGrants` / `getObjectGrants` / `getObjectGrantsBatch` (D3).
- Memo xuyên request dưới mọi hình thức.
- Sửa call site SOCIAL/HR/… để gỡ batch cũ.
- Vá nợ `role_permissions` không phát `permission.changed`.

## 8. Cổng NGƯỜI trước deploy PROD

- FULL gate + santa-method xanh; bảng mutant X1–X12 của plan §9 đỏ đúng thông điệp.
- Xác nhận `.env` PROD không override `OUTBOX_POLL_MS` lên trên 2000ms mà không cập nhật §4. Nếu có override, ghi giá trị thật vào §4 và cân lại trần.
- Rollback đã diễn tập: `PERMISSION_GRANT_MEMO_ENABLED=false` + restart NSSM ⇒ `/health` xanh, số lượt đọc/request trở về như cũ.
