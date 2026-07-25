# S5-DEVOPS-DEPLOYMIG-1 — `m prod-update` migrate TRƯỚC restart + `m prod-status` báo migration tồn đọng

> Zone **🟡 yellow** · layer OPS · paths `mediaos.ps1` · `scripts/windows/**` · doc này.
> Không chạm `apps/api/**`, không migration mới, không đổi schema.

---

## 1. Sự cố gốc (đo thật 2026-07-24, KHÔNG phải giả định)

- Job `SYSTEM_JOB_RUNS_RETENTION` **Failed mỗi nhịp** suốt ngày; `logs/api.err.log` phình **149 MB**.
- Gốc: `dist` BE đã deploy nhưng migration **0511** (tạo `purge_system_job_runs`) **CHƯA áp** lên DB PROD
  (`pg_proc = 0`). Đo lúc phát hiện: **190/196** migration đã áp — **tồn đọng 6**
  (0510 · 0511 · 0525 · 0526 · 0527 · 0528).
- Nguyên nhân hệ thống: `mediaos.ps1 Invoke-ProdUpdate` = _build contracts → build api → restart service_.
  **KHÔNG có bước migrate** ⇒ mỗi lần deploy BE, schema có thể tụt lại sau code, và lỗi chỉ lộ ra ở
  **runtime**, trong một **job chạy nền**, dưới dạng **log rác** — không ai thấy lúc deploy.
- Cùng họ với landmine đã ghi `prod-restart-does-not-rebuild-dist` (restart KHÔNG build).
  WO này thêm vế thứ hai: **build KHÔNG migrate**.

## 2. Hai sự thật kỹ thuật đã xác minh trong code (nền của thiết kế)

**(a) `pnpm db:migrate` KHÔNG tự đọc `.env` nào cả.**
`apps/api/src/db/migrate.ts:5` import `loadEnv` từ `config/env.schema` — **không** import `config/load-env`
(file duy nhất nạp `.env` vào `process.env`; chỉ `main.ts` và `gen-openapi.ts` import nó). Vì vậy migrate
chỉ đọc `process.env` sẵn có. Chạy `pnpm db:migrate` từ shell sạch ⇒ chết
`DATABASE_DIRECT_URL is required` — đúng triệu chứng đã đo. Các lệnh đang chạy được
(`m dev-online-migrate`, `m dev-online-db`) là do gọi `Import-DevOnlineEnv` trước, còn `m migrate` thì
**không** ⇒ `m migrate` cũng hỏng từ shell sạch (cùng một lỗi, cùng một bản vá).

**(b) Quy tắc "tồn đọng" phải theo ĐÚNG cách drizzle quyết định.**
`drizzle-orm@0.45.2` `pg-core/dialect.cjs` `migrate()`:

```js
select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
...
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { áp }
```

⇒ **tồn đọng = các entry `_journal.json` có `when` > `max(created_at)` trong `drizzle.__drizzle_migrations`**
(`folderMillis` = `when` của journal). Đếm hiệu số row (như mô tả trong Work Order) chỉ là **phép chéo**:
dùng nó để phát hiện **lệch** (DB có số row không khớp số entry đã áp = DB từng migrate ở nhánh khác),
KHÔNG dùng làm nguồn chính.

## 3. Thiết kế

### 3.1 `scripts/windows/migration-status.mjs` (mới) — đo trạng thái, KHÔNG ghi gì

Node thuần + `pg` (đã có ở devDependencies gốc). Chỉ chạy **1 câu SELECT**, không DDL, không DML.

- Input: `DATABASE_DIRECT_URL` từ `process.env` (PowerShell nạp .env gốc rồi truyền qua env kế thừa).
- Đọc `apps/api/migrations/meta/_journal.json` + các file `.sql` **thuộc lô tồn đọng**.
- Output `--json`: một dòng JSON **ASCII thuần** (mọi ký tự ≥ U+0080 escape `\uXXXX`) — chống mojibake khi
  Windows PowerShell 5.1 decode stdout của native command theo codepage OEM.
- Exit code: `0` = đo được (kể cả có tồn đọng) · `2` = **KHÔNG** đo được (thiếu env / DB lỗi / journal hỏng)
  ⇒ người gọi fail-closed. `--self-test` = kiểm hàm thuần, không cần DB (`0` pass / `1` fail).

**Phân loại câu lệnh trong lô tồn đọng** (nền của cảnh báo expand-contract):

| Bucket | Câu lệnh | Hành vi |
| --- | --- | --- |
| `contract` | `REVOKE` · `DROP TABLE/COLUMN/CONSTRAINT/SCHEMA/TYPE/SEQUENCE/VIEW/MATERIALIZED VIEW/DATABASE` · `DROP POLICY/INDEX/TRIGGER/FUNCTION` **không** `IF EXISTS` | **HỎI người** trước khi áp |
| `routine` | `DROP POLICY/INDEX/TRIGGER/FUNCTION **IF EXISTS**` | chỉ in thông tin, KHÔNG hỏi |

Vì sao tách 2 bucket: `DROP … IF EXISTS` + `CREATE …` là **thành ngữ idempotent** dùng khắp repo
(`DROP POLICY IF EXISTS` 38 lần · `DROP INDEX IF EXISTS` 22 · `DROP TRIGGER IF EXISTS` 15). Gộp chúng vào
diện "phải xác nhận" ⇒ deploy nào cũng hỏi ⇒ người gõ `MIGRATE` theo phản xạ ⇒ cảnh báo **mất giá trị**
đúng lúc cần nhất. `DROP COLUMN` giữ nguyên diện contract kể cả có `IF EXISTS` (mất dữ liệu thật).

**Quét theo dòng, BỎ QUA comment và chuỗi nháy đơn.** Bắt buộc, vì migration của repo này viết prose
tiếng Việt lẫn `REVOKE`/`DROP` trong comment **và trong `RAISE EXCEPTION '…'`** — ví dụ thật, mig 0510:

```sql
--   #2 REVOKE DELETE tường minh → app-role DELETE org_units/projects PHẢI FAIL …
    RAISE EXCEPTION '[0510] mediaos_app VẪN còn DELETE trên org_units sau REVOKE — BẤT BIẾN #2 vỡ.';
```

Cả hai dòng đều **không phải** câu lệnh contract. Quét thô `grep REVOKE` ⇒ báo động giả + kéo ký tự
tiếng Việt vào JSON. Đánh đổi đã biết: DDL động (`EXECUTE 'DROP …'`) thành **âm tính giả** — chấp nhận,
vì trong repo này khối `DO $$` là **assertion**, DDL thật nằm ở top-level.

### 3.2 `mediaos.ps1`

| Hàm | Thay đổi |
| --- | --- |
| `Import-MigrateEnv` (mới) | Nạp `.env` **gốc repo** vào session ⇒ tiến trình con `pnpm/node` kế thừa `DATABASE_DIRECT_URL` (vá sự thật 2a). Thiếu file/thiếu key ⇒ `$false`. |
| `Get-MaskedUrl` (mới) | Che mật khẩu URL. Thay `Get-MigrateTarget` (đọc file, chỉ 1 nơi gọi) — giờ đọc **giá trị đã resolve**, đúng cái sẽ dùng. |
| `Get-MigrationStatus` (mới) | Gọi script §3.1 `--json`, trả object hoặc `$null`. |
| `Invoke-ProdMigrateStep` (mới) | env → in DB đích → đo → **hỏi nếu có contract** → `pnpm db:migrate` → **đo lại, ép tồn đọng = 0**. Trả `$true/$false`. |
| `Invoke-ProdUpdate` | Chèn `Invoke-ProdMigrateStep` **giữa** `build api` và `Restart-OneProdService`; `$false` ⇒ in lỗi + **`exit 1`**, KHÔNG restart (và KHÔNG chạy tiếp nhánh LMS). |
| `Invoke-ProdStatus` | Thêm khối "migration": `x/y đã áp` — 0 tồn đọng ⇒ xanh; > 0 ⇒ **vàng** + tag đầu tiên chưa áp + số contract. Không bao giờ throw (đây là lệnh xem trạng thái). |
| `Invoke-Migrate` | Dùng `Import-MigrateEnv` ⇒ `m migrate` hết chết từ shell sạch (cùng bug 2a). |
| `Show-Help` | Ghi rõ prod-update giờ có migrate fail-closed. |

**Thứ tự trong `$doApi`** — `build contracts → build api → MIGRATE → restart`. Build trước migrate: build đỏ
thì **chưa hề đụng DB**. Migrate trước restart: dist mới luôn gặp schema **≥** nó cần.

**Fail-closed nghĩa là gì ở đây:** mọi ngã KHÔNG chắc chắn đều dừng — thiếu `.env`, thiếu
`DATABASE_DIRECT_URL`, script đo lỗi, DB không kết nối được, người huỷ ở prompt contract, `db:migrate`
exit ≠ 0, hoặc **migrate xong mà vẫn còn tồn đọng** ⇒ `exit 1`, service **giữ nguyên bản đang chạy**.
Vì trạng thái xấu nhất KHÔNG phải "service cũ chạy tiếp" mà là "service mới chạy trên schema cũ" —
đúng sự cố §1.

**Bỏ qua prompt khi không tương tác:** `MEDIAOS_MIGRATE_YES=1` ⇒ vẫn IN cảnh báo, không hỏi.

### 3.3 Expand-contract — WO này KHÔNG tự động hoá vế contract

Theo memory `migration-expand-contract-required`: migration EXPAND (thêm bảng/cột/hàm) chạy trước restart
là **an toàn**. Migration CONTRACT (`REVOKE`/`DROP`) chỉ an toàn khi dist **đang chạy** đã hết dùng đối tượng
bị gỡ — máy không biết điều đó. Nên WO này **chỉ phát hiện + hỏi người**, không tự quyết.

## 4. Ngoài phạm vi (cố ý)

- Không tự động migrate trong `m prod-restart` (đúng nghĩa: chỉ restart, KHÔNG build, KHÔNG migrate).
- Không migrate cho `prod-update lms` (LMS = workspace riêng, SQLite — không dùng migration của repo này).
- Không tự chạy contract migration; không rollback tự động (drizzle forward-only).
- Không đổi `apps/api/src/db/migrate.ts` — sửa runner là vùng chạm DB của mọi lane khác; wrapper OPS đủ
  giải quyết sự cố và giữ blast radius trong `mediaos.ps1` + `scripts/windows/`.

## 5. Kiểm chứng — ĐÃ CHẠY (2026-07-25)

DB ghi-thật đều dùng **DB ephemeral `mediaos_migstatus_probe`** (tạo → dùng → DROP), KHÔNG chạm
`mediaos` (PROD) hay `mediaos_dev`. Với `mediaos`/`mediaos_dev` chỉ chạy **SELECT**.

| # | Việc | Kết quả |
| --- | --- | --- |
| 1 | `node scripts/windows/migration-status.mjs --self-test` | ✅ PASS (11 nhóm assert) |
| 2 | Quét cả 196 migration thật | ✅ 47 contract / 91 routine trên 34 file. 0510 chỉ báo **L39** (câu `REVOKE` thật) — bỏ đúng phần prose + `RAISE EXCEPTION '… sau REVOKE …'` |
| 3 | Status trên `mediaos` (PROD) và `mediaos_dev` | ✅ cả hai `196/196 … schema o head`, `skew = null` |
| 4 | **Dựng lại đúng sự cố**: probe DB gắn 190 row `created_at` = `when` của 190 entry đầu | ✅ `190/196 · TON DONG 6 · dau tien 0510 · CONTRACT 2` (đúng 2 REVOKE của 0510+0511) + 3 routine |
| 5 | `Get-MigrationStatus` trong PowerShell 5.1 | ✅ JSON ASCII round-trip nguyên vẹn qua `ConvertFrom-Json` |
| 6 | `Import-MigrateEnv` từ session KHÔNG có biến env | ✅ `True`, resolve `…/mediaos` từ `.env` gốc → **hết lỗi `DATABASE_DIRECT_URL is required`** |
| 7 | DB không kết nối được (cổng 59999) | ✅ `$false` → prod-update DỪNG, không restart |
| 8 | Lô có CONTRACT, không xác nhận | ✅ `$false` (host không tương tác → báo rõ + gợi ý `MEDIAOS_MIGRATE_YES=1`) |
| 9 | **`pnpm db:migrate` ĐỎ thật** (probe DB thiếu bảng nền) | ✅ trả về **`Boolean $false`** (không phải `Object[]`) → DỪNG. Đây là bằng chứng cho bẫy `Out-Host` ở §3.2 |
| 10 | Green path: probe DB RỖNG → áp 196 → đo lại | ✅ `196/196 … schema o head` → `$true` (Boolean) |
| 11 | Chạy lại khi đã ở head | ✅ `schema da o head (196/196) - bo qua migrate` → `$true` |
| 12 | `m prod-status` thật trên máy PROD | ✅ in khối migration `196/196 … o head`; các phần khác giữ nguyên |

**Chưa chạy (cố ý):** `m prod-update api` đầu-cuối — bước cuối của nó là **restart service PROD**, phải do
owner chủ động lúc deploy. Mọi mắt xích TRƯỚC restart đã được chứng minh riêng ở #6–#11.

### 5.1 Phát hiện ngoài dự kiến: `m.cmd` chết ở codepage 65001

Lúc chạy #12 qua đúng lối vào tài liệu hoá (`m prod-status`), wrapper `m.cmd` báo
`'ediaos.ps1.' is not recognized`. Nguyên nhân: 2 dòng `REM` **tiếng Việt có dấu** — cmd.exe ở codepage
65001 parse sai **dòng KẾ TIẾP**, ăn mất ký tự đầu của `%~dp0mediaos.ps1`. Đã kiểm chứng bằng bản sao
ASCII: cùng codepage, chạy tốt. Đây là lỗi **có sẵn** (không do WO này), nhưng nó chặn đúng 2 lệnh trong
`done_when` ⇒ vá `m.cmd` về ASCII và bổ sung `m.cmd` vào `paths` của WO. Khớp luật đã ghi
(memory `powershell-utf8-bom-required`): `.ps1` cần UTF-8 **có BOM**, `.cmd`/`.bat` thì **NGƯỢC LẠI —
ASCII không dấu**.
