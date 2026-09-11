# S17-CHAT-UX2-QA-1 — nghiệm thu wave S17-CHAT-UX2

> WO: `harness/backlog.mjs` → `S17-CHAT-UX2-QA-1` (zone 🟡, phụ thuộc FE-5).
> Tiền lệ gần nhất — **đọc trước khi viết dòng nào**: [`S8-CHAT-UX-QA-1.md`](S8-CHAT-UX-QA-1.md) +
> [`docs/QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md`](../QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md).
> Bảng nghiệm thu **ánh xạ luật → ca đang canh luật đó**, KHÔNG nhân bản nội dung test.

---

> ✅ **WO ĐÃ THI CÔNG XONG 11/09/2026.** Kết quả + bằng chứng đo:
> [`docs/QA/evidence/S17-CHAT-UX2-QA-1-ACCEPTANCE.md`](../QA/evidence/S17-CHAT-UX2-QA-1-ACCEPTANCE.md).
> File này giữ nguyên làm **kế hoạch** (số đo §1 là ảnh TRƯỚC khi thi công) — đọc ACCEPTANCE để lấy số
> SAU. Một khác biệt đáng chú ý so với kế hoạch: đột biến **M2** ở §2 chỉ tên sai file canh
> (`ws-chat-room-payload.spec.ts` XANH); luật thật nằm ở `packages/contracts/src/chat.spec.ts` — và
> chính chỗ lệch đó lộ ra một ratchet mù, đã vá trong WO (ACCEPTANCE §5).

## 0. Trạng thái trước khi bắt đầu (đo 10/09/2026, nhánh `wo/s17-chat-ux2-fe-5`)

| Việc | Trạng thái |
| --- | --- |
| DOC-1 · BE-1 · BE-2 · FE-1 · FE-2 · FE-3 · FE-4 | ✅ merged master (#464 · #494 · #495 · #496 · #497 · #498 · #471) |
| **FE-5** | ✅ merged 11/09 (`6a35a6fd`, #499 `--admin`) — lúc lập kế hoạch còn MỞ |
| QA-1 | ✅ thi công trên `wo/s17-chat-ux2-qa-1`, cắt từ master sau #499 |

⚠️ **Không mở QA-1 trên nhánh FE-5.** Mọi con số dưới đây đo trên cây FE-5; nếu #499 phải sửa theo
review thì **đo lại**, đừng chép số cũ sang ACCEPTANCE.

**Owner chốt L5 (10/09, [comment #499](https://github.com/nguyencanhqk/mediaos/pull/499#issuecomment-5619873027)):**
drawer **giữ nguyên** — không nút gọi, không bảng thông tin phòng. Là khiếm khuyết **kế thừa** từ
`ChatDockWindow` (`showHeader={false}` ⇒ `callSlot` không render), **không phải hồi quy**. Hệ quả ép
buộc cho WO này:

- nghiệm thu nút gọi **CHỈ** trên `/chat` (SCREEN-001/002 bản đầy đủ), **KHÔNG** trên drawer;
- ACCEPTANCE ghi Known-Issue kèm câu chữ trên — **không** để ô trống, **không** đánh đỏ.

---

## 1. Số đo hiện trạng — đã chạy, đừng đo lại

### 1.1 Coverage `apps/app/src/components/chat/**`

Hai lượt, cùng `--coverage.include='src/components/chat/**/*.{ts,tsx}'`, loại `*.spec.*` +
`call-test-doubles.ts`, `--poolOptions.threads.maxThreads=2`:

| Lượt | Spec nạp | File · Ca | Stmts | Branch | **Funcs** | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| A | `src/components/chat` | 39 · 539 | 89.73 | 87.01 | **76.87** | 89.73 |
| B | `+ src/routes/chat` `+ src/layouts` | 48 · 613 | 91.23 | 87.88 | **77.89** | 91.23 |

**Ba trục đã vượt 80; chỉ trục HÀM thiếu.** Khoảng cách đúng bằng **7 hàm**: 229/294 = 77.89% →
cần **236/294** = 80.27%. Đây là toàn bộ công việc "kéo coverage" của WO này — không phải viết lại
cả cụm.

**Thủ phạm theo trục hàm** (lượt A, cột `% Funcs`):

| File | Funcs | Stmts | Ghi chú |
| --- | --- | --- | --- |
| `CreateRoomDialog.tsx` | **0** | **0** (dòng 1-181) | KHÔNG có spec nào chạm — file duy nhất 0% toàn phần |
| `chat-upload.ts` | **0** | 5.88 (43-82) | chỉ chữ ký được nạp, thân chưa từng chạy |
| `ConversationPanel.tsx` | 14.28 | 73.33 | ⚠️ nằm trong danh sách snapshot của `done_when` |
| `RoomMembersSheet.tsx` | 22.22 | 71.59 | |
| `ComposerActions.tsx` | 33.33 | 91.66 | |
| `RoomInfoPanel.tsx` | 37.83 | 79.53 | ⚠️ nằm trong danh sách snapshot của `done_when` |
| `MessageSearchPanel.tsx` | 50 | 97.5 | |
| `MessageBubble.tsx` · `CallProvider.tsx` | 60 | 88.4 · 100 | |

⇒ **Giả thuyết rẻ nhất: một spec cho `CreateRoomDialog` + một cho `chat-upload` gần như chắc đủ 7 hàm.**
Là **giả thuyết** — chạy lại lượt B rồi mới ghi số, đừng suy ra rồi ghi.

### 1.2 Cấu hình coverage đang ĐO SAI TẬP (nợ FE-5 bàn giao)

`apps/app/vitest.config.ts:18` — `coverage.include` mới chỉ `src/components/chat/call/**`. Chạy
`--coverage` bằng config kho ⇒ ngưỡng đo trên **tập con** (chỉ `call/`), không phải `components/chat`.

Và **không có khoá `coverage.thresholds` nào trong config** ⇒ mốc 80% hiện **không được máy ép**, chỉ
là câu chữ trong `done_when`. Nếu WO này thêm `thresholds`: đối chiếu tên khoá với memory
`coverage-threshold-key-typo-is-dead-gate` (gõ sai khoá = cổng chết, xanh vĩnh viễn) và **chứng minh
bằng một lượt ĐỎ cố ý** (hạ ngưỡng giả xuống 99 ⇒ phải đỏ) trước khi tin.

> `apps/app/vitest.config.ts` **KHÔNG nằm trong `paths` của QA-1** → bổ sung vào `harness/backlog.mjs`
> ở bước 0 (backlog nằm trong paths, hợp lệ).

### 1.3 `axe` KHÔNG tồn tại trong kho

`grep -c "axe-core\|jest-axe\|vitest-axe" pnpm-lock.yaml` = **0** (5 dòng khớp `axe` đều là `saxes`
của jsdom). `apps/app/package.json` không có. **Tiền lệ gần nhất `S8-CHAT-UX-QA-1` KHÔNG dùng axe** —
mục a11y ở đó nghiệm thu bằng ca hành vi, không bằng máy quét.

⇒ `done_when` "axe 0 critical/serious trên 3 màn" đòi **thêm devDependency mới** (`axe-core` +
`vitest-axe`) ⇒ chạm `package.json` + `pnpm-lock.yaml` ⇒ **cổng SCA `pnpm audit`** (memory
`pnpm-audit-gate-was-red-on-master`, `sca-gate-blind-to-lms-and-fbpost`). Đây là **quyết định phạm
vi**, xem §5.

### 1.4 jsdom không đo được màu — "snapshot light/dark" nghĩa là gì

`MessageBubble.theme.spec.tsx` đã ghi rõ tiền lệ: jsdom **không có engine CSS**, `getComputedStyle`
trên `class="bg-bubble-mine"` trả chuỗi rỗng ⇒ **một bài "đo tương phản" dựng trên DOM sẽ XANH với
mọi cặp màu, kể cả chữ trắng trên nền trắng**. Cách đã dùng: đo **giá trị token trong
`packages/ui/src/styles/theme.css`**, tức đúng nguồn mà utility đọc lúc chạy.

⇒ "snapshot light+dark cho 4 component" ở jsdom chỉ chụp được **chuỗi class**. Xem §5 để chốt hình
thái, và **ghi thẳng giới hạn vào ACCEPTANCE** — đừng để người đọc tưởng đã chứng minh được màu.

### 1.5 Ma trận BE đã kín tới đâu (đếm ca thật, không đoán)

| Nguồn | Ca | Phủ gì |
| --- | --- | --- |
| `chat-s17-be1-room-dto.int-spec.ts` | 21 | ca 1-6 `lastMessage` 4 kind (null · text-thắng-file · file · **recalled che ở server** · system · cắt 120 grapheme) · ca 7-8 `peer` theo loại phòng + không rò `directKey` · ca 9-10 `isActive` (khoá tài khoản / nghỉ việc) · ca 11 ký avatar một lô · ca 12 `createdByName` · **ca 13 non-member ⇒ 404 CHAT-ERR-001** · **ca 14 cross-tenant** · ca 15-19 `?kind=` · ca 20-21 hiệu năng (1 câu SQL · đi index) |
| `chat-s17-be2-links.int-spec.ts` | 21 | ca 1-6 membership · oversight KHÔNG miễn `assertMember` · không có đường oversight · cross-tenant · phòng lạ **giống hệt** non-member (không oracle) · ca 7-11 vị từ (thu hồi · system · `javascript:`/`data:`) · ca 12-15 trần quét + `truncated` · ca 16-21 phân trang · con trỏ phòng khác ⇒ CHAT-ERR-016 · validate |
| `ws-chat-room-payload.spec.ts` | 5 | WS `chat:room` ⊂ REST: strip mọi khoá PER-USER + khoá vòng-đời-ngắn (`avatarUrl`), có **ca đối chứng dương** + **ratchet chống trôi** (khoá mới thêm vào `chatRoomSchema` phải được xét lại) |

**Ô còn trống thật sự của `done_when` #1:** ma trận đòi `lastMessage` **4 kind × {member, non-member,
cross-tenant}** = 12 ô. Hiện có: 4 kind ở nhánh **member**, và non-member/cross-tenant chứng minh
**một lần** ở tầng `getRoom`/`listRooms` (ca 13/14) — **chưa nhân với từng kind**. Xem §5 để chốt.

---

## 2. Đột biến bắt buộc (`done_when` #2) — RED trước, không thương lượng

Phương pháp S8: đổi **đúng một vị từ** ở production code → chạy → phải ĐỎ → `git checkout` → phải
XANH. Không đột biến nào được commit (`git status --porcelain` rỗng sau mỗi lượt). **Chép file gốc ra
scratchpad TRƯỚC khi đột biến** (bài học `S18-QA-ASSETFLAKE-1`).

| # | Đột biến | Ca phải ĐỎ |
| --- | --- | --- |
| M1 | BE-1: bỏ vế che tin **thu hồi** trong `lastMessage` | `chat-s17-be1-room-dto` ca 4 — nếu KHÔNG đỏ thì ca 4 đang xanh-RỖNG |
| M2 | bỏ `avatarUrl` khỏi `.omit()` của `wsChatRoomEventSchema` | `ws-chat-room-payload` ca "khoá vòng-đời-ngắn" |
| M3 *(đề xuất)* | BE-2: bỏ vế loại `message_type='system'` khỏi trích link | `chat-s17-be2-links` ca 9 |
| M4 *(đề xuất)* | FE: nới `MAX_DOCK_WINDOWS` 1 → 2 | ca "đúng 1 hội thoại" của `chat-dock.store.spec` — FE-5 đã dùng đúng đột biến này để bắt một ca đi-qua-giao-diện xanh-RỖNG; giữ lại làm canh gác |

---

## 3. Ratchet — chứng minh KHÔNG bị nới (`done_when` #4)

| Cổng | Cách kiểm |
| --- | --- |
| `apps/api/src/realtime/chat-realtime-structure.spec.ts` (0 `@SubscribeMessage`) | chạy + `git diff master..HEAD -- <file>`: nếu allowlist có tên mới thì phải có **đền bù** (ca đo lại *tính chất* của tên đó), theo tiền lệ S8 §5 và memory `index-ratchet-must-pin-definition-not-name` |
| ESLint `no-restricted-imports` `socket.io-client` (single-socket-file) | `pnpm lint` + đếm file import trực tiếp |
| `chat-error-code-census.spec.ts` · `chat.permissions.spec.ts` | chạy lại, ghi số ca |
| `ws-chat-room-payload.spec.ts` ratchet chống trôi | BE-1 thêm `lastMessage`/`peer`/`createdByName` vào `chatRoomSchema` — **kiểm ratchet đó đã được xét lại ĐÚNG cách** (3 khoá này là dữ liệu phòng dùng chung hay per-user? `peer.isActive` là dùng chung; nhưng phải đọc, không giả định) |

---

## 4. Thứ tự thi công

0. **Chờ #499 land master** → `git checkout master && git pull` → nhánh `wo/s17-chat-ux2-qa-1`.
   Bổ sung `apps/app/vitest.config.ts` vào `paths` của QA-1 trong `harness/backlog.mjs` (§1.2).
1. **Đo lại** lượt B trên master (số §1.1 đo ở nhánh FE-5) — ghi vào ACCEPTANCE là số của master.
2. Vá `coverage.include` (§1.2) → chạy lại → xác nhận cùng con số.
3. Lấp trục hàm: `CreateRoomDialog` + `chat-upload` trước (rẻ nhất/đơn vị), **đo lại**, chỉ viết thêm
   nếu vẫn < 80.
4. Ma trận + ô trống §1.5 theo quyết định §5.
5. Sweep đột biến §2 (4 lượt) — ghi bảng đỏ/xanh.
6. Ratchet §3.
7. `bash harness/check.sh --all --lane-db=s17qa1` (WO có int-spec ⇒ **bắt buộc** `LANE_DB`, memory
   `integration-test-lane-db-gate`; lane **dựng mới**, memory `flake-rate-tracks-lane-db-dirtiness`).
8. `docs/QA/evidence/S17-CHAT-UX2-QA-1-ACCEPTANCE.md` (khuôn S8) + `docs/TESTABLE-FEATURES.md` + đóng
   wave (regen STATUS + memory).

---

## 5. Ba chỗ `done_when` va vào hiện trạng

### Q1 — "axe 0 critical/serious trên 3 màn" · ✅ CHỐT (owner, 10/09): **KHÔNG thêm axe** — theo tiền lệ S8

axe **không có trong kho** (§1.3) và tiền lệ gần nhất `S8-CHAT-UX-QA-1` không dùng. Lý do kỹ thuật
đứng sau quyết định: trong **jsdom axe không chạy được luật `color-contrast`** (không có engine CSS —
cùng lý do §1.4), nên phần đắt nhất của nó vẫn mù; trả 2 devDependency qua cổng SCA để lấy phần
ARIA/label là không đáng.

Nghiệm thu a11y của WO này = **ca hành vi thật**, mỗi ca một luật:

| Luật | Ca |
| --- | --- |
| focus-trap của `Sheet` | tab vòng trong drawer, không thoát ra nền |
| Esc **hai tầng** (FE-5 §3.5) | trong panel mình ⇒ nhường · ngoài mọi modal ⇒ đóng · trong modal KHÁC ⇒ KHÔNG nhường |
| `aria-*` | `role`/`aria-label`/`aria-expanded` của ChatBadge · drawer · nút ⓘ |
| thứ tự tab | danh sách → ô tìm → chip → hội thoại |

ACCEPTANCE ghi **KI: "chưa quét a11y bằng máy; axe cần trình duyệt thật"** + trỏ sang hướng (c) đã
cân nhắc (WO E2E Playwright riêng) nếu sau này muốn phủ nốt.

### Q2 — "snapshot light+dark 4 component" · ✅ CHỐT: **cả hai trục, và ghi rõ trục nào chứng minh gì**

jsdom không có engine CSS (§1.4) nên một trục là không đủ:

- **token** (khuôn `MessageBubble.theme.spec.tsx`) — chứng minh **màu** đạt tương phản ở cả light lẫn
  dark; KHÔNG chứng minh component dùng đúng token đó;
- **snapshot chuỗi class** — chứng minh component **dùng đúng token**; KHÔNG chứng minh màu.

Thiếu vế nào thì vế kia xanh-RỖNG với một nửa lớp lỗi. ACCEPTANCE ghi thẳng ranh giới này, không
viết "snapshot light/dark PASS" trống không.

### Q3 — "lastMessage 4 kind × {member, non-member, cross-tenant}" = 12 ô · ✅ CHỐT: **4 ô + 2 ca neo**, KHÔNG nhân 12

Đã đọc code, không suy đoán:

- `chat-rooms.service.ts:123` `listRooms` → `repo.listRoomsForUser` **innerJoin `chat_room_members`
  của actor** ⇒ đường danh sách **không nhận `roomId` từ client** ("không có phòng nào để vượt",
  jsdoc CHAT-API-001). Người ngoài phòng / khác tenant nhận **0 hàng** — hai LATERAL
  (`chat-rooms.repository.ts:233`) tính `lastMessage` **trên hàng đã lọc**, nên nhánh `kind` KHÔNG
  BAO GIỜ chạy cho actor bị chặn.
- `chat-rooms.service.ts:174` `getRoom` gọi `access.assertMember` **trước** mọi thứ khác.

⇒ 8 ô "kind × {non-member, cross-tenant}" là **cổng CHỒNG NHAU**: chúng sẽ xanh dù nhánh `kind` có
hỏng thế nào — đúng lớp lỗi memory `overdetermined-gate-makes-deny-spec-vacuous`. Viết chúng ra là
**mua 8 ca xanh-rỗng** rồi ghi vào ACCEPTANCE như bằng chứng, tức làm bảng nghiệm thu **kém trung
thực hơn** khi để trống.

Nghiệm thu đúng: 4 ô kind ở nhánh member (BE-1 ca 1-6) + **2 ca neo cổng** (ca 13 non-member ⇒ 404
`CHAT-ERR-001` · ca 14 cross-tenant ⇒ 0 hàng) + **luận cứ cấu trúc trên** chép vào ACCEPTANCE kèm số
dòng. Nếu ai đó sau này gỡ `innerJoin` khỏi `listRoomsForUser` thì ca 14 đỏ — đó mới là canh gác thật.

---

## 6. Cách chạy ở máy này

```bash
# KHÔNG chạy full-suite apps/app — worker vitest chết ERR_IPC_CHANNEL_CLOSED (KI-014), một lần kéo sập máy.
pnpm --filter @mediaos/app exec vitest run src/components/chat src/routes/chat src/layouts \
  --coverage --coverage.include='src/components/chat/**/*.{ts,tsx}' \
  --coverage.exclude='src/components/chat/**/*.spec.{ts,tsx}' \
  --coverage.exclude='src/components/chat/call/call-test-doubles.ts' \
  --poolOptions.threads.maxThreads=2 --reporter=dot     # lượt B: 48 file · 613 ca · ~11s

bash scripts/lane-db-setup.sh s17qa1 && export LANE_DB=mediaos_s17qa1
pnpm --filter @mediaos/api exec vitest run test/integration/chat-s17-*.int-spec.ts
bash harness/check.sh --all --lane-db=s17qa1
```
