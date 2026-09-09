# S18-SEC-AUDITGATE-1 — Gỡ đỏ cổng `Dependency scan (pnpm audit)` trên master

> Zone **yellow** (LIGHT gate về hình dạng diff) — nhưng **bán kính chạy là runtime API**, nên đích
> verify nặng hơn một WO lockfile thường. Xem §4.

## 1. Triệu chứng đo được

`gh run list --branch master --workflow "Security"` (đo 09/09/2026):

| Thời điểm | Commit | Kết luận |
| --- | --- | --- |
| 08/09 06:18Z | `669fd36d` S18-FE-DEPTQUERYKEY-1 | ✅ success |
| 08/09 06:36Z | `f5da18fb` docs(status) | ✅ success |
| 09/09 00:59Z | `138d71de` S18-AUTH-RESETFLOOR-1 | ❌ failure |
| 09/09 05:41Z | `ba2ca921` S18-QA-LEAVEDATEBOMB-1 | ❌ failure |
| 09/09 05:59Z | `2674a163` docs(status) | ❌ failure |

`138d71de` chỉ chạm `apps/api/src/auth/**` — KHÔNG đụng `package.json`/`pnpm-lock.yaml`. Hai run đỏ
sau đó cũng vậy. ⇒ advisory lên registry TRONG khoảng `08/09 06:36Z → 09/09 00:59Z`, **nợ có sẵn,
KHÔNG do PR nào sinh ra**.

Hệ quả thật: PR #490 và #492 đều mang một check đỏ ⇒ quay lại đúng trạng thái mà memory
`pnpm-audit-gate-was-red-on-master` cảnh báo — *"cổng đỏ mãi = cổng không ai đọc"*.

## 2. Loại trừ chế độ hỏng thứ hai TRƯỚC

Memory `pnpm-audit-gate-was-red-on-master` ghi hai chế độ hỏng trông **y hệt nhau** ở mức badge:
advisory thật vs timeout mạng. Bắt buộc đọc log trước:

```
gh run view 34328416043 --log-failed | grep -iE "advisor|GHSA|CVE|Timeout|error \("
```

Kết quả: **không có** `TimeoutError` / `error (23)`; **có** `GHSA-*` kèm bảng `Vulnerable versions`.
⇒ advisory THẬT. `gh run rerun --failed` sẽ vô ích, phải vá.

## 3. Năm advisory HIGH (`pnpm audit --audit-level=high --json`, 09/09)

| Gói | Dải lỗ hổng | Bản vá | GHSA | Đường | Runtime? |
| --- | --- | --- | --- | --- | --- |
| `js-yaml` | `>=4.0.0 <4.3.2` | `>=4.3.2` | `GHSA-2883-xcg3-v3hh` | 18 | ❌ dev (eslint) |
| `nodemailer` | `<9.1.0` | `>=9.1.0` | `GHSA-2x7j-588g-ccc2` | 1 | ✅ **runtime** |
| `multer` | `<2.3.0` | `>=2.3.0` | `GHSA-wc9g-mqfw-jrwm` | 12 | ✅ **runtime** |
| `multer` | `=2.2.0` | (không ghi) | `GHSA-qfvm-cv95-jqjf` | 12 | ✅ **runtime** |
| `multer` | `<2.3.0` | `>=2.3.0` | `GHSA-535w-7cp7-47q4` | 12 | ✅ **runtime** |

### 3.1 Điểm KHÁC các lượt vá trước

Mọi ghi chú `overrides` trước trong `pnpm-workspace.yaml` đều kết bằng *"KHÔNG vào runtime bundle của
API"*. **Lần này lý do đó KHÔNG dùng được cho 2/3 gói:**

- `nodemailer` là dependency **TRỰC TIẾP** của `apps/api` (`apps/api/package.json:46`) — dùng ở
  `settings/mail-transport.service.ts` và `user-invites/invite-mail.service.ts`.
- `multer` nằm trên **đường upload THẬT**: `apps/api > @nestjs/core > @nestjs/platform-express >
  multer`, hiện thực hoá ở `employees/employees.module.ts:94` (`MulterModule.register`, limit 5MB) và
  `employees/hr-import.controller.ts:39` (`FileInterceptor`).

⇒ done_when phải yêu cầu chứng minh đường chạy, không chỉ `pnpm build` xanh.

### 3.2 Vì sao bump direct dep KHÔNG đủ cho multer

`@nestjs/platform-express` khai `"multer": "2.1.1"` — **chuỗi chính xác, không phải range**. Bump
`apps/api/package.json` chỉ đổi nhánh direct; 12 đường transitive vẫn giữ 2.1.1/2.2.0. Đây đúng là lý
do override `multer@>=1.0.0 <2.2.0` đã tồn tại từ S0-CI-2.

### 3.3 Hình dạng lặp lại: "advisory sau phủ bản vừa ép lên"

`multer@>=1.0.0 <2.2.0: ^2.2.0` ép cây lên **đúng 2.2.0** — và `GHSA-qfvm-cv95-jqjf` cờ **chính xác
`=2.2.0`**. Cùng hình dạng đã gặp ở `fast-uri` (03/09), `js-yaml` (07/08), `brace-expansion` (25/07),
`browserslist` (02/09). Kết luận vận hành: override range-scoped là **vá tạm có hạn dùng**, không phải
trạng thái ổn định — mỗi lần nới phải ghi ngày + GHSA để lượt sau đọc được lịch sử.

## 4. Bản vá

### 4.1 `pnpm-workspace.yaml` — nới HAI dải override đã có (KHÔNG thêm dòng mới)

```diff
-  "multer@>=1.0.0 <2.2.0": "^2.2.0"
+  "multer@>=1.0.0 <2.3.0": "^2.3.0"

-  "js-yaml@>=4.0.0 <4.3.1": "^4.3.1"
+  "js-yaml@>=4.0.0 <4.3.2": "^4.3.2"
```

Nới **đúng phạm vi advisory** — không mở sang major khác. Bám phong cách chú thích của khối: mỗi dòng
kèm ngày · GHSA · số đường đo được · có/không vào runtime bundle.

### 4.2 `apps/api/package.json` — nâng SÀN cho hai dep runtime

```diff
-    "multer": "^2.2.0",
+    "multer": "^2.3.0",
-    "nodemailer": "^9.0.1",
+    "nodemailer": "^9.1.1",
```

**Lệch có chủ ý so với tiền lệ #335** (memory ghi *"không đổi một dòng package.json"*). Ở #335 lockfile
bump là **đủ**, nên không cần đụng manifest. Ở đây vẫn đủ về mặt kỹ thuật (`^9.0.1` luôn giải ra 9.x mới
nhất), nhưng hai gói này là **runtime**: ghi sàn vào manifest khiến yêu cầu bảo mật **tự mô tả** ngay tại
chỗ khai báo, và nếu ai đó gỡ override multer sau này thì nhánh direct vẫn không tụt về 2.1.1. Phòng thủ
theo tầng, giá bằng 2 dòng.

`nodemailer` KHÔNG cần override (`^9.0.1` đã bao 9.1.x). Cẩn thận **không** để `pnpm audit --fix` kéo lên
`10.x` (đã phát hành 04/09) — đó là major, ngoài phạm vi WO.

### 4.3 `minimumReleaseAgeExclude`

Thêm `js-yaml@4.3.2`, `multer@2.3.0`, `nodemailer@9.1.1` theo đúng convention khối đó. (Đo 09/09:
`pnpm config get minimum-release-age` = `undefined` ⇒ danh sách này hiện **trơ**, nhưng giữ đồng bộ để
lần bật lại không đỏ ngược vào chính bản vá.)

### 4.4 Tuổi bản vá — không vướng cổng supply-chain

`js-yaml@4.3.2` 26/08 · `multer@2.3.0` 28/08 · `nodemailer@9.1.1` 01/09 — đều ≥ 8 ngày tính tới 09/09.

## 5. Verify

| Đích | Lệnh | Kết quả |
| --- | --- | --- |
| Cổng chính | `pnpm audit --audit-level=high` | 19 → **10 vuln, 0 high** (2 low · 8 moderate, dưới ngưỡng) |
| Cây giải đúng | `pnpm why nodemailer -r` | `Found 1 version` = 9.1.1 |
| CI install | `pnpm install --frozen-lockfile` | ✅ (lockfile khớp manifest) |
| Toolchain | `pnpm typecheck` · `pnpm build` | ✅ 10/10 · 7/7 |
| **Đường email** | 4 spec `mail-transport` · `mail-config` · `reset-password-mail` · `hr-employee-import.service` | ✅ 28 tests |
| **Đường upload THẬT** | `hr-employee-import.int-spec.ts` trên `LANE_DB` | ✅ 9 tests |
| Cổng đầy đủ | `bash harness/check.sh --lane-db=s18auditgate` | §5.1 |

### 5.1 Vì sao int-spec upload là đích BẮT BUỘC, không phải tuỳ chọn

`hr-employee-import.int-spec.ts:118` gọi `req.attach("file", Buffer.from(...))` ⇒ supertest gửi
**multipart thật**, multer 2.3.0 parse thật. Nếu chỉ chạy `pnpm build`, ta chứng minh được *code biên
dịch được với types của multer*, KHÔNG chứng minh được *multer còn parse được request*. Memory
`pnpm-audit-gate-was-red-on-master` ghi đúng bẫy này cho lượt bump `socket.io-parser`: bản vá chạm lớp
mã hoá gói WS, build xanh không nói gì về việc gói còn giải mã được.

## 6. Nợ để lại

1. **`apps/lms` khai `nodemailer: ^8.0.7`** — NGOÀI dải vá `>=9.1.0`, tức dính đúng
   `GHSA-2x7j-588g-ccc2`. KHÔNG gộp vào WO này vì `apps/lms` bị loại khỏi workspace
   (`pnpm-workspace.yaml: !apps/lms`, lockfile riêng) nên **cổng `pnpm audit` của MediaOS không nhìn
   thấy nó** — vá ở đây sẽ không làm cổng đổi màu, và bump 8.x→9.x là major cần verify riêng đường mail
   của LMS. ⇒ WO riêng.
2. **Cổng chỉ soi workspace chính.** Hệ quả tổng quát của (1): `apps/lms` và `apps/fbpost` (npm,
   `package-lock.json`) đều nằm ngoài SCA. Đây là lỗ hổng **của cổng**, không phải của một gói — đáng
   một WO DEVOPS mở rộng `security.yml` sang hai lockfile đó.
3. **Advisory moderate/low còn lại (10)** cố ý không vá: dưới ngưỡng cổng. Giữ nguyên lý do đã ghi
   trong `pnpm-workspace.yaml` (esbuild 0.24.3 chưa từng phát hành ⇒ override làm gãy drizzle-kit).
4. **Không có ca test neo giới hạn upload.** 3 advisory multer đều là DoS (field name chế tác · rò FD
   khi huỷ upload · chỉ số mảng quá cỡ). Spec hiện có chứng minh *đường upload còn sống*, KHÔNG chứng
   minh *giới hạn còn chặn*. Ca cho `MAX_IMPORT_BYTES` + field name bất thường là ứng viên WO QA.
