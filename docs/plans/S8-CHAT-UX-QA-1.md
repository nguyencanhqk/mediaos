# S8-CHAT-UX-QA-1 — nghiệm thu wave S8-CHAT-UX

> Zone **vàng** · gate **FULL** (`code-review` + `security-review`).
> Bằng chứng đo chi tiết (ma trận deny-path · RED-trước-GREEN · coverage · cross-tenant):
> [`docs/QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md`](../QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md).

---

## 0. Đo hiện trạng TRƯỚC khi viết một dòng test nào

Lane `mediaos_s8qa1` (dựng mới, chain `0000 → 0545`), HEAD `3dea862d`. Chín WO của wave đã lên master;
WO này là WO cuối.

| File int-spec (đã có) | Ca | Kết quả |
| --- | --- | --- |
| `chat-s8-be1-room-prefs.int-spec.ts` | 16 | ✅ |
| `chat-s8-be2-room-avatar.int-spec.ts` | 15 | ✅ |
| `chat-s8-be3-reactions.int-spec.ts` | 16 | ✅ |
| `chat-s8-rt1-typing.int-spec.ts` | 13 | ✅ |
| `chat-s8-fe3-roster.int-spec.ts` | 6 | ✅ |
| **Tổng** | **66** | **66 passed / 0 failed** |

FE: `apps/app` cụm chat **22 file · 374 ca** xanh. Ratchet: `s7-chat-db1-invariants` (56) ·
`chat-realtime-structure` (5) · `chat.permissions` (124) · `chat-error-code-census` (29) — xanh.

**Kết luận của phép đo:** wave KHÔNG thiếu test theo số lượng. Cái thiếu là **hình dạng** — dưới đây.

---

## 1. Sáu lỗ tìm được (và vì sao 66 ca xanh không thấy chúng)

### 1.1 🔴 `department` + `project` — hai nhánh tư cách avatar CHƯA TỪNG chạy

```text
grep -l "ChatRoomAvatarService"           apps/api/**/*.spec.ts            → 0 file
grep -n  "department\|project\|room_type" chat-s8-be2-room-avatar.int-spec → 0 dòng
```

`assertAvatarAuthorityTx` có **bốn** nhánh theo `room_type`. BE-2 phủ hai (`group`, `direct`). Hai nhánh
còn lại — **đúng hai loại phòng mà `CHAT-DEC-016` được viết RA VÌ CHÚNG** (phòng dẫn xuất có 0 admin nên
luật "admin phòng đặt avatar" làm tính năng chết ở đó) — không có ca nào, **cả deny lẫn allow**.

Không có ca ALLOW thì mọi ca DENY của nhánh đó là **xanh rỗng**: một nhánh 403-vô-điều-kiện (ví dụ sai
chính tả `'org-unit'` vs `'org_unit'` — chính bẫy mà docstring `ORG_UNIT_WRITE_PAIR` cảnh báo) vẫn cho
deny-test xanh trong khi tính năng chết trên PROD, im lặng, không log.

⇒ **`apps/api/test/integration/chat-s8-qa1-avatar-authority.int-spec.ts` (16 ca)**, mỗi nhánh có cặp
allow + deny, ca allow đứng TRƯỚC.

### 1.2 🔴 Cổng đường TẢI avatar chưa từng được thực thi

Coverage đo trên cụm S8: `chat-room-avatar-file.resolver.ts` = **49.29% dòng · 11.11% hàm** — 8/9 hàm
chưa chạy lần nào. Đây là object mà `FilePolicyService` hỏi "ai được xem/tải/gắn/gỡ/xoá file
`(CHAT, chat_room_avatar)`". Int-spec BE-2 chỉ đi đường ĐẶT ảnh và đọc `avatarUrl` (ký qua presign
service) — không đường nào chạm resolver.

Đúng lớp lỗ của memory `read-path-gate-pair-must-match-download-pair`: gate màn-hình và gate đường-tải
không có test nào so hai vế với nhau. ⇒ `chat-room-avatar-file.resolver.spec.ts` (9 ca).

### 1.3 🟡 Nhánh degrade của presign chưa từng chạy

`chat-room-avatar-presign.service.ts` = 76% dòng · **58.33% nhánh**; toàn bộ nhánh "storage ký lỗi" chưa
chạy. Nếu nhánh đó nuốt im lặng, một bug thật (vd `assertKeyInTenant` ném vì lệch tenant) lẩn sau đúng
chỗ ấy: danh sách phòng vẫn 200, chỉ là không ảnh, mãi mãi. ⇒ `chat-room-avatar-presign.service.spec.ts`
(8 ca), gồm ca đòi **log có số lỗi + companyId + reason mẫu**.

### 1.4 🟡 Cross-tenant presence: chỉ chứng minh bằng CHÍNH TẢ KHOÁ

`chat-presence.service.spec.ts` chứng minh `{envScope}` tách hai môi trường, và khoá có chứa
`companyId`. Nhưng `getOnlineUserIds` nhận `companyId` như một **tham số**: một bản vá "tối ưu" đọc theo
`userId` (bỏ tenant khỏi khoá, hoặc SCAN theo hậu tố) vẫn giữ nguyên chính tả khoá ở ca cũ mà rò
chấm-online chéo công ty. ⇒ thêm ca A/B **hai công ty, cùng một kho Valkey**.

### 1.5 🟡 `catch` của `getOnlineUserIds` chưa chạy

`chat-presence-reader.service.ts:75-81` — đường mà cả roster đi qua. Nuốt im lặng ⇒ presence chết dần
không ai biết; ném lên ⇒ cả danh sách thành viên 500 vì một tính năng mỹ thuật. Cả hai đều sai ⇒ phải có
ca ghim ở giữa (một khoá lỗi, người còn lại vẫn đúng, **có** log).

### 1.6 🟡 `paths` của chính WO này bỏ sót nơi lỗ nằm

Seed gốc khai `apps/api/src/chat/**/*.spec.ts` + `apps/app/**` + `docs/QA/**`. Nhưng deny-path của wave
sống ở `apps/api/test/integration/**`, còn ratchet phải soi riêng nằm ở `apps/api/src/realtime/**` — cả
hai ngoài glob. Thiếu ⇒ `guard-scope` cảnh báo oan và gate đọc sai vùng chạm (memory
`wo-paths-drive-gate-and-scheduler`). Đã đính chính trong `harness/backlog.mjs` kèm lý do.

---

## 2. RED-trước-GREEN — 4 đột biến có kiểm soát

Không đột biến nào được commit; cây sạch sau mỗi lượt (`git status --porcelain apps/api/src` rỗng).

| # | Đột biến | Ca phải ĐỎ | Thực tế |
| --- | --- | --- | --- |
| M1 | `ORG_UNIT_WRITE_PAIR.resourceType` `'org_unit'` → `'org-unit'` (cặp không tồn tại ⇒ fail-closed) | A1 · A2 (đối chứng dương) | ✅ 4 đỏ, 12 xanh |
| M2 | `assertOrgUnitWriteTx` `return` sớm (bỏ hẳn kiểm scope) | A3 · A4 · A5 | ✅ 5 đỏ, 11 xanh |
| M3 | `PROJECT_AVATAR_ROLES` += `"Member"` | B3 | ✅ 1 đỏ, 15 xanh |
| M4 | `presenceKey` bỏ `co:{companyId}` | ca cross-tenant presence | ✅ 2 đỏ, 16 xanh |

**M1 là phát hiện có giá trị nhất của WO:** trước file test này, sai chính tả một cặp quyền làm avatar
phòng ban **403 vĩnh viễn** mà toàn bộ suite vẫn xanh — không có ca nào ở phía ALLOW để đỏ.

---

## 3. Nợ migration PROD — tiền đề của WO đã CŨ

`done_when` #5 viết *"ghi nợ migration `0543` cho PROD (0542 CŨNG chưa áp PROD)"*. Đo lại 07/08 trên
`mediaos` (DB PROD):

```text
drizzle.__drizzle_migrations = 213 hàng   ·   repo journal = 213 entry
chat_message_reactions: có · chat_room_members.pinned_at + marked_unread_at: có
chat_rooms.avatar_file_id: có · chat_messages.file_url/file_name: đã DROP
```

⇒ **`0542` · `0543` · `0544` · `0545` đều ĐÃ áp PROD; không còn nợ để ghi.** Việc đúng là **xoá dòng nợ
đã lỗi thời** ở `docs/TESTABLE-FEATURES.md` thay vì thêm một dòng nợ không tồn tại — ghi khống một nợ
đã trả cũng làm hỏng bảng nợ y như bỏ sót một nợ thật.

⚠️ Điều này **không** kéo theo "CHAT đã sống trên PROD": module vẫn `is_active = false`, và
`is_active` KHÔNG phải cổng (memory `module-is-active-is-not-a-gate`) — route vẫn gọi được.

---

## 4. Ratchet có bị nới không (`done_when` #3)

Soi riêng diff của hai file, từ `b5bc7a0c` (mốc S7 lên master) tới HEAD:

| File | Diff | Phán quyết |
| --- | --- | --- |
| `chat-realtime-structure.spec.ts` | allowlist module lá `["realtime-emitter"]` → `+ "chat-presence-reader"` | **NỚI CÓ ĐỀN BÙ** — cùng commit thêm ca thứ ba đo lại *tính chất lá* của từng tên trong allowlist (không import ngược `chat/**` hay `realtime.module`). Ghim ĐỊNH NGHĨA chứ không ghim tên, đúng memory `index-ratchet-must-pin-definition-not-name` ⇒ chấp nhận |
| `s7-chat-db1-invariants.int-spec.ts` | +589 / **−2** | **SIẾT** — 2 dòng xoá là (a) một biến fixture đổi tên, (b) danh sách cột ghi được của `chat_room_members` **5 → 7** (thêm `marked_unread_at`, `pinned_at`), vẫn `toEqual` khớp-chính-xác. Không assert nào bị hạ |

---

## 5. Coverage cụm S8 (`done_when` #4)

Đo dưới `LANE_DB=mediaos_s8qa1`, chạy **cả hai glob** (unit colocated + int-spec) — thiếu một glob là
dìm hoặc thổi con số (memory `coverage-audit-scan-both-globs`). Sau khi bù 3 suite mới:

| File | Stmts | Branch | Funcs | Trước WO này |
| --- | --- | --- | --- | --- |
| `chat-room-prefs.service.ts` | 100 | 100 | 100 | — |
| `chat-reactions.service.ts` | 100 | 100 | 100 | — |
| `chat-reactions.repository.ts` | 100 | 80 | 100 | — |
| `chat-room-avatar.service.ts` | 93.14 | 85 | 100 | — |
| `chat-room-avatar.repository.ts` | 100 | 66.66¹ | 100 | — |
| `chat-room-avatar.controller.ts` | 100 | 100 | 100 | — |
| `chat-room-avatar-presign.service.ts` | **100** | **95** | 100 | 76 / 58.33 |
| `chat-room-avatar-file.resolver.ts` | **100** | **94.73** | **100** | 49.29 / 11.11 hàm |
| `chat-typing.service.ts` | 91.22 | 94.44 | 100 | — |
| `chat-members.service.ts` | 95.9 | 90.38 | 100 | — |
| `chat-presence.service.ts` | 96.55 | 80 | 100 | — |
| `chat-presence-reader.service.ts` | **100** | 93.75 | 100 | 87.5 |

¹ Nhánh chưa phủ duy nhất là `row ? … : undefined` của `findRoomForAvatarTx` — không dựng được qua
đường thật: `assertMember` chạy TRƯỚC trong cùng tx cùng khoá tenant, nên `undefined` ở đây là vế
fail-closed phòng thân (service ném `CHAT-ERR-023` nếu gặp). Ghi ra thay vì bịa một ca giả để đẩy số.

---

## 6. Còn lại — CHƯA phủ, ghi để không ai đọc nhầm là đã kín

1. **`@Department` trỏ ĐƠN VỊ KHÁC** chỉ dựng được qua trạng thái "đã chuyển phòng ban, đồng bộ chưa
   chạy" (ca A5). Qua đường bình thường, thành viên phòng phòng-ban **luôn** là nhân viên của chính đơn
   vị đó ⇒ vế "trùng đơn vị" luôn đúng. Nếu sau này có đường thêm người ngoài đơn vị vào phòng dẫn xuất,
   ca A5 là ca duy nhất đang canh.
2. **Không có ca E2E trình duyệt** cho cụm S8 (đặt avatar → thấy ảnh → tải ảnh). Đường tải nay có ca ở
   tầng resolver, nhưng chuỗi đầu-cuối qua `FilesController` chưa có int-spec riêng.
3. **`is_active = false`**: toàn bộ nghiệm thu này nói về đường API + FE component, KHÔNG nói gì về việc
   người dùng cuối đã dùng được hay chưa.
