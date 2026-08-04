# S7-CHAT-BE-9 🔒 — CHAT-API-019 nhận bộ lọc `actorUserId` + `from`/`to` (giữ keyset)

> Nguồn: SPEC-15 §9 (CHAT-SCREEN-008) · §15 (CHAT-API-019) · §18 · API-13 §5.3 · `docs/plans/S7-CHAT-FE-5.md` §0.4/§6.
> Zone **đỏ** (đường đọc-vượt membership = bề mặt rủi ro lớn nhất module). Gate **FULL**.

---

## 0. Đo hiện trạng (04/08/2026, trên master `9cb57bae`)

| # | Câu hỏi | Đo được | Hệ quả cho WO |
| --- | --- | --- | --- |
| 1 | 019 nhận tham số gì? | `chatOversightAuditQuerySchema` = `{ cursor?, limit }` ĐÚNG 2 trường (`packages/contracts/src/chat.ts:608`) | Phải nới, không có gì để reconcile |
| 2 | Vế bó cứng còn nguyên? | ✅ `eq(action, CHAT_AUDIT.OVERSIGHT_READ)` + `eq(moduleCode, CHAT_MODULE_CODE)` (`chat-oversight.repository.ts:330-333`) | GIỮ NGUYÊN — bộ lọc mới chỉ được **thu hẹp thêm**, đứng SAU hai vế này |
| 3 | 019 có ghi audit `Success` không? | ❌ KHÔNG — `listAudit` không gọi `recordSuccess` (`chat-oversight.service.ts:176-199`); ca 27c đóng đinh | Giữ nguyên. Thêm bộ lọc **không** phải lý do đổi |
| 4 | Con trỏ hiện tại | `encodeChatSearchCursor(sortAt, id)` — codec DÙNG CHUNG với `/chat/search`, KHÔNG mang dấu vân bộ lọc | Cần lớp bọc riêng cho 019, **không** sửa codec dùng chung |
| 5 | FE lọc ở đâu? | `filterAuditEntries()` client-side trên `loadedRows` + nhãn `audit.scopeNotice` "chỉ áp trên các dòng đã tải" | Gỡ cả hai; ca FE `[crown] nhãn phạm vi…` (`chat-oversight-audit-page.spec.tsx:131`) đang PIN hành vi cũ ⇒ phải sửa ca đó |
| 6 | TZ công ty lấy ở đâu? | ⚠️ **ĐÍNH CHÍNH sau FULL gate 04/08** — đo ban đầu chỉ thấy khoá KV `company.timezone` (`setting-defaults.ts:147`) và WO đọc nó qua `SettingService`. Đo lại: khoá KV đó **KHÔNG có writer nào** (`company_settings` + `system_settings` đều 0 hàng). Nguồn THẬT = cột **`companies.timezone`**, ghi bởi `PATCH /settings/company` (`SettingsService.updateCompanySettings`, có `assertValidTimezone` ở biên) và đã được DASHBOARD đọc (`dashboard-widget-handlers.service.ts:355`) | Đọc cột `companies.timezone`; **KHÔNG** cần `SettingsModule`. Ca 26e phải ghim **NGUỒN**, không chỉ ghim CƠ CHẾ |
| 7 | Có helper wall-time→instant chưa? | ✅ `apps/api/src/common/tz.util.ts` — `wallTimeToInstant` (two-pass DST-safe, ADR-0008) + `addDaysToLocalDate` + `assertValidTimezone` | Tái dùng, KHÔNG viết bản thứ hai |
| 8 | Mã lỗi mới? | `CHAT-ERR-016` = "con trỏ phân trang không hợp lệ" (SPEC-15 §12:338) và 019 ĐÃ dùng nó qua `decodeChatSearchCursor` | Con trỏ lệch bộ lọc = **CHAT-ERR-016**, hằng mới nhưng **không** đẻ mã ngoài sổ |
| 9 | `.refine()` mức object có chạy với `createZodDto`? | ✅ tiền lệ `chat.ts:183` (`superRefine`) và `auth.ts:318` (`from_date <= to_date` trên **query** DTO) | Dùng `.refine` cho `from <= to` |

---

## 1. Hợp đồng chốt

```text
GET /api/v1/chat/oversight/audit
  ?cursor=<opaque>        (đã có)
  &limit=1..100           (đã có, mặc định 50)
  &actorUserId=<uuid>     (MỚI)
  &from=YYYY-MM-DD        (MỚI — NGÀY, không phải datetime)
  &to=YYYY-MM-DD          (MỚI — NGÀY, BAO GỒM cả ngày này)
```

### 1.1 `from`/`to` là NGÀY và quy đổi ở SERVER

`z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` + `.refine` kiểm ngày CÓ THẬT (chặn `2026-02-31`) — **không**
`z.coerce.date()`: `coerce.date()` nuốt luôn `"2026-08-04T17:00:00Z"`, tức là mở lại đúng cánh cửa
"client tự quy đổi múi giờ" mà `done_when` đóng.

Quy đổi ở server theo TZ công ty (cột `companies.timezone`):

```text
fromInstant          = wallTimeToInstant(from, "00:00:00", tz)                     // >= (bao gồm)
toInstantExclusive   = wallTimeToInstant(addDaysToLocalDate(to, 1), "00:00:00", tz) // <  (nửa mở)
```

⚠️ **Biên trên phải NỬA MỞ, không phải `<= to 23:59:59.999`.** `audit_logs.created_at` là `timestamptz`
(micro-giây); một dòng lúc `23:59:59.9995` **lớn hơn** `23:59:59.999` ⇒ mốc đóng làm mất đúng những dòng
cuối ngày, HTTP 200, không lỗi. Cùng họ bẫy với `date_trunc('milliseconds')` của con trỏ.

⚠️ **So sánh trên `created_at` THÔ**, không trên `date_trunc('milliseconds', …)`: `sortAt` chỉ là khoá
sắp xếp/con trỏ. Trộn hai thứ làm biên cửa sổ lệch tới 1ms so với thời điểm thật.

TZ đọc từ **cột `companies.timezone`** — nguồn mà màn Cài đặt công ty thật sự ghi và DASHBOARD đã đọc.
Đọc khoá KV cùng tên là đọc **hàng chết**: khai trong DB-10 §11.2 nhưng không writer nào, nên admin đổi
múi giờ ⇒ DASHBOARD theo TZ mới còn CHAT-SCREEN-008 vẫn cắt theo mặc định, mất nửa ngày bằng chứng, HTTP
200, không tín hiệu. (Khoá KV để lại nguyên; nếu owner chốt nó là canonical thì phải đổi cả DASHBOARD
trong cùng nhịp — hai định nghĩa "ngày của công ty" cùng sống là chỗ drift tiếp theo.)

Hàng công ty hỏng/vắng ⇒ **fail-safe về mặc định + `logger.warn` ở MỌI nhánh degrade**, KHÔNG ném: màn
nhật ký là công cụ điều tra, chết cả màn vì một ô cấu hình hỏng là tệ hơn lệch múi giờ. Mặc định lấy từ
`getSettingDefault` (registry DB-10 §11.2) — KHÔNG hard-code chuỗi thứ ba (`dashboard` đã có một bản).

### 1.2 Bộ lọc chỉ được THU HẸP

Thứ tự vế trong `where` giữ nguyên: `company_id` → `action` → `module_code` → **rồi mới** tới bộ lọc mới.
Ba vế đầu là BẤT BIẾN của 019; chúng đứng trước để đọc code là thấy ngay 019 không thể thành cổng đọc
`audit_logs` toàn hệ thống.

### 1.3 Con trỏ phải MANG DẤU VÂN BỘ LỌC

**Vấn đề:** con trỏ hiện tại chỉ mang `(sortAt, id)`. Sinh ở trang có `actorUserId=A` rồi dùng lại với
`actorUserId=B` → server vẫn trả 200 với một trang **hợp lệ về cú pháp nhưng sai về ngữ nghĩa** (nó cắt
theo mốc thời gian của một tập kết quả khác). Người điều tra không có cách nào biết.

**Chốt:** file MỚI `apps/api/src/chat/chat-oversight-audit-cursor.ts` **bọc** codec dùng chung:

```text
<base64url(sortAt|id)>.<fingerprint>          // fingerprint = 16 hex đầu của sha256(canonical filter)
```

- Dấu `.` an toàn: bảng chữ base64url là `A-Za-z0-9-_`.
- Fingerprint tính trên **instant đã quy đổi**, không trên chuỗi ngày thô ⇒ đổi `companies.timezone` giữa
  hai lần lật trang cũng làm con trỏ hết hiệu lực (đúng: cửa sổ đã dịch).
- Thiếu vế fingerprint, hoặc fingerprint lệch → **400 `CHAT-ERR-016`**, KHÔNG im lặng trả sai trang.
  Không có nhánh tương thích ngược cho con trỏ cũ: module CHAT còn `is_active = false`, chưa có client
  nào ngoài `apps/console` — một nhánh "cursor không fingerprint thì bỏ qua kiểm tra" chính là lỗ này.
- **KHÔNG sửa `chat-search-cursor.ts`.** Luật cắt-về-mili-giây chỉ được có MỘT bản; WO này bọc chứ không
  nhân bản.

### 1.4 KHÔNG đổi mô hình audit

019 vẫn **không** ghi `Success` (API-13 §5.3, cột Audit = `—`). Ca 27c giữ nguyên và phải còn xanh sau khi
thêm bộ lọc.

---

## 2. Bản đồ thay đổi

| File | Loại | Nội dung |
| --- | --- | --- |
| `packages/contracts/src/chat.ts` | sửa | `chatOversightAuditQuerySchema` += `actorUserId?`/`from?`/`to?` + `.refine(from <= to)` |
| `apps/api/src/chat/chat-oversight-audit-cursor.ts` | **mới** | encode/decode con trỏ CÓ fingerprint (bọc `chat-search-cursor`) |
| `apps/api/src/chat/chat-oversight-audit-filter.ts` | **mới** | hàm THUẦN: query ngày → `{ actorUserId?, fromInstant?, toInstantExclusive? }` theo tz |
| `apps/api/src/chat/chat-oversight-audit-cursor.spec.ts` | **mới** | unit colocated |
| `apps/api/src/chat/chat-oversight-audit-filter.spec.ts` | **mới** | unit colocated (gồm ca DST) |
| `apps/api/src/chat/chat.errors.ts` | sửa | `+ OVERSIGHT_CURSOR_FILTER_MISMATCH` (vẫn mã `CHAT-ERR-016`) |
| `apps/api/src/chat/chat-oversight.repository.ts` | sửa | 3 vế lọc tuỳ chọn, ĐỨNG SAU 3 vế bó cứng |
| `apps/api/src/chat/chat-oversight.service.ts` | sửa | resolve tz (chỉ khi có `from`/`to`) → dựng filter → decode/encode con trỏ có fingerprint |
| `packages/web-core/src/lib/chat-api.ts` | sửa | docblock `listAudit` đang DẠY lọc client-side — lời hứa ngược với hợp đồng vừa ship |
| `apps/api/test/integration/chat-be7-oversight.int-spec.ts` | sửa | +6 ca (26c…26h) |
| `apps/console/…/chat-oversight-audit-page.tsx` | sửa | bộ lọc vào `queryKey` + gửi lên server; gỡ lọc client; đổi nhãn phạm vi |
| `apps/console/…/chat-oversight-format.ts` | sửa | **xoá** `filterAuditEntries` + `dayKeyOf` (chết); `+ mergeActorOptions` |
| `apps/console/…/chat-oversight-format.spec.ts` | sửa | bỏ ca của hàm đã xoá, thêm ca `mergeActorOptions` |
| `apps/console/…/chat-oversight-audit-page.spec.tsx` | sửa | ca `[crown] nhãn phạm vi` đổi sang "lọc ở SERVER"; thêm ca "đổi bộ lọc ⇒ gọi lại API kèm tham số" |
| `apps/console/src/i18n/locales/vi/chat-oversight.json` | sửa | `scopeNotice`/`scopeMore` + `filter.actorHint` |
| `docs/API Design/API-13_CHAT_API_Design.md` | sửa | dòng CHAT-API-019 + ghi chú ràng buộc bộ lọc |
| `docs/SPEC/SPEC-15 CHAT.md` | sửa | §9 CHAT-SCREEN-008 + §15 CHAT-API-019 |

**KHÔNG migration.** Bộ lọc dùng đúng tiền tố index `idx_audit_logs_action`
`(company_id, module_code, action, created_at DESC)`; `actor_user_id` là vị từ dư — **không assert EXPLAIN**
(memory `pg-planner-index-assert-trap`).

---

## 3. Ô UI: danh sách "Người thực hiện" sau khi lọc chuyển sang server

Hôm nay `<option>` rút từ `loadedRows` bằng `distinctActors`. Khi lọc chạy ở server, lọc theo A xong thì
`loadedRows` chỉ còn A ⇒ **option của những người khác biến mất** và người dùng kẹt (chỉ còn nút Đặt lại).

Chốt: tích luỹ **đơn điệu** — `mergeActorOptions(prev, next)` trả về CHÍNH `prev` khi không có gì mới (để
`setState` bail-out, không vòng lặp render). Kèm dòng gợi ý dưới nhãn: danh sách người rút từ các dòng đã
tải, còn **kết quả lọc thì áp trên toàn bộ nhật ký ở server**. Hai câu đó không mâu thuẫn và cả hai đều đúng.

---

## 4. Test — RED trước

Chủ thể là `uOvs`/`uPlain` **dựng trong test** (đã có sẵn ở int-spec BE-7). KHÔNG dùng SA
(memory `superadmin-not-a-canonical-role`).

| Ca | Nội dung | Vì sao |
| --- | --- | --- |
| 26c | Gieo dòng audit module **HR** + **cùng `actorUserId`**, gọi `?actorUserId=<đó>` ⇒ **không** trả dòng HR | `done_when` #2 — bộ lọc không được nới vế bó cứng |
| 26d | `?actorUserId=X` chỉ trả dòng của X; đối chứng dương: bỏ lọc thì thấy cả X lẫn Y | lọc thật, không phải no-op |
| 26e | `from`/`to` cắt đúng theo **ngày công ty**: gieo qua `directPool` một dòng lúc `17:30Z` (= 00:30 hôm sau giờ VN) ⇒ lọc `from=to=<ngày VN hôm sau>` **thấy**, lọc ngày UTC **không thấy** | `done_when` #1 — quy đổi ở SERVER |
| 26f | Con trỏ sinh với `actorUserId=A` dùng lại với `actorUserId=B` ⇒ **400**, thân lỗi mang `CHAT-ERR-016` | `done_when` #3 |
| 26g | Phân trang CÓ bộ lọc: `limit=1` + lật 2 trang, không lặp/không sót, tất cả đều thuộc A | keyset vẫn đúng khi có filter |
| 26h | `from > to` ⇒ 400; `from=2026-02-31` ⇒ 400 | validate biên |
| 27c | (đã có) đọc 019 vẫn **không** sinh `Success` — chạy lại KÈM bộ lọc | `done_when` #4 |

Unit colocated: fingerprint (encode→decode vòng khứ hồi · lệch filter · thiếu vế `.` · rác), filter
(nửa mở · ngày không có thật · tz lạ → fallback · DST gap).

Chạy: `bash harness/check.sh --lane-db=chatbe9` (memory `integration-test-lane-db-gate` — thiếu `LANE_DB`
thì đúng những ca deny-path này bị SKIP và gate vẫn PASS).

---

## 5. Rủi ro đã cân nhắc

1. **Nới 019 thành cổng đọc audit toàn hệ thống** — chặn bằng thứ tự vế `where` + ca 26c.
2. **Con trỏ trôi giữa hai bộ lọc** — chặn bằng fingerprint (ca 26f). Không có đường tương thích ngược.
3. **Client tự quy đổi múi giờ** — chặn bằng kiểu `YYYY-MM-DD` ở hợp đồng (từ chối datetime) + ca 26e.
4. **Sửa `chat-search-cursor.ts`** (rủi ro trôi sang `/chat/search`) — tránh bằng lớp bọc.
5. **Thêm audit `Success` cho 019 "cho đồng bộ"** — cấm; ca 27c giữ.
6. **Xoá `filterAuditEntries` làm chết ca test đang xanh** — memory `review-gate-blind-to-deletions`: ca bị
   xoá phải được thay bằng ca mới ở tầng đúng (server), không im lặng biến mất.

---

## 6. Bằng chứng RED (đo thật, không suy luận)

Ba bất biến được chứng minh là **có canh** bằng cách phá đúng một dòng mỗi cái rồi chạy lại int-spec trên
`LANE_DB=mediaos_chatbe9`. Không có bước này thì một ca xanh không phân biệt được với một ca không đo gì.

| Đột biến | Ca ĐỎ |
| --- | --- |
| Gỡ `eq(auditLogs.moduleCode, CHAT_MODULE_CODE)` khỏi `listOversightAudit` | ca 26 **và** ca 26c |
| `if (false && fingerprint !== fingerprintAuditFilter(filter))` | ca 26f |
| `resolveAuditFilter(query, "UTC")` thay cho TZ công ty | ca 26e |
| **(sau FULL gate)** `resolveCompanyTimeZone` bỏ qua cột, luôn trả mặc định | ca 26e |

Kết quả: `4 failed | 33 passed` khi đột biến · `37 passed` sau khi khôi phục. Ba ca còn lại (26d/26g/26h)
xanh ở cả hai lượt — đúng như thiết kế, chúng canh vế "lọc có tác dụng" chứ không canh ba bất biến trên.

Đột biến thứ tư (sau khi vá HIGH) là ca đắt nhất: bản CŨ của ca 26e gieo vào khoá KV nên **vẫn xanh** khi
service bỏ qua `companies.timezone`; bản MỚI đỏ ngay. Đó là khác biệt giữa "ghim cơ chế" và "ghim nguồn".

**Chốt cuối:** `bash harness/check.sh --lane-db=chatbe9` → **XANH** cả 6 cổng (secret-literals · lint ·
typecheck · migration-no-drop · tooling-tests · test chunked) với `496/496` file `@mediaos/api` thực chạy
— int-spec KHÔNG bị skip.

### `1 ĐỎ THẬT` không có tên ca — ĐÃ khoanh vùng, KHÔNG phải test đỏ

Một lượt check ở giữa báo `1 ĐỎ THẬT` trong `@mediaos/api` mà không in được tên ca. Vòng 2 FULL gate tái
hiện và đo được: chạy full `@mediaos/api` trên LANE_DB, ghi log đầy đủ ra file →

```text
grep -cE "^\s+×"  run.log   → 0            # KHÔNG có assertion nào fail
grep -E "Unhandled|ERR_IPC"  → ERR_IPC_CHANNEL_CLOSED @ tinypool@1.1.1 ProcessWorker.send
exit code                    → 1
```

Tiến trình chết ở **teardown pool** SAU khi file test cuối đã xanh ⇒ không kịp in khối `Test Files /
Tests`, và **`--reporter=json` không kịp flush** (không có file JSON để đọc — đó là lý do "mất tên ca").
Đây là KI-014 (`vitest-worker-crash-chunked-runs`), không phải cờ đỏ nghiệp vụ.

**Công thức triage rẻ, dùng lại được:**

```bash
… vitest run --reporter=basic > run.log 2>&1 ; echo "EXIT=$?"
grep -cE "^\s+×" run.log                              # 0 ⇒ crash pool, KHÔNG phải test đỏ
grep -nE "Unhandled|ERR_IPC_CHANNEL_CLOSED|ENOBUFS" run.log
```

Hai lưu ý: (a) **đừng tin `--reporter=json`** ở đúng chế độ hỏng này — nó chết trước khi ghi file;
(b) `exit 1` + `× = 0` là **chữ ký của crash pool**. Cần chắc hơn thì chia chunk theo thư mục, hoặc
`--pool=forks --poolOptions.forks.singleFork` một lượt đối chứng.

---

## 8. Vòng 2 FULL gate — **PASS**, không còn mục chặn

`security-reviewer` chạy lại trên bản đã vá (resume đúng transcript vòng 1 nên chỉ soi DELTA).

Xác nhận lại bằng đo, không nhận lời khai: `chat.module.ts` **về nguyên trạng master** (bề mặt module hẹp
hơn cả trước khi làm WO) · hai `withTenant` **tuần tự, không lồng**, `set_config(..., true)` là LOCAL nên
không rò GUC · ca 26e/26j chỉ chạm tenant do chính file test tạo ⇒ không ô nhiễm chéo · charter BE-7 không
bị phá (census xanh; đọc `companies` không liên quan ràng buộc 8).

Gộp hai `withTenant` làm một: **đã cân nhắc và bác** — gộp thì `decodeOversightAuditCursor` phải chui vào
trong tx, tức đưa một `BadRequestException` do input người dùng vào trong ranh giới transaction, và giữ
connection suốt cả phép sort. Lợi ích duy nhất (read-consistency TZ↔dòng) đã được **vân con trỏ** phủ.

3 LOW của vòng 2 — **đã vá cả 3**:

| Phát hiện | Xử lý |
| --- | --- |
| `isLoading={audit.isPending}` + query tắt ⇒ bảng quay **5 hàng skeleton VĨNH VIỄN** dưới banner "khoảng ngày bị ngược" — vẫn là tín hiệu "hệ thống treo", chỉ đổi hình dạng. Hồi quy do CHÍNH bản vá `from > to` sinh ra; trước đó không lộ vì nhánh tắt duy nhất (`canOversight=false`) return sớm ở cổng quyền | **Không render bảng** khi bộ lọc không hợp lệ. Render bảng rỗng cũng sai: empty-state đọc thành "Chưa có lần đọc-vượt nào" = trả lời một câu hỏi server CHƯA HỀ được hỏi. Có ca test + **RED-proof** (bỏ điều kiện ⇒ ca đỏ, in ra đúng 5 hàng skeleton) |
| docblock `buildAuditFilter` còn nhắc `SettingService` đã bị gỡ | Vá — đúng họ bẫy đã làm hỏng vòng 1 (comment tả một phụ thuộc đã chết) |
| `chat-oversight-audit-filter.ts` / `-cursor.ts` còn gọi nguồn là khoá KV `company.timezone` | Đổi sang `companies.timezone` + nói rõ khoá KV là hàng chết |

**INFO đáng giữ (đã đưa vào code):** `companies` có HAI policy PERMISSIVE và `companies_all_tenant_read`
mang `qual = true` ⇒ **RLS KHÔNG thu hẹp SELECT trên `companies`**. Vế `eq(companies.id, companyId)` là vế
**chịu lực**; ai "dọn" nó vì tin "đã ở trong `withTenant` rồi" sẽ biến câu thành "lấy múi giờ của một công
ty bất kỳ" — im lặng, HTTP 200. Cảnh báo này giờ nằm ngay cạnh `where`.

**Hạ vị thế từ vòng 1:** "echo múi giờ vào phản hồi" chuyển từ *nên vá* sang **ĐỀ XUẤT, không chặn** — vì
đường ghi đã có `assertValidTimezone`, nhánh degrade đã có test + `logger.warn`, và nguồn đã trùng
DASHBOARD. Mốc nên xem lại: 019 có client ngoài `apps/console`, hoặc hệ chạy nhiều công ty khác múi giờ.

---

## 7. Vòng FULL gate 04/08 — cái gate bắt được

3 reviewer chạy song song trên diff chưa commit: `security-reviewer` **BLOCK (1 HIGH)** ·
silent-failure hunt **PASS** · `completion-evaluator` **BLOCK (87/100)**.

| # | Phát hiện | Xử lý |
| --- | --- | --- |
| **HIGH** | WO đọc TZ từ khoá KV `company.timezone` — **không writer nào**. Ô múi giờ admin thật sự bấm ghi vào cột `companies.timezone`; DASHBOARD đã đọc cột. ⇒ đổi TZ trên UI làm CHAT-SCREEN-008 cắt cửa sổ theo mặc định trong khi DASHBOARD theo TZ mới: mất nửa ngày bằng chứng, HTTP 200, im lặng. Đúng lớp `ui-promises-backend-never-reads`, chiều ngược | **Vá.** Đọc cột; gỡ `SettingsModule` khỏi `ChatModule`; ca 26e **ghim NGUỒN** (UPDATE cột, + đối chứng đổi ngược lại VN) và đã RED-proof |
| MEDIUM ×2 | `packages/web-core/src/lib/chat-api.ts` docblock `listAudit` vẫn khai "server KHÔNG lọc" và **dạy** người sau dựng lại lọc client-side | **Vá** + nới `paths` của WO (không đẩy sang WO khác) |
| MEDIUM ×2 | Nhánh degrade TZ **0 test**, và nhánh "giá trị vắng" im lặng không log | **Vá.** Ca 26j (tz hỏng → 200 + cửa sổ theo mặc định) + `logger.warn` ở MỌI nhánh degrade |
| MEDIUM | Ca 26i/27c không assert status ⇒ một 400 tương lai làm chúng "xanh mà không đo gì" | **Vá.** Assert `200` trước khi đếm audit |
| LOW | `?? "UTC"` là hằng mặc định thứ ba | **Vá.** Gộp về một hằng suy từ registry |
| LOW | FE `setFilter({ ...filter })` — closure cũ, hai `onChange` cùng batch ghi đè nhau | **Vá.** Functional updater |
| — (tôi tự thấy khi đọc lại) | Chuyển lọc sang server làm `from > to` từ "bảng rỗng" thành **400 ⇒ banner "Không tải được nhật ký"**, đọc như hệ thống hỏng | **Vá.** Chặn ở FE + thông điệp đúng nguyên nhân; server VẪN validate |

Còn để lại có chủ đích: FE gộp mọi lỗi thành một thông điệp nên chưa phân biệt được `CHAT-ERR-016`
(thông điệp riêng ở server hiện chưa có ai tiêu thụ) — vá bằng cách đọc `code` ở `apiFetch`, việc đó
chạm hạ tầng lỗi dùng chung của mọi module nên KHÔNG gộp vào WO vùng đỏ này.
