# S19-OPS-AUDITHIGH-1 — Gỡ đỏ cổng `Dependency scan (pnpm audit)`: 7 advisory HIGH

> Zone **red** — không vì hình dạng diff (deps + 1 spec), mà vì nâng **MAJOR** một dep runtime
> (`nodemailer` 9→10) nằm trên đường gửi **token kích hoạt tài khoản**, và bump `engine.io` chạm lớp
> transport WS của chat/call/noti. ⇒ plan-reviewer trước khi code · FULL gate TRƯỚC khi mở PR · owner merge.

## 1. Triệu chứng đo được

- CI của #557 (chạm 0 file deps) đỏ ở `Dependency scan`; #557 merge `--admin` (owner 30/09) vì nợ chung.
- `pnpm audit --audit-level high` trên master `2b4d2403` (đo 01/10): **23 vuln — 2 low · 14 moderate ·
  7 HIGH**. Backlog seed 30/09 ghi **6** — từ đó lên registry thêm `GHSA-prgh-xp8r-p3m5` (nodemailer).
- Không phải flake mạng (chế độ hỏng thứ hai của memory `pnpm-audit-gate-was-red-on-master`): tái hiện
  local, bảng có `GHSA-*` + `Vulnerable versions`.

## 2. Bảy advisory (`pnpm audit --json`, 01/10)

| Gói               | GHSA                                                             | Dải lỗ hổng                          | Cây có        | Đường   | Runtime?                                          |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------ | ------------- | ------- | ------------------------------------------------- |
| `brace-expansion` | `GHSA-qhr7-859c-m2p7` (đệ quy ngoặc lồng)                        | `>=2.0.0 <2.1.6` · `>=4.0.0 <5.0.11` | 2.1.4 · 5.0.9 | 49 + 10 | ❌ dev (`eslint`/`typescript-eslint > minimatch`) |
| `brace-expansion` | `GHSA-6j4f-fj2g-mc7p` (đệ quy `parseCommaParts`)                 | `>=2.0.0 <2.1.5` · `>=4.0.0 <5.0.10` | 2.1.4 · 5.0.9 | 49 + 10 | ❌ dev                                            |
| `engine.io`       | `GHSA-2gc4-cqfq-p2gv` (DoS lệch protocol revision)               | `>=6.6.0 <6.6.10`                    | 6.6.8         | 12      | ✅ **runtime** — server Socket.IO của API         |
| `nodemailer`      | `GHSA-v53p-9fqp-m79j` (addressparser backtracking bậc hai)       | `<=10.0.5`                           | 9.1.1         | 1       | ✅ **runtime** — dep TRỰC TIẾP                    |
| `nodemailer`      | `GHSA-prgh-xp8r-p3m5` (addressparser O(n²) địa chỉ ghép comment) | `>=9.1.0 <=10.0.4`                   | 9.1.1         | 1       | ✅ **runtime**                                    |

### 2.1 Đo: bản "đã vá" CÓ vá ở đúng entry mà `require()` nạp không

Bài học `patched-version-unpatched-main-entry` (1.1.16/2.1.2 ship bản vá ở `dist/` nhưng `main` vẫn
code cũ) ⇒ không tin số hiệu. PoC chạy trên **chính entry `main`/`require`** của tarball:

| Bản        | `{a,`×20000 + `b` + `}`×20000                     | `{` + `a,{`×20000 + `b` + `}`×20000 + `}` |
| ---------- | ------------------------------------------------- | ----------------------------------------- |
| 2.1.4      | ❌ `RangeError: Maximum call stack size exceeded` | ❌ `RangeError`                           |
| **2.1.7**  | ✅ trả về (1002 phần tử)                          | ✅                                        |
| 5.0.9      | ❌ `RangeError`                                   | ❌ `RangeError`                           |
| **5.0.12** | ✅ trả về (1002 phần tử)                          | ✅                                        |

⇒ 2.1.7 (`main: index.js`) và 5.0.12 (`exports.require → dist/commonjs`) vá thật ở đường minimatch đi.

### 2.2 Đường tới thật của `nodemailer` — khẳng định "đường AUTH (email reset)" của backlog SAI một nửa

`grep -rn nodemailer apps/api/src` ⇒ **đúng 2 call-site**:

| Call-site                                | Gọi                                          | Mang gì                                  |
| ---------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| `settings/mail-transport.service.ts:62`  | `createTransport` + `verify()` + `close()`   | mật khẩu SMTP plaintext (RAM)            |
| `user-invites/invite-mail.service.ts:86` | `createTransport` + `sendMail()` + `close()` | **token kích hoạt tài khoản** trong link |

`auth/reset-password-mail.service.ts` **KHÔNG** import nodemailer (vẫn là stub — dòng 46 ghi "khi tích hợp
SMTP thật … thay khối này bằng transporter.sendMail"). ⇒ email đặt lại mật khẩu KHÔNG nằm trên đường bump.
Vùng đỏ vẫn giữ vì đường **kích hoạt tài khoản** (token) + **secret SMTP** đi qua thư viện được nâng major.

## 3. Changelog breaking `nodemailer` 10.x (đọc từ tarball 10.0.12)

1. **10.0.0 BREAKING duy nhất được khai:** Node ≥ 20. Repo `engines.node >=20`, CI `node-version: 22` ⇒ ✅.
2. **10.0.0 viết lại sang TypeScript, build kép ESM + CJS**, `"type": "module"`, `exports` map, types
   bundle sẵn (`dist/cjs/nodemailer.d.ts`).
3. ⚠️ **10.0.11: "keep the CommonJS entry point … compatible with the pre-TypeScript build"** ⇒ **10.0.0
   →10.0.10 có entry CJS LỆCH** so với 9.x. `apps/api` build `module: commonjs` ⇒ chạy đúng entry CJS đó.
   ⇒ **sàn là `^10.0.12`, KHÔNG phải `>=10.0.6`** mà advisory cho phép.
4. 10.0.11 "restore the layout of @types/nodemailer in the bundled declarations" ⇒ types bundle thay
   `@types/nodemailer`. `apps/api/tsconfig.json` dùng `moduleResolution: node` (bỏ qua `exports`) ⇒ TS đi
   `main → dist/cjs/nodemailer.js` → `.d.ts` cùng chỗ ⇒ types bundle THẮNG `@types/*`. ⇒ **gỡ
   `@types/nodemailer` ^8** (mô tả API v8, giữ lại chỉ gây hiểu nhầm).
5. 10.0.12 thêm hành vi: "settle every send on a connection error · honour requireTLS · bare CR → CRLF".
   Hai service đều `try/catch` quanh `verify`/`sendMail` và `close()` ở `finally` ⇒ "settle" chỉ làm lỗi
   kết nối về nhánh `catch` chắc hơn — đúng hướng. Không service nào đặt `requireTLS`.

### 3.1 Bẫy hai-entry: vitest và PROD nạp HAI FILE KHÁC NHAU

`nest build` (CJS) ⇒ `require("nodemailer")` ⇒ `dist/cjs/nodemailer.js`. Vitest externalize
`node_modules` và nạp bằng `import` ⇒ `dist/esm/nodemailer.js`. **Xanh ở vitest KHÔNG chứng minh được
entry PROD**, và đó đúng là entry mà 10.0.0–10.0.10 làm lệch. ⇒ verify phải phủ CẢ HAI (§5).

### 3.2 Test hiện có KHÔNG đo gì về thư viện thật

`mail-transport.service.spec.ts` `vi.doMock("nodemailer", …)` toàn phần; `invite-mail.service` không có
spec unit; `mail-config-envelope.int-spec.ts` dựng `new MailTransportService()` nhưng không gọi `test()`
tới server SMTP nào. ⇒ **0 ca nào chạy nodemailer thật** — nâng major 9→10 hôm nay không có test nào đỏ
được dù thư viện vỡ. Đây là khoảng trống phải lấp TRƯỚC khi bump (RED-proof ở §4.5).

## 4. Bản vá

### 4.1 `pnpm-workspace.yaml` — NỚI 2 dải brace-expansion đã có (KHÔNG thêm dòng)

```diff
-  "brace-expansion@<2.1.3": "^2.1.3"
-  "brace-expansion@>=3.0.0 <5.0.8": "^5.0.8"
+  "brace-expansion@<2.1.6": "^2.1.6"
+  "brace-expansion@>=3.0.0 <5.0.11": "^5.0.11"
```

GIỮ per-major (minimatch@3/@9 gọi `require('brace-expansion')()` như HÀM — chỉ dòng 2.x giữ
`module.exports = expand`). Cập nhật `MIN_GUARDED` trong `scripts/check-brace-expansion-guard.mjs`?
**KHÔNG** — script đo guard độ dài của GHSA-mh99 (2.1.3/5.0.8 là sàn đúng cho advisory ĐÓ); hai GHSA mới
không bị ignore nên chính `pnpm audit` đã chặn theo phiên bản, và §2.1 đã đo entry thật.

**`auditConfig.ignoreGhsas: GHSA-mh99-v99m-4gvg` — rà lại:** đo bằng cách gỡ tạm ignore rồi audit. Nếu
dải advisory vẫn `<=5.0.7` (cờ 2.1.7) ⇒ còn cần, giữ nguyên + ghi ngày rà. Nếu thượng nguồn đã sửa dải ⇒ gỡ.

### 4.2 `engine.io` — bump LOCKFILE trong range, KHÔNG override (lệch `done_when` có chủ ý)

`done_when` ghi "override `>=6.6.0 <6.6.10` → `^6.6.10`" — nhưng **khối `overrides` hiện KHÔNG có dòng
engine.io nào để nới**, và `socket.io@4.8.3` khai `engine.io: ~6.6.0` ⇒ 6.6.10/6.6.11 **nằm trong range**.
Tiền lệ #335 (`socket.io-parser` 4.2.6→4.2.7, cùng vị trí): in-range ⇒ chỉ bump lockfile
(`pnpm update engine.io --recursive --depth Infinity`). Thêm một override mới trái bài học "override
range-scoped là vá tạm CÓ HẠN DÙNG, nới dải cũ — KHÔNG thêm dòng". Kết quả kỳ vọng: 6.6.11 (24/09).

### 4.3 `apps/api/package.json`

```diff
-    "nodemailer": "^9.1.1",
+    "nodemailer": "^10.0.12",
 …
-    "@types/nodemailer": "^8.0.1",
```

Không cần override cho nodemailer (1 đường, direct). Không đụng `apps/lms` (ngoài workspace — §6).

### 4.4 `minimumReleaseAgeExclude`

Không suy "trơ" từ `pnpm config get` (cách đo đó không lộ default dựng sẵn của pnpm 11 — plan-reviewer
F12). Chốt bằng **ngày phát hành thật** của bản được lockfile phân giải (§5 dòng "Cây giải đúng"): mọi
bản vá ≥ 3 ngày tuổi (brace-expansion 14/09 · engine.io 6.6.11 24/09 · nodemailer 10.0.12 28/09). Vẫn
thêm các bản THỰC SỰ được phân giải vào danh sách theo convention của khối.

### 4.5 Spec mới — nodemailer THẬT trên server SMTP giả trong tiến trình

- `apps/api/test/helpers/fake-smtp-server.ts` — server `node:net` trên `127.0.0.1:0` nói đủ SMTP (EHLO ·
  AUTH PLAIN/LOGIN · MAIL · RCPT · DATA · RSET · QUIT), ghi lại lệnh (đã che credential) + AUTH đã giải
  base64 + thân DATA. Tuỳ chọn: `rejectAuth` (535) · `advertiseAuth:false` · `rejectRcpt`/`rejectData`
  (550 kèm **echo** chuỗi do spec đưa vào). Theo dõi + `destroy()` mọi socket khi `close()` (F13 — memory
  `vitest-unhandled-rejection-after-teardown`). KHÔNG thêm devDependency (`smtp-server`).
- `apps/api/src/user-invites/invite-mail.smtp.spec.ts` (colocated — memory `vitest-unit-specs-must-be-colocated`).
- Fixture giống-secret (mật khẩu SMTP · token) **ghép chuỗi** (CLAUDE.md §5) — KHÔNG chép mẫu literal
  `PASSWORD = "sup3r-…"` của `mail-transport.service.spec.ts:11` (F4).

**F1 — AUTH phải là điều được đo, không phải giả định.** nodemailer chỉ `login` khi EHLO quảng bá `AUTH`
(`smtp-transport/index.js:330` bản 10 · `:277` bản 9) — server không quảng bá thì `verify()`/`sendMail()`
vẫn THÀNH CÔNG mà không đăng nhập. ⇒ server mặc định quảng bá `AUTH PLAIN LOGIN`, MỌI ca thành công
assert server đã nhận đúng một AUTH với đúng user/pass, và có một ca tự-kiểm server giả.

| Ca                                                                   | Đo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tự-kiểm server giả: `advertiseAuth:false`                            | `verify()` ok nhưng `auths` RỖNG ⇒ chứng minh assert AUTH ở các ca khác KHÔNG xanh-rỗng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `InviteMailService.sendActivationEmail` → `{sent:true}`              | AUTH đúng user + mật khẩu ĐÃ GIẢI MÃ · `MAIL FROM` = `fromEmail` · `RCPT TO` = `email` · Subject giải RFC 2047 khớp nguyên văn (UTF-8) · phần `text/plain` chứa link kích hoạt · phần `text/html` chứa `href` đã escape                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 535 ở AUTH                                                           | `{sent:false, reason:"send_failed"}`, KHÔNG ném, 0 thư                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **F3:** 550 ở RCPT / DATA, phản hồi server **echo token + username** | `{sent:false, reason:"send_failed"}` · log của service KHÔNG chứa token · link · mật khẩu · username                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MailTransportService.test` → OK                                     | `{ok:true}` · đúng một AUTH đúng user/pass · KHÔNG có `MAIL`/`RCPT`/`DATA` (verify chỉ bắt tay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MailTransportService.test` → 535                                    | `{ok:false, errorMessage:"Xác thực SMTP thất bại"}` · log không chứa mật khẩu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **F5 — Entry CJS chạy CODE SERVICE**                                 | `vi.resetModules()` (BẮT BUỘC — không có thì `import()` trả module đã cache gắn với nodemailer ESM ⇒ ca "CJS" chạy ESM, xanh-rỗng) → `vi.doMock("nodemailer", factory)` với factory `createRequire(import.meta.url)("nodemailer")` + `vi.spyOn(cjs, "createTransport")` → `import()` lại `InviteMailService` ⇒ gửi thành công tới server giả · spy được gọi đúng 1 lần · `require.resolve("nodemailer")` kết thúc bằng `dist/cjs/nodemailer.js` (10.x) / `lib/nodemailer.js` (9.x). tsc `__importStar` trả nguyên module vì `dist/cjs/nodemailer.js` có `__esModule:true` + named export (reviewer đã đối chiếu) ⇒ tương đương PROD. Mutant m5: bỏ `resetModules` ⇒ ĐỎ ở assert spy |

**RED-proof (memory `mutant-red-must-match-expected-message`):** chạy spec trên **9.1.1 TRƯỚC khi bump** ⇒
XANH ở mọi ca TRỪ ca F3 (đó là lỗi có sẵn — §4.6). Rồi cấy mutant, mỗi mutant phải ĐỎ đúng assert của nó:
(m1) bỏ `auth` ở `invite-mail.service.ts` · (m2) bỏ `auth` ở `mail-transport.service.ts` (F1c) · (m3) đổi
`to` · (m4) gỡ vá §4.6 ⇒ ca F3 đỏ vì token/username trong log. Hoàn tác bằng bản sao lưu `cp`, KHÔNG
`git checkout --` (memory `mutant-revert-git-checkout-wipes-uncommitted-fix`).

### 4.6 Vá log của `InviteMailService` (F3 — bất biến #3)

`invite-mail.service.ts:107-108` log NGUYÊN `err.message`, mà nodemailer nối phản hồi server vào message
(`smtp-connection/index.js:872` `err.message += ': ' + response`; nguồn: `Invalid login` · `Recipient
command failed` · `Message failed`). Một bộ lọc spam trả `550 … blocked URL https://…?token=…`, hoặc
server echo username khi 535 ⇒ token kích hoạt / credential vào log. Comment dòng 106 khai "KHÔNG kèm
credential/token" — sai từ trước, nhưng đây đúng là đường đỏ mà WO nâng major. Vá trong WO (nằm trong
`paths`):

- **KHÔNG log chữ của server nữa** — chỉ log `host` + `code` · `responseCode` · `command` của lỗi
  nodemailer (đủ chẩn đoán: `EAUTH/535/AUTH PLAIN`, `EENVELOPE/550/RCPT TO`, `EMESSAGE/550/DATA`…).
- Lượt 1 định redact bằng danh sách giá trị đã biết (`sanitizeSmtpError` + che `params.token`) — plan-reviewer
  lượt 2 bác: phản hồi server có thể echo thân thư ĐÃ MÃ HOÁ (QP ngắt dòng mềm `=\r\n` cắt token làm đôi ·
  phần text tiếng Việt có thể là base64 · blob base64 `\0user\0pass` của AUTH PLAIN) ⇒ danh sách giá trị
  luôn sót. Không log văn bản tự do = không có gì để sót.
- **Đã thi công (sau FULL gate):** `apps/api/src/settings/smtp-error-summary.ts` — `describeSmtpError` dùng
  chung cho CẢ HAI call-site (dòng log của `MailTransportService` cũng đổi — reviewer M3; `errorMessage`
  trả UI giữ `sanitizeSmtpError`). Mỗi trường khớp ĐÚNG HÌNH DẠNG của nó, lệch ⇒ `-`: `name` ·
  `code` `^E[A-Z0-9]{2,24}$` · `responseCode` số nguyên 200–599 · `command` `^[A-Z]{2,12}( [A-Z0-9-]{2,12})?$`
  · `errno` → tên libuv (`ECONNREFUSED`) · `syscall` `^[a-z]{2,16}$` · `tlsReason` (OpenSSL) `^[a-z0-9 ,_-]{1,64}$`.
  Ba trường cuối do silent-failure-hunter F1: nodemailer GHI ĐÈ `code` gốc thành `ESOCKET`, không có chúng
  thì cổng đóng / reset / lệch 465-587 / TLS hỏng đọc y hệt nhau. Lỗi lập trình (TypeError/RangeError/
  ReferenceError) ⇒ `logger.error` + stack (F2). Lỗi xác minh cert ("self-signed certificate") KHÔNG có
  trường máy-sinh nào ⇒ log ra `ESOCKET/CONN`; admin chẩn đoán qua "Kiểm tra kết nối" (trả lời văn đã sanitize).

## 5. Verify

| Đích                           | Lệnh                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cổng chính                     | `pnpm audit --audit-level high` ⇒ exit 0 (0 HIGH/CRITICAL)                                                                                                                                                                                                                |
| CI install                     | `pnpm install --frozen-lockfile`                                                                                                                                                                                                                                          |
| **Diff lockfile (F8)**         | `git diff pnpm-lock.yaml` chỉ được đổi brace-expansion · engine.io · nodemailer · gỡ `@types/nodemailer`; liệt kê gói khác nếu có                                                                                                                                         |
| Cây giải đúng (F8)             | `pnpm why <pkg> -r` ⇒ đúng **2.1.7 · 5.0.12 · 6.6.11 · 10.0.12** + ngày phát hành (`npm view <pkg> time`)                                                                                                                                                                 |
| Guard GHSA-mh99                | `node scripts/check-brace-expansion-guard.mjs` (CÙNG job `dependency-scan`)                                                                                                                                                                                               |
| PoC entry ESM 5.0.12 (F10)     | chạy PoC §2.1 qua `import()` (entry `exports.import`) — minimatch@10 có thể nạp ESM                                                                                                                                                                                       |
| Toolchain dùng brace-expansion | `pnpm lint` (eslint → minimatch → brace-expansion chạy THẬT)                                                                                                                                                                                                              |
| Types bundle                   | `pnpm typecheck` · `pnpm build`                                                                                                                                                                                                                                           |
| Email — ESM + CJS              | spec §4.5 + `mail-transport.service.spec` + `mail-config.service.spec` (F11: `reset-password-mail.service.spec` KHÔNG chạm nodemailer ⇒ không tính)                                                                                                                       |
| Email — dist PROD              | sau `pnpm --filter @mediaos/api build`: `node` nạp `apps/api/dist/settings/mail-transport.service.js` gọi `test()` tới server giả — bằng chứng phụ, ghi §9                                                                                                                |
| **Email — TLS (F2)**           | đo một lần ở scratchpad, cert tự ký sinh bằng `openssl` lúc chạy (KHÔNG commit key): STARTTLS (587) + TLS ngầm (465), nodemailer **9.1.1 và 10.0.12** cùng kịch bản ⇒ cả hai gửi được; ghi §9                                                                             |
| **WS — engine.io**             | 5 spec mở socket thật (grep `socket.io-client` ra đúng 5, phủ 2 gateway `/ws` + `/call`, có ca polling→upgrade) trên `LANE_DB`: `realtime.gateway.io.spec` · `call-signalling.gateway.spec` · `chat-rt0-ws-adapter` · `chat-rt1-realtime` · `chat-s7-call-rt1-signalling` |
| Cổng đầy đủ                    | `bash harness/check.sh --all --lane-db=s19audithigh`                                                                                                                                                                                                                      |

"int-spec gửi mail" của `done_when` (F7): `user-invites-flow.int-spec` **mock toàn phần**
`InviteMailService` và `mail-config-envelope.int-spec` không gọi `test()` tới server nào ⇒ KHÔNG int-spec
nào chạy nodemailer. Spec §4.5 là bằng chứng thật duy nhất; hai int-spec vẫn chạy trong `--all` như lưới
hồi quy tầng service.

## 6. Nợ để lại / ngoài phạm vi

1. `apps/lms` vẫn khai `nodemailer ^8` — ngoài workspace, cổng SCA không quét (memory
   `sca-gate-blind-to-lms-and-fbpost`). Không đổi màu cổng nào ⇒ WO riêng.
2. Advisory moderate/low (14 + 2) — dưới ngưỡng cổng, giữ lý do đã ghi trong `pnpm-workspace.yaml`.
3. `reset-password-mail.service.ts` còn là stub — khi tích hợp SMTP thật, nó sẽ đi qua nodemailer 10
   và phải có ca tương tự §4.5 + log sanitize như §4.6.
4. **F15 — `requireTLS`:** cả hai service `secure:false` không `requireTLS` ⇒ STARTTLS bị strip thì AUTH
   đi plaintext. Có từ trước, không do bump; 10.0.12 "honour requireTLS" nên vá được bằng `requireTLS:
!secure` — đổi hành vi kết nối của khách hàng ⇒ WO riêng, cần owner.
5. **F2 — ca TLS thường trực:** cần cert tự ký sinh lúc chạy; không có `openssl` trên PATH của mọi máy dev
   (PowerShell) ⇒ `skipIf` = xanh-không-đủ-bằng-chứng. Hôm nay đo một lần (§5) + kiểm tay trước PROD (§7).
6. **F15 — `chat-rt0-ws-adapter.int-spec.ts:100`** ca `["polling","websocket"]` nên assert upgrade đã hoàn
   tất (FE không chốt transports — `packages/web-core/src/lib/realtime-socket.ts:58`) — WO QA.
7. **🔴 (FULL gate security, MEDIUM có sẵn) `mail-config.service.ts:96-124` `testConnection`**: body vắng
   `password` ⇒ GIẢI MÃ mật khẩu SMTP ĐÃ LƯU rồi gửi tới `host`/`port`/`secure` DO CLIENT NHẬP ⇒ ai có quyền
   "test" trỏ host về server của mình là nhận được mật khẩu đã lưu qua AUTH PLAIN (plaintext nếu
   `secure:false`); `errorMessage` còn là oracle dò cổng. Không do bump. Vá: chỉ dùng lại mật khẩu đã lưu
   khi host/port/username/secure KHỚP hàng đã lưu, khác ⇒ bắt nhập mật khẩu (400) ⇒ **WO riêng, cần seed.**
8. **PROD log có thể đang chứa token kích hoạt/username** từ trước vá §4.6 (định dạng cũ
   `Gửi email mời tới <host> thất bại: …`). Mật khẩu SMTP KHÔNG nằm trong message của nodemailer ⇒ không cần
   rotate. Owner: grep log PROD một lần theo định dạng cũ, thu hồi lời mời < 72h nếu có.
9. `sendActivationEmail` không có hạn chót tổng (server nhỏ giọt byte không CRLF reset `socketTimeout`
   10s mãi, trần duy nhất 1 MiB) — như 9.x. `loadEnv`/`findByScope` ném TRƯỚC `try` ⇒ API 500 dù lời mời đã
   commit. Cả hai có từ trước ⇒ WO riêng.
10. `minimumReleaseAgeExclude` chỉ cộng dồn bản ghim mà lockfile đã bỏ (vô hại vì ghim chính xác) — dọn ở WO DEVOPS sau.
11. `MailTransportService.errorMessage` (trả UI) vẫn redact theo danh sách — ca "server đóng kèm phần dư
    chưa CRLF chứa blob AUTH PLAIN" lọt (`_onClose`); server đó đã nhận credential nên tác động nhỏ (security LOW).

## 7. Deploy · smoke · rollback (F6)

### 7.0 Đo 01/10: PROD chạy trên `node_modules` CỦA CHECKOUT CHÍNH (plan-reviewer lượt 2 — HIGH)

NSSM `MediaOS-API`: `AppDirectory = C:\dev 2\MediaOS`, `AppParameters = apps\api\releases\current\main.js`
(đọc registry 01/10). Release nằm trong `apps/api/releases/<stamp>/` và resolve `node_modules` bằng cách đi
LÊN (`scripts/release-artifact.mjs:17-21`) ⇒ trúng **`apps/api/node_modules` của checkout chính**.
`m prod-update api` (`mediaos.ps1:610-640`) chỉ build + snapshot + migrate + activate + restart — **KHÔNG
`pnpm install`**; `m prod-rollback` chỉ đổi junction `current` — **KHÔNG đổi `node_modules`**.

Hệ quả nếu thi công trong checkout chính: `pnpm install` trên nhánh đổi nodemailer/engine.io của PROD,
và lần restart kế tiếp (crash · reboot · NSSM AppExit Restart) chạy bản release CŨ trên deps MỚI — trước
gate, trước merge, trước smoke.

⇒ **Thi công trong git worktree riêng `C:\dev 2\MediaOS-s19`** (ngoài cây repo, `node_modules` riêng; chép
`.env` + `.secrets/local-kek.bin` — memory `worktree-missing-kek-false-red`). Checkout chính về `master`,
KHÔNG `pnpm install` gì ở đó cho tới khi owner deploy.

### 7.1 Trước khi deploy PROD (owner)

Dev-online dùng CHUNG `node_modules` + dist với PROD ⇒ không cách ly được gì, KHÔNG dùng để smoke. Smoke
SMTP thật chạy **từ worktree**: `pnpm --filter @mediaos/api build` trong worktree → `node` nạp
`dist/settings/mail-transport.service.js` gọi `test()` tới SMTP thật của công ty ⇒ đo entry CJS + TLS thật
của `verify()` mà không đụng PROD. **Thêm MỘT lần `sendMail`** (plan-reviewer lượt 3 — `verify()` chỉ bắt
tay; 10.x viết lại mime-node + "bare CR → CRLF" nên server thật có thể từ chối ở MAIL/RCPT/DATA): nạp
nodemailer bằng `require` trong worktree, cùng cấu hình như `InviteMailService` (host/port/secure/auth/
timeouts), gửi tới hộp thư test một thân thư có link giả dạng `?company=…&token=…`, mở thư kiểm link nguyên
vẹn. Mật khẩu SMTP nhập bằng `Read-Host -AsSecureString`, KHÔNG gõ `$env:…="…"` (PSReadLine lưu lịch sử).

### 7.2 Deploy (sau merge, trong checkout chính)

`m dev-online-stop` nếu :3200 đang chạy (TRƯỚC install — watch không được phản ứng giữa lúc pnpm đổi
`node_modules`) → `git switch master && git pull --ff-only` → **`pnpm install --frozen-lockfile`** (bước mà `m
prod-update` không làm) → **ngay** `m prod-update api` (giữa hai bước, một lần restart sẽ chạy release cũ
trên deps mới — giữ cửa sổ ngắn).

⚠️ `git pull` là bước DUY NHẤT kéo commit merge (code + lockfile mới) về checkout chính: `m prod-update api`
(`mediaos.ps1` `Invoke-ProdUpdate`) KHÔNG pull, chỉ build cây đang có. Bỏ nó ⇒ `pnpm install
--frozen-lockfile` cài lại ĐÚNG lockfile cũ (no-op, exit 0) và `m prod-update api` build lại ĐÚNG code cũ
(code CŨ trên deps CŨ) ⇒ cả lượt deploy là NO-OP im lặng mà trông như thành công (snapshot + restart vẫn
chạy, health vẫn 200) — chỉ `data.build.commit` ở §7.3 lộ ra.
Checkout chính thường bẩn hai file SINH `docs/STATUS.md` + `docs/plans/INDEX.md` (tracked, regen liên tục)
⇒ `git pull` từ chối ("would be overwritten by merge") ⇒ bỏ thay đổi của RIÊNG hai file đó trước
(`git restore docs/STATUS.md docs/plans/INDEX.md` — sinh lại được). Xác nhận đã kéo: `git log -1 --format=%h`
= commit merge trên `origin/master`.

### 7.3 Smoke sau deploy

- `GET /api/v1/health` ⇒ `data.build.commit` = commit merge (memory `release-artifact-and-rollback`).
- `node -p "require('nodemailer/package.json').version"` trong `apps/api` ⇒ `10.0.12`;
  `node -p "require.resolve('engine.io',{paths:[require.resolve('socket.io')]}).match(/engine.io@([0-9.]+)/)[1]"`
  ⇒ `6.6.11` (engine.io không phải dep trực tiếp ⇒ pnpm không link vào `apps/api/node_modules`; và nó KHÔNG
  export `./package.json` ⇒ `require('engine.io/package.json')` ném `ERR_PACKAGE_PATH_NOT_EXPORTED` — đo 01/10).
- Cài đặt → Mail → "Kiểm tra kết nối" trên PROD.

### 7.4 Rollback

`m prod-rollback <stamp>` **KHÔNG đủ** cho WO này: nó chỉ đổi junction `current` + restart (`mediaos.ps1`
`Invoke-ProdRollback`), `node_modules` của checkout chính GIỮ deps mới (§7.0). Không có migration ⇒ không
đụng DB.

**KHÔNG revert NGUYÊN squash `95f5ad8f`** (sửa 02/10 — S19-GOV-BOOKKEEPRE-1; bản cũ ghi "revert trên master").
Squash gộp CẢ vá log §4.6: revert nguyên ⇒ `invite-mail.service.ts` quay về
``this.logger.warn(`Gửi email mời tới ${config.host} thất bại: ${reason}`)`` với `reason = err.message`
⇒ **MỞ LẠI lỗ token kích hoạt + username vào log** (bất biến #3). ĐO 02/10 (spec dò tạm, server SMTP giả
echo link + username, nodemailer 10.0.12): code TRƯỚC squash ⇒ cả 3 ca 535 AUTH · 550 RCPT · 550 DATA log
`… thất bại: Invalid login: 535 5.7.8 … ?company=acme&token=<token> for <username>`; code SAU squash cùng
kịch bản ⇒ `… thất bại (name=Error code=EAUTH responseCode=535 command=AUTH PLAIN errno=- syscall=- tlsReason=-)`,
không token, không username. Việc nodemailer NỐI phản hồi server vào `err.message` có ở CẢ 9.1.1 (§9 dòng 1)
lẫn 10.0.12 ⇒ hạ deps KHÔNG kéo theo (và KHÔNG được kéo theo) hạ code log.

**Chỉ revert 3 file deps** — đúng bộ file deps trong `git show --stat 95f5ad8f`, và đi CÙNG nhau (lockfile ghi
lại khối `overrides` của workspace; lệch nhau thì `--frozen-lockfile` ĐỎ):

| File                    | Revert đưa về                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/package.json` | `nodemailer` `^9.1.1` · trả lại `@types/nodemailer` `^8.0.1`                                                               |
| `pnpm-lock.yaml`        | nodemailer 9.1.1 · engine.io 6.6.8 · brace-expansion 2.1.4 / 5.0.9                                                         |
| `pnpm-workspace.yaml`   | override brace-expansion `<2.1.3` / `>=3.0.0 <5.0.8` · `auditConfig.ignoreGhsas` GHSA-mh99 · `minimumReleaseAgeExclude` cũ |

GIỮ NGUYÊN: `apps/api/src/**` (`smtp-error-summary.ts` + 2 call-site — chỉ đọc trường lỗi chung, không
phụ thuộc major) · `apps/api/test/helpers/fake-smtp-server.ts` + 2 spec (ca CJS chấp nhận cả `lib/` của 9.x
lẫn `dist/cjs/` của 10.x) · `.github/workflows/security.yml` (chỉ đổi chú thích) · docs · harness.

1. **Trong worktree RIÊNG** (KHÔNG trong checkout chính — §7.0), Git Bash. Đảo ĐÚNG phần diff của 3 file
   deps — KHÔNG `git revert 95f5ad8f` (xem dưới khối lệnh):

   ```bash
   git fetch origin
   git switch -c revert/s19-audithigh-deps origin/master
   git diff --output=../s19-deps.patch 95f5ad8f^ 95f5ad8f -- \
     apps/api/package.json pnpm-lock.yaml pnpm-workspace.yaml
   git apply -R --3way ../s19-deps.patch   # ⇒ exit 0 · "Applied patch to '…' cleanly." × 3
   git status --short   # ⇒ ĐÚNG 3 dòng "M ": apps/api/package.json · pnpm-lock.yaml · pnpm-workspace.yaml
   pnpm install --frozen-lockfile
   pnpm --filter @mediaos/api typecheck
   pnpm --filter @mediaos/api exec vitest run src/user-invites/invite-mail.smtp.spec.ts \
     src/settings/smtp-error-summary.spec.ts src/settings/mail-transport.service.spec.ts \
     src/settings/mail-config.service.spec.ts
   git add apps/api/package.json pnpm-lock.yaml pnpm-workspace.yaml
   git commit -m "fix(deps): hạ deps về trước 95f5ad8f — nodemailer 9.1.1 · engine.io 6.6.8 · brace-expansion"
   git push -u origin revert/s19-audithigh-deps
   ```

   - **Vì sao không `git revert --no-commit 95f5ad8f`** (bản trước review 02/10): revert đảo CẢ 12 file của
     squash ⇒ xung đột với MỌI commit sau đụng file của squash. Ngay commit của S19-GOV-BOOKKEEPRE-1 đã làm
     nó exit 1 (`UD docs/plans/S19-OPS-AUDITHIGH-1.md` · `UU harness/backlog.mjs` — đo bằng `git merge-tree`
     và chạy thật trên bản sao) ⇒ xung đột vô hại ở docs/harness lẫn với xung đột THẬT ở lockfile. Đảo patch
     giới hạn 3 file ⇒ xung đột CHỈ có thể nằm ở file deps ⇒ exit ≠ 0 luôn nghĩa là DỪNG, không ngoại lệ.
   - **Vì sao `--output` chứ không `git diff … | git apply`**: diff có 22 dòng chữ Việt (chú thích
     `pnpm-workspace.yaml`); pipe native của PowerShell 5.1 mã hoá lại ⇒ đo 02/10: "patch does not apply" cả
     3 file. `--output` ghi byte thẳng ra tệp — gọi từ Git Bash hay PowerShell ra tệp TRÙNG hash. Tệp nằm
     ngoài cây (`../`) nên không hiện trong `git status`.
   - **Subject commit KHÔNG nêu mã WO nào** (trừ mã WO rollback nếu owner seed riêng): reconcile quét subject
     first-parent của master tìm mã WO để đóng dấu.
   - **Đã chạy thử 02/10** trên bản sao dùng-một-lần (`git clone --shared`): sạch (exit 0, đúng 3 file, nội
     dung = `95f5ad8f^`) trên cả `14afbb5f` lẫn tip nhánh S19-GOV-BOOKKEEPRE-1 (= master sau khi merge WO đó;
     cây index trùng khít cây của cách `revert` + `restore` cũ). Đối chứng dương: commit giả đổi các dòng
     nodemailer trong lockfile ⇒ exit 1 + `UU pnpm-lock.yaml` (2 file kia vẫn áp); commit giả đổi một dòng
     lockfile NGOÀI mọi hunk ⇒ vẫn exit 0.
   - **`git apply` exit ≠ 0** (commit sau đã đổi deps chạm cùng hunk) ⇒ DỪNG, KHÔNG sửa tay lockfile:
     `git restore --staged --worktree --source=HEAD -- pnpm-lock.yaml` (gỡ marker — đo: hết `UU`, 2 file
     specifier đã áp vẫn giữ; xung đột ở `package.json`/`pnpm-workspace.yaml` thì sửa tay theo bảng trên), rồi
     `pnpm install` (KHÔNG frozen) để sinh lại lockfile, kiểm `pnpm why nodemailer -r` = 9.1.1, rồi mới
     test + `git add` + commit như khối trên.
   - Ca "rớt kết nối ở lệnh DATA" chỉ từng đo trên 10.0.12 (10.0.12 "settle every send on a connection
     error") — trên 9.1.1 CHƯA đo; đỏ thì ghi vào PR, KHÔNG sửa spec trong PR rollback.

2. `gh pr create --base master` → CI. Cổng `Dependency scan` sẽ ĐỎ lại (7 HIGH quay về — cái giá có chủ ý
   của rollback) ⇒ owner merge `--admin`.

3. **Deploy trong CHECKOUT CHÍNH `C:\dev 2\MediaOS`** — y khuôn §7.2, KHÔNG bỏ bước nào:
   `m dev-online-stop` (nếu :3200 chạy) → `git restore docs/STATUS.md docs/plans/INDEX.md` nếu bẩn →
   `git switch master && git pull --ff-only` (**bắt buộc** — `m prod-update` không pull; thiếu nó thì bước
   dưới cài lại lockfile 10.x đang có và `m prod-update api` build lại code cũ ⇒ rollback NO-OP im lặng, chỉ
   `data.build.commit` lộ ra) → **`pnpm install --frozen-lockfile`** (`m prod-update` KHÔNG install,
   `m prod-rollback` KHÔNG đổi deps) → **ngay** `m prod-update api`.

4. Smoke như §7.3 với số kỳ vọng ĐẢO: nodemailer `9.1.1` · engine.io `6.6.8` · `data.build.commit` = commit
   merge của PR rollback · "Kiểm tra kết nối" trên PROD.

## 8. Thứ tự

0. Checkout chính → `master`; `git worktree add "C:/dev 2/MediaOS-s19" fix/s19-ops-audithigh-1` + chép
   `.env` · `.secrets/local-kek.bin` → `pnpm install --frozen-lockfile` TRONG worktree (§7.0). Mọi bước dưới
   đây chạy trong worktree.
1. Viết helper + spec §4.5 → chạy trên **9.1.1** (xanh trừ ca F3) → vá §4.6 → xanh hết.
2. Mutant m1–m5 (đỏ đúng assert) → hoàn tác bằng bản sao lưu.
3. Sửa `pnpm-workspace.yaml` + `apps/api/package.json` → `pnpm install` → `pnpm update engine.io -r --depth Infinity`.
4. Rà `ignoreGhsas` (§4.1, gỡ tạm + audit) → `minimumReleaseAgeExclude` → `git diff pnpm-lock.yaml` (F8).
5. Verify §5 (spec trên 10.0.12; dist; TLS; PoC ESM; WS trên LANE_DB; `check.sh --all`).
6. Sửa `done_when` trong `harness/backlog.mjs` cho khớp (F7: engine.io = bump lockfile in-range; "int-spec
   gửi mail" = spec §4.5) — ghi rõ trong PR là **owner chốt** câu chữ mới.
7. **FULL gate** = `security-reviewer` + `silent-failure-hunter` + `typescript-reviewer` (diff 0 SQL /
   schema / migration ⇒ `database-reviewer` không có gì để đọc). Không thêm `santa-method` (F14): thay
   đổi logic duy nhất là log allowlist ở §4.6, đã có ca RED + mutant m4, và đã có 3 reviewer độc lập. → vá
   → **rồi mới** PR.
8. PR · owner merge · `harness/backlog.mjs` → `done`.

## 9. Kết quả đo (01/10/2026, worktree `C:dev 2MediaOS-s19`)

| Đích                                                                     | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec §4.5 trên **9.1.1** TRƯỚC vá §4.6                                   | 5 xanh · **3 đỏ (ca F3)** — log THẬT chứa nguyên `…?company=acme&token=fixture_invite_token_s19 for mailer@corp.example.test` ⇒ lỗi rò token/username có sẵn trên master được chứng minh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Sau vá §4.6, vẫn 9.1.1                                                   | 8/8 + 2 spec mail cũ = 23/23 xanh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Mutant (sao lưu `cp`, hoàn tác `cp` + `cmp`)                             | m1 bỏ `auth` invite → 3 đỏ (`expected [] …` · `{sent:true}` · auths length 0) · m2 bỏ `auth` transport → 2 đỏ (`expected []` · `{ok:true}`) · m3 đổi `to` → 2 đỏ (rcptTo) · m4 gỡ vá log → 3 đỏ (định dạng chẩn đoán) · **m4b** giữ định dạng mới nhưng nối lại `err.message` → 3 đỏ đúng `not to contain 'fixture_invite_token_s19'` · m5 bỏ `resetModules` → 1 đỏ `spy … called 1 times, but got 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ignoreGhsas` GHSA-mh99                                                  | `gh api /advisories/GHSA-mh99-v99m-4gvg`: thượng nguồn sửa dải 31/07 thành per-major (`>=2.0.0 <2.1.3` · `>=4.0.0 <5.0.8` · `<1.1.17`…). Gỡ tạm ignore ⇒ audit vẫn 0 HIGH, tổng y hệt ⇒ **gỡ hẳn** (giữ script guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Diff lockfile                                                            | đúng 4 gói: brace-expansion 2.1.4→**2.1.7**, 5.0.9→**5.0.12** · engine.io 6.6.8→**6.6.11** (bỏ dep `base64id`) · nodemailer 9.1.1→**10.0.12** (`engines >=20`, 0 dep runtime) · gỡ `@types/nodemailer@8.0.1`. `pnpm why` mỗi gói đúng 1 bản (brace-expansion 2 bản theo major)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Cổng chính                                                               | `pnpm install --frozen-lockfile` sạch · `pnpm audit --audit-level high` **exit 0** — 23 vuln/7 HIGH → **11 vuln/0 HIGH** (2 low · 9 moderate)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Guard GHSA-mh99                                                          | `check-brace-expansion-guard.mjs`: 2.1.7 + 5.0.12 có guard ở entry `main` ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PoC §2.1 entry ESM 5.0.12                                                | 5.0.9 `import` ném `RangeError` · 5.0.12 trả kết quả ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Spec §4.5 trên **10.0.12**                                               | 23/23 xanh; ca CJS resolve `dist/cjs/nodemailer.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Typecheck                                                                | lần đầu ĐỎ: `import.meta` không hợp lệ với `module: commonjs` ⇒ đổi sang `createRequire(__filename)` (quy ước của kho — `src/config/swagger.ts`) ⇒ xanh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dist CJS (PROD `require`)                                                | `node` nạp `dist/settings/mail-transport.service.js` + `dist/user-invites/invite-mail.service.js`: resolve `nodemailer@10.0.12/…/dist/cjs/nodemailer.js` · `verify()` `{ok:true}` auths=1 · `sendActivationEmail` `{sent:true}` auths=1, 1 RCPT, 1 DATA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| TLS (một lần, cert openssl, client tin qua `tls.ca`, nạp bằng `require`) | 9.1.1 + 10.0.12: TLS ngầm OK · STARTTLS OK · AUTH đi trong TLS ở mọi phiên. Đối chứng âm (không `ca`): cả hai `ESOCKET self-signed certificate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| changelog engine.io 6.6.9→6.6.11                                         | 6.6.10 "reject protocol mismatch" (chính bản vá) + đổi đường **polling** (gom/stream thân) · 6.6.11 "refresh ping timeout on incoming packets" ⇒ ca polling→upgrade của `chat-rt0` là đích đúng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| WS trên `LANE_DB=mediaos_s19audithigh`                                   | **93/93** — realtime.gateway.io 5 · call-signalling.gateway 24 · chat-rt0-ws-adapter 10 · chat-rt1-realtime 14 · chat-s7-call-rt1-signalling 40 (int-spec THỰC THI, không skip)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Smoke §7.3 engine.io                                                     | lệnh `require('engine.io/package.json')` reviewer đề xuất ném `ERR_PACKAGE_PATH_NOT_EXPORTED` ⇒ thay bằng resolve + đọc phiên bản từ đường dẫn (đo ra `6.6.11`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `check.sh --all --lane-db=s19audithigh` (trước vá sau gate)              | secret-literals · lint · typecheck · migration-no-drop · tooling-tests · build · prod-tenant-check · db-readiness ✅. Test: 35/36 chunk xanh; chunk api 18/21 đỏ vì 7× `ERR_IPC_CHANNEL_CLOSED` (worker vitest chết — chế độ hỏng đã biết của máy này) + 1 test `s16-social-db1-invariants` «census wildcard»: dòng vi phạm là role fixture `ki074-w-view-star-*` do `role-member-del-oracle.int-spec.ts` gieo rồi để sót trên lane DB — diff KHÔNG đụng file nào trong đó ⇒ không liên quan                                                                                                                                                                                                                                                                                                                                                               |
| FULL gate (Opus ×3, trên worktree)                                       | security-reviewer **PASS** · silent-failure-hunter **PASS** (3 MEDIUM: F1 log mạng/TLS giống nhau · F2 lỗi lập trình ra `- - -` · F3 thiếu ca rớt kết nối) · typescript-reviewer **PASS** (3 MEDIUM: M1 nhánh `-` không test · M2 helper 175 dòng · M3 log transport lệch nguyên tắc). 0 CRITICAL/HIGH                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Vá sau gate                                                              | `smtp-error-summary.ts` (+13 ca bảng: lệch hình dạng ⇒ `-`, không phải Error ⇒ `-`, errno tra từ `getSystemErrorMap` cho chạy được cả Windows/Linux) · log transport dùng allowlist · 2 ca SMTP mới: cổng đã đóng ⇒ `errno=ECONNREFUSED syscall=connect`; rớt kết nối giữa DATA ⇒ `{sent:false}` < 3s · echo giờ kèm blob AUTH PLAIN (assert `not.toContain` thật sự cắn) · assert DƯƠNG cho log transport · helper tách class `FakeSmtpSession` + gỡ `reject` khỏi `error` sau listen + giải 8bit đúng UTF-8 + ném khi phần MIME hỏng. **38/38** (4 file). Mutant: `ERROR_CODE=/.*/` ⇒ đỏ ca lệch-hình-dạng; log transport về `errorMessage` ⇒ đỏ assert dương. ⚠️ Một lần báo "28/28" giữa chừng là XANH-GIẢ: regex mất `\` qua heredoc làm file spec SMTP không nạp được, grep lọc mất dòng `Test Files 1 failed` — đã sửa, đo lại có dòng `Test Files` |
| Re-gate phần vá sau gate (security-reviewer Opus, gộp silent-failure)    | **PASS**. 1 MEDIUM đã vá: `logger.error(summary, err.stack)` đưa `err.message` quay lại log (V8 dựng stack muộn ⇒ chứa cả phần nodemailer nối vào) ⇒ `stackFramesOf` chỉ giữ dòng `at …` + ca service "lỗi LẬP TRÌNH trong try" (TypeError mang token). Mutant trả lại `err.stack` ⇒ đỏ đúng `not to contain 'fixture_invite_token_s19'`. 2 LOW đã vá: `syscall` thành tập liệt kê (regex `^[a-z]{2,16}$` khớp cả hình dạng mật khẩu ứng dụng Gmail) · đổi tên ca rớt kết nối cho đúng (rớt ở lệnh DATA). NOTE đã ghi chú cạnh `createTransport`: cấm bật `logger`/`debug` của nodemailer. **39/39** · tsc · eslint · prettier sạch                                                                                                                                                                                                                        |
