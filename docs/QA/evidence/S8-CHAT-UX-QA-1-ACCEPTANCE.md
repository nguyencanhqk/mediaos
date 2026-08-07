# S8-CHAT-UX-QA-1 — nghiệm thu wave S8-CHAT-UX (bằng chứng đo)

> Kế hoạch + phán quyết: [`docs/plans/S8-CHAT-UX-QA-1.md`](../../plans/S8-CHAT-UX-QA-1.md).
> Lane `mediaos_s8qa1` (dựng mới, chain `0000 → 0545`) · HEAD `3dea862d` + thay đổi của WO này.
> Ngày đo: **2026-08-07**.

Bảng dưới đây **không nhân bản** nội dung test — nó ánh xạ *luật* → *ca đang canh luật đó*. Ô trống là
lỗ; mọi ô trống tìm được đã được lấp trong chính WO này (cột **Ca** in đậm = ca MỚI).

---

## 1. Ma trận deny-path — 11 đường ghi/đọc mới của wave

Ký hiệu: **M** = là thành viên phòng · **¬M** = không phải thành viên (nhưng CÓ đủ cặp quyền module) ·
**¬P** = thiếu cặp quyền module · **X-T** = người của công ty khác.

| # | Route | ¬M | phòng lạ | ¬P | chưa đăng nhập | tư cách theo loại phòng | X-T |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `PUT /chat/rooms/:id/pin` | BE-1 ca 1 (404 · ERR-001) | ca 2 (giống hệt) | — | ca 3 (401) | — | BE-1 ca 13 (0 hàng) |
| 2 | `DELETE /chat/rooms/:id/pin` | BE-1 ca 1 | ca 2 | — | ca 3 | — | BE-1 ca 13 |
| 3 | `PUT /chat/rooms/:id/mute` | BE-1 ca 1 | ca 2 | — | ca 3 | — | BE-1 ca 13 |
| 4 | `POST /chat/rooms/:id/unread` | BE-1 ca 1 | ca 2 | — | ca 3 | — | BE-1 ca 13 |
| 5 | `POST /chat/rooms/:id/avatar/upload-url` | BE-2 ca 1 | BE-2 ca 2 | guard | BE-2 ca 6 | **QA-1 A6** (403 + 0 hàng `files`) | **QA-1 C1** |
| 6 | `POST /chat/rooms/:id/avatar` | BE-2 ca 1 | BE-2 ca 2 | guard | BE-2 ca 6 | `direct` BE-2 ca 4 · `group` ca 3/14 · **`department` QA-1 A3·A4·A5** · **`project` QA-1 B3·B4** | **QA-1 C1** |
| 7 | `DELETE /chat/rooms/:id/avatar` | BE-2 ca 1 | BE-2 ca 2 | guard | BE-2 ca 6 | BE-2 ca 14 · **QA-1 A7** | **QA-1 C1** |
| 8 | `PUT /chat/messages/:id/reactions/:emoji` | BE-3 ca 1 (404 · ERR-001) | BE-3 ca 2 | BE-3 ca 3 (403) | BE-3 ca 4 | tin thu hồi ca 10 · phòng lưu trữ ca 11 · emoji ngoài bộ ca 12/13 | BE-3 ca 16 |
| 9 | `DELETE /chat/messages/:id/reactions/:emoji` | BE-3 ca 1 | BE-3 ca 2 | BE-3 ca 3 | BE-3 ca 4 | ca 8 (chưa thả ⇒ 204) · ca 9 (không đụng của người khác) | BE-3 ca 16 |
| 10 | `POST /chat/rooms/:id/typing` | RT-1 ca 1 | RT-1 ca 2 | RT-1 ca 3 (403) | RT-1 ca 4 | ca 7 (lưu trữ vẫn 204) · ca 8 (UUID sai ⇒ 400) | khoá presence mang `companyId` — **QA-1 presence A/B** |
| 11 | `GET /chat/rooms/:id/members` (roster) | FE-3 ca 1 | FE-3 ca 2 | guard | — | ca 3 (người đã rời VẪN có, kèm `leftAt`) | **QA-1 C1** |

**Luật nền của mọi ô 404:** thân phản hồi phải mang **`CHAT-ERR-001`**, không chỉ status. 404 của "route
chưa tồn tại" trông y hệt 404 của "phòng không thuộc về bạn" — thiếu assert mã trong thân thì ca deny
vẫn xanh cả khi route chưa được viết.

**Luật nền của mọi ô 403:** phải phân biệt **`CHAT-ERR-023`** (đủ cặp, thiếu tư cách) với 403 của
`PermissionGuard` (thiếu cặp). Hai thứ giống hệt nhau ở status.

### 1.1 Nhánh tư cách avatar (`CHAT-DEC-016`) — bảng đầy đủ 4 loại phòng

| Loại phòng | Nguồn tư cách | ALLOW | DENY |
| --- | --- | --- | --- |
| `direct` | — (không có cột để ghi) | ✗ không bao giờ | BE-2 ca 4 (422 `CHAT-ERR-022`) + CHECK ở DB là đai hai |
| `group` | admin phòng | BE-2 ca 9 | BE-2 ca 3 · ca 14 (403 `CHAT-ERR-023`) |
| `department` | `('update','org_unit')` **với đơn vị neo của phòng** | **QA-1 A1** (`@Company`) · **A2** (`@Department` trùng neo) | **A3** (không cặp) · **A4** (`@Own` ⇒ fail-closed) · **A5** (`@Department` lệch đơn vị) |
| `project` | vai dự án ∈ {Owner, Manager} **đang Active** | **QA-1 B1** (Owner) · **B2** (Manager) | **B3** (Member) · **B4** (đã rời dự án, kể cả vai Owner) |

Hai hàng cuối trước WO này **trống hoàn toàn** — cả cột ALLOW lẫn cột DENY.

---

## 2. Cross-tenant — 4 trục của `done_when` #2

| Trục | Tầng DB | Tầng API |
| --- | --- | --- |
| `pinned_at` / `marked_unread_at` | `s7-chat-db1-invariants` mục I (composite FK + RLS) | BE-1 ca 13 (0 hàng của B mang dấu do A ghi) |
| `avatar_file_id` | `db1-invariants` mục I: `chat_rooms_avatar_file_id_company_fk` ⇒ 23503 | **QA-1 C1** (4 route × 404 `CHAT-ERR-001`) + **C2** (0 `file_links` mang tenant khác) |
| `chat_message_reactions` | `db1-invariants` mục I: RLS ⇒ A đọc 0 hàng của B, xoá 0 hàng của B; FK `user_id`/`message_id` composite | BE-3 ca 16 |
| presence (`đang online`) | — (sống ở Valkey, không ở Postgres) | **QA-1** ca A/B hai công ty cùng một kho Valkey ⇒ B thấy rỗng, đối chứng dương A thấy có |

---

## 3. RED-trước-GREEN — đột biến có kiểm soát

Phương pháp: đổi ĐÚNG MỘT vị từ ở production code → chạy → phải ĐỎ → khôi phục → phải XANH. Không đột
biến nào được commit (`git status --porcelain apps/api/src` rỗng sau mỗi lượt).

| # | File · vị từ bị đổi | Ca ĐỎ | Số ca đỏ/xanh |
| --- | --- | --- | --- |
| M1 | `chat-room-avatar.service.ts` — `resourceType: 'org_unit'` → `'org-unit'` | A1 · A2 · A7 · C2 | 4 đỏ / 12 xanh |
| M2 | `chat-room-avatar.service.ts` — `assertOrgUnitWriteTx` `return` sớm | A3 · A4 · A5 · A6 · A7 | 5 đỏ / 11 xanh |
| M3 | `chat-room-avatar.service.ts` — `PROJECT_AVATAR_ROLES` += `"Member"` | B3 | 1 đỏ / 15 xanh |
| M4 | `chat-presence-reader.service.ts` — `presenceKey` bỏ `co:{companyId}` | ca A/B công ty + ca chính tả khoá | 2 đỏ / 16 xanh |

**M1 là kết quả đáng nhớ nhất.** Sai một dấu gạch trong tên `resource_type` ⇒ `PermissionService.can`
fail-closed ⇒ **avatar phòng ban 403 vĩnh viễn cho mọi người**, không exception, không log, build xanh.
Trước WO này không có ca nào ở phía ALLOW nên toàn bộ suite vẫn xanh 100%.

---

## 4. Coverage cụm S8

```bash
LANE_DB=mediaos_s8qa1 npx vitest run \
  src/chat src/realtime test/integration/chat-s8-*.int-spec.ts \
  --coverage --coverage.include='<12 file của cụm S8>' --no-file-parallelism
```

Bảng số nằm ở [`docs/plans/S8-CHAT-UX-QA-1.md` §5](../../plans/S8-CHAT-UX-QA-1.md). Tóm tắt: **12/12 file
đạt ≥80% trên trục dòng/hàm**; ba file được kéo lên trong WO này:

| File | Trước | Sau | Suite bù |
| --- | --- | --- | --- |
| `chat-room-avatar-file.resolver.ts` | 49.29% dòng · **11.11% hàm** | 100% · 100% | `chat-room-avatar-file.resolver.spec.ts` (9 ca) |
| `chat-room-avatar-presign.service.ts` | 76% dòng · 58.33% nhánh | 100% · 95% | `chat-room-avatar-presign.service.spec.ts` (8 ca) |
| `chat-presence-reader.service.ts` | 87.5% dòng | 100% | +1 ca ở `chat-presence.service.spec.ts` |

⚠️ **Điều kiện để con số có nghĩa** (cả hai, thiếu một là vô nghĩa):

1. `LANE_DB` phải có — không thì mọi `int-spec` `skipIf(!hasLaneDb)` bị SKIP mà vẫn ra một con số trông
   bình thường;
2. chạy **cả hai glob** trong một lượt (unit colocated + int-spec) — memory `coverage-audit-scan-both-globs`.

> Ghi chú vận hành: lượt chạy gộp 41 file trên máy Windows này **crash** ở tinypool
> (`ERR_IPC_CHANNEL_CLOSED` / `coverage-0.json ENOENT`) — đúng KI-014, không phải bài đỏ. Số ở trên lấy
> từ lượt chia nhỏ (14 file + 1 lượt riêng cho `chat-members.service.ts`), mỗi lượt exit 0.

---

## 5. Ratchet — có bị nới không

| File | Diff `b5bc7a0c..HEAD` | Phán quyết |
| --- | --- | --- |
| `chat-realtime-structure.spec.ts` | allowlist module lá `+chat-presence-reader` | **nới CÓ đền bù**: cùng commit thêm ca đo lại *tính chất lá* của từng tên (không import ngược `chat/**`, không import `realtime.module`). Ghim định nghĩa, không ghim tên |
| `s7-chat-db1-invariants.int-spec.ts` | +589 / −2 | **siết**: 2 dòng xoá = 1 biến fixture đổi tên + danh sách cột ghi được của `chat_room_members` 5 → 7 (`toEqual` khớp chính xác) |

Cả hai chạy lại trên lane: `db1-invariants` **56/56** · `chat-realtime-structure` **5/5**.

---

## 6. Tổng kết lượt chạy

| Bộ | File | Ca | Kết quả |
| --- | --- | --- | --- |
| int-spec S8 (5 file cũ + 1 mới) | 6 | 82 | ✅ |
| unit `src/chat` + `src/realtime` (29→**31** file sau WO này) | 31 | 515 | ✅ |
| ratchet (`db1-invariants`·`realtime-structure`·`permissions`·`error-census`) | 4 | 214 | ✅ |
| FE `apps/app` cụm chat | 22 | 374 | ✅ |
