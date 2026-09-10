# S17-CHAT-UX2-FE-4 — Bảng thông tin phòng v2 (DEC-025)

> **TRẠNG THÁI: ĐÃ THI CÔNG 10/09/2026** — xem §7 (nhật ký thi công + lệch so với `done_when`).
> Ghi ngày **10/09/2026** bởi phiên đã đóng `S17-CHAT-UX2-FE-3`. Đây là **khảo sát đã trả tiền rồi**,
> không phải kế hoạch thi công đầy đủ — phiên nhận việc vẫn phải viết §Thi công của riêng mình.

> Zone 🟡 · LIGHT gate · Nguồn: SPEC-15 §9 **CHAT-SCREEN-004 v2** · §22c **CHAT-DEC-025** ·
> hồ sơ HTML `S17-CHAT-UX2-WAVE-review.html` §05 (wireframe cột phải)

---

## 0. Đọc mục này TRƯỚC — trạng thái nhánh

Nhánh `feat/s17-chat-ux2-fe-4` đã tạo, **base là `origin/feat/s17-chat-ux2-be-2`** (KHÔNG phải
master), vì FE-4 phụ thuộc `CHAT-API-031` mà BE-2 mới đẻ ra và BE-2 chưa merge.

```
master ──> BE-2 (PR #495, CI xanh, chờ 1 review NGƯỜI) ──> FE-4 (nhánh này)
       └─> FE-1 (PR #496, chờ review)
       └─> FE-3 (PR #497, chờ review)
```

⚠️ **Khi #495 được squash-merge, nhánh này PHẢI rebase lên master và đổi base của PR.** Squash tạo
một commit MỚI trên master không có quan hệ tổ tiên với commit của nhánh BE-2 ⇒ PR chồng sẽ hiển thị
lại toàn bộ diff của BE-2 như thay đổi của mình (memory `squash-merge-breaks-stacked-prs`).
Kiểm bằng DIFF NỘI DUNG hai-chấm, không bằng đồ thị commit — xem skill `post-merge-branch-reconcile`.

**Thứ tự an toàn nhất:** chờ #495 merge → `git rebase origin/master` → rồi mới code FE-4.

---

## 1. BE-2 đã đưa sẵn những gì (đã đo, khỏi đọc lại)

`packages/web-core/src/lib/chat-api.ts:385` —
`listRoomLinks(roomId, query?) → Promise<ChatRoomLinksResponseDto>`

Hợp đồng ở `packages/contracts/src/chat.ts:430-480`:

| Điều | Ý nghĩa với FE |
| --- | --- |
| `chatRoomLinkSchema` = `{ messageId, roomSeq, linkIndex, url, senderId, senderName, createdAt }` | khoá React **PHẢI** là `` `${messageId}:${linkIndex}` `` — một tin có nhiều link, trùng `key` là rò node DOM (memory `duplicate-sibling-key-leaks-dom-node`) |
| **KHÔNG dedupe URL ở server** | cùng địa chỉ gửi 3 lần = 3 dòng. **Đừng gộp ở client**: gộp là xoá người gửi + mốc thời gian của 2 lần kia |
| Phản hồi là **OBJECT keyset**, không phải mảng trần | khác hẳn `listRoomFiles` ngay bên trên — đọc `.items`/`.nextCursor`, đừng `.map` thẳng |
| `truncated: boolean` | **hợp đồng, không phải trường thông tin thêm**: `true` = "dừng vì chạm trần quét", KHÁC "hết dữ liệu". Trang rỗng + `truncated:true` mà FE hiện «phòng không có liên kết nào» là đúng lỗi đã bịt ở `018a` |
| `cursor` OPAQUE mang vân phòng, `limit` max 50 default 30 | cấm tự chế `offset`; con trỏ KHÔNG phải `beforeSeq` như API-017 |

---

## 2. Hiện trạng file phải sửa (đã đếm)

| File | Dòng | Ghi chú |
| --- | --- | --- |
| `RoomInfoPanel.tsx` | **561** | 4 mutation + 3 confirm + picker. WO nói **GIỮ logic, đổi vỏ** — đây là đại phẫu, không phải thêm tính năng |
| `RoomInfoPanel.spec.tsx` | 346 | số ca thành viên phải **giữ nguyên** khi chuyển tab → Sheet |
| `RoomFilesTab.tsx` | 199 | con trỏ: **chỉ trang RỖNG mới chứng minh hết**; `url` nullable |
| `RoomAvatarEditor.tsx` | 234 | **KHÔNG ĐỤNG** — 4 nhánh tư cách DEC-016 |
| `use-room-prefs.ts` | 141 | mute/pin/markUnread dùng lại nguyên |

### `packages/ui` THIẾU `accordion`

Đã liệt kê `packages/ui/src/components/ui/`: có `sheet` · `tabs` · `popover` · `dialog` · `select` ·
`checkbox` · `card` · `badge` · `avatar` · `data-table` · `pagination-footer` · `empty-state` ·
`skeleton` · `stat-card` · `donut-chart` · `theme-toggle` — **KHÔNG có `accordion`**.

⇒ FE-4 phải thêm primitive shadcn **CHUẨN** vào `packages/ui` (khối additive ở `index.ts`), như notes
của WO đã dặn: *"không tự vẽ"*. `sheet` thì ĐÃ CÓ, khỏi thêm.

---

## 3. Bốn cái bẫy đã biết — đừng đo lại

1. **Hai nút prefs KHÔNG được bọc `PermissionGate`/`useCan`.** «Tắt thông báo» và «Ghim» là sở thích
   CÁ NHÂN, không phải quyền trên dữ liệu công ty (memory
   `personal-prefs-must-not-sit-behind-permission-gate`). `done_when` đòi hẳn một ca test: *người chỉ
   có `view:chat-room` vẫn thấy hai nút*. Chỉ «Thêm thành viên» mới gate
   (`canManageMember && group && admin && !archived`).
2. **Ảnh/Video chỉ được gọi API khi accordion MỞ.** Luật `file_access_logs` của S7-FE-4: mỗi lần đọc
   đường tệp là một hàng audit. Render sẵn khi accordion đóng = ghi audit cho thứ người dùng chưa xem.
3. **`url: null` là trạng thái HỢP LỆ**, không phải lỗi tải. Server bỏ trắng khi `FilePolicyService`
   từ chối / tệp `Infected` / ký lỗi ⇒ hiện ô «không tải được», TUYỆT ĐỐI không `<img src={null}>`.
4. **`mutationFn` cũ trong React Query v5** (memory `react-query-v5-stale-mutationfn-closure`) — chụp
   `before` **tại điểm bấm**, không đọc từ closure của render cũ.

Thêm hai bẫy nữa từ `src` của WO: `ui-promises-backend-never-reads` ·
`read-path-gate-pair-must-match-download-pair`.

---

## 4. Thứ tự thi công đề xuất

1. `packages/ui`: thêm `accordion` (shadcn chuẩn) + spec + export additive ở `index.ts`.
2. `RoomLinksList.tsx` mới — tiêu thụ `listRoomLinks`, keyset «Xem tất cả», `rel="noopener noreferrer nofollow"` + `target="_blank"`, nhảy tới tin qua `onJumpToMessage`. **Xử lý `truncated` tường minh.**
3. `RoomMembersSheet.tsx` — bê nguyên nội dung tab thành viên hiện tại sang `Sheet`, giữ đủ số ca test.
4. Đại phẫu `RoomInfoPanel.tsx` sau cùng: bố cục dọc · 3 nút tròn · 4 accordion · Lưu trữ · Rời nhóm.
5. LIGHT gate: `typescript-reviewer` + `react-reviewer`; sweep đột biến cho các ca dễ xanh-RỖNG (nhất
   là ca «không bọc PermissionGate» và ca «chỉ gọi API khi accordion mở»).

---

## 5. done_when — chép nguyên từ `harness/backlog.mjs`

- Bố cục dọc theo DEC-025; «Tạo bởi {createdByName} · {ngày}» **ẩn dòng khi null**; nút Tắt/Bật thông
  báo + Ghim/Bỏ ghim gọi `useRoomPrefs` với `before` chụp tại điểm bấm — **KHÔNG** bọc
  `PermissionGate`/`useCan`; «Thêm thành viên» gate như cũ.
- Sheet thành viên: danh sách + chấm online + đã xem tới đâu + promote/remove [gate] — chuyển nguyên
  từ tab cũ, **số ca test thành viên giữ nguyên**.
- Ảnh/Video: lưới 3 cột từ `listRoomFiles({kind:'image'})` — **chỉ gọi khi accordion MỞ**; `url` null
  ⇒ ô «không tải được»; «Xem tất cả» phân trang keyset; Tệp = `kind:'file'`; Liên kết =
  CHAT-API-031 (tab mới `rel=noopener noreferrer nofollow`, nhảy tin qua `onJumpToMessage`);
  Tin ghim giữ nguyên.
- `RoomAvatarEditor` **không đổi hành vi** (4 nhánh); Lưu trữ [gate] + Rời nhóm [group] + confirm
  giữ; theme light/dark; typecheck/build/test xanh.

---

## 6. Ghi chú vệ sinh (không thuộc WO, nhưng thấy thì dọn)

Worktree `C:/dev 2/mediaos-s17fe2` trên nhánh `wo/s17-chat-ux2-fe-2` còn treo, mà **FE-2 đã merge vào
master rồi**. Xem `windows-worktree-orphan-dirs` trước khi xoá.

---

## 7. Nhật ký thi công (10/09/2026)

### 7.1 Đã làm

| # | Việc | Tệp |
| --- | --- | --- |
| 1 | Primitive `accordion` (shadcn-shape, **controlled**, `value: string[]`) + spec 5 ca | `packages/ui/src/components/ui/accordion.tsx` · `.spec.tsx` · export additive ở `index.ts` |
| 2 | Rút luật phân trang tệp ra hook dùng CHUNG cho danh sách «Tệp» và lưới «Ảnh/Video» | `room-info/use-room-files.ts` |
| 3 | Lưới ảnh 3 cột (`kind='image'` lọc ở **server**) | `room-info/RoomMediaGrid.tsx` |
| 4 | Khối «Liên kết» CHAT-API-031 (keyset opaque · `truncated` tường minh · `rel` đủ ba giá trị) | `RoomLinksList.tsx` + spec 9 ca |
| 5 | Danh sách thành viên chuyển tab → **Sheet** (giữ nguyên nội dung + số ca test) | `RoomMembersSheet.tsx` |
| 6 | Tin ghim tách khỏi panel (bỏ cờ `enabled` — accordion đóng là unmount) | `room-info/RoomPinnedList.tsx` |
| 7 | Đại phẫu panel: bố cục dọc · 3 nút tròn · «Thành viên (N) ›» · 4 accordion · Lưu trữ + Rời nhóm | `RoomInfoPanel.tsx` (561 → ~430 dòng) |
| 8 | `createdByName` nối dây từ `detail` (KHÔNG từ store) | `routes/chat/ChatPage.tsx` |
| 9 | `RoomAvatarEditor` thêm prop trình bày `showAvatar` (mặc định `true`) — **bốn nhánh DEC-016 không đổi một chữ** | `RoomAvatarEditor.tsx` |

### 7.2 Bằng chứng

- `RoomInfoPanel.spec.tsx` **34 ca** (từ 16) · `RoomLinksList.spec.tsx` **9 ca** · `accordion.spec.tsx` **5 ca**.
- **Mutation sweep 8/8 ĐỎcU ĐỌ** (không ca nào xanh-RỖNG): bỏ `kind='file'` · accordion đóng vẫn render thân · bọc nút «Ghim» sau cổng quyền · trang rỗng luôn đọc thành «không có liên kết» · khoá React chỉ còn `messageId` · ô ảnh `url=null` vẫn dựng `<img>` · dòng «Tạo bởi» hiện cả khi null · `before` bỏ trống.
- `pnpm --filter @mediaos/app typecheck` xanh · eslint `@mediaos/ui` + `@mediaos/app` xanh · `@mediaos/ui test` 18/18 · vitest `src/components/chat` + `src/routes/chat` **32/32 tệp xanh**.
- ⚠️ **KHÔNG chạy full-suite `apps/app` tại máy**: hai lần thử đều làm worker vitest chết (`ERR_IPC_CHANNEL_CLOSED`) và lần thứ hai kéo sập cả máy — để CI chạy phần còn lại (diện ảnh hưởng ngoài `chat/**` chỉ là hai khối **additive**: khoá i18n mới + export `accordion`).

### 7.3 Lệch so với `done_when` — ghi ra, không giấu

1. **Nhãn «Xem tất cả».** `done_when` dùng chữ «Xem tất cả» cho phân trang keyset. Thực tế **không có màn «tất cả»** để mở, và mỗi lần bấm chỉ lấy THÊM một trang — nên nhãn là «Xem ảnh cũ hơn» / «Xem liên kết cũ hơn», cùng khuôn với «Tải tệp cũ hơn» đã có từ S7. Nhãn hứa «tất cả» rồi chỉ đưa thêm 30 dòng là nói dối người dùng.
2. **Nút tròn «Tắt thông báo» mở MENU mốc** thay vì bật/tắt một chạm: hợp đồng là `mutedUntil` (MỘT MỐC), không phải cờ. Tự chọn hộ một mốc mặc định là loại lỗi người dùng không bao giờ quy được về đây (docblock `chat-room-prefs.ts` cấm dựng mốc giả). Chiều ngược (đang tắt ⇒ bật lại) vẫn là MỘT chạm.
3. **Lưới Ảnh/Video không có «Xem trong hội thoại»** — `done_when` không đòi, và nhét hai thao tác vào một ô vuông 1/3 cột làm cả hai khó bấm. Danh sách «Tệp» và «Liên kết» vẫn có đủ lối nhảy.
4. **`accordion` KHÔNG kéo Radix về.** `packages/ui` có đúng một gói Radix (`react-slot`); `tabs`/`sheet`/`popover` đều tự viết theo đúng API shadcn (docblock `tabs.tsx` nói thẳng «không Radix, đồng bộ convention»). Thêm một dependency chỉ cho một primitive là phá quy ước đang có.

### 7.4 NỢ / việc kế tiếp

- **Rebase khi #495 (BE-2) squash-merge.** Nhánh này base là `feat/s17-chat-ux2-be-2` — xem §0.
- `RoomInfoPanel.tsx` còn ~430 dòng (trong ngưỡng 800 nhưng trên mức 400 «điển hình»): nếu FE-5 phải nhét thêm chế độ Sheet cho panel này thì tách tiếp khối đầu (avatar/tên/3 nút) sang `room-info/`.
- Bidi/homograph trong URL: FE chỉ cô lập chiều viết (`dir="ltr"`) — **không thay** lớp kiểm ở server; nợ gốc vẫn nằm ở `docs/plans/S17-CHAT-UX2-BE-2.md`.
