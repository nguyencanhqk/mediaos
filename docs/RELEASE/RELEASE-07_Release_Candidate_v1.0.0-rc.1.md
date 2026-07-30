# RELEASE-07 — RELEASE CANDIDATE `v1.0.0-rc.1` (WS7)

> Work Order **`S6-REL-1`** · `RELEASE-REL-001` · nguồn: [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §16 · luật: [RELEASE-05](RELEASE-05_Scope_Freeze_And_Release_Governance.md) §5.3 · §6
> Soạn: **2026-07-30** · `master` `c4afe351` · migration head **`0534_s6secmv1_dashboard_mv_tenant_barrier`** (202 migration)
>
> ⚠️ **TRẠNG THÁI: CHƯA CẮT ĐƯỢC RC.** 6/8 điều kiện `IMP09-RC-001…008` ĐẠT; **RC-003 và RC-004 CHƯA
> ĐẠT** vì môi trường staging không chạy. Tài liệu này là **checklist + release notes đã soạn sẵn**;
> tag `v1.0.0-rc.1` chỉ được tạo sau khi §2 sạch ô CHƯA ĐẠT (`RELEASE-08` §2).
>
> Không ô nào trong tài liệu này được tick nếu chưa có lệnh/log/số đo kèm theo.

---

## 1. Release information

| Trường | Giá trị |
| --- | --- |
| Version | **`1.0.0-rc.1`** (`package.json` gốc; `RELEASE-05` §6.1) |
| Build date | 2026-07-30 |
| Backend tag | *(một tag cho cả monorepo — `RELEASE-05` §6.2.3)* `v1.0.0-rc.1` — **chưa tạo** |
| Frontend tag | như trên (cùng tag) |
| Migration version | `0534_s6secmv1_dashboard_mv_tenant_barrier` · **202** migration |
| Environment đích | PROD `funtimemediacorp.com` (company `funtime`, 45 nhân viên) |
| Prepared by | `S6-REL-1` |
| **Định danh build kiểm được ở runtime** | `GET /api/v1/health` → `data.build` = `{version, commit, builtAt, migrationHead}` — **MỚI ở RC này** |

---

## 2. Điều kiện tạo RC (IMP09-RC-001…008)

| Mã | Điều kiện | Phán quyết | Bằng chứng |
| --- | --- | --- | --- |
| RC-001 | Không còn `S0` open | ✅ ĐẠT | `RELEASE-02` — KI-038 · KI-043 đã đóng; `S0` = **0** |
| RC-002 | Không còn `S1` open thiếu owner/ETA | ✅ ĐẠT | `S1` = **0** (KI-022/023/024/027/033/034/035/040 đóng) |
| RC-003 | Regression P0 pass **trên staging** | ❌ **CHƯA ĐẠT** | staging `:3200` **không lắng nghe** (đo 2026-07-30). Owner: `m dev-online-fast` rồi chạy §5.2 |
| RC-004 | Migration/seed verified **trên staging** | ❌ **CHƯA ĐẠT** | `mediaos_dev` chốt ở `0529`, head nay `0534` ⇒ **lệch 5**. Owner: `m dev-online-db` |
| RC-005 | Security blocker = 0 | ✅ ĐẠT | 0 CRITICAL/HIGH mở; `Security` CI **xanh** trên master |
| RC-006 | Release notes đủ module | ✅ ĐẠT | §4 tài liệu này (8 module + 4 nhánh mở rộng) |
| RC-007 | Monitoring/health hoạt động | ✅ ĐẠT | `ops-alert-check` 8 nhóm chạy thật — `RELEASE-09` §3; health + build identity — §5.1 |
| RC-008 | Rollback runbook đã review | ✅ ĐẠT | `RELEASE-08` §5 + **diễn tập thật** — §5.3 |

**Ngưỡng bug (`RELEASE-05` §5.3):** `S0` **0** ✅ · `S1` **0** ✅ · `S2` **3** ✅ (≤3, mỗi mục có owner +
workaround: KI-021 · KI-025 · **KI-050**) · `S3/S4` có sổ ✅.

> KI-050 (backup chưa từng chạy) **mở trong chính WO này** — xem §6. Nó đưa `S2` từ 2 lên **3**, tức
> **đúng sát ngưỡng**. Nhận thêm bất kỳ `S2` nào nữa là vượt ngưỡng ⇒ không cắt RC được.

---

## 3. Scope included

Đóng băng theo `RELEASE-05` §2.3. 7 module lõi + FOUNDATION + 4 nhánh Sprint 5.

| Module | Trong RC này |
| --- | --- |
| **AUTH** | Đăng nhập/đăng xuất/refresh (phát hiện tái dùng token) · quên & đổi mật khẩu · **2FA TOTP + mã khôi phục** · phiên đăng nhập · khoá tài khoản · chống dò mật khẩu · login log + security event |
| **Phân quyền** | Vai trò + cặp `MODULE.RESOURCE.ACTION` + **data_scope PER-CẶP** (Own·Team·Department·Company·System); `PermissionGuard` fail-closed là lớp quyết định cuối |
| **HR** | Hồ sơ nhân viên (mask **ở server**) · hợp đồng + cảnh báo hết hạn · tệp hồ sơ · avatar · **yêu cầu sửa hồ sơ theo quy trình duyệt** · sơ đồ tổ chức · import |
| **ATT** | Check-in/out · bảng công · điều chỉnh công + duyệt (cấm tự duyệt) · ca làm · xuất dữ liệu |
| **LEAVE** | Đơn nghỉ + FSM duyệt · số dư phép + giao dịch · đồng bộ ATT · hoàn phép · ngày lễ |
| **TASK** | Dự án · kanban · việc con 1 cấp · bình luận/nhắc tên · tệp + ảnh bìa · vai trò theo dự án |
| **DASH** | Widget theo vai (admin·hr·manager·employee) · matview + cache · **ranh giới tenant cho 2 matview (mig 0534)** |
| **NOTI** | Danh mục sự kiện · outbox → bridge · realtime · deep-link · đánh dấu đã đọc · delivery log |
| **FOUNDATION** | Audit log (append-only) · cấu hình hệ thống · file/MinIO · sequence · module catalog · job nền + `/system/jobs` · retention |
| *(mở rộng S5)* | **ME** (SPEC-09) · **GOAL** (SPEC-10) · **LMS** (SSO-only + kênh NOTI) · **BRAND** (logo/favicon) |

**Ngoài phạm vi** (`RELEASE-05` §2.4): media · finance theo kênh · payroll · đa-công-ty/SaaS · mobile · AI.

---

## 4. Key changes since previous RC

Không có RC trước — đây là RC đầu tiên. Thay đổi tính từ cổng Sprint 5 (`RELEASE-01`, `master` `153e2101`).

### 4.1 Fixed issues (Sprint 6)

| WO | PR | Severity đóng | Tóm tắt |
| --- | --- | --- | --- |
| S6-GOV-1 | — | — | Đóng băng scope + luật phát hành (WS1) |
| S6-STAB-1 | #293 | KI-022 · KI-023 (`S1`) | Checklist ổn định WS2 + đóng 2 nguồn ĐỎ-GIẢ |
| S6-QA-FINAL-1 | #294 | KI-024 (`S1`) · KI-026 | QA final pass WS3 + đóng nguồn đỏ-giả vĩnh viễn |
| S6-SEC-1 | #295 | **`S0`** ghi chéo tenant lên role hệ thống · KI-027 · KI-029 | Hardening WS4 |
| S6-SEC-ROUTEMAP-1 | #296 | — | Census route runtime + đóng vế GET của route-guard sweep |
| S6-QA-CHUNK-1 | — | KI-014 (`S2`) | Truy gốc crash tinypool → runner chia chunk |
| S6-SEC-ORG-1 | #297 | KI-030 (`S2`) | Gate 3 route `/org` lộ danh bạ toàn tenant |
| S6-SEC-DBFENCE-1 | #299 | KI-028 (`S1`) | Bịt nguồn rò test→DB PROD + purge 74 tenant test |
| S6-SEC-LOGINLOG-1 | #300 | KI-042 | Siết vế ĐỌC `login_logs` (hàng NULL-tenant đọc chéo tenant) |
| S6-SEC-NOTITX-1 | #301 | KI-034 (`S1`) | insert+outbox+audit vào MỘT transaction, bỏ 3 nhánh nuốt lỗi |
| S6-SEC-ORGSCOPE-1 | #302 | — | Ép `data_scope` cho `/org/employees` |
| S6-QA-TENANTWRITE-1 | #303 | KI-037 (`S2`) | Lưới cô lập tenant thêm vế GHI (446 → 1087 ca) + vá FK chéo tenant |
| S6-SEC-PERMVERB-1 | #305 | — | Chốt MỘT động từ danh bạ `view:user` |
| S6-SEC-MV-1 | #306 | KI-041 | Ranh giới tenant THẬT cho 2 matview dashboard (mig 0534) |
| S6-PERF-DB-1 | #307 | **KI-008** (`S2`) | WS5/WS6 — restore rehearsal **lần đầu chạy được** + 2 chốt hồi quy DB |
| S6-SEC-LOGINLOG-2 | #308 | KI-044 | Gắn đúng chủ cho hàng `blocked` + bịt oracle timing |
| S6-SEC-ROTATE-1 | #309 | **KI-043 (`S0`)** · KI-045 | Rotate 5 role Postgres PROD, bind loopback, cắt nguồn tái nhiễm |
| S6-SEC-ORGTEAMSCOPE-1 | #310 | KI-049 | Bound 2 cột danh tính của `/org/teams/:id/members` theo cặp danh bạ |
| **S6-REL-1** | *(PR này)* | **KI-011 · KI-016** (`S2`) | WS7/8/9 — xem §5 |

### 4.2 Mới trong `S6-REL-1`

| # | Thay đổi | Vì sao |
| --- | --- | --- |
| 1 | **Định danh build** ở `GET /health` + `scripts/stamp-build.mjs` đóng dấu vào artifact | Trước đây không có cách hỏi PROD "anh đang chạy bản nào" ⇒ smoke/canary/rollback không assert được gì |
| 2 | **Thư mục release bất biến** `apps/api/releases/<stamp>` + junction `current` (`scripts/release-artifact.mjs`) | **Đóng KI-016** — PROD hết dùng chung `dist` với dev-online, và lần đầu có bản trước để quay về |
| 3 | `m prod-rollback` · `m prod-cutover` · `m prod-status` phát hiện lệch | Rollback ứng dụng thành lệnh chạy được, không còn là "có đường nhưng chưa diễn tập" |
| 4 | **`scripts/release-smoke.mjs`** — 10 ca `IMP09-SMOKE-001…010` chạy được | §17.4 trước đây chỉ là bảng trong tài liệu |
| 5 | **`scripts/ops-alert-check.mjs`** + `scripts/lib/ops-alert-rules.mjs` (44 test) | **Đóng KI-011** — §18.3 trước đây 0 rule chạy |
| 6 | Step `tooling-tests (node --test)` trong `harness/check.sh` + `api.yml` | Test của `scripts/`+`harness/` nằm ngoài vitest workspace ⇒ trước đây mồ côi |
| 7 | `RELEASE-08` runbook · `RELEASE-09` monitoring/support | `RELEASE-GO-001` |

---

## 5. Test summary

### 5.1 Chạy thật trong WO này

| Hạng mục | Kết quả | Lệnh |
| --- | --- | --- |
| Unit — build identity | **19/19** | `pnpm vitest run src/health` |
| E2E — hợp đồng `/health` (chống phá canary) | **3/3** | `pnpm vitest run test/health.e2e-spec.ts` |
| Tooling — alert rules + lane-db-guard | **58/58** | `node --test scripts/lib/*.test.mjs harness/*.test.mjs` |
| **Smoke 10 ca** trên artifact release | **10 PASS · 0 FAIL · 1 SKIP** | §5.2 |
| Exit code smoke (4 ca) | 0 / 1 / 1 / 2 đúng thiết kế | §5.2 |
| Alert check trên PROD | 7 ok · **1 unknown** (→ KI-050) | `RELEASE-09` §3 |
| Rollback rehearsal | PASS | §5.3 |

### 5.2 Smoke — bằng chứng

Chạy trên **DB lane cô lập `mediaos_rel1`**, API dựng **từ chính artifact release** (`releases/current`,
`API_PORT=3105`) — KHÔNG đụng PROD:

```text
RELEASE SMOKE (IMPL-09 §17.4) — api=http://localhost:3105/api/v1
chế độ: CHỈ ĐỌC
  ✓ IMP09-SMOKE-010  /health 200 · request_id ok · build 1.0.0-rc.1 · c4afe351 · 0534_…
  ✓ RC-BUILD-MATCH   build.commit khớp --expect-commit
  ✓ IMP09-SMOKE-001  https://funtimemediacorp.com → 200, HTML SPA
  ✓ IMP09-SMOKE-002  Login admin (qua 2FA bước-2) → accessToken
  – IMP09-SMOKE-003  Login employee — SKIP: chưa có tài khoản smoke nhân viên
  ✓ IMP09-SMOKE-004  /auth/me → 200
  ✓ IMP09-SMOKE-005  /dashboard/me → 200
  ✓ IMP09-SMOKE-006  /hr/employees?page=1&pageSize=20 → 200 (có data.meta.total)
  ✓ IMP09-SMOKE-007  /attendance/today → 200
  ✓ IMP09-SMOKE-009  /notifications/unread-count → 200
  ✓ IMP09-SMOKE-008  /leave/requests → 200 (read-only theo §17.4)
  10 PASS · 0 FAIL · 1 SKIP
```

**RED-proof:** `--expect-commit deadbeef` ⇒ `RC-BUILD-MATCH` **ĐỎ** kèm thông điệp "service đang chạy
artifact khác (restart ≠ rebuild)" và exit **1**. Cổng này thật, không phải trang trí.

**Ba phát hiện vận hành trong lúc chạy** (đều đã xử lý trong script, ghi ở đây để người trực go-live
không đọc nhầm thành "release hỏng"):

1. **PROD ép 2FA cho company-admin** (KI-027) ⇒ `POST /auth/login` trả `twoFactorRequired`, KHÔNG trả
   token. Smoke nay đi trọn bước-2. Tài khoản smoke phải có TOTP hoặc vai không `requires_two_factor`.
2. **Admin chưa enroll 2FA đăng nhập được nhưng 403 `TWO_FACTOR_SETUP_REQUIRED` ở MỌI route.** Đúng
   thiết kế, nhưng nhìn giống "release hỏng toàn diện" nếu không biết trước.
3. **Chạy smoke 2 lượt trong cùng cửa sổ 30s ⇒ 401** (chống replay TOTP theo time-step). Script nay chờ
   sang cửa sổ kế rồi **đăng nhập lại** — `challengeToken` là **dùng-một-lần** (`2fa-jti` claim 600s)
   nên retry tại chỗ với challenge cũ sẽ 401 mãi.

### 5.3 Rollback rehearsal — bằng chứng

```text
snapshot #1 → current = 20260730-111023__1.0.0-rc.1__c4afe351
snapshot #2 → current = 20260730-111036__1.0.0-rc.1__c4afe351
rollback (không tham số) → current quay về #1     ✅
verify #1: syntax OK · resolve @nestjs/core · @mediaos/contracts · drizzle-orm  ✅
boot artifact từ releases/current trên DB lane → /health 200 + build identity   ✅
prune --keep 1 khi current là bản CŨ → KHÔNG xoá current, báo rõ đã chừa         ✅
```

Chứng minh được điều quan trọng nhất: **thư mục release đặt trong `apps/api/` thì `node_modules` phân
giải đúng** (nếu đặt ở gốc repo sẽ trượt `apps/api/node_modules` của pnpm isolated ⇒ vỡ lúc chạy).

### 5.4 Regression đầy đủ

| Gói | Kết quả |
| --- | --- |
| `bash harness/check.sh --all --lane-db=rel1` | **XANH — 9/9 step**: `secret-literals` · `lint` · `typecheck` · `migration-no-drop` · `tooling-tests` · **`test (LANE_DB=mediaos_rel1)` [chunked]** · `build` · `prod-tenant-check` · `db-readiness` |
| Deny-path / IDOR / cross-tenant | **CHẠY THẬT** — có `LANE_DB` nên `lane-db-guard` không escalate; không rơi vào "XANH KHÔNG ĐỦ BẰNG CHỨNG" |
| `db-readiness` (đo trên DB PROD, chỉ đọc) | 12/12 index query nặng · **0 bảng có `company_id` thiếu FORCE RLS** (BẤT BIẾN #1) · **0 grant UPDATE/DELETE** cho `mediaos_app` trên 9 bảng ledger (BẤT BIẾN #2) |
| `prod-tenant-check` | `mediaos`: **0 tenant test / 1 company** (hàng rào KI-028 giữ) |
| CI trên `master` | **4/4 xanh** (`API — CI` · `Apps — Frontend CI` · `Security` · `CI`) |
| Regression P0 **trên staging** | ❌ **CHƯA CHẠY** — RC-003 |

---

## 6. Known issues (đồng bộ `RELEASE-02`)

| ID | Severity | Module | Workaround | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- |
| **KI-050** | `S2` | DevOps/backup | Chạy tay `bash scripts/backup-db.sh` trước go-live + đăng ký scheduled task (`RELEASE-09` §4) | ✅ **CÓ** | Owner/DevOps |
| KI-021 | `S2` | ATT/NOTI | 3 sự kiện ATT bật trong danh mục nhưng không có producer — người dùng không nhận thông báo đó | ❌ | Sau MVP |
| KI-025 | `S2` | QA | 98/346 đường API không có test HTTP nào chạm | ❌ | Sau MVP |
| KI-009 | `S3` | Quan sát | Log chưa có cấu trúc JSON | ❌ | Sau MVP |
| KI-046 | `S3` | Bảo mật (toàn vẹn) | 458 FK một-cột — liên kết chéo tenant tạo được; đường ĐỌC an toàn nhờ innerJoin | ❌ | `S6-SEC-XTENANTFK-1` |
| KI-047 · KI-048 | `S3` | Bảo mật (quan sát) | Mù brute-force mã 2FA · nhiễu hàng `blocked` | ❌ | WO mới |
| *(còn lại)* | `S3`/`S4` | — | — | ❌ | `RELEASE-02` |

### KI-050 — chưa từng có bản backup nào trên máy PROD · `S2` · phát hiện 2026-07-30 (`S6-REL-1`)

`scripts/ops-alert-check.mjs` **ngay lần chạy đầu tiên** trả `unknown` cho "tuổi bản backup": không có
thư mục `backups/`, và `Get-ScheduledTask` không có task nào chạy `scripts/backup-db.sh`.

Phân biệt cho đúng, đừng gộp với KI-008: `S6-PERF-DB-1` đã chứng minh **restore drill** chạy được —
nhưng drill đó tự `pg_dump` tại chỗ, nó KHÔNG chứng minh có **backup định kỳ**. Nói cách khác: khôi
phục được từ một bản dump vừa tạo ≠ có bản dump để khôi phục khi máy hỏng. `RELEASE-01` §7.3 tick
"Script backup ✅" — đúng là script tồn tại, nhưng **chưa từng chạy**. Lại đúng bài học của dự án:
*script tồn tại ≠ script chạy được*.

**Vá:** `RELEASE-09` §4 (task hằng ngày 02:00) + chạy tay một bản trước go-live (`RELEASE-08` §4 T-3).

---

## 7. Deployment note

| Mục | Giá trị |
| --- | --- |
| Migration required | **CÓ** — PROD đang ở 202/202 (head `0534`); staging `mediaos_dev` **thiếu 5** |
| Seed required | KHÔNG — master-data seed idempotent chạy lúc boot |
| Config change required | **CÓ (một lần)** — `m prod-cutover` trỏ service sang `releases\current` (KI-016) |
| Rollback compatible | **CÓ** — `m prod-rollback` (app). Schema theo expand/contract, KHÔNG down-migration |
| Downtime dự kiến | ~1–2 phút (restart service + canary) |
| Thứ tự bắt buộc | `RELEASE-08` §4 T-0 — **migrate TRƯỚC restart**, fail-closed nếu schema chưa ở head |

---

## 8. Việc phải làm TRƯỚC khi cắt tag (owner)

| # | Việc | Đóng ô nào |
| --- | --- | --- |
| O1 | `m dev-online-db` → `m dev-online-fast` (bật staging + áp 5 migration còn thiếu) | **RC-004** |
| O2 | `node scripts/release-smoke.mjs --base http://localhost:3200/api/v1 --strict` + regression P0 | **RC-003** |
| O3 | `bash scripts/backup-db.sh` + đăng ký 2 scheduled task (`RELEASE-09` §4) | **KI-050** |
| O4 | Tạo **tài khoản smoke** (vai tối thiểu, không `requires_two_factor`) → gỡ SKIP của SMOKE-003 | chất lượng smoke |
| O5 | `m prod-cutover` (Administrator) | KI-016 ở PROD |
| O6 | Ký accepted-risk **D3** + chạy UAT Cycle 1 | `RELEASE-01` C3/C4 |
| O7 | Sau khi PR merge: tạo tag `v1.0.0-rc.1` (`RELEASE-08` §2) | cắt RC |

---

## 9. Approval

| Vai | Người | Ngày | Chữ ký |
| --- | --- | --- | --- |
| Product | | | |
| QA | | | |
| Tech Lead | | | |
| DevOps | | | |
| Stakeholder | | | |

> Ô chữ ký **chỉ người điền**. `S6-REL-1` không tự ký, không tự chốt Go/No-go (đó là `S6-GOLIVE-1`).
