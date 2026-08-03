# Micro-plan — `S7-CHAT-BE-7` (🔴 red · crown-jewel · **FULL gate**: `security-reviewer` + `silent-failure-hunter` + `database-reviewer`) — rev 1 (03/08/2026)

> **WO:** Đường **đọc-vượt membership** (CHAT-DEC-004) — controller + service RIÊNG `/chat/oversight/*`,
> CHỈ ĐỌC, cặp `('view','chat-oversight')`, audit trong **cùng transaction** trước khi trả dữ liệu.
> **Nguồn sự thật:** [SPEC-15 §3.3](<../SPEC/SPEC-15 CHAT.md>) (bảng 7 ràng buộc) · §9 CHAT-SCREEN-007/008 ·
> §12 CHAT-ERR-019/020 · §15 CHAT-API-018/019 · §18 · §20 ca 10/11 · §21 ·
> [API-13 §5.3](<../API Design/API-13_CHAT_API_Design.md>) (8 ràng buộc thi công = điều kiện PASS FULL gate).
> **Memory neo:** `read-path-gate-pair-must-match-download-pair` · `capability-allowlist-hides-admin-screens` ·
> `reused-method-must-be-actor-scoped` · `superadmin-not-a-canonical-role` · `route-census-runtime-gate` ·
> `sensitive-capability-allowlist-is-backend` · `tests-can-pin-a-hole-open`.
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master`).
> **Commit-sha neo:** `HEAD = 712f18c0` — `chore(harness): regen STATUS`, đứng trên `2ec0082f` /
> `1d6ba5d9` (S7-CHAT-BE-6). `git status --short`: **SẠCH** (0 file). Mọi trích dẫn `file:line` bên dưới
> đo trên sha này.
> **Deps:** `S7-CHAT-BE-2` ✅ · `S7-CHAT-BE-3` ✅ (BE-3 nằm trong deps CÓ CHỦ Ý — xem §1.6).

---

## 0. Đo thật trước khi thiết kế

| # | Đo | Kết quả | Hệ quả cho thiết kế |
| - | --- | --- | --- |
| 1 | Cặp `('view','chat-oversight')` đã có trong catalog? | ✅ `0538:419` `is_sensitive = true`; **0** grant cho role canonical (`0538:483`); khối `(F′)` `0538:492+` grant cho role "đang giữ toàn bộ catalog ngoài CHAT" (= `SA` trên PROD) | **KHÔNG cần migration**. WO này thuần code. |
| 2 | Cặp có trong `SENSITIVE_CAPABILITY_ALLOWLIST`? | ✅ `permission.service.ts:184` + `SENSITIVE_SCREEN_GATE_PAIRS:220` | Nợ KI-058 đã trả ở DB-1. WO này chỉ **pin lại bằng test**, không sửa. |
| 3 | `audit_logs.action` có CHECK? | ❌ không (`db/schema/audit.ts:34` `text`) | `chat.oversight.read` dùng được ngay, **không migration**. |
| 4 | `object_type = 'chat_room'` có trong catalog CHECK + union TS? | ✅ dùng bởi 9 action CHAT hiện có (`chat.errors.ts:150-164`) | Tái dùng, không đụng `object_types` CHECK (memory `audit-check-union-parse-anchor-trap`). |
| 5 | Index phục vụ `CHAT-API-019`? | ✅ `idx_audit_logs_action` trên `(company_id, module_code, action, created_at DESC)` (`audit.ts:79`) | Truy vấn 019 bó đúng 3 cột đầu → dùng được index. **Không** assert EXPLAIN (memory `pg-planner-index-assert-trap`). |
| 6 | `ChatMessageFileResolver` có biết cặp `chat-oversight` không? | ❌ chỉ `CHAT_READ_PAIR = view:chat-room` (`chat-message-file.resolver.ts:23`) + `CHAT_SEND_PAIR:26` | Ràng buộc 7 **đã đúng sẵn** → nhiệm vụ WO là **đóng đinh** bằng census tĩnh, không phải sửa. |
| 7 | Census route hiện tại | `totals.routes = 476`, `needVerdict = 52`, `GAP = 0` (`docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`) | Thêm 4 route **có** `@RequirePermission` ⇒ **không** vào `needVerdict`, **không** phải ký `route-verdicts.ts`. Chỉ **regen artifact** (§5). |
| 8 | `chat.permissions.spec.ts:219` khẳng định "0 controller dùng `chat-oversight`" | Quét đúng `CHAT_CONTROLLERS = [Rooms, Messages, Search]` (`:75`) | Controller mới **KHÔNG** được thêm vào hằng đó (jsdoc `:71` đã dặn trước). Nó có bảng gate RIÊNG. |
| 9 | `PermissionGuard` có phải APP_GUARD? | ❌ opt-in per-route (`route-guard-coverage.e2e-spec.ts` ca "@RequirePermission không bao giờ là TRANG TRÍ") | Bỏ `PermissionGuard` = ĐỎ CI. Giữ CẢ HAI guard, đúng thứ tự (§1.2). |
| 10 | `PermissionGuard` có nhánh nào 403 **trước** khi gọi `can()`? | ✅ **CÓ** — PAT out-of-scope (`permission.guard.ts:100-115`), meta vắng (`:78`), user context vắng (`:89`), kill-switch fail-open (`:62`) | 4 nhánh này là **lỗ audit tiềm tàng** của guard audit. Xử lý tường minh ở §1.3 — đây là phần dễ bỏ sót nhất của WO. |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 Bề mặt: 4 route GET, controller + service + repository + mapper RIÊNG

```
GET /api/v1/chat/oversight/rooms                 CHAT-API-018a
GET /api/v1/chat/oversight/rooms/:id             CHAT-API-018b
GET /api/v1/chat/oversight/rooms/:id/messages    CHAT-API-018c
GET /api/v1/chat/oversight/audit                 CHAT-API-019
```

**File MỚI (additive — không sửa file nào của BE-1..BE-6 ngoài 3 điểm chèn ở §2):**

| File | Vai trò |
| --- | --- |
| `apps/api/src/chat/chat-oversight.controller.ts` | 4 route GET. `@Controller("chat")`, path `oversight/*`. |
| `apps/api/src/chat/chat-oversight-audit.guard.ts` | Guard ghi audit `Denied` ở tx RIÊNG ĐÃ COMMIT, rồi `return true`. |
| `apps/api/src/chat/chat-oversight.service.ts` | Đọc + audit `Success` **trong CÙNG tx**. |
| `apps/api/src/chat/chat-oversight.repository.ts` | Truy vấn **KHÔNG** join `chat_room_members` cho vế actor. |
| `apps/api/src/chat/chat-oversight.mapper.ts` | DTO RIÊNG — không tệp có URL ký, không `myRole`, không `unreadCount`. |

**CẤM tuyệt đối** (ràng buộc 1 · API-13 §5.3): tái dùng handler `CHAT-API-001/004/009` kèm cờ `isOversight`;
thêm tham số/cờ bỏ-qua-membership vào `ChatAccessService.assertMember`. §4 có ca census tĩnh chứng minh
`chat-access.service.ts` không chứa chuỗi `oversight` trong mã thực thi và `assertMember` giữ đúng 4 tham số.

### 1.2 Guard: giữ **CẢ HAI**, thứ tự có nghĩa

```ts
@Get("oversight/rooms/:id")
@RequirePermission("view", "chat-oversight", { isSensitive: true })
@UseGuards(ChatOversightAuditGuard, PermissionGuard)   // ⚠️ THỨ TỰ
```

Ba cạm bẫy (API-13 §5.3 ràng buộc 3), cả ba đều PASS review code rồi hỏng:

- (a) ném 403 **trong** tx ghi audit ⇒ dòng `Denied` **bị rollback mất** — đúng thứ ta dựng nó để ghi;
- (b) chỉ `PermissionGuard` ⇒ thân controller **không chạy** ⇒ **0** dòng audit;
- (c) bỏ `PermissionGuard` ⇒ `route-guard-coverage.e2e-spec` ĐỎ ("@RequirePermission trang trí"); bỏ luôn
  metadata ⇒ route rơi vào `needVerdict` và phải ký `route-verdicts.ts` = đưa route nguy hiểm nhất module
  vào rổ "không gate".

`ChatOversightAuditGuard` **KHÔNG BAO GIỜ trả `false`**. Nó chỉ ghi audit rồi `return true`; `PermissionGuard`
phía sau là bên duy nhất ném 403 ⇒ fail-closed vẫn là mặc định, và guard audit không thể vô tình mở quyền.

**Cặp quyền guard audit hỏi = ĐỌC TỪ METADATA `@RequirePermission` của chính route** (qua `Reflector`,
hệt `PermissionGuard`), **không** hard-code `('view','chat-oversight')` lần thứ hai. Hai bản sao của cặp
sẽ trôi, và khi trôi thì guard audit ghi "Denied" cho một cặp trong khi `PermissionGuard` cho qua ở cặp
khác — audit nói dối, im lặng.

### 1.3 Bốn nhánh 403 của `PermissionGuard` — xử lý TƯỜNG MINH (phần dễ bỏ sót nhất)

Bất biến cần giữ: **mọi 403 dưới `/chat/oversight/*` để lại đúng 1 dòng `Denied`.**

| Nhánh `PermissionGuard` 403 | Guard audit làm gì | Vì sao |
| --- | --- | --- |
| `can()` trả `allow:false` (gồm cả infra-error → `deny-default`) | ghi `Denied`, `return true` | đường chính (CHAT-ERR-019) |
| **PAT out-of-scope** (`:100-115`) | **mirror y hệt phép giao `scopeKeys`**, out-of-scope ⇒ ghi `Denied`, `return true` | không mirror ⇒ 403 qua PAT **không để lại dấu vết nào** — đúng lỗ mà WO này tồn tại để bịt |
| meta `@RequirePermission` vắng | `logger.error` + `return true` (**không** ghi audit) | là lỗi cấu hình, không phải hành vi người dùng. Ca §4.2 ép mọi route oversight phải khai meta ⇒ nhánh này không xảy ra trong thực tế |
| user context vắng | `return true` | không có `companyId` thì không mở nổi `withTenant` để ghi |
| `PERMISSION_GUARD_ENABLED=false` (kill-switch fail-open) | `logger.warn` + `return true`, **KHÔNG** ghi `Denied` | lúc đó **không có gì bị từ chối** — ghi `Denied` là **audit sai sự thật**, tệ hơn không ghi. Service phía sau vẫn ghi `Success` như mọi request được cho qua |

**Lỗi hạ tầng bên trong guard** (ghi audit hỏng) → `logger.error` + `return true`. **KHÔNG** biến thành allow,
**KHÔNG** ném 503: `PermissionGuard` phía sau vẫn quyết, nên đường xấu nhất chỉ mất một dòng audit *từ chối*.
Đường **thành công** thì ngược lại (§1.4) — ở đó audit là **điều kiện để dữ liệu rời server**.

### 1.4 Hai mô hình transaction — chốt tường minh

```ts
// THÀNH CÔNG (service) — audit CÙNG tx, ghi TRƯỚC khi trả
return this.db.withTenant(companyId, async (tx) => {
  const rows = await this.repo.…(tx, …);        // 1. đọc
  await this.recordSuccess(tx, …);              // 2. audit — throw ⇒ rollback ⇒ 0 byte ra ngoài
  return dto(rows);                             // 3. dựng DTO TRONG tx, trả sau COMMIT
});
```

- DTO dựng **bên trong** callback: `withTenant` chỉ `return` sau khi COMMIT thành công ⇒ COMMIT hỏng (kể cả
  ở phút chót) vẫn = không có dữ liệu.
- `recordSuccess` bọc `AuditService.record` trong `try/catch` **hẹp** (chỉ quanh lời gọi audit, không bao
  câu đọc) và ném lại `InternalServerErrorException(CHAT_ERR.OVERSIGHT_AUDIT_FAILED)` ⇒ **500** với thân lỗi
  chuẩn API-01. **TUYỆT ĐỐI KHÔNG** `200` + thân rỗng (đó là "đọc-vượt không dấu vết" ngụy trang thành kết
  quả trống — API-13 §8).

```ts
// TỪ CHỐI (guard) — audit tx RIÊNG ĐÃ COMMIT, RỒI mới để PermissionGuard ném 403
await this.db.withTenant(companyId, (tx) => this.audit.record(tx, { …, resultStatus: "Denied" }));
return true;
```

### 1.5 Hình dạng dòng audit (chốt để CHAT-SCREEN-008 lọc đúng và assert "đúng 1 hàng" không lệch)

| Trường | Giá trị |
| --- | --- |
| `action` | `chat.oversight.read` — **một** action cho cả 4 route |
| `objectType` | `chat_room` (đã có trong catalog + union TS) |
| `objectId` | `roomId` với 018b/018c · **`NULL`** với 018a và 019 |
| `resultStatus` | `Success` \| `Denied` |
| `moduleCode` | `CHAT` |
| `actorType` | `User` · `sensitivityLevel` `HighlySensitive` · `permissionCode` `view:chat-oversight` |
| `metadata` | `{ endpoint: '018a'\|'018b'\|'018c'\|'019'\|'unknown', … tiêu chí tìm của 018a, … con trỏ của 018c }` — `'unknown'` thêm ở S7-CHAT-CLEAN-2 cho đường dẫn không khớp khuôn nào đã khai (thà lộ ra là chưa biết, còn hơn mượn nhãn của một endpoint CÓ THẬT) |

**KHÔNG BAO GIỜ** đưa `body` tin nhắn vào audit (SPEC-15 §18 · API-13 §6.8) — kể cả trích đoạn, kể cả đếm
từ khoá. `metadata` của 018a chỉ chứa `q` (chuỗi người dùng tự gõ) + `roomType` + số kết quả.

**Bất đối xứng CÓ CHỦ Ý giữa 019 và 018:**

- **Denied**: ghi cho **cả 4** route — guard đồng nhất, không route nào quên được. Bất biến "mọi 403 dưới
  `/chat/oversight/*` = +1 `Denied`" là thứ grep/test khẳng định được trong một câu.
- **Success**: ghi cho **018a/b/c**, **KHÔNG** cho 019 — API-13 §5.3 bảng ghi rõ cột Audit của 019 là `—`.
  Đọc nhật ký không phải đọc-vượt: nó không tiết lộ một byte nội dung chat nào. Ghi Success cho 019 sẽ làm
  chính CHAT-SCREEN-008 tự sinh nhiễu mỗi lần mở màn (và ai đó sẽ "sửa" bằng cách lọc bỏ, tức bịt mắt sổ).

### 1.6 KHÔNG cấp quyền tải tệp (ràng buộc 7) — hai lỗ, bịt cả hai

1. `ChatMessageFileResolver` **cấm** biết cặp `chat-oversight` (đã đúng — §0 đo 6). Thêm vào sẽ đẻ ra đường
   tải đi qua route FOUNDATION Files, **không dòng audit CHAT nào**.
2. DTO của `018c` trả **metadata tệp** (`fileId` · `name` · `mimeType` · `sizeBytes` · `isImage`) và
   **KHÔNG** có khoá `url`/`thumbnailUrl`. Tái dùng `chatAttachmentSchema` (vốn kèm URL ký, `chat.ts:64-85`)
   làm chính payload oversight **phát ra khoá đọc tệp không cần membership**.

> **Vì sao `S7-CHAT-BE-3` là dependency:** BE-3 là WO gắn URL ký vào DTO tin nhắn. Nếu BE-7 xong trước, BE-3
> có thể gắn URL vào DTO **dùng chung** và mở lại đúng lỗ (2) mà không ai review lại BE-7. Thứ tự này là
> thiết kế, không phải tiện tay.

Repo oversight dùng `listAttachmentsForMessages` (`chat-attachments.repository.ts:225`) — hàm này **không**
mang vị từ §13.4 và **không** trả `url` (nó trả `storagePath`, thứ mapper oversight **không đọc**). Mapper
oversight liệt kê khoá TƯỜNG MINH; `.parse()` qua schema oversight strip mọi khoá thừa. Hai lớp.

### 1.7 `018c` KHÔNG tái dùng truy vấn có JOIN `chat_room_members` (ràng buộc 8)

SA **không có** hàng membership ⇒ vị từ dùng chung `visibleFromSeq…` của SPEC-15 §13.4 sẽ trả **RỖNG** —
hỏng lặng lẽ theo chiều ngược lại (403 giả dạng "phòng trống"). Oversight đọc **toàn dải `seq`** của phòng,
con trỏ riêng `beforeSeq`/`afterSeq` (loại trừ nhau — CHAT-ERR-016), `limit ≤ 100`, cấm `offset`.

`chat-oversight.repository.ts` **không được** import `chat-visibility.ts`. Census tĩnh §4.1 đóng đinh điều đó.

**Tin đã thu hồi VẪN bị che** (`body: null`) ở đường oversight. DEC-004 mở *membership*, **không** mở
*masking* — mở thêm là một năng lực mới không ai chốt. Bản gốc vẫn nằm trong DB cho tranh chấp nội bộ
(§3.4), và đường lấy nó là truy vấn DBA có kiểm soát, không phải một endpoint HTTP.

### 1.8 `018a` hẹp hơn "liệt kê mọi phòng" — ba vế, thiếu vế nào cũng là lỗ

| Vế | Cách làm |
| --- | --- |
| từ khoá ≥ 2 ký tự | `q` BẮT BUỘC, `trim → NFC → min(2).max(200)` (mượn nguyên khuôn `chatSearchQuerySchema`, gồm cả chặn ký tự điều khiển) |
| trần trang, **không phân trang** | `limit` mặc định 20, **max 50**; trả `{ data, truncated }` — `truncated: true` khi còn kết quả. **KHÔNG có con trỏ/offset**: không phân trang thì **không enumerate được bằng cách lật trang**, và UI buộc phải thu hẹp truy vấn. Cắt trang mà im lặng là "silent cap" (bài học `No silent caps`) ⇒ có cờ tường minh |
| audit ghi tiêu chí tìm | `metadata.q` + `metadata.roomType` + `metadata.resultCount` + `metadata.truncated` |

**`018a` KHÔNG trả thành viên.** Đây là vế giữ cho `q` khớp rộng (ví dụ `q="ROOM-"`) vẫn **không** xuất được
đồ thị "ai nhắn riêng với ai": nó chỉ trả `id · roomCode · name · roomType · isArchived · memberCount ·
lastMessageAt · createdAt`. Phòng `direct` có `name = NULL` (mig `0538`) ⇒ tra theo tên không bao giờ ra DM;
muốn xem người trong một DM thì phải gọi `018b` **đích danh một `roomId`**, và mỗi lần gọi là **đúng 1 dòng
audit** — chính là "mở đích danh một phòng" mà owner chốt.

### 1.9 `019` phải BÓ `action` **AND** `module_code`

```ts
where(and(
  eq(auditLogs.companyId, companyId),
  eq(auditLogs.action, CHAT_AUDIT.OVERSIGHT_READ),   // 'chat.oversight.read'
  eq(auditLogs.moduleCode, CHAT_MODULE_CODE),        // 'CHAT'
))
```

Không bó là biến **một cặp quyền CHAT** thành **cổng đọc audit toàn hệ thống**. Ca test bắt buộc: gieo dòng
audit module khác → `019` **không** trả về (§4.3 ca 12).

Phân trang: keyset `(created_at DESC, id DESC)` bằng con trỏ opaque base64 — **không** offset. Trả kèm
`actorName` (join `users`) và `roomCode`/`roomName` (left-join `chat_rooms`, NULL với 018a/019) để
CHAT-SCREEN-008 đọc được mà không phải N+1.

### 1.10 KHÔNG làm (ràng buộc thiết kế, không phải thiếu sót)

- **KHÔNG** `/chat/oversight/search` — SPEC-15 §3.3. Ai thêm phải mở lại CHAT-DEC-004 với owner.
- **KHÔNG** POST/PATCH/DELETE dưới `/chat/oversight/` — SA không gửi/ghim/thu hồi/sửa thành viên được ở
  phòng mình không thuộc.
- **KHÔNG** emit WS cho phiên đọc-vượt — không join `co:{companyId}:chatroom:{roomId}`, không nhận
  `chat:message`. Đọc-vượt là **tra cứu tại một thời điểm**, không phải giám sát liên tục.
- **KHÔNG** endpoint tải tệp oversight (`/chat/oversight/rooms/:id/files/:fileId`) — không có ở v1.
- **KHÔNG** migration (§0 đo 1/3/4).
- **KHÔNG** đụng FE (đó là `S7-CHAT-FE-5`).

---

## 2. Thi công — 3 điểm chèn vào file có sẵn, phần còn lại là file mới

| File có sẵn | Điểm chèn (APPEND, không rewrite) |
| --- | --- |
| `packages/contracts/src/chat.ts` | khối mới ở **CUỐI** file: 8 schema oversight (§3) |
| `apps/api/src/chat/chat.dto.ts` | 3 lớp `createZodDto` ở cuối |
| `apps/api/src/chat/chat.errors.ts` | `CHAT_ERR.OVERSIGHT_AUDIT_FAILED` + `CHAT_AUDIT.OVERSIGHT_READ` |
| `apps/api/src/chat/chat.module.ts` | `controllers: [… , ChatOversightController]` + 4 provider |

`ChatModule` đã import `PermissionModule` (cấp `PermissionService` cho guard) và `AuditService` đến từ
`EventsModule` (@Global) ⇒ **không** cần import mới.

---

## 3. Hợp đồng DTO (contracts — khối APPEND)

| Schema | Ghi chú bảo mật |
| --- | --- |
| `chatOversightRoomQuerySchema` | `q` bắt buộc ≥2 (trim+NFC), `roomType?`, `limit` ≤50 |
| `chatOversightRoomSummarySchema` | **KHÔNG** có `members`, **KHÔNG** có `directKey` |
| `chatOversightRoomListSchema` | `{ data, truncated }` |
| `chatOversightRoomDetailSchema` | summary + `members[]`; **KHÔNG** `myRole`, **KHÔNG** `unreadCount` (vô nghĩa với người ngoài phòng — và `myRole` sẽ buộc phải bịa giá trị) |
| `chatOversightAttachmentSchema` | `fileId · name · mimeType · sizeBytes · isImage` — **KHÔNG** `url`, **KHÔNG** `thumbnailUrl` |
| `chatOversightMessageSchema` | như `chatMessageSchema` **trừ** `attachments` (dùng schema trên), giữ `body: z.string().nullable()` (thu hồi → null) |
| `chatOversightMessagesQuerySchema` | `beforeSeq?`/`afterSeq?` loại trừ nhau, `limit` ≤100 |
| `chatOversightAuditQuerySchema` / `…EntrySchema` / `…ResponseSchema` | `{ data, nextCursor }` keyset |

Không schema nào ở trên `extend` schema có URL ký. Ca §4.1 đóng đinh bằng census tĩnh trên `contracts/src/chat.ts`.

---

## 4. Test — RED trước, **chủ thể là role dựng trong test, KHÔNG phải SA**

> ⚠️ Dùng SA làm chủ thể là **tautology**: SA có `*:*` **và** được grant toàn bộ catalog ⇒ ca positive vẫn
> XANH kể cả khi guard khai sai resource (`chat-oversite`), sai action, hoặc **quên guard hoàn toàn**. Thêm
> nữa lane không set `PLATFORM_SUPERADMIN_EMAIL` thì role SA có thể **không tồn tại**
> (memory `superadmin-not-a-canonical-role`).

### 4.1 Census tĩnh — `chat-oversight.census.spec.ts` (unit, không cần DB)

Dùng `executableCodeOf()` (gỡ comment trước khi assert "KHÔNG chứa" — memory `guard-immutability-matches-comments`).

1. `chat-access.service.ts` mã thực thi **không** chứa `oversight`; `assertMember` giữ **đúng 4** tham số
   (`tx, companyId, roomId, actorUserId`) — chứng minh đường đọc thường gọi nó **vô điều kiện**.
2. `chat-message-file.resolver.ts` mã thực thi **không** chứa `chat-oversight`.
3. `chat-oversight.repository.ts` **không** chứa `chatRoomMembers.userId` / `visibleFromSeq` /
   `chat-visibility` (ràng buộc 8) — nhưng **CÓ** chứa `chatRoomMembers` (018b liệt kê thành viên phòng;
   assert dương tính này chặn ca (1) trở thành "đúng vì file rỗng").
4. `chat-oversight.mapper.ts` + khối oversight của `contracts/src/chat.ts` **không** chứa `url` /
   `thumbnailUrl` / `chatAttachmentSchema`.
5. Không file nào trong `src/chat/**` khai route `oversight` với `@Post/@Patch/@Delete/@Put`.

### 4.2 Gate unit — `chat-oversight.permissions.spec.ts` (mẫu `chat.permissions.spec.ts`)

6. Cả 4 route khai `@RequirePermission('view','chat-oversight',{isSensitive:true})` — **đúng cặp, đúng cờ**.
7. Cả 4 route có **CẢ HAI** guard, `ChatOversightAuditGuard` đứng **TRƯỚC** `PermissionGuard` trong mảng.
8. Mọi method route của `ChatOversightController` đều nằm trong bảng (route mới phải khai cặp).
9. `PermissionGuard` với `can()` → DENY ⇒ 403; hỏi ĐÚNG cặp + `isSensitive:true`.
10. Guard audit: `can()` DENY ⇒ gọi `audit.record` đúng **1** lần với `resultStatus:'Denied'` **và**
    `canActivate` trả `true` (không tự ném 403); `can()` ALLOW ⇒ **0** lần gọi audit.
11. Guard audit: `audit.record` **throw** ⇒ `canActivate` vẫn `true` + `logger.error` (không 503, không allow thêm).
12. Guard audit: `PERMISSION_GUARD_ENABLED='false'` ⇒ **0** dòng audit (không ghi "Denied" sai sự thật).
13. Guard audit: PAT `viaApiKey` với `scopeKeys` **không** chứa cặp ⇒ ghi `Denied` (mirror `permission.guard.ts:100`).
14. `SENSITIVE_CAPABILITY_ALLOWLIST` **có** `view:chat-oversight` (pin lại KI-058 — memory
    `sensitive-capability-allowlist-is-backend`).
15. `chat.permissions.spec.ts` ca `:219` vẫn XANH ⇒ `ChatOversightController` **không** lọt vào `CHAT_CONTROLLERS`.

### 4.3 Integration trên LANE_DB — `chat-be7-oversight.int-spec.ts`

Fixture (mirror `chat-be4-search.int-spec.ts`): tenant A + B; `uOvs` = role dựng trong test **có** cặp
oversight; `uPlain` = role **có đủ 9 cặp CHAT thường nhưng KHÔNG có** cặp oversight; `uMember` = chủ phòng.
Phòng `P_group` (uOvs KHÔNG thuộc), `P_dm` (2 người khác), `P_B` (tenant B). Mỗi ca **đếm `audit_logs`
trước/sau**.

| # | Ca | Khẳng định |
| - | --- | --- |
| 16 | `uPlain` gọi 018b | **403** (CHAT-ERR-019, KHÔNG 404) **và** `audit_logs` **+1** `Denied` **SAU KHI** request đã trả |
| 17 | `uOvs` gọi 018b trên `P_group` | 200, đọc được thành viên; **đúng 1** hàng `Success`, `object_id = P_group`, `module_code='CHAT'` |
| 18 | `uOvs` gọi 018c trên `P_dm` | 200, thấy **toàn dải** tin (kể cả tin trước khi bất kỳ ai vào) — chứng minh §1.7 |
| 19 | Ép ghi audit lỗi (mock `AuditService.record` throw ở đường Success) | **500** + **0 byte** dữ liệu + `audit_logs` **+0** (rollback) — CHAT-ERR-020 |
| 20 | 018c trên phòng có tệp | payload chứa metadata tệp và **0** chuỗi `http`/`url`/`X-Amz-Signature` |
| 21 | `uOvs` gọi `GET /foundation/files/:id/download` cho tệp trong `P_group` | **403** (resolver không biết cặp oversight) |
| 22 | `uOvs` gọi `/chat/search` khớp tin `P_group` | **0** kết quả (SPEC-15 §20 ca 11) |
| 23 | `uOvs` gọi 018b trên phòng tenant B | **404** (cross-tenant) |
| 24 | 018a `q` 1 ký tự | **400/422**; `q` hợp lệ → chỉ metadata, **0** khoá `members` trong payload |
| 25 | 018a trả `truncated:true` khi vượt trần | cờ có mặt (không cắt im lặng) |
| 26 | 019 sau khi gieo audit `module_code='HR'` cùng `action` **và** `module_code='CHAT'` action khác | **không** trả 2 dòng đó |
| 27 | 019 chỉ trả dòng của tenant mình | cross-tenant 0 dòng |
| 28 | `uOvs` thử `POST /chat/oversight/rooms/:id/messages` | **404** route (không tồn tại biến thể ghi) |
| 29 | Tin đã thu hồi trong `P_group` qua 018c | `body: null` (masking không bị DEC-004 nới) |

---

## 5. Route census (memory `route-census-runtime-gate`)

4 route mới **có** `@RequirePermission` ⇒ **không** vào `needVerdict`, **không** phải ký `route-verdicts.ts`.
Nhưng artifact đã commit sẽ lệch (`routes 476 → 480`, `gated 424 → 428`) ⇒ ca "artifact census đã commit khớp
census runtime" ĐỎ nếu quên. Regen:

```bash
ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts
```

---

## 6. Definition of Done

- [ ] 4 route GET, **0** route ghi dưới `/chat/oversight/`; controller/service/repo/mapper RIÊNG.
- [ ] `assertMember` **không** nhận cờ bỏ-qua; census tĩnh §4.1 chứng minh.
- [ ] Hai mô hình transaction đúng như §1.4; ca 19 chứng minh rollback = 0 byte + 500.
- [ ] Cả 4 route giữ CẢ `@RequirePermission` LẪN `@UseGuards(ChatOversightAuditGuard, PermissionGuard)` đúng thứ tự.
- [ ] Mọi 403 để lại +1 `Denied` (gồm nhánh PAT); kill-switch **không** ghi `Denied`.
- [ ] 018c toàn dải seq, con trỏ riêng, **0** URL ký; resolver tệp vẫn mù với cặp oversight.
- [ ] 018a có `q≥2` + trần + `truncated` + audit tiêu chí; **không** trả thành viên.
- [ ] 019 bó `action` AND `module_code`; ca 26 xanh.
- [ ] Census regen; `pnpm typecheck` + `pnpm lint` xanh; int-spec chạy với `LANE_DB`.
- [ ] FULL gate (`security-reviewer` + `silent-failure-hunter` + `database-reviewer`) PASS.

## 7. Rủi ro còn lại (ghi để không ai tưởng đã đóng)

1. **`018a` khớp `room_code` prefix** cho phép liệt kê một trang phòng bất kỳ. Đã hạ rủi ro bằng: 0 thành
   viên trong payload · không phân trang · audit mỗi lần gọi. Không hạ được về 0 mà vẫn giữ tính năng.
2. **Nhật ký chỉ có nghĩa khi xem được** (SPEC-15 §18) — CHAT-SCREEN-008 là `S7-CHAT-FE-5`. Tới lúc FE-5
   xong, kiểm soát này chỉ tồn tại ở tầng dữ liệu.
3. **`ChatOversightAuditGuard` mirror phép giao `scopeKeys` của `PermissionGuard`** — bản sao thứ hai, sẽ
   trôi nếu `permission.guard.ts` đổi luật PAT. Ca 13 khoá hành vi, nhưng không khoá được sự đồng bộ tương lai.
