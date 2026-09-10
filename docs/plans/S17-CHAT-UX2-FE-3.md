# S17-CHAT-UX2-FE-3 — Composer v2 (DEC-027)

> Zone 🟡 · LIGHT gate · deps `S17-CHAT-UX2-FE-2` ✓ (đã ở master)
> Nguồn: SPEC-15 §5.1d dòng "Ô soạn v2" · §22c **CHAT-DEC-027** · §10 **CHAT-FUNC-024**
> Wave: `docs/plans/S17-CHAT-UX2-WAVE.md` §5 hàng FE-3 · §7 bẫy (3 dòng gắn FE-3)

---

## 1. Phạm vi

Bốn việc, KHÔNG hơn (DEC-027 khoá phạm vi — không rich-text, không sticker/GIF, không sửa tin):

1. **@mention** — gõ `@` mở popover gợi ý từ **roster phòng**, chọn bằng chuột hoặc ↑↓/Enter/Tab,
   chèn `@Tên` vào chữ và thu `userId` vào `mentions[]` gửi lên server.
2. **Emoji** — bộ **tĩnh** ~120 Unicode theo nhóm, **0 dependency**, nạp bằng `import()` động,
   chèn tại con trỏ.
3. **Dán / kéo-thả ảnh** — `paste` và `drop` vào ô soạn đi CÙNG đường `uploadChatAttachment`
   như nút 📎, tôn trọng `MAX_ATTACHMENTS_PER_MESSAGE`.
4. **Thumbnail xem trước** — ảnh đang chờ gửi hiện ô xem trước (`URL.createObjectURL`, revoke khi
   gỡ/gửi/unmount); tệp không phải ảnh giữ tile tên + cỡ như hôm nay.

**Ngoài phạm vi (ghi để không ai tự thêm):** rich-text/markdown · sticker/GIF · upload video có
transcode · mention `@all`/`@here` (không có cặp quyền, không có luật NOTI) · lịch sử emoji hay dùng
(cần lưu prefs = bề mặt dữ liệu mới, mà wave S17 cấm — SPEC-15 §22c cảnh báo dưới bảng DEC).

---

## 2. Bất biến PHẢI giữ (đo bằng test đang có, không phải bằng lời)

| # | Bất biến | Test canh |
| --- | --- | --- |
| B1 | `clientMessageId` sinh **MỘT LẦN**/nháp, giữ nguyên qua "Gửi lại" | `MessageComposer.spec.tsx` "khoá idempotency" |
| B2 | Gửi lỗi **KHÔNG xoá nháp** (chữ + tệp + khoá) | `MessageComposer.spec.tsx` §14 |
| B3 | `isMountedRef` gán `true` ở **thân effect** (StrictMode mount 2 lần) | `MessageComposer.spec.tsx` StrictMode |
| B4 | Typing ping leading-edge, lỗi nuốt im lặng, reset khi đổi phòng | `MessageComposer.typing.spec.tsx` |
| B5 | Ô soạn có **ĐÚNG MỘT** `role="textbox"` | các spec dùng `getByRole("textbox")` — thêm input thứ hai là **đỏ hàng loạt** |
| B6 | 0 dependency mới | `pnpm-lock.yaml` KHÔNG đổi |

B5 là lý do popover mention bám **chính textarea** (trigger inline `@`), không phải một ô tìm riêng.
Popover dùng `role="listbox"` + `role="option"` ⇒ vẫn duy nhất một textbox.

**Bẫy đã ghi ở wave §7 — không đo lại:**

- `ismounted-ref-stuck-false-under-strictmode` — tách sub-component thì cờ mounted **ở lại**
  `MessageComposer`, không đẩy xuống con.
- `fake-timers-break-socketio-client-emit` — test mention/emoji **KHÔNG** `vi.useFakeTimers()`.
- `console-had-zero-code-splitting` — emoji nạp `import()` động, không kéo 120 ký tự vào bundle chính.

---

## 3. Kiến trúc file (ĐÃ THI CÔNG — `MessageComposer.tsx` 346 → **406 dòng**)

```
components/chat/
  MessageComposer.tsx            ← chỉ ĐIỀU PHỐI: nháp · tệp · lỗi · 5 bất biến B1..B5
  chat-emoji.ts                  ← dữ liệu tĩnh 122 emoji / 5 nhóm (nạp qua import() động)
  use-mention-autocomplete.ts    ← LOGIC THUẦN: dò `@`, lọc roster, chèn text, suy mentions[], phím
  composer/
    MentionPopover.tsx           ← listbox gợi ý (role=listbox/option + aria-activedescendant)
    EmojiPicker.tsx              ← lưới emoji trong `Popover`, `import()` động khi mở lần đầu
    AttachmentPreviewList.tsx    ← tile tệp + thumbnail ảnh (thuần trình bày)
    ComposerActions.tsx          ← dải nút trái: 📎 + 🙂 (cùng cổng `!disabled` với ô soạn)
    ComposerNotices.tsx          ← lưu trữ · đang trả lời · đang tải · lỗi · quá dài
    use-attachment-previews.ts   ← SỔ blob URL: create / revokeOne / revokeAll + revoke lúc unmount
    use-file-drop.ts             ← handler paste + drop + dragOver, gắn ở ROOT (không ở textarea)
    use-typing-ping.ts           ← ping "đang gõ" leading-edge (dời nguyên khối từ S8)
```

Nhiều hơn 3 file như bản nháp §3 ban đầu: 3 file không đủ để đưa `MessageComposer.tsx` xuống dưới
400 dòng (đo được **527** sau vòng đầu). Bốn khối tách thêm đều là **vòng đời trọn vẹn**, không phải
chia nhỏ cho đủ chỉ tiêu: sổ blob URL (tạo→thu hồi), bộ handler dán/thả, ping "đang gõ", và dải nút.

⚠️ Ba thứ **ở LẠI** `MessageComposer.tsx` có chủ đích: `isMountedRef`, `clientMessageIdRef`, và
`mentionEntriesRef`. Đẩy chúng xuống `composer/**` là mở lại bẫy
`ismounted-ref-stuck-false-under-strictmode` ở một file mà không ai nhớ vì sao nó tồn tại.

---

## 4. Luật mention (chi tiết — đây là chỗ dễ sai nhất)

**Nguồn ứng viên:** `useRoomRoster(roomId).members` lọc `leftAt === null` (người **còn** trong phòng).
Roster cố ý gồm cả người đã rời để vẽ tin cũ; gợi ý mention người đã rời là mời người dùng gõ một
mention mà **server sẽ lọc bỏ im lặng** (CHAT-ERR-010) — hứa rồi nuốt.

**Dò trigger:** từ vị trí con trỏ lùi về trái tới `@` gần nhất; huỷ nếu

- trước `@` là ký tự chữ/số (⇒ đó là email `a@b`, không phải mention), hoặc
- giữa `@` và con trỏ có xuống dòng, hoặc phần truy vấn > 32 ký tự.

**Chèn:** thay `@query` bằng `@Tên ` (kèm một dấu cách) và ghi `{userId, label:"@Tên"}` vào bảng
mention đang hoạt động. Con trỏ đặt ngay sau dấu cách.

**Thu hồi khi xoá chữ (done_when gạch 1):** `mentions[]` gửi đi **suy từ chính chuỗi nháp** —
mỗi lần build payload, một mention chỉ được tính khi `body` CÒN chứa `label` của nó.
Đây là lý do không giữ `mentions[]` như một danh sách rời: giữ rời thì xoá chữ `@Nam` xong vẫn gửi
id của Nam, và người đó nhận thông báo về một tin không hề nhắc tên mình.
Trần 20 (`sendMessageSchema.mentions.max(20)`) — cắt ở FE bằng hằng `MAX_MENTIONS_PER_MESSAGE`.

**Người ngoài roster không gợi ý:** không có đường nào chèn được id ngoài roster, vì `label` chỉ sinh
từ chính hàng roster đã chọn.

---

## 5. Dán / kéo-thả

Cả `onPaste` (đọc `e.clipboardData.files`) lẫn `onDrop` (đọc `e.dataTransfer.files`) đều gọi **đúng
một** hàm `handlePickFiles` đang có — không nhân bản luật trần tệp/`ensureClientMessageId`/gộp lỗi.
`onPaste` chỉ `preventDefault()` khi thật sự có tệp, để dán CHỮ không bị nuốt.
`onDragOver` phải `preventDefault()` nếu không trình duyệt mở tệp thay vì thả vào ô.

**Đo "đúng 1 lần/tệp":** spy `uploadChatAttachment` đếm lần gọi — dán 2 ảnh ⇒ 2 lần, không phải 4
(sự kiện `paste` bắn cả ở textarea lẫn container nếu gắn hai chỗ).

---

## 6. Thumbnail

`ChatUploadResult` chưa mang `File` gốc nên không có gì để `createObjectURL`. Composer tự tạo
`previewUrl` cho tệp ảnh **ngay khi chọn** và giữ trong sổ `composer/use-attachment-previews.ts`
(`useRef<Map<fileId,string>>`):

- gỡ tệp ⇒ `revokeObjectURL` ngay;
- gửi thành công ⇒ revoke cả lô;
- unmount ⇒ revoke cả lô (cleanup effect).

Không revoke = rò bộ nhớ mỗi lần dán ảnh, và jsdom không kêu ⇒ test phải khẳng định số lần revoke.

---

## 7. Đường đi của `mentions[]` (chạm ngoài `paths` — đã bổ sung ở backlog)

```
MessageComposer  →  ComposerSubmitPayload.mentions
ConversationPanel.submit  →  SendChatMessageInput.mentions   ← use-chat-conversation.ts
use-chat-conversation.sendMessage  →  SendMessageRequest.mentions  (contracts, ĐÃ CÓ)
chatApi.sendMessage → POST /chat/rooms/:id/messages
```

`use-chat-conversation.ts` KHÔNG có trong `paths` gốc của WO ⇒ **bổ sung vào `harness/backlog.mjs`**
(hot-file append) chứ không lách hook `guard-scope`.

**"Gửi lại" không được đánh rơi mention** — cùng lớp lỗi với `pendingFileIdsRef` đã có ở
`ConversationPanel` (docblock dòng 110): giữ `clientMessageId → mentions[]` trong CÙNG một ref map,
không thêm ref thứ hai lệch vòng đời.

---

## 8. testTasks (RED trước ở những ca có thể xanh-RỖNG)

| Ca | Khẳng định | Chống xanh-RỖNG |
| --- | --- | --- |
| M1 | gõ `@ng` ⇒ listbox chỉ có người khớp, **không** có người `leftAt !== null` | ca đối chứng: người đã rời CÓ trong roster đầu vào |
| M2 | chọn gợi ý ⇒ `body` chứa `@Tên `, payload `mentions:[id]` | assert cả hai vế, không chỉ text |
| M3 | chọn rồi **xoá** chữ `@Tên` ⇒ payload `mentions` **rỗng** | ca đối chứng M2 phải cùng file |
| M4 | `a@b` (trước `@` là chữ) ⇒ **không** mở popover | |
| M5 | ↑↓ đổi lựa chọn, Enter chọn (KHÔNG gửi tin), Esc đóng | Enter khi popover mở phải **không** gọi `onSubmit` |
| M6 | quá 20 mention ⇒ cắt còn 20 | |
| E1 | mở picker ⇒ chèn emoji tại con trỏ (giữa chuỗi, không nối đuôi) | đặt `selectionStart` giữa chuỗi |
| E2 | `pnpm-lock.yaml` không đổi | kiểm ở check.sh/CI |
| P1 | dán 2 ảnh ⇒ `uploadChatAttachment` gọi **đúng 2** lần | |
| P2 | kéo-thả vượt `MAX_ATTACHMENTS_PER_MESSAGE` ⇒ lỗi, **0** lần gọi upload | |
| P3 | gỡ tệp ảnh ⇒ `revokeObjectURL` được gọi với đúng URL | spy `URL.revokeObjectURL` |
| B1..B4 | 4 spec S7 hiện có vẫn **xanh nguyên văn** | không sửa file spec cũ |

---

## 9. Definition of Done — ĐÃ ĐO

- [x] 4 nhóm ca ở §8 xanh; sau khi vá review: `src/components/chat` **434/434 (33 file)**, toàn
      `@mediaos/app` **2534/2534 (263 file)**; `build` xanh và `chat-emoji` ra chunk riêng **1082 B**
      (0 lần xuất hiện trong bundle chính ⇒ code-splitting có thật, không chỉ có `import()` trên giấy)
- [x] `MessageComposer.spec.tsx` + `.typing.spec.tsx` cũ **không sửa một dòng** (`git diff` rỗng)
- [~] `MessageComposer.tsx` = **406 dòng** — VƯỢT mục tiêu tự đặt <400 của plan này 6 dòng, vẫn trong
      ngưỡng **max 800** của CLAUDE.md §5. Đo được 392 sau vòng tách file; 3 bản vá của LIGHT gate
      (guard unmount · `onBlur` · docblock lý do) đẩy lên 406. KHÔNG tách thêm file thứ 9 để lấy đúng
      con số: đó là churn trên bản mà cả hai reviewer VỪA đọc xong, đổi rủi ro thật lấy một chỉ tiêu
      tự đặt. File ~55% là docblock.
- [x] `pnpm-lock.yaml` KHÔNG đổi — 0 dependency mới
- [x] `pnpm --filter @mediaos/app typecheck` xanh · `lint` xanh (`eslint .`, 0 phát hiện)
- [x] LIGHT gate: `typescript-reviewer` **PASS** + `code-reviewer` (React/UX) **PASS** — 0 CRITICAL,
      0 HIGH, 3 MEDIUM. **Đã vá cả 3** (xem §11).
- [x] `harness/backlog.mjs`: `paths` += `use-chat-conversation.ts` (có ghi chú lý do)

---

## 10. Sweep đột biến — bằng chứng ca KHÔNG xanh-RỖNG

**9 đột biến, 9/9 bị giết** (7 vòng đầu + 2 cho đúng hai bản vá của LIGHT gate). Mỗi dòng là một cách tính năng này hỏng trong im lặng ở sản phẩm thật:

| # | Đột biến | Ca bắt được |
| --- | --- | --- |
| M-a | `collectMentionIds` bỏ lọc theo nháp (gửi mọi id đã từng chọn) | 4 ca / 2 file |
| M-b | `rosterToMentionCandidates` KHÔNG lọc người đã rời | 1 ca |
| M-c | `detectMentionTrigger` bỏ luật "trước `@` là chữ" ⇒ email mở popover | 2 ca / 2 file |
| M-d | Enter KHÔNG bị popover nuốt ⇒ gửi tin viết dở | 2 ca |
| M-e | Gỡ tệp KHÔNG `revokeObjectURL` ⇒ rò bộ nhớ | 1 ca |
| M-f | Emoji nối ĐUÔI chuỗi thay vì chèn tại con trỏ | 1 ca |
| M-g | Gửi xong KHÔNG dọn bảng mention ⇒ id rò sang tin sau | 1 ca |
| M-h | Gỡ guard `isMountedRef` sau `await` upload ⇒ blob URL mồ côi | 1 ca |
| M-i | Gỡ `onBlur` ⇒ popover treo lơ lửng sau khi rời tiêu điểm | 1 ca |

Script: `scratchpad/mutate.py` (vá → chạy → khôi phục trong `finally`). Cây làm việc đã xác minh
sạch sau sweep.

---

## 11. Ba phát hiện của LIGHT gate — đã vá

| # | Phát hiện | Bản vá | Ca canh |
| --- | --- | --- | --- |
| R1 | **Rò blob URL khi tháo cây GIỮA LÚC đang upload.** `handlePickFiles` `await uploadChatAttachment(file)` rồi gọi thẳng `previews.create(...)` — nhưng cleanup của `useAttachmentPreviews` đã chạy `revokeAll()` xong từ lúc unmount. URL sinh sau mốc đó nằm trong sổ của một hook đã chết: **không ai thu hồi được**, sống tới khi tải lại trang. | `if (!isMountedRef.current) return;` ngay sau `await` — mirror đúng guard mà `handleSubmit` đã có | `MessageComposer.attach.spec.tsx` «THÁO CÂY giữa lúc đang upload» (đột biến **M-h**) |
| R2 | **Popover mention treo lơ lửng** khi người dùng rời tiêu điểm mà không gõ thêm phím nào. | `onBlur={() => mention.close()}` ở textarea. Chọn bằng chuột KHÔNG rơi vào nhánh này vì `MentionPopover` bắt `onMouseDown` + `preventDefault()`. | `MessageComposer.mention.spec.tsx` «RỜI TIÊU ĐIỂM ⇒ popover ĐÓNG» (đột biến **M-i**) |
| R3 | `useAttachmentPreviews` trả **object literal mới mỗi render** ⇒ vô hiệu hoá `useCallback` của `handlePickFiles` · `removeAttachment` · `handleSubmit`. | Bọc `useMemo`. | — (không có hành vi để đo; là nợ kỹ thuật) |

**KHÔNG vá — ghi lại để khỏi ai đo lại:** di chuyển **con trỏ trong chính textarea** (bấm chuột vào
giữa chữ) không đồng bộ lại popover. Đồng bộ theo `onSelect` sẽ mở LẠI đúng cái popover vừa chọn xong,
vì bước chèn gọi `setSelectionRange` và sự kiện `select` bắn kèm, với con trỏ đứng ngay sau `@Tên `.
Cách chữa duy nhất là một cờ "nuốt một lần" — mà cờ đó im lặng nuốt nhầm thao tác THẬT nếu trình duyệt
không bắn `select`, đúng lớp bẫy `ismounted-ref-stuck-false-under-strictmode`. Lý do đầy đủ nằm ở
docblock của `sync` trong `use-mention-autocomplete.ts`.
