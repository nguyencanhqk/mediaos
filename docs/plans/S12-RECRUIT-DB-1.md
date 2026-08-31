# Plan S12-RECRUIT-DB-1 — Schema + migration RECRUIT theo DB-14

> 🔴 Crown (permission seed + RLS + append-only). **Nguồn sự thật thi công = [DB-14 §4–§9](<../DB/DB-14 RECRUIT Database Design.md>) + [SPEC-12 §11–§13](<../SPEC/SPEC-12 RECRUIT.md>)** — hai file đã qua **plan-reviewer đối kháng PASS 2 vòng** (31/08/2026). File này KHÔNG lặp lại thiết kế — chỉ chốt **thứ tự thao tác, neo file cụ thể và bằng chứng nghiệm thu**. Lệch giữa file này và DB-14 ⇒ DB-14 thắng. *(Bản v2 — đã vá theo plan-reviewer vòng 1 của chính plan này: B1–B4 · H1–H4 · M1–M5.)*

## 0. Điểm xuất phát (đo 31/08/2026, reviewer đã xác minh từng neo)

- Head migration: idx 225 / `0558_s11officedash1_widgets_asset_room`, `when 1717587347000` ⇒ nhận **0559/0560/0561** với `when` **tăng nghiêm ngặt 1717587348000 / 1717587349000 / 1717587350000** (khuôn +1000/entry — migrator áp theo `when`, sai là bỏ qua trong im lặng; `migration-not-in-journal-is-silently-skipped`). Đọc lại `apps/api/migrations/meta/_journal.json` lúc chạy.
- Hàng `modules.RECRUIT` đã pre-seed inactive (`0435`, sort_order 9); pin `EXTENSION_INACTIVE_MODULES` tại `apps/api/test/integration/migration-smoke.int-spec.ts:99` **đã có** `"RECRUIT"` — không sửa.
- Điểm chèn `cleanupTenants()`: `apps/api/test/helpers/seed.ts` — chèn khối RECRUIT **sau khối ROOM (~:557)**, trước `DELETE FROM org_units` (`:653`) và `DELETE FROM users` (`:758`). **Ràng buộc M3:** vị trí này chỉ an toàn vì `file_links`/`files` (xoá ở `:458-459`, TRƯỚC khối RECRUIT) liên kết CV theo đa hình KHÔNG-FK — WO này **KHÔNG tạo FK nào từ `file_links` sang `candidates`**.
- FK đích composite đã có sẵn `UNIQUE (company_id, id)`: `org_units`/`positions`/`employee_profiles` (0535) · `users` (0533) — KHÔNG cần ALTER bảng đích; 0559 tiền-kiểm hậu nghiệm cả 4.

## 1. Thứ tự thao tác (một nhánh, một PR)

1. **Drizzle schema** `apps/api/src/db/schema/recruit.ts` (mới, PARITY-only) + export **additive** vào `schema/index.ts` — 8 bảng đúng DB-14 §6. Barrel là `export *` (`index.ts:44,117`): đo 31/08 không có tên `candidate|offer|interview` trùng trong `schema/**` lẫn `packages/contracts/src/**` — nguy cơ TS2308 hiện bằng 0, nhưng **cổng cơ học bắt buộc ở bước 8**: `pnpm --filter @mediaos/contracts build && pnpm typecheck` (M4; `contracts-barrel-collides-with-parked-media`).
2. **Mig A `0559_s12recruitdb1_recruit_ddl.sql`** — theo DB-14 §9A, khuôn `0549`: 8 bảng → RLS+FORCE + policy literal-GUC (TRƯỚC mọi INSERT) → composite FK (nội bộ NO ACTION; `users` theo danh sách ĐÓNG DB-14 §4.2 — 5 bảng mutable `SET NULL (col)`, `candidate_stage_events.acted_by` NO ACTION) → GRANT phát một lần (cse = SELECT+INSERT duy nhất; participants = SELECT+INSERT; feedbacks/offers = SELECT+INSERT + UPDATE cấp cột; 4 bảng mutable SELECT/INSERT/UPDATE; **0 DELETE toàn cục** — không GRANT-rồi-REVOKE) → VERIFY fail-loud (`aclexplode`, ACL so ĐÚNG BẰNG cả bảng lẫn cột, composite FK DƯƠNG đúng-bằng **27 dòng** + đếm thô FK≥2 cột = 27 + 0 FK một-cột ngoài companies, `pg_get_expr(indpred)` so đúng chuỗi cho 4 unique + 2 index check-duplicate).
3. **Cùng commit với A**:
   - `test/helpers/seed.ts` `cleanupTenants()` +8 dòng DELETE con→cha (`interview_feedbacks` → `interview_participants` → `interviews` → `offers` → `candidate_notes` → `candidate_stage_events` → `candidates` → `job_openings`), chèn tại ~:557.
   - **`apps/api/test/integration/rls-registry.ts`** (B2 — KHÔNG phải rls-coverage-assert): +8 case `RLS_TABLES` với **8 `seedRow` chain FK hợp lệ cùng company** (khuôn `seedAssetChain:2749-2772`): user → employee_profile → org_unit → job_opening → candidate → interview → participant/feedback/offer; cổng ép là `rls-guards.int-spec.ts:52-72` ("bảng có company_id chưa đăng ký harness" = ĐỎ). Đây là phần việc lớn nhất của bước này.
4. **Mig B `0560_s12recruitdb1_seed_role_perms_audit.sql`** — theo DB-14 §9B, khuôn `0554`: guard hàng modules RECRUIT **forward-compatible** (chỉ RAISE khi hàng KHÔNG tồn tại) · role `recruiter` id cố định `…0014` (`company_id NULL`, `is_system=true`, `requires_two_factor=false` tường minh, KHÔNG canonical) · 16 cặp (7 cặp resource `candidate` sensitive TRUE, 9 false; **hai namespace CỐ Ý khác nhau — M5:** audit `object_type` snake `job_opening`, resource cặp quyền dash `job-opening`) · 42 grant §9f = DELETE-wrong-scope + INSERT ON CONFLICT, **verify per-row: vòng FOR 42 bộ `(role, action, resource, scope)` mỗi bộ ĐÚNG 1 hàng (B4 — đếm-42 chỉ là sanity phụ)** · UNION-ADD 4 giá trị audit `job_opening`/`candidate`/`interview`/`offer` (clone NGUYÊN khối `0554(5)`/`0545` — neo 2 tầng, NO-LOSS/NO-GAIN) + `AUDIT_OBJECT_TYPES` (schema/audit.ts) += 4 cùng commit.
5. **Mig C `0561_s12recruitdb1_noti_recruit.sql`** — theo DB-14 §9C, khuôn `0555`: baseline guard forward-compatible (needle RECRUIT/Recruit, đòi ROOM/Room có sẵn) · nới CHECK **CẢ HAI bảng** (`notification_events` + `notifications`, giữ nhánh `IS NULL OR`, re-stamp superset đo lại lúc chạy) · 4 event `DedupeKey`/window NULL (016 Normal · 017 High · 018 Normal · 019 Normal; `is_system_event=false` cả 4 — SPEC-12 §17) + 4 template IN_APP/vi-VN (ON CONFLICT nhắm partial unique) · verify fail-loud. **Cùng commit 0561 (B1):** `notification-event-catalog.const.ts` — `NotiModuleCode` += `"RECRUIT"` · `NotiType` += `"Recruit"` · 4 entry · pin count 67→**71** / 53→**57** · `packages/contracts/src/notification.ts` `notificationTypeEnumSchema` += `"Recruit"` · `packages/contracts/src/notification.spec.ts:31-32` cập nhật literal · pin `noti-seed-catalog-permissions.int-spec.ts` (67/53→71/57) · pin template `s5-noti-fix1-deeplink.int-spec.ts` (53→57) · `schema/noti.ts` CHECK parity += 'Recruit'.
6. **Contracts** `packages/contracts/src/recruit.ts` (CHỈ enum/hằng — khuôn `room.ts` WO DB) + spec pin mirror hai chiều (mảng literal chép từ migration, khuôn `room.spec.ts`) + barrel `index.ts` additive; **Zod move-stage khi BE-1 viết DTO phải ĐỦ 6 giá trị** (ghi chú trong file — mã 014 phải sống).
7. **Test (RED trước cho phần nhạy cảm)** — int-spec chính: **`apps/api/test/integration/s12-recruit-db1-invariants.int-spec.ts`** (khuôn `s11-room-db1-invariants` A–H + `s11-asset-db1-invariants:723-730`), trên LANE_DB:
   - (a) RLS: không GUC ⇒ 0 hàng cả 8 bảng (FORCE); cô lập chéo tenant qua harness `rls-guards` (8 case bước 3).
   - (b) **Append-only KHÔNG-RỖNG (B3):** (i) ca ALLOW — app role dưới GUC INSERT + SELECT `candidate_stage_events` và `interview_participants` PHẢI thành công; (ii) ma trận ACL 8 bảng × {SELECT,INSERT,UPDATE,DELETE} đọc bằng `aclexplode` so **đúng bằng** kỳ vọng DB-14 §6 (bảng LẪN cột); (iii) thử thật từ app pool: UPDATE/DELETE hai bảng chỉ-INSERT ⇒ 42501, UPDATE cột ngoài allowlist feedbacks/offers ⇒ 42501 (đối chứng UPDATE cột trong allowlist OK).
   - (c) Grant §9f: **set-equality 42 bộ `(role, action, resource_type, data_scope, effect)`** + census **4 hình dạng wildcard** (`p.action IN (x,'*') AND p.resource_type IN (y,'*')`, in effect — `permission-grant-census-must-cover-four-wildcard-shapes`).
   - (d) 3 unique chốt cuối A/B từng cặp (`pg-reports-arbitrary-check-when-multiple-violated`) + đối chứng dương.
   - (e) CHECK NOTI cả hai bảng dưới app role (giá trị lạ ⇒ 23514 đích danh) + 4 event/template thuộc tính.
   - (f) `EXPLAIN` 2 index check-duplicate — **gieo ≥ 200 hàng + `ANALYZE`, đối chứng `SET enable_seqscan = off`, so đúng biểu thức service** (`lower(email)` · `regexp_replace(phone,'[^0-9+]','','g')`) — M1, `pg-planner-index-assert-trap`.
   - (g) migration-smoke giữ RECRUIT inactive (pin sẵn — chỉ chạy lại).
   - (h) **H4:** `recruiter` KHÔNG vào `DASH_CANONICAL_ROLES`/`NOTI_CANONICAL_ROLES` (khuôn asset `:771-772`) · **M8:** `SuperAdminBootstrapService` giải đúng 7 cặp sensitive mới · **idempotency:** chạy lại NGUYÊN 0560 + 0561 qua owner ⇒ 0 exception, count không đổi (khuôn room H1).
8. **Cổng:** `pnpm --filter @mediaos/contracts build && pnpm typecheck` (M4) → `bash harness/check.sh --lane-db` XANH không banner (bao `xtenant-fk-ratchet` + `fk-tenant-census` — M2) → FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) → PR.
9. **Docs cùng PR (H1):** `docs/erd-current.md` — §9 bổ sung `candidate_stage_events` vào danh sách ledger + Phụ lục A 8 bảng "đã build"; `docs/DB/DB-10` mục seed RECRUIT đánh dấu đã seed (0560/0561).

## 2. Không làm ở WO này

Bật `modules.is_active` (FE-1) · widget DASH (DASH-1, khuôn 0558) · module NestJS/route (BE-1) · `createEmployeeFromCandidateTx` (BE-1) · seed sequence_counters (không có — dùng lại `employee_code` HR) · FK từ `file_links` sang `candidates` (M3 — CV đi liên kết đa hình Foundation Files).

## 3. Bằng chứng đóng WO (RED-first cho vùng đỏ — H3)

- Journal +3 entry đúng thứ tự, `when` tăng nghiêm ngặt.
- `check.sh --lane-db` xanh không banner; contracts build + typecheck xanh.
- **Chứng minh lưới KHÔNG-RỖNG bằng vi phạm giả trên LANE_DB, mỗi ca ít nhất 1 lần (ghi bằng chứng vào PR):**
  - (a) `GRANT UPDATE ON candidate_stage_events TO mediaos_app` ⇒ ca 7(b)(ii) phải ĐỎ (rồi REVOKE lại);
  - (b) `ALTER TABLE candidates NO FORCE ROW LEVEL SECURITY` ⇒ ca RLS/verify 0559 replay phải ĐỎ (rồi FORCE lại);
  - (c) grant-count/per-row: đổi 1 scope ⇒ verify 0560 replay + ca 7(c) phải ĐỎ;
  - (d) audit-anchor: giá trị lạ trong CHECK ⇒ NO-GAIN của 0560(5) phải ĐỎ.
- backlog flip + STATUS regen.
