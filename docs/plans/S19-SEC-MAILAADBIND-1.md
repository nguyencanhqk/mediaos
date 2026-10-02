# S19-SEC-MAILAADBIND-1 — Gắn ĐÍCH SMTP vào ngữ cảnh mã hoá của envelope mật khẩu

> Zone 🔴 **red** — secret/crypto (bất biến #3). Nối tiếp `S19-SEC-MAILCREDEXFIL-1` (PR #560, CHƯA merge):
> nhánh `fix/s19-sec-mailaadbind-1` dựng trên `fix/s19-sec-mailcredexfil-1` (`9155e3be`); PR chỉ mở sau khi #560
> merge (`git rebase --onto master`). Plan-reviewer trước khi code · deny-path RED trước · FULL gate (security +
> silent-failure) TRƯỚC khi mở PR · owner merge. **Không migration · không đổi route · không đổi contract/DTO.**
> Đo 02/10/2026 trên worktree `C:\dev 2\MediaOS-mailaad`, lane `mediaos_mailaad`.

## 1. Bối cảnh — đọc code hiện tại (base `9155e3be`)

Bất biến **I2** của MAILCREDEXFIL («4 cột đích chỉ được ghi cùng một envelope MỚI») hôm nay chỉ được ép bằng
**code + quyền DB**, không bằng mật mã:

| Chỗ                                                                                  | Hiện tại                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crypto/secret-encryption.service.ts:24-26`                                          | `buildAad(companyId, recordId, encAlgo, dekKeyVersion)` = `companyId‖0x00‖recordId‖0x00‖encAlgo‖0x00‖version`. `purpose` KHÔNG vào AAD (chỉ chọn KEK ở `wrapDek` — `local-kek.provider.ts:45-47`).                                 |
| `settings/mail-config.service.ts:113-121`                                            | PUT có password: `recordId = randomUUID()`, `encryptSecret(pw, { companyId, recordId, purpose })` ⇒ AAD gắn **id**, KHÔNG gắn đích.                                                                                                |
| `settings/mail-config.service.ts:174-187`                                            | `testConnection` vắng password: `decryptSecret(existing, { companyId: existing.companyId, recordId: existing.id, … })`; lỗi ⇒ `warn` (có `config=<id>`) + `{ok:false, errorMessage:"Không giải mã được mật khẩu đã lưu."}`.        |
| `user-invites/invite-mail.service.ts:74-88`                                          | Gửi lời mời: `decryptSecret(config, { companyId: config.companyId, recordId: config.id, … })`; lỗi ⇒ `warn` (CHỈ companyId, KHÔNG config id) + `{sent:false, reason:'decrypt_failed'}`; SMTP tới `config.host/port/…` (`:92-100`). |
| `settings/mail-config.repository.ts:70-88`, `0591:11-15`, `mail-destination.ts:9-11` | Docblock tự khai giới hạn: AAD không gắn đích ⇒ một đường ghi `DELETE; INSERT {...hàng cũ, đích mới}` tái dùng id + chép envelope lọt qua cả 0591 lẫn AAD — «đừng viết đường đó».                                                  |
| `db/schema/mail-config.ts:28`                                                        | Docblock: «AAD = companyId‖id (recordId=id)» — sẽ SAI sau WO (ngoài `paths` — D5).                                                                                                                                                 |

Hệ quả (đo §2 M2/M3): ai sửa được cột đích của hàng mà **không** cần mã hoá lại — superuser/DBA, một migration
lỗi, hoặc một đường ghi mới `DELETE+INSERT` của chính `mediaos_app` (0591 không chặn INSERT/DELETE) — là dắt
được mật khẩu hộp thư công ty tới server tuỳ ý qua route test hoặc lời mời kế tiếp. WO này đổi I2 thành
**mật mã học**: đích là một phần của ngữ cảnh mã hoá ⇒ đổi đích mà không mã hoá lại ⇒ GCM từ chối ⇒ không có
mật khẩu nào để gửi đi.

## 2. Phép đo (02/10/2026)

Probe: `scratchpad/probes/mailaad/n-json-context.cjs` (Node 24.15, không DB) và
`scratchpad/probes/mailaad/test/integration/probe-mailaad.int-spec.ts` (chép TẠM vào `apps/api/test/integration/`
vì Vite không nạp spec ngoài root — đo `--dir` ⇒ `Failed to load url`; chạy xong xoá ngay, `git status` sạch).
Chạy bằng `run-lane-vitest.sh … mailaad`, kết quả `7 passed`, 901 ms (không treo).

| #   | Khẳng định                                                                                                                 | Đo bằng                                                                                                                             | Kết quả quan sát                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | AAD hôm nay không gắn đích                                                                                                 | Đọc `secret-encryption.service.ts:24-26,47,67` + M2                                                                                 | AAD chỉ từ `companyId/recordId/encAlgo/dekKeyVersion`; mọi call-site SMTP truyền `recordId = id`.                                                                                                                                                     |
| M2  | Superuser `UPDATE port → E` giữ envelope ⇒ mật khẩu đã lưu tới E                                                           | Probe P2 (2 server SMTP giả L/E, `MailConfigService` + `InviteMailService` thật, KEK thật)                                          | `testConnection` vắng pw (đích E) ⇒ `{ok:true}`, E nhận AUTH bằng STORED; lời mời ⇒ `{sent:true}`; tổng 2 AUTH STORED tới E; L 0 kết nối.                                                                                                             |
| M3  | Role APP (`withTenant`) `DELETE`+`INSERT` tái dùng id + chép envelope, port → E — 0591 KHÔNG chặn                          | Probe P3                                                                                                                            | Không lỗi quyền; id giữ nguyên; port = E; lời mời `{sent:true}`, E nhận 1 AUTH STORED.                                                                                                                                                                |
| M4  | Ngữ cảnh ứng viên `JSON.stringify([id, host, port, username, secure])` chặn đúng                                           | Probe P4 (`SecretEncryptionService` thật)                                                                                           | khớp ⇒ OK; đổi host / port / username / secure / id ⇒ `decrypt failed`; port dạng chuỗi `"2525"` ⇒ failed; **envelope cũ (ctx=id) mở bằng ctx mới ⇒ failed**; envelope mới mở bằng ctx cũ ⇒ failed; envelope cũ + ctx cũ ⇒ OK.                        |
| M5  | `JSON.stringify` không bao giờ đưa byte NUL/điều khiển thô vào `recordId` ⇒ `buildAad` (phân cách NUL) không tái phân đoạn | Probe N1: duyệt đủ 65 536 code unit trong host + username                                                                           | 0 ký tự điều khiển thô; surrogate lẻ được thoát 2048/2048; host chứa `\u0000` ⇒ UTF-8 không có byte 0x00.                                                                                                                                             |
| M6  | Ký tự phân cách tự chọn va chạm được (host không validate); JSON thì không                                                 | Probe N2                                                                                                                            | `join("\|")`: `("evil.test\|25\|victim", 26, "x")` ≡ `("evil.test", 25, "victim\|26\|x")` ⇒ **true**; JSON ⇒ false; chèn `","` vào host/username ⇒ JSON không va chạm.                                                                                |
| M7  | Kiểu có nghĩa trong ngữ cảnh; driver trả đúng kiểu                                                                         | Probe N3 + P1 (`repo.findByScope`)                                                                                                  | `25` ≠ `"25"`, `true` ≠ `"true"`; drizzle trả `port: number`, `secure: boolean`, `updatedAt: Date`.                                                                                                                                                   |
| M8  | So CHÍNH XÁC, không chuẩn hoá Unicode (khớp I1 của MAILCREDEXFIL)                                                          | Probe N5                                                                                                                            | `café` NFC ≠ NFD ⇒ ngữ cảnh khác (đúng chủ ý — lệch ⇒ fail-closed).                                                                                                                                                                                   |
| M9  | Giải mã thất bại hôm nay lộ ra thế nào                                                                                     | Probe P5 (`auth_tag` hỏng bằng superuser)                                                                                           | Lời mời `{sent:false, reason:'decrypt_failed'}` + `warn "Giải mã mật khẩu SMTP của <company> thất bại…"` (**không config id**); test `{ok:false, errorMessage:"Không giải mã được mật khẩu đã lưu."}` + `warn … config=<id>`; L 0 kết nối.            |
| M10 | Admin thấy gì khi lời mời không gửi được                                                                                   | Đọc `user-invites.service.ts:121-134`; `console/…/vi/invites.json:52`, `users.json:82`; `settings/mail-config.tsx:383-391`          | Route mời chỉ trả `emailSent:false` (lý do chỉ ở log); console hiện «… KHÔNG gửi được email — kiểm tra cấu hình mail server (SMTP)»; màn mail-config in `errorMessage` của route test NGUYÊN VĂN.                                                     |
| M11 | Giá trị gửi lên có thể KHÁC giá trị PG lưu (ảnh hưởng ngữ cảnh dựng lúc encrypt vs lúc đọc)                                | Probe P6 + `node -e JSON.parse('"a\\ud800b"')`                                                                                      | Host có surrogate lẻ ⇒ PG lưu `U+FFFD` (`storedEqualsSent:false`); body JSON `"\ud800"` ⇒ `JSON.parse` ra surrogate lẻ thật (đi được qua HTTP, Zod chỉ `min/max`). Host có NUL ⇒ `22021` (500 — có từ trước). Khoảng trắng cuối giữ nguyên.           |
| M12 | Không lồng `withTenant`                                                                                                    | Đọc `mail-config.service.ts:116-131,169-176`, `invite-mail.service.ts:66-77`, `local-kek.provider.ts:45-101`; probe chạy hết 901 ms | encrypt chạy TRƯỚC `repo.upsert` (tx riêng); decrypt chạy SAU khi `findByScope` đã đóng tx; `unwrapDek` không chạm DB; `wrapDek→currentKey` dùng `db.execute` toàn cục (registry, không `withTenant`). Helper mới là hàm thuần.                       |
| M13 | Tách miền với envelope purpose khác                                                                                        | Đọc `two-factor.service.ts:176-180`, `auth.service.ts:1644-1648` + probe N4                                                         | TOTP/reset dùng `recordId = userId` (UUID trần); ngữ cảnh SMTP mới luôn bắt đầu bằng `[` ⇒ không bao giờ trùng.                                                                                                                                       |
| M14 | Xoay KEK không đụng envelope SMTP                                                                                          | Đọc `secret-rotation.service.ts:57-61`                                                                                              | `reWrapAll` ném với mọi purpose ≠ `platform_account` ⇒ đổi ngữ cảnh SMTP không phải đồng bộ với job xoay khoá.                                                                                                                                        |
| M15 | Tập call-site                                                                                                              | `grep encryptSecret\|decryptSecret\|MailConfigRepository` trong `apps/api/src` + `test/`                                            | encrypt SMTP: 1 (`mail-config.service.ts:117`); decrypt SMTP: 2 (`mail-config.service.ts:176`, `invite-mail.service.ts:77`) + 1 trong test (`mail-config-envelope.int-spec.ts:145`). `mediaos_worker` có SELECT (`0380:71`) nhưng không code nào đọc. |
| M16 | Lane sạch                                                                                                                  | Probe P0 (superuser direct)                                                                                                         | `mediaos_mailaad`: 0 hàng `company_mail_configs`; role direct `mediaos` (`rolsuper=true`).                                                                                                                                                            |
| M17 | Baseline xanh                                                                                                              | Runner: `src/settings src/user-invites test/integration/mail-config-envelope… mail-config-credexfil-http…`                          | `Test Files 10 passed (10)` · `Tests 128 passed (128)`.                                                                                                                                                                                               |
| M18 | Dạng ĐỎ khi spec gọi helper chưa tồn tại                                                                                   | Spec tạm `src/settings/zz-probe-missing-export.spec.ts` (xoá ngay)                                                                  | `TypeError: smtpSecretContext is not a function` · `Test Files 1 failed` · `Tests 1 failed` (đếm là test đỏ, không phải file không nạp được).                                                                                                         |
| M19 | 400 không mã module ra mã gì                                                                                               | Đọc `common/errors/error-codes.ts:18,33-45` + `all-exceptions.filter.ts:100-103`                                                    | `httpStatusToCode(400)` ⇒ `VALIDATION-ERR-001`.                                                                                                                                                                                                       |
| M20 | Số hàng PROD                                                                                                               | **KHÔNG đo lại** (luật phiên: không trỏ gì vào DB `mediaos`/`mediaos_dev`). Số liệu MAILCREDEXFIL §1/§6, 02/10                      | PROD `mediaos`: 0 hàng (superuser BYPASSRLS + đối chứng theo tenant). dev-online / `mediaos_dev`: **chưa biết** — người deploy đo (§8 bước 6).                                                                                                        |

## 3. Bất biến

- **B1 (mới — I2 thành mật mã)** — Envelope mật khẩu SMTP mở được **khi và chỉ khi** bộ năm
  `(id, host, port, username, secure)` của hàng đang đọc GIỐNG HỆT bộ năm lúc mã hoá (cùng `companyId`,
  `encAlgo`, `dekKeyVersion` như trước). So chính xác theo giá trị + kiểu (M7, M8).
- **B2** — MỘT helper duy nhất dựng ngữ cảnh SMTP; mọi encrypt và MỌI decrypt SMTP đi qua nó (grep-able:
  không còn `purpose: SMTP_SECRET_PURPOSE` nào ngoài helper).
- **B3** — Giải mã thất bại KHÔNG mở kết nối SMTP nào (không transporter), và KHÔNG im lặng: log có company +
  config id, route test trả câu cố định, lời mời trả `{sent:false, reason:'decrypt_failed'}` ⇒ `emailSent:false`.
- **B4** — Giá trị gắn vào ngữ cảnh lúc encrypt = giá trị PG thật sự lưu (M11; D4).
- Giữ nguyên: I1/I3 của MAILCREDEXFIL (so đích trước decrypt; transport tới đích của HÀNG; `errorMessage` từ
  trường máy-sinh) · `company_id` + RLS FORCE + `withTenant` (không đổi truy vấn) · không lồng `withTenant`
  (M12) · append-only audit (không đổi audit; KHÔNG ghi ngữ cảnh/secret vào audit/log) · DTO không có
  password/envelope · 0591 giữ nguyên (lớp DB và lớp mật mã độc lập).
- KHÔNG đổi `buildAad` / `SecretEncryptionService` (dùng chung TOTP/reset/platform_account) — chỉ đổi
  **giá trị `recordId`** mà phía SMTP truyền vào.

## 4. Thiết kế

### 4.1 `apps/api/src/settings/mail-destination.ts` — helper (sửa)

```ts
/** Ngữ cảnh mã hoá envelope mật khẩu SMTP — MỘT nơi duy nhất (S19-SEC-MAILAADBIND-1). */
export function smtpSecretContext(
  companyId: string,
  recordId: string,
  destination: MailDestination,
): EncryptCtx {
  const d = destinationOf(destination); // bóc đúng 4 trường, thứ tự do helper quyết
  return {
    companyId,
    recordId: JSON.stringify([recordId, d.host, d.port, d.username, d.secure]),
    purpose: SMTP_SECRET_PURPOSE,
  };
}
```

- `JSON.stringify` mảng — KHÔNG ký tự phân cách tự chọn (M6), không NUL thô (M5), kiểu có nghĩa (M7).
- Giữ `recordId` (id hàng) là phần tử đầu: chép envelope sang hàng khác cùng đích vẫn hỏng (R-B6).
- Không gắn `scope`/`from_*`/`updated_at`: không phải đích của mật khẩu; gắn vào thì PUT «chỉ đổi người gửi»
  (giữ envelope — P2 của MAILCREDEXFIL) sẽ tự làm hỏng cấu hình (P-B1 ghim điều này).
- Docblock module: thay đoạn «⚠️ Lớp DB chỉ chặn ĐƯỜNG UPDATE… gắn đích vào AAD = WO …» bằng mô tả lớp mật mã.
- Import `EncryptCtx` (type) từ `../crypto/secret-encryption.types` + `SMTP_SECRET_PURPOSE` từ contracts.

### 4.2 Ba call-site dùng helper

| File                             | Đổi                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mail-config.service.ts:117-121` | `encryptSecret(dto.password, smtpSecretContext(companyId, recordId, fields))` — `fields` chính là object repo INSERT.                                                                            |
| `mail-config.service.ts:176-180` | `decryptSecret(existing, smtpSecretContext(existing.companyId, existing.id, existing))` — từ HÀNG, không từ dto. Câu lỗi theo D2. Docblock `upsert`/`testConnection` cập nhật.                   |
| `invite-mail.service.ts:77-81`   | `decryptSecret(config, smtpSecretContext(config.companyId, config.id, config))`; log lỗi thêm `config=<id>` (M9: hiện thiếu) và mức theo D3. Bỏ import `SMTP_SECRET_PURPOSE` nếu không còn dùng. |

`mail-config-envelope.int-spec.ts:145-149` (ca 3b) đổi sang helper — đây là một decrypt-site (trong test).

### 4.3 Repo — B4: «đích lưu = đích đã gắn» (theo D4, khuyến nghị)

`mail-config.repository.ts`, cả hai nhánh INSERT (mới + DELETE+INSERT): sau `.returning()`,
`if (!sameDestination(destinationOf(row), fields)) throw new MailDestinationNotPersistedError()` ⇒ tx rollback
(chưa ghi audit vì audit ở sau). Lỗi miền mới trong `mail-destination.ts` (tự gán `this.name`, như
`MailPasswordRequiredError`). Service bắt ⇒ `BadRequestException("Máy chủ hoặc tên đăng nhập SMTP chứa ký tự
không hợp lệ.")` ⇒ `VALIDATION-ERR-001` (M19 — không thêm mã catalog). Chỉ so trong JS, không thêm truy vấn.
Docblock repo (`:70-88`): bỏ câu «AAD không gắn đích ⇒ ĐỪNG viết DELETE+INSERT tái dùng id», thay bằng: tái dùng
id + chép envelope sang đích khác ⇒ giải mã hỏng (B1).

### 4.4 Docblock khác

`crypto/secret-encryption.types.ts:35-40` (`EncryptCtx`): một dòng — với `smtp_password`, `recordId` là bộ năm
JSON dựng bởi `smtpSecretContext`, không phải id trần. `db/schema/mail-config.ts:28` theo D5. **KHÔNG sửa
0591** (migration đã áp ở lane, sẽ áp ở PROD qua #560; câu «gắn đích vào AAD = WO S19-SEC-MAILAADBIND-1» vẫn
đúng như con trỏ).

## 5. Test — RED trước (đo đỏ trên base `9155e3be`, rồi mới vá)

### 5.1 Int-spec — mở rộng `test/integration/mail-config-credexfil-http.int-spec.ts` (mục mới «(E) AAD»)

Lý do mở rộng thay vì file mới: dùng lại L/E, admin + token, `putStored` ở `beforeEach` (mỗi ca có hàng mới
gắn L + STORED), `connectionsDuring`, `storedRow`; không dựng AppModule lần hai ⇒ không chạm ratchet
`S16-TEST-PIPELINE-PARITY-1` / census listen(0). File 449 → ~630 dòng (< 800). Sửa đích bằng `direct`
(superuser `mediaos`, M16) — bỏ qua 0591 có chủ ý: đây là kẻ ghi «ngoài app». `DECRYPT_MSG` ghim LITERAL theo D2.

| Ca                     | Kịch bản                                                                                                                                                | Kỳ vọng (sau vá)                                                                                                   | Đỏ trên base (đo/suy từ đo)                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-B1 (×4, `it.each`)   | superuser `UPDATE` MỘT trường đích: port→E · username→`EVIL_USER` · secure→true · host→`localhost`; rồi `POST /test` vắng pw với đúng đích MỚI của hàng | 201 `{ok:false, errorMessage: DECRYPT_MSG}`; `toL === 0 && toE === 0`; `L.auths`/`E.auths` rỗng                    | port: `{ok:true}`, E nhận AUTH STORED (M2) ⇒ `expected { ok: true } to deeply equal {…}`. username: L nhận AUTH (EVIL_USER, STORED). secure: TLS tới L ⇒ `toL 1 ≠ 0` + câu TLS ≠ DECRYPT_MSG. host: kết nối L hoặc từ chối — mọi nhánh ≠ kỳ vọng. |
| R-B2 (×4, cùng bảng)   | cùng sửa đích ⇒ `InviteMailService.sendActivationEmail`                                                                                                 | `{sent:false, reason:'decrypt_failed'}`; 0 kết nối L/E                                                             | port: `expected { sent: true } to deeply equal { sent: false, reason: 'decrypt_failed' }` (M2).                                                                                                                                                   |
| R-B4                   | role APP qua `withTenant`: `DELETE` + `INSERT` tái dùng id + chép 7 cột envelope, port→E (đúng hồi quy WO nêu; 0591 không chặn — M3)                    | lời mời `decrypt_failed`, E 0 kết nối; `POST /test` vắng pw (đích E) ⇒ `{ok:false, DECRYPT_MSG}`                   | `{sent:true}`, E nhận AUTH STORED (M3).                                                                                                                                                                                                           |
| R-B6 (khoá hồi quy)    | role APP `DELETE`+`INSERT` id MỚI, CÙNG đích, chép envelope                                                                                             | lời mời `decrypt_failed`                                                                                           | XANH trên base (id đã gắn) — có chủ ý: giết mutant M5 (bỏ id khỏi helper).                                                                                                                                                                        |
| P-B1 (đối chứng dương) | superuser `UPDATE` CHỈ `from_name/from_email/updated_at`                                                                                                | lời mời `{sent:true}`, L nhận AUTH STORED; `POST /test` vắng pw ⇒ `{ok:true}`                                      | XANH cả base — chứng minh không gắn quá tay (mutant M10).                                                                                                                                                                                         |
| R-B5 (D4)              | `PUT` có password, host `a\ud800b.test` (rồi username tương tự)                                                                                         | 400 `VALIDATION-ERR-001`; hàng y nguyên (id, host L, envelope); số audit `mail_config` không đổi (đối chứng `> 0`) | 200; hàng lưu `a\uFFFDb.test` (M11) ⇒ `expected 200 to be 400`.                                                                                                                                                                                   |
| P1 · R3 · P3 (có sẵn)  | không sửa                                                                                                                                               | vẫn xanh                                                                                                           | — đối chứng dương encrypt↔decrypt CÙNG ngữ cảnh (giết M6–M8).                                                                                                                                                                                     |

### 5.2 Unit

- **MỚI `src/settings/mail-destination.spec.ts`** (`smtpSecretContext`): mẫu ⇒ `recordId` LITERAL
  `'["<id>","smtp.example.test",587,"mailer@example.test",false]'` + `purpose:'smtp_password'` + `companyId`
  chuyển nguyên; từng trường trong 5 đổi ⇒ `recordId` khác; cặp va chạm của `join("|")` (M6) và cặp chèn `","`
  ⇒ khác nhau; host chứa `\u0000`/`\n` ⇒ `recordId` không có ký tự điều khiển thô; nguồn là HÀNG đủ cột (envelope,
  from\_\*) ⇒ bằng nguồn chỉ có 4 trường; bắt đầu bằng `[`. RED trên base: `TypeError` «smtpSecretContext is
  not a function» (M18).
- **`mail-config.service.spec.ts`**: ca «CÓ password» thêm assert ngữ cảnh của `encryptSecret` (arg 2) bằng
  `{ companyId, recordId, purpose }` với `recordId` = `JSON.stringify([id, "smtp.x", 465, "u", true])` và `id` =
  arg 2 của `repo.upsert` (dựng LITERAL, không gọi helper — tránh tautology). RED: `expected '<uuid>' to …`. Ca test
  vắng pw khớp: `decryptSecret` ctx = bộ năm của `row()`. Ca decrypt-fail: câu D2. Ca mới: repo ném
  `MailDestinationNotPersistedError` ⇒ 400 không có `code` module; lỗi khác vẫn ném nguyên (giữ ca «DB sập»).
- **`user-invites/invite-mail.smtp.spec.ts`**: ca gửi thật thêm assert ctx của `decryptSecret` = bộ năm của
  `mailConfigRow(port)` (RED: `recordId: '00000000-…aa'`). Ca MỚI: `decryptSecret` reject ⇒
  `{sent:false, reason:'decrypt_failed'}`, `server.connections === 0`, log chứa `config=00000000-…aa` ở mức D3
  (RED: log hiện không có config id — M9).

### 5.3 Mutant (sau GREEN; sao lưu → cấy → chạy → `cp` khôi phục, đối chiếu nội dung)

| #   | Cấy                                                        | Phải đỏ                                                       |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| M1  | helper bỏ `host`                                           | R-B1/R-B2 hàng host + unit «từng trường»                      |
| M2  | helper bỏ `port`                                           | R-B1/R-B2 hàng port + R-B4 + unit                             |
| M3  | helper bỏ `username`                                       | R-B1 hàng username (L nhận AUTH EVIL_USER/STORED) + unit      |
| M4  | helper bỏ `secure`                                         | R-B1/R-B2 hàng secure + unit                                  |
| M5  | helper bỏ `id`                                             | R-B6 + unit                                                   |
| M6  | `InviteMailService` giữ ctx cũ (`recordId: config.id`)     | R3 có sẵn (`{sent:false…}` ≠ `{sent:true}`) + unit invite ctx |
| M7  | `testConnection` giữ ctx cũ                                | P1 có sẵn + unit service                                      |
| M8  | PUT encrypt giữ ctx cũ                                     | P1 · R3 · P3 có sẵn + unit service                            |
| M9  | helper dùng `.join("\|")`                                  | unit cặp va chạm                                              |
| M10 | helper gắn thêm `fromEmail`                                | P-B1                                                          |
| M11 | bỏ kiểm B4 ở repo (D4)                                     | R-B5                                                          |
| M12 | log decrypt-fail của lời mời bỏ config id / về `warn` (D3) | unit invite ca mới                                            |

Mutant tương đương (ghi, không cấy): `testConnection` dựng ctx từ dto thay vì hàng — sau `assertStoredDestination`
hai bên bằng nhau trừ ca surrogate lẻ (đã chặn ở B4).

## 6. Quyết định owner

- **D1 — Envelope ĐÃ CÓ mã hoá bằng ngữ cảnh cũ (`recordId = id`). ⛔ CHẶN thi công.** Đo M4: ngữ cảnh mới mở
  envelope cũ ⇒ thất bại. Hiện: PROD 0 hàng (M20, 02/10); lane 0 (M16); dev-online chưa đo.
  - (a) **Fail-closed** + câu rõ «nhập lại mật khẩu» (D2) + log (D3); cửa deploy «PROD phải 0 hàng, có hàng ⇒
    DỪNG»; dev-online nhập lại mật khẩu một lần trên console (PUT có password = envelope mới, không cần giải mã).
  - (b) Giải mã kép (thử ctx mới, hỏng thì ctx cũ) — **vô hiệu hoá chính WO**: mọi envelope cũ mãi mãi không gắn
    đích, và kẻ có quyền DELETE+INSERT chỉ cần chép một envelope định dạng cũ. Không có điểm cắt tự nhiên để gỡ.
  - (c) Job mã hoá lại (giải ctx cũ → mã ctx mới → DELETE+INSERT id mới) — cần KEK lúc deploy + script + test;
    chỉ đáng khi PROD có hàng.
  - **Khuyến nghị (a)**; (c) là phương án dự phòng NẾU phép đo trước deploy thấy PROD ≥ 1 hàng (khi đó dừng và seed
    WO job riêng, không vá nóng). Lý do: rẻ nhất đúng lúc này (owner chốt «làm trước khi PROD có hàng đầu tiên»),
    không có mã chết, không giữ đường tắt.
- **D2 — Câu lỗi route test khi giải mã thất bại** (không chặn). Hiện «Không giải mã được mật khẩu đã lưu.» —
  không nói cách chữa. Đề xuất: «Không dùng được mật khẩu đã lưu — vui lòng nhập lại mật khẩu SMTP rồi bấm Lưu.»
  FE in nguyên văn (M10) ⇒ không đổi FE/i18n. KHÔNG nói «đích đã bị đổi» (không phân biệt được với tamper/mất KEK,
  và không cần cho kẻ dò). **Khuyến nghị: đổi.**
- **D3 — Mức log giải mã thất bại** (không chặn). Sau WO, giải mã thất bại = vi phạm toàn vẹn (đích bị đổi ngoài
  app, envelope bị sửa, mất KEK) hoặc envelope định dạng cũ — không bao giờ là chuyện thường. Đề xuất `logger.error`
  có thẻ cố định (vd `smtp-envelope-unusable`) + company + config id ở CẢ HAI nơi (lời mời hiện thiếu config id —
  M9); không ghi ngữ cảnh/đích/chi tiết crypto. **Khuyến nghị: error.** (Ghi bảng append-only = nợ sẵn có của
  MAILCREDEXFIL §7, không làm ở đây.)
- **D4 — Giá trị gửi lên ≠ giá trị PG lưu (surrogate lẻ — M11)** (không chặn). Không xử lý ⇒ PUT 200 rồi cấu
  hình không bao giờ giải mã được, «nhập lại» cũng không chữa (cùng đầu vào). (a) repo so `RETURNING` với `fields`
  sau INSERT ⇒ 400 (§4.3 — tổng quát, bắt cả thay đổi kiểu cột về sau); (b) service chặn `!isWellFormed()` ở
  host/username; (c) chấp nhận. **Khuyến nghị (a).** Validate ở Zod contract = đổi hợp đồng, ngoài `paths` (§7).
- **D5 — Mở `paths` cho `apps/api/src/db/schema/mail-config.ts`** (không chặn) — CHỈ docblock dòng 28 «AAD =
  companyId‖id» sẽ sai; không đổi schema ⇒ không `db:generate`. **Khuyến nghị: mở** (một dòng chú thích); không thì
  ghi nợ.
- **D6 — Gate** (không chặn). `done_when`: FULL = security + silent-failure. CLAUDE.md §6 coi crypto là
  crown-jewel (+ `santa-method`); D4 đụng repo ⇒ `database-reviewer` có ích. **Khuyến nghị:** security +
  silent-failure (Opus) bắt buộc; thêm database-reviewer chỉ khi chọn D4(a); santa-method tuỳ ngân sách owner
  (thiết kế nhỏ, có 12 mutant đo).

## 7. Ngoài phạm vi / nợ

- Job mã hoá lại envelope (D1-c) — chỉ seed nếu PROD có hàng trước deploy.
- Validate hình dạng `host`/`username` ở contract (Zod: hostname/IP, `isWellFormed`) — nợ security LOW đã ghi ở
  MAILCREDEXFIL §7; D4(a) chỉ chặn hệ quả crypto.
- `emailSent:false` không mang lý do (M10) — admin phải tự vào «Kiểm tra kết nối». Thêm `emailFailReason` = đổi
  contract/FE, WO riêng nếu owner muốn.
- Host có NUL ⇒ 500 (`22021`, M11) — có từ trước, thuộc validate contract.
- `decryptSecret` gom mọi nguyên nhân thành `decrypt failed` (silent-failure L-4 của MAILCREDEXFIL) — vẫn không
  phân biệt «đích đổi» với «tamper/mất KEK»; cố ý không thêm thử-ctx-cũ để phân loại (đó là giải mã envelope không
  gắn đích — chính đường D1-b).
- Log từ chối/giải mã hỏng chỉ ở log ứng dụng — ứng viên bảng append-only (MAILCREDEXFIL §7).
- Không gắn `scope` (đổi scope cùng đích không đưa mật khẩu tới nơi mới — §4.1).
- Rollback code về trước WO sau khi đã có envelope ngữ cảnh mới ⇒ envelope đó không mở bằng ctx cũ (M4) ⇒
  fail-closed, phải nhập lại mật khẩu (không rò).

## 8. Thứ tự thi công + verify

1. Owner ký D1 (chặn) + D2–D6. Plan-reviewer (Opus) trên plan này.
2. **RED** (một commit test): unit `mail-destination.spec.ts` + 3 spec unit sửa + mục (E) int-spec; chạy trên base,
   ghi số đỏ + thông điệp vào §10 (mới):
   `bash "<scratchpad>/run-lane-vitest.sh" "/c/dev 2/MediaOS-mailaad" mailaad src/settings src/user-invites test/integration/mail-config-credexfil-http.int-spec.ts test/integration/mail-config-envelope.int-spec.ts`
   — đọc dòng `Test Files`/`Tests`.
3. **GREEN**: helper → 3 call-site + ca 3b → D2/D3 → D4 → docblock. Chạy lại lệnh bước 2 (một lần, cùng lane —
   bắt rò fixture chéo spec).
4. Mutant M1–M12 (§5.3), ghi kết quả.
5. `bash harness/check.sh --all --lane-db=mailaad` (ratchet/census không được nới; kỳ vọng không đổi route/mã lỗi).
6. FULL gate (D6) → vá finding (mỗi vá có ca RED) → chờ #560 merge → rebase lên master, gốc cũ là
   `fix/s19-sec-mailcredexfil-1` (`git rebase --onto master <gốc-cũ>`) → PR → owner merge.
7. **Ngay trước deploy** (người deploy, superuser `mediaos` qua kết nối DIRECT, không PgBouncer — FORCE RLS cho 0
   giả với role thường, xem MAILCREDEXFIL §6): `SELECT count(*) FROM company_mail_configs;` trên PROD `mediaos`.
   **> 0 ⇒ DỪNG** (D1-c). Đếm thêm trên DB dev-online: > 0 ⇒ sau deploy nhập lại mật khẩu SMTP trên console (hoặc
   chấp nhận `emailSent:false` tới khi nhập). Deploy chỉ API (`m prod-update api`); không migration, không FE.

## 9. Rủi ro + kích thước

- **Lệch ngữ cảnh encrypt/decrypt** (một nơi quên helper) ⇒ mọi lời mời `decrypt_failed`. Chặn bởi P1/R3/P3 có sẵn
  - M6–M8 + B2 (grep `SMTP_SECRET_PURPOSE` chỉ còn trong helper — thêm ca unit grep nguồn nếu reviewer muốn).
- **dev-online có hàng cũ** ⇒ lời mời trên dev-online ngừng gửi tới khi nhập lại mật khẩu — có log error (D3).
- **PROD có hàng đầu tiên trước deploy** ⇒ cùng hệ quả trên PROD; cửa §8 bước 7 chặn.
- **Rebase lên master sau #560**: chỉ xung đột nếu #560 đổi thêm trong FULL gate/merge — các tệp chung
  `mail-config.service.ts`, `mail-destination.ts`, int-spec credexfil.
- **Flake int-spec**: host→`localhost` phụ thuộc DNS ở base (chỉ ảnh hưởng thông điệp đỏ, không ảnh hưởng xanh sau
  vá — sau vá 0 kết nối là tất định).
- **Kích thước**: 6 tệp prod (`mail-destination.ts` ~+45, `mail-config.service.ts` ~±25, `mail-config.repository.ts`
  ~+20 (D4), `invite-mail.service.ts` ~±12, `secret-encryption.types.ts` +3, schema docblock 1 dòng (D5)) · 5 tệp
  test (`mail-destination.spec.ts` mới ~130, service spec ~+45, invite smtp spec ~+50, credexfil int-spec ~+180,
  envelope int-spec ~±6). Tổng ~**500 LOC**, ~**22 ca test mới** (unit ~12, int ~10 kể cả 4×2 bảng), 12 mutant.
  0 migration · 0 route · 0 mã lỗi mới.
