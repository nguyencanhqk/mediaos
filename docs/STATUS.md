# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-26 02:31Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🟢 S2-FE-HR-2 — FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + submit mutation + invalidate list/detail
- **zone**: green · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-HR-BE-2✓, S2-FE-HR-1✓
- **done_when (đích hội tụ)**:
  - [ ] EmployeeForm React Hook Form + Zod validation; dropdown lookup department/position/job-level/contract-type
  - [ ] submit mutation POST/PATCH; thành công → invalidate list/detail (TanStack Query); dirty-form guard
  - [ ] web test form xanh; error/validation state hiển thị rõ

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-INT-1` Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, unique active link, audit cả 2 phía)
- 🟡 `S2-INT-2` Tích hợp HR direct_manager ↔ data-scope Team/Department của permission resolver (approval scope nền cho LEAVE/ATT sau)
- 🔴 `S2-HR-MASK-1` HR read tinh chỉnh (P2): xác nhận+gate masking salaryType theo SPEC-03 §18.8 + dọn quality (audit N+1 list / email .email() / hằng code-length)

**CHỜ (kẹt phụ thuộc):**
- `S2-QA-2` QA HR CRUD + FE smoke + regression: employee create/update/status/link-user + login/route-guard/list/detail/create + checklist Sprint 2 ⏳ cần: S2-FE-HR-2

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-3`, `S2-QA-1`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-AUTH-BRAND-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 16
- **migration head**: idx 131 — `0451_s2_hrbe4_profile_change_requests` (132 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
