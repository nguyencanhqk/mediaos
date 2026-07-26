# RELEASE-01 — MVP RELEASE READINESS CHECKLIST (bản chấm thật)

> Bản **điền số liệu thật** của khung `QA-10`. Sinh trong Work Order `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration journal head **0529** (197 entry).
> Khung tham chiếu: [QA-10](../QA/QA-10_MVP_Release_Readiness_Checklist.md) · `IMPLEMENTATION-08 §26`.
>
> ⚠️ **Cổng mà tài liệu này quyết định là "được vào Sprint 6 hay không"**, KHÔNG phải "được go-live hay
> không". Quyết định go-live thuộc `S6-REL-1`/`S6-GOLIVE-1` với checklist RC + runbook riêng.

---

## 1. Kết luận: **CONDITIONAL GO sang Sprint 6** — điểm **82,5 / 100**

Không có gate-fail nào (0 lỗ bảo mật CRITICAL/HIGH mở · 0 bug sản phẩm P0 mở · không lộ dữ liệu trái
quyền · không migration phá huỷ chưa duyệt). Điểm hụt nằm ở **hai chỗ, đều không phải chất lượng code**:

1. **Business acceptance = 0** vì **UAT chưa chạy với người dùng thật** (Cycle 0 mới chạy — 3 chặn dữ
   liệu/vận hành phải đóng trước, xem `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §4).
2. **Deploy/rollback + monitoring mới đạt một nửa**: chưa có bằng chứng diễn tập khôi phục gần đây,
   chưa có cảnh báo tự động.

> **Cập nhật 2026-07-26 (sau khi chốt điểm):** nợ migration của PROD + UAT **đã trả** (cả hai 197/197)
> và dữ liệu UAT **đã bơm** — tức C1/C2 ở §10 đã đóng. Điểm scorecard giữ nguyên **82,5** vì hai nhóm
> hụt điểm (business acceptance · deploy&rollback) phụ thuộc UAT thật + diễn tập khôi phục, chưa có cái
> nào trong hai cái đó xảy ra.

---

## 2. Scorecard (QA-10 §6)

| Nhóm | Trọng số | Điều kiện đạt | Trạng thái | Điểm |
| --- | ---: | --- | --- | ---: |
| Product scope | 10% | Scope MVP rõ, không creep mất kiểm soát | **Passed** (có ghi chú §3.1) | 10,0 |
| Business acceptance | 10% | UAT pass + sign-off business | **Not started** — Cycle 1 chưa mở | 0,0 |
| Functional QA | 15% | P0/P1 test case pass | **Passed** — 10.086 test, 0 fail | 15,0 |
| E2E QA | 10% | Flow E2E chính pass | **Passed** | 10,0 |
| API contract | 10% | Contract/response/error/permission pass | **Passed** | 10,0 |
| Permission & data scope | 15% | Không lộ dữ liệu trái quyền | **Passed** — ma trận 5 scope × 7 module | 15,0 |
| Security | 10% | Không còn Critical/High mở | **Passed** (1 accepted-risk chờ ký) | 10,0 |
| Performance | 5% | Baseline đạt hoặc được chấp nhận | **Passed** — p95 ≤ 30ms/5 endpoint | 5,0 |
| Deployment & rollback | 10% | Deploy rehearsal, migration, rollback OK | **In progress** | 5,0 |
| Monitoring & support | 5% | Log, alert, hypercare sẵn sàng | **In progress** | 2,5 |
| **TỔNG** | 100% | | | **82,5** |

Quy tắc QA-10 §6: `≥90% → Go` · `80–89% → Conditional Go` · `<80% hoặc có gate-fail → No-Go`.

---

## 3. Product & Business readiness (QA-10 §7)

### 3.1 Scope MVP

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| 7 module lõi (AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI) đã build | ✅ | 281 Work Order, xem `docs/plans/INDEX.md` |
| Ranh giới out-of-scope rõ | ✅ | de-media-fy 2026-06-20: media/finance/payroll park; SaaS đa-công-ty hoãn (N=1) |
| Scope creep có kiểm soát? | ⚠️ **CÓ MỞ RỘNG, có kiểm soát** | Sprint 5 nhận thêm 4 nhánh ngoài 7 module gốc: **ME** (`/me` Personal Hub, SPEC-09) · **GOAL** (SPEC-10 + DB-11) · **LMS** (tích hợp app học tập) · **BRAND** (logo/favicon). Tất cả đều qua WO có `done_when` + ship qua PR, KHÔNG phải creep ngầm. **Sprint 6 `S6-GOV-1` phải đóng băng chính thức.** |
| Danh sách defer | ✅ | `RELEASE-02` §4 |

### 3.2 Business acceptance

| Mục | Trạng thái |
| --- | --- |
| UAT script theo role | ✅ `S5-UAT-1-UAT-KIT.md` §5 — 84 scenario / 4 vai |
| UAT Cycle 0 (dry-run) | ✅ đã chạy |
| UAT Cycle 1–3 | ❌ **chưa chạy** |
| Business Owner ký nghiệm thu | ❌ **chưa** — `RELEASE-04` |

---

## 4. Functional / E2E / API / Permission (QA-10 §8–§9, §13.2)

### 4.1 Tổng quan test execution

| Gói | File | Test | Kết quả |
| --- | ---: | ---: | --- |
| `@mediaos/api` (DB thật, `LANE_DB`, chạy 6 chunk) | 445 (+1 skip) | 7.113 | ✅ 0 fail |
| `@mediaos/app` | 199 | 1.502 | ✅ |
| `@mediaos/web-core` | 39 | 635 | ✅ |
| `@mediaos/contracts` | 32 | 536 | ✅ |
| `@mediaos/console` | 23 | 179 | ✅ |
| `@mediaos/ui` | 16 | 98 | ✅ |
| `@mediaos/auth` | 4 | 23 | ✅ |
| **TỔNG** | **759** | **10.086** | ✅ |

Lint ✅ · typecheck ✅. Chi tiết + 2 bẫy đo đạc: `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §2.

### 4.2 Readiness theo module (QA-10 §8.2–§8.9)

| Module | Regression | E2E | Permission/scope | Bug P0 mở | Sẵn sàng |
| --- | --- | --- | --- | ---: | --- |
| AUTH | ✅ | ✅ login→refresh→logout→2FA | ✅ Company-only, cross-tenant→404 | 0 | ✅ |
| FOUNDATION/HOME | ✅ | ✅ my-apps theo quyền | ✅ module toggle deny | 0 | ✅ |
| HR | ✅ | ✅ hồ sơ→hợp đồng→change-request | ✅ Own/Team/Dept/Company + mask lương/CCCD | 0 | ✅ |
| ATT | ✅ | ✅ check-in/out→điều chỉnh→duyệt | ✅ team-records, cấm tự-duyệt | 0 | ✅ |
| LEAVE | ✅ | ✅ tạo→duyệt→sync ATT→hoàn phép | ✅ approve ngoài phạm vi→403 | 0 | ✅ |
| TASK | ✅ | ✅ giao việc→đổi trạng thái→bình luận | ✅ ma trận theo dự án, fail-closed 404 | 0 | ✅ |
| NOTI | ✅ | ✅ event→thông báo→deep-link→mark-read | ✅ deep-link mất-quyền→403 | 0 | ✅ |
| DASH | ✅ | ✅ widget theo vai + cache invalidate | ✅ count-only + không PII | 0 | ⚠️ 1 accepted-risk (D3) + 1 known issue cache (KI-005) |
| **GOAL** (ngoài MVP gốc) | ✅ | ⚠️ chưa có dữ liệu UAT | ✅ IDOR chéo tenant→404 | 0 | ⚠️ nghiệm thu P2 |
| **LMS** (tích hợp) | ✅ | ⚠️ | ✅ SSO-only + audit | 0 | ❌ **chặn bởi KI-006** (thiếu migration `0529`) |

### 4.3 API contract (QA-10 §9)

| Mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| OpenAPI đủ auth/quyền/mã lỗi | ✅ | `S5-BE-CONTRACT-1` (PR #287) — sinh từ metadata guard, không gắn tay |
| Idempotency-Key được thực thi | ✅ | như trên |
| Envelope response nhất quán | ✅ | `{success,message,data,error,meta.request_id}` |
| Query invalidation sau mutation (§13.3) | ✅ | `S5-BE-CONTRACT-1` |
| Versioning | ✅ | `/api/v1` |

### 4.4 Permission & data scope (QA-10 §13.2)

Ma trận **5 scope × 7 module** + 13 checklist + 6 negative — mỗi ô cite 1 assertion int-spec đang chạy:
`docs/QA/evidence/S5-SEC-1-PERM-SCOPE-SUITE.md`. **Không ô nào thiếu enforcement.**

---

## 5. Security readiness (QA-10 §13)

| Mục | Trạng thái |
| --- | --- |
| CRITICAL / HIGH mở | **0 / 0** |
| OWASP API Top 10 | 10/10 PASS hoặc N/A-có-lý-do |
| 3 bất biến (`company_id`+RLS · append-only/soft-delete · không secret plaintext) | GIỮ VỮNG |
| Accepted-risk chờ owner ký | **D3** — widget `hr-overview` count-only hiển thị headcount toàn công ty cho HR có scope Department |
| Quyết định theo thiết kế | **D1** — `refresh`/`resetPassword` không throttle (có reuse-detection + token hash dùng-một-lần) |
| Secret scan (gitleaks) | ✅ xanh trên master |
| Dependency scan (`pnpm audit`) | ❌ **ĐỎ — do công cụ, không phải lỗ hổng** (xem §7.2) |

Nguồn: `docs/_review/S5-SEC-1-SECURITY-TESTING-2026-07-25.md`.

---

## 6. Performance readiness (QA-10 §14)

| Mục | Số đo | Ngưỡng MVP | Kết quả |
| --- | --- | --- | --- |
| 5 endpoint SLA lõi (danh sách NV · chấm công · danh sách việc · đếm chưa đọc · widget dashboard) | p95 ≤ **30ms** | 800ms | ✅ dư xa |
| Pagination có limit / không N+1 / unread dùng partial index | — | — | ✅ xác nhận |
| Load test quy mô lớn | — | — | ❌ **không làm ở MVP** (có chủ đích) |

Cảnh báo diễn giải: số đo lấy trên DEV-ONLINE dataset nhỏ ⇒ là **baseline hình dạng truy vấn**, không
phải SLA dưới tải. Nguồn: `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md`.

---

## 7. Deployment & DevOps readiness (QA-10 §15) — **điểm yếu nhất**

### 7.1 Environment & migration

| Mục | Trạng thái | Chi tiết |
| --- | --- | --- |
| Môi trường PROD chạy | ✅ | NSSM `MediaOS-API` :3100 + Cloudflare tunnel + Pages; `/health` **200**, `/health/db` **200** (kiểm 2026-07-26) |
| Môi trường UAT chạy | ❌ | :3200 **không lắng nghe** — DB đã sẵn sàng, chỉ chờ owner bật stack |
| Migration chạy được từ DB trống | ✅ | `scripts/migrate-verify-ephemeral.sh` + step riêng trong `api.yml` (DB ephemeral, guard cấm drop `mediaos`/`mediaos_dev`) |
| **PROD đã áp hết migration?** | ✅ **RỒI (2026-07-26)** | `m migrate` → `mediaos` **197/197**, 4 mã `LMS_*` có mặt; `/health` + `/health/db` vẫn 200 sau migrate. Có `pg_dump` backup trước khi chạy |
| **UAT đã áp hết migration?** | ✅ **RỒI (2026-07-26)** | `m dev-online-migrate` → `mediaos_dev` **197/197** (migrate-only, không seed lại) |
| Migration ép chạy TRƯỚC restart | ✅ | `m prod-update` fail-closed + `m prod-status` đếm migration tồn đọng (`S5-DEVOPS-DEPLOYMIG-1`) |
| Seed tài khoản UAT tái lập được | ✅ | `scripts/seed-staging-accounts.mjs` idempotent, cred qua env, không đụng `role_permissions` |

### 7.2 CI/CD

| Workflow | Trạng thái master | Ghi chú |
| --- | --- | --- |
| `API — CI` | ✅ xanh | gồm migrate-from-empty + `db:check` |
| `Apps — Frontend CI` | ✅ xanh | |
| `Security` | ❌ **đỏ** | Job `Secret scan (gitleaks)` **xanh**; job `Dependency scan (pnpm audit)` **đỏ vì `ERR_PNPM_AUDIT_BAD_RESPONSE`** — endpoint advisory của npm trả body gzip mà pnpm không parse được. **Tái hiện y hệt khi chạy local** ⇒ lỗi công cụ/registry, **chưa chứng minh có lỗ hổng high/critical**. Cần WO nhỏ ở Sprint 6: retry/đổi nguồn advisory, hoặc không để job này khoá release |
| `Auto-merge` | ✅ | squash sau CI xanh + 1 review người |

### 7.3 Backup & rollback

| Mục | Trạng thái |
| --- | --- |
| Script backup | ✅ `scripts/backup-db.sh` (dump → mã hoá → offsite) |
| Script diễn tập **khôi phục** | ✅ tồn tại `scripts/backup-restore-drill.sh` (dump → restore DB tạm → verify chuỗi migration + schema/RLS/index → tự dọn) |
| **Bằng chứng đã chạy drill gần đây** | ❌ **KHÔNG CÓ** — không tìm thấy log/biên bản drill nào trong repo. "Backup chưa restore-test = chưa phải backup" |
| Rollback ứng dụng | ⚠️ có đường (`m prod-update` giữ build cũ, NSSM restart) nhưng **chưa diễn tập ghi biên bản** |
| Rollback migration | ⚠️ chưa có runbook down-migration; chiến lược hiện tại là expand-contract + restore từ backup |

➡️ **Việc Sprint 6 (`S6-PERF-DB-1`):** chạy `backup-restore-drill.sh` một lần trên bản sao PROD và
lưu biên bản; viết runbook rollback có thời gian mục tiêu.

---

## 8. Observability & Support readiness (QA-10 §16)

| Mục | Trạng thái |
| --- | --- |
| `request_id` truy vết end-to-end | ✅ có trong `meta` mọi response |
| Health liveness/readiness tách bạch | ✅ `/health` · `/health/db` (fail-soft, phải đọc body) |
| Canary sau deploy | ✅ `scripts/canary-watch.sh` |
| Job nền quan sát được | ✅ `/system/jobs` + `system_job_runs` |
| Log có cấu trúc (JSON) | ❌ **chưa** — còn `Logger` text (khuyến nghị R1) |
| Cảnh báo tự động (5xx-rate, disk, backup-fail, SSL) | ❌ **chưa** (khuyến nghị R3) |
| Kênh hỗ trợ + hypercare | ❌ **chưa lập** — thuộc `S6-REL-1` |

---

## 9. Ngưỡng bug trước release (QA-10 §17)

| Mức | Ngưỡng cho phép | Thực tế |
| --- | --- | --- |
| S0 Blocker | 0 | **0** |
| S1 Critical | 0 | **0** |
| S2 Major | ≤3, đều có owner + workaround | **3** — UAT-BLOCK-001/002/003 (đều là **dữ liệu/vận hành**, không phải defect sản phẩm; workaround = làm theo `Cycle-0 §4.2`) |
| S3 Minor | không giới hạn cứng, phải có sổ | **6** — xem `RELEASE-02` |

---

## 10. Điều kiện Conditional Go (phải đóng trước khi bước tiếp)

| # | Điều kiện | Owner | Chặn cái gì |
| --- | --- | --- | --- |
| ~~C1~~ | ~~Áp migration `0529` cho `mediaos_dev` và `mediaos`~~ — ✅ **XONG 2026-07-26** | — | — |
| ~~C2~~ | ~~Đóng UAT-BLOCK-001/002 (hồ sơ nhân viên + số dư phép)~~ — ✅ **XONG 2026-07-26** | — | — |
| C3 | Chạy UAT Cycle 1 theo KIT §5, đạt Exit criteria QA-09 §12 | Owner + business user | Sign-off nghiệm thu |
| C4 | Owner ký accepted-risk **D3** (dashboard headcount cho HR-Department) | Owner | Đóng sổ bảo mật MVP |
| C5 | Chạy `backup-restore-drill.sh` + lưu biên bản | Owner/DevOps | Điểm Deploy & rollback |
| C6 | Xử lý job `Dependency scan` đỏ (sửa công cụ hoặc gỡ khỏi cổng chặn) | Owner/DevOps | CI xanh toàn phần |

**C1–C2 đã đóng 2026-07-26** ⇒ việc còn lại để mở Cycle 1 chỉ là **bật stack UAT** (`m dev-online-fast`,
owner quyết vì đụng `dist` dùng chung với PROD). C3–C4 chặn sign-off. C5–C6 chặn go-live (Sprint 6),
không chặn vào Sprint 6.

---

## 11. Thuộc Sprint 6 — KHÔNG làm ở tài liệu này

RC checklist · runbook deploy production · smoke test production · rollback decision tree · hypercare ·
Go/No-Go meeting cuối: đều nằm ở `S6-REL-1` / `S6-GOLIVE-1` theo `IMPLEMENTATION-09`. Ghi ở đây để
không ai tưởng bộ này đã đủ cho go-live.
