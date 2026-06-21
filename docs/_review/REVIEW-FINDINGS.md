# Báo cáo rà soát bộ tài liệu `C:\docs` → repo + bản đồ Giữ/Xóa

> Nguồn: rà soát bằng 8 agent song song (2 rà code + 6 rà tài liệu theo cụm nghiệp vụ), ngày 2026-06-21.
> Bộ docs mới đã được copy vào `docs/` (canonical). File này + `CODE-CLEANUP-PLAN.md` + `SPEC-DRIFT-MATRIX.md` là tài liệu META (phân tích về docs), không thuộc bộ canonical.

---

## 0. Kết luận nhanh

- Bộ docs mới **rất tốt về độ phủ & chiều sâu** (≈150k dòng; 7 module MVP + Foundation; đủ tầng PRD→SPEC→DB→API→UI→FE→BE→DevOps→QA→Compliance→Implementation). Điểm các cụm: **6.5–8/10**.
- **KHÔNG cần rebuild from scratch.** Code giữ được **~50% backend** + **~65–75% frontend** sau khi cắt media/finance/operator-plane. Hướng đúng: **dọn + chỉnh (incremental)**.
- **Có 3 lỗi hệ thống phải sửa TRƯỚC khi code** — nếu build thẳng theo docs sẽ vi phạm cả 3 bất biến của dự án.

### Điểm chất lượng theo cụm

| Cụm rà soát | Điểm | Vấn đề lớn nhất |
|---|---|---|
| AUTH + Foundation + Permission | 7/10 | RLS/outbox/append-only chỉ là khẩu hiệu, không hiện thực trong docs |
| HR + ATT | 6.5/10 | SPEC lệch tên bảng/cột so với DB; 2 bảng audit riêng va chạm invariant |
| LEAVE + TASK | 6.5/10 | 3 hệ mã lỗi LEAVE; `LEAVE-ERR-016` trái nghĩa FE↔BE |
| DASH + NOTI | 7.5/10 | Thiếu RLS; SPEC-08 lỗi thời (path/verb/tên bảng) |
| UI/UX + FE foundation | 8/10 | Mâu thuẫn Next.js (docs) vs Vite (stack chốt) |
| DevOps/QA/Impl/Compliance/Decisions | 6.5/10 | RLS/outbox/PgBouncer vắng mặt; Prisma/Redis/Next.js lọt vào; 15/15 quyết định chưa chốt |

---

## 1. Ba lỗi hệ thống (CRITICAL) — sửa trước khi code

### 1.1 Ba bất biến của dự án VẮNG MẶT trong toàn bộ docs

**Cả 6 agent rà tài liệu độc lập đều phát hiện** → độ tin cậy tuyệt đối.

| Bất biến | Trạng thái trong docs | Phải bổ sung |
|---|---|---|
| #1 Tenant isolation = RLS + FORCE | `RLS/FORCE/withTenant/set_config/PgBouncer` xuất hiện **0 lần** trong DB-01..10, BACKEND, API, DEVOPS. Mọi nơi chỉ `WHERE company_id = authContext.companyId` (kỷ luật dev) | Template RLS policy vào **DB-01** (áp mọi bảng có `company_id`), `withTenant()`/`set_config` vào **BACKEND-01/03**, bước "bật RLS+FORCE trước backfill" vào **DEVOPS-05** migration order |
| #2 Audit append-only ở tầng DB | Chỉ "quy ước không build endpoint update/delete"; không `REVOKE`/trigger | `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>` + trigger chặn vào **DB-08**/BACKEND-11 |
| #2 Transactional outbox | 0 lần; roadmap xếp event pipeline ở **Sprint 4** (sau khi HR/ATT/LEAVE đã ghi) | Bảng `outbox` + luồng audit/event qua outbox vào **DB-08/BACKEND-11**; đưa lên **Sprint 1** |

### 1.2 Stack bị cấm lọt vào docs (vi phạm "giữ nguyên công nghệ")

| Trong docs | Phải là | Nơi |
|---|---|---|
| Next.js App Router, `next/navigation`, `NEXT_PUBLIC_*` | **Vite + React 19 SPA + TanStack Router**, `VITE_*` | FRONTEND-01/02/03, DEVOPS-07, IMPLEMENTATION-04, QA-06 |
| Prisma | **Drizzle** (Prisma phá outbox + rò tenant trên PgBouncer) | IMPLEMENTATION-04/05, DEVOPS-05 |
| Redis (26+ lần) | **Valkey** (Redis 8 = AGPL) | DEVOPS-01/03/06/08/09/11, QA-03 |
| Jest / Pytest | **Vitest** | QA-01/05/06 |

> Điểm tốt: KHÔNG có Supabase, Typesense, MUI X Pro, AG Grid Enterprise ở bất kỳ đâu.

### 1.3 SPEC trôi (drift) so với tầng triển khai DB/API/BE

Phát hiện đồng nhất ở HR/ATT/LEAVE/TASK/DASH/NOTI: tầng **DB↔API↔BE↔FE rất khớp** (permission/enum/DTO trùng ~100%), nhưng **SPEC-0X là tầng cũ nhất, lệch**. Chi tiết + cách sửa: xem `SPEC-DRIFT-MATRIX.md`.

Điểm nguy hiểm nhất:
- **2 hệ mã lỗi song song**: SPEC số `MODULE-ERR-001` vs API/BE slug `MODULE-ERR-INVALID-STATE`. **`LEAVE-ERR-016` nghĩa TRÁI NGƯỢC** giữa FE ("không có người duyệt") và BE ("sai chuyển trạng thái").
- **Tên bảng/cột ATT**: `attendance_date/check_in_time/working_minutes` (SPEC) vs `work_date/check_in_at/worked_minutes` (DB).
- **Bảng audit riêng** `attendance_audit_logs`, `employee_change_logs` va chạm "dùng `audit_logs` chung".
- **Endpoint thiếu `/v1`**, đánh số API trùng-số-khác-nghĩa.

---

## 2. Permission seed & FSM duyệt (HIGH)

- **Mã quyền audit phân mảnh**: `AUTH.AUDIT_LOG.VIEW` vs `FOUNDATION.AUDIT_LOG.VIEW` vs `FOUNDATION.AUDIT.*` (sai chính tả trong BACKEND-11).
- **`role_code` `ADMIN` (DB-01 §9.2) vs `COMPANY_ADMIN`** (mọi nơi khác) → seed sai phá toàn bộ ánh xạ permission.
- **Quyền API dùng nhưng seed thiếu**: `LEAVE.REQUEST.SUBMIT`, `LEAVE.FILE.*`, `LEAVE.BALANCE.TRANSACTION_VIEW`, `ATT.ATTENDANCE.RECALCULATE`, `TASK.PROJECT.FILE_UPLOAD/DELETE`, `DASH.CACHE.REFRESH`.
- **Self-approval prevention**: SPEC ghi "không nên" (mềm) nhưng BE bắt buộc → phải hard-rule + **test deny-path RED** (LEAVE/ATT).

---

## 3. Quản trị & over-engineering (MEDIUM)

- **DECISIONS-01: 15/15 quyết định còn "Đề xuất", chưa cái nào "Đã chốt"**, ô "Người quyết định" trống — nhưng PROJECT-BASELINE-01 §8 đánh 14/15 "Locked" → **freeze gate giả**. Phải chốt 6 quyết định Block-code (D-01, D-09, D-12, D-13, D-14, D-15) + vá gate trước khi code.
- **Over-engineering cho N=1 (1 công ty, zero-cost)** — đề xuất cắt:

| Hạng mục | Hiện tại | Cắt cho MVP |
|---|---|---|
| Load test dataset | 3–5 company, 10k nhân sự, 200k task | Small: 1 company/100 user làm release-gate |
| Concurrent VU | 500–1000+ | ~100–200 VU |
| Môi trường | local/dev/staging/UAT/prod (5) | gộp staging+UAT → local + 1 staging/UAT + prod |
| Restore drill | hằng tuần/quý | 1 lần trước go-live + 1 lần/6 tháng |
| RPO | ≤15 phút (PITR liên tục) | ≤24h (full backup ngày), nâng PITR sau |
| Field-encryption lương/CCCD | ngay MVP | hoãn Phase 2 (khi có PAYROLL) |

  **KHÔNG cắt**: RLS+FORCE, audit append-only, password hash + secret env, breach-72h (NĐ13), retention, consent GPS check-in.

- **Roadmap**: thứ tự module đúng (Foundation→AUTH→HR→ATT/LEAVE→TASK/NOTI/DASH), nhưng (a) RLS không nằm trong sprint nào, (b) outbox ở S4 (quá trễ), (c) effort S2–S4 (200–241 point) **quá tải 3–5×** velocity thực → giãn thành ~9–10 sprint (~18–20 tuần).

---

## 4. Bản đồ Giữ/Xóa code (tóm tắt — chi tiết ở `CODE-CLEANUP-PLAN.md`)

### Backend `apps/api/src/` — giữ ~50%
- **KEEP**: db · events · permission · crypto · storage · health · common · config · notifications · realtime · users · positions · security-policy · user-invites · recycle-bin
- **ADAPT**: auth · employees · org · attendance · leave · tasks · dashboard · settings · scheduler · mail-config
- **PARK** (`_parked/`): media · workflow · approval · finance · kpi · payroll · evaluation · defect · ai · meeting · chat · api-keys
- **DELETE**: platform · saas · templates · usage · db-ops · observability · operator-bootstrap · break-glass · webhooks
- **Migration**: RESET (archive `migrations.legacy/`, sinh lại theo DB-10).
- **Build mới**: module `foundation` (module-registry/sequence/holiday/retention/seed-tracking/file-metadata).

### Frontend `apps/` — giữ ~65–75%, mục tiêu **3 app** (đã chốt)
- **KEEP**: `apps/auth` · `packages/{contracts,web-core,ui}` (contracts **TUYỆT ĐỐI KHÔNG XÓA** — DTO chung BE+FE)
- **MERGE → `apps/app`**: web (Home Portal) + people (HR/ATT/LEAVE) + projects (TASK)
- **MERGE → `apps/console`**: console (SYSTEM/admin) + AC-* salvage từ admin
- **SALVAGE rồi DELETE vỏ**: studio (cứu tasks/kanban, workflow canvas, kpi)
- **DELETE**: admin (operator-plane)
- **KEEP riêng**: mobile (Expo/RN — Phase MOBILE)

---

## 5. Trình tự khuyến nghị

1. **Sửa docs** (blueprint) — B1 (RLS/outbox/append-only) → B2 (stack) → B3/B4 (SPEC drift + permission seed).
2. **Chốt DECISIONS-01** (6 quyết định Block-code) + vá freeze gate.
3. **Dọn code** theo `CODE-CLEANUP-PLAN.md` (gỡ coupling → park → delete → reset migration).
4. **Build incremental**: Foundation → AUTH → HR → ATT/LEAVE/TASK → DASH/NOTI.
