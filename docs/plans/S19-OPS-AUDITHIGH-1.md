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

| Gói | GHSA | Dải lỗ hổng | Cây có | Đường | Runtime? |
| --- | --- | --- | --- | --- | --- |
| `brace-expansion` | `GHSA-qhr7-859c-m2p7` (đệ quy ngoặc lồng) | `>=2.0.0 <2.1.6` · `>=4.0.0 <5.0.11` | 2.1.4 · 5.0.9 | 49 + 10 | ❌ dev (`eslint`/`typescript-eslint > minimatch`) |
| `brace-expansion` | `GHSA-6j4f-fj2g-mc7p` (đệ quy `parseCommaParts`) | `>=2.0.0 <2.1.5` · `>=4.0.0 <5.0.10` | 2.1.4 · 5.0.9 | 49 + 10 | ❌ dev |
| `engine.io` | `GHSA-2gc4-cqfq-p2gv` (DoS lệch protocol revision) | `>=6.6.0 <6.6.10` | 6.6.8 | 12 | ✅ **runtime** — server Socket.IO của API |
| `nodemailer` | `GHSA-v53p-9fqp-m79j` (addressparser backtracking bậc hai) | `<=10.0.5` | 9.1.1 | 1 | ✅ **runtime** — dep TRỰC TIẾP |
| `nodemailer` | `GHSA-prgh-xp8r-p3m5` (addressparser O(n²) địa chỉ ghép comment) | `>=9.1.0 <=10.0.4` | 9.1.1 | 1 | ✅ **runtime** |

### 2.1 Đo: bản "đã vá" CÓ vá ở đúng entry mà `require()` nạp không

Bài học `patched-version-unpatched-main-entry` (1.1.16/2.1.2 ship bản vá ở `dist/` nhưng `main` vẫn
code cũ) ⇒ không tin số hiệu. PoC chạy trên **chính entry `main`/`require`** của tarball:

| Bản | `{a,`×20000 + `b` + `}`×20000 | `{` + `a,{`×20000 + `b` + `}`×20000 + `}` |
| --- | --- | --- |
| 2.1.4 | ❌ `RangeError: Maximum call stack size exceeded` | ❌ `RangeError` |
| **2.1.7** | ✅ trả về (1002 phần tử) | ✅ |
| 5.0.9 | ❌ `RangeError` | ❌ `RangeError` |
| **5.0.12** | ✅ trả về (1002 phần tử) | ✅ |

⇒ 2.1.7 (`main: index.js`) và 5.0.12 (`exports.require → dist/commonjs`) vá thật ở đường minimatch đi.

### 2.2 Đường tới thật của `nodemailer` — khẳng định "đường AUTH (email reset)" của backlog SAI một nửa

`grep -rn nodemailer apps/api/src` ⇒ **đúng 2 call-site**:

| Call-site | Gọi | Mang gì |
| --- | --- | --- |
| `settings/mail-transport.service.ts:62` | `createTransport` + `verify()` + `close()` | mật khẩu SMTP plaintext (RAM) |
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

| Ca | Đo |
| --- | --- |
| Tự-kiểm server giả: `advertiseAuth:false` | `verify()` ok nhưng `auths` RỖNG ⇒ chứng minh assert AUTH ở các ca khác KHÔNG xanh-rỗng |
| `InviteMailService.sendActivationEmail` → `{sent:true}` | AUTH đúng user + mật khẩu ĐÃ GIẢI MÃ · `MAIL FROM` = `fromEmail` · `RCPT TO` = `email` · Subject giải RFC 2047 khớp nguyên văn (UTF-8) · phần `text/plain` chứa link kích hoạt · phần `text/html` chứa `href` đã escape |
| 535 ở AUTH | `{sent:false, reason:"send_failed"}`, KHÔNG ném, 0 thư |
| **F3:** 550 ở RCPT / DATA, phản hồi server **echo token + username** | `{sent:false, reason:"send_failed"}` · log của service KHÔNG chứa token · link · mật khẩu · username |
| `MailTransportService.test` → OK | `{ok:true}` · đúng một AUTH đúng user/pass · KHÔNG có `MAIL`/`RCPT`/`DATA` (verify chỉ bắt tay) |
| `MailTransportService.test` → 535 | `{ok:false, errorMessage:"Xác thực SMTP thất bại"}` · log không chứa mật khẩu |
| **F5 — Entry CJS chạy CODE SERVICE** | `vi.resetModules()` (BẮT BUỘC — không có thì `import()` trả module đã cache gắn với nodemailer ESM ⇒ ca "CJS" chạy ESM, xanh-rỗng) → `vi.doMock("nodemailer", factory)` với factory `createRequire(import.meta.url)("nodemailer")` + `vi.spyOn(cjs, "createTransport")` → `import()` lại `InviteMailService` ⇒ gửi thành công tới server giả · spy được gọi đúng 1 lần · `require.resolve("nodemailer")` kết thúc bằng `dist/cjs/nodemailer.js` (10.x) / `lib/nodemailer.js` (9.x). tsc `__importStar` trả nguyên module vì `dist/cjs/nodemailer.js` có `__esModule:true` + named export (reviewer đã đối chiếu) ⇒ tương đương PROD. Mutant m5: bỏ `resetModules` ⇒ ĐỎ ở assert spy |

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
- `code`/`command` là chuỗi do thư viện sinh, nhưng vẫn đi qua một whitelist ký tự (`[A-Z0-9 _.-]`, cắt
  độ dài) trước khi vào log — phòng một bản nodemailer sau nhét phản hồi vào `command`.

## 5. Verify

| Đích | Lệnh |
| --- | --- |
| Cổng chính | `pnpm audit --audit-level high` ⇒ exit 0 (0 HIGH/CRITICAL) |
| CI install | `pnpm install --frozen-lockfile` |
| **Diff lockfile (F8)** | `git diff pnpm-lock.yaml` chỉ được đổi brace-expansion · engine.io · nodemailer · gỡ `@types/nodemailer`; liệt kê gói khác nếu có |
| Cây giải đúng (F8) | `pnpm why <pkg> -r` ⇒ đúng **2.1.7 · 5.0.12 · 6.6.11 · 10.0.12** + ngày phát hành (`npm view <pkg> time`) |
| Guard GHSA-mh99 | `node scripts/check-brace-expansion-guard.mjs` (CÙNG job `dependency-scan`) |
| PoC entry ESM 5.0.12 (F10) | chạy PoC §2.1 qua `import()` (entry `exports.import`) — minimatch@10 có thể nạp ESM |
| Toolchain dùng brace-expansion | `pnpm lint` (eslint → minimatch → brace-expansion chạy THẬT) |
| Types bundle | `pnpm typecheck` · `pnpm build` |
| Email — ESM + CJS | spec §4.5 + `mail-transport.service.spec` + `mail-config.service.spec` (F11: `reset-password-mail.service.spec` KHÔNG chạm nodemailer ⇒ không tính) |
| Email — dist PROD | sau `pnpm --filter @mediaos/api build`: `node` nạp `apps/api/dist/settings/mail-transport.service.js` gọi `test()` tới server giả — bằng chứng phụ, ghi §9 |
| **Email — TLS (F2)** | đo một lần ở scratchpad, cert tự ký sinh bằng `openssl` lúc chạy (KHÔNG commit key): STARTTLS (587) + TLS ngầm (465), nodemailer **9.1.1 và 10.0.12** cùng kịch bản ⇒ cả hai gửi được; ghi §9 |
| **WS — engine.io** | 5 spec mở socket thật (grep `socket.io-client` ra đúng 5, phủ 2 gateway `/ws` + `/call`, có ca polling→upgrade) trên `LANE_DB`: `realtime.gateway.io.spec` · `call-signalling.gateway.spec` · `chat-rt0-ws-adapter` · `chat-rt1-realtime` · `chat-s7-call-rt1-signalling` |
| Cổng đầy đủ | `bash harness/check.sh --all --lane-db=s19audithigh` |

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
`dist/settings/mail-transport.service.js` gọi `test()` tới SMTP thật của công ty (credential qua env, không
log) ⇒ đo entry CJS + TLS thật mà không đụng PROD.

### 7.2 Deploy (sau merge, trong checkout chính)

`git switch master && git pull` → **`pnpm install --frozen-lockfile`** (bước mà `m prod-update` không làm)
→ `m dev-online-stop` nếu :3200 đang chạy → `m prod-update api`.

### 7.3 Smoke sau deploy

- `GET /api/v1/health` ⇒ `data.build.commit` = commit merge (memory `release-artifact-and-rollback`).
- `node -p "require('nodemailer/package.json').version"` trong `apps/api` ⇒ `10.0.12`;
  `require('engine.io/package.json').version` (qua socket.io) ⇒ `6.6.11`.
- Cài đặt → Mail → "Kiểm tra kết nối" trên PROD.

### 7.4 Rollback

`m prod-rollback <stamp>` **KHÔNG đủ** cho WO này (đổi dist, giữ deps mới). Đường đúng: revert trên master
→ `git pull` → `pnpm install --frozen-lockfile` → `m prod-update api`. Không có migration ⇒ không đụng DB.

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
   đổi logic duy nhất là redact log ở §4.6, đã có ca RED + mutant m4, và đã có 3 reviewer độc lập. → vá
   → **rồi mới** PR.
8. PR · owner merge · `harness/backlog.mjs` → `done`.

## 9. Kết quả đo (điền khi thi công)

_(trống)_
