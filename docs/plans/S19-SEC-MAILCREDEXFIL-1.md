# S19-SEC-MAILCREDEXFIL-1 — Mật khẩu SMTP đã lưu bị gửi tới đích do client chọn

> Zone **red** — secret (bất biến #3): mật khẩu SMTP là write-only, người giữ `configure-mail` KHÔNG được
> đọc ra nó; hai đường dưới đây cho đọc gián tiếp. ⇒ plan-reviewer trước khi code · deny-path RED trước ·
> FULL gate (security + silent-failure + database) TRƯỚC khi mở PR · owner merge. Không đổi deps; **1
> migration** (`0591`, owner D5 — thêm sau plan-review lượt 1).

## 1. Hai đường rò (đọc code master `14afbb5f`)

| #   | Đường                                                                      | Cơ chế                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `POST /settings/mail-config/test` vắng `password`                          | `mail-config.service.ts:100-124`: `decryptSecret(existing)` rồi `transport.test({ host: dto.host, port: dto.port, username: dto.username, secure: dto.secure ?? true, password })` — đích lấy từ BODY, mật khẩu từ HÀNG ĐÃ LƯU. |
| B   | `PUT /settings/mail-config` đổi host/port/username/secure, vắng `password` | `mail-config.repository.ts:141-156`: nhánh «giữ envelope» `UPDATE` cả 4 cột đích ⇒ envelope cũ gắn với đích mới ⇒ lời mời kế tiếp `InviteMailService` AUTH mật khẩu cũ tới đó (rò chậm, không dấu vết ở route test).            |

Kẻ tấn công: người giữ quyền nhạy cảm `configure-mail` (admin trong nhà / tài khoản admin bị chiếm). Mục
tiêu: mật khẩu hộp thư công ty (thường dùng chung dịch vụ khác). `secure:false` ⇒ AUTH PLAIN trên dây rõ.

**Đo PROD 02/10** (DB `mediaos`, role `mediaos` = superuser + BYPASSRLS, đếm thêm theo từng tenant qua GUC làm
đối chứng): 1 công ty · **0 hàng `company_mail_configs`** · 0 sự kiện audit `mail_config` ⇒ PROD chưa từng lưu
mật khẩu SMTP — hai đường rò chưa thể bị khai thác trên PROD, không có gì phải điều tra/rotate (§6).

## 2. Đo: `errorMessage` của route test là oracle ĐỌC BANNER, không chỉ dò cổng

`scratchpad/oracle-probe.cjs` + `oracle-fields.cjs` + `oracle-tls.cjs`, nodemailer **10.0.12**, transport y hệt
`MailTransportService` (`verify()`), dịch vụ giả trên 127.0.0.1:

| Đích                                       | Trường máy-sinh (đo)                                    | `err.message` trước WO (tới client nguyên văn)                                                |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dịch vụ im lặng tới khi nhận lệnh (Valkey) | `ETIMEDOUT` `CONN`                                      | `Timeout`                                                                                     |
| Banner SSH                                 | `EPROTOCOL` `CONN`                                      | `Invalid greeting. response=SSH-2.0-OpenSSH_9.6p1 … internal-db-01: …`                        |
| HTTP                                       | `EPROTOCOL` `CONN`                                      | `Invalid greeting. response=HTTP/1.1 400 Bad Request: …`                                      |
| Postfix nội bộ từ chối HELO                | `EPROTOCOL` + `responseCode 554` `HELO`                 | `Invalid HELO. response=554 5.7.1 <unknown[10.0.3.7]>: … (internal relay mx-internal…)`       |
| Relay bận ở lời chào                       | `EPROTOCOL` + `421` `CONN`                              | `Invalid greeting. response=421 4.3.2 mx-internal.corp.local busy…`                          |
| AUTH bị từ chối                            | `EAUTH` + `535` `AUTH PLAIN`                             | (đã đổi thành câu chung từ trước — giữ)                                                       |
| AUTH 530 / 538 (đòi mã hoá trước)          | `EAUTH` + `530`/`538`                                   | `Invalid login: 530 5.7.0 Must issue a STARTTLS command first at mx-internal…`                |
| Bật TLS tới cổng chữ rõ                    | `ESOCKET` + `reason` (`wrong version number`)           | `…:error:0A00010B:SSL routines:…:openssl\ssl\record\methods\tlsany_meth.c:78:` (lộ đường dẫn) |
| Cert tự ký                                 | `ESOCKET` TRẦN — không `reason`/`errno`/`syscall`       | `self-signed certificate; if the root CA is installed locally…`                               |
| Sai altname                                | `ESOCKET` + `reason` có `:`/`.` (+ `host`,`cert`)       | `Hostname/IP does not match certificate's altnames: IP: 127.0.0.1 is not in the cert's list`  |
| Cổng đóng                                  | `ESOCKET` + `errno ECONNREFUSED` + `syscall connect`    | `connect ECONNREFUSED 127.0.0.1:64366`                                                        |
| DNS                                        | `EDNS` + `errno ENOTFOUND` + `syscall getaddrinfo`      | `getaddrinfo ENOTFOUND no-such-host.invalid`                                                  |

⇒ Trước WO, route test cho người giữ `configure-mail` **đọc dòng đầu banner của mọi dịch vụ TCP mà API với
tới** (phiên bản phần mềm, hostname/IP nội bộ), không cần mật khẩu đã lưu — SSRF đọc-một-dòng, nặng hơn «oracle
dò cổng» backlog ghi. nodemailer GHI ĐÈ mã gốc của Node (`DEPTH_ZERO_SELF_SIGNED_CERT`…) thành `ESOCKET` và
không giữ ở đâu (đo: không `cause`, không khoá thêm).

## 3. Bất biến (thứ bản vá phải giữ)

- **I1** — Mật khẩu ĐÃ LƯU chỉ bao giờ được gửi tới **đích của chính hàng chứa nó**. Đích = bộ bốn
  `(host, port, username, secure)`, so sánh **chính xác** (không chuẩn hoá hoa/thường/khoảng trắng — lệch thì
  bắt nhập lại mật khẩu: fail-closed). Hàng cũ có khoảng trắng (tạo qua API, Zod không trim) ⇒ FE gửi bản trim
  ⇒ bị đòi mật khẩu một lần rồi hàng được ghi lại bản trim — FE và server nhất quán, không khoá ai.
- **I2** — Bốn cột đích **chỉ được ghi cùng một envelope MỚI** (DELETE+INSERT). Nhánh «giữ envelope» về CẤU
  TRÚC không ghi được cột đích (code) và **DB không cho** (mig 0591).
- **I3** — `errorMessage` trả client chỉ dựng từ **trường máy-sinh**, không bao giờ chứa byte của đầu bên kia
  (ngoại lệ có chủ ý: `responseCode` 3 chữ số qua `replyCode`).

## 4. Bản vá

### 4.1 `apps/api/src/settings/mail-destination.ts` (MỚI)

`MailDestination` · `destinationOf(row)` · `changedDestinationFields(a, b)` (chỉ TÊN trường, cho log) ·
`sameDestination` · `class MailPasswordRequiredError` (tự gán `this.name` — tiền lệ `db.service.ts`; lỗi miền,
repo ném, service map ra HTTP).

### 4.2 Service — `mail-config.service.ts`

- `testConnection(companyId, dto, actorUserId)` vắng password: chưa có hàng ⇒ 400; đích lệch ⇒ **400 TRƯỚC
  `decryptSecret`**; khớp ⇒ decrypt rồi `transport.test` tới **đích của HÀNG** (không phải của dto) — nên kể cả
  phép so bị gỡ (mutant M1) mật khẩu đã lưu vẫn chỉ tới đích đã lưu.
- `upsert` vắng password: tạo mới ⇒ 400; đích lệch ⇒ 400 sớm (không mở tx ghi, không audit). Bắt
  `MailPasswordRequiredError` từ repo (thua đua) ⇒ cùng 400.
- Từ chối ⇒ `logger.warn` có cấu trúc: route · company · actor · scope · TÊN trường đổi · `requestedHost`
  (`JSON.stringify` — chống chèn dòng log) · `requestedPort`. Đường A trước đây không để dấu vết nào.
- Nhánh giải mã thất bại (trước: nuốt im lặng) ⇒ thêm `logger.warn` (company + config id, không chi tiết crypto).
- Controller truyền `req.user.id` cho `testConnection`.

### 4.3 Repo — `mail-config.repository.ts`: I2 về cấu trúc

Nhánh `existing && !envelope`: `UPDATE … SET from_name, from_email, updated_at` (bỏ hẳn 4 cột đích) `WHERE
company_id, scope AND host = $h AND port = $p AND username = $u AND secure = $sec RETURNING *`; **0 hàng ⇒
`throw new MailPasswordRequiredError()`** (trước: `afterRow.id` trên `undefined` ⇒ 500). KHÔNG so trước trong tx
(plan-review lượt 1 #1: bước so sớm làm vị từ bất khả đạt và mutant M3 sống). READ COMMITTED đánh giá lại vị từ
trên phiên bản hàng thật sự bị ghi ⇒ một PUT có mật khẩu chen giữa không lách được. Thua đua ⇒ người không đổi
đích nhận 400 «cần mật khẩu» — chấp nhận; FE invalidate query khi gặp mã này để so với đích mới.

### 4.4 Mã lỗi `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED` (400) — owner D1

`docs/spec` + `docs/API Design` không có mục mail config (CS-8 là màn console, ngoài bộ SPEC). Append cuối
`FOUNDATION_ERROR_CODES` (APPEND-ONLY) + 1 dòng BACKEND-12 §21.3. Một mã cho cả ba ca «thiếu mật khẩu».
`AllExceptionsFilter` tin `payload.code` (hằng phía server); web-core `mapStatusToErrorKind` vẫn VALIDATION theo
status. Không đổi route ⇒ openapi/route census không đổi.

### 4.5 Oracle — `classifySmtpTestError(err)` trong `smtp-error-summary.ts` — owner D2/D3

Câu HẰNG theo thứ tự (chỉ XÉT trường — có/không, thuộc tập hằng; không nối nội dung):

| Điều kiện                                                                   | Câu                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EAUTH` + `530`/`538`                                                       | Máy chủ yêu cầu kết nối mã hoá trước khi đăng nhập — bật «Dùng TLS» hoặc cổng STARTTLS.    |
| `EAUTH` (còn lại)                                                           | Xác thực SMTP thất bại                                                                     |
| `ETIMEDOUT` (code hoặc errno)                                               | Hết thời gian chờ máy chủ SMTP — kiểm tra máy chủ, cổng và tường lửa.                      |
| `EDNS` / `syscall=getaddrinfo`                                              | Không phân giải được tên máy chủ SMTP.                                                     |
| `errno=ECONNREFUSED`                                                        | Máy chủ từ chối kết nối — kiểm tra máy chủ và cổng.                                        |
| `errno` khác (ECONNRESET, EHOSTUNREACH…)                                    | Lỗi mạng khi kết nối tới máy chủ SMTP — kiểm tra mạng, máy chủ và cổng.                    |
| `ETLS` · CÓ `reason` · `ESOCKET` không `syscall` (lỗi socket thật luôn có) | Lỗi TLS/chứng chỉ — kiểm tra «Dùng TLS», cổng (465 TLS, 587 STARTTLS) và chứng chỉ máy chủ. |
| `responseCode` hợp lệ (200–599, số nguyên)                                  | Máy chủ SMTP từ chối (mã N).                                                               |
| `EPROTOCOL`                                                                 | Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.                                 |
| còn lại                                                                     | Kiểm tra kết nối thất bại.                                                                 |

`sanitizeSmtpError` bị xoá (một caller duy nhất; spec của nó trong `mail-transport.service.spec.ts` gỡ theo,
ca mock auth dựng lại với `code:"EAUTH", responseCode:535`). **Phần CHẤP NHẬN (D3):** phân biệt mở/đóng/im
lặng (dò cổng) vẫn còn — tác nhân đã giữ quyền nhạy cảm, N=1 công ty, thứ còn lại là «cổng nào mở» chứ không
phải nội dung; chặn dải nội bộ/loopback phá relay nội bộ hợp lệ và mailpit dev.

### 4.6 FE — `apps/console/src/routes/settings/mail-config.tsx` (owner D4 — backlog cũ ghi nhầm `apps/app`)

`destinationChanged` (scope/host/port/username/TLS khác `initial`, so bản trim như server nhận) + ô mật khẩu
trống ⇒ **Lưu** và **Kiểm tra kết nối** không gọi API, hiện `passwordRequiredDestChanged`; tạo mới thiếu mật
khẩu cũng chặn ở nút Kiểm tra. Gợi ý dưới ô mật khẩu đổi sang `passwordDestChangedHint` khi đã đổi đích. Lỗi
server mã mới (lưu hoặc test — `ApiError` của web-core) ⇒ `passwordRequiredServer`; `handleTest` hết nuốt mọi
lỗi thành câu chung. `MailConfigPage` truyền `saveError` + invalidate query khi gặp mã này.

### 4.7 DB — mig `0591_s19secmailcred_revoke_mail_dest_update.sql` — owner D5 (sau plan-review)

`REVOKE UPDATE (host, port, username, secure) ON company_mail_configs FROM mediaos_app` + khối VERIFY fail-loud
(`has_column_privilege` — tính cả grant cấp bảng/PUBLIC/role kế thừa; và đảm bảo `from_name`/`from_email`/
`updated_at` vẫn UPDATE được). Đo trước (grant-in-old-migration-is-not-current-state): PROD + lane có UPDATE
theo CỘT, KHÔNG UPDATE cấp bảng (relacl `mediaos_app=ard`) ⇒ REVOKE theo cột có hiệu lực thật. Journal idx 258.

## 5. Test — RED trước (đo đỏ trên code master, rồi mới vá)

**Int-spec MỚI `apps/api/test/integration/mail-config-credexfil-http.int-spec.ts`** (HTTP thật + DB lane +
nodemailer thật + 2 server SMTP giả L/E; "không một kết nối" đo bằng `connections` mới của helper):

| Ca  | Kịch bản                                                                       | Kỳ vọng                                                                                       |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| R1  | test vắng pw, port → E                                                         | 400 mã mới; 0 kết nối tới E lẫn L                                                             |
| R2a | test vắng pw, username khác trên L                                             | 400; L 0 kết nối (trước WO: L nhận AUTH `EVIL_USER`/`STORED`)                                  |
| R2b | hàng `secure:true`, test vắng pw HẠ `secure:false`                             | 400; L 0 kết nối (trước WO: AUTH PLAIN mật khẩu đã lưu trên dây rõ)                            |
| R2c | hàng `secure:false`, body vắng `secure` (⇒ true)                               | 400 (chỉ status/mã có nghĩa — TLS tới L hỏng trước AUTH cả trên master)                        |
| P1  | test vắng pw, đích khớp                                                        | `{ok:true}`; L nhận AUTH `STORED`                                                             |
| R3  | PUT port → E vắng pw                                                           | 400; hàng y nguyên; `InviteMailService` gửi tới L, E 0 kết nối                                |
| P2  | PUT chỉ đổi from vắng pw                                                       | 200; id + envelope giữ                                                                        |
| P3  | PUT đích E + pw mới; test vắng pw tới E                                        | 200/`{ok:true}`; E nhận pw MỚI, không bao giờ `STORED`                                         |
| R4  | `repo.upsert(envelope=null)` đích lệch (bỏ qua service)                        | ném `MailPasswordRequiredError`; hàng y nguyên; **0 audit mới** — đo thẳng vị từ + nhánh 0 hàng |
| R5  | test CÓ pw tới cổng banner SSH, qua HTTP                                       | câu giao thức cố định; body không chứa banner                                                 |
| D5a | `has_column_privilege` 7 cột                                                   | 4 cột đích `false`, `from_*`/`updated_at` `true`                                              |
| D5b | `UPDATE … SET port` bằng role app (`withTenant`)                               | 42501 (đọc `cause` — drizzle bọc mã PG); hàng y nguyên                                        |

**Unit** `mail-transport.oracle.spec.ts` (MỚI — nodemailer thật qua dây tới server TCP thô: banner SSH/HTTP,
HELO 554 kèm hostname, AUTH echo, TLS lệch, cổng đóng). **Unit** `smtp-error-summary.spec.ts`: bảng §4.5 với
hình dạng lỗi đo thật (gồm timeout 8 s, DNS, cert tự ký, altname, 530/538 — các ca không chạy qua dây được),
responseCode lạ, thứ không phải Error. **Unit** `mail-config.service.spec.ts`: bảng 4 trường đích lệch (PUT +
test) ⇒ 400 + không decrypt/không transport/không ghi; LẬT 3 ca từng ghim lỗ (`smtp.x`), ca decrypt-fail giữ
là decrypt-fail (đích khớp). **`mail-config-envelope.int-spec.ts`** ca 3 ghim lỗ B ⇒ LẬT thành 3 (chỉ đổi from)
+ 3a (đổi đích ⇒ 400, hàng y nguyên). **Console** `mail-config.spec.tsx`: 4 trường đích × Lưu, Kiểm tra, đổi
đích + pw, chỉ đổi tên người gửi, lỗi server mã mới (lưu + test).

## 6. Điều tra lịch sử — đo PROD: KHÔNG có gì để điều tra

PROD (`mediaos`) **0 hàng** `company_mail_configs`, **0** sự kiện audit `mail_config` (đo bằng superuser
BYPASSRLS + đếm lại theo từng tenant qua GUC làm đối chứng — plan-review #5: FORCE RLS cho 0 hàng GIẢ nếu chạy
bằng role thường không set GUC). ⇒ chưa từng có mật khẩu SMTP nào để rò; không cần rotate. Câu SQL để dành nếu
một môi trường khác có dữ liệu (chạy bằng superuser/BYPASSRLS, hoặc `mediaos_app` +
`SET app.platform_audit_read = 'on'`; ĐỐI CHỨNG trước: `SELECT count(*) FROM audit_logs WHERE
object_type='mail_config'` phải ≥ số lần lưu đã biết):

```sql
SELECT created_at, actor_user_id, object_id, after->>'scope' AS scope,
       before->>'host' AS b_host, after->>'host' AS a_host, before->>'port' AS b_port, after->>'port' AS a_port,
       before->>'username' AS b_user, after->>'username' AS a_user, before->>'secure' AS b_sec, after->>'secure' AS a_sec
FROM (SELECT a.*, lag(object_id) OVER (PARTITION BY company_id, after->>'scope' ORDER BY created_at, id) AS prev_obj
      FROM audit_logs a WHERE object_type = 'mail_config') t
WHERE action = 'MailConfigUpdated' AND object_id = prev_obj
  AND (before->>'host', before->>'port', before->>'username', before->>'secure')
      IS DISTINCT FROM (after->>'host', after->>'port', after->>'username', after->>'secure');
```

(Nhánh UPDATE giữ `id`; đổi mật khẩu là DELETE+INSERT ⇒ `id` mới. `object_id` trùng sự kiện liền trước + đích
đổi = đổi đích KHÔNG nhập mật khẩu. Đường A không để dấu vết audit — chỉ log từ WO này.)

## 7. Ngoài phạm vi / nợ để lại

- Người giữ `configure-mail` đặt **mật khẩu + relay CỦA HỌ** thì mọi thư mời (token kích hoạt) đi qua relay
  đó — bản chất của quyền «cấu hình mail server», không phải rò secret đã lưu. Giảm thiểu thật = step-up /
  2 người duyệt khi đổi đích (WO riêng nếu owner muốn).
- `secure:false` không `requireTLS` ⇒ kẻ trên đường truyền bóc STARTTLS được ⇒ AUTH PLAIN rõ. Có từ CS-8; bật
  `requireTLS` phá relay/dev không TLS ⇒ quyết định riêng.
- Route test không ghi audit / không rate-limit (dò cổng — D3 chấp nhận). Từ chối chỉ để dấu ở log.
- Thua đua (PUT có mật khẩu chen giữa) ⇒ 400 «cần mật khẩu» cho người không đổi đích — chấp nhận, FE tải lại.
- Client khác FE vắng `secure` khi hàng `false` ⇒ 400 (ghi ở docblock contract).

## 8. Quyết định owner (ký 02/10/2026)

- **D1** mã `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED` (400), append catalog + BACKEND-12 §21.3, cho cả 3 ca.
- **D2** `errorMessage` = câu cố định theo bảng §4.5.
- **D3** chấp nhận phần dò cổng còn lại, ghi lý do.
- **D4** paths WO: `apps/console/src/**` (thay `apps/app/src/**`) + `error-codes.ts` + BACKEND-12.
- **D5** (đề xuất của plan-review lượt 1) mig 0591 REVOKE + int-spec 42501; paths thêm `apps/api/migrations/**`.
- Chi phí: hook báo ~$67 sau plan-review; owner chọn «tiếp tục đầy đủ» (gồm FULL gate Opus).

## 9. Thứ tự

1. Worktree `C:\dev 2\MediaOS-mailcred` (nhánh `fix/s19-sec-mailcredexfil-1`, base `14afbb5f`), `.env` + KEK
   chép, `pnpm install --frozen-lockfile`, lane DB `mediaos_mailcred`.
2. plan-reviewer lượt 1 → BLOCK (§11) · owner ký D1–D5 · vá plan.
3. RED → GREEN → mutant (§10) → `bash harness/check.sh --all --lane-db=mailcred`.
4. FULL gate Opus: `security-reviewer` + `silent-failure-hunter` + `database-reviewer` (mig 0591).
5. Vá finding (mỗi vá có ca RED) → re-gate → PR → owner merge. Deploy: API (`m prod-update api` — snapshot →
   **migrate 0591** → activate) + console FE. Master đã có deps #558 ⇒ PROD vẫn cần `pnpm install
--frozen-lockfile` theo `S19-OPS-AUDITHIGH-1` §7.2 nếu chưa làm. **Rollback:** lùi code mà giữ 0591 ⇒ PUT vắng
   password của code cũ 42501 (PUT kèm mật khẩu vẫn chạy) ⇒ lùi cả quyền: `GRANT UPDATE (host, port, username,
secure) ON company_mail_configs TO mediaos_app`.

## 10. Kết quả đo (02/10/2026, worktree `C:\dev 2\MediaOS-mailcred`, lane `mediaos_mailcred`)

**RED trên code master (trước vá):** int-spec mới 6 đỏ / 3 xanh dương (R1 nhận `201 {ok:true}` TỪ E ⇒ mật
khẩu đã lưu thật sự AUTH tới đó) · oracle qua dây 5 đỏ (lộ banner/hostname/OpenSSL/ip:cổng) + 1 xanh (AUTH đã
có câu chung) · unit service 12 đỏ · console 7 đỏ · envelope ca 3a 1 đỏ.

**GREEN:** unit settings + user-invites 74/74 (6 file) · int mail-config 3 file 34/34 · console 16/16.

**Mutant** (sao lưu → cấy → chạy → `cp` khôi phục, đối chiếu nội dung = OK cả 6):

| #   | Cấy                                                    | Đỏ                                                                                                   |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| M1  | bỏ so đích ở `testConnection`                          | 8: 4 unit + R1/R2a/R2c `expected 201 to be 400`; R2b `201` với câu TLS — gửi tới đích HÀNG nên vẫn không rò |
| M2  | bỏ so sớm ở `upsert`                                   | 5 unit; **R3 + envelope 3a vẫn XANH** — vị từ repo + 0591 chặn độc lập (đúng thiết kế nhiều lớp)        |
| M3  | bỏ vị từ đích trong UPDATE của repo                    | R4 `promise resolved … instead of rejecting`                                                         |
| M4  | `errorMessage` = `err.message`                         | 6 oracle qua dây + R5 HTTP (lộ banner/hostname/OpenSSL/ip:cổng/username)                             |
| M5  | FE bỏ `destinationChanged`                             | 5 console (4 Lưu `spy called 1 times` + Kiểm tra `Unable to find role="alert"`)                      |
| M6  | DB cấp lại `UPDATE (host,port,username,secure)` (≈ thiếu 0591) | D5a `{host:true,…}` ≠ kỳ vọng · D5b `UPDATE cột đích phải bị DB từ chối`; đã REVOKE lại        |

## 11. plan-review lượt 1 (Opus) — BLOCK → đã vá

| #    | Finding                                                                       | Xử lý                                                                                  |
| ---- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B1   | Bước so sớm trong tx làm vị từ UPDATE bất khả đạt; 0 hàng ⇒ 500; M3 sẽ sống   | Bỏ so trong tx; `if (!row) throw`; R4 đo vị từ + 0 audit; M3 đo ĐỎ                     |
| B2   | R5 dùng `echo` của helper không đỏ được trên master                           | Oracle đo bằng server TCP thô (unit qua dây + R5 HTTP) — đỏ trên master                |
| H    | Mô tả M1 sai (gửi tới đích hàng ⇒ L, không E)                                 | Ghi lại M1 theo đỏ thật (§10)                                                          |
| H    | 3 ca unit ghim lỗ (không phải 2); `mail-transport.service.spec.ts` import hàm bị xoá | Lật đủ 3, decrypt-fail giữ nhánh; spec transport sửa                                  |
| H    | SQL §6 có thể 0 hàng giả vì FORCE RLS                                         | Đo PROD bằng superuser + đối chứng theo tenant; ghi role/GUC + đối chứng               |
| H/D5 | Ép I2 ở DB                                                                    | mig 0591 + D5a/D5b + M6                                                                |
| M    | Hai ca `secure` của R2 xanh-rỗng phía L                                       | R2b hạ cấp true→false (có nghĩa); R2c chỉ status/mã, ghi lý do                         |
| M    | DNS/cert/530 chưa đo                                                          | Đo (§2), thêm dòng bảng §4.5                                                           |
| M    | Từ chối không để dấu vết                                                      | `logger.warn` có cấu trúc; decrypt-fail cũng log                                       |
| M    | Đua ⇒ 400 gây hiểu lầm                                                        | Ghi §7; FE invalidate query                                                            |
| L    | `this.name`; `handleTest` nuốt lỗi; `connections` cho "không một kết nối"     | Đã làm cả ba                                                                           |

Không chạy plan-review lượt 2: thiết kế được lượt 1 xác nhận đúng hướng, mọi finding về test; FULL gate đọc
code + test thật ngay sau.
