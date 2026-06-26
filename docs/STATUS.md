# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-26 07:05Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S2-QA-2 — QA HR CRUD + FE smoke + regression: employee create/update/status/link-user + login/route-guard/list/detail/create + checklist Sprint 2
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/employees/**/*.spec.ts`, `apps/api/test/**`, `apps/app/**`
- **phụ thuộc**: S2-HR-BE-2✓, S2-FE-HR-2✓
- **done_when (đích hội tụ)**:
  - [ ] HR API: employee create (mã tự sinh 0-dup)/update/change-status (history)/link-user (unique active) trên DB cô lập lane
  - [ ] FE smoke: login → route guard → HR list → detail → create employee (theo §17.3); state loading/empty/error
  - [ ] regression checklist Sprint 2 (§18 acceptance) ký xác nhận; `pnpm --filter @mediaos/api test` xanh phạm vi THẬT

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-HR-MASK-1` HR read tinh chỉnh (P2): xác nhận+gate masking salaryType theo SPEC-03 §18.8 + dọn quality (audit N+1 list / email .email() / hằng code-length)

**CHỜ (kẹt phụ thuộc):**
- _(trống)_

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-AUTH-BRAND-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 4
- **migration head**: idx 131 — `0451_s2_hrbe4_profile_change_requests` (132 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `1bb8f7d` | 2026-06-26 | S2-INT-2 — HR manager-tree ↔ data-scope: Team (EMR multi-manager) + Department (org-unit head) (#46) |
| `5ab5dcb` | 2026-06-26 | S2-INT-1 — HR employee ↔ AUTH user provisioning (consistent tx · create:user gate · audit both sides) (#45) |
| `e2e0b9c` | 2026-06-26 | feat(fe): S2-FE-HR-2 — EmployeeForm (create/edit) + lookups + submit/invalidate (#44) |
| `0b378eb` | 2026-06-26 | feat(api): S2-HR-BE-2 — HR write core (create/update/change-status/link-user) (#43) |
| `18f5665` | 2026-06-26 | feat(s2-auth-harden-1): separate forgot rate-limit namespace + uniform-response floor (#42) |
| `bc73304` | 2026-06-26 | test(s2-qa-debt-1): gate auth int-specs on hasDb && LANE_DB + strengthen forgot-password rate-limit efficacy (#40) |
| `9db83d6` | 2026-06-25 | feat(auth): S2-AUTH-BRAND-1 — rebrand TOTP issuer MediaOS → FUNTIME MEDIA (#41) |
| `b3b5624` | 2026-06-25 | feat(fe): S2-FE-HR-3 — MyProfile read-only + user/role placeholder pages (#39) |
| `8bc722a` | 2026-06-25 | chore(backlog): seed S2-AUTH-BRAND-1 — TOTP issuer rebrand MediaOS→FUNTIME MEDIA (follow-up #37) (#38) |
| `83f028c` | 2026-06-25 | chore(s2): backlog reconcile (close #24/#27-#31 + seed 3 follow-up WO) + topbar rebrand EMS→FUNTIME MEDIA (#37) |
| `1a1ec4c` | 2026-06-25 | S2 wave2 → master: HR write (profile-change-request) + Dept/position CRUD + QA RBAC + FE HR (#32/#33/#34/#35) (#36) |
| `d6fbba3` | 2026-06-25 | wip(s2feauth1): wire route guardResult + RHF login form + named ProtectedRoute/PublicRoute (#31) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
