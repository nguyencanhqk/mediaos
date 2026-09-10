# S17-CHAT-UX2-BE-2 — `CHAT-API-031` `GET /chat/rooms/:id/links`

> Micro-plan thi công. Nguồn chốt: [SPEC-15 §15b](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1d](<../API Design/API-13_CHAT_API_Design.md>) (mục (4) (5) (6) là BLOCKING) · [S17-CHAT-UX2-WAVE.md](S17-CHAT-UX2-WAVE.md) §5 dòng BE-2.
> Zone 🟡 · gate LIGHT · **0 migration · 0 cặp quyền mới · 0 bề mặt WS mới**.

---

## 1. Phạm vi

**Trong:** một route đọc mới `GET /chat/rooms/:id/links` — trích `https?://` từ `body` của tin **chưa thu hồi**, **không phải** `message_type='system'`, keyset `(room_seq DESC, linkIndex ASC)`, trần quét 50 tin/request, membership-gated y hệt `CHAT-API-017`, con trỏ **mang vân phòng**.

**Ngoài phạm vi (WO khác):** mọi thứ FE (FE-1/3/4/5 — FE-4 là consumer của route này) · dedupe URL · unfurl/preview tiêu đề trang · `/chat/oversight/**/links` (BLOCKING 2: **KHÔNG** có đường oversight cho `/links`).

---

## 2. Hợp đồng (contracts — `packages/contracts/src/chat.ts`)

```ts
chatRoomLinkSchema = { messageId, roomSeq, linkIndex, url, senderId, senderName, createdAt }
listChatRoomLinksQuerySchema = { cursor?: string, limit: 1..50 default 30 }
chatRoomLinksResponseSchema = { data: ChatRoomLinkDto[], nextCursor: string | null, truncated: boolean }
```

- **OBJECT keyset, KHÔNG mảng trần** — khác `listRoomFiles`. `apiFetch` với `z.array(...)` sẽ `ZodError` runtime dù HTTP 200 (memory `apifetch-drops-pagination-bare-array`); `web-core` phải mirror đúng object.
- `linkIndex` **có mặt trong DTO** vì (a) nó là vế tie-break của con trỏ, (b) FE cần khoá React duy nhất `${messageId}:${linkIndex}` — hai link cùng một tin mà chung `key` là rò node DOM (memory `duplicate-sibling-key-leaks-dom-node`).
- `truncated` là hợp đồng của mục (6): **`true` = dừng vì chạm trần quét**, không phải vì hết dữ liệu.

## 3. Vì sao con trỏ là `(roomSeq, linkIndex)` chứ không phải `beforeSeq`

`beforeSeq` (khuôn `CHAT-API-017`) là con trỏ **theo TIN**, và tab Tệp sống được với nó nhờ `trimToMessageBoundary` — cắt trang ở ranh giới tin, chấp nhận trang dài/ngắn hơn `limit`. Với `/links` cách đó **không dùng lại được**: một tin có thể chứa nhiều link hơn cả `limit`, và trần quét 50 tin (mục 6) làm "trang rỗng = đã hết" trở thành **sai** — trang rỗng ở đây là chuyện bình thường (50 tin liền không có link nào). Vì vậy con trỏ phải chỉ được **vào giữa một tin**.

Ngữ nghĩa: con trỏ = **vị trí ĐÃ tiêu thụ cuối cùng**.

| `linkIndex` | Nghĩa | Vị từ SQL trang kế |
| --- | --- | --- |
| `≥ 0` | đã trả tới link thứ `linkIndex` của tin `roomSeq` | `room_seq <= $roomSeq` (JS bỏ qua link có `idx <= linkIndex` ở đúng tin đó) |
| `-1` | đã tiêu thụ TRỌN tin `roomSeq` (kể cả tin 0 link) | `room_seq < $roomSeq` |

## 4. Vân phòng trong con trỏ (`CHAT-ERR-016`)

Bọc codec `chat-search-cursor.ts`? **Không** — codec đó mang `(sortAt, id)`, sai hệ quy chiếu. Nhưng **luật vân** thì sao khuôn `chat-oversight-audit-cursor.ts` nguyên vẹn: `<base64url(roomSeq|linkIndex)>.<sha256(roomId)[0..16]>`, lệch ⇒ **400 `CHAT-ERR-016`**, **KHÔNG** có nhánh "thiếu vân thì bỏ qua kiểm tra" (nhánh đó chính là lỗ, và nó sẽ sống mãi).

Lý do vân là **phòng** chứ không phải bộ lọc: `room_seq` là **per-room** (mig `0539`) — con trỏ `room_seq=40` của phòng A dùng ở phòng B vẫn hợp cú pháp và server trả **200 kèm một trang trông rất bình thường**, cắt theo mốc của một phòng khác. Vân không chống giả mạo (client tự chế được); nó chống **trôi**. Mọi vế quyền/tenant/membership vẫn ép ở tầng dưới.

## 5. Luật nhận diện link — MỘT bản, có ratchet đối chiếu

`apps/api/src/chat/chat-link-extract.ts` (thuần, 0 I/O): regex `/https?:\/\/[^\s<>"']+/g` + gọt dấu câu đuôi `.,;:!?)]}` — **trùng nguyên văn** `splitTextWithLinks` (`apps/app/src/components/chat/chat-format.ts`).

Hai đầu lệch nhau thì bảng «Liên kết» liệt kê một URL mà bong bóng tin **không** biến thành link (hoặc ngược lại) — không test nào đỏ vì mỗi đường đi qua một literal riêng. Vì vậy `chat-link-extract.spec.ts` có **ca đối chiếu đọc file FE** và so literal; đổi luật ở một bên ⇒ ĐỎ.

`javascript:` / `data:` **không** thành link ở cả hai đầu (regex neo `https?://`) — có ca test tường minh.

## 6. Đường đọc + §13.4 (BLOCKING 1)

`ChatMessagesRepository.listRoomLinkCandidates` — file **đã** nằm trong census `chat-visibility.spec.ts`, nên vị từ `visibleFromSeqScalar()` là **bắt buộc**, không phải tuỳ chọn: thiếu ⇒ census ĐỎ. **CẤM** thêm tên vào `DOCUMENTED_EXCEPTIONS` (đang đúng 2 phần tử, có ratchet riêng canh).

```sql
SELECT id, room_seq, body, sender_id, users.full_name, created_at
  FROM chat_messages LEFT JOIN users …
 WHERE company_id = $1 AND room_id = $2
   AND recalled_at IS NULL          -- SPEC-15 §13.6
   AND message_type <> 'system'     -- tin hệ thống không phải lời người dùng
   AND body <> ''
   AND <visibleFromSeqScalar()>     -- §13.4
   AND <vị từ con trỏ ở §3>
 ORDER BY room_seq DESC LIMIT 51    -- SCAN_CAP + 1
```

**KHÔNG** lọc `body LIKE '%http%'` ở SQL: mục (6) đòi ca "50 tin liền KHÔNG có link ⇒ `truncated:true` + `nextCursor` khác null". Prefilter làm ca đó thành `truncated:false` (0 hàng khớp = "hết dữ liệu") — tức xoá đúng bất biến vừa dựng.

`LIMIT 51` = `SCAN_CAP + 1`: hàng thứ 51 là **bằng chứng còn tin phía sau**, không được đưa vào phần trích.

## 7. Phân trang (mục 6 — chạm trần)

```
scanned      = rows[0..SCAN_CAP)          hasMoreMessages = rows.length > SCAN_CAP
links        = trích theo thứ tự scanned, bỏ phần ≤ con trỏ
page         = links[0..limit)
```

| Tình huống | `truncated` | `nextCursor` |
| --- | --- | --- |
| còn link thừa trong `scanned` (dừng vì TRANG ĐẦY) | `false` | link cuối của trang |
| hết link trong `scanned` **và** còn tin phía sau | **`true`** | `{roomSeq: roomSeq nhỏ nhất đã quét, linkIndex: -1}` |
| hết link, quét tới đáy phòng | `false` | `null` |

Thứ tự hai nhánh đầu LÀ hợp đồng: "còn link chưa trả" xét TRƯỚC. Khi trang đầy vừa khít và tập quét cũng hết mà còn tin phía sau, nhánh thứ hai thắng — con trỏ trỏ vào TIN cuối đã quét (`linkIndex = -1`) thay vì vào link cuối. Hai cách đều đúng và không mất dữ liệu; chọn cách này vì nó không bắt trang sau quét lại đoạn tin nằm giữa link cuối và đáy tập quét.

## 8. Gate (BLOCKING 2 + 3)

- `@UseGuards(PermissionGuard)` + `@RequirePermission('view','chat-room')` — **trùng nguyên văn** cặp của `listMessages`/`listRoomFiles`. Cặp riêng cho link sẽ đẻ role "thấy link mà không đọc được tin".
- `assertMember` TRƯỚC mọi thứ ⇒ non-member **404** (`CHAT_ERR.ROOM_NOT_FOUND`, thông điệp HẰNG).
- **Oversight KHÔNG được miễn `assertMember`** — actor có `('view','chat-oversight')` mà không thuộc phòng vẫn **404**. Kèm **ca ALLOW đối chứng** assert `expect(res.status).toBe(200)` (CẤM `.not.toBe(403)` — nó nuốt cả 500).
- Route MỚI ⇒ `ROUTE_CENSUS_WRITE=1` regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`. Route **có** `@RequirePermission` nên **không** cần dòng ở `route-verdicts.ts` (sổ đó chỉ chứa route KHÔNG gate) — nhưng phải kiểm bằng chính census, không suy đoán.
- `chat.permissions.spec.ts` thêm hàng cho handler mới.

## 9. testTask

| # | Ca | Tầng |
| --- | --- | --- |
| 1 | trích: `http`/`https` ✓ · `javascript:`/`data:`/`ftp:` ✗ · gọt `.,;:!?)]}` đuôi · nhiều link/tin giữ thứ tự | unit |
| 2 | **đối chiếu FE**: literal regex + tập dấu câu ở `chat-format.ts` trùng nguyên văn | unit (ratchet) |
| 3 | con trỏ: vòng khứ hồi · thiếu vân ⇒ 400 · vân phòng khác ⇒ 400 · khoá hỏng ⇒ 400 · `linkIndex=-1` vs `≥0` sinh vị từ khác nhau | unit |
| 4 | census §13.4 vẫn xanh; **RED đo tay**: gỡ `visibleFromSeqScalar` khỏi method mới ⇒ `chat-visibility.spec.ts` ĐỎ | unit |
| 5 | deny: non-member 404 · oversight-không-thành-viên 404 · cross-tenant 0 hàng · **ALLOW đối chứng 200** | int (LANE_DB) |
| 6 | tin thu hồi vắng mặt · tin `system` vắng mặt | int |
| 7 | trần: 60 tin không link ⇒ `truncated:true` + `nextCursor` khác null; lật tiếp ra trang sau | int |
| 8 | ca âm trần: phòng ít tin ⇒ `truncated:false` + `nextCursor:null` | int |
| 9 | `limit=51` ⇒ 400 · con trỏ rác ⇒ 400 | int |
| 10 | phân trang giữa tin: 1 tin 3 link, `limit=2` ⇒ trang 2 ra link thứ 3, không lặp/không sót | int |

## 10. Đích hội tụ

`bash harness/check.sh --lane-db=s17be2` XANH · typecheck api/contracts/web-core xanh · census route regen + commit · API-13 §5.1d(7) đánh dấu `CHAT-API-031` ✅.

---

## 11. Bằng chứng đo được (10/09/2026)

| Đo | Kết quả |
| --- | --- |
| **RED BLOCKING 1** — gỡ `visibleFromSeqScalar()` khỏi `listRoomLinkCandidates` | `chat-visibility.spec.ts` **ĐỎ**, nêu đích danh: `đường đọc thiếu vị từ SPEC-15 §13.4: listRoomLinkCandidates`. Khôi phục ⇒ 18/18 xanh |
| **Census route (BLOCKING 3)** regen | `routes 581 → 582`, `gated 542 → 543`, **`ungated` giữ nguyên 27** ⇒ route KHÔNG rơi vào `needVerdict` (fail-open). Hàng mới: `ChatRoomsController#listRoomLinks · GET /api/v1/chat/rooms/:id/links · view:chat-room · routeGuards:[PermissionGuard]`. Không cần dòng ở `route-verdicts.ts` (sổ đó chỉ chứa route KHÔNG gate) |
| unit | `chat-link-extract.spec.ts` 22 ca · `chat-links-cursor.spec.ts` 20 ca · `chat-links.service.spec.ts` 16 ca |
| int (LANE_DB `mediaos_s17be2`) | `chat-s17-be2-links.int-spec.ts` **21/21 PASS** |

### Hai điều đo được lệch với dự đoán ban đầu — ghi để không ai suy diễn nhầm

1. **`https://).` cho ra `https://`, KHÔNG cho ra rỗng.** `:` và `/` không nằm trong tập gọt, nên một kết quả khớp không bao giờ mất phần lược đồ. Vế `if (url.length === 0)` trong `extractChatLinks` vì thế **không bao giờ chạy** — giữ lại vì nó NGANG BẰNG vế phòng thủ của FE (`splitTextWithLinks`), và parity mới là hợp đồng. Giá trị `https://` là link chết trong bảng, nhưng bong bóng tin ở FE **đang** vẽ nó thành `<a>` y như vậy: "sửa cho đẹp" ở một bên chính là cái trôi mà ca đối chiếu tồn tại để chặn.
2. **`view:chat-oversight` là cặp NHẠY CẢM** (`is_sensitive = true`) trong catalog chính tắc. Fixture truyền `false` bị guard của `seedPermissionCatalog` chặn — đúng, vì `permissions` là catalog TOÀN CỤC không được `cleanupTenants` dọn (memory `test-fixture-stamps-global-permission-catalog`).
