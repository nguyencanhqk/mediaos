# Kế hoạch wave S12-RECRUIT — Phase 2 «HR nâng cao»: RECRUIT (tuyển dụng)

> Seed 2026-08-31. Trạng thái: **ĐÃ DUYỆT 2026-08-31** — owner duyệt nguyên gói hồ sơ
> **`docs/plans/S12-RECRUIT-WAVE-review.html`** (kèm wireframe UI) và ký 8/8 quyết định §3 theo cột
> «Đề xuất». `S12-RECRUIT-DOC-1` seed thẳng ở trạng thái `todo` (duyệt trước khi seed); 5 WO sau
> xích `depends_on` nối tiếp. Nguồn phạm vi: SPEC-01 §12.9 · §10.7 (Recruiter) · §7 (Phase 2) ·
> IMPLEMENTATION-10 §10.2 (P2-REC-01..09) + §11 (PMVP-AUTH-003/005/006 · PMVP-HR-004/005) ·
> §13.2 (giữ chỗ DB-14).
>
> PAYROLL **không** thuộc wave này — là wave riêng kế tiếp, mở bằng buổi chốt nghiệp vụ lương
> (công thức, kỳ lương, ai thấy lương ai) trước khi viết SPEC-11.

---

## 1. Điểm xuất phát — ĐO THẬT ngày 31/08/2026

- **RECRUIT «đặt chỗ, chưa xây»:** 0 SPEC, 0 DB doc, 0 API doc, 0 story triển khai, 0 WO, 0 mục
  permission-matrix. SPEC-01 đã khoá số **SPEC-12** (§7 dòng 165, §8); role **Recruiter** mô tả
  sẵn §10.7; IMP-10 §10.2 có 9 epic `P2-REC-01..09` với AC từng story.
- **Không có bảng di sản recruit:** quét `candidates/vacanc/applicant/job_opening` toàn schema +
  migrations = chỉ 2 giá trị enum trong `finance.ts`/`media.ts` (cụm park). Đường tên sạch —
  khác ROOM, không cần DEC «số phận bảng cũ».
- **Hàng `modules` RECRUIT đã pre-seed inactive** từ mig `0435` (sort_order 9) — seed lại là
  NO-OP; chỉ bật `is_active` ở WO FE (khuôn 0556/0557).
- **Đánh số:** DB-14 còn trống đúng chỗ IMP-10 §13.2 giữ (OFFICE-DEC-001 đã tôn trọng khi ASSET/
  ROOM nhảy DB-15/16). **API-16 đã bị «PERMISSION AUDIT REPORT» chiếm** ⇒ RECRUIT nhận API-17.
  → REC-DEC-001.
- **Dải mã trống đo được:** migration head `0558` ⇒ nhận `0559+` · NOTI-EVENT catalog (SPEC-01
  §20.2) dừng ở **015** ⇒ nhận **016+** · SPEC-01 §17 dừng ở §17.10 ⇒ nhận **§17.11–17.14** ·
  IMPLEMENTATION-02 dừng ở EPIC-18/IMP02-STORY-170 ⇒ nhận **EPIC-19 (§8.20), IMP02-STORY-171..180**
  · permission-matrix dừng §9e ⇒ nhận **§9f**.
- **Điểm nối có khuôn:** NOTI CHECK 2 bảng (0538/0551/0555) · composite tenant-FK (0535) ·
  permission seed `ON CONFLICT DO NOTHING` · UNION-ADD `audit_logs.object_types` · CV qua
  Foundation Files (private + `file_access_logs`) · convert tái dùng SequenceService
  `employee_code` (ensure-on-miss) của module employees.
- **Harness:** enum module `RECRUIT` thêm vào header `harness/backlog.mjs` cùng commit seed này;
  `harness/lib/stories.mjs` (EPIC_MODULE) + `harness/dashboard/server.mjs` (MODULE_SPEC) chưa
  biết RECRUIT — giao cho WO DOC. Ledger S10/S11 tồn đọng đóng dấu cùng commit seed.

## 2. Phạm vi wave

| Phạm vi v1 (SPEC-01 §12.9 · IMP-10 §10.2, chỉ P0/P1 theo DEC) | NGOÀI phạm vi v1 |
| --- | --- |
| Vị trí tuyển dụng (CRUD · đóng/tạm dừng · gán recruiter) · hồ sơ ứng viên + cảnh báo trùng email/phone · CV private qua Foundation Files · pipeline kanban 6 stage cố định + lịch sử append-only · lịch phỏng vấn + feedback own-scope per interviewer · offer (Draft→Sent→Accepted/Declined/Withdrawn, lương mask) · convert ứng viên→nhân viên 1 bước · masking PII + audit export/tải CV · widget DASH «phễu tuyển dụng» | Custom stage per-company · workflow duyệt offer nội bộ (P2-REC-06-002) · tự tạo tài khoản đăng nhập khi onboard (P2-REC-07-004) · tích hợp calendar Google/Microsoft (P2-REC-05-005) · buộc đặt phòng ROOM cho phỏng vấn · auto-purge/retention ứng viên Rejected (P2-REC-09-004 → PARK-RECRUIT-001) · report source effectiveness (P3) |

Vai trò: seed role hệ thống **`recruiter`** (SPEC-01 §10.7, KHÔNG canonical — REC-DEC-008);
hiring manager = role `manager` hiện có nhận scope Own trên interview/feedback.

## 3. Quyết định owner — ĐÃ KÝ 2026-08-31

> Owner duyệt nguyên gói («ok tôi duyệt») ⇒ **8/8 mã dưới đây chốt ĐÚNG cột «Đề xuất»**. WO DOC
> chỉ việc chép kết luận vào bảng quyết định của SPEC-12 (khuôn SPEC-15 §22), không hỏi lại.

| Mã | Câu hỏi | Đề xuất — **đã chốt** |
| --- | --- | --- |
| REC-DEC-001 | Đánh số tài liệu khi API-16 đã bị chiếm | **SPEC-12 · DB-14** (đúng chỗ IMP-10 giữ) · **API-17** · permission-matrix **§9f** · IMPLEMENTATION-02 **EPIC-19 (§8.20)**, IMP02-STORY-171..180 · trạng thái SPEC-01 §17.11–17.14 · NOTI-EVENT-016..019 (đo lại dải trước khi ghi) |
| REC-DEC-002 | Pipeline cố định hay tuỳ biến | v1 **cố định 6 stage**: New → Screening → Interview → Offer → Hired / Rejected. Rejected reopen về Screening kèm lý do; Hired terminal (khoá chống convert lần 2). Custom stage = Phase sau |
| REC-DEC-003 | Bảo vệ PII ứng viên tới mức nào | Cặp quyền `candidate` **is_sensitive=true**; email/phone **mask ở SERVER** theo quyền (FE schema `.optional()`); CV Foundation Files **private**, tải về ghi `file_access_logs`; export cần cặp quyền riêng + audit |
| REC-DEC-004 | Offer: workflow duyệt · lương ai thấy | **Không workflow duyệt** (Phase sau). Draft → Sent → Accepted / Declined / Withdrawn, recruiter tự cập nhật. Lương offer chỉ trả cho `('manage','offer')`; `('view','offer')` nhận bản mask |
| REC-DEC-005 | Convert 1 bước hay wizard | **1 bước**, quyền `('convert','candidate')`, chỉ khi Offer = Accepted. Tạo hồ sơ qua service HR hiện có (SequenceService ensure-on-miss); map trường tường minh; `candidates.employee_id` UNIQUE chống trùng. **KHÔNG tự tạo tài khoản** — HR tạo qua luồng AUTH |
| REC-DEC-006 | Phỏng vấn: ROOM · calendar ngoài | v1 địa điểm = **text/link tự do**, KHÔNG buộc booking ROOM, KHÔNG tích hợp calendar. Interviewer nội bộ nhận NOTI; feedback **own-scope** per interviewer |
| REC-DEC-007 | Retention ứng viên Rejected | v1 **soft-delete** (§16.2), chưa auto-purge; policy retention = **PARK-RECRUIT-001** (RELEASE-14 §5) |
| REC-DEC-008 | Role seed | Role hệ thống **`recruiter`**: `company_id IS NULL` · `is_system=true` · `requires_two_factor=false` tường minh · **KHÔNG canonical** (không vào DashCanonicalRole/NOTI_CANONICAL_ROLES/pin seed). Hiring manager KHÔNG phải role mới |

## 4. Story cấp wave (bản nghiệp vụ đầy đủ viết ở EPIC-19 trong WO DOC)

RC-01 vị trí tuyển dụng (CRUD · đóng/tạm dừng · gán recruiter — Closed chặn thêm ứng viên) ·
RC-02 hồ sơ ứng viên + cảnh báo trùng email/phone · RC-03 CV qua Foundation Files (private, audit
khi tải) · RC-04 pipeline kanban chuyển stage kèm lý do, lịch sử append-only · RC-05 lịch phỏng
vấn + NOTI interviewer · RC-06 feedback phỏng vấn own-scope · RC-07 offer + kết quả (lương mask)
· RC-08 convert ứng viên trúng tuyển → nhân viên HR · RC-09 masking PII + deny-path + audit
export/tải CV · RC-10 widget DASH «phễu tuyển dụng».

## 5. Phân rã Work Order (6 WO — seed trong harness/backlog.mjs)

```text
duyệt ✅ → S12-RECRUIT-DOC-1 → S12-RECRUIT-DB-1 🔴 → S12-RECRUIT-BE-1 🔴 → S12-RECRUIT-FE-1 → S12-RECRUIT-QA-1 🟡 → S12-RECRUIT-DASH-1
```

- Một module ⇒ **track nối tiếp tự nhiên**, DB-1 là lane migration duy nhất (đánh số nối head
  thật lúc merge, dự kiến 0559+).
- DOC → DB có chốt: **plan-reviewer đối kháng PASS** trên SPEC-12 + DB-14 trước khi mở WO DB
  (khuôn wave CHAT/OFFICE).
- Crown routing: DB-1/BE-1 = 🔴 FULL gate + Opus (PII ứng viên = dữ liệu nhạy cảm,
  PMVP-AUTH-005/006); DOC/FE/DASH = 🟢 LIGHT; QA = 🟡.

## 6. UI dự kiến (wireframe chi tiết ở hồ sơ HTML duyệt)

`apps/app/src/routes/recruit/` — REC-SCREEN-001 danh sách vị trí tuyển (table + filter + chip
trạng thái) · 002 kanban pipeline (6 cột, kéo-thả = move-stage kèm lý do) · 003 chi tiết ứng viên
(tab hồ sơ ‖ timeline ‖ phỏng vấn ‖ tệp CV — email/phone mask) · 004 form ứng viên + upload CV +
cảnh báo trùng · 005 lịch phỏng vấn + feedback (own-scope) · 006 offer & convert (lương mask,
convert khoá khi chưa Accepted). Mọi màn: `<PermissionGate>` + `useCan()`, loading/error/empty,
i18n vi, trạng thái dùng constants §17.

## 7. Rủi ro & bẫy đã biết (từ memory/KI — 12 mục, chi tiết ở hồ sơ HTML §08)

1. `modules` RECRUIT pre-seed inactive từ 0435 — seed NO-OP; bật `is_active` CHỈ ở WO FE; guard
   bật-module không assert trạng thái module KHÁC.
2. CHECK `module_code` NOTI nới **cả hai bảng** (`notification_events` + `notifications`);
   baseline guard forward-compatible.
3. Zod mirror CHECK DB **hai chiều đúng bằng**; trần Zod ≠ trần service kẻo mã lỗi chết.
4. Mọi FK mới kèm composite tenant-FK (khuôn 0535).
5. Route mới ⇒ route-census regen `ROUTE_CENSUS_WRITE=1`; khai `API_MODULE_TAGS`; `:id` = UUID.
6. Masking server ⇒ FE schema `.optional()`; cặp is_sensitive khai allowlist capability BACKEND.
7. Guard cặp ở **HAI tầng** — census QA so TỪNG ROUTE theo MÃ, không so tập.
8. `candidate_stage_events` append-only: REVOKE UPDATE/DELETE + UNION-ADD audit object_types
   đúng neo parse.
9. Convert: UNIQUE `candidates.employee_id` + kiểm trong transaction; int-spec race 2 request
   song song đúng-1-thắng; mã NV qua ensure-on-miss, không hard-code prefix.
10. Widget DASH: catalog BE + **sàn scope** (`DASH_WIDGET_MIN_DATA_SCOPE`) + wire slug FE
    `DashboardWidgetGrid` (ratchet slug-map đã có — thêm widget quên slug là ĐỎ).
11. Ứng viên là người NGOÀI hệ thống — không FK sang users; own-scope interviewer theo
    participant, không theo người tạo.
12. LANE_DB như CI; deny-path RED-trước, deny có ca ALLOW đối chứng; fixture giả-secret ghép chuỗi.

## 8. Definition of Done cấp wave

- Bộ tài liệu đủ: SPEC-12 (Approved) · DB-14 · API-17 · permission-matrix §9f; SPEC-01/README/
  DB-01·09·10/erd-current/RELEASE-14 (PARK-RECRUIT-001)/IMPLEMENTATION-02 (EPIC-19) đồng bộ.
- Schema + migration: RLS+FORCE, composite tenant-FK, stage_events append-only, seed role
  `recruiter` + §9f + NOTI catalog 2 bảng.
- BE: guard per-pair 2 tầng + FSM + masking server + audit + outbox NOTI + @Idempotent; FE: đủ 6
  màn §6; QA: ma trận per-pair + IDOR/cross-tenant + race double-convert + census mã lỗi xanh
  trên LANE_DB, coverage recruit/ ≥80%.
- DASH: widget «phễu tuyển dụng» theo quyền + sàn scope + slug FE có test.
- `docs/TESTABLE-FEATURES.md` cập nhật; backlog/ledger đóng dấu đủ 6 WO.
