# S8-CHAT-UX-DB-1 — Mig `0543`: nền DB cho wave nâng cấp giao diện CHAT

> **WO:** `S8-CHAT-UX-DB-1` · zone **đỏ** / gate **FULL** · phụ thuộc `S8-CHAT-UX-DOC-1` (đã land, PR #350)
> **Nguồn:** [DB-12 §6.7](<../DB/DB-12 CHAT Database Design.md>) · [SPEC-15 §5.1b](<../SPEC/SPEC-15 CHAT.md>) · [wave doc](S8-CHAT-UX-WAVE.md) `CHAT-DEC-015` · `CHAT-DEC-016` · `CHAT-DEC-018`
> **Head hiện tại:** `0542` (journal 210 entry) ⇒ file mới đánh số **`0543`**.

---

## 0. SỐ ĐO TRƯỚC KHI VIẾT — và **một tiền đề của WO đã SAI**

Đo trên lane cô lập `mediaos_s8db1` (chain `0000→0542` sạch, 210/210 migration) **và** đối chứng trên
`mediaos`. Không suy từ việc đọc migration cũ (bài học `0540` header).

| # | Đo | Kết quả |
| --- | --- | --- |
| A | `chat_messages_company_id_id_uq` tồn tại? | **CÓ — 1 constraint** |
| B | `files_company_id_id_uq` tồn tại? | CÓ (0535, danh sách 63 bảng) |
| C | `users_company_id_id_uq` tồn tại? | CÓ (0533) |
| D | `chat_message_reactions` tồn tại? | KHÔNG (bảng mới) |
| E | `chk` của `room_type` | `ANY (ARRAY['direct','group','department','project'])` |
| F | Tập cột UPDATE-được `chat_rooms` | `archived_at, archived_by, deleted_at, deleted_by, description, is_archived, last_message_at, last_message_seq, name, updated_at, updated_by` (11) |
| G | Tập cột UPDATE-được `chat_room_members` | `last_read_at, last_read_seq, left_at, muted_until, role` (5) |

### ⛔ ĐÍNH CHÍNH — tiền đề chặn của WO và của DB-12 §6.7 là SAI

WO `src[]` và DB-12 §6.7 đều ghi (đo 05/08):

> *"`chat_messages` **CHƯA có** `UNIQUE (company_id, id)` … Không thêm unique này thì
> `ADD CONSTRAINT … REFERENCES chat_messages (company_id, id)` **lỗi ngay lúc migrate**."*

Phép đo đó **chỉ nhìn `0535`** (danh sách 63 bảng — đúng là `chat_messages` không có trong đó) và
**bỏ sót `0538`**. Sự thật:

```sql
-- apps/api/migrations/0538_s7chatdb1_chat_v1.sql:277-279
-- chat_messages CHƯA có (company_id,id) UNIQUE (đo 02/08 …)
-- ⇒ phải thêm để làm ĐÍCH cho FK tự tham chiếu reply_to_message_id.
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (company_id, id);
```

Wave S7 đã tự thêm nó cho `reply_to_message_id`. Ngoài ra `s7-chat-db1-invariants.int-spec.ts:934`
**đang pin nó là "phải-giữ"**, và `0541:114` + `0542:167` ghi "⛔ CẤM DROP".

**Hệ quả nếu làm đúng như DB-12 viết:** câu `ALTER TABLE chat_messages ADD CONSTRAINT
chat_messages_company_id_id_uq UNIQUE (company_id, id);` sẽ ném **`42710 duplicate_object`** và
migration `0543` **chết ngay dòng đầu** — đúng ngược lại với thất bại mà WO dự báo.

**Xử lý:** KHÔNG `ADD CONSTRAINT`. Thay bằng **tiền kiểm ASSERT** (mục 2.0): còn thì đi tiếp, mất thì
`RAISE EXCEPTION` ồn ào. Giữ nguyên ý đồ ("đích của composite FK phải tồn tại") mà không phụ thuộc thứ
tự chạy. Đồng thời **sửa DB-12 §6.7** để người sau không đọc lại con số sai (memory
`wo-seed-hand-measurements-can-be-incomplete`).

---

## 1. Phạm vi

Đúng ba việc, **thuần additive**:

1. `chat_room_members` += `pinned_at`, `marked_unread_at` (`CHAT-DEC-015`)
2. `chat_rooms` += `avatar_file_id` + composite tenant FK → `files` (`CHAT-DEC-016`)
3. Bảng mới `chat_message_reactions` + RLS/FORCE/policy/GRANT (`CHAT-DEC-018`)

**NGOÀI phạm vi:** route/service (BE-1/BE-2/BE-3), contracts Zod, FE. Không đụng seed quyền — wave này
**không** cấp cặp `permission` mới (BE-2 dùng cặp `('update','chat-room')` đã có).

---

## 2. DDL — thứ tự bắt buộc

### 2.0 Tiền kiểm (fail-loud, KHÔNG sửa gì)

`DO` block assert 3 đích composite FK còn sống: `chat_messages_company_id_id_uq` ·
`files_company_id_id_uq` · `users_company_id_id_uq`. Thiếu bất kỳ cái nào ⇒ `RAISE EXCEPTION`, dừng
trước khi chạm dữ liệu. Lý do: `ADD CONSTRAINT` mù sẽ 42710 (mục 0); còn `ADD FK` mà đích mất thì lỗi
`42830` khó đọc hơn nhiều so với một câu tiếng Việt chỉ đúng chỗ.

### 2.1 `chat_room_members` — 2 cột ghim/chưa-đọc

```sql
ALTER TABLE chat_room_members
  ADD COLUMN pinned_at        timestamptz,
  ADD COLUMN marked_unread_at timestamptz;
```

- **KHÔNG index.** Trần ghim là 10 phòng/người và `idx_chat_members_user_active (company_id, user_id)
  WHERE left_at IS NULL` đã phục vụ cả phép đếm trần lẫn phép sắp `pinned_at DESC` trên tập vài chục
  hàng/người. Thêm index ở đây là index `idx_scan = 0` mà không ai dám drop về sau (memory
  `idx-scan-zero-is-not-unused`).
- `marked_unread_at` là cột **riêng**, KHÔNG lùi `last_read_seq` — con trỏ chỉ-tiến là bất biến
  (SPEC-15 §13.2 · `CHAT-ERR-018`).

### 2.2 `chat_rooms.avatar_file_id` — composite tenant FK

```sql
ALTER TABLE chat_rooms ADD COLUMN avatar_file_id uuid;

ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_avatar_file_id_company_fk
  FOREIGN KEY (company_id, avatar_file_id) REFERENCES files (company_id, id)
  ON DELETE SET NULL (avatar_file_id);
```

- **CHỈ composite, KHÔNG kèm FK một-cột.** FK một-cột `avatar_file_id → files(id)` là đúng lớp lỗ
  KI-046 (kiểm tra FK của PG chạy quyền hệ thống, bỏ qua RLS) — nó sẽ tạo một cặp MỚI trong
  `fk-tenant-census`, và cặp đó chỉ "xanh" nhờ composite phủ lên. Không tạo cặp ngay từ đầu thì sạch
  hơn, và census không có gì để đếm. Khuôn này giống `chat_rooms.archived_by/updated_by/deleted_by`
  (0538): cột uuid trần + duy nhất một composite FK.
- `ON DELETE SET NULL (avatar_file_id)` — **có danh sách cột**. `SET NULL` trần sẽ null luôn
  `company_id` (cột NOT NULL) ⇒ hoặc nổ 23502, hoặc tệ hơn ở bảng company_id nullable là hàng nghiệp
  vụ âm thầm thành hàng vô chủ. 279/446 cặp của `0535` rơi vào bẫy này; ratchet ca (f) canh nó.

**CHECK ép `direct` không có avatar riêng** (`CHAT-DEC-016`: *"`direct` → không ai, avatar dẫn xuất
từ người đối thoại"*):

```sql
ALTER TABLE chat_rooms
  ADD CONSTRAINT chk_chat_rooms_avatar_direct
  CHECK (room_type <> 'direct' OR avatar_file_id IS NULL);
```

> ⚠️ **Ghi cho BE-2 đọc:** đây là đai **thứ hai**. Service PHẢI từ chối trước bằng lỗi nghiệp vụ
> (4xx có mã `CHAT-ERR-0xx`); để rơi xuống DB thì người dùng nhận 500 vì `23514`. DB chỉ là lưới chống
> đường ghi tương lai quên luật, không phải nơi báo lỗi cho người dùng.

**GRANT — chỉ THÊM cột, tuyệt đối không `REVOKE`:**

```sql
GRANT UPDATE (avatar_file_id) ON chat_rooms TO mediaos_app;
GRANT UPDATE (pinned_at, marked_unread_at) ON chat_room_members TO mediaos_app;
```

> ⛔ **Vì sao cấm một câu `REVOKE` nào trong file này.** `0540` đã `REVOKE UPDATE ON chat_rooms` rồi
> `GRANT` lại theo 11 cột. Postgres: *"When revoking privileges on a table, the corresponding column
> privileges (if any) are automatically revoked on each column of the table, as well."* ⇒ một câu
> `REVOKE UPDATE ON chat_rooms` ở đây cuốn sạch cả 11 cột đang cấp, để lại bảng **không cột nào ghi
> được, VĨNH VIỄN** (memory `revoke-table-grant-wipes-column-grants`). Tập cột sau `0543`:
> `chat_rooms` 11 → **12**, `chat_room_members` 5 → **7**.

### 2.3 `chat_message_reactions` — bảng mới

```sql
CREATE TABLE chat_message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  emoji      varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chat_message_reactions_message_id_company_fk
    FOREIGN KEY (company_id, message_id) REFERENCES chat_messages (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chat_message_reactions_user_id_company_fk
    FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chat_message_reactions_emoji_chk
    CHECK (emoji IN ('like','love','haha','wow','sad','angry'))
);
```

**Ba chỗ lệch có chủ ý so với bản phác trong DB-12 §6.7 — và lý do:**

| Lệch | DB-12 phác | Làm ở đây | Vì sao |
| --- | --- | --- | --- |
| `user_id` | `REFERENCES users(id) ON DELETE CASCADE` (**một cột**) | **composite** `(company_id, user_id) → users(company_id, id)` | FK một-cột giữa hai bảng đều có `company_id` = lớp lỗ KI-046 ⇒ `xtenant-fk-ratchet` ca (a) **ĐỎ ngay trên CI** (file gate `hasDb`, không gate `LANE_DB`) |
| unique | `(message_id, user_id, emoji)` | `(company_id, message_id, user_id, emoji)` | Wave doc dòng 75 ghi bản 4 cột; hai doc lệch nhau. Chọn bản 4 cột: **không nới lỏng gì** (một `message_id` ứng đúng một `company_id` — composite FK ép thế) mà cột dẫn đầu `company_id` khớp khuôn index toàn repo và dùng lại được cho truy vấn tổng hợp |
| index phụ | thêm `(company_id, message_id)` | **KHÔNG tạo** | Nó là **tiền tố chặt** của unique 4 cột ở trên ⇒ đúng loại index trùng mà `0541` vừa đi dọn. Truy vấn tổng hợp reaction cho một TRANG tin dùng chính unique index |

```sql
CREATE UNIQUE INDEX chat_message_reactions_uq
  ON chat_message_reactions (company_id, message_id, user_id, emoji);

ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_message_reactions;
CREATE POLICY tenant_isolation ON chat_message_reactions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON chat_message_reactions TO mediaos_app;
```

- **RLS + FORCE + policy TẠO TRƯỚC mọi lối ghi** (CLAUDE.md §3). Không có backfill nào — bảng sinh ra
  rỗng — nhưng thứ tự vẫn giữ để khuôn không bị sao chép sai ở WO sau.
- **KHÔNG `GRANT UPDATE`.** Đổi cảm xúc = `DELETE` + `INSERT`; không có cột nào cần sửa tại chỗ.
- **KHÔNG cấp cho `mediaos_worker`/`mediaos_readonly`.** 0 job đọc reaction (least-privilege, đúng
  tinh thần `0540`). Cần thì cấp sau, một dòng.

> **BẤT BIẾN #2 (không hard-delete) — đã cân nhắc, KHÔNG vi phạm.** Nhóm append-only theo CLAUDE.md §2
> là audit/snapshot/ledger: `audit_logs` · `login_logs` · `attendance_logs` · … và `chat_messages`
> (nội dung trao đổi). Một reaction là **trạng thái hiện tại của một nút bấm bật/tắt**, không phải dấu
> vết cần đối chứng; giữ hàng đã bỏ thả chỉ tạo rác và buộc mọi phép đếm thêm vế lọc. Vì vậy app role
> **có** `DELETE` trên bảng này — và **chỉ** bảng này trong cụm CHAT. `chat_messages` /
> `chat_room_members` / `chat_rooms` giữ nguyên 0 quyền `DELETE` cấp bảng (có ca test canh).
>
> Người thả reaction rồi **rời phòng**: hàng giữ nguyên (không xoá theo `left_at`) — cùng lý do tin
> nhắn của người đã nghỉ việc được giữ (SPEC-15 §4.1).
>
> **`ON DELETE CASCADE` từ `users` — vì sao KHÁC lựa chọn RESTRICT của `0540`.** `0540` đổi 4 FK
> `users → chat` sang RESTRICT vì CASCADE chạy ở tầng owner, bỏ qua GRANT, nên nó **xoá cứng
> `chat_messages` append-only** và để lại lỗ `room_seq` vĩnh viễn. Reaction không thuộc nhóm đó và
> không mang `seq`: xoá user thì các nút bấm của người đó biến mất, đúng ngữ nghĩa. Đổi lại,
> `cleanupTenants` **không cần thêm dòng nào** — `DELETE FROM chat_messages` đã cascade sang reaction
> trước khi tới `DELETE FROM users`.

### 2.4 Khối VERIFY fail-loud (cuối file)

Khuôn `0540` mục (E), `aclexplode` chứ không `information_schema`, mọi truy vấn **neo
`nspname='public'`** (memory `audit-check-union-parse-anchor-trap`):

1. Tập cột UPDATE-được: `chat_rooms` = đúng 12 · `chat_room_members` = đúng 7 (pin theo TÊN, `=` chứ
   không `⊇` — cấp thừa một cột cũng đỏ).
2. 3 bảng chat cũ vẫn **0 quyền UPDATE/DELETE cấp bảng**.
3. `chat_rooms_avatar_file_id_company_fk`: 2 cột · `confdeltype='n'` · `confdelsetcols` **khác rỗng**.
4. `chat_message_reactions`: RLS + FORCE bật · có policy `tenant_isolation` đủ cả `USING` lẫn
   `WITH CHECK` · quyền cấp bảng = đúng `{SELECT, INSERT, DELETE}` (**không** UPDATE) · 2 composite FK
   đều `ON DELETE CASCADE` · CHECK emoji tồn tại · unique 4 cột tồn tại.

Lý do có khối này dù đã có int-spec: migration chạy trên **PROD/dev-online** nơi vitest không chạy.
Đổi lại, khối VERIFY chỉ chạy **một lần** ⇒ int-spec (mục 4) là đai giữ về sau. Hai đai, hai vòng đời.

---

## 3. Journal — bước hay bị quên nhất

Thêm entry `0543` vào `apps/api/migrations/meta/_journal.json` (`idx: 210`, `when` > `0542`).
**Không có entry ⇒ drizzle BỎ QUA file trong im lặng, vẫn in "applied" + exit 0** (memory
`migration-not-in-journal-is-silently-skipped`). Nghiệm thu bằng **ĐO LẠI SCHEMA**, không bằng log.

---

## 4. Fence bị chạm — phải sửa CÙNG commit

| Fence | Vì sao đỏ nếu bỏ qua | Sửa |
| --- | --- | --- |
| `s7-chat-db1-invariants.int-spec.ts` — `GRANTED_UPDATE_COLUMNS` | Pin tập cột **bằng nhau**: thêm 3 cột GRANT ⇒ ĐỎ ngay | Cập nhật pin: `chat_rooms` +`avatar_file_id` · `chat_room_members` +`marked_unread_at`,`pinned_at` |
| cùng file — mục **I** (mới) | Cột được cấp mà không ai chứng minh ghi được thì `42501` nổ lúc runtime (bài học mục H) | Thêm ca: xem mục 5 |
| `xtenant-fk-ratchet.int-spec.ts` | Ca (a): FK một-cột lớp T còn hở ⇒ ĐỎ | Đã tránh từ thiết kế: **chỉ** composite FK, không tạo FK một-cột nào |
| `rls-coverage-assert.int-spec.ts` | Ca (a)/(b): mọi bảng có `company_id` phải ENABLE+FORCE RLS và có policy đủ `USING`+`WITH CHECK` | Bảng mới đã bật đủ ngay trong `0543` |
| `communication.ts` + `schema/index.ts` | Schema drizzle lệch DB ⇒ `db:generate` lần sau dựng migration "sửa ngược" | Thêm 3 cột + `chatMessageReactions` (`export *` đã có sẵn) |
| DB-12 §6.7 | Ghi con số SAI (mục 0) + bản phác lệch 3 chỗ so với bản thi công | Đính chính tại chỗ, ghi rõ "đo lại 06/08" |

**Không** chạm: `fk-tenant-verdicts.ts` (không cặp hở mới) · `route-census` (0 route) · seed quyền
(0 cặp mới) · `cleanupTenants` (CASCADE lo).

---

## 5. Test — RED trước ở phần chứng minh được

Mục **I** mới trong `apps/api/test/integration/s7-chat-db1-invariants.int-spec.ts` (gate `hasDb`,
chạy THẬT trên CI). Mọi ca âm assert **mã lỗi ĐÍCH DANH** + có đối chứng dương:

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| I1 | ĐỐI CHỨNG DƯƠNG: app role ghi được `pinned_at`, `marked_unread_at`, `avatar_file_id` | `code = null` (không 42501) |
| I2 | app role vẫn KHÔNG ghi được `joined_at` / `company_id` của `chat_room_members` | `42501` |
| I3 | thả reaction hợp lệ | `code = null` |
| I4 | emoji ngoài bộ đóng (`'rocket'`) | `23514` + `constraint = chat_message_reactions_emoji_chk` |
| I5 | thả trùng (cùng message+user+emoji) | `23505` |
| I6 | cùng người thả **emoji khác** trên cùng tin | `code = null` (unique không được chặn nhầm) |
| I7 | **cross-tenant**: tenant A thả vào tin của tenant B | `23503` + `constraint = …_message_id_company_fk` |
| I8 | **cross-tenant**: `user_id` của tenant B trong hàng của A | `23503` + `constraint = …_user_id_company_fk` |
| I9 | RLS thật: A **không đọc thấy** reaction của B (đếm = 0) và không `DELETE` được nó (0 hàng) | 0 / 0 |
| I10 | bỏ thả = `DELETE` THẬT chạy được (CHAT-DEC-018) | `code = null`, hàng biến mất |
| I11 | `chat_message_reactions` KHÔNG có UPDATE cấp bảng; 3 bảng chat cũ vẫn KHÔNG có DELETE cấp bảng | `false` |
| I12 | RLS + FORCE bật trên bảng mới | `true`/`true` |
| I13 | avatar composite FK: 2 cột · `SET NULL` **có** danh sách cột | pass |
| I14 | `direct` room không nhận avatar | `23514` + `chk_chat_rooms_avatar_direct` |
| I15 | trỏ `avatar_file_id` sang file của tenant KHÁC | `23503` |

**Chạy như CI:** `export LANE_DB=mediaos_s8db1 && pnpm --filter @mediaos/api test`. Vùng đỏ ⇒ trước PR
chạy `bash harness/check.sh --lane-db` (CLAUDE.md §9.5).

---

## 6. Đường lui

Hoàn nguyên là **nới quyền + xoá dữ liệu** nên chỉ làm khi có bằng chứng hỏng đường ghi thật:

```sql
DROP TABLE IF EXISTS chat_message_reactions;             -- bảng rỗng ở thời điểm ship
ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_avatar_file_id_company_fk;
ALTER TABLE chat_rooms DROP CONSTRAINT chk_chat_rooms_avatar_direct;
ALTER TABLE chat_rooms DROP COLUMN avatar_file_id;       -- column-GRANT rơi theo cột, KHÔNG cần REVOKE
ALTER TABLE chat_room_members DROP COLUMN pinned_at, DROP COLUMN marked_unread_at;
```

⚠️ **Tuyệt đối không lùi bằng `REVOKE UPDATE ON <bảng>`** — nó cuốn sạch column-GRANT của 11 cột kia
(mục 2.2). `DROP COLUMN` gỡ đúng quyền của riêng cột đó.
⚠️ Sau khi BE-1/BE-2/BE-3 ship, `DROP COLUMN` là **đổi hình dạng có consumer sống** ⇒ phải đi
expand-contract 2 release (memory `migration-expand-contract-required`).

---

## 7. Rủi ro còn lại — nói ra để không ai tưởng là kín

1. **`ON UPDATE NO ACTION` mặc định của composite FK**: từ nay `UPDATE files SET company_id = …` bị
   chặn khi còn phòng dùng file đó làm avatar. Siết đúng hướng ở N=1, nhưng là thay đổi thật.
2. **`chk_chat_rooms_avatar_direct` chỉ canh chiều `direct`**: phòng `group/department/project` vẫn có
   thể để NULL (đúng — avatar là tuỳ chọn).
3. **Bộ emoji đóng nằm ở HAI chỗ** (CHECK ở DB + Zod ở BE-3). Thêm emoji thứ 7 phải sửa cả hai; sửa
   một bên là `23514` lúc chạy. Ghi vào plan BE-3.
4. **Reaction không audit.** Không ghi `audit_logs` cho thả/bỏ thả (không phải hành động quan trọng
   theo SPEC-01 §16.3) — nếu owner muốn đối chứng "ai từng thả gì" thì cần WO riêng, và lúc đó
   `DELETE` thật phải xem lại.
5. **Tin THU HỒI vẫn giữ reaction.** DB không gỡ reaction khi `recalled_at` được đặt (thu hồi là
   `UPDATE` 2 cột trên `chat_messages`, không phải xoá hàng ⇒ không có CASCADE nào chạy). Hệ quả: một
   tin đã thu hồi vẫn hiển thị "3 người thả 😆". **Việc của BE-3**, phải chốt tường minh: hoặc lọc
   reaction của tin `recalled_at IS NOT NULL` ở đường ĐỌC, hoặc `DELETE` chúng trong cùng transaction
   thu hồi. Ghi ra đây vì không ai gặp nó cho tới lúc người dùng thu hồi tin có cảm xúc.
6. **`company_id` DEFAULT theo GUC là hợp đồng hai chiều.** Bảng có DEFAULT nên `INSERT` bỏ trống cột
   sẽ tự điền từ `app.current_company_id`; ngoài ngữ cảnh tenant thì DEFAULT ra NULL ⇒ 23502 (fail
   đúng hướng, không ghi hàng vô chủ). Ca I "company_id tự điền từ GUC" ghim vế này.
