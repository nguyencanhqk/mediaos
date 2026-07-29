# S6-SEC-NOTITX-1 — KI-034: gộp insert + outbox + audit vào MỘT transaction

> Zone: **red** (audit append-only + đường ghi) · Gate: **FULL** · WO: `S6-SEC-NOTITX-1`
> Nguồn: `docs/RELEASE/RELEASE-02` KI-034 (S1, vá MỘT PHẦN 2026-07-27) ·
> `docs/_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26.md` §7c #8
> Điều kiện của: `S6-REL-1`

---

## 0. Đính chính TRƯỚC KHI CODE — tiền đề của WO đã CŨ

`src[]` của WO và KI-034 đều mô tả `NotificationsService.create()` là **"đường nóng mà MỌI module
đều gọi"**. Đo lại trên `master` (b9ea43f2) thì **KHÔNG ĐÚNG NỮA**:

| Câu hỏi | Lệnh đo | Kết quả |
| --- | --- | --- |
| Ai gọi `NotificationsService.create()`? | `grep -rn "NotificationsService" apps/api/src apps/api/test` trừ chính file + `MyNotificationsService` | **0 caller production**. Chỉ còn: `notifications.module.ts` (provider/export), 2 chú thích ở `realtime-emitter.service.ts`, 1 chú thích ở `my-notifications.service.ts`, và `notifications.spec.ts` (unit) |
| `OutboxNotificationBridge` gọi gì? | `outbox-notification-bridge.service.ts:104` | `NotificationEngineService.intake()` — **KHÔNG** đi qua `NotificationsService` |
| Đường nóng thật có atomic không? | `notification-engine.service.ts:70` | **CÓ**. Một `withTenant` bọc catalog → recipients → render → `persistRecipient` (notification + delivery_log + `audit.record`, `:215`/`:243`). Lỗi không phải dedupe ⇒ `throw` (`:150`), rollback cả intake. Không có `.catch` nuốt |

⇒ Đây là bài học **`wo-plans-built-on-code-comments`** đúng nguyên văn: chú thích "đường nóng" là
di sản của trước S4-NOTI-BE-1/BE-2 (HTTP surface đọc/mark đã chuyển sang `MyNotificationsController`,
đường ghi đã chuyển sang engine). **Vẫn phải vá**, vì:

1. `NotificationsService` **vẫn được `NotificationsModule` export** ⇒ là API công khai; ai wire thêm
   một caller ngày mai là mất audit ngay, không cảnh báo.
2. RELEASE-02 xếp KI-034 là **S1 / Bảo mật (audit)** — BẤT BIẾN #2 (audit append-only, đầy đủ).
   Đóng nợ đã đo ≠ scope mới (RELEASE-05 §4.1).
3. `S6-REL-1` `depends_on` WO này ⇒ không đóng thì không mở được RC.

**Điều chỉnh mức rủi ro:** vì không có caller production, refactor này **KHÔNG có bán kính runtime**.
Cái đắt của WO là *chứng minh* (RED-first) + rà nested-tx, không phải rủi ro hồi quy.

---

## 1. Bug đang vá (nguyên văn code trước khi sửa)

`apps/api/src/notifications/notifications.service.ts`

```text
:137  const rows = await this.repo.create(companyId, data);   // repo TỰ mở + COMMIT tx riêng
:145  await this.db.withTenant(companyId, async (tx) => {      // tx THỨ HAI
:147      await this.outbox.enqueue(tx, {...});
:159      await this.audit.record(tx, {...});
:172  }).catch((err) => { this.logger.warn(...) });            // ⚠️ NUỐT
```

Hệ quả: notification **đã commit** rồi outbox/audit fail ⇒ hàng tồn tại mà **không có vết kiểm toán
và không có sự kiện** — người dùng không bao giờ nhận thông báo, người kiểm toán không bao giờ biết
hàng đó từ đâu ra. Bằng chứng duy nhất là một dòng `warn` trong log.

Cùng lớp lỗi, cùng file: `markRead()` (`:71-88`) — `repo.markRead` commit tx riêng, audit ở tx thứ
hai, `.catch` → `warn`. Vá 2026-07-27 mới chỉ thêm `await` (hết đua với `return`), **chưa** gộp tx.

---

## 2. Đích hội tụ (done_when → việc)

| # | done_when | Việc |
| --- | --- | --- |
| 1 | RED trước | `notifications.spec.ts` + 4 ca mới: outbox ném / audit ném ⇒ `create` **reject** và **KHÔNG** emit WS; chứng minh ĐỎ trên code cũ |
| 2 | `repo.create` nhận `tx`; service mở MỘT `withTenant`; hết nhánh nuốt | §3 |
| 3 | Rà caller nested-tx | §0 (đã đo) + §4 |
| 4 | Docstring khớp code | Viết lại docstring `create` + comment bước 2/3; **xoá** khối "NỢ ĐÃ BIẾT" |
| 5 | Quyết định `markRead` | §5 — **gộp luôn**, có lý do |
| 6 | FULL gate + đóng KI-034 | §7 |

---

## 3. Thiết kế thay đổi

### 3.1 `NotificationsRepository.create(companyId, data, tx?)`

```ts
create(companyId, data, tx?: TenantTx) {
  const run = (t: TenantTx) => t.insert(notifications).values({...}).returning();
  return tx ? run(tx) : this.db.withTenant(companyId, run);
}
```

- `tx` **tuỳ chọn** ⇒ chữ ký cũ vẫn gọi được (không phá caller/test hiện có).
- Giữ nguyên `companyId` trong `values` (RLS `WITH CHECK` vẫn là hàng rào thật).
- Cùng khuôn cho `markRead` (§5).

### 3.2 `NotificationsService.create` — MỘT transaction

```text
1. preference check   (NGOÀI tx — đọc thuần, tx sớm chỉ giữ connection lâu hơn)
2. withTenant(companyId, tx => {
     insert  → repo.create(companyId, data, tx)
     outbox.enqueue(tx, …)
     audit.record(tx, …)
     return dto
   })                 ← ném ⇒ rollback CẢ BA, không còn hàng mồ côi
3. emit WS SAU commit (ngoài tx, best-effort) — giữ nguyên
```

Ba thay đổi hành vi, **có chủ đích**:

| Trước | Sau | Lý do |
| --- | --- | --- |
| outbox/audit fail ⇒ `warn`, trả DTO | ⇒ **ném**, không có hàng nào tồn tại | chính là KI-034 |
| `insert` trả 0 hàng ⇒ `logger.error` + trả `null` | ⇒ **ném** `Error` | `INSERT … RETURNING` 0 hàng là bất khả thi; trả `null` ở đây khiến caller không phân biệt được "bị preference lọc" (bình thường) với "DB hỏng" (S1). Đây là nhánh nuốt lỗi thứ ba trong cùng hàm |
| WS emit chạy kể cả khi outbox/audit hỏng | chỉ emit sau khi commit thành công | không phát cho hàng có thể đã rollback (mirror engine `:157`) |

`return null` **chỉ còn** một nghĩa duy nhất: **bị preference lọc**.

---

## 4. Nested-tx / deadlock

Rủi ro: `withTenant` mở **connection + transaction MỚI** (không phải SAVEPOINT trên tx đang có).
Caller đã ở trong tx khác mà gọi `create()` ⇒ hai tx tranh khoá trên cùng hàng ⇒ **deadlock**, và với
PgBouncer transaction-mode thì còn có thể cạn pool.

Đo: **0 caller production** (§0) ⇒ hôm nay không có rủi ro này.

**Quyết định (YAGNI, ghi rõ để không bị hiểu là bỏ sót):** *không* thêm tham số `tx` cho
`NotificationsService.create` khi chưa có caller nào cần. Thay vào đó:

- `repo.create` **đã** nhận `tx` (§3.1) ⇒ caller-trong-tx tương lai có sẵn đường đi đúng.
- Docstring của service ghi thành ràng buộc: *đang ở trong transaction thì gọi
  `NotificationEngineService.intake()` (đường chuẩn, đã atomic) hoặc `repo.createFromEngine(tx, …)`,
  **KHÔNG** gọi `create()`.*

## 5. Quyết định `markRead` — **gộp vào một tx** (không giữ best-effort)

Chọn gộp, vì:

1. Cùng một lớp lỗi với `create`. Để lại một `.catch` nuốt audit trong **chính file vừa vá vì nuốt
   audit** là mời KI-034 mở lại ở lần gate sau.
2. `mark_read` **đang được audit** ⇒ đã được coi là hành động đáng ghi (SPEC-01 §16.3). Đã đáng ghi
   thì mất vết trong im lặng là sai — hoặc ghi được, hoặc thao tác không xảy ra.
3. Giá của việc "chặt hơn" ở đây = 0: `NotificationsService.markRead` **cũng không có caller
   production** (4 route đọc/mark đã chuyển sang `MyNotificationsController`, xem
   `notifications.controller.ts:18-21`).

Đối trọng đã cân nhắc và **bác**: "audit hỏng không nên làm hỏng thao tác người dùng" — đúng cho một
route đang chạy thật, không đúng cho một method không ai gọi mà giá trị duy nhất của nó là làm khuôn
cho code sau. Ghi chú này nằm luôn trong docstring để lần sau không phải suy lại.

> `markAllRead` **không đụng**: hiện KHÔNG ghi audit (không có gì để mất). Mở rộng phạm vi audit là
> việc khác, không thuộc KI-034.

## 6. Test (RED trước)

Thêm vào `apps/api/src/notifications/notifications.spec.ts` — nhóm **D**. Mock `db.withTenant` đã có
sẵn (`makeDb()` chạy callback với `{}`), đủ để chứng minh **thứ tự + lan truyền lỗi**; tính atomic
thật của Postgres do `withTenant` bảo đảm (đã có test riêng ở tầng int).

| Ca | Nội dung | Trên code CŨ |
| --- | --- | --- |
| D1 | `outbox.enqueue` ném ⇒ `create()` **reject** | ĐỎ (cũ: resolve + warn) |
| D2 | `audit.record` ném ⇒ `create()` **reject** | ĐỎ |
| D3 | outbox ném ⇒ **KHÔNG** `emitter.emitNotification` | ĐỎ |
| D4 | `repo.create` nhận `tx` **cùng object** với `outbox.enqueue`/`audit.record` (một tx duy nhất) | ĐỎ (cũ: repo.create gọi 2 tham số, không có tx) |
| D5 | `repo.create` trả `[]` ⇒ **reject** (không trả `null` câm) | ĐỎ (cũ: resolve `null`) |
| D6 | `markRead`: `audit.record` ném ⇒ **reject** | ĐỎ (cũ: resolve + warn) |
| D7 | `markRead`: `repo.markRead` nhận cùng `tx` với `audit.record` | ĐỎ |

Hồi quy phải giữ xanh: A1–A3, B1–B5, C1–C3 (**11 ca cũ** — 20 ca tổng trừ 9 ca nhóm D; con số
"13 passed" ở §9 là 11 cũ + D5b + D8).

## 7. Gate & đóng sổ

- FULL gate: `security-reviewer` (có trong môi trường).
  `silent-failure-hunter` **KHÔNG có** trong danh sách agent của máy này ⇒ thay bằng: (a) rà tay
  toàn bộ `catch`/`.catch` trong `apps/api/src/notifications/**` + `apps/api/src/events/**`, ghi
  bảng kết quả vào §8 của file này; (b) ca D3/D5 khoá đúng hai nhánh nuốt lỗi. Ghi rõ theo tiền lệ
  `S6-SEC-1` §7c.
- `RELEASE-02` KI-034 → **ĐÓNG**, cập nhật dòng tổng `S1 = 2 mở` → `1 mở` (còn KI-027).
- KHÔNG push thẳng master (zone red) — PR + người chốt.

## 8. Rà `.catch` nuốt lỗi (thay cho silent-failure-hunter)

Quét `apps/api/src/notifications/**` + `apps/api/src/events/**` (trừ `*.spec.ts`) — **11 catch site**.
Sau WO này **KHÔNG còn `.catch()` dạng promise-chain nào** trong hai thư mục (2 site cũ ở
`notifications.service.ts` đã gỡ); tất cả còn lại là `try/catch` block:

| Vị trí | Phân loại | Kết luận |
| --- | --- | --- |
| `notification-engine.service.ts:143` | rollback SAVEPOINT; unique-violation → deduped, **lỗi khác `throw`** | ĐẠT — có chủ đích, fail-loud |
| `notification-event.repository.ts:174` · `notification-template.repository.ts:194` | bắt race unique-violation → re-read + update, còn lại `throw err` | ĐẠT |
| `outbox-notification-bridge.service.ts:101` | `logger.error` + **re-throw** (OutboxWorker retry/dead-letter) | ĐẠT |
| `outbox-worker.ts:151` | lỗi consumer → `attempts++`, hết lượt → dead-letter + alert | ĐẠT — đường retry chính thức |
| `outbox-worker.ts:86` · `:238` · `dead-letter-alert.service.ts:82` | lỗi của *đường cảnh báo*, log `ERROR` kèm stack | ĐẠT — nuốt lỗi alert để không giết vòng claim/dead-letter; đã ghi lý do tại chỗ |
| `task-reminder.job-handler.ts:156` | log `ERROR` + `return false`; caller cộng dồn `failed` vào kết quả job | ĐẠT — quan sát được |
| `push-sender.ts:30` | stub NO-OP (chưa có provider push thật), log `ERROR` | ĐẠT ở mức stub |
| `my-notifications.service.ts:195` (`emitAfterReadChange`) | `logger.warn`, nuốt | **ĐẠT — nhưng có điều kiện**: chỉ bọc **WS emit** (realtime), KHÔNG có audit/outbox trong đó ⇒ không thuộc lớp lỗi KI-034. Realtime hỏng không được làm hỏng giao dịch đã commit là quyết định đúng |

⇒ Không phát hiện nhánh nuốt lỗi nào khác cùng lớp KI-034 (mất **audit** hoặc **sự kiện outbox** mà
chỉ có `warn`). Hai nhánh duy nhất thuộc lớp đó đều nằm trong `notifications.service.ts` và đã bị gỡ.

## 9. Kết quả thi công

**RED-proof** (chạy trên code CHƯA sửa, `notifications.spec.ts`):
`7 failed | 13 passed (20)` — đỏ đúng D1·D2·D3·D4·D5·D6·D7; D5b + D8 (hai ca hồi quy) xanh cả hai
phía, tức chúng không "đỏ vì mọi thứ đều đỏ".

**GREEN sau vá**: `src/notifications/**` = **85/85 xanh** (8 file).

**Suite đầy đủ dưới `LANE_DB=mediaos_notitx`** (449/449 file api CHẠY THẬT — không phải skip): mỗi
lần chạy có **1 test đỏ, nhưng KHÁC test mỗi lần** — lần 1: 2 đỏ; lần 2: `noti-qa-permission` C01;
lần 3: `task-actions` D-18/D-19. Cả hai **xanh 54/54 khi chạy cô lập**. Đã dựng **baseline trên
`master` (b9ea43f2)** ở worktree riêng, cùng lane DB: kết quả **y hệt** —
`449/449 file chạy · 4 lần chạy lại (crash hạ tầng) · 1 ĐỎ THẬT`. ⇒ Đây là **flake sẵn có dưới tải
chunk song song**, KHÔNG do WO này (diff chỉ chạm NOTI service/repo vốn 0 caller production; TASK FSM
không thể chạm tới). Cùng họ với bài học `vitest-worker-crash-chunked-runs` +
`super-admin-bootstrap-flaky-count` (re-run cô lập trước khi gate).

> ⚠️ Ghi để đợt sau đo tiếp: KI-014 đóng 27/7 với kết luận "chunk hoá là đủ". Dưới `LANE_DB` thì
> **vẫn còn** 4 lần "crash hạ tầng" + 1 đỏ trôi mỗi lần chạy. Chunking đang *che* triệu chứng bằng
> retry chứ chưa hết. Không mở KI mới ở WO này (chưa đo đủ để quy gốc), nhưng nếu `S6-REL-1` cần một
> lần chạy XANH TUYỆT ĐỐI thì đây là việc phải giải quyết trước.

### 9.1 FULL gate — kết quả

`security-reviewer` (độc lập, read-only): **PASS — 0 CRITICAL / 0 HIGH**.
`silent-failure-hunter` KHÔNG có trong môi trường ⇒ thay bằng §8 (rà tay 11 catch site) + ca D3/D5
khoá hai nhánh nuốt lỗi. Ghi rõ theo tiền lệ `S6-SEC-1` §7c.

Reviewer **tự kiểm chứng độc lập** (không tin lời khai của người thi công) và xác nhận: 0 caller
production/test của `NotificationsService` (kể cả `ModuleRef.get`/`useFactory`); `withTenant` vẫn bọc
đúng mọi câu lệnh và hàng rào thật là RLS `USING` + `WITH CHECK` ở mig `0010:33-35`; `object_type =
'notification'` CÓ trong CHECK union của `audit_logs` (`0090_g12:49`) — điểm này quan trọng vì audit
fail nay là **fatal** cho create, nếu object_type ngoài catalog thì WO này biến `warn` thành sập
luồng; nhóm D **có thể đỏ thật**, khớp đúng 7 đỏ / 13 xanh.

**Đã sửa theo gate (đều là docstring/test, KHÔNG đổi logic):**

| # | Mức | Nội dung | Đã làm |
| --- | --- | --- | --- |
| F1 | MEDIUM | Gộp-tất-cả-vào-một-tx khoá cửa cho audit của nhánh **THẤT BẠI/DENIED** (bị chính exception nó ghi lại cuốn theo). Tiền lệ thật: `me-personal-hub.int-spec.ts:476-482` | Thêm cảnh báo vào docstring `create` + `markRead` |
| F2 | MEDIUM | `tx?` mới mở đúng đường tái tạo KI-034: gọi thẳng `repo.create(…, myTx)` ⇒ hàng notification không audit/outbox/preference | Docstring repo ghi rõ **nghĩa vụ của caller truyền `tx`** |
| F4 | LOW | D4/D7 chỉ đếm số lần gọi `withTenant`, không khoá đối số `companyId` — thứ quyết định GUC `app.current_company_id` | Thêm `toHaveBeenCalledWith(CO_A, expect.any(Function))` cả hai ca |
| F6 | LOW | §6 ghi "13 ca cũ" — đúng là **11** | Sửa |

**Ghi nhận, KHÔNG sửa ở WO này:**

- **F3 (LOW)** — nhánh `: this.db.withTenant(companyId, run)` của `repo.create`/`markRead` hiện là
  dead code (caller duy nhất luôn truyền `tx`). Vô hại, giữ để không phá chữ ký; dọn ở đợt sau.
- **F5 (LOW)** — tính atomic ở WO này chứng minh ở tầng **mock** (lan truyền lỗi + cùng một tx
  object), không phải rollback thật trên Postgres. Reviewer đã verify claim của §6 là ĐÚNG: cơ chế
  `withTenant`/rollback có int-spec thật (`outbox.int-spec.ts:29`, `lms-user-sync.int-spec.ts:175`,
  `lms-sso-audit.int-spec.ts:163`). Chấp nhận vì bán kính runtime = 0; **ngày nào xuất hiện caller
  thật thì BẮT BUỘC thêm int-spec cho đúng tổ hợp này**.
- **INFO — ngoài diff:** `my-notifications.service.ts:112-160` (đường THẬT đang chạy: markRead /
  markAllRead / remove) **KHÔNG ghi audit dòng nào**. Soft-delete vẫn đúng BẤT BIẾN #2 nhưng không
  có vết kiểm toán. KI-034 đóng đúng phạm vi của nó (nuốt audit bằng `.catch`); **đừng đọc dòng
  RELEASE-02 mới thành "đường ghi NOTI đã đủ audit"**. Cần đối chiếu SPEC-08 xem mark/xoá thông báo
  có thuộc "hành động quan trọng" (SPEC-01 §16.3) không — nếu có thì mở KI riêng. Chưa mở ở đây vì
  chưa verify SPEC-08.

**Thay đổi**: 3 file code
`notifications.repository.ts` (`create`/`markRead` nhận `tx?`) ·
`notifications.service.ts` (`create` + `markRead` gộp 1 tx, gỡ 2 `.catch`, gỡ khối "NỢ ĐÃ BIẾT",
docstring viết lại) · `notifications.spec.ts` (+9 ca, A3 nới đúng arity mới — **không** nới ý).
