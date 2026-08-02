# Bằng chứng cổng go-live G4 · G5 · G6 + nghiệm thu engine cộng dồn phép — 2026-08-02

> Nguồn cổng: `RELEASE-10` §6 (G1…G10). Phiên chạy G4→G6 + nghiệm thu số ngày phép.
> Mọi con số dưới đây đo TRỰC TIẾP trên máy PROD-host, không chép lại từ tài liệu.

---

## 0. Tóm tắt phán quyết

| Cổng | Nội dung | Kết quả |
| --- | --- | --- |
| **G4** | Cutover — tách PROD khỏi `dist` dùng chung (KI-016) | ✅ **ĐÃ XONG TỪ TRƯỚC** — và đã chứng minh bằng thực nghiệm |
| **G5** | Dựng staging | ✅ dựng trên **bản sao dữ liệu PROD thật**, không phải seed demo |
| **Nghiệm thu** | Số ngày backfill 2026 | ✅ **245 ngày / 41 NV** — khớp `S6-LEAVE-ACCRUAL-1` §1.1 F1 |
| **G6** | Regression P0 + smoke trên staging (`RC-003`) | ✅ **10 PASS · 0 FAIL · 0 SKIP** (`--strict`) |

> **`RC-004` (migration trên staging) KHÔNG áp dụng được ở đợt này** và cần nói rõ để không ai đọc
> nhầm là đã diễn tập: PROD đã ở head `0537` (205/205) từ trước, nên **không còn migration nào đang
> chờ để diễn tập**. Bản clone dùng cho staging vì thế cũng ở `0537`. Việc migration `0536`/`0537` áp
> sạch trên dữ liệu thật đã được chứng minh bởi chính PROD, không phải bởi staging.

---

## 1. G4 — cutover: đã xong, và chỉ báo đang NÓI DỐI

### 1.1 Trạng thái thật

```
nssm get MediaOS-API AppParameters      →  apps\api\releases\current\main.js
HKLM:\...\Services\MediaOS-API\Parameters\AppParameters
                                        →  apps\api\releases\current\main.js
```

Service NSSM (PID 8328) và tiến trình `node` con (PID 33380) cùng khởi động lúc `2026-08-02 01:34:51`
(giờ máy), tức tiến trình đang chạy được nạp bằng đúng tham số trên. `m prod-update` **không** ghi
`AppParameters` (đọc `mediaos.ps1` `Invoke-ProdUpdate`) ⇒ giá trị đó chỉ có thể do một lần
`m prod-cutover` thật đã chạy.

### 1.2 Vì sao `m prod-status` vẫn báo "CHƯA cutover"

`Show-ReleaseStatus` đọc `ImagePath` của service rồi thử `-match "releases"`. Với service NSSM,
`ImagePath` **luôn** là đường dẫn tới `nssm.exe`:

```
ImagePath = C:\Users\...\NSSM.NSSM_.../nssm-2.24-101-g897c7ad/win64/nssm.exe
```

Chuỗi này không bao giờ chứa `releases` ⇒ phép thử **không bao giờ đúng** ⇒ ô cutover báo
`KI-016 CHUA dong` **vĩnh viễn**. Đây là một **tín hiệu NO-GO GIẢ** đã tính vào phán quyết NO-GO
2026-07-31. Mục tiêu thật của service NSSM nằm ở subkey `Parameters\Application` +
`Parameters\AppParameters`.

**Đã vá** (PR #324): đọc subkey `Parameters`, giữ `ImagePath` làm đường lui kèm cảnh báo. Sau vá, cùng
máy in `[OK] service tro vao releases\current`.

### 1.3 Chứng minh bằng thực nghiệm (không chỉ đọc cấu hình)

Bước G5 chạy `m dev-online-fast`, trong đó có `turbo build --filter=@mediaos/api --force` ⇒ **biên dịch
lại `apps/api/dist`** — đúng thư mục mà trước cutover service PROD đọc thẳng. Đo ngay sau khi build:

| Đo | Giá trị |
| --- | --- |
| `apps/api/dist/build-info.json` | `43237f5b` · builtAt `2026-08-02T01:04:00Z` |
| `apps/api/releases/current/build-info.json` | `969f330c-dirty` · builtAt `2026-08-01T18:34:50Z` |
| `GET :3100/api/v1/health` → `data.build` | `969f330c-dirty` · builtAt `2026-08-01T18:34:50Z` |

`dist` đã đổi sang binary mới trong khi **PROD vẫn phục vụ bản cũ, không hề nhúc nhích**. Trước cutover,
chính chuỗi thao tác này là kịch bản tái tạo sự cố 2026-07-08 (binary mới trên schema cũ ⇒ login 500).
**KI-016 đóng được bằng bằng chứng hành vi, không chỉ bằng cấu hình.**

---

## 2. G5 — staging dựng trên dữ liệu PROD thật

Seed demo **không dùng được** cho nghiệm thu: số 245/295 là hàm của `start_date`/`end_date` của 45 hồ sơ
`funtime` thật; `mediaos_dev` seed demo chỉ có tenant `demo`.

Trình tự đã chạy:

1. **Backup PROD tươi** — `scripts/backup-db.sh` → `backups/mediaos-20260802-010032.dump` (4 202 526 byte).
   ⚠️ `BACKUP_GPG_RECIPIENT` chưa đặt ⇒ dump **KHÔNG mã hoá** (đã có trong `PGL-001`).
2. **Clone giữ nguyên quyền** — `backup-db.sh` dump bằng `--no-owner --no-privileges`, restore bản đó
   thì `mediaos_app` **mất sạch grant** ⇒ API 28P01/permission denied. Vì vậy clone cho staging dùng
   `pg_dump --format=custom` **có** owner + ACL.
3. `DROP DATABASE mediaos_dev WITH (FORCE)` → `CREATE` → `pg_restore --exit-on-error`.
   (Bản demo cũ đã dump lưu trước khi xoá.)

Xác minh bản clone:

| Đo | Giá trị |
| --- | --- |
| migration đã áp | **205** (head `0537`) |
| tenant | `funtime` |
| `employee_profiles` (chưa xoá) | **45** — 1 thiếu `start_date`, 11 có `end_date` |
| grant cho `mediaos_app` | **463** dòng `table_privileges` |
| bảng bật FORCE RLS | **155** |
| policy RLS | **172** |

Hai lệch cấu hình phải sửa để staging boot được (ghi lại vì sẽ gặp lại):

- **Mật khẩu DB**: role Postgres là **cụm-rộng**, `mediaos_app` chỉ có MỘT mật khẩu (đặt theo `.env`
  PROD). `.env.dev-online` giữ mật khẩu cũ ⇒ `FATAL 28P01`. Đã đồng bộ theo TÊN ROLE.
- **Slug tenant**: `PLATFORM_SUPERADMIN_COMPANY_SLUG` / `STAGING_SEED_COMPANY_SLUG` = `demo`, trong khi
  clone là `funtime` ⇒ `SuperAdminBootstrapService` sập lúc boot. Đã đổi sang `funtime`.

---

## 3. Nghiệm thu engine cộng dồn phép — **245 ngày**, KHÔNG phải 295

> Số nghiệm thu dùng để **chấm engine**. Chỉ gọi `GET /leave/admin/accrual/preview` + để job chạy thật;
> cố ý KHÔNG tự tính lại bằng SQL rồi so với chính mình.

**Chốt của owner 2026-08-02: số đúng là 245** (chặn thêm bằng `end_date`), đúng như
`docs/plans/S6-LEAVE-ACCRUAL-1.md` §1.1 F1 đã đính chính. Con số **295** trong Work Order và
`harness/handoff.md` là số **ngây thơ** (chỉ nhìn `start_date`) — **đã lỗi thời, đừng dùng để nghiệm thu.**

### 3.1 Công tắc đúng là công tắc

| Trạng thái `DEFAULT_ANNUAL.accrual_method` | `policies` | `totalDays` |
| --- | --- | --- |
| `None` (như PROD hiện nay) | `[]` | **0** |
| `Monthly` | 1 chính sách | **245** |

Xác nhận lời hứa của plan: **merge PR = 0 thay đổi dữ liệu**; engine chỉ chạy khi HR bật công tắc.

### 3.2 Preview (sau khi bật `Monthly` trên staging)

```
today             : 2026-08-02
employeesScanned  : 45
totalDays         : 245        <<< khớp §1.1 F1
employeesAffected : 41
pendingTotal      : 245 (truncated=false)
skippedTotal      : 1  → 1× MISSING_START_DATE (employee_code 1136)
```

Phân bố kỳ-cấp / nhân viên: `30 NV×7 · 2×5 · 3×4 · 3×3 · 1×2 · 2×1` = **245** (41 NV).

> So sánh: phân bố của số ngây thơ 295 là `40×7 · 2×5 · 1×4 · 1×1`. Khác nhau vì 295 cấp phép 2026 cho
> cả người đã rời công ty.

### 3.3 Cấp THẬT (job `LEAVE_ACCRUAL`, nhịp scheduler 15 phút)

```
status=Success  total_items=245  success_items=245  failed_items=0
metadata: {"granted":245,"grantedDays":245,"failed":0,"policies":1,
           "employeesScanned":45,"alreadyGranted":0,
           "skippedByReason":{"MISSING_START_DATE":1}}
```

Đối chiếu ba nguồn độc lập — **khớp tuyệt đối**:

| Nguồn | Số ngày | Số NV |
| --- | --- | --- |
| preview (engine dự báo) | 245 | 41 |
| `leave_balances` (`sum(total_days)`) | **245.0** | 41 |
| `leave_balance_transactions` (`sum(amount_days)`, toàn bộ `ACCRUAL`) | **245.00** | 41 |

### 3.4 Idempotent — đã chứng minh, không phải suy luận

Gọi lại preview NGAY SAU khi cấp:

```
totalDays: 0 · pendingTotal: 0 · alreadyGranted: 245
```

Chạy lại không cấp thêm một ngày nào. Đây là điều kiện bắt buộc trước khi bấm trên PROD, vì job chạy
mỗi 15 phút.

### 3.5 Ai KHÔNG được cấp — và vì sao đó là ĐÚNG

| Mã NV | Trạng thái | `start_date` | `end_date` | Kết quả |
| --- | --- | --- | --- | --- |
| 1111 | resigned | 2024-07-01 | 2025-10-11 | không có dòng balance |
| 1119 | resigned | 2025-02-05 | 2025-03-05 | không có dòng balance |
| 1129 | resigned | 2025-05-05 | 2025-05-24 | không có dòng balance |
| 1136 | active | *(trống)* | — | bỏ qua, báo `MISSING_START_DATE` |

45 quét = 41 được cấp + 3 nghỉ trước 2026 + 1 thiếu `start_date`. **Không ai rơi ra ngoài không lời
giải thích** — đúng yêu cầu "bỏ qua kèm báo cáo, không được bịa".

**Việc còn lại của HR:** điền `start_date` cho `1136`; engine tự bù ở nhịp sau (không cần thao tác gì thêm).

---

## 4. G6 — smoke `--strict` trên staging (RC-003)

```
node scripts/release-smoke.mjs --base http://localhost:3200/api/v1 --strict
→ 10 PASS · 0 FAIL · 0 SKIP
```

Chạy với 4 tài khoản UAT thật (`m seed-staging`, idempotent) nên **không ca nào SKIP ngầm** —
`--strict` coi SKIP là đỏ. Build định danh trong ca SMOKE-010: `1.0.0-rc.1 · 43237f5b · 0537`.

Phủ: health+request-id · mở SPA · login admin · login employee + my-apps (7 app theo quyền) ·
`/auth/me` · dashboard · danh sách nhân sự + phân trang · chấm công hôm nay · đếm thông báo chưa đọc ·
danh sách đơn nghỉ.

---

## 5. Đã đóng staging sau khi lấy xong bằng chứng

Bản clone mang **dữ liệu thật** (45 hồ sơ, PII, hash mật khẩu) và `cian-dev.*` trả HTTP 200 công khai;
nặng hơn, `.env.dev-online` đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=false` ⇒ staging là **đường vòng qua
2FA của PROD** với cùng bộ thông tin đăng nhập.

Đã chạy `m dev-online-stop` ⇒ `cian-dev.*` về **502**, `:3200` đóng. PROD không ảnh hưởng
(`api.funtimemediacorp.com` = 200).

> ⚠️ **DB `mediaos_dev` vẫn giữ bản sao dữ liệu thật.** Nó nằm cùng cụm Postgres localhost với PROD nên
> không mở thêm bề mặt tấn công nào, nhưng **dựng lại staging là lộ lại ngay**. Trước khi bật lại cho
> UAT (G8), cân nhắc bật 2FA trên staging hoặc chấp nhận rủi ro có thời hạn.
> Xoá hẳn: `docker exec mediaos-postgres psql -U mediaos -d postgres -c "DROP DATABASE mediaos_dev WITH (FORCE);"`

---

## 6. Phát hiện kèm theo — 2 lỗi ĐANG SỐNG trên PROD (PR #324)

1. **Màn Loại nghỉ vẫn là cửa một chiều ở một hướng khác.** `leave-type-form.ts` còn regex
   lowercase-only `^[a-z0-9_-]+$` trong khi mã canonical là UPPERCASE ⇒ **mọi loại nghỉ đã seed không
   lưu được bất kỳ thay đổi nào**, kèm báo lỗi sai ngữ cảnh "Vui lòng nhập mã". `packages/contracts` và
   `leave-policy-form.ts` đã chuyển sang `^[A-Za-z0-9_-]+$` từ #323 — file này là chỗ sót.
2. **Key i18n treo.** `masterData.common.validation.codeInvalid` được `leave-policy-form.ts` (đã ship ở
   #323) tham chiếu nhưng chưa từng tồn tại trong `master-data-i18n.ts` ⇒ màn Chính sách nghỉ hiện ra
   nguyên chuỗi khoá thay vì câu tiếng Việt.

RED-first: bỏ bản vá regex ⇒ ca mới đỏ đúng lý do (`updateTypeAdmin` gọi 0 lần). Có vá ⇒ 10/10.

---

## 6b. ĐÃ CHẠY THẬT TRÊN PROD (2026-08-02 07:10Z) — chặn go-live đã GỠ

Owner bật `DEFAULT_ANNUAL.accrual_method = Monthly` lúc `06:58:50Z` qua màn `/leave/policies` (vào được
sau khi `KI-058` / PR #325 lên PROD). Job `LEAVE_ACCRUAL` chạy ở nhịp kế:

```
status=Success  total_items=245  success_items=245  failed_items=0
metadata: {"granted":245,"grantedDays":245,"failed":0,"policies":1,
           "employeesScanned":45,"alreadyGranted":0,
           "skippedByReason":{"MISSING_START_DATE":1}}
```

**Khớp staging đến từng dòng:**

| Nguồn | PROD | Staging |
| --- | --- | --- |
| preview / job (`grantedDays`) | **245** | 245 |
| `leave_balances` | **41 dòng · 245.0** | 41 · 245.0 |
| `leave_balance_transactions` | **245 dòng · 245.00** | 245 · 245.00 |
| phân bố | `30×7 · 2×5 · 3×4 · 3×3 · 1×2 · 2×1` | y hệt |
| không được cấp | `1111`·`1119`·`1129` (nghỉ trước 2026) + `1136` (`MISSING_START_DATE`) | y hệt |

⚠️ **Ba lần chạy 06:15/06:30/06:45 trả `total=0` KHÔNG phải hỏng** — chúng chạy TRƯỚC khi công tắc được
bật (06:58:50Z). Và nhịp bị **reset theo lần khởi động API**: API restart lúc `06:55:54Z` nên nhịp đầu
sau đó rơi vào `07:10:54Z`, không phải `07:00`. Khi chờ job: tính nhịp từ **giờ boot**, đừng tính từ lần
chạy trước.

**Việc còn lại của HR:** điền `start_date` cho `1136` — engine tự bù ở nhịp sau, không cần thao tác gì thêm.

---

## 7. Chốt lại tình trạng PROD tại thời điểm viết

| Đo | Giá trị |
| --- | --- |
| bản đang chạy | `1.0.0-rc.1 · 969f330c-dirty` (builtAt 2026-08-01T18:34:50Z) |
| migration | **205/205**, head `0537_s6leavecarryover1_carry_forward` |
| service trỏ vào | `apps\api\releases\current\main.js` (đã cutover) |
| `DEFAULT_ANNUAL.accrual_method` | **`None`** — engine ĐANG NGỦ |
| `leave_balances` · `leave_balance_transactions` | **0** · **0** |
| `leave_types` có `deduct_balance=true` | chỉ `ANNUAL` (S-1 và C-2 đã áp) |

⚠️ Hệ quả nếu go-live mà không bật công tắc: `ANNUAL` còn `deduct_balance=true` mà số dư 0 ⇒
`reserveIfNeeded` trả **422 `BALANCE_NOT_ENOUGH`** cho **mọi** đơn nghỉ phép năm ngay ngày đầu.

> Ghi chú đính chính tài liệu: `RELEASE-10` ô #8 nói PROD tồn đọng `0535` — **sai**, PROD đang ở head
> `0537` (205/205). Đo lại bằng `m prod-status`.
