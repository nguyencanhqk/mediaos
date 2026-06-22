# MVP MASTER PLAN — điểm vào kế hoạch tổng thể (rebuild 2026-06-22)

> **File này KHÔNG nhân bản nội dung kế hoạch.** Nó là điểm vào + chính sách vận hành.
> Kế hoạch tổng thể (nguồn sự thật) sống trong bộ docs gold-standard; file này chỉ trỏ và quy định cách dùng.

---

## 0. Bối cảnh — vì sao có file này

Ngày **2026-06-22**, dự án **dựng lại kế hoạch tổng thể** theo bộ tài liệu chuẩn mới trong `docs/`. Toàn bộ kế hoạch + Work Order của hướng cũ (build-as-you-go v2 + sweep de-media-fy: `CLEANUP-DEMEDIAFY`, `FOUNDATION-*`, `MVP-DELIVERY-WAVES`, `wave-fanout`, `mvp-work-orders.json`, …) đã được **xóa khỏi `docs/plans/` và reset khỏi `harness/backlog.mjs`**. Lịch sử các WO đã đóng vẫn còn trong **git** + `harness/_journal.json`.

Kế hoạch mới = **greenfield theo docs nhưng thực thi RECONCILE-FIRST** trên code đã build.

---

## 1. Kế hoạch tổng thể nằm ở đâu (canonical)

| Tài liệu | Vai trò |
| --- | --- |
| [IMPLEMENTATION-01](../IMPLEMENTATION/IMPLEMENTATION-01_MVP_Implementation_Roadmap_Sprint_Plan.md) | **Roadmap 7 sprint (S0–S6)** + milestone M0–M6 + release gate + nguyên tắc triển khai |
| [IMPLEMENTATION-02](../IMPLEMENTATION/IMPLEMENTATION-02_Detailed_Product_Backlog_Epic_Breakdown.md) | **Product backlog chi tiết**: 112 story / 869 point, EPIC-00→11, Acceptance Criteria (`IMP02-STORY-XXX`) |
| IMPLEMENTATION-03 → 09 | Execution plan từng sprint (S0 → S6) theo ngày/task/AC |
| [IMPLEMENTATION-10](../IMPLEMENTATION/IMPLEMENTATION-10_Post-MVP_Backlog_Phase_2_Planning.md) | Backlog sau MVP (Phase 2) |
| [ISSUE-BOARD-01](../ISSUE-BOARD/ISSUE-BOARD-01_MVP_Ticket_Board_Setup.md) | **Cấu trúc board** + quy ước mã `<MODULE>-<LAYER>-<NNN>` + label + DoR/DoD + **§18 "Initial MVP backlog seed" (~120 ticket)** |
| [PROJECT-BASELINE-01](../PROJECT-BASELINE/PROJECT-BASELINE-01_MVP_Documentation_Baseline_Freeze_Checklist.md) | Freeze checklist baseline tài liệu trước khi code |
| [docs/README.md](../README.md) | Chỉ mục toàn bộ docs (SPEC·DB·API·UI·FRONTEND·BACKEND·QA·DEVOPS) |

> Khi cần chi tiết một story/AC → đọc **IMPLEMENTATION-02**. Khi cần kỹ thuật module → tra `docs/README.md` (SPEC·DB·API·UI·FRONTEND·BACKEND·QA). **KHÔNG copy nội dung sang đây** (chống drift).

---

## 2. Roadmap 7 sprint — bản đồ tổng (chi tiết ở IMPLEMENTATION-01 §7-8)

| Sprint | Execution plan | Mục tiêu | Epic | Point |
| --- | --- | --- | --- | ---: |
| **S0** | IMPLEMENTATION-03 | Kickoff · board · governance · repo/CI skeleton | EPIC-00 | 14 |
| **S1** | IMPLEMENTATION-04 | Foundation · environment · core infra + FE core shell | EPIC-01, EPIC-09 | 91 |
| **S2** | IMPLEMENTATION-05 | AUTH/RBAC end-to-end + HR core | EPIC-02, EPIC-03 | 200 |
| **S3** | IMPLEMENTATION-06 | Attendance core + Leave core + ATT-LEAVE sync | EPIC-04, EPIC-05 | 241 |
| **S4** | IMPLEMENTATION-07 | Task/project · Notification · Dashboard | EPIC-06/07/08 | 231 |
| **S5** | IMPLEMENTATION-08 | Integration · QA hardening · UAT | EPIC-10, EPIC-11 (test) | 79 |
| **S6** | IMPLEMENTATION-09 | Stabilization · RC · go-live · hypercare | EPIC-11 (UAT/release) | 13 |

Thứ tự phụ thuộc bắt buộc (IMPLEMENTATION-01 §4 / §10): **Foundation → AUTH → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release**.

> ⚠️ Capacity: S2/S3/S4 (200/241/231 point) vượt xa 1 sprint 2 tuần — chốt velocity thật sau S0–S1 rồi tách/kéo dài (IMPLEMENTATION-01 §8.8).

---

## 3. Chính sách vận hành backlog (harness ↔ docs)

1. **`harness/backlog.mjs` chỉ giữ Work Order của SPRINT HÀNH.** Hiện = **S0 + S1**. Đây là nguồn máy-đọc cho `gen-status` · `guard-scope` · `auto-loop` · ledger.
2. **Pull-sprint:** khi S0–S1 hội tụ (mọi WO `done`), **kéo sprint kế (S2…)** từ `ISSUE-BOARD-01 §18` + IMPLEMENTATION-05.. vào `backlog.mjs` (dịch ticket → WO: thêm `paths`/`done_when`/`depends_on`/`src`). KHÔNG nhồi cả 7 sprint vào một lúc (chống phình; docs là nguồn sự thật).
3. **Trace bắt buộc:** mỗi WO có `src[]` trỏ về docs nguồn (ISSUE-BOARD §5.2 — "ticket không có tài liệu nguồn thì không vào Sprint").
4. **Mã WO** theo `<MODULE>-<LAYER>-<n>` (ISSUE-BOARD §8). Ở tầng harness dùng tiền tố sprint `S0-…/S1-…` cho nhóm WO; ticket con §18 ghi trong `src`.

### Reconcile-first (đối chiếu, không vứt code đúng)

Hạ tầng đã build (RLS·permission·audit·outbox + một phần Foundation: audit/holidays/files/sequences/retention/seed; migration head idx 120 / 0437). Mỗi WO khung là **"đối chiếu/align `<X>` với spec mới (DB-08/BACKEND/API), GIỮ phần khớp, chỉ build phần thiếu/lệch"**. Khi code cũ mâu thuẫn spec → **SPEC THẮNG**. De-media-fy giữ nguyên (media·finance·SaaS·workflow-DAG·payroll·mobile = out-of-scope).

---

## 4. Sprint hành hiện tại (S0–S1) — đang ở `harness/backlog.mjs`

> Trạng thái sống tự sinh ở [docs/STATUS.md](../STATUS.md). Bảng dưới là ảnh chụp cơ cấu để người đọc nắm nhanh.

**Sprint 0 — Readiness & Baseline reconciliation** (IMPLEMENTATION-03 · EPIC-00):
`S0-GOV-1` · `S0-CI-1` · `S0-ENV-1` · `S0-FND-DB-1` · `S0-FND-SEED-1` · `S0-AUTH-DB-1` · `S0-API-CORE-1` · `S0-FE-CORE-1` · `S0-FE-API-1` · `S0-QA-1`

**Sprint 1 — Foundation services + FE shell** (IMPLEMENTATION-04 · EPIC-01/09):
`S1-FND-AUDIT-1` · `S1-FND-SETTING-1` · `S1-FND-FILE-1` · `S1-FND-SEQ-1` · `S1-FND-MODULE-1` · `S1-FND-WIRE-1` · `S1-FE-LAYOUT-1` · `S1-FE-REGISTRY-1` · `S1-QA-FND-1`

---

## 5. Definition of Ready / Done · Gate (tóm; chuẩn đầy đủ ở docs)

- **DoR** (ISSUE-BOARD §13 / IMPLEMENTATION-02 §5): title rõ · type · module/layer · priority · **source docs** · AC · dependency · permission/scope · API/screen/table · test note · estimate · không scope-creep.
- **DoD** (ISSUE-BOARD §14 / IMPLEMENTATION-01 §12): AC đạt · code review+merge · CI/lint/type/build xanh · migration/seed chạy từ DB trống · API guard (auth/permission/scope) · FE state (loading/empty/error/forbidden) · audit log nếu quan trọng · noti event nếu yêu cầu · test pass · không blocker/critical · docs/OpenAPI cập nhật nếu contract đổi.
- **Release gate** Gate 1→5 (IMPLEMENTATION-01 §13): Foundation → Core Business → Experience → UAT → Production.
- **Review gate phân tầng** + model routing: theo `CLAUDE.md §6` (FULL gate cho permission/RLS/secret/audit/auth/migration; crown-jewel → Opus + planner).
- **Label taxonomy** (ISSUE-BOARD §11): `module:*` · `layer:*` · `type:*` · `priority:p0..p3` · `sprint:0..6` · `scope:own..system` · `risk:*`.

---

## 6. Ngoài phạm vi MVP (giữ thiết kế, KHÔNG code đợt này)

PAYROLL · RECRUIT · ASSET · ROOM · CHAT · SOCIAL · MOBILE (native) · AI · realtime WebSocket production-grade · multi-tenant SaaS billing · tích hợp máy chấm công vật lý. Chi tiết: IMPLEMENTATION-01 §5.3 + §4.4.

---

_Cập nhật cơ cấu Work Order ở `harness/backlog.mjs`; tiến độ xem `docs/STATUS.md` (tự sinh). Thay đổi sau baseline → change request (ISSUE-BOARD §19)._
