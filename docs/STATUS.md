# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-28 15:27Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S6-SEC-NOTITX-1 — KI-034 — gộp insert notification + outbox + audit vào MỘT transaction (repo.create nhận tx), bỏ đường .catch nuốt lỗi làm mất audit + sự kiện chỉ với một dòng warn
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/notifications/**`, `apps/api/src/events/**`, `apps/api/test/**`, `docs/RELEASE/**`, `docs/plans/S6-SEC-NOTITX-1.md`
- **done_when (đích hội tụ)**:
  - [ ] RED TRƯỚC: test chứng minh khi outbox.enqueue HOẶC audit.record ném thì notification KHÔNG tồn tại. Trên code hiện tại test phải ĐỎ (nay notification vẫn tồn tại, chỉ có một dòng warn)
  - [ ] NotificationsRepository.create nhận `tx` tuỳ chọn; NotificationsService.create mở MỘT withTenant bọc cả ba bước; không còn nhánh nuốt lỗi im lặng cho đường tạo
  - [ ] Rà MỌI caller đường nóng (OutboxNotificationBridge + module gọi create) xem có caller nào đã ở trong transaction khác không ⇒ chống tx lồng/deadlock; nếu có thì nhận tx từ caller thay vì tự mở
  - [ ] Docstring khớp code sau khi sửa — kiểm lại từng câu, vì chính docstring sai là gốc của KI-034
  - [ ] Quyết định về markRead ghi rõ lý do: giữ best-effort có chủ ý (đã await 2026-07-27) hay gộp luôn — không để mơ hồ
  - [ ] FULL gate security-reviewer + silent-failure-hunter (nếu agent không có trong môi trường thì GHI RÕ đã thay bằng gì — theo tiền lệ S6-SEC-1 §7c); RELEASE-02 KI-034 đóng

### 🔴 S6-SEC-ROTATE-1 — KI-043 (S0, CHẶN GO-LIVE) — mật khẩu Postgres PROD chính là literal trong repo PUBLIC: rotate 5 role, gỡ nguồn tái nhiễm mediaos.ps1, bind 127.0.0.1, cắm chốt chống tái diễn
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `mediaos.ps1`, `docker-compose.yml`, `.env.example`, `.env.dev-online.example`, `apps/api/demo-seed-base.mjs`, `apps/api/demo-seed-full.mjs`, `apps/api/demo-seed-dashboard.mjs`, `apps/api/seed-operator.mjs`, `scripts/**`, `harness/**`, `.github/workflows/**`, `docs/RELEASE/**`, `docs/plans/S6-SEC-ROTATE-1.md`
- **done_when (đích hội tụ)**:
  - [ ] Rotate 5 role (mediaos · mediaos_owner · mediaos_app · mediaos_worker · pgbouncer_auth) sang mật khẩu sinh ngẫu nhiên. THỨ TỰ BẮT BUỘC: sinh secret → cập nhật file env (KHÔNG tracked) → ALTER ROLE → restart pgbouncer/API/dev-online/worker → verify. Đảo thứ tự = PROD 500 ngay
  - [ ] Bằng chứng hai chiều: literal CŨ nối vào PROD phải THẤT BẠI (có log), và /health/db vẫn 200 + funtime vẫn 46 user sau rotate
  - [ ] SỬA mediaos.ps1 TRƯỚC KHI rotate — Invoke-Roles đang đặt lại mật khẩu về literal dev; không sửa thì lần chạy sau âm thầm khôi phục lỗ hổng
  - [ ] git grep literal `changeme_*` trên file tracked = 0 ở đường chạy thật; fixture test nếu giữ thì phải lấy từ env hoặc ghép chuỗi (CLAUDE.md §5 luật fixture-giống-secret)
  - [ ] Postgres bind 127.0.0.1 (hoặc bằng chứng firewall chặn 5432 từ ngoài); cân nhắc 6432/6379/9000
  - [ ] Chốt hồi quy chạy được theo lệnh + trong CI: literal `changeme_*` quay lại file tracked ⇒ ĐỎ
  - [ ] Script seed (demo-seed-*, seed-operator) fail-closed khi không khai DB đích tường minh — cùng tinh thần hàng rào KI-028
  - [ ] KHÔNG history-rewrite (ghi rõ quyết định + lý do vào plan): literal đã public từ lâu, giá trị phòng thủ sau rotate ≈ 0 còn chi phí thì thật
  - [ ] FULL gate security-reviewer PASS; KI-043 đóng kèm số đo; RELEASE-01 chấm lại CRITICAL/HIGH

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6
- 🔴 `S6-SEC-ORGSCOPE-1` N-1 (hậu FULL gate S6-SEC-ORG-1) — ép data_scope trong OrgRepository.listEmployees: gate cặp-quyền đã có nhưng role scope Own/Team/Department vẫn nhận TRỌN danh bạ tenant kèm email
- 🔴 `S6-SEC-PERMVERB-1` N-2 (hậu FULL gate S6-SEC-ORG-1) — chốt MỘT động từ giữa `read:user` (legacy) và `view:user` (canonical mig 0444) rồi backfill PER-PAIR; nay hr/manager/hr-manager đều lệch cặp
- 🔴 `S6-SEC-LOGINLOG-2` KI-044 — hàng blocked/TooManyAttempts ghi company_id NULL kể cả khi slug HỢP LỆ (rate-limit chạy trước resolveCompanyId) ⇒ admin mất quan sát brute-force nhắm vào chính công ty mình sau 0532
- 🔴 `S6-SEC-MV-1` KI-041 — 2 matview dashboard nằm NGOÀI RLS (Postgres không hỗ trợ): dựng ranh giới thật ở tầng DB thay vì chỉ WHERE company_id trong service, hoặc rút bề mặt / ký waiver có bằng chứng (migration 0533)
- 🔴 `S6-QA-TENANTWRITE-1` KI-037 — lưới tenant-isolation (156 bảng × 3 ca) CHỈ SELECT: không có một ca deny GHI chéo tenant nào; bổ sung vế INSERT/UPDATE/DELETE vào chính harness data-driven

**CHỜ (kẹt phụ thuộc):**
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-PERF-DB-1, S6-SEC-NOTITX-1, S6-SEC-MV-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S5-QA-E2E-1`, `S5-BE-CONTRACT-1`, `S5-SEC-1`, `S5-QA-REG-1`, `S5-QA-DASHNOTI-1`, `S5-PERF-1`, `S5-UAT-1`, `S6-GOV-1`, `S6-STAB-1`, `S6-QA-FINAL-1`, `S6-SEC-1`, `S6-QA-CHUNK-1`, `S6-SEC-ROUTEMAP-1`, `S6-SEC-ORG-1`, `S6-SEC-LOGINLOG-1`, `S6-SEC-DBFENCE-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-TASK-DEPTFILTER-1`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`, `S5-LEAVE-DEADCODE-1`, `S5-SEQ-HARDEN-1`, `S5-TASK-PIPELINE-1`, `S5-TASK-NAV-TREE-1`, `S5-TASK-WORKSPACE-1`, `S5-TASK-DETAIL-1`, `S5-TASK-SUBTASK-1`, `S5-DASH-TASKSTATUS-FIX-1`, `S5-TASK-PROJROLE-1`, `S5-TASK-BOARD-UX-1`, `S5-TASK-INLINE-1`, `S5-TASK-AVATAR-1`, `S5-TASK-CARDSUB-1`, `S5-TASK-MOVEPROJ-1`, `S5-TASK-COVER-1`, `S5-GOAL-DOC-1`, `S5-GOAL-DB-1`, `S5-GOAL-BE-1`, `S5-GOAL-BE-2`, `S5-GOAL-FE-1`, `S5-GOAL-FE-2`, `S5-GOAL-DB-2`, `S5-GOAL-TPL-1`, `S5-FND-REVOKE-1`, `S5-GOAL-DASH-1`, `S5-LMS-DB-1`, `S5-LMS-BE-1`, `S5-LMS-BE-2`, `S5-LMS-APP-1`, `S5-LMS-APP-2`, `S5-LMS-APP-3`, `S5-LMS-BE-3`, `S5-LMS-FE-1`, `S5-LMS-BE-4`, `S5-LMS-UI-1`, `S5-LMS-UI-2`, `S5-LMS-UI-3`, `S5-LMS-UI-4`, `S5-LMS-OPEN-DIRECT-1`, `S5-LMS-NOTI-1`, `S5-LMS-NOTI-2`, `S5-FND-THEME-AA-1`, `S5-FND-UI-GEN-1`, `S5-SYS-CLEAN-1`, `S5-DEVOPS-DEPLOYMIG-1`, `S5-BRAND-BE-1`, `S5-BRAND-FE-1`, `S5-BRAND-FE-2`

## Trạng thái repo

- **branch**: `wo/s6-sec-notitx-1` · **file đang đổi (dirty)**: 7
- **migration head**: idx 199 — `0532_s6secloginlog1_login_logs_tenant_read` (200 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `b9ea43f2` | 2026-07-28 | fix(sec): S6-SEC-LOGINLOG-1 — KI-042: siết vế ĐỌC của login_logs (hàng NULL-tenant đọc được chéo tenant) (#300) |
| `b4fb0f14` | 2026-07-28 | chore(docs): regen STATUS + đóng dấu ledger S6-SEC-DBFENCE-1 sau merge #299 |
| `9acb91d6` | 2026-07-28 | fix(sec): S6-SEC-DBFENCE-1 — KI-028 đóng lại: bịt nguồn rò test→DB PROD + purge 74 tenant + chốt hồi quy (#299) |
| `cdedef78` | 2026-07-27 | docs(release): mở 2 WO hậu FULL gate S6-SEC-ORG-1 — N-1 data_scope + N-2 chốt động từ quyền |
| `74e79e48` | 2026-07-27 | chore(docs): regen STATUS + plans/INDEX sau khi merge S6-SEC-ORG-1 (KI-030 đóng) |
| `4d132a2d` | 2026-07-27 | fix(sec): S6-SEC-ORG-1 — gate 3 route đọc /org đang lộ danh bạ toàn tenant (KI-030) (#297) |
| `6a614788` | 2026-07-27 | test(sec): S6-SEC-ROUTEMAP-1 — census route runtime + đóng vế GET của route-guard sweep (#296) |
| `dde98ac5` | 2026-07-27 | chore(harness): S6-QA-CHUNK-1 — đóng KI-014 bằng runner chia chunk trong check.sh |
| `6c028899` | 2026-07-27 | docs(release): mở 6 WO vá known-issue S6 — KI-030/034/041/042 + Phụ lục A runtime + KI-014 |
| `094518df` | 2026-07-27 | docs(release): KI-038 đóng — mig 0531 đã áp PROD, verify trigger đang hoạt động |
| `acdf714a` | 2026-07-27 | fix(sec): S6-SEC-1 — WS4 hardening + vá S0 ghi chéo tenant lên role hệ thống toàn cục (#295) |
| `5ac3fd05` | 2026-07-27 | test(qa): S6-QA-FINAL-1 — QA final pass WS3 + đóng 1 nguồn đỏ-giả vĩnh viễn (#294) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
