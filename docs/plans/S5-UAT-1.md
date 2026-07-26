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
| **C. UAT Cycle 1–3** (business user chạy script trên UI, ghi feedback, ký) | **Owner / business user** | ⏳ CHỜ — kit + runbook đã sẵn, môi trường cần owner bật (xem §4) |
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
| `docs/DEVOPS/DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` | Performance + observability — QA-10 §14 · §16 |
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

```powershell
# 0) An toàn PROD trước: PROD đang ở migration nào so với head?

m prod-status                      # đếm migration tồn đọng (S5-DEVOPS-DEPLOYMIG-1)

# 1) Đưa DB UAT (mediaos_dev) lên head 0529 — KHÔNG drop/wipe

m dev-online-db                    # hoặc: m dev-online-migrate

# 2) Bù dữ liệu UAT còn thiếu (xem Cycle-0 §4 — 2 blocker)

#    → hồ sơ nhân viên cho 4 tài khoản uat.* + số dư phép năm

#    (chưa có script; owner làm qua UI Admin/HR hoặc xin 1 WO seed — xem RELEASE-02 KI-001/002)

# 3) Bật stack UAT (bản build, không watch)

m dev-online-fast                  # ⚠️ recompile dist dùng chung với PROD — xem cảnh báo trên
                                   #    sau khi UAT xong: cân nhắc m prod-update để PROD về đúng build

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

- **Không đụng PROD.** Mọi thao tác đo đạc của WO này trên `mediaos_dev` là **read-only SELECT**;
  không INSERT/UPDATE/DELETE, không drop, không seed. PROD `mediaos` không bị chạm.
- **BẤT BIẾN #1/#2/#3 không suy yếu:** WO docs-only, không code sản phẩm, không migration, không grant.
- **Rủi ro chính:** kit UAT mô tả màn hình theo route THẬT (`apps/app/src/router.tsx`) — nếu Sprint 6
  đổi route thì kit phải cập nhật cùng; đã ghi rõ nguồn route ở KIT §5 để dò lại nhanh.

---

## 6. Reconcile — done_when đạt / hoãn

| done_when | Trạng thái | Ghi chú |
| --- | --- | --- |
| UAT script theo role + test data + user chuẩn bị | ✅ ĐẠT | KIT §3/§4/§5 — 4 tài khoản `uat.*` đã tồn tại thật trong `mediaos_dev` |
| **chạy UAT**, ghi nhận feedback + bug triage | ⚠️ **PARTIAL** | **Cycle 0 (dry-run) ĐÃ chạy** + 2 blocker dữ liệu đã triage. **Cycle 1–3 (business user) = việc của owner** — không tự ký thay |
| Release readiness checklist chốt; sign-off draft từng module | ✅ ĐẠT | RELEASE-01 + RELEASE-04 |
| Known issues + release notes nội bộ | ✅ ĐẠT | RELEASE-02 + RELEASE-03 |
| `check.sh` xanh | ✅ ĐẠT | xem Cycle-0 §2 (kèm ghi chú flake `ERR_IPC_CHANNEL_CLOSED` đã biết + số đo chạy tuần tự) |
| Đầu ra là đầu vào IMP09-IN-003/004 | ✅ ĐẠT | RELEASE-04 §5 |

**Kết luận WO:** đóng ở trạng thái **partial-owner** cho vế "chạy UAT với business user" — KHÔNG
auto-green giả. Phần máy làm được đã làm hết và có bằng chứng.
