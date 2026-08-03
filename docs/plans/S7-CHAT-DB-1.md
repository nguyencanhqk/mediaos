# Micro-plan — `S7-CHAT-DB-1` (🔴 red · crown · FULL gate)

> **WO:** Migration CHAT — ALTER 3 bảng đã có + hạ tầng tìm kiếm tiếng Việt + seed module/10 cặp quyền/counter/NOTI.
> **Nguồn sự thật:** [SPEC-15 §11 · §12 · §16](<../SPEC/SPEC-15 CHAT.md>) · [DB-12 §6 · §9 · §11](<../DB/DB-12 CHAT Database Design.md>) · [ma trận §9c](<../permission-matrix-spec.md>) · [kế hoạch wave](S7-CHAT-WAVE.md)
> **Nhánh:** `wo/s7-chat-db-1` → PR vào **`wave/s7-chat`** (❗KHÔNG vào `master`, không gắn nhãn auto-merge — WAVE §4).
> **Lane DB:** `bash scripts/lane-db-setup.sh chatdb1` → `export LANE_DB=mediaos_chatdb1`.
> **Rev 2** (02/08/2026) sau `plan-reviewer` BLOCK — 5 mục chặn đã vá, xem §7.

---

## 0. Hiện trạng ĐO THẬT (không lấy từ tài liệu)

| Thứ | Giá trị đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| Head migration | **idx 204 · `0537_s6leavecarryover1_carry_forward`** (205 entry) | `migrations/meta/_journal.json` |
| ⇒ Migration của WO này | **`0538`, idx 205** — *đo lại lúc thi công, head có thể trôi tiếp* | — |
| `chat_rooms` cột hiện có | `id · company_id · ref_id · channel_id · org_unit_id · direct_key · room_type(**DEFAULT 'project'**) · name (**NOT NULL**) · created_by · created_at` | `communication.ts:144-179` |
| `chat_room_members` | `… role(default 'member') · last_read_at · joined_at`; unique **`(room_id, user_id)`**; GRANT UPDATE `(role, last_read_at)`; **còn GRANT DELETE** | `communication.ts:251-275` · `0050:60,64` · `0010:103` |
| `chat_messages` | `… body NOT NULL · message_type(CHECK text/file) · file_url · file_name · mentions · pinned_at · pinned_by · seq bigint IDENTITY`; **GRANT chỉ SELECT,INSERT** + UPDATE `(pinned_at, pinned_by)` | `communication.ts:286-318` · `0050:71,85-87` |
| `room_type` CHECK hiện hành | `IN ('project','direct','group','channel','department')` | `0050:36` |
| `audit_logs.object_type` | **đã có** `'chat_room'` + `'chat_message'` | `0050:91-125` |
| **`(company_id, id)` UNIQUE** | `chat_rooms` **CÓ** · **`chat_messages` KHÔNG** · `chat_room_members` KHÔNG | `0535:580-650` (63 bảng đích) |
| `role_permissions.data_scope` hợp lệ | `Own` · `Team` · `Department` · `Company` · `System` — **KHÔNG có `all`** | `permissions.ts:57` · CHECK mig `0441` |
| Verb canonical | `view`(140) · `update`(114) · `read`(100) · `create`(87) · `delete`(76) · `manage`(69) — **không có** `read_all`/`moderate` | quét `migrations/*.sql` |
| Pin NOTI catalog | `expect(NOTI_EVENT_COUNT).toBe(59)` · `toBe(45)` — **literal** | `noti-seed-catalog-permissions.int-spec.ts:90-91` |
| Ratchet FK chéo tenant | gate `hasDb`, **KHÔNG** gate `LANE_DB` ⇒ **chạy THẬT trên CI** | `xtenant-fk-ratchet.int-spec.ts:30` |

> ⚠️ **Tên CHECK phải resolve lúc chạy, KHÔNG hard-code.** `0010` tạo `room_type` và `message_type` CHECK **inline** (tên auto do Postgres sinh); `0050:22-32` drop bằng cách quét `pg_get_constraintdef`. Áp cùng cách cho **cả hai**: query `pg_constraint` theo `conrelid` + `condef ILIKE '%<cột>%'`, không thấy thì `RAISE EXCEPTION` (không tự tạo mới — tránh nuốt CHECK của lane khác). *Đây là mẫu `0050`, khác mẫu `0507`/`0529` vốn dành cho hot-file cross-lane `notification_events`/`notifications`.*

---

## 1. Việc KHÔNG làm

- ❌ Đụng RLS policy / FORCE — đã có từ `0010` (bất biến #1).
- ❌ UNION-ADD `audit_logs.object_type` — `0050` thêm rồi, **chỉ verify fail-loud**.
- ❌ `GRANT UPDATE` cấp bảng hay `GRANT DELETE` trên `chat_messages` (bất biến #2).
- ❌ DROP `channel_id` / `file_url` / `file_name` — expand-contract, để `S7-CHAT-CLEAN-1` release **sau**.
- ❌ Tạo bảng mới. `0050` đã ghi bài học: "KHÔNG tạo bảng chat_members/messages MỚI — 0010 đã tạo bảng cùng chức năng".
- ❌ **Chạy `db:generate`.** SQL viết tay (mirror header `0498`/`0506`/`0529`); drizzle-kit sẽ đẻ migration cạnh tranh.
- ❌ Parser DO-block mẫu `0474` cho CHECK NOTI — giả định array-literal, trả NULL với `= ANY(ARRAY[…]::text[])` ⇒ **silent skip**.

> **Migrator chạy bằng owner** (`rolbypassrls` — mirror `0498:17-22`): backfill/seed không cần set GUC tenant, **nhưng `company_id` vẫn viết tường minh** trong mọi câu (defense-in-depth, và để reviewer không phải suy đoán).

---

## 2. Đo trên PROD + dev-online TRƯỚC KHI MỞ PR

`chk_chat_rooms_type_anchor` dùng `RAISE EXCEPTION` — vấp dữ liệu cũ trên PROD là **release hỏng giữa chừng**. `chat_rooms.room_type` **DEFAULT `'project'`** mà anchor đòi `project ⇒ ref_id IS NOT NULL`, nên mọi phòng tạo không kèm `ref_id` đều vi phạm.

Chạy 5 câu đếm, **ghi số vào PR**, và chốt sẵn SQL chữa cho từng lớp vi phạm:

```sql
SELECT count(*) FROM chat_rooms;                                          -- tổng
SELECT room_type, count(*) FROM chat_rooms GROUP BY 1;                    -- phân bố loại
SELECT count(*) FROM chat_rooms WHERE room_type='channel';                -- cần migrate → 'group'
SELECT count(*) FROM chat_rooms WHERE room_type='project' AND ref_id IS NULL;      -- vi phạm anchor
SELECT count(*) FROM chat_rooms WHERE room_type='direct'  AND direct_key IS NULL;  -- vi phạm anchor
SELECT count(*) FROM chat_messages;                                       -- quyết định bước E rewrite
```

Kỳ vọng gần-rỗng sau de-media-fy — nhưng **đo, đừng đoán**. Hàng `channel` → `UPDATE … SET room_type='group'` kèm `RAISE NOTICE` số hàng (không `EXCEPTION`: de-media-fy đã chốt `channels` out-of-scope, đó là rác cần chuyển). Hàng vi phạm anchor → chốt SQL chữa **trong PR**, không improvise lúc chạy.

---

## 3. Các bước migration `0538`

### A — `chat_rooms`: thêm cột → **BACKFILL** → mới ADD CONSTRAINT

```sql
ALTER TABLE chat_rooms
  ADD COLUMN room_code        varchar(100),
  ADD COLUMN description      text,
  ADD COLUMN sync_source      varchar(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN synced_at        timestamptz,
  ADD COLUMN last_message_at  timestamptz,
  ADD COLUMN last_message_seq bigint,
  ADD COLUMN is_archived      boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at      timestamptz, ADD COLUMN archived_by uuid,
  ADD COLUMN updated_at       timestamptz, ADD COLUMN updated_by  uuid,
  ADD COLUMN deleted_at       timestamptz, ADD COLUMN deleted_by  uuid;

UPDATE chat_rooms SET sync_source = room_type WHERE room_type IN ('department','project');
```

**Vì sao backfill trước:** `sync_source` là cột **mới DEFAULT `'manual'`**, còn `chk_chat_rooms_sync_source` ép `department→'department'`, `project→'project'` ⇒ mọi hàng loại đó **vi phạm ngay lúc `ADD CONSTRAINT`**.

Rồi: (1) `room_type` bỏ `'channel'` — đếm + migrate trước, drop CHECK theo tên **resolve từ `pg_constraint`**, add lại `IN ('direct','group','department','project')`; (2) `chk_chat_rooms_type_anchor` + `chk_chat_rooms_sync_source` — **đếm hàng vi phạm trước, `RAISE EXCEPTION` kèm số** nếu >0; (3) `name` `DROP NOT NULL` + `chk_chat_rooms_name (room_type='direct' OR name IS NOT NULL)`.

**Index** — theo DB-12 §6.1 nguyên văn, kèm vị từ:

```sql
CREATE UNIQUE INDEX uq_chat_rooms_company_code ON chat_rooms (company_id, room_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_chat_rooms_active ON chat_rooms (company_id, last_message_at DESC)
  WHERE deleted_at IS NULL AND is_archived = false;
CREATE INDEX idx_chat_rooms_sync ON chat_rooms (company_id, sync_source)
  WHERE deleted_at IS NULL AND sync_source <> 'manual';   -- job đối soát đêm (DB-12 §8)
```

### B — 🔴 `room_code`: counter → backfill → **SYNC** → NOT NULL (MỘT khối, đúng thứ tự)

Mẫu `0498` là **bộ ba nguyên khối**, bỏ bước nào cũng vỡ:

```sql
-- (1) seed counter cho MỌI company (ON CONFLICT DO NOTHING)
--     CONTRACT khoá cho S7-CHAT-BE-1 — literal, không được đổi:
--       sequence_key='chat_room' · scope_type='Company' · module_code='CHAT'
--       reset_policy='Never'      · prefix='ROOM-'      · padding=4
INSERT INTO sequence_counters (company_id, sequence_key, scope_type, module_code,
                               reset_policy, prefix, padding, current_value)
SELECT c.id, 'chat_room', 'Company', 'CHAT', 'Never', 'ROOM-', 4, 0
  FROM companies c
 WHERE c.deleted_at IS NULL
    ON CONFLICT DO NOTHING;

-- (2) backfill room_code cho phòng đã có, đánh số tiếp TỪ current_value
-- (3) SYNC current_value = GREATEST(current_value, MAX số đã cấp) + last_generated_code
-- (4) SET NOT NULL
```

**Vì sao (3) là bắt buộc:** `ON CONFLICT DO NOTHING` để counter ở `current_value = 0`. Phòng đầu tiên tạo qua API gọi `SequenceService.nextCode` → sinh `ROOM-0001` → **đụng chính mã vừa backfill** → `23505` trên `uq_chat_rooms_company_code`, và chạy lại migration **không cứu được**. Đúng họ bug `QA2-CRIT-002` của `task_code` mà WO này đang trích dẫn để phòng.

*Rev 1 của plan đặt backfill ở bước A còn seed counter ở bước cuối — vòng lặp phụ thuộc. Đã gộp.*

### C — `chat_room_members`

```sql
ALTER TABLE chat_room_members
  ADD COLUMN last_read_seq    bigint NOT NULL DEFAULT 0,
  ADD COLUMN muted_until      timestamptz,
  ADD COLUMN left_at          timestamptz,
  ADD COLUMN visible_from_seq bigint,          -- v1 LUÔN NULL (CHAT-DEC-008)
  ADD COLUMN added_by         uuid,
  ADD CONSTRAINT chk_chat_members_read_seq CHECK (last_read_seq >= 0);

CREATE INDEX idx_chat_members_user_active ON chat_room_members (company_id, user_id) WHERE left_at IS NULL;
GRANT UPDATE (last_read_seq, muted_until, left_at, visible_from_seq) ON chat_room_members TO mediaos_app;
```

**Giữ unique `(room_id, user_id)`** — rời phòng = `SET left_at`, không DELETE. ⚠️ Ghi vào plan `S7-CHAT-BE-1`: người rời rồi vào lại phòng nhóm **tái dùng đúng hàng cũ** (`left_at = NULL`, cập nhật `joined_at`), không insert hàng thứ hai — nếu không dính `23505`.

`visible_from_seq` **để NULL**, không phải `0`; mọi vị từ đọc viết `(m.visible_from_seq IS NULL OR msg.seq >= m.visible_from_seq)` ngay từ v1.

> **`GRANT DELETE` cấp bảng vẫn còn** trên `chat_room_members` và `chat_rooms` (`0010:72,103`). Ngữ nghĩa "rời phòng = `left_at`" / "phòng = soft delete" hiện **không có gì ép ở tầng DB**. Code chat cũ đã bị `git rm` ⇒ **0 caller sống**, đây là cửa sổ rẻ nhất để `REVOKE DELETE`. **Chốt: REVOKE ngay ở WO này** — sau khi BE-1 ship thì phải expand-contract 2 release (`migration-expand-contract-required`). Kèm ca test âm.

### D — 🔴 `chat_messages` (vùng append-only) + **composite tenant FK**

```sql
-- (a) chat_messages CHƯA có (company_id,id) UNIQUE — bắt buộc thêm để làm ĐÍCH composite FK
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (company_id, id);

ALTER TABLE chat_messages
  ADD COLUMN client_message_id   uuid,
  ADD COLUMN reply_to_message_id uuid,
  ADD COLUMN recalled_at         timestamptz,
  ADD COLUMN recalled_by         uuid,
  ADD COLUMN attachment_count    smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_chat_messages_attachment_count CHECK (attachment_count >= 0);

-- message_type += 'system' (resolve tên CHECK từ pg_constraint, mẫu 0050:22-32)

CREATE UNIQUE INDEX uq_chat_messages_client_id
  ON chat_messages (company_id, room_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX idx_chat_messages_room_seq ON chat_messages (company_id, room_id, seq DESC);
CREATE INDEX idx_chat_messages_reply    ON chat_messages (company_id, reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

-- CHỈ 2 cột thu hồi. TUYỆT ĐỐI không UPDATE cấp bảng, không DELETE.
GRANT UPDATE (recalled_at, recalled_by) ON chat_messages TO mediaos_app;
```

**🔴 MỌI FK MỚI PHẢI LÀ COMPOSITE.** Plan rev 1 thêm 6 FK **một cột** giữa hai bảng đều có `company_id NOT NULL` — đúng lớp lỗ **KI-046** mà `0535` vừa đóng (kiểm tra FK của Postgres **bỏ qua RLS**, nên tenant A ghi được hàng trỏ sang bản ghi của B), và làm **ĐỎ `xtenant-fk-ratchet.int-spec.ts` trên CI** (spec gate `hasDb`, **không** gate `LANE_DB` ⇒ chạy thật).

| Bảng | Cột | Composite FK |
| --- | --- | --- |
| `chat_rooms` | `archived_by` · `updated_by` · `deleted_by` | `(company_id, <col>) → users (company_id, id)` |
| `chat_room_members` | `added_by` | `(company_id, added_by) → users (company_id, id)` |
| `chat_messages` | `recalled_by` | `(company_id, recalled_by) → users (company_id, id)` |
| `chat_messages` | `reply_to_message_id` | `(company_id, reply_to_message_id) → chat_messages (company_id, id)` — cần (a) ở trên |

**Bắt buộc dạng `ON DELETE SET NULL (<col>)` có danh sách cột** — `SET NULL` trần sẽ null luôn `company_id` (ratchet ca (f); `0535:681-682`).

**`attachment_count` KHÔNG trong GRANT — chủ ý.** Phải đặt **ngay trong câu INSERT** tin nhắn (`= fileIds.length`, biết từ SPEC-15 §13.5 bước 2). DB-12 bản 01/08 viết "cập nhật trong cùng transaction ⇒ không cần GRANT UPDATE" — **sai**: quyền Postgres không đến từ việc nằm cùng transaction ⇒ **mọi tin có tệp trả 500**. Ràng buộc này đã chép sang `done_when` của `S7-CHAT-BE-3`.

### E — Tìm kiếm tiếng Việt

```sql
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE chat_messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(coalesce(body,'')))) STORED;
CREATE INDEX idx_chat_messages_search ON chat_messages USING GIN (search_vector);
```

- **`IMMUTABLE`** — `unaccent()` gốc chỉ `STABLE`, dùng thẳng trong cột generated là migration **đỏ**.
- **Cast `::regdictionary` tường minh** (DB-12 §6.4) — bỏ phụ thuộc overload resolution, làm chỗ neo OID hiện rõ cho reviewer.
- **Qualify `public.`** ở cả extension, thân hàm, biểu thức generated. Cột generated **neo vào OID hàm**; sai `search_path` lúc migrate là hỏng **vĩnh viễn**, phải rewrite bảng để sửa. *(Delta có chủ ý so với DB-12: DB-12 tạo hàm không qualify — bản ở đây chặt hơn.)*
- **`'simple'`, KHÔNG `'english'`.**
- Bước này **rewrite bảng** — chạy khi `chat_messages` còn nhỏ (đã đếm ở §2).
- **Xác minh vai trò migrator có quyền `CREATE EXTENSION` trên PROD trước khi mở PR** — không có quyền thì phải xin cấp, không có đường vòng ở tầng app.

### F — Seed module + **10 cặp** quyền

Mirror `0506`: `INSERT INTO modules … ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING` (pin đích **partial index**; `ON CONFLICT` trần dính `42P10`) → `INSERT INTO permissions (action, resource_type, is_sensitive)` → grant per-pair, role resolve **theo thuộc tính** (`name = … AND company_id IS NULL AND deleted_at IS NULL`, không hard-code id, `RAISE EXCEPTION` nếu thiếu) → `DELETE` grant sai scope → `INSERT` → verify fail-loud.

**Ma trận grant — chốt tường minh ở đây, KHÔNG để người thi công tự quyết.**

SPEC-15 §11 chỉ có 3 cột (Nhân viên · Trưởng đơn vị · BOD/Admin) và ghi ô là `all` — mà **`all` không phải giá trị `data_scope` hợp lệ** (chỉ `Own`/`Team`/`Department`/`Company`/`System`). Hai quyết định phải nêu tên:

1. **`all` → `Company`.** Ranh giới thật của CHAT là **membership**, không phải scope (SPEC-15 §3.2); scope chỉ nói "được làm hành động ở mức nào". `Company` là ánh xạ trung thành; `System` dành cho platform/SA.
2. **`hr` nhận đúng như `employee`.** SPEC-15 §11 **không có cột `hr`** — im lặng, nên đây là quyết định của plan này: CHAT là công cụ phổ quát, mọi nhân viên đều chat, HR không có đặc quyền chat nào. Nếu owner muốn khác thì sửa **ở đây trước**, không sửa trong migration.

⇒ **9 cặp thường × 4 role canonical (`employee`·`manager`·`hr`·`company-admin`), tất cả `data_scope='Company'`, `effect='ALLOW'` ⇒ N = 36 hàng.**

| Cặp | `is_sensitive` | employee | manager | hr | company-admin |
| --- | --- | --- | --- | --- | --- |
| `('access','chat')` | false | Company | Company | Company | Company |
| `('view','chat-room')` | false | Company | Company | Company | Company |
| `('create','chat-room')` | false | Company | Company | Company | Company |
| `('update','chat-room')` | false | Company | Company | Company | Company |
| `('archive','chat-room')` | false | Company | Company | Company | Company |
| `('manage','chat-member')` | false | Company | Company | Company | Company |
| `('send','chat-message')` | false | Company | Company | Company | Company |
| `('recall','chat-message')` | false | Company | Company | Company | Company |
| `('pin','chat-message')` | false | Company | Company | Company | Company |
| **`('view','chat-oversight')`** | **true** | — | — | — | — |

*Đồng nhất là đúng chứ không phải lười:* quyền chỉ là **cổng module**, ranh giới thật do `ChatAccessService.assertMember` ép ở service; "admin phòng" là `chat_room_members.role='admin'`, **không** phải role hệ thống (SPEC-15 §11 ghi chú).

**Cặp thứ 10:**

```sql
-- CHỈ vào catalog. KHÔNG INSERT role_permissions cho bất kỳ role canonical nào.
INSERT INTO permissions (action, resource_type, is_sensitive)
VALUES ('view','chat-oversight', true) ON CONFLICT DO NOTHING;
```

⚠️ **`super-admin` KHÔNG phải role canonical.** 4 canonical (`roles.company_id IS NULL`) = `employee`·`manager`·`hr`·`company-admin`; SA là role **company-scoped dựng lúc boot** bởi `SuperAdminBootstrapService`, vòng lặp ở `super-admin-bootstrap.service.ts:104-111` grant **toàn bộ catalog** `data_scope='System'` (chỉ trừ `reveal-secret:platform-account`) ⇒ cặp mới **tự động** vào SA. Viết `INSERT … WHERE code='super-admin'` ở đây khớp **0 hàng**, verify "SA có cặp" **luôn đỏ**, và lối thoát rẻ nhất là grant lạc sang `company-admin` — đúng role SPEC-15 §11 cấm.

**Verify fail-loud** (`RAISE EXCEPTION`, mirror `0506:197-276`) — **liệt kê tường minh 10 cặp, KHÔNG `LIKE 'chat%'`** (sẽ nuốt `chat-report` tương lai):

1. catalog có đủ **10** cặp (đếm theo danh sách literal);
2. grant canonical đúng **36** hàng — over/under đều đỏ;
3. **`0` hàng `role_permissions` trỏ `('view','chat-oversight')` với role canonical** — vế duy nhất verify được ở tầng migration;
4. **vế dương** đi kèm: cặp `('view','chat-oversight')` **tồn tại** trong `permissions` với `is_sensitive=true` (không có vế này thì "0" có thể chỉ vì seed trượt);
5. 9 cặp thường `is_sensitive=false`;
6. module `CHAT` tồn tại + `is_active`.

### G — NOTI catalog + nới CHECK trên **CẢ HAI** bảng

2 event `CHAT_MENTIONED` + `CHAT_DIRECT_MESSAGE` (`isEnabled=true`) + template, đồng bộ 1-1 với `notification-event-catalog.const.ts`.

**`dedupe_strategy` chốt ở đây** (mặc định `0479` là `'None'`): `CHAT_DIRECT_MESSAGE` = **`'DedupeKey'`** — `S7-CHAT-BE-6` gộp lô 15 phút bằng `dedupeKey 'chat:{roomId}:{recipientUserId}:{bucket15m}'`, để `'None'` thì BE-6 phải sửa seed = **migration thứ hai**. `CHAT_MENTIONED` = `'None'` (gửi ngay, không gộp).

Nới CHECK theo mẫu **`0507`/`0529`** (guard `LIKE` + re-stamp superset tường minh), **tên thật** — xác minh lại lúc chạy:

- `notification_events`: `chk_notification_events_module_code` += `'CHAT'` · **`chk_notification_events_type`** += `'Chat'` *(không phải `chk_notification_events_notification_type`)*
- **`notifications`**: cùng 2 cột, và **GIỮ nhánh `IS NULL OR`** (hàng legacy để cột mới NULL — `0479:249`)

Quên vế `notifications` ⇒ **mọi** thông báo CHAT vỡ lúc INSERT — lỗi **đã ship thật** với GOAL ở `0507`, vá ở `0529`.

`ON CONFLICT` nhắm **partial unique** (`uq_notification_events_global_code_active`); `ON CONFLICT(event_code)` trần nổ `42P10`.

---

## 4. Ngoài migration — cùng commit

| File | Việc | Vì sao cùng commit |
| --- | --- | --- |
| `apps/api/src/db/schema/communication.ts` | Mọi cột mới; **`search_vector` khai GENERATED** qua `customType` (`tsvector` không có sẵn trong `drizzle-orm/pg-core`) | Thiếu khai generated ⇒ mọi INSERT tin nhắn đỏ `cannot insert into generated column` |
| `packages/contracts/src/chat.ts` | Bỏ `'channel'`; **`chatRoomSchema.name` → `.nullable()`** (`:18` đang `z.string()`); `createChatRoomSchema` bỏ `name.min(1)` bắt buộc khi `roomType='direct'`; thêm trường v1 | Bước A `DROP NOT NULL` ⇒ server trả `name: null` → **ZodError runtime dù HTTP 200** (lớp `server-masking-needs-optional-fe-schema`). Tách khỏi migration đổi CHECK ⇒ FE/BE lệch DB |
| `apps/api/src/permission/permission.service.ts` | `"view:chat-oversight"` vào **CẢ HAI**: `SENSITIVE_CAPABILITY_ALLOWLIST` (`:47`) + `SENSITIVE_SCREEN_GATE_PAIRS` (`:195`) | Thiếu ⇒ `/auth/me` không trả key ⇒ CHAT-SCREEN-007/008 **ẩn dù DB có quyền** (KI-058). Mảng thứ hai là chốt hồi quy làm CI đỏ khi quên |
| `apps/api/test/integration/noti-seed-catalog-permissions.int-spec.ts` | **Bump literal `59→61`, `45→47`. GIỮ literal.** | 2 event mới đẩy count lên. ⚠️ **CẤM** đổi thành `toBe(NOTI_EVENT_COUNT)` — tautology = giết pin (`canonical-seed-pin-regression`); `S5-GOAL-DB-1.md:100` đã ghi đúng cách vá này |
| `apps/api/test/integration/auth-seed-canonical-roles.int-spec.ts` | Thêm `('view','chat-oversight')` vào **`FORBIDDEN_PAIRS`** (`:126`) | Verify #3 chỉ sống ở thời điểm migration; đây là **chốt vĩnh viễn** chống grant lạc. File đã chạy đúng hình dạng assert này cho `reveal-secret:platform-account` |
| `apps/api/src/auth/auth-me-capabilities.int.spec.ts` | Ca **sau boot**: role `super-admin` giữ `view:chat-oversight`, `/auth/me` trả key | ⚠️ File gate `hasDb && LANE_DB` ⇒ **CI SKIP**; chỉ `check.sh --all` mới ép chạy. Spec phải chạy **đúng vòng lặp bootstrap thật** (cần `PLATFORM_SUPERADMIN_EMAIL`), nếu chỉ dựng role fixture thì nó chứng minh fixture — khi đó **ghi rõ nó là proxy**, đừng để tưởng đã chốt |

---

## 5. Test RED-trước

Mỗi ca âm **assert `err.constraint`/`err.code` đích danh** và kèm **đối chứng dương** (cùng fixture, sửa đúng một trường → thành công). Không có hai thứ đó thì ca xanh nhờ constraint khác — không chứng minh gì.

| # | Ca | Kỳ vọng | Bắt được gì |
| --- | --- | --- | --- |
| 1 | App role `UPDATE chat_messages SET body='x'` | lỗi quyền | Reviewer đọc service **không** thấy lỗ này |
| 2 | App role `DELETE FROM chat_messages` | lỗi quyền | Bất biến #2 ở tầng DB |
| 3 | App role `UPDATE chat_messages SET attachment_count=1` | **lỗi quyền** | Chốt B8 — ép BE-3 đặt giá trị trong INSERT |
| 4 | App role `UPDATE chat_messages SET recalled_at=now()` | **thành công** | Đối chứng dương: column-GRANT đúng phạm vi |
| 5 | App role `DELETE FROM chat_room_members` | lỗi quyền | REVOKE ở bước C |
| 6 | App role `UPDATE chat_room_members SET last_read_seq=5` OK / `SET joined_at=now()` từ chối | tương ứng | Column-GRANT đúng cả hai chiều |
| 7 | 2 tin cùng `(company_id, room_id, sender_id, client_message_id)` | `23505` | Nền DB cho CHAT-ERR-014 |
| 8 | Phòng `department` **có** `org_unit_id` nhưng `sync_source='manual'` | vi phạm **`chk_chat_rooms_sync_source`** (assert tên) | ⚠️ Thiếu `org_unit_id` thì lỗi bật ra là **anchor**, ca xanh-giả |
| 9 | `room_type='channel'` | vi phạm **CHECK `room_type`** (assert tên) | `'channel'` khai tử. ⚠️ `'channel'` rơi ngoài cả 4 nhánh anchor ⇒ hai constraint cùng vi phạm, phải neo tên |
| 10 | `f_unaccent('Báo cáo')` = `'Bao cao'` | khớp | Hạ tầng tìm kiếm |
| 11 | `websearch_to_tsquery('simple', f_unaccent('bao cao'))` khớp cột generated **và** truy vấn khác **không** khớp | tương ứng | Không dấu ra có dấu, kèm đối chứng âm |
| 12 | `role_permissions` canonical cho `('view','chat-oversight')` = **0** *và* cặp **tồn tại** trong `permissions` với `is_sensitive=true` | tương ứng | Chốt B3 — "0" phải vì không grant, không phải vì seed trượt |
| 13 | Grant canonical 9 cặp thường = **36** | khớp | Ma trận §3F |
| 14 | Mọi company có counter `'chat_room'`, và `current_value >= COUNT(rooms)` per company | khớp | Chốt B2 — chống `23505` ở phòng đầu tiên |
| 15 | Mã `nextCode` sinh sau migration **không trùng** mã đã backfill | khớp | idem |
| 16 | `INSERT notifications` `module_code='CHAT'` + `notification_type='Chat'` | thành công | Chốt bẫy `0507` (vế `notifications`) |
| 17 | `INSERT notifications` với 2 cột đó **NULL** | vẫn thành công | Nhánh `IS NULL OR` còn sống |
| 18 | Tenant A insert tin `reply_to_message_id` = id tin của tenant B | **`23503`** | 🔴 Chốt B1 — composite FK thật sự chặn |
| 19 | Cross-tenant đọc **và ghi** cả 3 bảng | 0 hàng / từ chối | Lưới `S6-QA-TENANTWRITE-1` |
| 20 | `room_code` NOT NULL + unique partial theo company | khớp | Bước B hoàn tất |

Chạy: `bash scripts/lane-db-setup.sh chatdb1` → `export LANE_DB=mediaos_chatdb1` → `bash harness/check.sh --lane-db`.

Đặt file ở **`apps/api/test/integration/**/*.int-spec.ts`** — `apps/api` chỉ chạy `src/**/*.spec.ts` cho unit, sai glob là **0 ca chạy mà gate vẫn PASS**. Hook `guard-immutability` chỉ miễn đường dẫn chứa `/test/` hoặc `/migrations/` ⇒ test nhắc tên bảng append-only kèm SQL mà đặt trong `src/` **bị chặn ngay khi Edit**.

Xong: `DROP DATABASE mediaos_chatdb1` — pgdata từng phình 10GB vì 325 lane DB bỏ quên.

---

## 6. Đường lui (viết SQL thật, không hứa)

| Thứ | Lùi được? | Cách |
| --- | --- | --- |
| Cột mới, index, CHECK, composite FK | ✅ | Migration nghịch đảo: `DROP CONSTRAINT` → `DROP INDEX` → `DROP COLUMN` (viết sẵn, kèm trong PR) |
| Column-GRANT mới | ⚠️ | `REVOKE` được, **nhưng** sau khi BE-1 ship thì revoke = **cửa sổ 403** ⇒ phải expand-contract 2 release (`migration-expand-contract-required`) |
| Seed quyền / counter / NOTI | ✅ | `DELETE` theo cặp literal + `UPDATE deleted_at` cho counter (mirror khối comment cuối `0506:285`) |
| **Bước E (`search_vector` + `f_unaccent`)** | ❌ **không lùi sạch** | Cột generated neo OID hàm; `DROP COLUMN search_vector` rồi `DROP FUNCTION` được, nhưng đã **rewrite bảng** một lần và sẽ rewrite lần nữa. Coi bước E là **một chiều** — đó là lý do §2 bắt đếm `chat_messages` trước |
| Tổng thể | — | **KHÔNG** `git revert` — DB đã đổi hình dạng; phải đi bằng migration nghịch đảo |

---

## 7. Đã vá sau `plan-reviewer` (rev 1 → rev 2)

| # | Phát hiện | Vá ở |
| --- | --- | --- |
| **B1** 🔴 | 6 FK **một cột** mới mở lại lớp lỗ KI-046 **và** làm ĐỎ `xtenant-fk-ratchet` trên CI (spec gate `hasDb`, không gate `LANE_DB`). `chat_messages` **chưa có** `(company_id,id)` UNIQUE nên chưa làm đích composite được | §3D — thêm `chat_messages_company_id_id_uq`, 6 FK đổi sang composite dạng `ON DELETE SET NULL (<col>)` có danh sách cột; ca test 18 |
| **B2** 🔴 | Backfill `room_code` ở bước A nhưng counter seed ở bước cuối (vòng lặp), và **bỏ hẳn bước SYNC** của mẫu `0498` ⇒ phòng đầu tiên tạo qua API nổ `23505` vĩnh viễn | §3B — gộp một khối counter→backfill→SYNC→NOT NULL; ghi literal CONTRACT khoá; ca test 14/15 |
| **B3** | Ma trận grant không tồn tại ở nguồn nào: SPEC-15 §11 thiếu cột `hr`, ô ghi `all` mà `all` **không** phải `data_scope` hợp lệ; "N chốt trong PR" biến verify thành vòng tròn | §3F — bảng 4 role × 9 cặp literal, `all→Company` và `hr = employee` nêu thành **quyết định có tên**, N = **36**, verify thêm vế dương |
| **B4** | Ca test 6/7 (rev 1) xanh-giả vì vi phạm **CHECK khác** | §5 ca 8/9 — assert `err.constraint` đích danh + đối chứng dương cho mọi ca âm |
| **B5** | 2 event NOTI làm ĐỎ pin literal `59`/`45`; rủi ro thật là **cách vá sai** (đổi sang tautology) | §4 — bump literal, cấm tautology tường minh |

Cảnh báo đã gộp: CHECK thiếu so với DB-12 (`read_seq`, `attachment_count`, `idx_chat_messages_reply`, `idx_chat_rooms_sync`) · tên index/CHECK theo DB-12 nguyên văn · resolve tên CHECK `message_type` · tên thật `chk_notification_events_type` · `contracts.name` `.nullable()` · đo PROD trước PR (§2) · `REVOKE DELETE` · cast `::regdictionary` · `customType` cho `tsvector` + không `db:generate` · verify liệt kê tường minh thay `LIKE 'chat%'` · `modules` `ON CONFLICT` partial · `FORBIDDEN_PAIRS` pin · `dedupe_strategy` · migrator chạy owner · đường lui SQL thật.

---

## 8. Definition of Done

- [ ] 7 bước A→G trong **một** migration (head thật lúc chạy), idempotent, verify fail-loud từng bước
- [ ] §2 đã đo trên PROD + dev-online, **số ghi trong PR**, SQL chữa chốt sẵn
- [ ] 20 ca RED-trước xanh trên `LANE_DB`, có bằng chứng **RED trước GREEN**
- [ ] Schema Drizzle + contracts + 2 mảng allowlist + 3 file test pin sửa **cùng commit**
- [ ] `xtenant-fk-ratchet.int-spec.ts` **xanh** (chốt B1)
- [ ] `bash harness/check.sh --lane-db` xanh (không phải "xanh không đủ bằng chứng")
- [ ] FULL gate PASS: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`
- [ ] PR base = **`wave/s7-chat`**, **không** nhãn auto-merge
- [ ] **SAU KHI DEPLOY PROD — kiểm tay, KHÔNG bỏ qua:** role quản trị thật (`SA`) phải giữ **đủ 10 cặp CHAT**.
      Khối (F′) cấp theo luật "role đang giữ toàn bộ catalog-ngoài-CHAT"; nếu `SA` lỡ **thiếu đúng 1 cặp**
      nào đó thì luật không khớp và **không cấp gì, im lặng** (verify (12) vẫn PASS vì 0 == 0).
      Đo 02/08: `SA` = 379/379 nên sẽ khớp — nhưng phải xác nhận lại sau deploy:
      `SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
         JOIN roles r ON r.id=rp.role_id WHERE r.name='SA' AND p.resource_type LIKE 'chat%';`  → kỳ vọng **10**
- [ ] Lane DB đã drop
