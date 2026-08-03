# S7-CHAT-DB-3 — Expand-contract least-privilege cho bề mặt CHAT (mig 0540)

> Zone 🔴 · gate FULL (database-reviewer + security-reviewer) · nối tiếp head `0539_s7chatdb2_room_seq`.
> Nguồn: `S7-CHAT-BE-GATE-3` lane L3 (M-1 · M-3 · M-4 · M-6).

---

## 0. Số đo hiện trạng — đo TRƯỚC khi sửa, trên lane `mediaos_s7db3` (chain 0000→0539 sạch)

Mọi dòng dưới đây là kết quả **chạy thật**, không phải đọc migration. Lý do bắt buộc đo: bản rà tĩnh của
lane L3 đọc `0002:70` rồi kết luận "app role có DELETE trên `users`" — trong khi `0467` đã REVOKE. Đọc
migration cũ ≠ hiện trạng (memory `grant-in-old-migration-is-not-current-state`).

| # | Đo cái gì | Lệnh | Kết quả |
| --- | --- | --- | --- |
| 1 | UPDATE **cấp bảng** `chat_rooms` | `has_table_privilege('mediaos_app','chat_rooms','UPDATE')` | **`t`** ⇒ app role sửa được **cả 22 cột**, gồm `company_id`, `id`, `room_type`, `direct_key`, `room_code`, `created_by` |
| 2 | UPDATE cột `visible_from_seq` | `has_column_privilege(...)` | **`t`** — và **0 writer** trong `apps/api/src/**` (chỉ có đường ĐỌC + comment `chat-derived-rooms-sync.service.ts:263` dặn "tuyệt đối không set") ⇒ **quyền chết** |
| 3 | DELETE trên `users` | `has_table_privilege('mediaos_app','users','DELETE')` | **`f`** ✅ — `0467` đã thu hồi. **Tiền đề "còn DELETE trên users" của L3 là SAI**, đã đính chính ở `564546d8` |
| 4 | FK `users` → chat, `ON DELETE` | `pg_constraint.confdeltype` | **4 constraint CASCADE**: `chat_messages_sender_id_fkey`, `chat_messages_sender_id_company_fk`, `chat_room_members_user_id_fkey`, `chat_room_members_user_id_company_fk` |
| 5 | `sender_id` / `user_id` NOT NULL? | `pg_attribute.attnotnull` | **`t` cả hai** ⇒ `SET NULL` **bất khả thi** ⇒ chỉ còn `RESTRICT` |
| 6 | Ai hard-delete `users`? | grep `apps/api` + `scripts` | **Đúng một** chỗ: `test/helpers/seed.ts:670` (`cleanupTenants`) — và hàm đó **đã** xoá `chat_messages`/`chat_room_members`/`chat_rooms` ở **489-491**, tức TRƯỚC dòng 670, trong CÙNG hàm (mở ở 397) ⇒ **RESTRICT không phá teardown**. 0 migration nào DELETE `users` |
| 7 | Writer thật của `chat_rooms` | grep `update(chatRooms)` | **4 điểm / 11 cột** (bảng §2) |
| 8 | Có `$onUpdate` trên `chatRooms`? | đọc `schema/communication.ts` | **Không** ⇒ drizzle ghi ĐÚNG tập cột trong `.set()`, không tự chèn cột ⇒ tập GRANT ở §2 là đủ |
| 9 | RLS trên 3 bảng chat | `relrowsecurity` / `relforcerowsecurity` | `t` / `t` cả ba |

**Hệ quả cho phạm vi WO:** vế `users` **chuyển hẳn thành việc FK**, không phải việc GRANT. Không thêm ca
`DELETE FROM users phải 42501` vào RED — hôm nay nó đã 42501 sẵn, ca đó chứng minh 0 điều
(memory `superadmin-not-a-canonical-role`: chủ thể/tiền đề sai làm ca test thành tautology).

---

## 1. Ba lỗ đang mở, và vì sao mỗi lỗ là lỗ

**L1 — `chat_rooms` UPDATE cấp bảng.** Bất biến #1 nói `company_id` phải bất khả xâm phạm. RLS policy
chặn *đọc/ghi sai ngữ cảnh*, nhưng `UPDATE chat_rooms SET company_id = <B>` trong ngữ cảnh A là hàng A ghi
giá trị B — chỉ `WITH CHECK` của policy mới chặn, và nó **không phải** lớp phòng thủ mà bất biến #2 mô tả.
Đúng hơn: quyền đó chưa bao giờ được ai cần. 4 writer thật chỉ chạm 11/22 cột.

**L2 — `visible_from_seq` GRANT chết.** CHAT-DEC-008 (v1: thành viên mới đọc TOÀN BỘ lịch sử) hôm nay
được gác bằng **một comment + một unit test**. Ai đó viết `.set({ visibleFromSeq })` thì DB nói "được".
Đây là quyền cấp cho một tương lai chưa tới — least-privilege nói: cấp lúc cần, không cấp trước.

**L3 — FK CASCADE `users` → `chat_messages`.** `chat_messages` là **append-only theo bất biến #2**: app role
không có UPDATE/DELETE cấp bảng. Nhưng `ON DELETE CASCADE` chạy ở **tầng owner**, bỏ qua mọi GRANT. Một
`DELETE FROM users` (script dọn, migration tương lai, teardown test) **xoá cứng** tin nhắn — im lặng, và để
lại lỗ `room_seq` **vĩnh viễn**: `last_message_seq` không giảm ⇒ mẫu số phép trừ đếm chưa đọc phồng lên,
badge sai mãi mãi (đúng cái `0539` vừa đi sửa).

---

## 2. Tập cột GRANT LẠI cho `chat_rooms` — suy từ writer, không từ suy đoán

| Writer | File:dòng | Cột ghi |
| --- | --- | --- |
| `bumpRoomSeq` | `chat-messages.repository.ts:86` | `last_message_seq`, `last_message_at` |
| `restoreRoom` | `chat-rooms.repository.ts:336` | `deleted_at`, `deleted_by` |
| `updateRoom` | `chat-rooms.repository.ts:349` | `name`, `description`, `updated_at`, `updated_by` |
| `archiveRoom` | `chat-rooms.repository.ts:369` | `is_archived`, `archived_at`, `archived_by`, `updated_at` |

⇒ **11 cột**: `name · description · is_archived · archived_at · archived_by · last_message_at ·
last_message_seq · updated_at · updated_by · deleted_at · deleted_by`.

**CỐ Ý KHÔNG cấp** (có cột, không writer): `company_id` `id` `room_type` `room_code` `direct_key` `ref_id`
`channel_id` `org_unit_id` `created_at` `created_by` `sync_source` `synced_at`.
`sync_source`/`synced_at` chỉ được ghi trong câu **INSERT** (`chat-rooms.repository.ts:131-155`) — job đối
soát derived-room chỉ gọi `restoreRoom`/`archiveRoom`, không đóng dấu lại. Cần sau thì cấp sau, một dòng.

---

## 3. Thứ tự thi hành trong `0540` — REVOKE cấp bảng TRƯỚC, GRANT cột SAU

> ⚠️ **Mục này đã bị lật trong lúc thi công.** Bản đầu viết ngược lại (GRANT cột trước, REVOKE bảng sau)
> với lý lẽ "expand-contract: `relacl` và `attacl` là hai ACL độc lập nên REVOKE cấp bảng không đụng
> column-GRANT". **Sai.** Khối VERIFY ở §4 bắt được ngay lần chạy migration đầu tiên. Đo trực tiếp:
>
> ```sql
> BEGIN;
> GRANT UPDATE (name, description) ON chat_rooms TO mediaos_app;  -- attacl = {name,description}
> REVOKE UPDATE ON chat_rooms FROM mediaos_app;                   -- attacl = {}   ← MẤT SẠCH
> ```
>
> Đúng tài liệu Postgres về `REVOKE`: *"When revoking privileges on a table, the corresponding column
> privileges (if any) are automatically revoked on each column of the table, as well."* Thứ tự "an toàn"
> theo trực giác lại tạo ra **đúng** trạng thái nó định tránh — `chat_rooms` không cột nào ghi được —
> và là vĩnh viễn chứ không phải tạm thời.
>
> **Và cửa sổ 500 vốn không tồn tại:** `migrate()` của drizzle chạy migration trong MỘT transaction
> (chứng minh: lần VERIFY đỏ hoàn nguyên sạch, `chat_rooms` giữ nguyên UPDATE cấp bảng). ACL là
> transactional — phiên khác thấy hoặc trạng thái CŨ hoặc MỚI, không có khoảng giữa. "Expand-contract"
> ở WO này nằm ở **kết quả** (tập cột writer đang dùng không mất cột nào), không ở thứ tự câu lệnh.

```text
(A) REVOKE UPDATE ON chat_rooms               ← phải trước, vì nó cuốn theo mọi column-GRANT cùng bảng
(B) GRANT UPDATE (11 cột) ON chat_rooms       ← cấp lại đúng tập writer đang dùng
(C) REVOKE UPDATE (visible_from_seq) ON chat_room_members
(D) 4 × ALTER FK: CASCADE → RESTRICT
(E) VERIFY fail-loud
```

- (C) an toàn revoke thẳng vì **0 writer** (§0 #2), không có cửa sổ nào để mở.
- (D) đổi **cả 4** (2 một-cột + 2 composite). Để lệch một cái là vô nghĩa: PG kiểm mọi FK, nhưng nếu
  constraint một-cột còn CASCADE thì nó vẫn xoá hàng trước khi composite kịp RESTRICT ở một số thứ tự.
  **KHÔNG drop** constraint một-cột dù nó dư (composite bao hàm nó) — drop là đổi hình dạng FK, ngoài
  phạm vi WO và chạm giả định của `xtenant-fk-ratchet` (ca (a) duyệt FK một-cột, ca "waiver mồ côi" đỏ khi
  cặp biến mất).

---

## 4. Siết khối VERIFY (`0539` chỉ đọc `table_privileges`)

Khối `DO $$` của `0539` bước (3) đếm `information_schema.table_privileges` cho `chat_messages`. Ba lỗ:

1. **Không có vế `table_schema='public'`** — một `chat_messages` ở schema khác cũng lọt vào phép đếm.
2. **Mù hoàn toàn với column-GRANT.** `GRANT UPDATE (body) ON chat_messages` không xuất hiện ở
   `table_privileges` ⇒ bất biến #2 bị phá mà VERIFY vẫn NOTICE "OK".
3. **Không assert RLS.** `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` ở migration sau đi qua im lặng.

`0540` **không sửa `0539`** (đã áp trên mọi lane + CI; sửa file đã áp là đổi hash, hỏng journal drizzle) —
mà đặt khối VERIFY **chặt hơn** trong chính nó, đóng vai bản pin mới:

- Dùng `aclexplode(relacl)` / `aclexplode(attacl)` thay `information_schema` — chính xác từng cấp, và
  không phụ thuộc "role hiện tại là grantor hay grantee" như view của information_schema.
- Assert tập column-GRANT là **BẰNG ĐÚNG** tập cho phép, không phải "≤" hay "count > 0" — pin theo tên cột.
  `chat_messages` = `{recalled_at, recalled_by, pinned_at, pinned_by}` · `chat_rooms` = 11 cột §2 ·
  `chat_room_members` = `{role, last_read_at, last_read_seq, muted_until, left_at}` (**5**, đã bỏ
  `visible_from_seq`).
- Assert `relrowsecurity AND relforcerowsecurity` trên cả 3 bảng.
- Assert 4 FK `confdeltype = 'r'`.
- Neo bằng `nspname='public'` ở mọi truy vấn (memory `audit-check-union-parse-anchor-trap`: thiếu neo ⇒
  PASS oan).

---

## 5. RED trước — ca nào phải ĐỎ trên `0539`, XANH trên `0540`

Thêm mục **H** vào `s7-chat-db1-invariants.int-spec.ts` (file đã có mục `G. sequence_counter`; không tạo
file mới vì file này gate `hasDb`
**KHÔNG** gate `LANE_DB` ⇒ chạy THẬT trên CI — file mới phải tự dựng lại đúng điều kiện đó).

| Ca | Trước 0540 | Sau 0540 |
| --- | --- | --- |
| `UPDATE chat_room_members SET visible_from_seq = 5` | ✅ thành công (`code = null`) → **ĐỎ** | `42501` |
| `UPDATE chat_rooms SET org_unit_id = NULL` | ✅ thành công → **ĐỎ** | `42501` |
| `UPDATE chat_rooms SET company_id = <tenant B>` | ✅/policy → **ĐỎ** | `42501` |
| ĐỐI CHỨNG DƯƠNG `UPDATE chat_rooms SET name`, `last_message_seq`, `is_archived` | ✅ | ✅ **vẫn phải xanh** |
| `DELETE FROM users` (owner) khi còn tin nhắn | ✅ xoá cứng tin → **ĐỎ** | `23503` + tin nhắn **còn nguyên** |
| Tập column-GRANT của 3 bảng khớp pin | lệch → **ĐỎ** | khớp |

Ca FK phải chạy bằng **`direct` (owner)**, không phải `asApp`: app role không có DELETE trên `users`, chạy
bằng nó thì được 42501 và ca trở thành tautology — đúng cái bẫy §0 vừa nói.

---

## 6. Rủi ro & thứ tự đóng

| Rủi ro | Vì sao không nổ | Nếu vẫn nổ |
| --- | --- | --- |
| RESTRICT phá `cleanupTenants` | §0 #6: chat đã dọn ở 489-491, trước `users` ở 670 | 23503 **loud** ở teardown, không im lặng — sửa bằng thêm 1 câu DELETE, không hoàn nguyên FK |
| Đua: worker ghi `chat_messages` giữa 491 và 670 | Cùng lớp với đua `audit_logs` đã có vòng thử lại sẵn trong hàm | Nếu CI nháy 23503 ở `DELETE users` → bọc vòng thử lại **giống hệt idiom `audit_logs`**, không đẻ cơ chế mới |
| Writer `chat_rooms` bị bỏ sót ⇒ 42501 lúc chạy | §0 #7-#8 quét `update(chatRooms)` toàn `src`, và không có `$onUpdate` chèn thêm cột | int-spec CHAT (be1/be3/be4/be7/noti-e2e) chạy đường ghi thật trên lane ⇒ bỏ sót là ĐỎ ngay, không lọt ra prod |
| `0540` chạy trên DB đã có dữ liệu chat lệch | PROD/dev-online **chưa** có `0538`/`0539` (chưa lên master) ⇒ 0 hàng chat | — |

**Đóng khi:** RED chứng minh trước → `0540` áp sạch trên lane → toàn bộ int-spec CHAT xanh trên
`LANE_DB` → FULL gate PASS.
