# S5-ME-BE-1 — MeModule Personal Hub (BE tổng hợp read-only) + fix audit-persist

> Lane khởi tạo: `mecontracts` · `memodule` · `meinttests`. Lane sửa vòng-2: `fix-me-be1-audit-persist`.
> zone=red · crown · gate FULL. Nguồn chuẩn: SPEC-09 §10–§18 · API-11 §5/§8 · mig 0495 (tuple `access:me`).

## Mục tiêu

Endpoint tổng hợp cá nhân **read-only** (KHÔNG mutation): gom danh tính (AUTH+HR) + 4 section summary
(ATT/LEAVE/TASK/NOTI) từ reader **own-scope canonical** của module nguồn — KHÔNG tự tính lại, KHÔNG N+1 theo
widget (§18.1). 6 route class-guarded cổng `ME.ACCESS` (`access:me`, mig 0495, non-sensitive):

- `GET /api/v1/me` — identity (account luôn có; employee-link chỉ khi linked).
- `GET /api/v1/me/overview` — identity + 5 section-envelope (hr/attendance/leave/task/notification).
- `GET /api/v1/me/{attendance,leave,task,notification}-summary` — section-envelope chuyên biệt.

## Bất biến & quyết định thiết kế

1. **company_id mọi query qua `withTenant`** (BẤT BIẾN #1). MeRepository SELECT-only, AND `company_id`
   tường minh + khoá `user_id` **token-resolved** (chống IDOR §14.4 — controller KHÔNG khai
   `@Param/@Query/@Body` user_id/employee_id).
2. **Re-check cặp quyền NGUỒN in-process** TRƯỚC khi đọc mỗi section (PermissionGuard chỉ ở controller ⇒
   reader gọi thẳng service bypass guard, §11.2): HR `read:employee` · ATT `view-own:attendance` ·
   LEAVE `view-own:leave-balance` · TASK `read:task` · NOTI `read:notification`. Thiếu → `status='forbidden'`
   (KHÔNG đọc dữ liệu).
3. **Fail-soft `Promise.allSettled`** — phân loại exception CHÍNH XÁC: chỉ `ForbiddenException(403)`→`forbidden`;
   `NotFoundException(404)` từ reader→`ok`+data null (KHÔNG `forbidden`); non-HttpException/infra→`error`.
   1 nguồn hỏng KHÔNG làm 500 toàn response — HTTP luôn 200 (trừ cổng ME.ACCESS 403 / anomaly 409).
4. **DTO ở `packages/contracts/src/me.ts`** (dual-build) — section-status union CÓ `forbidden`;
   `ME_ERROR_CODES.DATA_INCONSISTENT` = nguồn sự thật DUY NHẤT cho mã lỗi (BE import lại, KHÔNG hard-code).

## Fix vòng-2 (lane `fix-me-be1-audit-persist`) — ROOT-CAUSE audit anomaly persist

**Defect (Đội 3 chặn):** `MeCurrentPersonResolver.resolve` khi phát hiện >1 employee active (§12.4) ghi
`audit.record(tx)` RỒI `throw ConflictException` **TRONG CÙNG `withTenant` tx**. `withTenant` bọc
`db.transaction` ⇒ throw trong callback ⇒ Drizzle **ROLLBACK toàn tx** ⇒ `audit_logs` **0 dòng** anomaly.
Vi phạm acceptance #4 (§12.4 "ghi audit object_type='user' để Admin/HR xử lý") + DoD §8 + BẤT BIẾN #2
(audit append-only PHẢI persist). Anomaly trở nên **vô hình** với Admin/HR.

**Sửa:** tách 2 giai đoạn (KHÔNG mở tx audit thừa cho path 0/1):

1. ĐẾM active employee trong `withTenant` (read-only, không throw ở nhánh 0/1).
2. Nếu >1: ghi audit ở **`withTenant(companyId)` RIÊNG đã COMMIT** (callback resolve → commit) TRƯỚC khi throw.
   Ghi audit fail → propagate (fail-LOUD), KHÔNG nuốt (silent-failure).
3. Sau khi audit đã persist → mới `throw ConflictException` 409 ME-ERR-DATA-INCONSISTENT.

**Chứng minh:**
- Unit (`me-current-person.resolver.spec.ts`): >1 → `withTenant` gọi **2 lần** (đọc + audit), `audit.record`
  nhận **tx KHÁC** tx đọc (tách transaction), rồi ném 409.
- Int đường-thật (`me-personal-hub.int-spec.ts` j2): flip `it.fails`→`it` — sau 409, query trực tiếp
  `audit_logs` GIỮ dòng `object_type='user'`, `object_id=<user token-resolved>` (persist THẬT trên Postgres).

**Dọn dẹp kèm:**
- Import `ME_ERROR_CODES.DATA_INCONSISTENT` từ `@mediaos/contracts` ở `me.constants.ts` (bỏ literal cục bộ —
  hết 2 nguồn-sự-thật, khớp mẫu `FOUNDATION_ERROR_CODES`).
- Xoá int-spec trùng `apps/api/src/me/me.int.spec.ts` (tập-con của canonical `test/integration/
  me-personal-hub.int-spec.ts` — tránh chạy nhân đôi + drift). Canonical là superset (17 case).

## Nghiệm thu

- `bash scripts/lane-db-setup.sh me` → `export LANE_DB=mediaos_me` → `pnpm --filter @mediaos/api test`.
- FULL gate: security-reviewer + silent-failure-hunter (soi allSettled KHÔNG map 403-nguồn→ok, KHÔNG nuốt
  404→forbidden). Vùng đỏ trước PR: `bash harness/check.sh --lane-db`.
- WO read-only ⇒ audit CHỈ ở nhánh anomaly §12.4 (nay persist bền vững).
