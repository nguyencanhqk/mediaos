# S7-CHAT-FE-4 — Màn tìm kiếm tin nhắn (nhảy tới tin trong ngữ cảnh) + tab Tệp/Ghim/Thành viên

> Kế hoạch thi công. Nguồn sự thật nghiệp vụ: `docs/spec/SPEC-15 CHAT.md` §9 (CHAT-SCREEN-004 · 005) ·
> §13.5 · §13.7 · §14. Hợp đồng API: `docs/API Design/API-13_CHAT_API_Design.md` (CHAT-API-015 · 017).
> Nền đã có: `S7-CHAT-FE-1` (store · socket · `chatApi`) · `FE-2` (trang `/chat`, `ConversationPanel`,
> `useChatConversation`, `RoomInfoPanel` 2 tab) · `FE-3` (panel nổi, dùng lại `ConversationPanel`).
> Backend đã trên master: `BE-4` (`GET /chat/search`) · `BE-3` (`GET /chat/rooms/:id/files`).

---

## 0. ĐO TRƯỚC KHI LÀM — 6 sự thật đã kiểm chứng trên code thật

### 0.1 Cả hai endpoint đã sống, cùng MỘT cặp quyền với đường đọc tin

`chat-search.controller.ts:44` và `chat-messages.controller.ts:105` đều
`@RequirePermission("view", "chat-room")` — **trùng nguyên văn** cặp của `listMessages`/`listPinned`.

⇒ FE **không** thêm cặp quyền mới nào vào `CHAT_PAIRS`. Ai mở được phòng thì tìm được và xem được tab
Tệp; không có màn hình nào phải gate riêng (memory `read-path-gate-pair-must-match-download-pair`).

### 0.2 Hai endpoint có HAI hình dạng phản hồi khác nhau — nhầm là `ZodError` dù HTTP 200

| Endpoint | Hình dạng | Schema FE |
| --- | --- | --- |
| `GET /chat/search` | **object keyset** `{ data, nextCursor }` (không qua `paginated()`) | `chatSearchResponseSchema` |
| `GET /chat/rooms/:id/files` | **MẢNG TRẦN** `ChatRoomFileDto[]` | `z.array(chatRoomFileSchema)` |

Đóng đinh bằng test ở `chat-api.spec.ts` (memory `apifetch-drops-pagination-bare-array`).

### 0.3 Con trỏ của tab Tệp **không** suy được "còn trang sau" từ `rows.length === limit`

`chat-file.constants.ts:84 trimToMessageBoundary` cắt trọn nhóm hàng của một tin bị chẻ đôi giữa hai
trang ⇒ trang trả về **có thể ít hơn `limit` dù còn trang sau**, và ở ca biên (một tin có nhiều tệp hơn
`limit`) lại **nhiều hơn `limit`**.

⇒ Luật FE: con trỏ trang kế = `min(roomSeq)` của trang hiện tại (`beforeSeq` LOẠI TRỪ, repo order
`desc(roomSeq)`); nút "Tải thêm" chỉ tắt khi **một trang trả về rỗng**. Suy theo độ dài là giấu tệp của
người dùng, im lặng.

### 0.4 `/chat/rooms/:id/messages` đủ để dựng cửa sổ ngữ cảnh — không cần endpoint `aroundSeq`

`chat-messages.repository.ts:209` — `beforeSeq` là `lt` (loại trừ), `afterSeq` là `gt`, và **kết quả
luôn trả TĂNG DẦN theo `roomSeq`**. Vậy tin ở `roomSeq = S`:

```
getMessages(roomId, { beforeSeq: S + 1, limit: 25 })   → 25 tin cuối có seq ≤ S   (gồm CHÍNH tin S)
getMessages(roomId, { afterSeq: S,     limit: 25 })    → 25 tin đầu có seq > S
```

Ghép hai mảng = một dải **liên tục** `[S−24 … S+25]`. Hai lời gọi song song, không cần con trỏ mới.

### 0.5 🛑 Ghép cửa sổ ngữ cảnh vào danh sách đang có sẽ tạo **KHE HỞ CÂM**

`messagesByRoom[roomId]` là MỘT danh sách phẳng sắp theo `roomSeq`, và `MessageList` vẽ liền mạch —
không có khái niệm "đoạn". Nạp thêm dải `[900…950]` vào một danh sách đang giữ `[4980…5000]` cho ra một
màn hình mà tin cách nhau 4.000 số hiển thị **sát nhau, dưới cùng một dải ngày**. Người dùng đọc như thể
đó là cuộc hội thoại thật. Đây là nói dối, không phải thiếu tính năng.

⇒ Cửa sổ ngữ cảnh **THAY THẾ** danh sách của phòng (`enterMessageContext`), và trong lúc đó tin mới hơn
`windowEndSeq` **không được chèn** vào danh sách — nhưng **vẫn cập nhật tổng hợp phòng** (`unreadCount`,
`lastMessageSeq`, thứ tự danh sách) để badge không đứng hình. Người dùng thấy dải "Đang xem ngữ cảnh kết
quả tìm kiếm · **Về tin mới nhất**". Trạng thái này **luôn hiển thị**, nên nó không thể hỏng im lặng.

### 0.6 Ba đường tự động phải biết về chế độ ngữ cảnh, nếu không sẽ hỏng theo kiểu khó tái hiện

| Đường | Nếu không xử lý | Xử lý |
| --- | --- | --- |
| `pollRoomMessages` (lưới bù 10s khi mất kết nối) | nện `afterSeq=windowEnd` mỗi 10s để rồi bị chặn chèn | bỏ qua phòng đang ở chế độ ngữ cảnh |
| Gửi tin trong lúc xem ngữ cảnh | tin CỦA CHÍNH MÌNH bị chặn chèn ⇒ "gửi xong mà không thấy đâu" | `submit` **thoát ngữ cảnh + reload** TRƯỚC khi gửi |
| `removeRoomForSelf` / `resetChatStore` | mỏ neo mồ côi trỏ vào phòng không còn | dọn kèm (neo nằm trong `createInitialState`) |

---

## 1. Phạm vi

**LÀM** (CHAT-SCREEN-005 + phần còn thiếu của CHAT-SCREEN-004):

1. `chatApi.search` + `chatApi.listRoomFiles` + `chatKeys.rooms.files`.
   > **Đính chính lúc thi công:** KHÔNG thêm `chatKeys.search`. Mỗi phím gõ là một khoá cache mới ⇒ cache
   > đầy rác của những câu gõ dở (`"b"`, `"bá"`, `"báo"`…), và trang 2 phải NỐI vào trang 1 chứ không
   > phải nằm ở entry khác. Tìm kiếm giữ state trong `use-message-search.ts` + một `requestId` tăng dần.
2. Panel tìm kiếm ở cột trái trang `/chat`: phạm vi **tất cả phòng của tôi** ↔ **trong phòng đang mở**,
   chống dội, min 2 ký tự, phân trang con trỏ, 4 trạng thái §14.
3. Nhảy tới tin trong ngữ cảnh: mở đúng phòng → nạp cửa sổ → cuộn tới đúng `roomSeq` → **làm nổi** tin.
4. Tab **Tệp** trong `RoomInfoPanel` (ảnh xem trước, tệp thường có tên + cỡ, `url: null` ⇒ "không tải
   được"), + mỗi dòng nhảy được tới tin chứa nó.
5. Tab **Thành viên** bổ sung "đã xem tới đâu" (§13.2, dẫn xuất từ `lastReadSeq` — không bảng riêng).
6. Tab **Tin ghim**: nâng nút "Nhảy tới" từ "chỉ tìm trong phần đã tải" (giới hạn FE-2) lên đường ngữ
   cảnh thật.

**KHÔNG LÀM** (và vì sao):

- **Không** thêm ô tìm kiếm vào panel nổi (FE-3). Cửa sổ dock cao 26rem không đủ chỗ cho kết quả + ngữ
  cảnh; và jump-to-context cần khung hội thoại đầy đủ. Lối vào của dock = mở `/chat`.
- **Không** làm nổi từ khoá trong đoạn trích (highlight snippet). Server trả `body` thô, không trả
  `ts_headline`; tự tô ở client phải tái hiện `unaccent` + `websearch_to_tsquery` ở FE — hai bản luật
  khác nhau sẽ tô lệch với thứ server đã khớp. Đoạn trích để nguyên, tin đích được làm nổi bằng viền.
- **Không** đụng `/chat/oversight/*` (S7-CHAT-FE-5) và không thêm cặp quyền nào.

---

## 2. Thay đổi theo file

| File | Việc |
| --- | --- |
| `packages/web-core/src/lib/chat-api.ts` | **append** `search` · `listRoomFiles` (đúng chỗ FE-1 hẹn sẵn) |
| `packages/web-core/src/lib/chat-api.spec.ts` | gỡ pin "chưa mirror", thay bằng ca URL + ca hình dạng schema |
| `packages/web-core/src/lib/query-keys.ts` | `chatKeys.rooms.files(roomId)` (không có key cho tìm kiếm — xem §1) |
| `apps/app/src/stores/chat.store.ts` | `contextByRoom` + `enterMessageContext`/`exitMessageContext` + chốt chèn + dọn ở `removeRoomForSelf`/reset + bỏ qua poll |
| `apps/app/src/components/chat/use-message-search.ts` | hook tìm kiếm: chống dội · min 2 · phân trang · chốt đua |
| `apps/app/src/components/chat/MessageSearchPanel.tsx` | CHAT-SCREEN-005 |
| `apps/app/src/components/chat/RoomFilesTab.tsx` | tab Tệp (tách file để `RoomInfoPanel` không phình) |
| `apps/app/src/components/chat/RoomInfoPanel.tsx` | tab thứ 3 · "đã xem tới đâu" · đổi chữ ký `onJumpToMessage` |
| `apps/app/src/components/chat/ConversationPanel.tsx` | dải "đang xem ngữ cảnh" + thoát ngữ cảnh khi gửi |
| `apps/app/src/components/chat/MessageList.tsx` | prop `highlightMessageId` + cuộn tới nó |
| `apps/app/src/routes/chat/ChatPage.tsx` | cột trái 2 chế độ + điều phối nhảy tới ngữ cảnh |
| `apps/app/src/routes/chat/constants.ts` | hằng tìm kiếm + cỡ cửa sổ ngữ cảnh |
| `apps/app/src/i18n/locales/vi/chat.ts` | khoá `search.*` · `info.files.*` · `info.members.seen*` · `conversation.context*` |

---

## 3. Hợp đồng của `enterMessageContext` (điểm dễ hỏng nhất)

```ts
enterMessageContext(roomId, window: StoredChatMessage[], targetMessageId, targetSeq)
// - THAY THẾ messagesByRoom[roomId] bằng `window` (đã sắp tăng dần, đã lọc đúng roomId)
// - contextByRoom[roomId] = { targetMessageId, targetSeq, windowEndSeq: max(roomSeq) }
exitMessageContext(roomId)
// - XOÁ mỏ neo VÀ xoá messagesByRoom[roomId] → caller gọi conversation.reload() để nạp lại trang mới nhất
```

Chốt chèn trong `applyIncomingMessage`: `ctx && message.roomSeq > ctx.windowEndSeq` ⇒ **bỏ qua phần
danh sách**, vẫn chạy nhánh cập nhật tổng hợp phòng. Nhánh này viết TƯỜNG MINH ở đầu hàm; mọi caller
khác (`resolvePendingSend`, response `pin`/`recall`, lưới bù) đi qua đây nên không có cửa sau.

`prependOlderMessages` **không** cần chốt: nó chỉ thêm tin CŨ HƠN đầu danh sách, tức vẫn liên tục với
cửa sổ. Cuộn ngược từ ngữ cảnh vẫn chạy đúng.

---

## 4. Test (RED trước cho 3 ca dễ hỏng im lặng)

| Ca | Vì sao phải có |
| --- | --- |
| `q` < 2 ký tự ⇒ **0 lời gọi API** + nhắc tại chỗ | `done_when` #2; gõ-là-gọi làm 1 ký tự thành 1 request |
| tin mới (seq > windowEnd) khi đang xem ngữ cảnh ⇒ KHÔNG chèn, NHƯNG `unreadCount` vẫn tăng | §0.5 — hỏng cả hai chiều đều im lặng |
| thoát ngữ cảnh ⇒ xoá cả mỏ neo LẪN danh sách | quên vế thứ hai = phòng đứng hình ở dải cũ vĩnh viễn |
| `chat-api`: search = `{data,nextCursor}`, files = mảng trần | memory `apifetch-drops-pagination-bare-array` |
| tab Tệp: `url === null` ⇒ hiện "không tải được", KHÔNG vỡ danh sách | `chatAttachmentSchema` `.nullable()` có chủ đích |
| kết quả bấm → gọi đúng 2 lời `getMessages` (beforeSeq = seq+1, afterSeq = seq) | §0.4; lệch 1 đơn vị là mất chính tin đích |

Gõ không dấu ra kết quả có dấu là **việc của server** (`f_unaccent`, §13.7) — FE test đóng đinh đúng
một điều: `q` được gửi **nguyên văn**, không tự bỏ dấu, không tự thêm ký tự cú pháp.

---

## 5. Rủi ro đã cân nhắc

1. **Cột trái w-72 chật cho kết quả tìm kiếm** ⇒ ở chế độ tìm kiếm cột trái nới `w-96`; layout 3 cột
   không đổi số cột (không thêm cột thứ tư như cảnh báo ở docblock `ChatPage`).
2. **Đánh dấu đã đọc trong lúc xem ngữ cảnh**: `MessageList` gọi `markReadUpTo(seq cuối cửa sổ)` — con
   trỏ CHỈ TIẾN nên không kéo lùi gì; và vì cửa sổ luôn ≤ tin mới nhất, badge không bị tắt oan.
3. **Rời phòng khi đang ở chế độ ngữ cảnh**: mỏ neo giữ theo `roomId`, quay lại vẫn thấy dải báo + nút
   thoát ⇒ không có trạng thái ẩn.
4. **Nút phạm vi gửi Ý ĐỊNH, không gửi giá trị hiện tại** — lỗi này ĐÃ xảy ra khi thi công: nút "Trong
   phòng này" ban đầu gửi lại `scope.roomId`, mà ở phạm vi "tất cả" giá trị đó là `null` ⇒ bấm không có
   tác dụng. Test của riêng panel không bắt được (nó stub `onScopeChange`); ca bắt được nằm ở
   `ChatPage.spec` — nơi dây thật được nối. Và trang giữ `"all" | "room"` chứ không chốt `roomId`, để
   nhãn nút và truy vấn không thể lệch nhau khi người dùng đổi phòng.
