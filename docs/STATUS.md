# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-25 14:33Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-HR-BE-2` HR write core: POST/PATCH /hr/employees + auto employee-code (tx + SequenceService) + change-status (history) + link/unlink user (unique active) + audit
- 🟢 `S2-FE-HR-3` FE: MyProfile (read-only) + user/role read-only placeholder (P1, KHÔNG chặn Sprint 3)
- 🟡 `S2-INT-2` Tích hợp HR direct_manager ↔ data-scope Team/Department của permission resolver (approval scope nền cho LEAVE/ATT sau)
- 🟡 `S2-QA-DEBT-1` Test-hygiene AUTH: gate int-spec trên hasDb && LANE_DB (KHÔNG bare skipIf(!hasDb)) + siết efficacy forgot-password-rate-limit spec
- 🔴 `S2-AUTH-HARDEN-1` Hardening password-reset (P2): tách rate-limit bucket forgot khỏi login + giảm timing-oracle enumeration + redact token ở mail-catch + .env.example RESET_PASSWORD_URL
- 🔴 `S2-HR-MASK-1` HR read tinh chỉnh (P2): xác nhận+gate masking salaryType theo SPEC-03 §18.8 + dọn quality (audit N+1 list / email .email() / hằng code-length)

**CHỜ (kẹt phụ thuộc):**
- `S2-FE-HR-2` FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + submit mutation + invalidate list/detail ⏳ cần: S2-HR-BE-2
- `S2-INT-1` Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, unique active link, audit cả 2 phía) ⏳ cần: S2-HR-BE-2
- `S2-QA-2` QA HR CRUD + FE smoke + regression: employee create/update/status/link-user + login/route-guard/list/detail/create + checklist Sprint 2 ⏳ cần: S2-HR-BE-2, S2-FE-HR-2

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-QA-1`

## Trạng thái repo

- **branch**: `chore/s2-backlog-reconcile` · **file đang đổi (dirty)**: 2
- **migration head**: idx 131 — `0451_s2_hrbe4_profile_change_requests` (132 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
