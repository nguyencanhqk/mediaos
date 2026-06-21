# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-21 08:19Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `PERM-UI-1` ③ Phân quyền: giữ engine 4-tier, wire Tier-2 scope nếu cần + redesign role/permission UI
- 🔴 `TRIM-1` Trim chức năng hướng cũ: gỡ/park media·workflow-DAG·defect·template-clone·recycle-bin không thuộc spec MVP
- 🔴 `FOUNDATION-DB-1` Migration system_settings + company_settings (RLS+FORCE) theo DB-08 §8.3/8.4
- 🔴 `FOUNDATION-DB-2` Migration audit_logs nâng cấp về DB-08 shape (giữ append-only) hoặc bảng audit chuẩn
- 🔴 `FOUNDATION-DB-3` Migration files + file_links + file_access_logs (RLS+FORCE, polymorphic có kiểm soát) theo DB-08 §8.6-8.8
- 🔴 `FOUNDATION-DB-4` Migration sequence_counters + public_holidays (RLS+FORCE, company_id nullable cho global) theo DB-08 §8.9-8.10

**CHỜ (kẹt phụ thuộc):**
- `APP-MERGE-1` Dựng apps/app (shell hợp nhất) cho module MVP: HR · ATT · LEAVE · TASK · DASH · NOTI (theo docs/spec/) ⏳ cần: PERM-UI-1
- `FOUNDATION-DB-5` Migration data_retention_policies + seed_batches + seed_items + seed modules catalog/permission/system_settings (idempotent) ⏳ cần: FOUNDATION-DB-1
- `FOUNDATION-BE-1` SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit ⏳ cần: FOUNDATION-DB-1, FOUNDATION-BE-3
- `FOUNDATION-BE-2` SequenceService.nextCode transaction + FOR UPDATE row lock + preview (không tăng) + ensureCounter ⏳ cần: FOUNDATION-DB-4
- `FOUNDATION-BE-3` AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+scope ⏳ cần: FOUNDATION-DB-2
- `FOUNDATION-BE-4` FileService: upload metadata + StorageAdapter port + link/unlink + download-qua-backend + file_access_log ⏳ cần: FOUNDATION-DB-3, FOUNDATION-BE-3, FOUNDATION-BE-5
- `FOUNDATION-BE-5` FilePolicyService + FileOwnerPermissionResolver registry (deny-by-default, dispatch theo module_code/entity_type) ⏳ cần: FOUNDATION-DB-3
- `FOUNDATION-BE-6` HolidayService: CRUD public_holidays + isWorkingDay (global+company override) + getHolidaysInRange + internal contract cho ATT/LEAVE ⏳ cần: FOUNDATION-DB-4
- `FOUNDATION-BE-7` CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService my-apps (lọc theo permission+module active+setting) ⏳ cần: FOUNDATION-DB-5, FOUNDATION-BE-3
- `FOUNDATION-BE-8` SeedTrackingService idempotent + RetentionService CRUD + cleanup job skeleton (dry-run, không xóa thật) ⏳ cần: FOUNDATION-DB-5
- `FOUNDATION-BE-9` FoundationModule + foundation contracts (Zod DTO) + wire vào app.module.ts (additive) ⏳ cần: FOUNDATION-BE-1, FOUNDATION-BE-3, FOUNDATION-BE-4, FOUNDATION-BE-6, FOUNDATION-BE-7
- `FOUNDATION-QA-1` QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public settings leak ⏳ cần: FOUNDATION-BE-1, FOUNDATION-BE-2, FOUNDATION-BE-3, FOUNDATION-BE-4, FOUNDATION-BE-6, FOUNDATION-BE-7, FOUNDATION-BE-8

**Đã xong (v2):** `HARNESS-SPINE`, `FE-AUTH-1`, `ACCT-1`, `ACCT-2`, `ACCT-2-FE`, `AUTH-FIX-1`, `CONSOLE-1`, `AI-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 128
- **migration head**: idx 113 — `0430_acct2_admin_user_admin_perms` (114 migration)
- **nền**: Nền backend G1–G16 đã land master (RLS·permission·audit·outbox + giữ lại). De-media-fy: media·workflow-DAG·payroll·finance·SaaS·mobile PARKED (out-of-scope, không xóa) — xem docs/SYSTEM-DESIGN.md §14. Lịch sử ở git.
- **hướng v2**: v2 (owner 2026-06-19, reframe 2026-06-20): đơn giản hoá để KIỂM SOÁT — tuần tự 1 tính năng/phiên. De-media-fy thành hệ QLDN chung; GIỮ backend hạ tầng (company_id/RLS ở N=1, audit, permission); xây/redesign 7 module MVP theo docs/spec/. FE: auth·console·app. Khi code cũ mâu thuẫn spec → spec thắng.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
