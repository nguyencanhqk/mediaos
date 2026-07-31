# S6-GOLIVE-1 — Final Sign-off · Go/No-go · Handoff (WS10)

> Work Order: `S6-GOLIVE-1` · zone 🔴 **crown release** · gate **FULL**
> Nguồn: `IMPLEMENTATION-09` §19 (WS10) · `IMP09-IN-015/016/017` · `IMP02-STORY-111/112`
> Luật ràng buộc: **`RELEASE-05`** (scope freeze · severity `S0..S4` · ngưỡng chặn RC §5.3 · tag §6.2)
> Tiền đề: `S6-REL-1` đã giao `RELEASE-07` (RC checklist) · `RELEASE-08` (runbook) · `RELEASE-09` (monitoring/support).
>
> Nguyên tắc của plan này: **quyết định Go/No-go là kết luận của số đo, không phải của mong muốn.**
> Ô nào chưa đo được thì ghi CHƯA ĐO ĐƯỢC. WO này **không tự ký** — nó dựng biên bản để người ký.

---

## 1. Nền đã đo (2026-07-31, đo lại từ máy PROD-host, KHÔNG chép từ `RELEASE-07`)

| Mục | Số đo | Cách đo |
| --- | --- | --- |
| `origin/master` | `a17ff684` | `git rev-parse --short origin/master` |
| Migration head repo | idx 202 · `0535_s6secxtenantfk1_composite_tenant_fk` (**203** entry) | `migrations/meta/_journal.json` |
| `version` (root `package.json`) | `1.0.0-rc.1` | `node -e` |
| Tag release trong repo | **0** — 6 tag hiện có đều `archive/*`·`backup/*`·`tooling-*` (lịch sử) | `git tag -l` |
| CI trên `master` | **4/4 xanh** (`CI` · `API — CI` · `Apps — Frontend CI` · `Security`) | `gh run list --branch master` |
| PROD API `:3100` | **SỐNG** — `/health` 200, `build` = `1.0.0-rc.1` · `c4afe351-dirty` · head `0534` | `curl /api/v1/health` |
| PROD FE | `https://funtimemediacorp.com` → **200** | `curl -o /dev/null -w %{http_code}` |
| PROD LMS `:3400` / `train.` | **SỐNG** 200 | `m prod-status` |
| **PROD DB vs repo** | **202/203 đã áp — TỒN ĐỌNG 1**: `0535` chưa áp | `m prod-status` |
| **Cutover artifact** | ❌ **CHƯA** — service vẫn trỏ `apps\api\dist` (KI-016 mở ở máy này) | `m prod-status` |
| Staging/UAT `:3200` | ❌ **KHÔNG LẮNG NGHE** | `curl` |
| `ops-alert-check` | **WARN** — 6 ok · 1 warn (lệch migration) · **1 unknown** (tuổi backup) | `node scripts/ops-alert-check.mjs` |
| Thư mục `backups/` | ❌ **KHÔNG TỒN TẠI** | `ls backups/` |
| Phụ thuộc WO (`S6-REL-1`) | `done` (PR #311) | ledger overlay |

---

## 2. Phát hiện chặn — LỖ-1: `scripts/backup-db.sh` KHÔNG CHẠY ĐƯỢC trên chính máy PROD

Đây là phát hiện quan trọng nhất của WO này, và nó **làm hỏng một bước BẮT BUỘC của runbook**.

`RELEASE-08` §4 xếp backup DB là **T-0 bước 3** (trước khi migrate + restart), và `RELEASE-07` §8 O3 kê
`bash scripts/backup-db.sh` là việc phải làm để đóng `KI-050`. Chạy thử trên máy PROD-host:

```text
$ BACKUP_DIR=./backups bash scripts/backup-db.sh
[backup 2026-07-31T07:11:18Z] ERROR: pg_dump not found (cài postgresql-client)
EXIT=1
```

Gốc: `scripts/backup-db.sh:26` chặn cứng ở `command -v pg_dump`. Từ khi Postgres vào docker, host
Windows **không có** `pg_dump` trên PATH (`pg_dump` chỉ có TRONG container `mediaos-postgres`, bản 17.10).

Đúng **cùng một lỗ** mà `S6-PERF-DB-1` đã vá cho `scripts/backup-restore-drill.sh` (LỖ-1 của WO đó) và
`migrate-verify-ephemeral.sh` đã vá trước nữa bằng `MIGVERIFY_PSQL` — nhưng `backup-db.sh` **lỡ cả hai
đợt**. Hệ quả thật, không lý thuyết:

1. `KI-050` được ghi là "chưa từng chạy backup" với **workaround = chạy tay `bash scripts/backup-db.sh`**.
   Workaround đó **không chạy được**. Một known-issue có workaround hỏng = known-issue **không có** workaround.
2. Ở T-0 go-live, người trực chạy bước 3 sẽ nhận `EXIT=1`. Hoặc họ dừng go-live giữa chừng, hoặc —
   nguy hiểm hơn — họ **bỏ qua** bước backup rồi chạy tiếp bước 5 (`migrate` + `restart`). Migrate PROD
   **không có bản backup** là đúng kịch bản mất dữ liệu mà `RELEASE-08` §5 tồn tại để tránh.
3. `S6-PERF-DB-1` chứng minh **restore drill** chạy được — nhưng drill tự `pg_dump` tại chỗ. Nó KHÔNG
   chứng minh có **bản backup định kỳ**. Khôi phục được từ dump vừa tạo ≠ có dump để khôi phục khi máy hỏng.

**Lại đúng bài học của dự án: script tồn tại ≠ script chạy được** (`DEVOPS-13` §3.1). `RELEASE-01` §7.3
tick "Script backup ✅" — đúng là file tồn tại, nhưng chưa ai chạy nó bao giờ.

### 2.1 Vá (mở rộng `paths` của WO — có chủ đích)

`paths` gốc của WO là `docs/**`. Vá này ra ngoài đó nên **khai báo tường minh** (bài học
*WO paths lái gate + scheduler*): thêm `scripts/backup-db.sh` + test đi kèm.

Lý do không hoãn sang WO khác: WO này có nhiệm vụ **phán quyết go-live theo runbook**. Phán quyết
"GO" trên một runbook có bước bắt buộc gãy là phán quyết sai. Vá là 1 hàm, đã có khuôn **đã qua review**
ở `backup-restore-drill.sh` (`resolve_tool` + `_have_container`), rủi ro thấp hơn hẳn việc để nguyên.

**Ràng buộc của bản vá:**

- **R1 — không đổi một byte hành vi khi host CÓ `pg_dump`.** Fallback container chỉ kích hoạt khi PATH
  trượt. CI (ubuntu, có postgresql-client) phải đi đúng đường cũ.
- **R2 — `--file` là bẫy.** Khi `pg_dump` chạy qua `docker exec`, `--file="$BASE"` ghi vào filesystem
  **của container**, không phải `./backups` của host ⇒ script báo DONE mà host không có file nào. Phải
  đổi sang ghi qua **STDOUT** rồi redirect ở host (đúng cách drill đã làm — `backup-restore-drill.sh:157`).
- **R3 — không skip im lặng.** Không có `pg_dump` lẫn container ⇒ `fail`, exit ≠ 0. Backup không chạy
  được **không được** coi là đã backup.
- **R4 — giữ nguyên** mã hoá (§2), offsite (§3), retention GFS (§4). Không đụng BẤT BIẾN #3.
- **R5 — có test.** Test chạy trong `node --test` (step `tooling-tests` của `harness/check.sh`, có từ
  `S6-REL-1`) để lỗ này không mọc lại lần thứ ba.

### 2.2 Chạy thật sau khi vá (điều kiện đóng `KI-050`)

| # | Việc | Đóng ô nào |
| --- | --- | --- |
| B1 | `BACKUP_DIR=./backups bash scripts/backup-db.sh` trên DB PROD `mediaos` → có file dump thật | `KI-050` vế "chưa từng có bản backup" |
| B2 | `bash scripts/backup-restore-drill.sh` → `drill PASS` | bản dump **khôi phục được** |
| B3 | `node scripts/ops-alert-check.mjs` → ô "Tuổi bản backup" chuyển `unknown` → `ok` | tín hiệu giám sát có nguồn |
| B4 | Scheduled task 02:00 hằng ngày (`RELEASE-09` §4) | vế "định kỳ" — **cần Administrator ⇒ giao owner** |

> B4 không tự chạy được trong phiên (đăng ký scheduled task cần quyền Administrator; UAC-from-tool
> không dùng được trên máy này). Giao owner kèm lệnh sẵn. `KI-050` vì vậy **giảm** chứ chưa đóng hẳn.

---

## 3. WO này làm gì · KHÔNG làm gì

**LÀM:**

1. Vá `scripts/backup-db.sh` (§2) + test + chạy thật B1..B3.
2. **`RELEASE-10`** — biên bản Go/No-go: checklist 15 nhóm `IMPL-09` §19.2 **có bằng chứng từng ô**,
   ma trận sign-off §19.3 (**để trống chữ ký**), phán quyết §19.4 + điều kiện chuyển phán quyết.
3. **Bộ handoff** `IMP09-HANDOFF-001…010` — kiểm kê 6 tài liệu đã có, viết 4 tài liệu còn thiếu:
   - `RELEASE-11` Admin guide (HANDOFF-007)
   - `RELEASE-12` User guide (HANDOFF-008)
   - `RELEASE-13` Support FAQ (HANDOFF-009)
   - `RELEASE-14` Post-go-live backlog (HANDOFF-010)
4. Cập nhật `RELEASE-02` (`KI-050` + known-issue mới nếu có) · `docs/README.md` §8 index · backlog/ledger.

**KHÔNG LÀM (giao owner — chốt với owner 2026-07-31):**

- ❌ **KHÔNG chạy `m prod-cutover`** (cần Administrator).
- ❌ **KHÔNG chạy `m prod-update api`** — đó là deploy PROD thật (migrate `0535` + restart service đang
  phục vụ 45 nhân viên).
- ❌ **KHÔNG dựng staging `:3200`.** `m dev-online-fast` chạy `turbo build --filter=@mediaos/api --force`
  ⇒ **biên dịch lại `apps/api/dist`** — đúng thư mục service PROD đang chạy (cutover chưa xong). Đây là
  landmine đã hạ PROD ngày 2026-07-08 (login 500 do binary mới ngồi trên schema cũ). Với PROD đang tồn
  đọng `0535`, dựng staging lúc này tái tạo **chính xác** kịch bản đó. ⇒ `RC-003`/`RC-004` **giữ nguyên
  CHƯA ĐẠT**, ghi rõ thứ tự an toàn để mở khoá (§4).
- ❌ **KHÔNG tạo tag `v1.0.0-rc.1`** (`RELEASE-05` §6.2.1 — tag đặt trên `master` sau merge, owner bấm).
- ❌ **KHÔNG tự ký** bất kỳ ô sign-off nào (`RELEASE-04` §1).

---

## 4. Thứ tự AN TOÀN để mở khoá `RC-003`/`RC-004` (giao owner)

Thứ tự này **bắt buộc** — đảo là dẫm vào landmine dist dùng chung.

| # | Bước | Lệnh | Vì sao phải đúng thứ tự |
| --- | --- | --- | --- |
| 1 | Backup DB PROD | `BACKUP_DIR=./backups bash scripts/backup-db.sh` | Có đường lùi trước khi đụng schema (WO này đã chạy 1 bản — xem `RELEASE-10` §4) |
| 2 | Deploy PROD lên `0535` | `m prod-update api` | Đưa PROD **hết tồn đọng migration** trước khi có bất kỳ build nào khác ghi vào `dist` |
| 3 | **Cutover** | `m prod-cutover` (Administrator) | Cắt PROD khỏi `apps\api\dist` — sau bước này `dist` là của riêng dev-online, dựng staging vô hại |
| 4 | Dựng staging | `m dev-online-db` → `m dev-online-fast` | Giờ mới an toàn |
| 5 | Regression P0 + smoke staging | `node scripts/release-smoke.mjs --base http://localhost:3200/api/v1 --strict` | Đóng `RC-003` · `RC-004` |
| 6 | Tag RC | `RELEASE-08` §2 | Sau khi §2 của `RELEASE-07` sạch ô CHƯA ĐẠT |

> Bước 3 **có thể** làm trước bước 2 (cutover rồi mới update) — nhưng bước 2 phải xong TRƯỚC bước 4
> trong mọi trường hợp. Điều tuyệt đối cấm: chạy bước 4 khi cả 2 và 3 đều chưa xong.

---

## 5. Rủi ro của chính WO này

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| R-1 | Vá `backup-db.sh` làm hỏng đường CI (host CÓ `pg_dump`) | R1 + test khẳng định: có PATH ⇒ chọn binary trần, không đụng docker |
| R-2 | Fallback container ghi dump vào container, host rỗng, script vẫn báo DONE | R2 — bỏ `--file`, ghi STDOUT; test khẳng định lệnh dựng ra KHÔNG chứa `--file` |
| R-3 | Viết guide "cho đủ mặt" mô tả tính năng không tồn tại | Mọi màn/nút trong `RELEASE-11/12` phải truy được về route thật trong `apps/*/src/routes` hoặc `SPEC-*` |
| R-4 | Biên bản Go/No-go tự tick cho đẹp | Mỗi ô §19.2 phải kèm lệnh/số đo; ô không đo được ghi **CHƯA ĐO ĐƯỢC** |
| R-5 | Chạy backup trên DB PROD gây tải/khoá | `pg_dump` là **read-only**, không khoá ghi (MVCC snapshot); chạy ngoài giờ cao điểm; đo thời gian |
| R-6 | Dump chứa PII 45 nhân viên nằm trần trong repo | `backups/` phải nằm trong `.gitignore` — **verify trước khi commit** |

---

## 6. Definition of Done

- [ ] `scripts/backup-db.sh` chạy được trên máy PROD-host (không có `pg_dump` trên PATH) — có log RED trước / GREEN sau
- [ ] Test `node --test` phủ R1 + R2 + R3, chạy trong `harness/check.sh` step `tooling-tests`
- [ ] B1..B3 chạy thật, có bằng chứng; `ops-alert-check` hết `unknown` ở ô backup
- [ ] `backups/` đã gitignore (R-6)
- [ ] `RELEASE-10` đủ 15 nhóm §19.2 + ma trận §19.3 (trống chữ ký) + phán quyết §19.4 có điều kiện chuyển
- [ ] `RELEASE-11/12/13/14` — đủ `HANDOFF-007…010`; bảng kiểm kê `HANDOFF-001…010` không ô nào "chưa có" mà không có chủ
- [ ] `RELEASE-02` cập nhật `KI-050` + KI mới; `docs/README.md` §8 trỏ tài liệu mới
- [ ] `bash harness/check.sh` xanh; **KHÔNG push thẳng `master`**; PR + người chốt
