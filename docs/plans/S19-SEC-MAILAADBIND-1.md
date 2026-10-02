# S19-SEC-MAILAADBIND-1 — Gắn ĐÍCH SMTP vào ngữ cảnh mã hoá của envelope mật khẩu

> Zone 🔴 **red** — secret/crypto (bất biến #3). Nối tiếp `S19-SEC-MAILCREDEXFIL-1` (PR #560, CHƯA merge):
> nhánh `fix/s19-sec-mailaadbind-1` dựng trên `fix/s19-sec-mailcredexfil-1` (`9155e3be`); PR chỉ mở sau khi #560
> merge (`git rebase --onto master`). Plan-reviewer trước khi code (lượt 1 PASS — vá ở §10) · deny-path RED trước ·
> FULL gate **security + database + silent-failure + santa-method** (D6, CLAUDE.md §6) TRƯỚC khi mở PR · owner
> merge. **Diff WO này: không migration · không đổi route · không đổi contract/DTO** (deploy vẫn kéo theo 0591 nếu
> PROD chưa ở #560 — §8 bước 7). Đo 02/10/2026 trên worktree `C:\dev 2\MediaOS-mailaad`, lane `mediaos_mailaad`.

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
| `settings/mail-config.repository.ts:105-128,129-160`                                 | Hai nhánh INSERT ghi `id: recordId` rồi `.returning()` — KHÔNG so lại hàng trả về với giá trị đã gắn vào ngữ cảnh (M24).                                                                                                           |
| `db/schema/mail-config.ts:28`                                                        | Docblock: «AAD = companyId‖id (recordId=id)» — sẽ SAI sau WO (ngoài `paths` — D5).                                                                                                                                                 |

Hệ quả (đo §2 M2/M3): ai sửa được cột đích của hàng mà **không** cần mã hoá lại — superuser/DBA, một migration
lỗi, hoặc một đường ghi mới `DELETE+INSERT` của chính `mediaos_app` (0591 không chặn INSERT/DELETE) — là dắt
được mật khẩu hộp thư công ty tới server tuỳ ý qua route test hoặc lời mời kế tiếp. WO này đổi I2 thành
**mật mã học**: đích là một phần của ngữ cảnh mã hoá ⇒ đổi đích mà không mã hoá lại ⇒ GCM từ chối ⇒ không có
mật khẩu nào để gửi đi.

## 2. Phép đo (02/10/2026)

Probe lượt 1: `scratchpad/probes/mailaad/n-json-context.cjs` (Node 24.15, không DB) và
`scratchpad/probes/mailaad/test/integration/probe-mailaad.int-spec.ts` (chép TẠM vào `apps/api/test/integration/`
vì Vite không nạp spec ngoài root — đo `--dir` ⇒ `Failed to load url`; chạy xong xoá ngay, `git status` sạch).
Chạy bằng `run-lane-vitest.sh … mailaad`, kết quả `7 passed`, 901 ms (không treo).

Probe lượt 2 (plan-review lượt 1): `scratchpad/probes/mailaad/test/integration/probe-mailaad-r2.int-spec.ts`, chép
tạm thành `apps/api/test/integration/zz-probe-mailaad-r2.int-spec.ts`, chạy runner lane `mailaad`, xoá ngay
(`git status` sạch) ⇒ `Test Files 1 passed (1)` · `Tests 4 passed (4)`; log `probes/mailaad/run-r2.log`.

| #   | Khẳng định                                                                                                                 | Đo bằng                                                                                                                                      | Kết quả quan sát                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | AAD hôm nay không gắn đích                                                                                                 | Đọc `secret-encryption.service.ts:24-26,47,67` + M2                                                                                          | AAD chỉ từ `companyId/recordId/encAlgo/dekKeyVersion`; mọi call-site SMTP truyền `recordId = id`.                                                                                                                                                                                                        |
| M2  | Superuser `UPDATE port → E` giữ envelope ⇒ mật khẩu đã lưu tới E                                                           | Probe P2 (2 server SMTP giả L/E, `MailConfigService` + `InviteMailService` thật, KEK thật)                                                   | `testConnection` vắng pw (đích E) ⇒ `{ok:true}`, E nhận AUTH bằng STORED; lời mời ⇒ `{sent:true}`; tổng 2 AUTH STORED tới E; L 0 kết nối.                                                                                                                                                                |
| M3  | Role APP (`withTenant`) `DELETE`+`INSERT` tái dùng id + chép envelope, port → E — 0591 KHÔNG chặn                          | Probe P3                                                                                                                                     | Không lỗi quyền; id giữ nguyên; port = E; lời mời `{sent:true}`, E nhận 1 AUTH STORED.                                                                                                                                                                                                                   |
| M4  | Ngữ cảnh ứng viên `JSON.stringify([id, host, port, username, secure])` chặn đúng                                           | Probe P4 (`SecretEncryptionService` thật)                                                                                                    | khớp ⇒ OK; đổi host / port / username / secure / id ⇒ `decrypt failed`; port dạng chuỗi `"2525"` ⇒ failed; **envelope cũ (ctx=id) mở bằng ctx mới ⇒ failed**; envelope mới mở bằng ctx cũ ⇒ failed; envelope cũ + ctx cũ ⇒ OK.                                                                           |
| M5  | `JSON.stringify` không bao giờ đưa byte NUL/điều khiển thô vào `recordId` ⇒ `buildAad` (phân cách NUL) không tái phân đoạn | Probe N1: duyệt đủ 65 536 code unit trong host + username                                                                                    | 0 ký tự điều khiển thô; surrogate lẻ được thoát 2048/2048; host chứa `\u0000` ⇒ UTF-8 không có byte 0x00.                                                                                                                                                                                                |
| M6  | Ký tự phân cách tự chọn va chạm được (host không validate); JSON thì không                                                 | Probe N2                                                                                                                                     | `join("\|")`: `("evil.test\|25\|victim", 26, "x")` ≡ `("evil.test", 25, "victim\|26\|x")` ⇒ **true**; JSON ⇒ false; chèn `","` vào host/username ⇒ JSON không va chạm.                                                                                                                                   |
| M7  | Kiểu có nghĩa trong ngữ cảnh; driver trả đúng kiểu                                                                         | Probe N3 + P1 (`repo.findByScope`)                                                                                                           | `25` ≠ `"25"`, `true` ≠ `"true"`; drizzle trả `port: number`, `secure: boolean`, `updatedAt: Date`.                                                                                                                                                                                                      |
| M8  | So CHÍNH XÁC, không chuẩn hoá Unicode (khớp I1 của MAILCREDEXFIL)                                                          | Probe N5                                                                                                                                     | `café` NFC ≠ NFD ⇒ ngữ cảnh khác (đúng chủ ý — lệch ⇒ fail-closed).                                                                                                                                                                                                                                      |
| M9  | Giải mã thất bại hôm nay lộ ra thế nào                                                                                     | Probe P5 (`auth_tag` hỏng bằng superuser)                                                                                                    | Lời mời `{sent:false, reason:'decrypt_failed'}` + `warn "Giải mã mật khẩu SMTP của <company> thất bại…"` (**không config id**); test `{ok:false, errorMessage:"Không giải mã được mật khẩu đã lưu."}` + `warn … config=<id>`; L 0 kết nối.                                                               |
| M10 | Admin thấy gì khi lời mời không gửi được                                                                                   | Đọc `user-invites.service.ts:121-134`; `console/…/vi/invites.json:52`, `users.json:82`; `settings/mail-config.tsx:383-391`                   | Route mời chỉ trả `emailSent:false` (lý do chỉ ở log); console hiện «… KHÔNG gửi được email — kiểm tra cấu hình mail server (SMTP)»; màn mail-config in `errorMessage` của route test NGUYÊN VĂN.                                                                                                        |
| M11 | Giá trị gửi lên có thể KHÁC giá trị PG lưu (ảnh hưởng ngữ cảnh dựng lúc encrypt vs lúc đọc)                                | Probe P6 + `node -e JSON.parse('"a\\ud800b"')`                                                                                               | Host có surrogate lẻ ⇒ PG lưu `U+FFFD` (`storedEqualsSent:false`); body JSON `"\ud800"` ⇒ `JSON.parse` ra surrogate lẻ thật (đi được qua HTTP, Zod chỉ `min/max`). Host có NUL ⇒ `22021` (500 — có từ trước). Khoảng trắng cuối giữ nguyên.                                                              |
| M12 | Không lồng `withTenant`                                                                                                    | Đọc `mail-config.service.ts:116-131,169-176`, `invite-mail.service.ts:66-77`, `local-kek.provider.ts:45-101`; probe chạy hết 901 ms          | encrypt chạy TRƯỚC `repo.upsert` (tx riêng); decrypt chạy SAU khi `findByScope` đã đóng tx; `unwrapDek` không chạm DB; `wrapDek→currentKey` dùng `db.execute` toàn cục (registry, không `withTenant`). Helper mới là hàm thuần.                                                                          |
| M13 | Tách miền với envelope purpose khác                                                                                        | Đọc `two-factor.service.ts:176-180`, `auth.service.ts:1644-1648` + probe N4                                                                  | TOTP/reset dùng `recordId = userId` (UUID trần); ngữ cảnh SMTP mới luôn bắt đầu bằng `[` ⇒ không bao giờ trùng.                                                                                                                                                                                          |
| M14 | Xoay KEK không đụng envelope SMTP                                                                                          | Đọc `secret-rotation.service.ts:57-61`                                                                                                       | `reWrapAll` ném với mọi purpose ≠ `platform_account` ⇒ đổi ngữ cảnh SMTP không phải đồng bộ với job xoay khoá.                                                                                                                                                                                           |
| M15 | Tập call-site                                                                                                              | `grep encryptSecret\|decryptSecret\|MailConfigRepository` trong `apps/api/src` + `test/`                                                     | encrypt SMTP: 1 (`mail-config.service.ts:117`); decrypt SMTP: 2 (`mail-config.service.ts:176`, `invite-mail.service.ts:77`) + 1 trong test (`mail-config-envelope.int-spec.ts:145`). `mediaos_worker` có SELECT (`0380:71`) nhưng không code nào đọc.                                                    |
| M16 | Lane sạch                                                                                                                  | Probe P0 (superuser direct)                                                                                                                  | `mediaos_mailaad`: 0 hàng `company_mail_configs`; role direct `mediaos` (`rolsuper=true`).                                                                                                                                                                                                               |
| M17 | Baseline xanh                                                                                                              | Runner: `src/settings src/user-invites test/integration/mail-config-envelope… mail-config-credexfil-http…`                                   | `Test Files 10 passed (10)` · `Tests 128 passed (128)`.                                                                                                                                                                                                                                                  |
| M18 | Dạng ĐỎ khi spec gọi helper chưa tồn tại                                                                                   | Spec tạm `src/settings/zz-probe-missing-export.spec.ts` (xoá ngay)                                                                           | `TypeError: smtpSecretContext is not a function` · `Test Files 1 failed` · `Tests 1 failed` (đếm là test đỏ, không phải file không nạp được) — ĐỎ CẤU TRÚC, không phải bằng chứng hành vi (§8 bước 2).                                                                                                   |
| M19 | 400 không mã module ra mã gì                                                                                               | Đọc `common/errors/error-codes.ts:18,33-45` + `all-exceptions.filter.ts:100-103`                                                             | `httpStatusToCode(400)` ⇒ `VALIDATION-ERR-001`.                                                                                                                                                                                                                                                          |
| M20 | Số hàng PROD                                                                                                               | **KHÔNG đo lại** (luật phiên: không trỏ gì vào DB `mediaos`/`mediaos_dev`). Số liệu MAILCREDEXFIL §1/§6, 02/10                               | PROD `mediaos`: 0 hàng (superuser BYPASSRLS + đối chứng theo tenant). dev-online / `mediaos_dev`: **chưa biết** — người deploy đo (§8 bước 7).                                                                                                                                                           |
| M21 | Bước sửa hàng bằng `direct` có thể trượt IM LẶNG                                                                           | Probe r2 Q1: superuser `UPDATE … WHERE company_id=$1 AND scope='default'` rồi `… AND scope='khong-co'`                                       | khớp ⇒ `rowCount 1`; WHERE trượt ⇒ `rowCount 0`, **không ném lỗi**; `current_user=mediaos`, `rolsuper=true`. ⇒ thiếu assert `rowCount` thì đối chứng dương P-B1 xanh-rỗng được.                                                                                                                          |
| M22 | `direct` trên CI cũng là superuser                                                                                         | Đọc `.github/workflows/api.yml:58,85` · `ci.yml:25,51`                                                                                       | `POSTGRES_USER: mediaos` + `DATABASE_DIRECT_URL=postgres://mediaos:…` ⇒ role do image postgres tạo (superuser theo tài liệu image — SUY, không đo trên runner CI). Assert `rowCount` của §5.1 KHÔNG phụ thuộc giả định này.                                                                              |
| M23 | Role app `withTenant` + `tx.execute` DELETE/INSERT trả `rowCount`                                                          | Probe r2 Q4 (chép envelope, port → 3030, id giữ)                                                                                             | `tx.execute` trả `QueryResult` của pg (`command, rowCount, rows, …`); DELETE `rowCount 1` · INSERT `rowCount 1`; sau đó id GIỮ, port = 3030, `secret_ciphertext` byte-bằng bản chép.                                                                                                                     |
| M24 | id chuẩn: `randomUUID` chữ thường; PG trả uuid chữ thường bất kể đầu vào                                                   | Probe r2 Q2/Q3 (`repo.upsert` THẬT với `recordId` CHỮ HOA, envelope gắn chuỗi hoa)                                                           | 0/10 000 mẫu `randomUUID()` có chữ hoa; `RETURNING id` = chữ thường ≠ id gửi; mở envelope bằng `row.id` ⇒ `decrypt failed`, bằng chuỗi hoa ⇒ OK. ⇒ so `row.id === recordId` ở repo bắt lệch id lúc GHI (hôm nay không chạm được từ HTTP — service luôn `randomUUID()`).                                  |
| M25 | Spy log hiện có không phân biệt mức                                                                                        | Đọc `invite-mail.smtp.spec.ts:105-111`; `mail-config.service.spec.ts:286-289,342-353`                                                        | Invite: 5 mức (`log/warn/error/debug/verbose`) đẩy CHUNG mảng `logged` ⇒ assert theo chữ không bắt được mức. Service: `spyWarn` chỉ spy `warn`; ca `:342` ghim `warn` gọi đúng 1 lần + `config=<id>` ⇒ đổi sang `error` (D3) làm CA NÀY ĐỎ — phải SỬA ca, không thêm ca song song.                       |
| M26 | Deploy API có chạy migration; console FE tự deploy; #560 mang gì                                                           | Đọc `dev/README.md:72,79`; `.github/workflows/apps-frontend.yml:19,69`; `git diff --stat 14afbb5f 9155e3be`                                  | `m prod-update api` = build → **migrate (fail-closed, TRƯỚC restart)** → restart; console lên Pages khi push master; #560 mang `0591` + `meta/_journal.json` + `apps/console/**` + contracts. ⇒ «deploy chỉ API, không migration» chỉ đúng nếu PROD đã ở #560.                                           |
| M27 | Ledger start-on-touch khi 2 WO chung glob                                                                                  | Đọc `harness/lib/wo-state.mjs:72-92`, `.claude/hooks/guard-scope.mjs:33-40`, `harness/ledger.mjs:24`; `ls harness/activity.jsonl` ở worktree | Chỉ xét WO `todo` có MỌI `depends_on` đã `done`; khớp ĐÚNG 1 WO mới đóng dấu; đường tương đối theo `process.cwd()` — tệp ngoài cwd bị bỏ qua; ledger theo từng checkout (worktree chưa có tệp). ⇒ WO này KHÔNG thể tự `started` khi #560 chưa `done`; dấu sai (nếu có) rơi vào WO READY KHÁC chung glob. |
| M28 | Ngữ cảnh không có độ tươi (phát lại được)                                                                                  | Đọc §4.1 + `0380:66` (`GRANT SELECT, INSERT, DELETE … TO mediaos_app`) + `db/schema/mail-config.ts:59` (unique `company_id, scope`) + M3/M23 | Ngữ cảnh chỉ gồm giá trị của hàng; DELETE hàng hiện tại + INSERT lại NGUYÊN ảnh chụp cũ (id + đích + envelope) ⇒ ngữ cảnh khớp ⇒ mở được (suy từ M4 «khớp ⇒ OK» + M23 «role app chép envelope được»).                                                                                                    |
| M29 | Phạm vi grep của B2                                                                                                        | `grep -rn SMTP_SECRET_PURPOSE apps/api/src apps/api/test`                                                                                    | `mail-config.service.ts:5,120,179` · `invite-mail.service.ts:3,80` · `mail-config-envelope.int-spec.ts:21,54,59,148`; `:54/:59` là round-trip ngữ cảnh TỰ DO (ca 1), không phải decrypt hàng đã lưu.                                                                                                     |

## 3. Bất biến

- **B1 (mới — I2 thành mật mã)** — Envelope mật khẩu SMTP mở được **khi và chỉ khi** bộ năm
  `(id, host, port, username, secure)` của hàng đang đọc GIỐNG HỆT bộ năm lúc mã hoá (cùng `companyId`,
  `encAlgo`, `dekKeyVersion` như trước). So chính xác theo giá trị + kiểu (M7, M8).
- **B2** — MỘT helper duy nhất dựng ngữ cảnh SMTP; mọi encrypt và MỌI decrypt hàng đã lưu đi qua nó. Grep-able
  trong code sản phẩm: `apps/api/src/**/*.ts` trừ `*.spec.ts` không còn `SMTP_SECRET_PURPOSE` nào ngoài
  `mail-destination.ts`. Test được miễn có chủ ý: round-trip ngữ cảnh tự do `mail-config-envelope.int-spec.ts:49-60`
  (ca 1 — không đọc hàng, M29); ca 3b (decrypt hàng đã lưu) thì PHẢI dùng helper.
- **B3** — Giải mã thất bại KHÔNG mở kết nối SMTP nào (không transporter), và KHÔNG im lặng: log mức `error`
  (D3) có company + config id, route test trả câu cố định, lời mời trả `{sent:false, reason:'decrypt_failed'}` ⇒
  `emailSent:false`.
- **B4** — Bộ giá trị gắn vào ngữ cảnh lúc encrypt = bộ giá trị PG thật sự lưu: **id + 4 trường đích** (M11, M24;
  D4). Repo so cả năm sau INSERT; lệch ⇒ rollback.
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
- Không có bộ đếm/nonce: ràng buộc chống ĐỔI đích, KHÔNG chống phát lại ảnh chụp cũ (M28 — §7).
- Docblock module: thay đoạn «⚠️ Lớp DB chỉ chặn ĐƯỜNG UPDATE… gắn đích vào AAD = WO …» bằng mô tả lớp mật mã.
- Import `EncryptCtx` (type) từ `../crypto/secret-encryption.types` + `SMTP_SECRET_PURPOSE` từ contracts.

### 4.2 Ba call-site dùng helper

| File                             | Đổi                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mail-config.service.ts:117-121` | `encryptSecret(dto.password, smtpSecretContext(companyId, recordId, fields))` — `fields` chính là object repo INSERT.                                                                                                    |
| `mail-config.service.ts:176-186` | `decryptSecret(existing, smtpSecretContext(existing.companyId, existing.id, existing))` — từ HÀNG, không từ dto. Câu lỗi theo D2; log `warn` → `error` có thẻ cố định (D3). Docblock `upsert`/`testConnection` cập nhật. |
| `invite-mail.service.ts:77-88`   | `decryptSecret(config, smtpSecretContext(config.companyId, config.id, config))`; log lỗi `warn` → `error` + thẻ + `config=<id>` (M9: hiện thiếu) theo D3. Bỏ import `SMTP_SECRET_PURPOSE` nếu không còn dùng.            |

`mail-config-envelope.int-spec.ts:145-149` (ca 3b) đổi sang helper — đây là một decrypt-site hàng đã lưu (trong
test). Ca 1 (`:49-60`) giữ nguyên (B2 — miễn có chủ ý).

### 4.3 Repo — B4: «bộ lưu = bộ đã gắn» (theo D4, khuyến nghị)

`mail-config.repository.ts`, cả hai nhánh INSERT (mới `:105-128` + DELETE+INSERT `:129-160`): sau `.returning()`,
gọi một hàm kiểm chung (vd `assertPersistedAsBound(row, recordId, fields)`, đặt cạnh repo):

1. `row.id !== recordId` ⇒ `throw new Error("…recordId không khớp id PG lưu…")` — **lỗi lập trình**, KHÔNG
   phải đầu vào người dùng (service luôn `randomUUID()` chữ thường — M24) ⇒ 500 qua filter, tx rollback. Không
   gói thành 400 «ký tự không hợp lệ» (sai bản chất). Không in id/ngữ cảnh ra message ngoài chính chữ «recordId».
2. `!sameDestination(destinationOf(row), fields)` ⇒ `throw new MailDestinationNotPersistedError()` ⇒ tx rollback
   (chưa ghi audit vì audit ở sau). Lỗi miền mới trong `mail-destination.ts` (tự gán `this.name`, như
   `MailPasswordRequiredError`). Service bắt ⇒ `BadRequestException` với câu «Máy chủ hoặc tên đăng nhập SMTP
   chứa ký tự không hợp lệ.» ⇒ `VALIDATION-ERR-001` (M19 — không thêm mã catalog).

Chỉ so trong JS trên hàng `RETURNING` đã có, không thêm truy vấn. Docblock repo (`:70-88`): bỏ câu «AAD không gắn
đích ⇒ ĐỪNG viết DELETE+INSERT tái dùng id», thay bằng: tái dùng id + chép envelope sang đích khác ⇒ giải mã hỏng
(B1); id/đích lưu lệch bộ đã gắn ⇒ rollback (B4).

### 4.4 Docblock khác

`crypto/secret-encryption.types.ts:35-40` (`EncryptCtx`): một dòng — với `smtp_password`, `recordId` là bộ năm
JSON dựng bởi `smtpSecretContext`, không phải id trần. `db/schema/mail-config.ts:28` theo D5. **KHÔNG sửa
0591** (migration đã áp ở lane, sẽ áp ở PROD qua #560; câu «gắn đích vào AAD = WO S19-SEC-MAILAADBIND-1» vẫn
đúng như con trỏ).

## 5. Test — RED trước (đo đỏ trên base `9155e3be`, rồi mới vá)

### 5.1 Int-spec — mở rộng `test/integration/mail-config-credexfil-http.int-spec.ts` (mục mới «(E) AAD»)

Lý do mở rộng thay vì file mới: dùng lại L/E, admin + token, `putStored` ở `beforeEach` (mỗi ca có hàng mới
gắn L + STORED), `connectionsDuring`, `storedRow`; không dựng AppModule lần hai ⇒ không chạm ratchet
`S16-TEST-PIPELINE-PARITY-1` / census listen(0). File 449 → ~660 dòng (< 800). Sửa đích bằng `direct`
(superuser `mediaos`, M16/M22) — bỏ qua 0591 có chủ ý: đây là kẻ ghi «ngoài app». `DECRYPT_MSG` ghim LITERAL theo D2.

**Tiền điều kiện của MỌI bước sửa hàng (plan-review F3 — M21: WHERE trượt ra 0 hàng KHÔNG ném lỗi).** Hai helper
mới trong mục (E), không ca nào sửa hàng trực tiếp:

- `tamperAsSuperuser(setSql, params, expectAfter)` — `const before = await storedRow()`; chạy
  `UPDATE … WHERE company_id=$1 AND scope='default'` qua `direct`; assert
  `expect(res.rowCount, "bước sửa hàng phải chạm đúng 1 hàng").toBe(1)`; `const after = await storedRow()`; assert
  trường đích ĐÃ đổi đúng giá trị (`expectAfter`, vd `after.port === E.port`), `after.id === before.id`,
  `after.secret_ciphertext.equals(before.secret_ciphertext)`, `after.encrypted_dek.equals(before.encrypted_dek)`.
  Trả `{ before, after }`.
- `reinsertAsApp({ id, port })` — trong `DatabaseService.withTenant(A.companyId, tx ⇒ …)`: `tx.execute` DELETE rồi
  INSERT chép nguyên 7 cột envelope từ `before`; assert `rowCount === 1` cho CẢ HAI câu (M23 — `tx.execute` trả
  `QueryResult`); rồi `storedRow()` sau: id = id truyền vào, port = port truyền vào, `secret_ciphertext` +
  `encrypted_dek` byte-bằng bản chép.

| Ca                     | Kịch bản                                                                                                                                                       | Kỳ vọng (sau vá)                                                                                                                                         | Đỏ trên base (đo/suy từ đo)                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-B1 (×4, `it.each`)   | `tamperAsSuperuser` MỘT trường đích: port→E · username→`EVIL_USER` · secure→true · host→`localhost`; rồi `POST /test` vắng pw với đúng đích MỚI của hàng       | 201 `{ok:false, errorMessage: DECRYPT_MSG}`; `toL === 0 && toE === 0`; `L.auths`/`E.auths` rỗng                                                          | port: `{ok:true}`, E nhận AUTH STORED (M2) ⇒ `expected { ok: true } to deeply equal {…}`. username: L nhận AUTH (EVIL_USER, STORED). secure: TLS tới L ⇒ `toL 1 ≠ 0` + câu TLS ≠ DECRYPT_MSG. host: kết nối L hoặc từ chối — mọi nhánh ≠ kỳ vọng. |
| R-B2 (×4, cùng bảng)   | cùng `tamperAsSuperuser` ⇒ `InviteMailService.sendActivationEmail`                                                                                             | `{sent:false, reason:'decrypt_failed'}`; 0 kết nối L/E                                                                                                   | port: `expected { sent: true } to deeply equal { sent: false, reason: 'decrypt_failed' }` (M2).                                                                                                                                                   |
| R-B4                   | `reinsertAsApp({ id: before.id, port: E.port })` — DELETE + INSERT tái dùng id + chép envelope (đúng hồi quy WO nêu; 0591 không chặn — M3)                     | lời mời `decrypt_failed`, E 0 kết nối; `POST /test` vắng pw (đích E) ⇒ `{ok:false, DECRYPT_MSG}`                                                         | `{sent:true}`, E nhận AUTH STORED (M3).                                                                                                                                                                                                           |
| R-B6 (khoá hồi quy)    | `reinsertAsApp({ id: randomUUID(), port: L.port })` — id MỚI, CÙNG đích, chép envelope; tiền điều kiện thêm `after.id !== before.id`                           | lời mời `decrypt_failed`                                                                                                                                 | XANH trên base (id đã gắn) — có chủ ý: giết mutant M5 (bỏ id khỏi helper).                                                                                                                                                                        |
| P-B1 (đối chứng dương) | `tamperAsSuperuser` CHỈ `from_name/from_email/updated_at`; tiền điều kiện: `after.from_name` = giá trị mới, id + envelope y nguyên, 4 trường đích y nguyên     | lời mời `{sent:true}`, L nhận AUTH STORED; `POST /test` vắng pw ⇒ `{ok:true}`                                                                            | XANH cả base — chứng minh không gắn quá tay (mutant M10); KHÔNG xanh-rỗng nhờ `rowCount === 1` (mutant M16).                                                                                                                                      |
| R-B5 (D4)              | `PUT` có password, host `a\ud800b.test` (rồi username tương tự)                                                                                                | 400 `VALIDATION-ERR-001`; hàng y nguyên (id, host L, envelope); số audit `mail_config` không đổi (đối chứng `> 0`)                                       | 200; hàng lưu `a\uFFFDb.test` (M11) ⇒ `expected 200 to be 400`.                                                                                                                                                                                   |
| R-B7 (B4 — id)         | `repo.upsert(A.companyId, randomUUID().toUpperCase(), fields L, envelope, auditMeta)` thẳng (như R4 có sẵn); envelope dựng bằng `SecretEncryptionService` thật | promise REJECT (lỗi lập trình, message chứa `recordId`, KHÔNG phải `MailDestinationNotPersistedError`); hàng cũ y nguyên (id, envelope); audit không đổi | Base resolve, hàng bị thay bằng id chữ thường (M24) ⇒ `promise resolved "{…}" instead of rejecting`.                                                                                                                                              |
| P1 · R3 · P3 (có sẵn)  | không sửa                                                                                                                                                      | vẫn xanh                                                                                                                                                 | — đối chứng dương encrypt↔decrypt CÙNG ngữ cảnh (giết M6–M8).                                                                                                                                                                                     |

### 5.2 Unit

- **MỚI `src/settings/mail-destination.spec.ts`** (`smtpSecretContext`): mẫu ⇒ `recordId` LITERAL
  `'["<id>","smtp.example.test",587,"mailer@example.test",false]'` + `purpose:'smtp_password'` + `companyId`
  chuyển nguyên; từng trường trong 5 đổi ⇒ `recordId` khác; cặp va chạm của `join("|")` (M6) và cặp chèn `","`
  ⇒ khác nhau; host chứa `\u0000`/`\n` ⇒ `recordId` không có ký tự điều khiển thô; nguồn là HÀNG đủ cột (envelope,
  from\_\*) ⇒ bằng nguồn chỉ có 4 trường; bắt đầu bằng `[`. RED trên base: `TypeError` «smtpSecretContext is
  not a function» (M18) — **ĐỎ CẤU TRÚC** (§8 bước 2).
- **`mail-config.service.spec.ts`**: ca «CÓ password» thêm assert ngữ cảnh của `encryptSecret` (arg 2) bằng
  `{ companyId, recordId, purpose }` với `recordId` = `JSON.stringify([id, "smtp.x", 465, "u", true])` và `id` =
  arg 2 của `repo.upsert` (dựng LITERAL, không gọi helper — tránh tautology). RED: `expected '<uuid>' to …`. Ca test
  vắng pw khớp: `decryptSecret` ctx = bộ năm của `row()`. Ca decrypt-fail (`:271`): câu D2. Ca mới: repo ném
  `MailDestinationNotPersistedError` ⇒ 400 không có `code` module; lỗi khác (kể cả lỗi lập trình id của §4.3) vẫn
  ném nguyên (giữ ca «DB sập»).
  **SỬA ca `:342-353`** (M25 — không thêm ca song song): spy CẢ `warn` lẫn `error` của `svc.logger`; assert
  `error` gọi đúng 1 lần, dòng chứa thẻ `smtp-envelope-unusable` + `company=<COMPANY>` + `config=${row().id}`,
  KHÔNG chứa `decrypt failed`/mật khẩu; `warn` KHÔNG được gọi. RED trên base:
  `expected "error" to be called once, but got 0 times` (base log ở `warn`).
- **`user-invites/invite-mail.smtp.spec.ts`**: ca gửi thật thêm assert ctx của `decryptSecret` = bộ năm của
  `mailConfigRow(port)` (RED: `recordId: '00000000-…aa'`). Ca MỚI «decryptSecret reject»:
  `{ sent: false, reason: "decrypt_failed" }`, `server.connections === 0`; mức log đo bằng spy RIÊNG của từng mức
  (mảng `logged` gộp 5 mức — M25): `vi.mocked(Logger.prototype.error)` gọi đúng 1 lần, chữ chứa thẻ
  `smtp-envelope-unusable`, `config=00000000-0000-4000-8000-0000000000aa` và `COMPANY_ID`;
  `vi.mocked(Logger.prototype.warn)` KHÔNG được gọi; `logText()` không chứa mật khẩu/token. RED trên base:
  `expected "error" to be called once, but got 0 times` (base log `warn`, không config id — M9).

### 5.3 Mutant (sau GREEN; sao lưu → cấy → chạy → `cp` khôi phục, đối chiếu nội dung; đánh số RIÊNG với §2)

| #   | Cấy                                                                                  | Phải đỏ                                                                          |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| M1  | helper bỏ `host`                                                                     | R-B1/R-B2 hàng host + unit «từng trường»                                         |
| M2  | helper bỏ `port`                                                                     | R-B1/R-B2 hàng port + R-B4 + unit                                                |
| M3  | helper bỏ `username`                                                                 | R-B1 hàng username (L nhận AUTH EVIL_USER/STORED) + unit                         |
| M4  | helper bỏ `secure`                                                                   | R-B1/R-B2 hàng secure + unit                                                     |
| M5  | helper bỏ `id`                                                                       | R-B6 + unit                                                                      |
| M6  | `InviteMailService` giữ ctx cũ (`recordId: config.id`)                               | R3 có sẵn (`{sent:false…}` ≠ `{sent:true}`) + unit invite ctx                    |
| M7  | `testConnection` giữ ctx cũ                                                          | P1 có sẵn + unit service                                                         |
| M8  | PUT encrypt giữ ctx cũ                                                               | P1 · R3 · P3 có sẵn + unit service                                               |
| M9  | helper dùng `.join("\|")`                                                            | unit cặp va chạm                                                                 |
| M10 | helper gắn thêm `fromEmail`                                                          | P-B1                                                                             |
| M11 | bỏ vế đích của kiểm B4 ở repo (D4)                                                   | R-B5                                                                             |
| M12 | log decrypt-fail của lời mời bỏ `config=`                                            | unit invite ca mới (chữ)                                                         |
| M13 | log decrypt-fail của lời mời về `warn`                                               | unit invite ca mới (`expected "error" to be called once`)                        |
| M14 | log decrypt-fail của `testConnection` về `warn`                                      | ca service `:342` đã sửa                                                         |
| M15 | bỏ vế `row.id === recordId` của kiểm B4                                              | R-B7                                                                             |
| M16 | (mutant của TEST) WHERE của bước sửa hàng trong P-B1 trỏ `scope='khong-co'` (0 hàng) | P-B1 đỏ ở `bước sửa hàng phải chạm đúng 1 hàng: expected 0 to be 1` — không xanh |

Mutant tương đương (ghi, không cấy): `testConnection` dựng ctx từ dto thay vì hàng — sau `assertStoredDestination`
hai bên bằng nhau trừ ca surrogate lẻ (đã chặn ở B4).

## 6. Quyết định owner

- **D1 — Envelope ĐÃ CÓ mã hoá bằng ngữ cảnh cũ (`recordId = id`). ⛔ CHẶN thi công.** Đo M4: ngữ cảnh mới mở
  envelope cũ ⇒ thất bại. Hiện: PROD 0 hàng (M20, 02/10); lane 0 (M16); dev-online chưa đo.
  - (a) **Fail-closed** + câu rõ «nhập lại mật khẩu» (D2) + log `error` (D3); cửa deploy «PROD phải 0 hàng, có
    hàng ⇒ DỪNG»; dev-online nhập lại mật khẩu một lần trên console (PUT có password = envelope mới, không cần
    giải mã).
  - (a') **PROD có ít hàng ⇒ nhập lại mật khẩu thay vì DỪNG** (plan-review F8): deploy như (a), rồi admin công ty
    nhập lại mật khẩu SMTP trên console NGAY sau deploy (PUT có password ⇒ `randomUUID()` + envelope mới với
    ngữ cảnh mới — `mail-config.service.ts:113-121`; không cần KEK/script lúc deploy, cùng thuốc với dev-online);
    xác nhận bằng «Kiểm tra kết nối» vắng mật khẩu ⇒ `{ok:true}`. Điều kiện: owner ký TRƯỚC (nới câu `done_when`
    «có hàng ⇒ DỪNG, cần job mã hoá lại» — `backlog.mjs:19829`); có người đang giữ mật khẩu hộp thư của TỪNG
    hàng; chấp nhận cửa sổ lời mời `emailSent:false` từ restart tới lúc nhập lại (mỗi lần có log `error`).
  - (b) Giải mã kép (thử ctx mới, hỏng thì ctx cũ) — **vô hiệu hoá chính WO**: mọi envelope cũ mãi mãi không gắn
    đích, và kẻ có quyền DELETE+INSERT chỉ cần chép một envelope định dạng cũ. Không có điểm cắt tự nhiên để gỡ.
  - (c) Job mã hoá lại (giải ctx cũ → mã ctx mới → DELETE+INSERT id mới) — cần KEK lúc deploy + script + test;
    chỉ đáng khi PROD có hàng mà KHÔNG ai giữ mật khẩu.
  - **Khuyến nghị (a) + ký trước (a')** cho trường hợp PROD 1–vài hàng có người giữ mật khẩu; thiếu mật khẩu ⇒
    DỪNG + seed WO job (c), không vá nóng. Lý do: rẻ nhất đúng lúc này (owner chốt «làm trước khi PROD có hàng
    đầu tiên»), không có mã chết, không giữ đường tắt; (a') tránh một WO mới cho 1–2 hàng.
- **D2 — Câu lỗi route test khi giải mã thất bại** (không chặn). Hiện «Không giải mã được mật khẩu đã lưu.» —
  không nói cách chữa. Đề xuất: «Không dùng được mật khẩu đã lưu — vui lòng nhập lại mật khẩu SMTP rồi bấm Lưu.»
  FE in nguyên văn (M10) ⇒ không đổi FE/i18n. KHÔNG nói «đích đã bị đổi» (không phân biệt được với tamper/mất KEK,
  và không cần cho kẻ dò). **Khuyến nghị: đổi.**
- **D3 — Mức log giải mã thất bại** (không chặn). Sau WO, giải mã thất bại = vi phạm toàn vẹn (đích bị đổi ngoài
  app, envelope bị sửa, mất KEK) hoặc envelope định dạng cũ — không bao giờ là chuyện thường. Đề xuất `logger.error`
  có thẻ cố định (vd `smtp-envelope-unusable`) + company + config id ở CẢ HAI nơi (lời mời hiện thiếu config id —
  M9); không ghi ngữ cảnh/đích/chi tiết crypto. Test ghim mức bằng spy riêng từng mức (M25). **Khuyến nghị:
  error.** (Ghi bảng append-only = nợ sẵn có của MAILCREDEXFIL §7, không làm ở đây.)
- **D4 — Giá trị gửi lên ≠ giá trị PG lưu (surrogate lẻ — M11; id không chuẩn — M24)** (không chặn). Không xử lý
  ⇒ PUT 200 rồi cấu hình không bao giờ giải mã được, «nhập lại» cũng không chữa (cùng đầu vào). (a) repo so
  `RETURNING` với `recordId` + `fields` sau INSERT ⇒ id lệch = 500 (lỗi lập trình), đích lệch = 400 (§4.3 — tổng
  quát, bắt cả thay đổi kiểu cột về sau); (b) service chặn `!isWellFormed()` ở host/username; (c) chấp nhận.
  **Khuyến nghị (a).** Validate ở Zod contract = đổi hợp đồng, ngoài `paths` (§7).
- **D5 — Mở `paths` cho `apps/api/src/db/schema/mail-config.ts`** (không chặn) — CHỈ docblock dòng 28 «AAD =
  companyId‖id» sẽ sai; không đổi schema ⇒ không `db:generate`. **Khuyến nghị: mở** (một dòng chú thích); không thì
  ghi nợ.
- **D6 — Thành phần FULL gate** (không chặn thi công; **CHẶN mở PR**). Mặc định theo CLAUDE.md §6: diff chạm
  secret/encrypt ⇒ FULL (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`), và dòng crown-jewel
  liệt kê «secret/encrypt/KMS» ⇒ `+ santa-method`; mọi agent Opus. `database-reviewer` áp dụng bất kể D4: repo đổi
  kiểm sau INSERT trong tx (§4.3) và int-spec sửa hàng bằng superuser/role app. `done_when` ghi «(security +
  silent-failure)» (`backlog.mjs:19830`) là TẬP CON — không hạ chuẩn theo nó. Owner muốn bỏ `santa-method` ⇒ ký rõ
  (vd «bỏ santa: thiết kế nhỏ, 16 mutant đo»), không mặc định bỏ. **Khuyến nghị: đủ 4.**

## 7. Ngoài phạm vi / nợ

- Job mã hoá lại envelope (D1-c) — chỉ seed nếu PROD có hàng mà thiếu mật khẩu trước deploy.
- **Phát lại ảnh chụp cũ — rủi ro tồn dư CHẤP NHẬN** (M28): ngữ cảnh không có bộ đếm/nonce ⇒ ai có quyền ghi DB
  (superuser, hoặc một đường mới của `mediaos_app` — INSERT/DELETE, `0380:66`) giữ một ảnh chụp ĐỦ hàng cũ
  (id + đích + envelope) có thể DELETE hàng hiện tại rồi INSERT lại ảnh đó ⇒ mật khẩu CŨ tới đích CŨ. Tác động
  thấp (đích đó từng hợp lệ lúc lưu; mật khẩu có thể đã đổi), nhưng ràng buộc này **KHÔNG chống phát lại** — đừng
  khai ngược trong docblock/plan sau. Chống thật cần trạng thái ngoài hàng (bộ đếm phiên bản trong registry/audit)
  — WO riêng nếu owner muốn.
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
- Ca unit đọc NGUỒN để ép B2 tự động — tuỳ chọn; nếu thêm thì quét `apps/api/src/**/*.ts` trừ `*.spec.ts`, KHÔNG
  quét `test/` (ca 1 envelope int-spec dùng hằng hợp lệ — M29).

## 8. Thứ tự thi công + verify

1. Owner ký D1 (chặn) + D2–D6. **Ghi chữ ký D1–D6 vào `notes` của WO trong `harness/backlog.mjs`** (DoD CLAUDE.md
   §8; tiền lệ MAILCREDEXFIL `backlog.mjs:19799`) — do phiên được phép sửa backlog làm (phiên plan này không sửa
   backlog theo luật phiên).
2. **RED** (một commit test): unit `mail-destination.spec.ts` + 3 spec unit sửa + mục (E) int-spec + ca 3b; chạy
   trên base, ghi số đỏ + thông điệp vào **§11 (mới — nhật ký thi công)**:
   `bash "<scratchpad>/run-lane-vitest.sh" "/c/dev 2/MediaOS-mailaad" mailaad src/settings src/user-invites test/integration/mail-config-credexfil-http.int-spec.ts test/integration/mail-config-envelope.int-spec.ts`
   — đọc dòng `Test Files`/`Tests`. Phân loại khi ghi: **ĐỎ CẤU TRÚC** (export thiếu — toàn bộ
   `mail-destination.spec.ts`, envelope 3b; M18) KHÔNG tính là bằng chứng deny-path; **ĐỎ HÀNH VI** = R-B1/R-B2/
   R-B4/R-B5/R-B7 + ca ctx LITERAL ở service/invite spec + 2 ca mức log (service `:342` sửa, invite ca mới).
   Sau commit RED: đọc dòng «Tiêu điểm phiên» của `docs/STATUS.md` ở checkout đang chạy phiên (KHÔNG chạy
   `gen-status` trong worktree) — dấu sai (M27) ⇒ báo orchestrator/owner gỡ bằng sự kiện `reset` (không `done`).
3. **GREEN**: helper → 3 call-site + ca 3b → D2/D3 → D4 (id + đích) → docblock. Chạy lại lệnh bước 2 (một lần,
   cùng lane — bắt rò fixture chéo spec).
4. Mutant M1–M16 (§5.3), ghi kết quả vào §11.
5. `bash harness/check.sh --all --lane-db=mailaad` (ratchet/census không được nới; kỳ vọng không đổi route/mã lỗi).
6. FULL gate theo D6 (mặc định 4 reviewer Opus) → vá finding (mỗi vá có ca RED) → chờ #560 merge → rebase lên
   master, gốc cũ là `fix/s19-sec-mailcredexfil-1` (`git rebase --onto master <gốc-cũ>`) → PR → owner merge. Sau
   merge: đối chiếu dòng `🔧 reconcile:` + «Tiêu điểm phiên» với `gh pr list` (bẫy reconcile/start-on-touch).
7. **Deploy** (người deploy, superuser `mediaos` qua kết nối DIRECT, không PgBouncer — FORCE RLS cho 0 giả với role
   thường, xem MAILCREDEXFIL §6):
   - (a) **Tiền điều kiện — PROD đã ở #560** (M26): (i) 0591 đã áp:
     `SELECT bool_or(has_column_privilege('mediaos_app','public.company_mail_configs',c,'UPDATE')) FROM unnest(array['host','port','username','secure']) AS c;`
     ⇒ `false` (rút gọn từ ca D5a của #560 — D5a ghim cả tập cột); (ii) API dist PROD ≥ #560; (iii) console Pages ≥ #560 (tự deploy
     khi #560 lên master — so hash bundle như memory `prod-3-way-drift`); (iv) deps #558 đã
     `pnpm install --frozen-lockfile` ở checkout chính (S19-OPS-AUDITHIGH-1 §7.2).
   - (b) Thiếu (i) hoặc (ii) ⇒ **deploy #560 + WO này CÙNG MỘT LẦN**: merge #560 → merge WO này → MỘT
     `m prod-update api` (migrate 0591 chạy fail-closed TRƯỚC restart — `dev/README.md:79`). **Khuyến nghị: luôn
     gộp một lần** nếu #560 chưa deploy khi WO này merge — một lần đếm, một lần restart, không có bản PROD trung
     gian phải đếm lại. (Cửa sổ «PROD lưu cấu hình đầu tiên dưới ngữ cảnh cũ» đang mở ngay trên bản PROD hiện tại;
     gộp không tự đóng nó — thứ thu hẹp nó là deploy SỚM sau merge.)
   - (c) **Cửa đếm**, ngay trước `m prod-update api`: `SELECT count(*) FROM company_mail_configs;` trên PROD
     `mediaos`. **> 0 ⇒ theo D1 đã ký**: (a') nhập lại mật khẩu ngay sau deploy rồi «Kiểm tra kết nối» vắng mật
     khẩu ⇒ `ok:true`; hoặc DỪNG + seed job (c). Đếm thêm trên DB dev-online: > 0 ⇒ sau deploy nhập lại mật khẩu
     SMTP trên console (hoặc chấp nhận `emailSent:false` tới khi nhập).
   - Diff WO này không thêm migration/route/FE; `m prod-update api` vẫn áp MỌI migration đang chờ (đó là cách 0591
     lên PROD ở (b)).

## 9. Rủi ro + kích thước

- **Lệch ngữ cảnh encrypt/decrypt** (một nơi quên helper) ⇒ mọi lời mời `decrypt_failed`. Chặn bởi P1/R3/P3 có sẵn,
  mutant M6–M8 và B2 (grep `SMTP_SECRET_PURPOSE` trong `apps/api/src` non-spec chỉ còn ở helper — §3, M29).
- **dev-online có hàng cũ** ⇒ lời mời trên dev-online ngừng gửi tới khi nhập lại mật khẩu — có log error (D3).
- **PROD có hàng đầu tiên trước deploy** ⇒ cùng hệ quả trên PROD; cửa §8 bước 7(c) + D1 (a')/(c).
- **Deploy WO này lên PROD chưa ở #560** ⇒ `m prod-update api` áp luôn 0591 (fail-closed) — đúng ý nếu đã gộp
  có chủ đích (§8 7(b)); nguy hiểm duy nhất là người deploy tưởng «không migration» rồi bỏ bước kiểm (i)–(iv).
- **Rebase lên master sau #560**: chỉ xung đột nếu #560 đổi thêm trong FULL gate/merge — các tệp chung
  `mail-config.service.ts`, `mail-destination.ts`, int-spec credexfil.
- **Flake int-spec**: host→`localhost` phụ thuộc DNS ở base (chỉ ảnh hưởng thông điệp đỏ, không ảnh hưởng xanh sau
  vá — sau vá 0 kết nối là tất định). Bước sửa hàng có `rowCount` + đọc lại (M21) ⇒ không xanh-rỗng.
- **Ledger** (M27): hai WO chung glob `apps/api/src/settings/**`, `apps/api/test/**` — dấu `started` có thể rơi vào
  WO READY khác; kiểm ở §8 bước 2 và 6.
- **Kích thước**: 6 tệp prod (`mail-destination.ts` ~+45, `mail-config.service.ts` ~±30, `mail-config.repository.ts`
  ~+30 (D4: id + đích), `invite-mail.service.ts` ~±14, `secret-encryption.types.ts` +3, schema docblock 1 dòng (D5))
  · 5 tệp test (`mail-destination.spec.ts` mới ~130, service spec ~+55, invite smtp spec ~+60, credexfil int-spec
  ~+210 (2 helper tiền điều kiện + R-B7) ⇒ ~660 dòng, envelope int-spec ~±6). Tổng ~**580 LOC**, ~**24 ca test
  mới/sửa** (unit ~13 kể cả ca `:342` sửa, int ~11 kể cả 4×2 bảng), 16 mutant (15 mã + 1 của test).
  0 migration · 0 route · 0 mã lỗi mới.

## 10. Plan-review lượt 1 — xử lý (verdict PASS; 3 MAJOR + 7 MINOR)

Mọi finding được xác minh lại trên code/lane trước khi sửa (probe r2 — §2 M21–M29).

| #   | Mức   | Phát hiện                                                                            | Xác minh                                                                                                                                                                                                                                                                                                                                        | Xử lý                                                                                                                                                                            |
| --- | ----- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | MAJOR | D6 hạ FULL gate (database có điều kiện, santa tuỳ ngân sách)                         | **XÁC NHẬN.** CLAUDE.md §6: FULL = security + database + silent-failure khi chạm secret/encrypt; dòng crown-jewel liệt kê «secret/encrypt/KMS» ⇒ + santa. `done_when` (`backlog.mjs:19830`) là tập con. D4(a) thêm kiểm trong tx repo ⇒ database-reviewer áp dụng dù sao.                                                                       | D6 viết lại: mặc định đủ 4 (Opus), bỏ santa phải owner ký rõ; D6 chặn mở PR. Header + §8 bước 6 theo D6.                                                                         |
| F2  | MAJOR | §8 bước 7 «chỉ API, không migration» thiếu tiền điều kiện #560                       | **XÁC NHẬN** (M26): #560 mang 0591 + journal + console + contracts; `m prod-update api` CHẠY migrate. **Bác một phần lập luận** «gộp một lần đóng cửa sổ PROD lưu cấu hình đầu tiên dưới ngữ cảnh cũ»: cửa sổ đó đang mở ngay trên bản PROD hiện tại (code trước #560 cũng lưu envelope ctx=id) — gộp không đóng nó; deploy sớm mới thu hẹp nó. | §8 bước 7 viết lại: (a) 4 tiền điều kiện có câu đo `has_column_privilege`; (b) thiếu ⇒ gộp #560 + WO một lần (khuyến nghị gộp vì vận hành); (c) cửa đếm theo D1. §9 thêm rủi ro. |
| F3  | MAJOR | Bước sửa hàng (P-B1, R-B1, R-B2, R-B4, R-B6) không assert đã đổi được hàng           | **XÁC NHẬN** (M21: WHERE trượt ⇒ `rowCount 0`, KHÔNG ném); helper hiện có chỉ ĐỌC (`storedRow` `:108-125`). Ý «RLS/role đổi trên CI» hiện KHÔNG xảy ra (M22: CI direct cũng là `mediaos` superuser) nhưng WHERE sai thì có — assert vẫn cần.                                                                                                    | §5.1: 2 helper `tamperAsSuperuser` / `reinsertAsApp` với `rowCount === 1` + đọc lại (trường đổi đúng, id/envelope giữ hoặc id mới cho R-B6; M23). Mutant M16 (của test).         |
| F4  | MINOR | Spy log gộp mức ⇒ nửa «về warn» của mutant M12 sống; thiếu assert log testConnection | **XÁC NHẬN + rộng hơn** (M25): `invite-mail.smtp.spec.ts:105-111` gộp 5 mức. Ca testConnection CÓ SẴN (`mail-config.service.spec.ts:342-353`) nhưng ghim `warn` ⇒ đổi D3 làm nó đỏ — phải SỬA ca, không thêm.                                                                                                                                   | §5.2: invite ca mới spy `Logger.prototype.error`/`warn` riêng; service ca `:342` sửa sang `error` + `warn` không gọi. Mutant tách M12 (chữ) · M13 (mức invite) · M14 (mức test). |
| F5  | MINOR | Kiểm B4 chỉ so 4 trường đích, bỏ id                                                  | **XÁC NHẬN** (M24): `recordId` chữ HOA ⇒ `RETURNING id` chữ thường ⇒ envelope không mở được bằng `row.id`. An toàn hôm nay chỉ nhờ `randomUUID()` chữ thường (0/10 000).                                                                                                                                                                        | §4.3 kiểm cả `row.id === recordId` (lỗi lập trình ⇒ 500, rollback — không gói 400); B4 = id + 4 trường; ca R-B7; mutant M15.                                                     |
| F6  | MINOR | Grep B2 sẽ bắt nhầm round-trip test                                                  | **XÁC NHẬN** (M29): `mail-config-envelope.int-spec.ts:54,59` (ca 1, ngữ cảnh tự do).                                                                                                                                                                                                                                                            | B2 giới hạn `apps/api/src` non-spec, ca 1 miễn có chủ ý, ca 3b vẫn phải dùng helper; §7 ghi phạm vi nếu thêm ca grep nguồn.                                                      |
| F7  | MINOR | Ca 3b đỏ vì CẤU TRÚC, không phải hành vi                                             | **XÁC NHẬN** (M18) — và cũng đúng cho TOÀN BỘ `mail-destination.spec.ts` trên base.                                                                                                                                                                                                                                                             | §8 bước 2: phân loại ĐỎ CẤU TRÚC (không tính deny-path) vs ĐỎ HÀNH VI khi ghi §11; §5.2 ghi chú.                                                                                 |
| F8  | MINOR | D1 thiếu phương án «nhập lại mật khẩu» cho PROD ít hàng                              | **XÁC NHẬN**: PUT có password luôn mã hoá mới (`mail-config.service.ts:113-121`) — không cần KEK/script lúc deploy. Câu `done_when` «có hàng ⇒ DỪNG, cần job mã hoá lại» (`backlog.mjs:19829`) là của owner ⇒ phải owner ký trước mới được dùng.                                                                                                | D1 thêm (a') với điều kiện (ký trước, có người giữ mật khẩu, chấp nhận cửa sổ `emailSent:false`); khuyến nghị (a) + (a'); (c) chỉ khi thiếu mật khẩu. §8 7(c) theo.              |
| F9  | MINOR | Phát lại ảnh chụp cũ chưa ghi                                                        | **XÁC NHẬN** (M28): ngữ cảnh không có độ tươi; `0380:66` cấp INSERT/DELETE cho `mediaos_app`.                                                                                                                                                                                                                                                   | §7 ghi rủi ro tồn dư chấp nhận + «KHÔNG chống phát lại»; §4.1 một dòng.                                                                                                          |
| F10 | MINOR | `paths` chồng MAILCREDEXFIL ⇒ ledger đóng dấu sai; chưa ghi D1–D6 vào backlog        | **XÁC NHẬN một phần** (M27): chồng glob là thật và DoD đòi cập nhật backlog. Nhưng cơ chế khác lời khai: WO này KHÔNG thể tự bị đóng dấu khi #560 chưa `done` (lọc READY `wo-state.mjs:77`); hook bỏ qua tệp ngoài `process.cwd()` (`guard-scope.mjs:36-37`); ledger theo từng checkout. Nguy cơ thật = dấu rơi vào WO READY khác chung glob.   | §8 bước 1 ghi chữ ký D1–D6 vào `notes` (phiên được phép sửa backlog); bước 2 + 6 kiểm «Tiêu điểm phiên»/`reconcile`, gỡ bằng `reset`. §9 thêm rủi ro ledger.                     |

**Bác toàn phần: không có.** Bác một phần: F2 (lập luận «gộp đóng cửa sổ»), F10 (cơ chế «đóng dấu nhầm WO này»),
F3 (giả thuyết role CI — M22). Mọi phần xác nhận đã sửa vào plan.

## 11. Nhật ký thi công (02/10/2026, worktree `C:\dev 2\MediaOS-mailaad`, lane `mediaos_mailaad`)

### 11.1 Bước 1 — chữ ký owner

Owner ký 02/10/2026 MỌI khuyến nghị §6 (D1 (a) + ký trước (a') · D2 · D3 · D4 (a) · D5 · D6 đủ 4 reviewer) — ghi
vào `notes` của WO trong `harness/backlog.mjs` + thêm `apps/api/src/db/schema/mail-config.ts` vào `paths` (D5).
Không seed WO nào (job mã hoá lại D1-c chỉ seed nếu PROD có hàng mà thiếu mật khẩu lúc deploy).

### 11.2 Bước 2 — RED trên base (code sản phẩm chưa vá)

Lệnh §8 bước 2 (runner lane `mailaad`) ⇒ `Test Files 5 failed | 6 passed (11)` · `Tests 31 failed | 125 passed (156)`
(baseline trước khi thêm test: `10 passed (10)` · `128 passed (128)` — khớp M17).

**ĐỎ HÀNH VI (bằng chứng deny-path — đỏ đúng ở hành vi được assert):**

- service «CÓ password» — `expected '<uuid>' to be '["<uuid>",…'` (ngữ cảnh encrypt là id trần).
- service «VẮNG password + đích KHỚP» — `expected '11111111-…' to be '["11111111-…'` (ngữ cảnh decrypt là id trần).
- service «decrypt thất bại» — `expected 'Không giải mã được mật khẩu đã lưu.' to be 'Không dùng được mật khẩu đã lưu — vui…'` (D2).
- service ca `:342` đã sửa — `expected "logger.error" to be called once, but got 0 times` (D3; base log `warn`).
- invite «gửi thật» — diff `recordId: "00000000-0000-4000-8000-0000000000aa"` ≠ bộ năm JSON.
- invite ca mới «giải mã THẤT BẠI» — `expected "Logger.error" to be called once, but got 0 times` (D3; base `warn`, thiếu config id — M9).
- R-B1 port / username / host — `expected { ok: true } to deeply equal { ok: false, …(1) }` (mật khẩu đã lưu tới đích đã bị sửa); R-B1 secure — `errorMessage` TLS («Lỗi TLS/chứng chỉ …») ≠ câu D2 (đã mở TLS tới L).
- R-B2 port / username / host — `expected { sent: true } to deeply equal { sent: false, …(1) }`; R-B2 secure — `expected { sent: false, reason: 'send_failed' } to deeply equal …`.
- R-B4 — `expected { sent: true } to deeply equal { sent: false, …(1) }` (DELETE+INSERT tái dùng id + chép envelope qua được — M3).
- R-B5 host / username — `expected 200 to be 400` (body 200 mang `host "a�b.test"` / `username "mailer�@…"` — PG lưu U+FFFD, M11).
- R-B7 — `promise resolved "{ …(18) }" instead of rejecting` (id chữ HOA bị thay bằng id chữ thường — M24).

**ĐỎ CẤU TRÚC (export chưa có — M18; KHÔNG tính là bằng chứng deny-path):** `mail-destination.spec.ts` 11/11
`TypeError: (0 , smtpSecretContext) is not a function` · service ca D4 `TypeError: MailDestinationNotPersistedError is
not a constructor` · envelope ca 3b `TypeError: (0 , smtpSecretContext) is not a function`.

**XANH trên base có chủ ý:** R-B6 (id đã gắn từ trước — khoá mutant M5) · P-B1 (đối chứng dương — khoá mutant
M10/M16) · service «lỗi LẬP TRÌNH ném nguyên» (khoá mutant «bắt mọi lỗi thành 400»).

Lượt RED đầu có 32 đỏ: P-B1 đỏ vì LỖI TEST (`E.connections` cộng dồn cả file — P3 kết nối E) ⇒ sửa đo E TRONG phần
act (`connectionsDuring`) rồi chạy lại: P-B1 xanh trên base như thiết kế. Spy log đặt `mockName` để thông điệp đỏ
nêu đúng mức (`logger.error` / `Logger.error`) thay vì `"spy"` chung.

### 11.3 Bước 3 — GREEN

Helper `smtpSecretContext` + thẻ `SMTP_ENVELOPE_UNUSABLE_TAG` + `MailDestinationNotPersistedError`
(`mail-destination.ts`) → 3 call-site (PUT encrypt, `testConnection` decrypt, lời mời decrypt) + ca 3b → D2 (câu)
· D3 (`logger.error` + thẻ + company + config ở cả hai nơi) → D4 (`assertPersistedAsBound` ở hai nhánh INSERT của
repo: id lệch ⇒ `Error` lập trình, đích lệch ⇒ 400) → docblock (repo, service, `EncryptCtx`, schema D5).
`pnpm --filter @mediaos/api typecheck` sạch. Cùng lệnh §8 bước 2, MỘT lần, cùng lane ⇒ `Test Files 11 passed (11)`
· `Tests 156 passed (156)` (credexfil int-spec 26 ca chạy thật, envelope 7, `mail-destination.spec` 11).
B2 grep: `SMTP_SECRET_PURPOSE` trong `apps/api/src/**/*.ts` không-spec chỉ còn ở `mail-destination.ts`.

### 11.4 Bước 4 — mutant M1–M16 (§5.3)

Mỗi mutant: `cp` sao lưu → cấy (script Python, không qua Edit/formatter) → chạy NGUYÊN lệnh §8 bước 2 trên lane
`mailaad` → `cp` khôi phục → `cmp` với bản sao lưu + `git diff --quiet` (không bao giờ `git checkout --`). 16/16
ĐỎ, đều đỏ ở hành vi được assert (không 500/biên dịch/timeout); sau cả loạt `git status` sạch.

- M1 bỏ `host` — `4 failed | 7 passed` file · `8 failed` ca: R-B1/R-B2 host (`expected { ok: true }` / `{ sent: true }`), unit «đổi host», ctx LITERAL service/invite.
- M2 bỏ `port` — 9 đỏ: R-B1/R-B2 port, **R-B4** (`expected { sent: true } …`), unit «đổi port», ctx LITERAL.
- M3 bỏ `username` — 8 đỏ: R-B1/R-B2 username (`{ ok: true }` — L nhận AUTH EVIL_USER/STORED), unit. Lượt chạy đầu
  của M3 gặp `ERR_IPC_CHANNEL_CLOSED` (worker chết, file credexfil không báo) ⇒ chạy lại 1 lần: hoàn tất, kết quả trên.
- M4 bỏ `secure` — 8 đỏ: R-B1 secure (câu TLS ≠ câu D2), R-B2 secure (`send_failed` ≠ `decrypt_failed`), unit.
- M5 bỏ `id` — 7 đỏ: **R-B6** (`expected { sent: true } to deeply equal { sent: false, …(1) }`), unit «đổi id».
- M6 lời mời giữ ctx cũ — 3 đỏ: R3 có sẵn (`expected { sent: false, …(1) } to deeply equal { sent: true }`), P-B1, unit invite ctx.
- M7 `testConnection` giữ ctx cũ — 4 đỏ: P1/P3 có sẵn + P-B1 (`expected { ok: false, …(1) } to deeply equal { ok: true }`), unit service ctx.
- M8 PUT encrypt giữ ctx cũ — 6 đỏ: P1 · R3 · P3 · P-B1, envelope ca 3b (`Error: decrypt failed`), unit service ctx.
- M9 `.join("|")` — 7 đỏ: unit cặp va chạm (`expected '…|…' not to be '…|…'`), ca ký tự điều khiển, ca `[`, ctx LITERAL. (Int-spec xanh — encrypt/decrypt cùng ngữ cảnh; chỉ unit bắt được, đúng §5.3.)
- M10 gắn thêm `fromEmail` — 7 đỏ: **P-B1** (`expected { sent: false, …(1) } to deeply equal { sent: true }`), unit «nguồn là HÀNG đủ cột».
- M11 bỏ vế đích của B4 — 2 đỏ: R-B5 host + username (`expected 200 to be 400`).
- M12 log lời mời bỏ `config=` — 1 đỏ: `expected 'smtp-envelope-unusable: …' to contain 'config=00000000-…'`.
- M13 log lời mời về `warn` — 1 đỏ: `expected "Logger.error" to be called once, but got 0 times`.
- M14 log `testConnection` về `warn` — 1 đỏ: `expected "logger.error" to be called once, but got 0 times`.
- M15 bỏ vế `row.id === recordId` — 1 đỏ: R-B7 `promise resolved "{ …(18) }" instead of rejecting`.
- M16 (mutant của TEST) WHERE bước sửa hàng `scope='khong-co'` — 9 đỏ: P-B1 + mọi R-B1/R-B2 ở
  `bước sửa hàng phải chạm đúng 1 hàng: expected +0 to be 1` — tiền điều kiện không xanh-rỗng.
