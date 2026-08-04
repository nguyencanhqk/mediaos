# S7-CHAT-FE-5 — 🔒 Màn quản trị đọc-vượt (CHAT-SCREEN-007) + nhật ký đọc-vượt (CHAT-SCREEN-008)

> Kế hoạch thi công. Nguồn sự thật nghiệp vụ: `docs/spec/SPEC-15 CHAT.md` §3.3 (bảng ràng buộc đóng
> khung) · §9 (CHAT-SCREEN-007/008) · §11 (cặp quyền) · §18 · §20 ca 12. Hợp đồng API:
> `docs/API Design/API-13_CHAT_API_Design.md` §5.3 (CHAT-API-018a/b/c · 019).
> Backend đã trên master: `S7-CHAT-BE-7` (`ChatOversightController` + guard audit + 4 route GET).
> Nền FE đã có: `S7-CHAT-FE-1` (`chatApi`) · `FE-2`/`FE-3`/`FE-4` (trang `/chat`, panel nổi) — **KHÔNG
> tái dùng** ở WO này, xem §2.

---

## 0. ĐO TRƯỚC KHI LÀM — 6 sự thật đã kiểm chứng trên code thật

### 0.1 Cặp quyền đã có trong CẢ HAI allowlist backend — không phải làm lại

`apps/api/src/permission/permission.service.ts:184` (`SENSITIVE_CAPABILITY_ALLOWLIST`) và `:220`
(`SENSITIVE_SCREEN_GATE_PAIRS`) đều đã chứa `"view:chat-oversight"` (S7-CHAT-DB-1 đã land).

⇒ `/auth/me` **có** trả key `view:chat-oversight` cho tài khoản được cấp cặp. Không có KI-058 ở đây —
nhưng nghiệm thu vẫn phải bằng tài khoản KHÔNG phải SA (SA lọt qua `useCan` nhờ `*:*`, không chứng minh
được gì).

### 0.2 `useCan` mở lối vào cho MỌI người giữ wildcard — chỉ `useCanExact` là fail-closed

`packages/web-core/src/hooks/use-can.ts:14` — `useCan` rơi xuống `*:resource` → `action:*` → `*:*`.
`useCanExact` (`:39`) chỉ đọc đúng key `action:resourceType`, không rơi.

⇒ Mọi cổng của WO này dùng `useCanExact("view", "chat-oversight")`. Ca test bắt buộc: caps `{"*:*":true}`
→ **KHÔNG** thấy lối vào (SPEC-15 §20 ca 12).

### 0.3 NAV registry của console là hằng TĨNH — trường `permission` KHÔNG được ai đọc

`apps/console/src/lib/nav.ts` khai `NAV_ITEMS` phẳng; hai nơi render nó
(`routes/root-layout.tsx` → `AppShell navItems`, `routes/home.tsx` → launcher) **không lọc quyền**.
`NavItem.permission` (`packages/web-core/src/lib/nav.ts:35`) có tồn tại nhưng `filterSidebarItems`
(`registry.ts:737`) là đường của registry cũ, **không** nằm trên đường render của console.

⇒ Khai `permission: "view:chat-oversight"` rồi tin là đã gate = đúng khuôn bẫy `ui-promises-backend-never-reads`
theo chiều FE. Phải lọc THẬT ở cả hai nơi render, bằng một hook chung `useConsoleNavItems()`.

### 0.4 CHAT-API-019 **không có** tham số lọc theo người/khoảng thời gian

`chatOversightAuditQuerySchema` (`packages/contracts/src/chat.ts:608`) chỉ có `cursor` + `limit`;
`ChatOversightService.listAudit` (`chat-oversight.service.ts:176`) chuyển thẳng hai giá trị đó xuống repo.
Không có `actorUserId`, không có `from`/`to`.

⇒ **Lệch giữa done_when của WO và hợp đồng đã ship.** WO này KHÔNG khai `apps/api/**` trong `paths` nên
sửa BE là ra ngoài phạm vi. Quyết định: lọc **phía client trên các dòng ĐÃ TẢI**, và nói thẳng điều đó
trên UI ("Lọc trong N dòng đã tải · Tải thêm để mở rộng phạm vi lọc"). Lọc im lặng trên tập con rồi để
người đọc tưởng đã thấy hết chính là "audit không phải kiểm soát" (§18) ở dạng tinh vi hơn. Việc nới
CHAT-API-019 nhận `actorUserId`/`from`/`to` ghi lại thành WO tiếp theo (`S7-CHAT-BE-9`, xem §6).

### 0.5 DTO oversight **không có** URL tệp và **không có** `myRole` — đó là hợp đồng, không phải thiếu sót

`chatOversightAttachmentSchema` (`chat.ts:557`): `fileId/name/mimeType/sizeBytes/isImage`, **0 URL**.
`chatOversightRoomDetailSchema` (`:544`): không có `myRole`.

⇒ UI render đính kèm là **metadata thuần** (tên · cỡ · loại), KHÔNG `<a href>`, KHÔNG thẻ `<img>`. Và vì
không có `myRole` nên không có nhánh nào bật được nút quản trị — chế độ chỉ đọc là hệ quả của kiểu dữ
liệu, không phải của một cờ `readOnly` mà ai đó có thể lật.

### 0.6 `018a` không phân trang, có cờ `truncated`; `018c` đọc toàn dải `roomSeq`

`chatOversightRoomListSchema` (`:531`) = `{ data, truncated }` — không con trỏ (chống enumerate).
`chatOversightMessagesQuerySchema` (`:600`) = `beforeSeq`/`afterSeq`/`limit`, con trỏ RIÊNG.

⇒ FE: `truncated === true` phải hiện cảnh báo "còn kết quả bị cắt — thu hẹp từ khoá", KHÔNG được im.
Cuộn ngược trong phòng dùng `beforeSeq = min(roomSeq)` của trang hiện tại; trang rỗng = hết.

---

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
| --- | --- |
| `packages/web-core/src/lib/chat-api.ts` — thêm `chatOversightApi` (4 hàm) + export | Sửa `chatApi` hiện có |
| `apps/console/src/routes/system/chat-oversight/**` — 2 màn | `apps/app/**` (xem §2) |
| `apps/console/src/lib/nav.ts` + `router.tsx` — lối vào có cổng | Thêm cặp quyền mới |
| `packages/web-core/src/i18n/locales/vi/nav.ts` — 2 nhãn nav | `apps/api/**` (BE-9 sau) |
| `docs/RELEASE/RELEASE-11_Admin_Guide.md` §4.3 — công bố ranh giới riêng tư | |

## 2. Vì sao đặt ở `apps/console`, KHÔNG phải `apps/app`

done_when: *"KHÔNG trộn vào danh sách phòng của CHAT-SCREEN-001 và KHÔNG vào panel nổi — lối vào riêng,
để không bao giờ xảy ra do vô ý"*.

`apps/app` là nơi sống của `ConversationPanel` (có `MessageComposer`), `ChatDock`, `RoomListPanel`. Đặt màn
đọc-vượt cạnh chúng thì việc tái dùng `ConversationPanel` với cờ `readOnly` trở thành đường ít trở ngại
nhất — và một cờ boolean là thứ WO sau vô tình lật (hoặc quên truyền, mặc định `false`). `apps/console` là
app quản trị hệ thống (nơi đã có Nhật ký hoạt động, Phân quyền, Thùng rác), **không import được** gì từ
`apps/app`, nên chế độ chỉ đọc được bảo đảm bằng **ranh giới package**, không bằng kỷ luật.

⇒ Hệ quả: `apps/app/src/components/chat/**` khai trong `paths` của WO **không bị đụng**. Ghi rõ ở PR.

## 3. Thiết kế

### 3.1 Client — `chatOversightApi` (đối tượng RIÊNG, không nhét vào `chatApi`)

Gương của việc BE tách controller/service/repository/mapper riêng: một call-site cầm `chatApi` không
được vô tình có trong tay đường đọc-vượt bằng cách gõ dấu chấm.

```text
searchRooms(q, roomType?, limit?)  → GET /chat/oversight/rooms          → chatOversightRoomListSchema
getRoom(roomId)                    → GET /chat/oversight/rooms/:id      → chatOversightRoomDetailSchema
listMessages(roomId, query)        → GET /chat/oversight/rooms/:id/msgs → z.array(chatOversightMessageSchema)  ← MẢNG TRẦN
listAudit(query)                   → GET /chat/oversight/audit          → chatOversightAuditResponseSchema     ← OBJECT keyset
```

Hai hình dạng phản hồi khác nhau trong cùng một đối tượng — đóng đinh bằng test (`chat-api.spec.ts`),
memory `apifetch-drops-pagination-bare-array`.

### 3.2 CHAT-SCREEN-007 — `/system/chat-oversight`

Ba trạng thái trong MỘT route, không điều hướng lồng:

1. **Tra cứu** — ô từ khoá (`min 2`, chặn ở client TRƯỚC khi gọi để không đốt một dòng audit cho một
   request chắc chắn 422) + chọn loại phòng. Bảng kết quả: mã · tên · loại · số thành viên · tin cuối ·
   trạng thái lưu trữ. Băng-rôn thường trực: *"Mọi lần tra cứu và mở phòng ở màn này đều được ghi nhật ký"*.
   `truncated` → cảnh báo thu hẹp từ khoá.
2. **Hộp thoại xác nhận** — bấm "Xem với tư cách quản trị" trên một dòng ⇒ `Dialog` nêu tên/mã phòng +
   câu "Hành động này được ghi vào nhật ký kiểm toán (ai · phòng · lúc nào)". **Chưa gọi 018b/018c** cho
   tới khi người dùng bấm Xác nhận — dấu vết audit phải tương ứng với một quyết định có ý thức.
3. **Phòng chỉ đọc** — 018b (thông tin + thành viên) + 018c (tin, cuộn ngược). Không ô soạn tin, không
   nút ghim/thu hồi/sửa thành viên, không link tải tệp. Tin đã thu hồi hiện "Tin đã được thu hồi"
   (`body === null`) — masking KHÔNG bị nới ở đường này.

### 3.3 CHAT-SCREEN-008 — `/system/chat-oversight/audit`

Bảng: thời điểm · người thực hiện · loại truy cập (`018a/018b/018c/019/unknown`) · phòng (mã + tên, `—`
khi null) · kết quả (`Success`/`Denied`/`Failure`/`Error`/`Unknown`) · tiêu chí tra (`criteria`).
Lọc **client-side trên các dòng đã tải**: theo người + khoảng thời gian, kèm nhãn đếm rõ ràng (§0.4).
"Tải thêm" theo `nextCursor`; `nextCursor === null` = hết.

### 3.4 Cổng quyền — BA lớp, cùng một vị từ `useCanExact("view","chat-oversight")`

| Lớp | Nơi | Thiếu lớp này thì sao |
| --- | --- | --- |
| Nav | `useConsoleNavItems()` dùng ở `root-layout` + `home` | Người giữ `*:*` thấy ô "Đọc-vượt" ở launcher |
| Route | `beforeLoad` đọc `useAuthStore.getState().capabilities` (khớp CHÍNH XÁC key) → thiếu quyền: `redirect({to:"/"})` | Gõ thẳng URL vào được |
| Trang | `EmptyState` "không có quyền", và `enabled:` của mọi `useQuery` | Trang tự gọi API rồi hiện lỗi 403 thay vì nói không có quyền |

Lớp Route đọc store trực tiếp (không hook) vì `beforeLoad` chạy ngoài React — cùng khuôn `authGuard` sẵn có.
Không có đua trạng thái: `main.tsx` `await bootstrapSession()` (nạp `/me` + `capabilities`) TRƯỚC khi mount
router, nên `beforeLoad` luôn đọc map đã đầy đủ — nếu không thì lớp này sẽ đá văng chính người có quyền.

## 4. Test (LIGHT gate — `apps/console` + `packages/web-core`, vitest colocated)

1. `caps={"*:*":true}` → nav **không** có mục đọc-vượt; trang render EmptyState "không có quyền"; **0**
   lời gọi `fetch` (cổng đóng trước khi query chạy).
2. `caps={"view:chat-oversight":true}` → thấy mục nav, tra cứu ra bảng.
3. Bấm "Xem với tư cách quản trị" → **chưa** có request 018b; chỉ sau khi Xác nhận mới có.
4. Phòng chỉ đọc: không có `textbox` soạn tin, không có nút ghim/thu hồi/thêm thành viên, và **không có
   thẻ `<a href>` nào trỏ tệp** (`queryAllByRole("link")` trong danh sách đính kèm = 0).
5. `truncated: true` → hiện cảnh báo.
6. Nhật ký: 5 giá trị `resultStatus` render đủ; lọc theo người thu hẹp đúng; nhãn "trong N dòng đã tải"
   hiện đúng số.
7. `chat-api.spec.ts`: `listMessages` parse MẢNG TRẦN, `listAudit` parse OBJECT keyset (nhầm ⇒ đỏ).

## 5. Rủi ro đã cân nhắc

| Rủi ro | Xử lý |
| --- | --- |
| Tái dùng `ConversationPanel` ⇒ lọt ô soạn tin | Ranh giới package (§2) |
| `useCan` thay `useCanExact` ở một trong ba lớp | Test ca `*:*` chạm cả ba lớp |
| Lọc client-side đọc như lọc toàn cục | Nhãn "trong N dòng đã tải" + nút Tải thêm (§0.4) |
| Đính kèm mọc `href` khi ai đó "cải tiến" | Test đếm `link` = 0 + DTO không có URL để mà render |
| Hộp thoại xác nhận trở thành trang trí (gọi API trước) | Test #3 |

## 6. Việc đẩy sang WO sau

- **`S7-CHAT-BE-9`** — ĐÃ SEED vào `harness/backlog.mjs` (04/08): nới CHAT-API-019 nhận `actorUserId` +
  `from`/`to` (giữ keyset), để CHAT-SCREEN-008 lọc ở SERVER. Chừng nào chưa có, nhãn "trong N dòng đã
  tải" là phần BẮT BUỘC của UI — và khi BE-9 land thì phải GỠ nhãn đó cùng lúc, nếu không nó nói sai
  theo chiều ngược lại.

---

## 7. Kết quả thi công (04/08/2026)

| Hạng mục | Kết quả |
| --- | --- |
| Test mới | 64 ca — console 49 (`chat-oversight-format` 23 · trang 007 13 · trang 008 8 · nav 5) + web-core 15 |
| **RED-proof** | Đổi `useCanExact` → `useCan` trong `chat-oversight-gate.ts` ⇒ **7 ca ĐỎ** trên cả 3 lớp cổng (nav · 007 · 008); khôi phục ⇒ xanh lại |
| typecheck | `pnpm typecheck` workspace — 10/10 task xanh |
| lint | `pnpm lint` workspace — 7/7 task xanh |
| test | console 233 · web-core 701 · app 1787 · auth 23 — tất cả xanh |
| build | `@mediaos/console` vite build xanh |

⚠️ `packages/web-core` phải **build lại dist** sau khi thêm `chatOversightApi` — console resolve web-core
qua `dist/cjs/index.d.ts`, nên trước khi build, `tsc` của console báo `TS2305: has no exported member` (đỏ
OAN, đúng khuôn memory `web-core-stale-dist-white-page`).

`apps/app/src/components/chat/**` khai trong `paths` của WO **không bị đụng** — lý do ở §2.
