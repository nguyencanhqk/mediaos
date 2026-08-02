# RELEASE-10 — FINAL SIGN-OFF · GO/NO-GO DECISION (WS10)

> Work Order **`S6-GOLIVE-1`** · nguồn: [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §19 · luật: [RELEASE-05](RELEASE-05_Scope_Freeze_And_Release_Governance.md) §5.3 · §6
> Đo và soạn: **2026-07-31** · `origin/master` `a17ff684` · migration head repo **`0535_s6secxtenantfk1_composite_tenant_fk`** (203 migration)
> Tiền đề: [RELEASE-07](RELEASE-07_Release_Candidate_v1.0.0-rc.1.md) (RC) · [RELEASE-08](RELEASE-08_Go_Live_Runbook.md) (runbook) · [RELEASE-09](RELEASE-09_Monitoring_Alerting_Support_Readiness.md) (monitoring/support)
>
> ## ⚠️ PHÁN QUYẾT: **NO-GO** tại thời điểm 2026-07-31
>
> **Không phải vì sản phẩm hỏng** — 7 module lõi + 4 nhánh mở rộng đều chạy, `S0` = 0, `S1` = 0, CI 4/4
> xanh. NO-GO vì **4 cổng phát hành bắt buộc chưa đạt**, trong đó có 2 cổng chưa từng được kiểm trên
> môi trường nào: regression + migration **trên staging** (`RC-003`/`RC-004`). Điều kiện chính xác để
> lật sang GO nằm ở §6 — tất cả đều làm được trong một buổi.
>
> Không ô nào trong tài liệu này được tick nếu chưa có lệnh/log/số đo kèm theo. Ô không đo được ghi
> **CHƯA ĐO ĐƯỢC** — một cổng xanh vì không có dữ liệu là chế độ hỏng nguy hiểm nhất.

---

## 1. Điều đã thay đổi trong chính WO này

WO này không chỉ chấm điểm — nó chạy thật 3 việc và bịt 1 lỗ chặn go-live.

| # | Việc | Trước | Sau |
| --- | --- | --- | --- |
| 1 | **`scripts/backup-db.sh` chạy được trên máy PROD** | ❌ `ERROR: pg_dump not found` — exit 1 | ✅ fallback `docker exec`, có 6 test chốt |
| 2 | **Bản backup đầu tiên của hệ thống** | ❌ chưa từng có bản nào | ✅ `mediaos-20260731-072306.dump` — 3.861.533 byte, ~1 giây |
| 3 | **Bản backup đó khôi phục được** | giả định | ✅ `DRILL PASS` — restore + migration + RLS/FORCE + ledger + index + smoke |
| 4 | **Tín hiệu giám sát "tuổi backup"** | `unknown` (không có nguồn) | ✅ `ok` — 0 giờ |
| 5 | **`backups/` lọt tầm `git add`** | ❌ **KHÔNG** gitignore | ✅ đã chặn (`.gitignore`) trước khi dump đầu tiên tồn tại |

Chi tiết lỗ #1 và vì sao nó là lỗ chặn: [`docs/plans/S6-GOLIVE-1.md`](../plans/S6-GOLIVE-1.md) §2.

> Điểm #5 đáng dừng lại một nhịp: dump chứa PII của 45 nhân viên + hash mật khẩu + toàn bộ audit log,
> và repo này **PUBLIC**. Nếu chạy backup ở gốc repo trước khi sửa `.gitignore`, một `git add -A` là đủ
> để đẩy nó lên. Thứ tự đúng — gitignore TRƯỚC, dump SAU — đã được giữ.

---

## 2. Go/No-go checklist (IMPL-09 §19.2)

| # | Nhóm | Câu hỏi | Kết quả | Bằng chứng |
| --- | --- | --- | --- | --- |
| 1 | Scope | Scope MVP đã freeze chưa? | ✅ **ĐẠT** | `RELEASE-05` hiệu lực 2026-07-26; 7 module lõi + FOUNDATION + 4 nhánh S5 (`RELEASE-07` §3) |
| 2 | RC | RC build/tag đã chốt chưa? | ❌ **CHƯA** | `git tag -l` → **0** tag release (6 tag đều `archive/*`·`backup/*`·`tooling-*`). `version` = `1.0.0-rc.1` nhưng **chưa cắt tag** |
| 3 | Bug | P0/P1 còn mở không? | ✅ **ĐẠT** | `S0` = **0** · `S1` = **0** (`RELEASE-02`) |
| 4 | Regression | Flow P0/P1 pass chưa? | ⚠️ **MỘT PHẦN** | Trên **lane DB cô lập**: `check.sh --all --lane-db` 9/9 step XANH + smoke 10/10 (`RELEASE-07` §5). Trên **staging**: ❌ chưa chạy — `RC-003` |
| 5 | UAT | Stakeholder đã sign-off chưa? | ❌ **CHƯA** | `RELEASE-04` vẫn là **bản thảo chưa ký**; 0/5 ô chữ ký |
| 6 | Security | Có security blocker không? | ⚠️ **KHÔNG blocker, có 1 gap mới** | 0 CRITICAL/HIGH mở · CI `Security` xanh · gitleaks pass. **Mới: `KI-056`** — 4/6 tài khoản `SA` (379/379 quyền) không có 2FA (§4) |
| 7 | Performance | API/flow chính đạt ngưỡng chưa? | ✅ **ĐẠT** | `S6-PERF-DB-1` (#307): 12/12 index query nặng; `db-readiness` xanh |
| 8 | Migration | Migration/seed staging pass chưa? | ❌ **CHƯA** | `mediaos_dev` không chạy; PROD ở **202/203** — tồn đọng `0535` — `RC-004` |
| 9 | Backup | Backup production/pre-release sẵn sàng chưa? | ⚠️ **MỘT PHẦN — cải thiện lớn ở WO này** | ✅ có bản backup thật + khôi phục được (§1). ❌ **chưa có lịch tự động** (cần Administrator) và dump **chưa mã hoá** — `KI-050` còn mở |
| 10 | RTO/RPO & DR | Đạt target theo lớp dữ liệu chưa? | ❌ **KHÔNG ĐẠT RPO** | Target `COMPLIANCE-01`: **RTO ≤ 4 giờ · RPO ≤ 15 phút**. Thực tế: restore drill xong trong **~14 giây** ⇒ RTO ĐẠT thoải mái; nhưng **không có PITR/WAL archiving, không có offsite** ⇒ backup ngày = **RPO tới 24 giờ** — lệch target **96 lần** |
| 11 | Rollback | Rollback runbook đã review chưa? | ✅ **ĐẠT** | `RELEASE-08` §5 + diễn tập thật (`RELEASE-07` §5.3): snapshot → rollback → verify → boot |
| 12 | Monitoring | Health/log/alert hoạt động chưa? | ⚠️ **MỘT PHẦN** | `ops-alert-check` 8 nhóm chạy thật (7 ok · 1 warn). ❌ **chưa đăng ký scheduled task** ⇒ cảnh báo **không tự chạy**; lệnh trong `RELEASE-09` §4 lại **thiếu env** (§5) |
| 13 | Support | Support guide/channel đã có chưa? | ✅ **ĐẠT — hoàn tất ở WO này** | Quy trình: `RELEASE-09` §6. Nội dung: `RELEASE-11` (admin) · `RELEASE-12` (user) · `RELEASE-13` (FAQ) |
| 14 | Communication | User/stakeholder đã được thông báo chưa? | ❌ **CHƯA** | Mẫu thông báo có ở `RELEASE-08` §7; **chưa gửi** — việc của owner |
| 15 | Handoff | Bộ bàn giao đủ chưa? | ✅ **ĐẠT — hoàn tất ở WO này** | 10/10 `IMP09-HANDOFF-001…010` — §3 |

**Tổng: 6 ĐẠT · 4 MỘT PHẦN · 5 CHƯA ĐẠT.**

---

## 3. Handoff package (IMPL-09 §19.5)

| Mã | Tài liệu/Artifact | Ở đâu | Người nhận | Trạng thái |
| --- | --- | --- | --- | --- |
| HANDOFF-001 | Release notes | [`RELEASE-07`](RELEASE-07_Release_Candidate_v1.0.0-rc.1.md) §3–§4 | Stakeholder · QA · Support | ✅ |
| HANDOFF-002 | Go-live runbook | [`RELEASE-08`](RELEASE-08_Go_Live_Runbook.md) §4 | DevOps · Tech Lead · QA | ✅ |
| HANDOFF-003 | Rollback plan | [`RELEASE-08`](RELEASE-08_Go_Live_Runbook.md) §5 | DevOps · Tech Lead | ✅ đã diễn tập |
| HANDOFF-004 | UAT sign-off package | [`RELEASE-04`](RELEASE-04_UAT_Signoff_And_Go_NoGo.md) | Product · Stakeholder | ⚠️ **bản thảo chưa ký** |
| HANDOFF-005 | Test summary report | [`RELEASE-07`](RELEASE-07_Release_Candidate_v1.0.0-rc.1.md) §5 + `docs/QA/` | QA · Product · Tech Lead | ✅ |
| HANDOFF-006 | Known issues list | [`RELEASE-02`](RELEASE-02_Known_Issues_MVP.md) | Support · Product | ✅ |
| HANDOFF-007 | **Admin guide** | [`RELEASE-11`](RELEASE-11_Admin_Guide.md) | Admin · HR · Super Admin | ✅ **mới** |
| HANDOFF-008 | **User guide** | [`RELEASE-12`](RELEASE-12_User_Guide.md) | Nhân viên · Quản lý · HR | ✅ **mới** |
| HANDOFF-009 | **Support FAQ** | [`RELEASE-13`](RELEASE-13_Support_FAQ.md) | Đội hỗ trợ | ✅ **mới** |
| HANDOFF-010 | **Post-go-live backlog** | [`RELEASE-14`](RELEASE-14_Post_Go_Live_Backlog.md) | Product · PM | ✅ **mới** |

---

## 4. `KI-056` — 4/6 tài khoản `SA` không có lớp bảo vệ thứ hai · `S2` · phát hiện 2026-07-31

Đo trực tiếp trên DB PROD `mediaos` (chỉ đọc):

```sql
SELECT r.name, r.requires_two_factor AS role_flag, u.require_two_factor AS user_flag,
       (SELECT count(*) FROM user_totp t WHERE t.user_id = u.id) AS has_totp, count(*)
FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
WHERE r.name = 'SA' GROUP BY 1,2,3,4;
--  SA | f | f | 0 | 4      ← 4 tài khoản: không cờ role, không cờ user, KHÔNG enroll TOTP
--  SA | f | f | 1 | 2
```

Role `SA` giữ **379/379** quyền catalog — tức mọi thao tác nghiệp vụ trên toàn công ty, gồm đọc hồ sơ
nhân sự chưa mask. Trên hệ đang giữ PII của **45 nhân viên**, 4 tài khoản mức đó hiện chỉ được bảo vệ
bằng **mật khẩu**.

Trớ trêu là `company-admin` (1 tài khoản, 329 quyền) **có** `requires_two_factor = true` và đã enroll —
tức vai **kém quyền hơn** lại được bảo vệ chặt hơn vai toàn quyền.

Không phải bug — là **cờ cấu hình chưa bật**, và nó được ghi sẵn trong code:

```ts
// apps/api/src/config/env.schema.ts:188
// ⚠️ … 2FA: role này requires_two_factor=false (tiện dùng); bật ở prod nếu cần.
```

"Bật ở prod nếu cần" — chưa ai bật. Đúng khuôn *comment mô tả ý định, không mô tả trạng thái*.

**Vá (rẻ, làm trước go-live):** 4 người enroll TOTP ở **App `/me/security/2fa`** (hoặc Console
`/settings/security` — cùng một TOTP, xem `RELEASE-11` §3.2), **hoặc**
bật cờ trên role `SA`. ⚠️ Bật cờ trước khi enroll ⇒ 4 tài khoản đó lập tức 403
`TWO_FACTOR_SETUP_REQUIRED` ở **mọi** route (đúng thiết kế, `RELEASE-07` §5.2 điểm 2) — **enroll trước,
bật cờ sau**.

### 4.1 Ảnh hưởng lên ngưỡng chặn RC

`RELEASE-05` §5.3 cho phép tối đa **3** `S2` mở, mỗi mục có owner + workaround.

| `S2` mở | Trạng thái |
| --- | --- |
| KI-021 (ATT thiếu producer NOTI) | mở |
| KI-025 (98/346 đường API không có test HTTP) | mở |
| KI-050 (backup) | mở — **đã giảm mạnh** ở WO này (§1), còn lại: lịch tự động + mã hoá |
| **KI-056** (2FA cho `SA`) | **mở — MỚI** |

⇒ **`S2` = 4 > ngưỡng 3.** Đây là cổng thứ năm chặn RC, và là cổng **rẻ nhất** để mở: enroll TOTP cho 4
tài khoản đưa `S2` về 3 ngay.

---

## 5. Hai lệnh trong runbook sẽ gãy khi chạy thật

Phát hiện khi đối chiếu `RELEASE-09` §4 với thực tế máy. Ghi ở đây để người trực không mất buổi go-live
đi tìm nguyên nhân.

| # | Lệnh | Vấn đề | Sửa |
| --- | --- | --- | --- |
| 1 | `Register-ScheduledTask -TaskName "MediaOS-BackupDaily"` (`RELEASE-09` §4) | Task chạy `bash.exe scripts/backup-db.sh` **không có `DATABASE_DIRECT_URL`** trong env ⇒ script exit ngay ở `: "${DATABASE_DIRECT_URL:?…}"`. Task Scheduler **không** đọc `.env` của repo | Bọc bằng `-c` nạp `.env` trước — xem `RELEASE-11` §6.2 |
| 2 | `-Execute "C:\Program Files\Git\bin\bash.exe"` | Trên máy này Git Bash nằm ở **`C:\Program Files\Git\usr\bin\bash.exe`**; đường `\bin\bash.exe` là wrapper, có máy không có | Dùng đường dẫn đã kiểm bằng `where bash` |

> Cả hai đều thuộc loại *"đã viết lệnh nhưng chưa ai gõ lệnh đó"* — cùng họ với lỗ `backup-db.sh` (§1).
> Lệnh đã sửa nằm ở `RELEASE-11` §6.2 và **cần Administrator** ⇒ owner chạy.

---

## 6. Điều kiện lật NO-GO → GO

Thứ tự bắt buộc — đảo là dẫm vào landmine `dist` dùng chung (`RELEASE-08` §3).

| # | Việc | Lệnh | Mở cổng nào | Ai | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| G1 | Enroll TOTP cho 4 tài khoản `SA` | App `/me/security/2fa` | **KI-056** ⇒ `S2` về 3 | 4 người đó | ⬜ |
| G2 | Backup trước khi đụng schema | `DATABASE_DIRECT_URL=… BACKUP_DIR=./backups bash scripts/backup-db.sh` | an toàn cho G3 | Owner | ✅ `backups/mediaos-20260802-010032.dump` |
| G3 | Deploy PROD lên head | `m prod-update api` | ô #8 (hết tồn đọng) · warn migration | Owner | ✅ PROD **205/205 @ `0537`** |
| G4 | **Cutover** (tách PROD khỏi `dist`) | `m prod-cutover` | **KI-016**; mở khoá G5 an toàn | Owner (**Administrator**) | ✅ **ĐÃ XONG** — chứng minh bằng thực nghiệm |
| G5 | Dựng staging | clone PROD → `mediaos_dev` → `m dev-online-fast` | tiền đề `RC-003`/`RC-004` | Owner | ✅ trên **dữ liệu PROD thật** |
| — | **Nghiệm thu engine cộng dồn phép** | `GET /leave/admin/accrual/preview` | chặn 422 ngày đầu | Owner | ✅ **245 ngày / 41 NV** |
| G6 | Regression P0 + smoke trên staging | `node scripts/release-smoke.mjs --base http://localhost:3200/api/v1 --strict` | **`RC-003`** ⇒ ô #4 | Owner | ✅ **10 PASS · 0 FAIL · 0 SKIP** |
| G7 | Đăng ký 2 scheduled task (bản đã sửa) | `RELEASE-11` §6.2 | ô #12 · phần còn lại **KI-050** | Owner (**Administrator**) | ⬜ |
| G8 | Ký UAT | `RELEASE-04` | ô #5 | Business owner | ⬜ |
| G9 | Cắt tag RC | `RELEASE-08` §2 | ô #2 | Owner | ✅ **`v1.0.0-rc.3` @ `30540ab0`** |
| G10 | Gửi thông báo go-live | `RELEASE-08` §7 | ô #14 | Owner | ⬜ |

> 🚫 **`v1.0.0-rc.1` VÀ `v1.0.0-rc.2` đều KHÔNG được dùng để rollback.** Mỗi lần deploy lại mà tag đã cắt
> trước đó thì tag thành mốc chết — đã xảy ra **hai lần liên tiếp**:
>
> - `rc.1` → `6f160b9a`: thiếu **#324** ⇒ quay về là đưa FE **về đúng bản lỗi màn Loại nghỉ** (mọi loại
>   nghỉ đã seed không lưu được).
> - `rc.2` → `a968fcfe`: thiếu **#325** ⇒ quay về là **4 màn quản trị LEAVE biến mất** khỏi UI, gồm màn
>   duy nhất bật `accrual_method` (`KI-058`).
>
> Tag không bao giờ move (`RELEASE-05` §6.2 quy tắc 4) nên đã cắt **`v1.0.0-rc.3` @ `30540ab0`** = bản
> PROD đang chạy, xác minh bằng `release-smoke.mjs --expect-commit 30540ab0` (`RC-BUILD-MATCH` ✓).
> **Mốc rollback đúng = `v1.0.0-rc.3`.**
>
> ⚠️ **Gốc của cả hai lần lệch giống nhau: `m prod-update` build từ CÂY ĐANG CHECKOUT.** Lần 2 còn đang
> đứng trên nhánh feature ⇒ PROD mang một commit **chỉ có trên nhánh**, xoá nhánh là sha mồ côi. Định
> danh vẫn sạch (không `-dirty`) nên **không có tín hiệu cảnh báo nào**.
> **Luật: `git checkout master && git pull` TRƯỚC `m prod-update`, `--expect-commit` SAU, rồi mới tag.**
>
> ℹ️ `package.json` vẫn giữ chuỗi `1.0.0-rc.1` ⇒ `GET /health` trả `data.build.version = 1.0.0-rc.1`
> kể cả ở rc.2. Định danh có thẩm quyền là **`data.build.commit`** — cũng là thứ `--expect-commit` đối
> chiếu. Cả 6 release artifact đang lưu đều mang cùng chuỗi version ở các commit khác nhau.
>
> **Bằng chứng G4 · G5 · G6 + nghiệm thu:** `docs/_review/S6-GOLIVE-G4-G6-EVIDENCE-2026-08-02.md`.
>
> **Ba đính chính bảng này (đo 2026-08-02, đừng đọc bản cũ):**
>
> 1. **Ô #8 sai** — PROD KHÔNG tồn đọng `0535`; đang ở head **`0537`, 205/205**.
> 2. **G4 đã xong từ trước** nhưng `m prod-status` báo ngược, vì `Show-ReleaseStatus` đọc `ImagePath`
>    (với NSSM luôn là `nssm.exe`, không bao giờ khớp `releases`) thay vì subkey `Parameters\AppParameters`.
>    Đây là **tín hiệu NO-GO GIẢ** đã tính vào phán quyết 2026-07-31. Vá ở PR #324.
> 3. **`RC-004` (migration trên staging) không áp dụng được** — PROD đã ở head nên không còn migration
>    nào đang chờ để diễn tập. G6 vì thế chỉ đóng `RC-003`.
>
> ✅ **Chặn go-live về phép ĐÃ GỠ (2026-08-02 07:10Z).** Owner bật
> `DEFAULT_ANNUAL.accrual_method = Monthly` qua `/leave/policies` (vào được sau khi `KI-058`/PR #325 lên
> PROD); job `LEAVE_ACCRUAL` cấp **245 ngày cho 41 NV**, `failed=0`. Ba nguồn khớp tuyệt đối:
> job `grantedDays=245` = `leave_balances` 41 dòng/**245.0** = sổ cái `ACCRUAL` 245 dòng/**245.00** —
> **đúng bằng số nghiệm thu đo trước trên staging**. Không được cấp: `1111`/`1119`/`1129` (nghỉ trước
> 2026) + `1136` (`MISSING_START_DATE`, bỏ qua **kèm báo cáo**). Chi tiết: §6b của file bằng chứng.
> **Còn lại cho HR:** điền `start_date` cho `1136` — engine tự bù ở nhịp sau.

**Sau G1…G10:** 15/15 ô §2 ĐẠT hoặc chấp nhận-có-chữ-ký ⇒ phán quyết chuyển **GO**.

**Nếu owner muốn go-live sớm hơn:** con đường ngắn nhất hợp lệ là **CONDITIONAL GO** sau `G1→G4` +
`G7`, chấp nhận rủi ro `RC-003`/`RC-004` bằng chữ ký (§7.2) — chấp nhận rằng chưa từng có lần diễn tập
deploy nào ngoài PROD. `RELEASE-05` §5.3 cho phép, nhưng **phải ký**, không mặc định.

> ⚠️ **RPO (ô #10) không nằm trong G1…G10.** Đưa RPO từ 24 giờ về ≤ 15 phút cần WAL archiving/PITR —
> việc hạ tầng, không làm kịp trong cửa sổ go-live. Đề xuất: go-live với RPO 24 giờ **có chữ ký chấp
> nhận rủi ro**, và xếp PITR vào post-go-live (`RELEASE-14` — `PGL-002`, ưu tiên cao nhất).

---

## 7. Phán quyết (IMPL-09 §19.4)

### 7.1 Bảng quyết định

| Quyết định | Điều kiện | Áp cho hôm nay? |
| --- | --- | --- |
| **GO** | Mọi release gate bắt buộc đạt; rủi ro còn lại được chấp nhận | ❌ — 5 ô CHƯA ĐẠT (#2 · #5 · #8 · #10 · #14) |
| **CONDITIONAL GO** | Có `S2`/known issue nhưng **có workaround** và stakeholder chấp nhận | ⚠️ khả thi sau `G1→G4` + `G7` **kèm chữ ký** §7.2 |
| **NO-GO** | Có `S0`/`S1`, security/data blocker, **migration/rollback chưa sẵn sàng**, **UAT chưa sign-off** | ✅ **ĐANG ÁP** — migration staging chưa pass + UAT chưa ký |

### 7.2 Rủi ro phải ký nếu chọn CONDITIONAL GO

| Mã | Rủi ro chấp nhận | Hệ quả nếu xảy ra | Ký |
| --- | --- | --- | --- |
| AR-1 | Chưa từng diễn tập deploy ngoài PROD (`RC-003`/`RC-004`) | Sự cố deploy phát hiện lần đầu **trên PROD**, trong giờ làm việc | |
| AR-2 | **RPO 24 giờ** thay vì ≤ 15 phút (không PITR/offsite) | Hỏng DB ⇒ mất tới **1 ngày** dữ liệu chấm công/đơn nghỉ/công việc | |
| AR-3 | Backup chỉ nằm **local, chưa mã hoá** (`KI-050` phần còn lại) | Máy hỏng ⇒ mất cả bản gốc lẫn bản backup; đĩa lộ ⇒ lộ PII 45 nhân viên | |
| AR-4 | `D3` — widget headcount count-only xuyên phòng ban (`KI-012`) | Rò suy luận quy mô phòng ban khác cho HR scope Department | |

> Không ô nào ở §7.2 và §8 được điền sẵn thay người ký (`RELEASE-04` §1). Phiên tự động chỉ điền **bằng
> chứng** và **khuyến nghị**.

---

## 8. Ma trận sign-off (IMPL-09 §19.3)

| Vai trò | Trách nhiệm sign-off | Khuyến nghị từ bằng chứng | Người | Ngày | Quyết định |
| --- | --- | --- | --- | --- | --- |
| Product Owner | Scope · business acceptance · known issues | Scope freeze ✅; `S0`/`S1` = 0; cần chấp nhận 4 `S2` | | | |
| QA Lead | Test result · regression · UAT evidence | Lane DB ✅ 9/9; **staging ❌** ⇒ chưa đủ căn cứ ký | | | |
| Tech Lead | Technical readiness · architecture · risk | 3 bất biến còn nguyên (`db-readiness` 0 vi phạm); cutover chưa chạy | | | |
| Backend Lead | API · DB · migration · performance · security | Migration tồn đọng **1** trên PROD; perf ✅; `KI-056` cần vá | | | |
| Frontend Lead | UI · route · state · responsive · FE release | 3 SPA deploy qua Pages ✅; smoke SPA 200 ✅ | | | |
| DevOps Lead | Deployment · environment · monitoring · rollback | Rollback ✅ diễn tập; **alert chưa lên lịch**; backup ✅ có bản đầu tiên | | | |
| Compliance/DPO | Bảo vệ dữ liệu cá nhân · RPO/RTO · DR (NĐ 13/2023) | **RTO ✅ · RPO ❌ (24h vs ≤15ph)**; dump chưa mã hoá ⇒ cần AR-2 + AR-3 | | | |
| Business Stakeholder | UAT / business approval | `RELEASE-04` **chưa ký** | | | |
| Support Owner | Support handoff · user guide · incident path | Quy trình ✅ + guide ✅ (`RELEASE-11/12/13`) ⇒ **đủ căn cứ ký** | | | |

---

## 9. Sau khi go-live

- **Hypercare** T+0 → T+7 + điều kiện thoát: `RELEASE-09` §6.3.
- **Backlog sau go-live**: `RELEASE-14` (Phase 2 → `IMPLEMENTATION-10`).
- **Báo cáo post-go-live**: viết vào cuối hypercare, đính kèm biên bản này đã ký.

---

## 10. Lịch sử phán quyết

| Ngày | Build | Phán quyết | Ai | Ghi chú |
| --- | --- | --- | --- | --- |
| 2026-07-31 | `a17ff684` | **NO-GO** | `S6-GOLIVE-1` (máy) | 5 ô CHƯA ĐẠT; điều kiện lật ở §6. Phán quyết máy — **chưa có chữ ký người** |
| | | | | |
