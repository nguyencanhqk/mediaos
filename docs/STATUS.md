# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-08-13 18:37Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S10-SOCIAL-OPS-1 — Đưa kho sang ổ D: (SOCIAL_DATA_DIR) + đổi dịch vụ MediaOS-Social từ LocalSystem sang tài khoản Windows có quyền trên share LAN + sao lưu data/ và .secrets/ TÁCH nhau
- **zone**: red · **skills**: security-review
- **sửa ở đâu (paths)**: `.env`, `scripts/windows/**`, `docs/DEVOPS/DEVOPS-14_Social_Satellite_App_Deployment.md`, `docs/plans/S10-SOCIAL-OPS-1.md`
- **phụ thuộc**: S10-SOCIAL-LIB-1✓
- **done_when (đích hội tụ)**:
  - [ ] SOCIAL_DATA_DIR trỏ ổ D:, dịch vụ khởi động lại và ĐỌC ĐÚNG kho mới — chứng minh bằng việc thêm 1 media rồi thấy file xuất hiện dưới D:, KHÔNG phải chỉ đọc log
  - [ ] Tài khoản dịch vụ đọc được share LAN — chứng minh bằng lệnh chạy DƯỚI CHÍNH tài khoản đó (không phải test bằng phiên đăng nhập của owner, sẽ đỏ oan/xanh oan)
  - [ ] Mật khẩu tài khoản dịch vụ KHÔNG vào git, KHÔNG vào log (BẤT BIẾN #3)
  - [ ] DEVOPS-14 thêm mục: đường nạp video nặng, trần 100MB của Cloudflare, và vì sao KHÔNG dùng LocalSystem
  - [ ] Sao lưu định kỳ data/ (ổ D:) và .secrets/ (KEK) TÁCH nhau — ghi đè KEK = mọi token FB thành rác vĩnh viễn

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S7-CHAT-LMS-1` Gỡ chat khỏi LMS (GIỮ trợ lý AI) + trỏ lối vào sidebar sang /chat MediaOS + xuất 84 tin lịch sử ra tệp lưu trữ
- 🟡 `S7-CALL-QA-2` Test FE cuộc gọi: bật đo coverage cho apps/app + phủ 1.241 dòng đang là điểm mù (use-chat-call 676 · CallExperience 307 · CallProvider 143 · call-ringtone 115)
- 🟡 `S10-ATT-NOTIPROD-1` 3 sự kiện ATT bật trong danh mục nhưng KHÔNG AI PHÁT (`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED`) — danh mục hứa, hệ thống không giao
- 🟡 `S10-QA-ROUTEHTTP-1` Một mảng lớn đường dẫn API không có test HTTP nào chạm — guard/DTO/envelope của route CHƯA TỪNG chạy, phủ ở tầng service không chứng minh được cổng

**CHỜ (kẹt phụ thuộc):**
- _(trống)_

**🛑 BLOCKED:**
- `S6-SEC-IDENTITY-PROJ-1` Gốc rễ của N-1/N-2/N-1c — buộc TẦNG CHIẾU `users.email`/`users.fullName` phải nhận vị từ scope, thiếu thì VỠ TYPECHECK (không phải trả 0 hàng im lặng)
  - **vì sao chặn**: KIEM TRA LAI 03/08 - GIU HOAN. (1) Van CHUA thi cong: 0 docs/plans/S6-SEC-IDENTITY-PROJ-1.md, 0 commit code mang ma WO (3 commit nhac ten deu la chore(docs|gov)), 0 worktree, 0 nhanh. (2) KI-053 + KI-054 VAN MO tren cay…

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S5-QA-E2E-1`, `S5-BE-CONTRACT-1`, `S5-SEC-1`, `S5-QA-REG-1`, `S5-QA-DASHNOTI-1`, `S5-PERF-1`, `S5-UAT-1`, `S6-GOV-1`, `S6-STAB-1`, `S6-QA-FINAL-1`, `S6-SEC-1`, `S6-PERF-DB-1`, `S6-QA-CHUNK-1`, `S6-SEC-ROUTEMAP-1`, `S6-SEC-ORG-1`, `S6-SEC-ORGSCOPE-1`, `S6-SEC-ORGTEAMSCOPE-1`, `S6-SEC-IDENTITYBOUND-1`, `S6-SEC-PERMVERB-1`, `S6-SEC-NOTITX-1`, `S6-SEC-LOGINLOG-1`, `S6-SEC-LOGINLOG-2`, `S6-SEC-XTENANTFK-1`, `S6-SEC-MV-1`, `S6-SEC-DBFENCE-1`, `S6-SEC-ROTATE-1`, `S6-QA-TENANTWRITE-1`, `S6-REL-1`, `S6-GOLIVE-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-TASK-DEPTFILTER-1`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`, `S5-LEAVE-DEADCODE-1`, `S5-SEQ-HARDEN-1`, `S5-TASK-PIPELINE-1`, `S5-TASK-NAV-TREE-1`, `S5-TASK-WORKSPACE-1`, `S5-TASK-DETAIL-1`, `S5-TASK-SUBTASK-1`, `S5-DASH-TASKSTATUS-FIX-1`, `S5-TASK-PROJROLE-1`, `S5-TASK-BOARD-UX-1`, `S5-TASK-INLINE-1`, `S5-TASK-AVATAR-1`, `S5-TASK-CARDSUB-1`, `S5-TASK-MOVEPROJ-1`, `S5-TASK-COVER-1`, `S5-GOAL-DOC-1`, `S5-GOAL-DB-1`, `S5-GOAL-BE-1`, `S5-GOAL-BE-2`, `S5-GOAL-FE-1`, `S5-GOAL-FE-2`, `S5-GOAL-DB-2`, `S5-GOAL-TPL-1`, `S5-FND-REVOKE-1`, `S5-GOAL-DASH-1`, `S5-LMS-DB-1`, `S5-LMS-BE-1`, `S5-LMS-BE-2`, `S5-LMS-APP-1`, `S5-LMS-APP-2`, `S5-LMS-APP-3`, `S5-LMS-BE-3`, `S5-LMS-FE-1`, `S5-LMS-BE-4`, `S5-LMS-UI-1`, `S5-LMS-UI-2`, `S5-LMS-UI-3`, `S5-LMS-UI-4`, `S5-LMS-OPEN-DIRECT-1`, `S5-LMS-NOTI-1`, `S5-LMS-NOTI-2`, `S5-FND-THEME-AA-1`, `S5-FND-UI-GEN-1`, `S5-SYS-CLEAN-1`, `S5-DEVOPS-DEPLOYMIG-1`, `S5-BRAND-BE-1`, `S5-BRAND-FE-1`, `S5-BRAND-FE-2`, `S7-GOAL-PROJTAB-1`, `S7-CHAT-DOC-1`, `S7-CHAT-DOC-2`, `S7-CHAT-DB-1`, `S7-CHAT-DB-2`, `S7-CHAT-BE-1`, `S7-CHAT-BE-2`, `S7-CHAT-BE-3`, `S7-FND-LINKFALLBACK-1`, `S7-CHAT-BE-4`, `S7-CHAT-BE-5`, `S7-CHAT-BE-6`, `S7-INT-OUTBOX-FIFO-1`, `S7-CHAT-RT-0`, `S7-CHAT-RT-1`, `S7-CHAT-FE-1`, `S7-CHAT-BE-8`, `S7-CHAT-FE-2`, `S7-CHAT-FE-3`, `S7-CHAT-FE-4`, `S7-CHAT-BE-7`, `S7-CHAT-FE-5`, `S7-CHAT-BE-9`, `S7-CALL-DOC-1`, `S7-CALL-DB-1`, `S7-CALL-BE-1`, `S7-CALL-RT-1`, `S7-CALL-FE-1`, `S7-CALL-QA-1`, `S7-CALL-RT-FIX-1`, `S7-CALL-RT-FIX-2`, `S7-CHAT-QA-1`, `S7-CHAT-CLEAN-1`, `S7-QA-CATALOGFIXTURE-1`, `S7-QA-OUTBOXPROBE-1`, `S7-CHAT-DB-3`, `S7-CHAT-CLEAN-2`, `S7-SEC-ROLE2FA-UI-1`, `S6-OPS-LOGWINDOW-1`, `S6-LEAVE-ACCRUAL-1`, `S6-LEAVE-CARRYOVER-1`, `S6-LEAVE-MAXNEG-1`, `S6-LEAVE-TYPEADMIN-1`, `S8-CHAT-UX-DOC-1`, `S8-CHAT-UX-FE-1`, `S8-CHAT-UX-DB-1`, `S8-CHAT-UX-BE-1`, `S8-CHAT-UX-BE-2`, `S8-CHAT-UX-BE-3`, `S8-CHAT-UX-RT-1`, `S8-CHAT-UX-FE-2`, `S8-CHAT-UX-FE-3`, `S8-CHAT-UX-QA-1`, `S8-CHAT-ENTRY-1`, `S9-SOCIAL-DOC-1`, `S9-SOCIAL-SEC-1`, `S9-SOCIAL-APP-1`, `S9-SOCIAL-DB-1`, `S9-SOCIAL-BE-1`, `S9-SOCIAL-FE-1`, `S9-SOCIAL-DEVOPS-1`, `S9-SOCIAL-QA-1`, `S10-SOCIAL-LIB-1`, `S10-SOCIAL-LIB-2`, `S10-OPS-SITEWATCH-1`, `S10-OPS-ALERTCHAN-1`, `S10-FND-ENVKEY-1`, `S10-QA-LOGNOISE-1`, `S10-FND-JSONLOG-1`, `S10-DASH-MVREFRESH-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 0
- **migration head**: idx 213 — `0546_s7calldb1_chat_calls` (214 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `ad2325f6` | 2026-08-14 | docs(plan): kế hoạch thi công S10-ATT-NOTIPROD-1 sau 2 vòng plan-review (29 chốt) + sửa paths WO |
| `71ba8803` | 2026-08-14 | chore(docs): regen STATUS + INDEX đầu phiên (auto-loop) |
| `975d7484` | 2026-08-13 | chore(docs): regen STATUS sau khi land #383 (S10-FND-JSONLOG-1 done) |
| `f4d262e9` | 2026-08-13 | fix(ops): log API ra JSON có cấu trúc + đấu lại bộ đếm ERROR của ops-alert (S10-FND-JSONLOG-1 · KI-009) (#383) |
| `e8ab653e` | 2026-08-13 | wip(S10-DASH-MVREFRESH-1): job lịch chạy refresh MV dashboard (đóng nửa 2 KI-017) (#382) |
| `09384d68` | 2026-08-13 | fix(noti): dập nhiễu log outbox bridge tại đúng nơi phát (S10-QA-LOGNOISE-1, KI-015) (#381) |
| `03ac3ca0` | 2026-08-13 | chore(docs): regen STATUS + INDEX đầu phiên (auto-loop) |
| `11df9320` | 2026-08-13 | chore(docs): regen STATUS sau khi land #380 (S10-FND-ENVKEY-1 done) |
| `badcb5e0` | 2026-08-13 | fix(config): khai INTERNAL_API_KEY vào env.schema + .env.example (S10-FND-ENVKEY-1 · KI-031) (#380) |
| `823a60ce` | 2026-08-13 | chore(harness): seed 6 Work Order từ KI đang mở ở RELEASE-02 — backlog cạn còn 3 READY, nay 8 |
| `116b4c86` | 2026-08-13 | feat(ops): trình cài Cloudflare Tunnel cho máy mới — giao diện điền tên miền/cổng + chốt an toàn (#379) |
| `2b03863c` | 2026-08-13 | chore(docs): regen STATUS sau khi land #378 (S7-CALL-RT-FIX-2 done, 0 in_progress) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
