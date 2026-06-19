# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-19 13:27Z**. Sửa tiến độ ở `harness/backlog.mjs`, rồi chạy lại.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `ACCT-2` ②b Quản trị user (admin): CRUD/mời/suspend/soft-delete + FE user-management
- 🟢 `CONSOLE-1` ④ Quản trị hệ thống: redesign apps/console, hút màn devops hữu ích từ operator plane
- 🟡 `TRIM-1` Trim chức năng: gộp defect→tasks(labels), gỡ template-clone/recycle-bin nếu không dùng
- 🟡 `AI-1` AI insight v1 (read-only): KPI insight đọc kpi+finance → tóm tắt, KHÔNG ghi DB

**CHỜ (kẹt phụ thuộc):**
- `PERM-UI-1` ③ Phân quyền: giữ engine 4-tier, wire Tier-2 scope nếu cần + redesign role/permission UI ⏳ cần: ACCT-2
- `APP-MERGE-1` Dựng apps/app (shell hợp nhất): studio (work/process/goals) + people (hr/payroll) + projects (PM) ⏳ cần: PERM-UI-1, CONSOLE-1

**Đã xong (v2):** `HARNESS-SPINE`, `FE-AUTH-1`, `ACCT-1`

## Trạng thái repo

- **branch**: `feat/login-account-selfservice` · **file đang đổi (dirty)**: 19
- **migration head**: idx 112 — `0420_pm_foundation` (113 migration)
- **nền**: G1–G16 đã land master (RLS·permission·audit·outbox·payroll·finance·workflow·task-hub). Lịch sử ở git.
- **hướng v2**: v2 (owner 2026-06-19): đơn giản hoá để KIỂM SOÁT — tuần tự 1 tính năng/phiên, gộp FE 9→3 (auth·console·app), GIỮ backend (company_id/RLS ở N=1), redesign UX, trim chức năng, AI-first mỏng. Thay thế kế hoạch gộp-vào-apps/workspace cũ.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
