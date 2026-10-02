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

| Đích                                       | Trường máy-sinh (đo)                                 | `err.message` trước WO (tới client nguyên văn)                                                |
| ------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dịch vụ im lặng tới khi nhận lệnh (Valkey) | `ETIMEDOUT` `CONN`                                   | `Timeout`                                                                                     |
| Banner SSH                                 | `EPROTOCOL` `CONN`                                   | `Invalid greeting. response=SSH-2.0-OpenSSH_9.6p1 … internal-db-01: …`                        |
| HTTP                                       | `EPROTOCOL` `CONN`                                   | `Invalid greeting. response=HTTP/1.1 400 Bad Request: …`                                      |
| Postfix nội bộ từ chối HELO                | `EPROTOCOL` + `responseCode 554` `HELO`              | `Invalid HELO. response=554 5.7.1 <unknown[10.0.3.7]>: … (internal relay mx-internal…)`       |
| Relay bận ở lời chào                       | `EPROTOCOL` + `421` `CONN`                           | `Invalid greeting. response=421 4.3.2 mx-internal.corp.local busy…`                           |
| AUTH bị từ chối                            | `EAUTH` + `535` `AUTH PLAIN`                         | (đã đổi thành câu chung từ trước — giữ)                                                       |
| AUTH 530 / 538 (đòi mã hoá trước)          | `EAUTH` + `530`/`538`                                | `Invalid login: 530 5.7.0 Must issue a STARTTLS command first at mx-internal…`                |
| Bật TLS tới cổng chữ rõ                    | `ESOCKET` + `reason` (`wrong version number`)        | `…:error:0A00010B:SSL routines:…:openssl\ssl\record\methods\tlsany_meth.c:78:` (lộ đường dẫn) |
| Cert tự ký                                 | `ESOCKET` TRẦN — không `reason`/`errno`/`syscall`    | `self-signed certificate; if the root CA is installed locally…`                               |
| Sai altname                                | `ESOCKET` + `reason` có `:`/`.` (+ `host`,`cert`)    | `Hostname/IP does not match certificate's altnames: IP: 127.0.0.1 is not in the cert's list`  |
| Cổng đóng                                  | `ESOCKET` + `errno ECONNREFUSED` + `syscall connect` | `connect ECONNREFUSED 127.0.0.1:64366`                                                        |
| DNS                                        | `EDNS` + `errno ENOTFOUND` + `syscall getaddrinfo`   | `getaddrinfo ENOTFOUND no-such-host.invalid`                                                  |

⇒ Trước WO, route test cho người giữ `configure-mail` **đọc dòng đầu banner của mọi dịch vụ TCP mà API với
tới** (phiên bản phần mềm, hostname/IP nội bộ), không cần mật khẩu đã lưu — SSRF đọc-một-dòng, nặng hơn «oracle
dò cổng» backlog ghi. nodemailer GHI ĐÈ mã gốc của Node (`DEPTH_ZERO_SELF_SIGNED_CERT`…) thành `ESOCKET` và
không giữ ở đâu (đo: không `cause`, không khoá thêm).

## 3. Bất biến (thứ bản vá phải giữ)

- **I1** — Mật khẩu ĐÃ LƯU chỉ bao giờ được gửi tới **đích của chính hàng chứa nó**. Đích = bộ bốn
  `(host, port, username, secure)`, so sánh **chính xác** (không chuẩn hoá hoa/thường/khoảng trắng — lệch thì
  bắt nhập lại mật khẩu: fail-closed). Hàng cũ có khoảng trắng (tạo qua API, Zod không trim) ⇒ FE gửi bản trim
  ⇒ bị đòi mật khẩu một lần rồi hàng được ghi lại bản trim — FE và server nhất quán, không khoá ai.
- **I2** — Bốn cột đích **chỉ được ghi cùng một envelope MỚI** (DELETE+INSERT với id + envelope mới). Nhánh
  «giữ envelope» về CẤU TRÚC không ghi được cột đích (code), và DB không cho **đường UPDATE** ghi chúng (mig
  0591). ⚠️ Phạm vi thật của lớp DB (FULL gate security + database): AAD của envelope chỉ gắn `companyId‖id`,
  KHÔNG gắn đích ⇒ một hồi quy kiểu `DELETE; INSERT {...hàng cũ, host mới}` (tái dùng id + chép envelope) lọt
  qua cả 0591 lẫn AAD. Code hiện tại không có đường đó (DELETE+INSERT luôn `randomUUID()` + envelope mới);
  gắn đích vào AAD = WO riêng `S19-SEC-MAILAADBIND-1` (owner chốt 02/10 — làm trước khi PROD có hàng SMTP đầu tiên).
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

| Điều kiện                                                                  | Câu                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `EAUTH` + `530`/`538`                                                      | Máy chủ yêu cầu kết nối mã hoá trước khi đăng nhập — bật «Dùng TLS» hoặc cổng STARTTLS.     |
| `EAUTH` (còn lại)                                                          | Xác thực SMTP thất bại                                                                      |
| `ETIMEDOUT` (code hoặc errno)                                              | Hết thời gian chờ máy chủ SMTP — kiểm tra máy chủ, cổng và tường lửa.                       |
| `EDNS` / `syscall=getaddrinfo`                                             | Không phân giải được tên máy chủ SMTP.                                                      |
| `errno=ECONNREFUSED`                                                       | Máy chủ từ chối kết nối — kiểm tra máy chủ và cổng.                                         |
| `errno` khác (ECONNRESET, EHOSTUNREACH…)                                   | Lỗi mạng khi kết nối tới máy chủ SMTP — kiểm tra mạng, máy chủ và cổng.                     |
| `ETLS` · CÓ `reason` · `ESOCKET` không `syscall` (lỗi socket thật luôn có) | Lỗi TLS/chứng chỉ — kiểm tra «Dùng TLS», cổng (465 TLS, 587 STARTTLS) và chứng chỉ máy chủ. |
| `responseCode` hợp lệ (200–599, số nguyên)                                 | Máy chủ SMTP từ chối (mã N).                                                                |
| `EPROTOCOL`                                                                | Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.                                  |
| còn lại                                                                    | Kiểm tra kết nối thất bại.                                                                  |

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

`REVOKE UPDATE (host, port, username, secure) ON public.company_mail_configs FROM mediaos_app` + khối VERIFY
fail-loud: không có UPDATE cấp bảng, và tập cột UPDATE được của `mediaos_app` (duyệt MỌI cột qua
`has_column_privilege` — tính cả grant cấp bảng/PUBLIC/role kế thừa) ĐÚNG BẰNG `{from_email, from_name,
updated_at}` (FULL gate database L4: ghim đúng tập, không chỉ 7 cột). Đo trước (grant-in-old-migration-is-not-current-state): PROD + lane có UPDATE
theo CỘT, KHÔNG UPDATE cấp bảng (relacl `mediaos_app=ard`) ⇒ REVOKE theo cột có hiệu lực thật. Journal idx 258.

## 5. Test — RED trước (đo đỏ trên code master, rồi mới vá)

**Int-spec MỚI `apps/api/test/integration/mail-config-credexfil-http.int-spec.ts`** (HTTP thật + DB lane +
nodemailer thật + 2 server SMTP giả L/E; "không một kết nối" đo bằng `connections` mới của helper):

| Ca  | Kịch bản                                                | Kỳ vọng                                                                                         |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | test vắng pw, port → E                                  | 400 mã mới; 0 kết nối tới E lẫn L                                                               |
| R2a | test vắng pw, username khác trên L                      | 400; L 0 kết nối (trước WO: L nhận AUTH `EVIL_USER`/`STORED`)                                   |
| R2b | hàng `secure:true`, test vắng pw HẠ `secure:false`      | 400; L 0 kết nối (trước WO: AUTH PLAIN mật khẩu đã lưu trên dây rõ)                             |
| R2c | hàng `secure:false`, body vắng `secure` (⇒ true)        | 400 (chỉ status/mã có nghĩa — TLS tới L hỏng trước AUTH cả trên master)                         |
| P1  | test vắng pw, đích khớp                                 | `{ok:true}`; L nhận AUTH `STORED`                                                               |
| R3  | PUT port → E vắng pw                                    | 400; hàng y nguyên; `InviteMailService` gửi tới L, E 0 kết nối                                  |
| P2  | PUT chỉ đổi from vắng pw                                | 200; id + envelope giữ                                                                          |
| P3  | PUT đích E + pw mới; test vắng pw tới E                 | 200/`{ok:true}`; E nhận pw MỚI, không bao giờ `STORED`                                          |
| R4  | `repo.upsert(envelope=null)` đích lệch (bỏ qua service) | ném `MailPasswordRequiredError`; hàng y nguyên; **0 audit mới** — đo thẳng vị từ + nhánh 0 hàng |
| R5  | test CÓ pw tới cổng banner SSH, qua HTTP                | câu giao thức cố định; body không chứa banner                                                   |
| D5a | `has_column_privilege` 7 cột                            | 4 cột đích `false`, `from_*`/`updated_at` `true`                                                |
| D5b | `UPDATE … SET port` bằng role app (`withTenant`)        | 42501 (đọc `cause` — drizzle bọc mã PG); hàng y nguyên                                          |

**Unit** `mail-transport.oracle.spec.ts` (MỚI — nodemailer thật qua dây tới server TCP thô: banner SSH/HTTP,
HELO 554 kèm hostname, AUTH echo, TLS lệch, cổng đóng). **Unit** `smtp-error-summary.spec.ts`: bảng §4.5 với
hình dạng lỗi đo thật (gồm timeout 8 s, DNS, cert tự ký, altname, 530/538 — các ca không chạy qua dây được),
responseCode lạ, thứ không phải Error. **Unit** `mail-config.service.spec.ts`: bảng 4 trường đích lệch (PUT +
test) ⇒ 400 + không decrypt/không transport/không ghi; LẬT 3 ca từng ghim lỗ (`smtp.x`), ca decrypt-fail giữ
là decrypt-fail (đích khớp). **`mail-config-envelope.int-spec.ts`** ca 3 ghim lỗ B ⇒ LẬT thành 3 (chỉ đổi from)

- 3a (đổi đích ⇒ 400, hàng y nguyên). **Console** `mail-config.spec.tsx`: 4 trường đích × Lưu, Kiểm tra, đổi
  đích + pw, chỉ đổi tên người gửi, lỗi server mã mới (lưu + test).

## 6. Điều tra lịch sử — đo PROD: KHÔNG có gì để điều tra

PROD (`mediaos`) **0 hàng** `company_mail_configs`, **0** sự kiện audit `mail_config` (đo bằng superuser
BYPASSRLS + đếm lại theo từng tenant qua GUC làm đối chứng — plan-review #5: FORCE RLS cho 0 hàng GIẢ nếu chạy
bằng role thường không set GUC). ⇒ chưa từng có mật khẩu SMTP nào để rò; không cần rotate. Câu SQL để dành nếu
một môi trường khác có dữ liệu. Chạy bằng superuser/BYPASSRLS trên kết nối **direct (KHÔNG qua PgBouncer)**;
nếu buộc dùng `mediaos_app` thì `BEGIN; SET LOCAL app.platform_audit_read = 'on'; …; COMMIT;` — **cấm** `SET`
cấp phiên: qua PgBouncer transaction-mode GUC dính lại trên server connection ⇒ request app sau đọc chéo tenant
`audit_logs`/`outbox_events` (FULL gate database M2). ĐỐI CHỨNG trước: `SELECT count(*) FROM audit_logs WHERE
object_type='mail_config'` phải ≥ số lần lưu đã biết. Công thức KHÔNG phụ thuộc thứ tự (`created_at` = giờ BẮT
ĐẦU tx, không phải thứ tự commit ⇒ `lag` có thể sót — database L2) — trả TẬP CHA, người duyệt lọc tay:

```sql
SELECT created_at, actor_user_id, object_id, after->>'scope' AS scope,
       before->>'host' AS b_host, after->>'host' AS a_host, before->>'port' AS b_port, after->>'port' AS a_port,
       before->>'username' AS b_user, after->>'username' AS a_user, before->>'secure' AS b_sec, after->>'secure' AS a_sec
FROM (SELECT a.*, count(*) OVER (PARTITION BY company_id, object_id) AS events_on_row
      FROM audit_logs a WHERE object_type = 'mail_config') t
WHERE action = 'MailConfigUpdated' AND events_on_row >= 2
  AND (before->>'host', before->>'port', before->>'username', before->>'secure')
      IS DISTINCT FROM (after->>'host', after->>'port', after->>'username', after->>'secure');
```

(Nhánh UPDATE giữ `id`; đổi mật khẩu là DELETE+INSERT ⇒ `id` mới. Một `object_id` có ≥ 2 sự kiện mà có sự kiện
đổi đích = ứng viên «đổi đích KHÔNG nhập mật khẩu»; dương tính giả = lần đổi mật khẩu hợp lệ mà hàng mới sau đó
được sửa from\_\*. Đường A không để dấu vết audit — chỉ log từ WO này.)

## 7. Ngoài phạm vi / nợ để lại

- Người giữ `configure-mail` đặt **mật khẩu + relay CỦA HỌ** thì mọi thư mời (token kích hoạt) đi qua relay
  đó — bản chất của quyền «cấu hình mail server», không phải rò secret đã lưu. Giảm thiểu thật = step-up /
  2 người duyệt khi đổi đích (WO riêng nếu owner muốn).
- `secure:false` không `requireTLS` ⇒ kẻ trên đường truyền bóc STARTTLS được ⇒ AUTH PLAIN rõ. Có từ CS-8; bật
  `requireTLS` phá relay/dev không TLS ⇒ quyết định riêng.
- Route test không ghi audit / không rate-limit (dò cổng — D3 chấp nhận). Từ chối chỉ để dấu ở log.
- Thua đua (PUT có mật khẩu chen giữa) ⇒ 400 «cần mật khẩu» cho người không đổi đích — chấp nhận, FE tải lại.
- Client khác FE vắng `secure` khi hàng `false` ⇒ 400 (ghi ở docblock contract).
- **Gắn đích vào AAD** ⇒ WO `S19-SEC-MAILAADBIND-1` (owner chốt làm riêng, sớm — xem I2).
- Từ chối chỉ để dấu ở **log ứng dụng** (không chống sửa, có hạn lưu) — ứng viên WO: ghi vào bảng append-only
  (`security_alerts`/`user_security_events`) — FULL gate security MEDIUM, chưa seed.
- `host` không validate hình dạng ở ranh giới (Zod `min(1).max(255)`) — log đã ASCII-hoá (ký tự ngoài ASCII in
  được ⇒ mã thoát u+XXXX) nên không giả dòng log bằng ký tự bidi; regex hostname/IP ở contract = đổi hợp đồng, để
  WO sau (security LOW).
- Nhánh giải mã thất bại thượng nguồn (`secret-encryption.service.ts`) gom mọi nguyên nhân thành `decrypt failed`
  — có từ trước (silent-failure L-4), WO riêng nếu cần phân biệt tamper/mất KEK.
- Hai PUT kèm mật khẩu đồng thời ⇒ bên thua 23505 trên `(company_id, scope)` ⇒ 500 — có từ trước CS-8 (database).

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
--frozen-lockfile` theo `S19-OPS-AUDITHIGH-1` §7.2 nếu chưa làm. **Rollback: GIỮ 0591** (FULL gate database M1) — code cũ trên DB đã áp 0591
   chỉ hỏng PUT vắng password (42501 ⇒ 500, fail-closed); PUT kèm mật khẩu vẫn chạy. KHÔNG `GRANT` lại: drizzle
   đã ghi 0591 là đã áp nên roll-forward sẽ KHÔNG chạy lại nó ⇒ PROD mất hẳn lớp DB mà không tín hiệu. Bất đắc dĩ
   phải GRANT thì roll-forward phải chạy TAY lại `REVOKE` + khối VERIFY của 0591.

## 10. Kết quả đo (02/10/2026, worktree `C:\dev 2\MediaOS-mailcred`, lane `mediaos_mailcred`)

**RED trên code master (trước vá):** int-spec mới 6 đỏ / 3 xanh dương (R1 nhận `201 {ok:true}` TỪ E ⇒ mật
khẩu đã lưu thật sự AUTH tới đó) · oracle qua dây 5 đỏ (lộ banner/hostname/OpenSSL/ip:cổng) + 1 xanh (AUTH đã
có câu chung) · unit service 12 đỏ · console 7 đỏ · envelope ca 3a 1 đỏ.

**GREEN:** unit settings + user-invites 74/74 (6 file) · int mail-config 3 file 34/34 · console 16/16.

**Mutant** (sao lưu → cấy → chạy → `cp` khôi phục, đối chiếu nội dung = OK cả 6):

| #   | Cấy                                                            | Đỏ                                                                                                          |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M1  | bỏ so đích ở `testConnection`                                  | 8: 4 unit + R1/R2a/R2c `expected 201 to be 400`; R2b `201` với câu TLS — gửi tới đích HÀNG nên vẫn không rò |
| M2  | bỏ so sớm ở `upsert`                                           | 5 unit; **R3 + envelope 3a vẫn XANH** — vị từ repo + 0591 chặn độc lập (đúng thiết kế nhiều lớp)            |
| M3  | bỏ vị từ đích trong UPDATE của repo                            | R4 `promise resolved … instead of rejecting`                                                                |
| M4  | `errorMessage` = `err.message`                                 | 6 oracle qua dây + R5 HTTP (lộ banner/hostname/OpenSSL/ip:cổng/username)                                    |
| M5  | FE bỏ `destinationChanged`                                     | 5 console (4 Lưu `spy called 1 times` + Kiểm tra `Unable to find role="alert"`)                             |
| M6  | DB cấp lại `UPDATE (host,port,username,secure)` (≈ thiếu 0591) | D5a `{host:true,…}` ≠ kỳ vọng · D5b `UPDATE cột đích phải bị DB từ chối`; đã REVOKE lại                     |

## 11. plan-review lượt 1 (Opus) — BLOCK → đã vá

| #    | Finding                                                                              | Xử lý                                                                    |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| B1   | Bước so sớm trong tx làm vị từ UPDATE bất khả đạt; 0 hàng ⇒ 500; M3 sẽ sống          | Bỏ so trong tx; `if (!row) throw`; R4 đo vị từ + 0 audit; M3 đo ĐỎ       |
| B2   | R5 dùng `echo` của helper không đỏ được trên master                                  | Oracle đo bằng server TCP thô (unit qua dây + R5 HTTP) — đỏ trên master  |
| H    | Mô tả M1 sai (gửi tới đích hàng ⇒ L, không E)                                        | Ghi lại M1 theo đỏ thật (§10)                                            |
| H    | 3 ca unit ghim lỗ (không phải 2); `mail-transport.service.spec.ts` import hàm bị xoá | Lật đủ 3, decrypt-fail giữ nhánh; spec transport sửa                     |
| H    | SQL §6 có thể 0 hàng giả vì FORCE RLS                                                | Đo PROD bằng superuser + đối chứng theo tenant; ghi role/GUC + đối chứng |
| H/D5 | Ép I2 ở DB                                                                           | mig 0591 + D5a/D5b + M6                                                  |
| M    | Hai ca `secure` của R2 xanh-rỗng phía L                                              | R2b hạ cấp true→false (có nghĩa); R2c chỉ status/mã, ghi lý do           |
| M    | DNS/cert/530 chưa đo                                                                 | Đo (§2), thêm dòng bảng §4.5                                             |
| M    | Từ chối không để dấu vết                                                             | `logger.warn` có cấu trúc; decrypt-fail cũng log                         |
| M    | Đua ⇒ 400 gây hiểu lầm                                                               | Ghi §7; FE invalidate query                                              |
| L    | `this.name`; `handleTest` nuốt lỗi; `connections` cho "không một kết nối"            | Đã làm cả ba                                                             |

Không chạy plan-review lượt 2: thiết kế được lượt 1 xác nhận đúng hướng, mọi finding về test; FULL gate đọc
code + test thật ngay sau.

## 12. FULL gate (Opus, 02/10/2026 trên `0e6dd3dc`) — 3/3 PASS, 0 CRITICAL/HIGH → vá

| Nguồn                    | Finding                                                                                     | Xử lý                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| security M + database M3 | Lời khai lớp DB nói quá: AAD không gắn đích ⇒ DELETE+INSERT tái dùng id + chép envelope lọt | Sửa câu chữ (0591 · repo · `mail-destination.ts` · plan I2); gắn đích vào AAD = WO `S19-SEC-MAILAADBIND-1` (owner) |
| security M               | Từ chối chỉ ở log ứng dụng                                                                  | Ghi nợ §7 (ứng viên WO bảng append-only)                                                                           |
| security L               | `host` vào log có thể mang ký tự bidi / U+2028                                              | `logSafe`: `JSON.stringify` + ký tự ngoài ASCII in được ⇒ mã thoát; test + mutant M10                              |
| silent-failure M-1       | Lỗi lập trình ở route test gom thành câu chung, log không stack                             | `isProgrammerError` ⇒ `logger.error` + frame, câu "Lỗi nội bộ…"; test + M11                                        |
| silent-failure M-2       | Log từ chối (dấu vết duy nhất) chưa test nào ghim                                           | 5 ca spy `logger.warn` (nội dung · ASCII · decrypt-fail · thua đua); M7 gỡ log ⇒ 3 đỏ                              |
| silent-failure L-1       | 0 hàng luôn báo "đã đổi đích" kể cả khi hàng bị thay mà giữ đích                            | Câu + log đúng cho cả hai khả năng (`storedRowChanged`)                                                            |
| silent-failure L-2       | Không ca nào chứng minh lỗi không-thuộc-miền được ném nguyên                                | Ca "DB sập ⇒ ném nguyên"; M9 (map mọi lỗi thành 400) ⇒ đỏ                                                          |
| silent-failure L-3       | FE gom mọi lỗi request vào câu trùng câu SMTP; nhánh test không tải lại đích                | `testRequestFailed` riêng + `onPasswordRequired` ⇒ invalidate; M12/M13 ⇒ đỏ                                        |
| silent-failure L-5       | Cổng trống ⇒ NaN ⇒ báo nhầm "đã đổi đích"                                                   | Validate schema TRƯỚC (Lưu + Kiểm tra); M8 ⇒ đỏ                                                                    |
| silent-failure L-4       | `decryptSecret` thượng nguồn gom mọi nguyên nhân                                            | Có từ trước — nợ §7                                                                                                |
| database M1              | Rollback bằng GRANT tắt lớp DB, roll-forward không áp lại 0591                              | Rollback GIỮ 0591 (header 0591 + §9)                                                                               |
| database M2              | Runbook §6 `SET` cấp phiên qua PgBouncer rò GUC đọc chéo tenant                             | Direct + `SET LOCAL` trong tx (§6)                                                                                 |
| database L2              | `lag` theo `created_at` có thể sót                                                          | Công thức không phụ thuộc thứ tự (§6)                                                                              |
| database L3              | R4 thiếu đối chứng dương                                                                    | `auditBefore > 0`                                                                                                  |
| database L4/L5           | VERIFY/D5a chỉ ghim 7 cột; RAISE không theo tiền lệ                                         | Ghim ĐÚNG tập cột (duyệt mọi cột) + không UPDATE cấp bảng + `public.` + RAISE ASCII `[0591]`; lane `--reset`       |
| (check --all)            | Ratchet `S16-TEST-PIPELINE-PARITY-1` 270 ≠ 269 — int-spec mới tự dựng pipeline              | `applyMainPipeline` + `listen(0)`                                                                                  |
| (check --all, có sẵn)    | `s16-social-db1-invariants` census wildcard — fixture `ki074-w-view-star-*` để sót          | KHÔNG do WO này (memory s19-ops-audithigh1) — ghi PR                                                               |

**Mutant cho phần vá** (cùng quy trình §10, khôi phục OK cả 7): M7 gỡ log từ chối ⇒ 3 đỏ · M9 map mọi lỗi repo
thành 400 ⇒ 1 đỏ · M10 bỏ `logSafe` ⇒ 1 đỏ · M11 bỏ nhánh lỗi lập trình ⇒ 2 đỏ · M8 FE xét mật khẩu trước
validate ⇒ 1 đỏ · M12 bỏ `onPasswordRequired` ⇒ 1 đỏ · M13 câu request = câu SMTP ⇒ 1 đỏ. **VERIFY 0591** chạy
riêng: quyền đúng ⇒ không RAISE; `GRANT` lại cột đích ⇒ RAISE `[0591] mediaos_app UPDATE columns … =
{from_email,from_name,host,port,secure,updated_at,username}` + D5a/D5b đỏ; REVOKE lại ⇒ sạch.

**Re-gate:** owner chọn 1 reviewer (security, Opus) trên delta vá. Chi phí: hook báo ~$256 sau FULL gate (ước
lượng trước đó của tôi sai) — owner chọn tiếp tục với re-gate gọn.
