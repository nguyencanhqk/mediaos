# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-20 08:13Z**. Sửa tiến độ ở `harness/backlog.mjs`, rồi chạy lại.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `PERM-UI-1` ③ Phân quyền: giữ engine 4-tier, wire Tier-2 scope nếu cần + redesign role/permission UI
- 🟡 `TRIM-1` Trim chức năng hướng cũ: gỡ/park media·workflow-DAG·defect·template-clone·recycle-bin không thuộc spec MVP

**CHỜ (kẹt phụ thuộc):**
- `APP-MERGE-1` Dựng apps/app (shell hợp nhất) cho module MVP: HR · ATT · LEAVE · TASK · DASH · NOTI (theo docs/spec/) ⏳ cần: PERM-UI-1

**Đã xong (v2):** `HARNESS-SPINE`, `FE-AUTH-1`, `ACCT-1`, `ACCT-2`, `ACCT-2-FE`, `AUTH-FIX-1`, `CONSOLE-1`, `AI-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 83
- **migration head**: idx 113 — `0430_acct2_admin_user_admin_perms` (114 migration)
- **nền**: Nền backend G1–G16 đã land master (RLS·permission·audit·outbox + giữ lại). De-media-fy: media·workflow-DAG·payroll·finance·SaaS·mobile PARKED (out-of-scope, không xóa) — xem docs/SYSTEM-DESIGN.md §14. Lịch sử ở git.
- **hướng v2**: v2 (owner 2026-06-19, reframe 2026-06-20): đơn giản hoá để KIỂM SOÁT — tuần tự 1 tính năng/phiên. De-media-fy thành hệ QLDN chung; GIỮ backend hạ tầng (company_id/RLS ở N=1, audit, permission); xây/redesign 7 module MVP theo docs/spec/. FE: auth·console·app. Khi code cũ mâu thuẫn spec → spec thắng.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
