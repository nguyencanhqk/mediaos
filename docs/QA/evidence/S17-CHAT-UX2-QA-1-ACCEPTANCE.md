# S17-CHAT-UX2-QA-1 — nghiệm thu wave S17-CHAT-UX2 (bằng chứng đo)

> WO: `harness/backlog.mjs` → `S17-CHAT-UX2-QA-1`. Kế hoạch: [`docs/plans/S17-CHAT-UX2-QA-1.md`](../../plans/S17-CHAT-UX2-QA-1.md).
> Khuôn: [`S8-CHAT-UX-QA-1-ACCEPTANCE.md`](S8-CHAT-UX-QA-1-ACCEPTANCE.md).
>
> **Đo trên `master` ngày 11/09/2026**, sau khi FE-5 (#499, `6a35a6fd`) land — không phải số của nhánh
> FE-5. Nhánh đo: `wo/s17-chat-ux2-qa-1`, cắt từ master sạch.
>
> Bảng dưới **ánh xạ luật → ca đang canh luật đó**. Mỗi ô "✅" đều đi kèm một lượt đột biến ở §3 hoặc
> một ca có tên — KHÔNG có ô nào chỉ dựa vào việc suite xanh.

---

## 0. Phạm vi wave

| WO | PR | Trạng thái |
| --- | --- | --- |
| DOC-1 · BE-1 · FE-2 | #464 · #494 · #471 | ✅ merged |
| BE-2 · FE-1 · FE-3 · FE-4 | #495 · #496 · #497 · #498 | ✅ merged 10/09 |
| FE-5 | #499 (`6a35a6fd`) | ✅ merged 11/09 — `--admin` (protection đòi 1 review mà repo chỉ 1 tài khoản = tác giả PR) |
| **QA-1** | WO này | đóng wave |

---

## 1. `lastMessage` — 4 `kind` × tư cách người gọi

Quyết định phạm vi (plan §5 Q3, owner chốt 10/09): **4 ô `kind` ở nhánh member + 2 ca neo cổng**, KHÔNG
nhân thành 12 ô. Lý do đọc từ code, không suy đoán:

- `chat-rooms.service.ts:123` `listRooms` → `repo.listRoomsForUser` **innerJoin `chat_room_members` của
  actor** (`chat-rooms.repository.ts:233`). Đường danh sách không nhận `roomId` từ client ⇒ người ngoài
  phòng / khác tenant nhận **0 hàng**, và hai LATERAL tính `lastMessage` chạy **trên hàng đã lọc** —
  nhánh `kind` KHÔNG BAO GIỜ chạy cho actor bị chặn.
- `chat-rooms.service.ts:174` `getRoom` gọi `access.assertMember` **trước** mọi thứ khác.

⇒ 8 ô "kind × {non-member, cross-tenant}" là **cổng CHỒNG NHAU**: chúng xanh dù nhánh `kind` hỏng thế
nào (memory `overdetermined-gate-makes-deny-spec-vacuous`). Viết ra là mua 8 ca xanh-rỗng rồi ghi vào
bảng nghiệm thu như bằng chứng.

| Luật | Ca canh | Đột biến chứng minh |
| --- | --- | --- |
| `kind=recalled` — tin thu hồi **che ở SERVER** | `chat-s17-be1-room-dto.int-spec.ts` ca 4 | **M1** ✅ ĐỎ |
| `kind=text` (thắng file khi có body) · cắt 120 grapheme | ca 1-3, 6 | — |
| `kind=file` | ca 3 | — |
| `kind=system` | ca 5 | — |
| **neo cổng 1** — non-member ⇒ 404 `CHAT-ERR-001` | ca 13 | — |
| **neo cổng 2** — cross-tenant ⇒ 0 hàng | ca 14 | — |
| `peer` chỉ khác `null` ở phòng `direct` · không rò `directKey` | ca 7-8 | — |
| `peer.isActive` hai vế (khoá tài khoản · nghỉ việc) | ca 9-10 | — |

Nếu ai đó gỡ `innerJoin` khỏi `listRoomsForUser` thì **ca 14 đỏ** — đó là canh gác thật, không phải 8 ô
trang trí.

---

## 2. Liên kết phòng (BE-2) · payload WS ⊂ REST

| Luật | Ca canh | Đột biến |
| --- | --- | --- |
| membership bắt buộc; oversight KHÔNG miễn `assertMember`; phòng lạ **giống hệt** non-member (không oracle) | `chat-s17-be2-links.int-spec.ts` ca 1-6 | — |
| vị từ trích link: bỏ tin **thu hồi**, bỏ `message_type='system'`, chặn `javascript:`/`data:` | ca 7-11 | **M3** ✅ ĐỎ |
| trần quét + cờ `truncated`; phân trang; con trỏ phòng khác ⇒ `CHAT-ERR-016` | ca 12-21 | — |
| WS `chat:room` strip 4 khoá per-user + `avatarUrl` **cấp phòng** | `ws-chat-room-payload.spec.ts` (5 ca gốc) | **M2b** ✅ ĐỎ |
| WS strip `peer.avatarUrl` (**khoá LỒNG**) | `packages/contracts/src/chat.spec.ts` "CA ÂM" · **+ ca mới** `ws-chat-room-payload.spec.ts` (§5) | **M2** ✅ ĐỎ |

---

## 3. RED-trước-GREEN — đột biến có kiểm soát

Phương pháp S8: đổi **đúng một vị từ** ở production code → chạy ca canh nó → phải ĐỎ → `git checkout` →
phải XANH. Không đột biến nào được commit; `git status --porcelain` sạch sau mỗi lượt (đã kiểm).

| # | Đột biến | Ca phải đỏ | Kết quả |
| --- | --- | --- | --- |
| M1 | `chat-preview.ts` — vô hiệu vế che tin **thu hồi** | `chat-s17-be1-room-dto` ca 4 | **ĐỎ ✅** |
| M2 | `realtime.ts:181` — bỏ `.omit({ avatarUrl })` của `wsChatRoomPeerSchema` | `contracts/chat.spec` CA ÂM | **ĐỎ ✅** *(xem §5 — file api-side ban đầu XANH)* |
| M2b | `realtime.ts` — bỏ `avatarUrl` khỏi `.omit()` **cấp phòng** | `ws-chat-room-payload` + `contracts/chat.spec` | **ĐỎ ✅** (cả hai) |
| M3 | `chat-messages.repository.ts:317` — bỏ `ne(messageType, "system")` | `chat-s17-be2-links` | **ĐỎ ✅** |
| M4 | `chat-dock.store.ts:32` — nới `MAX_DOCK_WINDOWS` 1 → 2 | `chat-dock.store.spec` | **ĐỎ ✅** |
| M5 | `chat-upload.ts` — bỏ pha **PUT bytes** | `chat-upload.spec` (spec MỚI) | **ĐỎ ✅** |
| M6 | `CreateRoomDialog.tsx` — bỏ khoá hàng "chưa liên kết tài khoản" | `CreateRoomDialog.spec` (spec MỚI) | **ĐỎ ✅** |
| M7 | `RoomMembersSheet.tsx` — bỏ vế `member.userId !== myUserId` khỏi cổng | `RoomMembersSheet.spec` (spec MỚI) | **ĐỎ ✅** |

M5-M7 tồn tại để chứng minh ba spec **mới viết trong WO này** không xanh-rỗng — spec mới không được
miễn chính phép thử mà nó áp lên code cũ.

---

## 4. Coverage `apps/app/src/components/chat/**`

Lệnh nghiệm thu (đã thành script kho): `pnpm --filter @mediaos/app test:chat-cov`
— nạp `src/components/chat` + `src/routes/chat` + `src/layouts`, đo trên `src/components/chat/**`.

| Mốc | Spec nạp | File · Ca | Stmts | Branch | **Funcs** | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| Trước WO (master sau #499) | 48 file | 613 | 91.23 | 87.88 | **77.89** (229/294) | 91.23 |
| **Sau WO** | 51 file | **660** (+47) | **94.72** | **88.52** | **81.73** (255/312) | **94.72** |

Ba spec mới, 47 ca:

| File | Ca | Lấp gì |
| --- | --- | --- |
| `chat-upload.spec.ts` | 13 | `chat-upload.ts` **0% hàm → 100% cả bốn trục** — module duy nhất chưa từng chạy một dòng thân hàm (spec tầng trên `vi.mock` nó) |
| `CreateRoomDialog.spec.tsx` | 14 | `CreateRoomDialog.tsx` **0% toàn phần → 94.73% hàm · 97.91% dòng** — cửa vào module, trước đó không spec nào chạm |
| `RoomMembersSheet.spec.tsx` | 20 | `RoomMembersSheet.tsx` **22.22% → 100% hàm** — cổng 4 vế thao tác thành viên (tắt ĐÚNG một vế mỗi ca + ca ALLOW đối chứng) và `seenLabel` 4 nhánh (`undefined` ≠ `0`) |

> **Mẫu số hàm đổi 294 → 312** là bình thường, không phải lỗi đo: v8 chỉ đếm đủ số hàm của một file sau
> khi file đó THỰC SỰ chạy. Hai file 0% trước đây được đếm thiếu — nên con số 77.89% cũ còn **lạc quan
> hơn** sự thật.

### 4.1 Cấu hình coverage — nợ FE-5 đã trả

- `apps/app/vitest.config.ts` `coverage.include` trước WO chỉ có `src/components/chat/call/**` ⇒ mọi
  lượt `--coverage` bằng config kho đo trên **TẬP CON**. Nay là `src/components/chat/**`.
- Thêm `coverage.thresholds` (statements/branches/functions/lines = **80**). **Đã nghiệm bằng lượt đỏ
  cố ý** (memory `coverage-threshold-key-typo-is-dead-gate`): hạ sàn giả lên 99 ⇒ `exit 1` kèm 4 dòng
  `ERROR: Coverage for … does not meet global threshold (99%)`; trả về 80 ⇒ `exit 0`. Khoá **không**
  gõ sai.

### 4.2 Sàn → **cổng PR** (S17-CHAT-UX2-QA-2, 2026-09-12) — KI-S17-3 đóng

`Apps — Frontend CI` thêm bước riêng, chỉ cho app `app`:

```yaml
- name: Coverage gate — cụm chat (≥80% / 4 trục)
  if: matrix.app == 'app'
  run: pnpm --filter @mediaos/app test:chat-cov
```

**Vì sao LƯỢT RIÊNG, không phải `--coverage` gắn vào bước `Test`** (done_when #2 — đo trước khi chốt,
không suy đoán). Bốn lượt local 2026-09-12, cùng máy, cùng cây làm việc:

| Lượt | Lệnh | Kết quả | Thời gian |
| --- | --- | --- | --- |
| A | `pnpm --filter @mediaos/app test` (hiện trạng CI) | ✅ 275 file · 2721 ca | **29s** |
| B | `test:chat-cov` (lượt được chọn làm cổng) | ✅ st 94.72 · br 88.52 · **fn 81.73** · ln 94.72 | **14s** |
| C | `vitest run --coverage` (toàn suite) ×2 | ❌ **`Unhandled Rejection: Channel closed`** (`ERR_IPC_CHANNEL_CLOSED`, tinypool) — chết ở ~8–13s, **không in nổi bảng coverage** | — |
| D | `vitest run --coverage --poolOptions.threads.maxThreads=2` | ❌ y hệt C | — |

⇒ bật `--coverage` cho lượt full là mua **đỏ oan** (3/3 lượt chết, hạ `maxThreads` không cứu), và kể cả
nếu nó chạy được thì phạm vi chạy khác ⇒ **mẫu số `functions` khác** (§4 — v8 chỉ đếm đủ hàm của file
đã thực sự chạy) ⇒ con số CI sẽ là một ngưỡng THỨ HAI chưa ai hiệu chuẩn.

**Chi phí cổng — số CI THẬT, không suy từ số local** (done_when #2: "đo thời gian trước-sau"):

| Mốc | `Build app` | Ghi chú |
| --- | --- | --- |
| master trước WO (2 run gần nhất) | **5m21s** · **5m26s** | chưa có bước cổng |
| nhánh PR sau WO (lượt xanh #2) | **6m12s** | bước `Coverage gate` tốn **66s** (09:01:12 → 09:02:18) |

⇒ **+~50s trên job `Build app`, ~+16%**. `auth`/`console` không đổi (bước `skipped`).

⚠️ **66s ở CI so với 14s ở local** — runner chậm ~4,7 lần cho đúng lượt này. Đừng lấy số local ước
lượng chi phí CI: muốn mở cổng ra app khác thì phải đo lại bằng số CI.

**Nghiệm bằng VI PHẠM thật, không bằng đọc YAML** (memory `coverage-threshold-key-typo-is-dead-gate`,
`vitest-globalsetup-teardown-exits-zero` — một cổng chưa từng đỏ là một cổng chưa được chứng minh):

| # | Commit trên nhánh PR #505 | Bước `Test` | Bước `Coverage gate` | Run |
| --- | --- | --- | --- | --- |
| 1 | cổng + **sàn giả 99** (vi phạm cố ý) | ✅ success | ❌ **failure** — 4 dòng `ERROR: Coverage for … does not meet global threshold (99%)`, `Build`/`Upload dist` sau đó `skipped` | [34684202708](https://github.com/nguyencanhqk/mediaos/actions/runs/34684202708/job/103528212585) |
| 2 | revert sàn về **80** (net diff của PR) | ✅ success | ✅ **success** — in bảng coverage, `Build`/`Upload dist` chạy tiếp | [34684532510](https://github.com/nguyencanhqk/mediaos/actions/runs/34684532510) |

Điểm mấu chốt của lượt #1: bước `Test` NGAY TRƯỚC vẫn **success**, chỉ bước `Coverage gate` đỏ ⇒ cổng
đỏ vì **đúng lý do coverage**, không phải vì suite hỏng. Một cổng không phân biệt được hai chuyện đó
thì không phải cổng.

**Đối soát số CI ↔ số local** (done_when #2 — làm TRƯỚC khi chốt ngưỡng, số lấy từ log lượt #1):

| Trục | Local (Windows) | CI (ubuntu-latest) | Lệch | Dư trên sàn 80 |
| --- | --- | --- | --- | --- |
| Statements | 94.72 (5705/6023) | 94.72 (5705/6023) | — | +14.7 |
| Branches | 88.52 (1466/1656) | **88.6 (1469/1658)** | **+2 mẫu số, +3 tử số** | +8.6 |
| Functions | 81.73 (255/312) | 81.73 (255/312) | — | **+1.7** ← trục hẹp nhất |
| Lines | 94.72 (5705/6023) | 94.72 (5705/6023) | — | +14.7 |

⇒ số CI **không** đồng nhất tuyệt đối với số local: mẫu số `branches` lệch 2 giữa hai nền. Biên 8.6
điểm nên vô hại hôm nay, nhưng đừng hiệu chuẩn ngưỡng sát mép dựa trên một lượt local — trục quyết
định số phận cổng là `functions` (dư 1.7 điểm), và mẫu số của nó TĂNG mỗi khi thêm spec nạp một file
đang 0% (§4). Thêm file vào `include` mà không thêm spec ⇒ cổng đỏ.

Phụ: ba filter `auth`/`console`/`app` nay gồm cả `.github/workflows/apps-frontend.yml` — không có vế đó
thì một PR chỉ sửa pipeline đi qua mà **không job nào chạy**, tức cổng vừa sửa không được chính PR sửa
nó nghiệm (đúng lớp lỗi "cổng chết" ở trên, một tầng cao hơn).

---

## 5. Phát hiện của WO — ratchet WS **mù với khoá LỒNG** (đã vá)

Lượt M2 ban đầu chạy vào `apps/api/src/realtime/ws-chat-room-payload.spec.ts` và **XANH 5/5** dù đột
biến đã vào tận `packages/contracts/dist/{cjs,esm}/realtime.js` (đã kiểm bằng `grep` trên dist — không
phải bẫy `stale dist`).

Nguyên nhân: ca "BẤT BIẾN CHỐNG TRÔI" so **danh sách khoá CẤP MỘT** giữa `chatRoomSchema` và schema WS.
`peer` có mặt ở **cả hai** bên — chỉ khác là bản WS hẹp hơn — nên phép so cấp một không thấy gì. Đúng
lớp lỗi mà docblock của chính `wsChatRoomPeerSchema` cảnh báo: `.omit()` của Zod KHÔNG với tới khoá
lồng, nên mỗi object con là một hợp đồng phải **tự** canh.

Hệ quả trước khi vá: luật `peer.avatarUrl` chỉ còn được canh ở `packages/contracts/src/chat.spec.ts` —
một nơi, và **không phải nơi người ta tìm khi sửa tầng realtime**.

**Vá (trong WO này, 40 dòng):** thêm ca `BẤT BIẾN CHỐNG TRÔI (KHOÁ LỒNG)` vào
`ws-chat-room-payload.spec.ts`, gồm hai vế:

1. **vế dẫn xuất** — duyệt mọi khoá object con, tính tập khoá bị strip, assert `["peer.avatarUrl"]`.
   Gỡ `.omit()` ⇒ mảng rỗng ⇒ ĐỎ (đã nghiệm: 1 failed | 5 passed).
2. **vế hình dạng** — pin `Object.keys(chatRoomPeerSchema)`. Vế 1 KHÔNG bắt được khoá lồng **mới** (nó
   nằm ở cả hai bên); vế 2 buộc người thêm khoá phải chạm file này và quyết định per-recipient hay
   không (memory `index-ratchet-must-pin-definition-not-name`).

---

## 6. Ratchet — có bị nới không

| Cổng | Kết quả |
| --- | --- |
| `chat-realtime-structure.spec.ts` (0 `@SubscribeMessage`) | ✅ 12 ca xanh |
| ESLint `no-restricted-imports` `socket.io-client` (single-socket-file) | ✅ `pnpm lint` **0 error**; đúng **1** file import thật (`packages/web-core/src/lib/realtime-socket.ts`, nằm trong `ignores`). `call-signalling.ts` chỉ nhắc tên trong **comment** — không phải import |
| `chat-error-code-census.spec.ts` · `chat.permissions.spec.ts` · `ws-chat-room-payload.spec.ts` | ✅ 167 ca xanh (trước khi thêm ca §5) |
| `ws-chat-room-payload` ratchet chống trôi — "đã được xét lại ĐÚNG cách?" | ❌ **KHÔNG** với khoá lồng → **đã vá ở §5** |

---

## 7. Lượt chạy tổng

```
bash harness/check.sh --all --lane-db=s17qa1     →  XANH ✅  (exit 0)
```

| Bước | Kết quả |
| --- | --- |
| secret-literals · lint · typecheck · migration-no-drop · tooling-tests | ✅ |
| test `LANE_DB=mediaos_s17qa1` [chunked] | ✅ **1071 file · 16 463 ca** |
| build · prod-tenant-check · db-readiness | ✅ (FORCE RLS 0 bảng thiếu · append-only 0 grant thừa trên 9 bảng ledger) |

Lane DB `mediaos_s17qa1` **dựng mới** cho lượt này (memory `flake-rate-tracks-lane-db-dirtiness`).
Guard `lane-db-guard` xác nhận chạy **NHƯ CI**: deny-path/IDOR/cross-tenant KHÔNG bị skip — không phải
trạng thái "XANH KHÔNG ĐỦ BẰNG CHỨNG".

Int-spec của wave chạy riêng trên lane đó: `chat-s17-be1-room-dto` + `chat-s17-be2-links` = **42 ca xanh**.

---

## 8. Known Issues mở khi đóng wave

| # | KI | Ghi chú |
| --- | --- | --- |
| KI-S17-1 | **Drawer chat không có nút gọi và không có bảng thông tin phòng** | Owner chốt **GIỮ NGUYÊN** (10/09, [comment #499](https://github.com/nguyencanhqk/mediaos/pull/499#issuecomment-5619873027)). Khiếm khuyết **kế thừa** từ `ChatDockWindow` (`showHeader={false}` ⇒ `callSlot` không render), **không phải hồi quy** của FE-5. Nghiệm thu nút gọi CHỈ trên `/chat` |
| KI-S17-2 | **Chưa quét a11y bằng máy** | `axe` không có trong kho (`pnpm-lock.yaml`: 0 dòng `axe-core`/`jest-axe`/`vitest-axe`). Owner chốt KHÔNG thêm (tiền lệ S8): trong jsdom luật `color-contrast` của axe **không chạy được** (không có engine CSS), nên phần đắt nhất vẫn mù — trả 2 devDependency qua cổng SCA để lấy phần ARIA là không đáng. Nghiệm thu a11y bằng **ca hành vi** (focus-trap · Esc hai tầng · `aria-*` · thứ tự tab — `sheet.spec.tsx`, `ChatDrawer.spec.tsx`, `ConversationPanel.spec.tsx`). Muốn phủ nốt: WO E2E Playwright riêng |
| KI-S17-3 | ~~**Sàn coverage 80% chưa phải cổng PR**~~ → **ĐÃ ĐÓNG** (2026-09-12, `S17-CHAT-UX2-QA-2`) | `Apps — Frontend CI` có bước riêng **`Coverage gate — cụm chat (≥80% / 4 trục)`** (`if: matrix.app == 'app'`) gọi đúng `pnpm --filter @mediaos/app test:chat-cov`. Nghiệm bằng **vi phạm thật** trên nhánh PR, không bằng đọc YAML — xem §4.2 |
| KI-S17-4 | jsdom **không đo được màu** | "snapshot light/dark" ở jsdom chỉ chụp được **chuỗi class**. Tương phản màu được canh ở trục token (`MessageBubble.theme.spec.tsx` đọc `packages/ui/src/styles/theme.css`). Thiếu vế nào thì vế kia xanh-rỗng với một nửa lớp lỗi — đừng đọc "snapshot PASS" thành "màu đã chứng minh" |
| KI-S17-5 | Nợ cũ chưa vá | BE-2 2 finding LOW (join `deleted_at` · bidi/homograph trong URL — `docs/plans/S17-CHAT-UX2-BE-2.md` §12) · FE-4 4 điểm lệch `done_when` owner đã duyệt (`docs/plans/S17-CHAT-UX2-FE-4.md` §7.3) |
