# S5-UAT-1 — UAT prep + run + release readiness (gate vào Sprint 6)

> Work Order **S5-UAT-1** — Workstream J/K/M (🟡 yellow / LIGHT gate).
> Nguồn: `IMPLEMENTATION-08` §5.1 · §19 (WS-J UAT Preparation) · §20 (WS-K UAT Execution) ·
> §22 (WS-M Documentation & Handoff) · §25 (DoD Sprint 5) · §26 (Go/No-Go) · `QA-09` · `QA-10`.
> Phụ thuộc (đều đã ship): `S5-QA-E2E-1` · `S5-QA-REG-1` · `S5-SEC-1`.

---

## 1. Phạm vi — cái gì máy làm được, cái gì chỉ người làm được

UAT theo định nghĩa là **người dùng nghiệp vụ** ngồi chạy kịch bản và **ký nghiệm thu**. Phiên này
KHÔNG thể tự ký thay owner. Vì vậy WO chia đôi rành mạch, không giả vờ "đã UAT xong":

| Phần | Ai làm | Trạng thái sau WO này |
| --- | --- | --- |
| **A. UAT prep** (kit: scope · account · data · script theo role · feedback form · severity guide · known limitations · sign-off template) | Phiên này | ✅ GIAO ĐỦ — `docs/QA/evidence/S5-UAT-1-UAT-KIT.md` |
| **B. UAT Cycle 0** (readiness / dry-run: kiểm entry criteria, đo dữ liệu UAT thật, chạy bằng chứng tự động) | Phiên này | ✅ ĐÃ CHẠY — `docs/QA/evidence/S5-UAT-1-UAT-CYCLE0-DRYRUN.md` |
| **C. UAT Cycle 1–3** (business user chạy script trên UI, ghi feedback, ký) | **Owner / business user** | ⏳ CHỜ — kit + runbook sẵn; **DB + dữ liệu UAT đã dựng xong 2026-07-26**, chỉ còn bật stack (xem §4) |
| **D. Release readiness + known issues + release notes + Go/No-Go draft** | Phiên này | ✅ GIAO ĐỦ — `docs/RELEASE/**` |

> **Nguyên tắc chống xanh-giả:** mọi ô "PASS" trong bộ tài liệu này phải trỏ tới **bằng chứng chạy
> được** (tên spec + tên `it()`, số đo, hoặc câu SQL đã chạy). Ô nào chưa có bằng chứng ghi thẳng là
> `CHỜ` / `BLOCKED`, không suy diễn từ "code có vẻ đúng".

---

## 2. Đầu ra (7 file)

| File | Nội dung | Ánh xạ |
| --- | --- | --- |
| `docs/plans/S5-UAT-1.md` | File này — phạm vi, runbook, reconcile | — |
| `docs/QA/evidence/S5-UAT-1-UAT-KIT.md` | UAT kit đủ 9 deliverable | IMPL-08 §19.2 UAT-DEL-001…009 |
| `docs/QA/evidence/S5-UAT-1-UAT-CYCLE0-DRYRUN.md` | Biên bản Cycle 0: entry criteria + đo dữ liệu + phát hiện | QA-09 §11 · §13.1 · IMPL-08 §23.2 T015 |
| `docs/RELEASE/RELEASE-01_MVP_Release_Readiness_Checklist.md` | Scorecard 10 nhóm + checklist migration/seed/env/monitoring/backup/rollback | QA-10 §6…§22 |
| `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` | Sổ known issues + defer list + workaround + owner | QA-10 §23 · IMPL-08 §22.1 |
| `docs/RELEASE/RELEASE-03_Release_Notes_Internal_MVP.md` | Release notes nội bộ (module × cái gì dùng được) | IMPL-08 §22.1 |
| `docs/RELEASE/RELEASE-04_UAT_Signoff_And_Go_NoGo.md` | Sign-off draft từng module + Go/No-Go + bàn giao Sprint 6 | QA-09 §33 · QA-10 §25 · IMPL-08 §22.2 · §26 |

Đầu ra C+D là **đầu vào IMP09-IN-003/004** cho Sprint 6 (`S6-GOV-1`, `S6-STAB-1`).

---

## 3. Bằng chứng dùng lại (KHÔNG chạy lại từ đầu)

| Nguồn | Dùng cho |
| --- | --- |
| `docs/QA/evidence/S5-QA-REG-1-REGRESSION-SIGNOFF.md` | Functional QA + UI-state + a11y — QA-10 §8 |
| `docs/QA/evidence/S5-SEC-1-PERM-SCOPE-SUITE.md` (QA-PERM-001) | Permission & data-scope — QA-10 §13.2 |
| `docs/_review/S5-SEC-1-SECURITY-TESTING-2026-07-25.md` | Security readiness + accepted-risk D3 — QA-10 §13 |
| `docs/DEVOPS/DEVOPS-15_Performance_Smoke_Observability_Baseline_Report.md` | Performance + observability — QA-10 §14 · §16 |
| `docs/plans/S5-QA-E2E-1.md` + `qae2e1-full-journey.int-spec.ts` | E2E P0 — QA-10 §8.1 |
| `docs/plans/S5-DEVOPS-1.md` | Topology PROD ‖ UAT, thứ tự deploy/seed — QA-10 §15 |
| `scripts/migrate-verify-ephemeral.sh` · `scripts/backup-restore-drill.sh` · `scripts/canary-watch.sh` | Migration-from-empty · backup restore · post-deploy smoke |

---

## 4. Runbook cho owner — bật môi trường UAT rồi chạy Cycle 1

> ⚠️ **Landmine (bắt buộc đọc):** PROD `MediaOS-API` (NSSM, :3100) chạy **chính** `apps/api/dist` của
> repo này. `m dev-online` (nest --watch) **và** `m dev-online-fast` (`turbo run build --filter=@mediaos/api
> --force`) đều **biên dịch lại `dist` đó**. Nếu build mới yêu cầu migration mà DB `mediaos` (PROD) chưa
> áp → PROD login 500. Vì vậy phiên này **KHÔNG tự bật dev-online**; owner chạy tay và biết mình đang
> đánh đổi cái gì.
>
> **Cập nhật 2026-07-26:** bước 0–2 **đã làm xong** (owner uỷ quyền trong phiên) — xem
> `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §0. Chỉ còn bước 3 trở đi.

```powershell
# ── ĐÃ XONG 2026-07-26 ─────────────────────────────────────────────────────
# 0) PROD + UAT đều đã ở head 0529 (197/197); PROD health 200 sau migrate
#    m migrate                     # PROD mediaos  — có pg_dump backup trước
#    m dev-online-migrate          # UAT mediaos_dev (migrate-only, không seed lại)
# 1) Hồ sơ nhân viên UAT-EMP-01/UAT-MGR-01/UAT-HR-01 + quan hệ quản lý  → đã tạo
# 2) Số dư phép 2026: employee ANNUAL 12 + SICK 5, manager ANNUAL 12    → đã cấp
# ── CÒN LẠI ────────────────────────────────────────────────────────────────
# 3) Bật stack UAT (bản build, không watch)
m dev-online-fast                  # ⚠️ recompile dist dùng chung với PROD — xem cảnh báo trên
                                   #    PROD DB nay đã ở head nên build mới KHÔNG lệch schema
# 4) Chỉ SAU khi health 200 mới smoke login
curl http://localhost:3200/api/v1/health
bash scripts/canary-watch.sh       # CANARY_BASE_URL=http://localhost:3200/api/v1
# 5) Chạy UAT theo kit
#    docs/QA/evidence/S5-UAT-1-UAT-KIT.md  §5 (script theo role) · §7 (feedback form)
```

URL UAT: app `https://cian-dev.funtimemediacorp.com` · auth `https://cian-dev-auth…` ·
console `https://cian-dev-console…`. Tài khoản: xem KIT §3 (mật khẩu ở `.env` `STAGING_SEED_*`,
KHÔNG ghi vào doc).

---

## 5. Bất biến / rủi ro

- **Giai đoạn khảo sát (Cycle 0):** mọi thao tác trên `mediaos_dev` **và** `mediaos` (PROD) là
  **read-only SELECT** — không ghi, không drop, không restart service nào.
- **Giai đoạn khắc phục (sau khi owner uỷ quyền, 2026-07-26)** — ghi lại đúng cái đã đụng:
  - `mediaos` (PROD): chạy `m migrate` → áp `0529`. **Có `pg_dump -Fc` backup trước**
    (`c:\tmp\mediaos-prod-20260726-100718.dump`). Không rebuild `dist`, không restart service,
    không deploy FE. `/health` + `/health/db` vẫn 200 sau khi migrate.
  - `mediaos_dev` (UAT): `m dev-online-migrate` (migrate-only) + 1 transaction SQL idempotent tạo
    3 hồ sơ nhân viên · 1 quan hệ quản lý · 3 dòng số dư phép.
- **BẤT BIẾN #1/#2/#3 không suy yếu:** không code sản phẩm, không migration MỚI, không grant.
  `company_id` tường minh ở mọi INSERT; không xoá/ghi đè dòng nào; không secret trong doc.
- **Nợ đã biết từ cách khắc phục:** dữ liệu UAT bơm bằng SQL nên **không có bản ghi `audit_logs`**
  (khác với làm qua UI). Ghi rõ ở Cycle-0 §0 để không ai đọc audit rồi tưởng dữ liệu tự sinh.
- **Rủi ro chính:** kit UAT mô tả màn hình theo route THẬT (`apps/app/src/router.tsx`) — nếu Sprint 6
  đổi route thì kit phải cập nhật cùng; đã ghi rõ nguồn route ở KIT §5 để dò lại nhanh.

---

## 6. Reconcile — done_when đạt / hoãn

| done_when | Trạng thái | Ghi chú |
| --- | --- | --- |
| UAT script theo role + test data + user chuẩn bị | ✅ ĐẠT | KIT §3/§4/§5 — 4 tài khoản `uat.*` có thật; hồ sơ nhân viên + số dư phép **đã dựng xong 2026-07-26** |
| **chạy UAT**, ghi nhận feedback + bug triage | ⚠️ **PARTIAL** | **Cycle 0 ĐÃ chạy**; 3 blocker phát hiện → **đã đóng cả 3**. **Cycle 1–3 (business user) = việc của owner** — không tự ký thay |
| Release readiness checklist chốt; sign-off draft từng module | ✅ ĐẠT | RELEASE-01 + RELEASE-04 |
| Known issues + release notes nội bộ | ✅ ĐẠT | RELEASE-02 + RELEASE-03 |
| `check.sh` xanh | ⚠️ **ĐẠT CÓ ĐIỀU KIỆN** | lint ✅ · typecheck ✅ · test **xanh khi chia chunk** (445 file / 7.113 test, 0 fail). `check.sh` chạy một-tiến-trình **in ĐỎ** vì crash hạ tầng vitest `ERR_IPC_CHANNEL_CLOSED` — **0 ca test đỏ**. Không tô hồng: xem Cycle-0 §2.3 + KI-014 |
| Đầu ra là đầu vào IMP09-IN-003/004 | ✅ ĐẠT | RELEASE-04 §6.1 |

**Kết luận WO:** đóng ở trạng thái **partial-owner** cho vế "chạy UAT với business user" — KHÔNG
auto-green giả. Phần máy làm được đã làm hết và có bằng chứng; 3 blocker do Cycle 0 phát hiện cũng đã
được khắc phục sau khi owner uỷ quyền. Việc duy nhất còn lại trước Cycle 1: **bật stack UAT**.
