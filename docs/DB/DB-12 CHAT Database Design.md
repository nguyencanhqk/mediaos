# DB-12: CHAT DATABASE DESIGN — CHAT NỘI BỘ

> **Nguồn nghiệp vụ:** [SPEC-15 CHAT](<../SPEC/SPEC-15 CHAT.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.1/§7.9/§19b
>
> **Liên quan:** [API-13 CHAT API Design](<../API Design/API-13_CHAT_API_Design.md>) · [DB-08 Files/Audit/Seeds](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-07 NOTI](<DB-07 NOTI DASH Database Design.md>) · [DB-09 Index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9c](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-12 |
| Tên tài liệu | CHAT Database Design — Chat nội bộ |
| Module | CHAT (SPEC-15) |
| Phiên bản | v1.0 — **Approved** cùng SPEC-15 (owner chốt 12 quyết định 02/08/2026; CHAT-DEC-004 lật ngược ⇒ bước D′ + §6.3 đã sửa theo) |
| Ngày tạo / cập nhật | 01/08/2026 / **02/08/2026** (S7-CHAT-DOC-2 — hoà CHAT-DEC-004) |
| Head migration lúc viết | idx 202 / `0535` ⇒ dự kiến `0536+`. ⚠️ **ĐÃ TRÔI — head thật 02/08/2026 là idx 204 / `0537_s6leavecarryover1_carry_forward`.** WO DB phải đọc `migrations/meta/_journal.json` THẬT lấy head, TUYỆT ĐỐI không hard-code số trong tài liệu này |
| Giai đoạn | Phase 4 · wave S7-CHAT — ngoài RC v1.0.0 |

> ⚠️ Số migration dưới đây là **dự kiến**. Wave chạy sau go-live nên head thật gần như chắc chắn đã trôi. Luôn đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** (bẫy `wo-paths-drive-gate-and-scheduler` — khai thiếu `migrations/**` trong `paths` của WO làm lọt LIGHT gate và trùng số migration).

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module CHAT. Điểm khác mọi DB-xx trước: **CHAT không tạo bảng mới từ số không** — ba bảng lõi đã tồn tại thật trong DB từ migration `0010` (tạo) và `0050` (mở rộng), đã có RLS + FORCE, GRANT append-only và composite tenant FK (`0535`). Tài liệu này mô tả **đối chiếu hiện trạng + phần ALTER bổ sung**.

Quy tắc nghiệp vụ (mã lỗi, luồng đồng bộ, công thức đếm chưa đọc) sống ở SPEC-15 — file này chỉ nói về dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng ĐÃ CÓ trong DB — wave này chỉ ALTER

| Bảng | Tạo tại | Hiện trạng đáng chú ý |
| --- | --- | --- |
| `chat_rooms` | `0010` + `0050` | RLS+FORCE; GRANT cấp bảng `SELECT,INSERT` + UPDATE **cấp cột** (11 cột, `0540`), DELETE đã REVOKE; cột `ref_id`(project) · `org_unit_id` · `direct_key` · `created_by`; 3 unique index partial (`channel_id` + `chat_rooms_channel_uq` **đã DROP** ở `0542`) |
| `chat_room_members` | `0010` + `0050` | RLS+FORCE; GRANT `SELECT,INSERT,DELETE` + **column-level** `UPDATE (role, last_read_at)` |
| `chat_messages` | `0010` + `0050` | RLS+FORCE; GRANT **chỉ `SELECT,INSERT`** (append-only) + **column-level** `UPDATE (pinned_at, pinned_by)`; `seq bigint GENERATED ALWAYS AS IDENTITY` |

### 3.2 Bảng MỚI

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| _(v1: không có)_ | | Toàn bộ nhu cầu v1 phủ được bằng 3 bảng trên + `file_links` của FOUNDATION |
| `chat_message_reactions` _(S8, mig `0543`)_ | Thả cảm xúc vào tin | CHAT-DEC-018. Bảng **riêng**, không nhét vào `chat_messages` — xem §6.7 |

> "Đã xem bởi ai" là **dẫn xuất** từ `last_read_seq` (SPEC-15 §13.2) — không cần bảng `chat_message_reads`. Đính kèm dùng `file_links` — không cần `chat_message_attachments`. Đây là lựa chọn chống phình bảng có chủ đích.
>
> ⚠️ **Vì sao reaction PHẢI là bảng riêng:** `chat_messages` là append-only (app role không có `DELETE`), mà **bỏ thả cảm xúc là xoá thật một hàng**. Nhét reaction vào cột jsonb của `chat_messages` buộc phải `UPDATE` cột đó mỗi lần ai đó thả/bỏ — vừa cần cấp thêm column-GRANT trên bảng ledger, vừa tạo đường đua ghi-đè (hai người thả cùng lúc, người sau ghi đè người trước). Bảng riêng thì mỗi reaction là một hàng độc lập, `DELETE` một hàng không đụng gì tới ledger.

### 3.3 Bảng dùng lại (không tạo mới)

`companies` · `users` · `employees` · `org_units` · `projects` / `project_members` (TASK) · `files` / `file_links` (FOUNDATION) · `audit_logs` · `sequence_counters` · `modules` + `permissions`/`role_permissions` (AUTH) · `notification_events` / `notification_templates` / `notifications` (NOTI) · `system_jobs` (job đối soát).

---

## 4. Nguyên tắc thiết kế

1. **Giữ nguyên RLS + FORCE** đã có từ `0010` — wave này **không** đụng policy cô lập tenant. Mọi repository đi qua `withTenant` (bất biến #1).
2. **Giữ nguyên append-only `chat_messages`** (bất biến #2): không cấp `DELETE`, không cấp `UPDATE` cấp bảng. Cột thu hồi mới chỉ được mở bằng **column-level GRANT**, đúng cơ chế `pinned_at` đã dùng ở `0050`.
3. **Mở rộng bằng ALTER, không tạo bảng song song.** `0050` đã ghi thẳng bài học này ở đầu file ("KHÔNG tạo bảng chat_members/messages MỚI — 0010 đã tạo bảng cùng chức năng").
4. **Expand-contract cho phần khai tử — ĐÃ HOÀN TẤT.** Cột `channel_id` / `file_url` / `file_name` ngừng dùng ở release N (`0538`), **DROP ở release N+1 (`0542`, `S7-CHAT-CLEAN-1`)** sau khi xác minh 0 hàng và không còn code đọc (memory `migration-expand-contract-required`). Xem §6.6.
5. **`seq` là khoá thứ tự duy nhất** — mọi index đọc/phân trang neo vào `seq`, không vào `created_at`.
6. Soft delete cho `chat_rooms`; `chat_messages` **không bao giờ** xoá (thu hồi ≠ xoá).
7. UUID PK `gen_random_uuid()`, timestamp UTC — theo DB-01.

---

## 5. ERD cấp module

```text
companies 1─n chat_rooms
org_units 1─1 chat_rooms (room_type='department', partial unique)
projects  1─1 chat_rooms (room_type='project',    partial unique qua ref_id)
users     2─1 chat_rooms (room_type='direct',     partial unique qua direct_key)

chat_rooms       1─n chat_room_members ─n─1 users
chat_rooms       1─n chat_messages     ─n─1 users (sender)
chat_messages    1─n chat_messages     (reply_to_message_id, đúng 1 tầng)
chat_messages    1─n file_links        (moduleCode='CHAT', entityType='chat_message')
```

---

## 6. Chi tiết bảng

### 6.1 `chat_rooms` — hiện trạng + ALTER

**Cột đã có:** `id` · `company_id` · `ref_id`(→`projects`) · `org_unit_id`(→`org_units`) · `direct_key` · `room_type` · `name` · `created_by` · `created_at`. _(`channel_id` **đã DROP** ở `0542`.)_

**Cột THÊM:**

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `room_code` | VARCHAR(100) | Có (sau backfill) | qua `sequence_counters`, unique theo company |
| `description` | TEXT | Không | phòng nhóm |
| `sync_source` | VARCHAR(20) | Có | `manual` / `department` / `project`, default `manual` |
| `synced_at` | TIMESTAMPTZ | Không | lần đối soát thành công gần nhất |
| `last_message_at` | TIMESTAMPTZ | Không | sắp xếp danh sách phòng |
| `last_message_seq` | BIGINT | Không | **mẫu số của phép trừ đếm chưa đọc** (SPEC-15 §13.2) — không có cột này thì danh sách phòng thành N+1 `COUNT(*)`. ⚠️ Từ mig `0539` cột này mang giá trị **`room_seq`** (per-room), KHÔNG phải `seq` toàn cục; nó cũng chính là **bộ cấp số**: `UPDATE … SET last_message_seq = COALESCE(last_message_seq,0)+1 RETURNING` khoá hàng phòng ⇒ tuần tự hoá theo phòng |
| `is_archived` | BOOLEAN | Có | default false |
| `archived_at` / `archived_by` | TIMESTAMPTZ / UUID | Không | |
| `updated_at` / `updated_by` | TIMESTAMPTZ / UUID | Không | |
| `deleted_at` / `deleted_by` | TIMESTAMPTZ / UUID | Không | soft delete |

**Đổi ràng buộc:**

```sql
-- (a) room_type: bỏ 'channel' (media out-of-scope). DROP+ADD an toàn vì đây là CHECK
--     RIÊNG của chat_rooms (chat_rooms_room_type_chk, 0050:35) — KHÔNG phải hot-file
--     dùng chung cross-lane như audit_logs.object_type ⇒ không cần UNION.
--     BẮT BUỘC kiểm 0 hàng room_type='channel' TRƯỚC, nếu có thì migrate sang 'group'.
ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_room_type_chk;
ALTER TABLE chat_rooms ADD  CONSTRAINT chat_rooms_room_type_chk
  CHECK (room_type IN ('direct','group','department','project'));

-- (b) loại phòng ↔ neo (CHAT-ERR-002) — đúng 1 neo, các neo khác NULL
ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_type_anchor CHECK (
  (room_type = 'direct'     AND direct_key IS NOT NULL AND org_unit_id IS NULL     AND ref_id IS NULL) OR
  (room_type = 'group'      AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NULL) OR
  (room_type = 'department' AND direct_key IS NULL     AND org_unit_id IS NOT NULL AND ref_id IS NULL) OR
  (room_type = 'project'    AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NOT NULL)
);

-- (c) sync_source ↔ room_type
ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_sync_source CHECK (
  (room_type = 'department' AND sync_source = 'department') OR
  (room_type = 'project'    AND sync_source = 'project')    OR
  (room_type IN ('direct','group') AND sync_source = 'manual')
);

-- (d) name: 'direct' KHÔNG lưu tên (dẫn xuất từ người đối thoại) ⇒ nới NOT NULL,
--     nhưng ép NOT NULL cho 3 loại còn lại.
ALTER TABLE chat_rooms ALTER COLUMN name DROP NOT NULL;
ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_name
  CHECK (room_type = 'direct' OR name IS NOT NULL);
```

**Index thêm:**

```sql
CREATE UNIQUE INDEX uq_chat_rooms_company_code ON chat_rooms (company_id, room_code)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_chat_rooms_company_activity   ON chat_rooms (company_id, last_message_at DESC)
  WHERE deleted_at IS NULL AND is_archived = false;
CREATE INDEX idx_chat_rooms_sync               ON chat_rooms (company_id, sync_source)
  WHERE deleted_at IS NULL AND sync_source <> 'manual';   -- job đối soát đêm
```

**Index đã có, giữ nguyên:** `chat_rooms_company_id_idx` · `chat_rooms_ref_id_idx` · `chat_rooms_project_uq` · `chat_rooms_org_unit_uq` · `chat_rooms_direct_uq`. _(`chat_rooms_channel_uq` **đã DROP** cùng cột `channel_id` ở `0542`.)_

### 6.2 `chat_room_members` — hiện trạng + ALTER

**Cột đã có:** `id` · `company_id` · `room_id` · `user_id` · `role`(`member`/`admin`) · `last_read_at` · `joined_at`.

**Cột THÊM:**

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `last_read_seq` | BIGINT | Có | default 0; **nguồn sự thật của "đã đọc"**, chỉ tiến (SPEC-15 §13.2) |
| `muted_until` | TIMESTAMPTZ | Không | tắt thông báo phòng |
| `left_at` | TIMESTAMPTZ | Không | rời phòng — **giữ hàng lại**, không DELETE |
| `visible_from_seq` | BIGINT | Không | v1 luôn NULL = đọc toàn bộ lịch sử (SPEC-15 §13.4) |
| `added_by` | UUID | Không | ai thêm vào phòng nhóm |

```sql
ALTER TABLE chat_room_members ADD CONSTRAINT chk_chat_members_read_seq CHECK (last_read_seq >= 0);

-- Unique CŨ (room_id, user_id) GIỮ NGUYÊN: 1 hàng/người/phòng kể cả sau khi rời
-- (rời = set left_at, vào lại = clear left_at). KHÔNG đổi thành partial unique —
-- nhiều hàng lịch sử sẽ làm mọi truy vấn membership phải chọn "hàng nào mới nhất".

CREATE INDEX idx_chat_members_user_active ON chat_room_members (company_id, user_id)
  WHERE left_at IS NULL;
```

**GRANT bổ sung — column-level:**

```sql
-- 0050 đã cấp UPDATE (role, last_read_at). Bổ sung 4 cột ghi được:
GRANT UPDATE (last_read_seq, muted_until, left_at, visible_from_seq)
  ON chat_room_members TO mediaos_app;
```

> ⚠️ `left_at IS NULL` là **điều kiện bắt buộc trong MỌI truy vấn membership** (đọc tin · tìm kiếm · tệp · WS join · đích emit). Thiếu nó ở bất kỳ đường nào = người đã rời phòng vẫn đọc được tin mới. Vì vậy điều kiện này phải nằm trong **một hàm dùng chung** (`ChatAccessService`), không rải ở từng truy vấn (SPEC-15 §3.2).

### 6.3 `chat_messages` — hiện trạng + ALTER

**Cột đã có:** `id` · `company_id` · `room_id` · `sender_id` · `body` · `message_type`(`text`/`file`) · `mentions` jsonb · `pinned_at` · `pinned_by` · `seq` · `created_at`. _(`file_url`/`file_name` **đã DROP** ở `0542`.)_

**Cột THÊM:**

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `client_message_id` | UUID | Không | chống trùng khi gửi lại (CHAT-ERR-014) |
| `reply_to_message_id` | UUID | Không | FK `chat_messages.id`, cùng phòng (ép ở service) |
| `recalled_at` / `recalled_by` | TIMESTAMPTZ / UUID | Không | thu hồi — **không** xoá |
| `attachment_count` | SMALLINT | Có | default 0, **đặt ngay trong câu INSERT** (`fileIds.length`) — app role không có quyền UPDATE cột này, xem §6.3 |
| `search_vector` | TSVECTOR | — | **GENERATED ALWAYS … STORED**, DB tự tính |

```sql
ALTER TABLE chat_messages DROP CONSTRAINT <tên CHECK message_type của 0050>;
ALTER TABLE chat_messages ADD  CONSTRAINT chk_chat_messages_type
  CHECK (message_type IN ('text','file','system'));

ALTER TABLE chat_messages ADD CONSTRAINT chk_chat_messages_attachment_count
  CHECK (attachment_count >= 0);

-- Chống double-submit: 1 clientMessageId / (phòng, người gửi).
CREATE UNIQUE INDEX uq_chat_messages_client_id
  ON chat_messages (company_id, room_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Đọc/phân trang theo con trỏ seq (SPEC-15 §13.1). Thay thế vai trò của
-- chat_messages_room_seq_idx (0050) — index cũ thiếu company_id nên vẫn phải
-- lọc heap theo tenant.
CREATE INDEX idx_chat_messages_room_seq
  ON chat_messages (company_id, room_id, seq DESC);

CREATE INDEX idx_chat_messages_reply
  ON chat_messages (company_id, reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
```

**GRANT bổ sung — column-level, giữ append-only:**

```sql
-- 0050 đã cấp UPDATE (pinned_at, pinned_by). Bổ sung ĐÚNG 2 cột thu hồi:
GRANT UPDATE (recalled_at, recalled_by) ON chat_messages TO mediaos_app;
-- KHÔNG cấp UPDATE cấp bảng. KHÔNG cấp DELETE. body/sender_id/seq vẫn bất biến.
-- attachment_count: ĐẶT NGAY TRONG CÂU INSERT (fileIds.length đã biết từ §13.5 bước 2).
-- CẤM UPDATE sau khi insert — app role KHÔNG có quyền cột đó.
--   ⚠️ Đính chính bản 01/08: câu "cập nhật trong CÙNG transaction ⇒ không cần GRANT UPDATE" là SAI.
--   Quyền Postgres không đến từ việc nằm cùng transaction. chat_messages chỉ có SELECT,INSERT +
--   column-GRANT 4 cột (pinned_at, pinned_by, recalled_at, recalled_by) ⇒ mọi
--   UPDATE ... SET attachment_count bị TỪ CHỐI ⇒ MỌI TIN CÓ TỆP TRẢ 500.
--   (Nếu về sau cần cập nhật rời thì phải thêm GRANT UPDATE (attachment_count) tường minh.)
```

> ⚠️ **Kiểm bất biến ở tầng DB, không chỉ tầng service.** Test phải thử `UPDATE chat_messages SET body=…` và `DELETE FROM chat_messages` **bằng app role** và mong đợi lỗi quyền. Reviewer đọc code service sẽ không thấy được lỗ này (memory `reviewers-pass-real-bugs`).

### 6.4 Tìm kiếm toàn văn tiếng Việt

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() gốc chỉ STABLE ⇒ KHÔNG dùng được trong cột generated / index expression.
-- Wrapper IMMUTABLE là bắt buộc; chỉ định schema tường minh để không phụ thuộc search_path.
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE chat_messages
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', f_unaccent(coalesce(body, '')))) STORED;

CREATE INDEX idx_chat_messages_search ON chat_messages USING GIN (search_vector);
```

Ghi chú bắt buộc:

- `'simple'` — Postgres **không có** bộ từ điển tiếng Việt; dùng `'english'` sẽ cắt gốc từ sai và làm hỏng kết quả.
- `f_unaccent` cho phép gõ không dấu ra kết quả có dấu ("bao cao" → "báo cáo").
- Cột **GENERATED STORED** ⇒ DB tự tính lúc INSERT, **không** cần cấp thêm quyền UPDATE lên bảng append-only. Đây là lý do chọn generated thay vì trigger.
- Thêm cột generated trên bảng đã có dữ liệu = **rewrite toàn bảng** (khoá ACCESS EXCLUSIVE). Ở quy mô hiện tại (bảng gần như rỗng) là tức thì; nếu chạy khi đã có hàng triệu tin thì phải tách cửa sổ bảo trì.
- Truy vấn: `WHERE search_vector @@ websearch_to_tsquery('simple', f_unaccent($q))` — **luôn** kèm `JOIN chat_room_members … AND left_at IS NULL` (SPEC-15 §13.7).

### 6.5 Đính kèm — dùng `file_links`, không bảng mới

```text
files       (FOUNDATION — tệp đã tải lên, đã quét virus)
file_links  (module_code='CHAT', entity_type='chat_message', entity_id=<messageId>,
             link_type='Attachment')
```

- `file_links.entity_type` là `varchar(100)` **không có CHECK** ⇒ không cần migration nới ràng buộc.
- **Bắt buộc đăng ký `ChatMessageFileResolver`** — `FilePolicyService.decideForLinkedFile` fail-closed với cặp `(module_code, entity_type)` chưa có resolver: trả `deny-no-resolver`, **không** rơi xuống fallback `FOUNDATION.FILE.*`. Thiếu resolver ⇒ gửi được tệp mà không ai tải được (SPEC-15 §13.5).
- Thu hồi tin → gỡ `file_links` của tin đó ⇒ FilePolicy tự động từ chối tải. Không cần xoá tệp vật lý.

### 6.6 Cột khai tử — kế hoạch contract

| Cột | Vì sao bỏ | Bước expand (release N = `0538`) | Bước contract (release N+1 = `0542`) |
| --- | --- | --- | --- |
| `chat_rooms.channel_id` | `channels` là bảng media out-of-scope | ngừng ghi/đọc; bỏ khỏi Drizzle schema | ✅ `DROP INDEX chat_rooms_channel_uq` → drop **composite tenant FK** `(company_id, channel_id)` do `0535` tạo → drop FK một-cột `chat_rooms_channel_id_fkey` (`0050`) → `DROP COLUMN` |
| `chat_messages.file_url` | URL trần, rò tệp không qua kiểm quyền | ngừng ghi; đường đọc trả `null` | ✅ `DROP COLUMN` |
| `chat_messages.file_name` | như trên | như trên | ✅ `DROP COLUMN` |

**✅ ĐÃ CHẠY 2026-08-05 — mig `0542` (`S7-CHAT-CLEAN-1`), PR #344.** Bằng chứng điều kiện vào, đo trên PROD (`mediaos`): `chat_rooms` 23 hàng · `channel_id IS NOT NULL` **0** · `chat_messages` **0 hàng** ⇒ `file_url`/`file_name` cùng 0. `chatMessageSchema` cũng bỏ luôn hai khoá `fileUrl`/`fileName` cùng commit. Chi tiết + đường lui: [`docs/plans/S7-CHAT-CLEAN-1.md`](../plans/S7-CHAT-CLEAN-1.md).

⚠️ **Vế dev-online của điều kiện vào KHÔNG chạy được:** DB `mediaos_dev` không tồn tại trên cụm (chưa provision) — đó là "không có DB", KHÔNG phải "đã xác minh 0 hàng". Ghi ra đúng như đo được.

Điều kiện vào bước contract (giữ lại làm khuôn cho lần sau): `SELECT count(*) … WHERE <cột> IS NOT NULL` **= 0** trên **cả** PROD lẫn dev-online, và `grep` toàn repo không còn tham chiếu. Gộp hai bước vào một release là vi phạm expand-contract — sẽ tạo cửa sổ 500 cho tiến trình cũ còn đang chạy.

---

### 6.7 Wave S8-CHAT-UX — cột & bảng bổ sung (mig `0543`)

> Nguồn: SPEC-15 §5.1b · CHAT-DEC-014…019. §6.1–§6.6 ở trên mô tả ALTER của wave **S7**; mục này là phần **S8** để hai đợt không lẫn vào nhau.

**Cột THÊM:**

| Bảng | Cột | Kiểu | Ghi chú |
| --- | --- | --- | --- |
| `chat_rooms` | `avatar_file_id` | UUID | → `files`. Chỉ dùng cho `group`/`department`/`project`; `direct` LUÔN NULL (avatar dẫn xuất) |
| `chat_room_members` | `pinned_at` | TIMESTAMPTZ | Ghim hội thoại **per-user**. NULL = không ghim. Sắp xếp `pinned_at DESC` |
| `chat_room_members` | `marked_unread_at` | TIMESTAMPTZ | Đánh dấu chưa đọc thủ công. Mở phòng ⇒ về NULL |

⚠️ **`marked_unread_at` KHÔNG được hiện thực bằng cách lùi `last_read_seq`** — con trỏ chỉ-tiến là bất biến (SPEC-15 §13.2 · CHAT-ERR-018).

**FK — composite tenant, KHÔNG phải FK một cột:**

```sql
-- KI-046: FK một cột (avatar_file_id) → files cho phép trỏ sang file của công ty KHÁC.
-- `files` ĐÃ có UNIQUE (company_id, id) từ 0535 (nằm trong danh sách 63 bảng, dòng 610)
-- ⇒ lập được ngay, không phải thêm gì bên đích.
--
-- ⛔ `ON DELETE SET NULL` TRẦN LÀ SAI trên FK 2 cột: Postgres set NULL cho TOÀN BỘ cột của FK,
--    tức NULL luôn `company_id` — cột NOT NULL mang tenant. Phải kèm danh sách cột (0535 header,
--    279/446 cặp rơi vào bẫy này).
ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_avatar_file_id_company_fk
  FOREIGN KEY (company_id, avatar_file_id) REFERENCES files (company_id, id)
  ON DELETE SET NULL (avatar_file_id);
```

**GRANT — CHỈ THÊM CỘT, tuyệt đối KHÔNG `REVOKE`:**

```sql
-- ⚠️ 0540 đã REVOKE vế UPDATE cấp bảng của chat_rooms rồi GRANT lại theo cột.
--    Viết `REVOKE UPDATE ON chat_rooms` ở đây sẽ CUỐN SẠCH cả 11 cột đang cấp
--    (Postgres: revoke quyền cấp bảng gỡ luôn column-GRANT tương ứng) ⇒ bảng
--    không cột nào ghi được, VĨNH VIỄN. Chỉ được GRANT thêm.
GRANT UPDATE (avatar_file_id) ON chat_rooms TO mediaos_app;
GRANT UPDATE (pinned_at, marked_unread_at) ON chat_room_members TO mediaos_app;
```

**Bảng MỚI `chat_message_reactions`:**

> ⛔ **ĐÍNH CHÍNH 06/08/2026 (S8-CHAT-UX-DB-1) — đoạn cảnh báo cũ ở đây đã SAI, và làm theo sẽ hỏng migration.**
>
> Bản ngày 05/08 viết: _"`chat_messages` **CHƯA có** `UNIQUE (company_id, id)` … không thêm thì `ADD CONSTRAINT … REFERENCES chat_messages (company_id, id)` **lỗi ngay lúc migrate**"_, kèm câu `ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (company_id, id);`.
>
> Phép đo đó **chỉ nhìn `0535`** (đúng: `chat_messages` không nằm trong danh sách 63 bảng) và **bỏ sót `0538:279`**, nơi wave S7 đã tự thêm constraint này để đỡ FK tự tham chiếu `reply_to_message_id`. Đo lại 06/08 trên lane sạch `mediaos_s8db1` (chain `0000→0542`) **và** trên `mediaos`: constraint **TỒN TẠI** (count = 1). Ngoài ra `0541:114` + `0542:167` ghi "⛔ CẤM DROP" và `s7-chat-db1-invariants.int-spec.ts:934` đang pin nó là "phải-giữ".
>
> ⇒ Chạy `ADD CONSTRAINT` như bản cũ viết thì `0543` **chết ngay dòng đầu với `42710 duplicate_object`** — ngược hẳn với thất bại được dự báo. `0543` vì vậy dùng **tiền kiểm ASSERT** (còn thì đi tiếp, mất thì `RAISE EXCEPTION`), không `ADD CONSTRAINT`. Xem [`docs/plans/S8-CHAT-UX-DB-1.md`](../plans/S8-CHAT-UX-DB-1.md) §0.

```sql
-- (0) KHÔNG `ADD CONSTRAINT` — `chat_messages_company_id_id_uq` ĐÃ CÓ từ 0538:279 (đo 06/08).
--     0543 chỉ ASSERT nó (cùng với files_company_id_id_uq · users_company_id_id_uq) rồi mới tạo bảng.

CREATE TABLE chat_message_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id  UUID NOT NULL,
  user_id     UUID NOT NULL,        -- ⚠️ KHÔNG `REFERENCES users(id)` — xem ghi chú (1) dưới bảng
  emoji       VARCHAR(32) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- composite tenant FK: reaction KHÔNG được trỏ sang tin/người của công ty khác (KI-046).
  -- CASCADE (không phải SET NULL) ⇒ không dính bẫy null-luôn-company_id, và cả hai cột đều NOT NULL.
  CONSTRAINT chat_message_reactions_message_id_company_fk
    FOREIGN KEY (company_id, message_id) REFERENCES chat_messages (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chat_message_reactions_user_id_company_fk
    FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
    ON DELETE CASCADE,

  -- bộ emoji ĐÓNG, ép ở DB chứ không chỉ ở Zod: chuỗi tự do là bề mặt lưu trữ vô hạn
  CONSTRAINT chat_message_reactions_emoji_chk
    CHECK (emoji IN ('like','love','haha','wow','sad','angry'))
);

-- 1 người / 1 tin / 1 emoji — cho phép cùng người thả NHIỀU emoji khác nhau. Xem ghi chú (2)+(3).
CREATE UNIQUE INDEX chat_message_reactions_uq
  ON chat_message_reactions (company_id, message_id, user_id, emoji);

ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_message_reactions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

-- KHÔNG `GRANT UPDATE`: đổi cảm xúc = DELETE + INSERT. KHÔNG cấp cho worker/readonly (0 job đọc).
GRANT SELECT, INSERT, DELETE ON chat_message_reactions TO mediaos_app;
```

> **Ba chỗ khối trên đã ĐỔI so với bản nháp 05/08** (đo + chứng minh khi thi công `0543`, 06/08):
>
> 1. **`user_id` dùng composite FK, KHÔNG phải `REFERENCES users(id)` một cột.** FK một-cột giữa hai bảng đều có `company_id` chính là lớp lỗ KI-046 — kiểm tra FK của Postgres chạy quyền hệ thống và **không áp RLS**. Đã tái lập trên lane: với FK một-cột, tenant A `INSERT` thành công (`INSERT 0 1`) một hàng `company_id = A` mang `user_id` của B; với composite thì `23503`. Ngoài ra `xtenant-fk-ratchet.int-spec.ts` ca (a) sẽ **ĐỎ trên CI** (file gate `hasDb`, không gate `LANE_DB`).
> 2. **Unique là 4 cột `(company_id, message_id, user_id, emoji)`**, khớp bảng quyết định của wave doc (bản nháp code ở đây ghi 3 cột — hai chỗ lệch nhau). Bản 4 cột **không nới lỏng gì**: composite FK ép mỗi `message_id` ứng đúng một `company_id`.
> 3. **BỎ index phụ `(company_id, message_id)`** — nó là **tiền tố chặt** của unique 4 cột ở trên, đúng loại index trùng mà `0541` vừa đi dọn. Truy vấn tổng hợp reaction theo trang dùng chính unique index.
>
> **Quan hệ với BẤT BIẾN #2 (không hard-delete) — đã cân nhắc, KHÔNG vi phạm.** Nhóm append-only là `audit_logs` · `login_logs` · … · `chat_messages`: dấu vết ai-làm-gì và nội dung trao đổi. Một reaction là **trạng thái hiện tại của một nút bấm bật/tắt**, không phải dấu vết cần đối chứng; giữ lại hàng đã bỏ thả chỉ tạo rác và buộc mọi truy vấn đếm phải thêm vế lọc. Vì vậy app role **có** `DELETE` trên bảng này — và **chỉ** bảng này trong cụm CHAT.
>
> Người thả reaction rồi **rời phòng**: hàng reaction **giữ nguyên** (không xoá theo `left_at`) — cùng lý do tin nhắn của người đã nghỉ việc được giữ (SPEC-15 §4.1).

---

## 7. Enum chuẩn (đồng bộ `packages/contracts/src/chat.ts`)

| Nhóm | Giá trị | Thay đổi so với hiện tại |
| --- | --- | --- |
| `room_type` | `direct` · `group` · `department` · `project` | **bỏ** `channel`; `project` giữ nguyên |
| `sync_source` | `manual` · `department` · `project` | mới |
| `message_type` | `text` · `file` · `system` | **thêm** `system` |
| member `role` | `member` · `admin` | giữ nguyên |

> `packages/contracts/src/chat.ts` hiện khai `chatRoomTypeSchema` gồm cả `channel` — phải sửa **cùng commit** với migration đổi CHECK, nếu không FE/BE lệch với DB.

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Danh sách phòng của tôi (sắp theo hoạt động) | `idx_chat_members_user_active` + `idx_chat_rooms_company_activity` |
| Đọc 50 tin gần nhất / cuộn lên | `idx_chat_messages_room_seq` |
| Bù tin sau khi WS đứt (`afterSeq`) | `idx_chat_messages_room_seq` |
| Tìm kiếm toàn văn | `idx_chat_messages_search` (GIN) + `idx_chat_members_user_active` |
| Tin đã ghim của phòng | `chat_messages_pinned_idx` (đã có từ 0050) |
| Mở DM idempotent | `chat_rooms_direct_uq` (đã có) |
| Phòng tự động theo phòng ban / dự án | `chat_rooms_org_unit_uq` · `chat_rooms_project_uq` (đã có) |
| Job đối soát đêm | `idx_chat_rooms_sync` |
| Chống double-submit | `uq_chat_messages_client_id` |

> **Cấm** khẳng định EXPLAIN chọn đích danh một index trong test — planner đổi kế hoạch theo thống kê (memory `pg-planner-index-assert-trap`). Đo bằng ngưỡng thời gian/số buffer, không bằng tên index.

---

## 9. Seed & kế hoạch migration (0536+ dự kiến, lane DB tuần tự)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| **A** | ALTER `chat_rooms` (cột mới + **BACKFILL** + 4 CHECK §6.1 + 3 index) · ALTER `chat_room_members` (5 cột + index + **GRANT UPDATE 4 cột**) · ALTER `chat_messages` (5 cột + CHECK + 2 index + **GRANT UPDATE `recalled_at`,`recalled_by`**) | RLS đã có từ 0010 — **không** đụng policy. ⚠️ **BACKFILL TRƯỚC KHI THÊM CHECK, nếu không migration ĐỎ trên DB đã có dữ liệu:** `sync_source` là cột **thêm mới DEFAULT `'manual'`**, trong khi `chk_chat_rooms_sync_source` (§6.1) ép `department→'department'` và `project→'project'` ⇒ mọi hàng `department`/`project` đang tồn tại **vi phạm ngay lúc `ADD CONSTRAINT`**. Thứ tự đúng: thêm cột → `UPDATE … SET sync_source = room_type WHERE room_type IN ('department','project')` → **đếm fail-loud hàng vi phạm từng CHECK** (hoặc `ADD CONSTRAINT … NOT VALID` rồi `VALIDATE` sau khi chữa) → mới `ADD CONSTRAINT`. Áp cùng cách cho `chk_chat_rooms_type_anchor`. Và kiểm 0 hàng `room_type='channel'` TRƯỚC khi đổi CHECK loại phòng |
| **B** | `CREATE EXTENSION unaccent` + `f_unaccent()` IMMUTABLE + cột generated `search_vector` + GIN index | sau A (cần `body` ổn định). Rewrite bảng — chạy khi bảng còn nhỏ |
| **C** | Backfill `room_code` cho phòng đã có (nếu có hàng) + **seed `sequence_counters` `'chat_room'` cho MỌI company** (scope Company, prefix + padding, reset Never, `ON CONFLICT DO NOTHING` + **verify fail-loud**) | Thiếu counter ⇒ `SequenceNotFoundError` ngay phòng đầu tiên — đúng bug `QA2-CRIT-002` của `task_code` |
| **D** | Seed module `CHAT` vào `modules` (mirror `0435`/`0506`, `ON CONFLICT DO NOTHING`) + **10 cặp permission** (SPEC-15 §11) + grant per-pair `data_scope` cho 4 role canonical **CHỈ với 9 cặp thường** (**DELETE-wrong-scope + INSERT ON CONFLICT**, verify fail-loud — mirror `0466`/`0476`) | `is_sensitive` **đã chốt** (SPEC-15 §11): `false` cho 9 cặp thường, **`true`** cho riêng `('view','chat-oversight')`. ⚠️ **Cặp thứ 10 KHÔNG grant cho role canonical nào** — xem ô ngay dưới |
| **D′** | **Cặp `('view','chat-oversight')`: chỉ INSERT vào catalog `permissions`, KHÔNG INSERT `role_permissions` cho bất kỳ role canonical nào.** Verify fail-loud **đúng một vế**: `0` role canonical giữ cặp này | ⚠️ **`super-admin` KHÔNG phải role canonical** — 4 role canonical là `roles.company_id IS NULL`, và super-admin **không có hàng ở đó** (`dashboard-widget-catalog.const.ts:33` · mirror `0481:35` · lặp ở `notification-event-catalog.const.ts:51,267`). SA là role **company-scoped dựng lúc boot** bởi `SuperAdminBootstrapService`, và bootstrap **grant TẤT CẢ cặp catalog** ⇒ cặp mới **tự động** vào SA, không cần (và không thể) grant trong migration. Viết `INSERT … WHERE role.code='super-admin'` trong migration sẽ khớp **0 hàng** ⇒ verify "SA có cặp" **luôn đỏ**, và lối thoát dễ nhất của người thi công là grant nhầm sang `company-admin` — đúng role mà SPEC-15 §11 cấm. Khẳng định "SA có cặp" phải là **int-spec chạy SAU boot**, không phải verify trong migration |
| **E** | **Verify** `audit_logs.object_type` CHECK đã chứa `'chat_room'` + `'chat_message'` — **đã UNION-ADD từ `0050`**, chỉ kiểm tra fail-loud, KHÔNG thêm lại | Nếu phải thêm: neo parse vào vế `object_type = ANY (` ở **cả hai** tầng, không quét `{…}`/`ARRAY[…]` trên toàn `constraintdef` (bẫy `audit-check-union-parse-anchor-trap`) |
| **F** | Seed NOTI: `CHAT_MENTIONED` + `CHAT_DIRECT_MESSAGE` vào `notification-event-catalog.const.ts` (`isEnabled=true`) + `notification_events` + template. **Nới CHECK trên CẢ HAI bảng:** `notification_events` (`chk_notification_events_module_code` += `'CHAT'`, `chk_notification_events_notification_type` += `'Chat'`) **VÀ** `notifications` (`chk_notifications_module_code` += `'CHAT'`, `chk_notifications_notification_type` += `'Chat'`, **giữ nhánh `IS NULL OR`**) | ⚠️ Quên vế `notifications` là **lỗi đã ship thật** ở `0507` (GOAL) và phải vá ở `0529`. Dùng cách **guard LIKE + re-stamp superset tường minh** của `0507`/`0529`, **không** dùng parser DO-block mẫu `0474` (giả định array-literal `'{…}'`, trả NULL với dạng `= ANY(ARRAY[…]::text[])` ⇒ **silent skip**) |
| **G** | ✅ **XONG — mig `0542`** (`S7-CHAT-CLEAN-1`, release TÁCH khỏi `0538`). Contract: drop `chat_rooms.channel_id` + `chat_messages.file_url`/`file_name` + composite FK/index kèm theo | Điều kiện §6.6 đã đo và đạt. Ratchet điểm danh ở `s7-chat-db1-invariants.int-spec.ts` chặn cột quay lại qua `db:generate` |

Bước **F phải xong TRƯỚC** khi WO backend đăng ký registrar outbox: `registerSource()` **fail-loud ngay lúc boot** nếu `eventCode` chưa có trong catalog với `isEnabled=true` ⇒ API sập lúc khởi động.

Giá trị superset hiện hành để re-stamp (đo tại `0529`, xác minh lại lúc chạy):

```text
module_code       : 'AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS'  (+ 'CHAT')
notification_type : … 'Goal','Training' …                                                  (+ 'Chat')
```

---

## 10. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-12 |
| --- | --- |
| **#1** `company_id` + RLS FORCE | Cả 3 bảng đã bật từ `0010` — wave này **không** đụng policy; composite tenant FK đã gắn ở `0535`; mọi repo qua `withTenant`. Cô lập **tenant** ở DB; ranh giới **phòng** ép ở service (`ChatAccessService`) — hai tầng khác nhau, không thay thế nhau |
| **#2** append-only / soft delete | `chat_messages` giữ nguyên GRANT `SELECT,INSERT`; thu hồi/ghim chỉ qua **column-level UPDATE**; không cấp `DELETE`. `chat_rooms` soft delete. `chat_room_members` rời phòng = `left_at`, không DELETE hàng |
| **#3** không secret plaintext | Module không lưu secret. Tệp đính kèm chỉ ra bằng URL ký hạn ngắn; payload notification **không** chứa nội dung tin nhắn |

---

## 11. Rủi ro dữ liệu đã nhận diện

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| Truy vấn membership quên `left_at IS NULL` | Người đã rời phòng vẫn đọc tin mới — im lặng, không lỗi | Một hàm dùng chung duy nhất + int-spec ca "đã rời" |
| Đường tìm kiếm không JOIN membership | Rò **toàn bộ** nội dung công ty qua một endpoint | Deny-path test viết TRƯỚC; cặp gate trùng đường đọc |
| Cấp nhầm `UPDATE` cấp bảng cho `chat_messages` | Mất bất biến #2 mà service vẫn "trông đúng" | Test chạy `UPDATE`/`DELETE` bằng **app role** thật |
| `f_unaccent` quên `IMMUTABLE` | Migration đỏ giữa chừng khi tạo cột generated | Kiểm ngay trong migration bước B |
| Đổi CHECK `room_type` khi còn hàng `'channel'` | Migration đỏ trên DB đã có dữ liệu (dev-online/PROD) | Đếm trước, migrate sang `'group'` nếu có |
| Quên nới CHECK trên `notifications` | **Mọi** notification CHAT vỡ khi INSERT — đã xảy ra thật với GOAL | Bước F làm cả hai bảng trong cùng migration |
| Cột generated rewrite bảng lớn | Khoá ACCESS EXCLUSIVE lâu | Chạy khi bảng còn nhỏ (hiện tại ~0 hàng) |
