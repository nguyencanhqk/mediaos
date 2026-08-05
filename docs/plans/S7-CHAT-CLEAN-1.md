# S7-CHAT-CLEAN-1 — Bước CONTRACT của expand-contract cụm CHAT

> **Zone:** 🔴 red · **Gate:** FULL (`database-reviewer` + `security-reviewer`) · **Model:** Opus
> **Nguồn:** [DB-12 §6.6](<../DB/DB-12 CHAT Database Design.md>) · [SPEC-15 §5.3, §7](<../spec/SPEC-15 CHAT.md>) · `harness/backlog.mjs::S7-CHAT-CLEAN-1`
> **Nhánh:** `feat/s7-chat-clean-1` (base `master` @ `32ccd2a4`) · **Migration:** `0542`

Bỏ ba cột khai tử khỏi `chat_rooms` / `chat_messages` cùng toàn bộ index + khoá ngoại bám theo, và gỡ
hai khoá tương ứng khỏi DTO. Đây là **release N+1** của cặp expand-contract mà `S7-CHAT-DB-1` (mig
`0538`) mở ở release N.

---

## 1. Điều kiện vào — ĐÃ ĐO, không suy luận

Mọi số dưới đây đo ngày **2026-08-05** trên đúng cụm Postgres đang chạy (`mediaos-postgres`,
`127.0.0.1:5432`), bằng `psql` chứ không bằng đọc code.

### 1.1 Số hàng — vế "0 hàng"

| Đo | PROD (`mediaos`) | Kết |
| --- | --- | --- |
| `chat_rooms` tổng | 23 | — |
| `chat_rooms WHERE channel_id IS NOT NULL` | **0** | ✅ |
| `chat_rooms` theo loại | `department=11` · `project=12` | ✅ **0 phòng loại `channel`** |
| `chat_messages` tổng | **0** | ✅ |
| `chat_messages WHERE file_url IS NOT NULL` | **0** | ✅ |
| `chat_messages WHERE file_name IS NOT NULL` | **0** | ✅ |
| `chat_room_members` tổng | 48 | — (không đụng) |

```sql
SELECT 'chat_rooms_total', count(*) FROM chat_rooms
UNION ALL SELECT 'channel_id_not_null', count(*) FROM chat_rooms WHERE channel_id IS NOT NULL
UNION ALL SELECT 'chat_messages_total', count(*) FROM chat_messages
UNION ALL SELECT 'file_url_not_null', count(*) FROM chat_messages WHERE file_url IS NOT NULL
UNION ALL SELECT 'file_name_not_null', count(*) FROM chat_messages WHERE file_name IS NOT NULL;
```

### 1.2 dev-online — ĐÍNH CHÍNH so với `done_when`

`done_when` viết "0 hàng trên **CẢ** PROD lẫn dev-online". Đo thật:

```text
$ psql -d mediaos_dev -c '…'
FATAL:  database "mediaos_dev" does not exist
```

Danh sách DB đầy đủ trên cụm (9 hàng `pg_database`):
`mediaos` · `mediaos_chatbe9` · `mediaos_chatgate2` · `mediaos_s7chatbe3` · `mediaos_s7chatbe4` ·
`mediaos_s7qa1` · `postgres` · `template0` · `template1`.

⇒ **DB dev-online chưa được provision trên máy này** (`.env.dev-online` trỏ `…/mediaos_dev`, xem
memory `prod-and-dev-online-topology`). Không có dữ liệu để mất, nhưng **đây là "không tồn tại", KHÔNG
phải "đã xác minh 0 hàng"** — ghi ra đúng như đo được thay vì tick một ô không chạy. Ai chạy
`m dev-online-db` sau này sẽ dựng DB từ đầu chuỗi migration ⇒ đã bao gồm `0542`, không có cột để mà lệch.

### 1.3 Vế "0 tham chiếu code" — grep toàn repo

| Ký hiệu | Nơi còn nhắc | Loại |
| --- | --- | --- |
| `chatRooms.channelId` | `db/schema/communication.ts:163` (khai cột) · `:198` (index `chat_rooms_channel_uq`) | khai báo — **gỡ ở WO này** |
| `chat_rooms.channel_id` | `test/integration/tenant-isolation.int-spec.ts:211` | **comment**, không phải code chạy — xem §4.3 |
| `fileUrl`/`fileName` (CHAT) | `chat.mapper.ts:100-101` (hardcode `null`) · `contracts/src/chat.ts:111-112` (khoá DTO) · 6 file fixture spec | **gỡ ở WO này** |

**0 đường đọc, 0 đường ghi.** Ba cột không xuất hiện trong bất kỳ `SELECT`/`INSERT`/`UPDATE` nào:

- `chat-messages.repository.ts` liệt kê cột **tường minh** (`MESSAGE_COLUMNS`), không `select()` trần —
  `file_url`/`file_name` cố ý nằm ngoài (comment `:33` ghi rõ "hai cột KHAI TỬ (BE-3)").
- `chat.mapper.ts:100-101` trả `null` **hằng**, không đọc từ `row` ⇒ DTO đã tách rời DB từ BE-3.
- Đính kèm thật đi qua FOUNDATION `files` + `file_links` + URL ký (`ChatAttachmentPresignService`),
  SPEC-15 §13.5.

Các hit `channelId`/`fileUrl` khác trong repo thuộc cụm **media/finance/dashboard đã park**
(`content_channels`, `cost_records`, `mv_dashboard`, `contracts/src/media.ts`…) — bảng khác, cột khác,
không liên quan `chat_*`.

### 1.4 Tách release khỏi `S7-CHAT-DB-1` — vế dễ bỏ sót nhất

Luật: gộp expand + contract vào **một** release là mở cửa sổ 500 cho tiến trình cũ còn chạy
(memory `migration-expand-contract-required`). Bằng chứng `0538` **đã deploy** lên PROD, tức release N
đã đóng và `0542` sẽ là một release **khác**:

| Bằng chứng trên PROD | Kết quả |
| --- | --- |
| Cột do `0538` tạo có mặt: `room_code`, `sync_source`, `last_message_seq` | ✅ `0538` đã áp |
| Index do `0541` gỡ đã biến mất: `chat_messages_company_id_idx`, `chat_messages_room_id_idx` | ✅ `0541` đã áp |
| `drizzle.__drizzle_migrations` | 212 hàng |

Thêm một lớp đệm ngoài luật: **CHAT chưa live** (`modules.is_active = false`), `chat_messages` **0 hàng**
⇒ không có tiến trình nào đang đọc ba cột này ngay cả trong cửa sổ deploy.

---

## 2. Phạm vi — chốt owner 2026-08-05

Ba câu hỏi đã hỏi và đã được chốt trước khi viết code:

1. **Gỡ cả DTO** (không chỉ DB). `fileUrl`/`fileName` rời `chatMessageSchema` + mapper + fixture.
2. **`DESTRUCTIVE-APPROVED` ký bởi Cian** — bắt buộc, xem §3.1.
3. **Làm ngay, base `master`**, không chờ PR #343 (QA-1) merge — xem §4.4.

---

## 3. Thi công

### 3.1 Migration `0542_s7chatclean1_drop_dead_columns.sql`

`scripts/check-migration-no-drop.sh` quét `DROP COLUMN` và **ĐỎ** trừ khi file mang dòng chuẩn thuận.
File phải mở bằng:

```sql
-- DESTRUCTIVE-APPROVED: 3 cột khai tử (chat_rooms.channel_id, chat_messages.file_url/file_name)
--   — 0 hàng PROD, 0 tham chiếu code, release tách khỏi 0538 đã deploy (Cian)
```

Thứ tự lệnh — **không đảo**, theo DB-12 §6.6:

```text
(A) DROP INDEX chat_rooms_channel_uq                      -- unique partial (company_id, channel_id)
(B) ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_channel_id_company_fk   -- composite tenant FK, mig 0535
(C) ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_channel_id_fkey         -- FK một-cột di sản mig 0050
(D) ALTER TABLE chat_rooms   DROP COLUMN channel_id
(E) ALTER TABLE chat_messages DROP COLUMN file_url
(F) ALTER TABLE chat_messages DROP COLUMN file_name
```

Trạng thái đo được của (A)–(C) trên PROD, để bước sau không phải đoán tên:

```text
chat_rooms_channel_id_fkey        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
chat_rooms_channel_id_company_fk  FOREIGN KEY (company_id, channel_id)
                                  REFERENCES channels(company_id, id) ON DELETE SET NULL (channel_id)
chat_rooms_channel_uq             UNIQUE INDEX (company_id, channel_id) WHERE channel_id IS NOT NULL
```

> **Vì sao vẫn viết (A)–(C) tường minh khi `DROP COLUMN` tự dọn chúng?** Vì tự-dọn là **im lặng**. Viết
> ra thì tên constraint nằm trong file, `IF EXISTS` bảo vệ chuỗi chạy lại, và VERIFY ở §3.2 có cái để
> đối chiếu. Đây cũng là thứ tự DB-12 §6.6 ghi — lệch khỏi doc thiết kế mà không nói là drift.

**KHÔNG dùng `CASCADE`.** Nếu có object nào ngoài dự kiến bám vào cột, ta muốn migration **ĐỎ** để đọc
thông báo, không muốn nó lặng lẽ kéo theo. Đã soi trước: 0 view, 0 matview, 0 function nào nhắc
`chat_rooms`; policy duy nhất là `chat_rooms_tenant_isolation` và nó chỉ đọc `company_id`.

**Quyền:** `channel_id` **không có** GRANT cấp cột (`attacl` của `chat_rooms` chỉ phủ 11 cột writer do
`0540` cấp: `archived_at, archived_by, deleted_at, deleted_by, description, is_archived,
last_message_at, last_message_seq, name, updated_at, updated_by`). Bẫy
`revoke-table-grant-wipes-column-grants` **không áp dụng** — không REVOKE gì ở WO này.

### 3.2 Khối VERIFY (cùng transaction migration)

Theo khuôn `0541`: đỏ thì hoàn nguyên sạch.

1. Ba cột đã biến mất khỏi `information_schema.columns`.
2. Ba object (A)(B)(C) đã biến mất khỏi `pg_indexes` / `pg_constraint`.
3. **Vế quan trọng hơn — cái phải GIỮ:** các index/constraint còn lại trên `chat_rooms` còn nguyên
   (`chat_rooms_pkey`, `chat_rooms_company_id_id_uq`, `chat_rooms_project_uq`, `chat_rooms_org_unit_uq`,
   `chat_rooms_direct_uq`, `uq_chat_rooms_company_code`, `idx_chat_rooms_company_activity`,
   `idx_chat_rooms_sync`, `chat_rooms_company_id_idx`, `chat_rooms_ref_id_idx`). Lý do dựng vế này:
   `0541` đã chứng minh một tay sửa sau rất dễ "dọn tiếp" nhầm.
4. Tập cột writer của `0540` trên `chat_rooms` **vẫn đúng 11 cột** — bắt trường hợp `DROP COLUMN` làm
   xô lệch `attacl`.
5. RLS còn bật: `relrowsecurity AND relforcerowsecurity` trên cả hai bảng (BẤT BIẾN #1).

### 3.3 Đồng bộ code — CÙNG COMMIT với migration

| File | Việc |
| --- | --- |
| `apps/api/src/db/schema/communication.ts` | gỡ `channelId` (`:163`) + `uniqueIndex("chat_rooms_channel_uq")` (`:197-199`) + `fileUrl`/`fileName` (`:341-342`); gỡ import `channels` nếu thành mồ côi |
| `packages/contracts/src/chat.ts` | gỡ `fileUrl`/`fileName` khỏi `chatMessageSchema` (`:105-112`) kèm khối comment "khai tử" |
| `apps/api/src/chat/chat.mapper.ts` | gỡ 2 dòng `fileUrl: null` / `fileName: null` (`:99-101`) |
| `apps/api/src/chat/chat-messages.repository.ts` | cập nhật comment `:33` — hai cột không còn tồn tại để mà "không select" |
| 6 file fixture spec | gỡ 2 dòng khỏi object literal: `realtime-emitter.chat.spec.ts` · `ConversationPanel.spec.tsx` · `MessageBubble.spec.tsx` · `MessageList.spec.tsx` · `use-chat-conversation.spec.tsx` · `ChatPage.spec.tsx` |
| `docs/DB/DB-12`, `docs/spec/SPEC-15`, `docs/erd-current.md` | đổi "khai tử / sẽ drop" → "**đã drop** ở `0542`" |

**Ratchet mới** (`s7-chat-db1-invariants.int-spec.ts`): điểm danh 3 cột đã-gỡ + danh sách index
phải-giữ trên `chat_rooms`. Khối VERIFY của migration chỉ chạy **một lần** lúc migrate; khai lại cột
trong `communication.ts` là đường trôi im lặng qua `db:generate`. Cùng lý do `0541` đã dựng ratchet.

---

## 4. Rủi ro đã soi

### 4.1 Đổi DTO = đổi hợp đồng dây — thứ tự deploy có cứu không?

Gỡ khoá khỏi `chatMessageSchema` là thay đổi **wire contract**, không chỉ DB. Chiều nguy hiểm là
BE-trước-FE: server ngừng gửi khoá trong khi bundle FE cũ vẫn `z.string().nullable()` (bắt buộc) ⇒
ZodError ⇒ **trang trắng dù HTTP 200** (memory `server-masking-needs-optional-fe-schema`).

Thứ tự deploy thật của PROD **chạy đúng chiều an toàn** (memory `prod-3-way-drift-fe-auto-be-manual`):

```text
merge master → FE Cloudflare Pages TỰ deploy   (schema mới, không còn đòi khoá)
             → BE NSSM deploy TAY sau (m prod-update api)  (mới ngừng gửi khoá)
```

Giữa hai mốc, server **thừa** hai khoá so với schema FE — Zod object không `.strict()` bỏ qua khoá
thừa. An toàn.

Đệm thứ hai, độc lập với thứ tự: `chat_messages` **0 hàng** trên PROD và module `is_active = false` ⇒
không có response CHAT nào để mà parse trong cửa sổ đó.

### 4.2 Ratchet FK chéo tenant — đo trước, không đoán

`xtenant-fk-ratchet.int-spec.ts` assert số cặp FK một-cột giữa hai bảng tenant
`>= FK_SINGLE_COL_PAIRS_FLOOR`. Gỡ `chat_rooms.channel_id → channels` làm **giảm 1** cặp.

| | |
| --- | --- |
| Census đo được hôm nay | **460** |
| Sàn (`fk-tenant-verdicts.ts:105`) | **440** |
| Sau `0542` | **459** ≥ 440 ✅ |

`fk-tenant-census.ts` đọc thẳng `pg_constraint`, **0 danh sách bảng viết tay** ⇒ không có file nào
phải sửa theo. Không cần thêm waiver: cặp bị **gỡ**, không phải xin miễn.

`W4_FK_BLOCKED_FLOOR = 260` (`tenant-isolation.int-spec.ts`, hiện 263 — đệm chỉ còn 3) **không đổi**:
comment `:211` ghi rõ `chat_rooms.channel_id` đang bị `uq_chat_rooms_company_code` chặn trước bằng
**23505**, nên nó thuộc nhóm 182-cặp-chặn-bằng-cơ-chế-khác, KHÔNG nằm trong 263 cặp đếm bằng 23503.
Bỏ cột ⇒ 449 cặp thử giảm còn 448, số **bị chặn bằng 23503 giữ nguyên 263**. Phải xác minh lại bằng
lần chạy thật trên lane, không dừng ở lập luận này.

### 4.3 Comment `tenant-isolation.int-spec.ts:211` sẽ nói về một cột không còn tồn tại

Không phải code chạy, nhưng để nguyên là để lại một comment chết trên **đường quyết định** của người
đọc sau (memory `wo-plans-built-on-code-comments`). Sửa cùng commit, ghi rõ cặp đã biến mất ở `0542`.

### 4.4 `depends_on: [S7-CHAT-QA-1]` khi QA-1 chưa merge

PR #343 đang MỞ, đủ check xanh, chờ 1 review người. Diff của nó: `docs/plans/**` + `docs/QA/**` +
`harness/backlog.mjs` — **0 dòng code**, `git diff master...HEAD | grep` không thấy `file_url`,
`file_name`, `channel_id`, `fileUrl`, `fileName`, `channelId`. Hai nhánh không giao nhau ⇒ base
`master` an toàn, không chồng nhánh. Xung đột duy nhất có thể có là `harness/backlog.mjs` (cả hai đổi
`status`) và nó nằm ở hai item khác nhau, cách xa nhau trong file.

### 4.5 Khoá bảng

`DROP COLUMN` lấy **ACCESS EXCLUSIVE** trên bảng. Chấp nhận được vì `chat_messages` 0 hàng và
`chat_rooms` 23 hàng ⇒ mili-giây. `DROP COLUMN` của Postgres chỉ đánh dấu `attisdropped`, không viết
lại heap — không có bước rewrite dài.

---

## 5. Đường lui

Chuỗi hoàn nguyên (dán nguyên văn — dữ liệu **không** phục hồi được, nhưng cả ba cột vốn 0 hàng):

```sql
ALTER TABLE chat_messages ADD COLUMN file_name text;
ALTER TABLE chat_messages ADD COLUMN file_url  text;
ALTER TABLE chat_rooms    ADD COLUMN channel_id uuid;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_channel_id_company_fk
  FOREIGN KEY (company_id, channel_id) REFERENCES channels(company_id, id)
  ON DELETE SET NULL (channel_id);
CREATE UNIQUE INDEX chat_rooms_channel_uq ON chat_rooms (company_id, channel_id)
  WHERE channel_id IS NOT NULL;
```

⚠️ `ON DELETE SET NULL (channel_id)` — **danh sách cột là bắt buộc**. Thiếu nó thì Postgres set NULL
cả `company_id` khi xoá `channels`, tức tự tay tạo hàng mồ côi không tenant (`fk-tenant-census.ts` có
cờ riêng cho đúng bẫy này).

---

## 6. Nghiệm thu

- [x] `bash scripts/check-migration-no-drop.sh` — XANH (`đã duyệt tường minh: 1`, nhờ dòng
      `DESTRUCTIVE-APPROVED`)
- [x] Chuỗi migration sạch từ `0000` trên lane riêng (`LANE_DB=mediaos_s7chatclean1`, dựng bằng
      `--reset`) — VERIFY của `0542` không đỏ
- [x] `pnpm typecheck` + `pnpm lint` toàn workspace xanh
- [x] `bash harness/check.sh --lane-db=s7chatclean1` — **XANH toàn bộ**: secret-literals · lint ·
      typecheck · migration-no-drop · tooling-tests · test 496/496 file api + 216 app + 42 web-core +
      32 contracts + 27 console + 16 ui + 4 auth
- [x] Ratchet mới ĐỎ khi bị vi phạm — chứng minh bằng đột biến, **hai vector** (§7.3)
- [ ] FULL gate: `database-reviewer` + `security-reviewer` PASS

---

## 7. Đo được TRONG LÚC THI CÔNG — ba thứ §1 không đoán ra

### 7.1 File `.sql` KHÔNG đăng ký journal thì bị BỎ QUA, và migrate vẫn báo thành công

Lần chạy đầu: `lane-db-setup.sh` in `[db:migrate] applied migrations` và **exit 0**, nhưng đo lại DB
thì cả ba cột **vẫn còn nguyên**, FK/index còn nguyên, census FK vẫn 460. Nguyên nhân: drizzle chạy
theo `apps/api/migrations/meta/_journal.json`, **không** theo thư mục. File `0542` chưa có entry ⇒
migrator không thấy nó, và không có gì đỏ để báo.

Đây là một **xanh-giả hoàn chỉnh**: lệnh xanh, log nói "applied", DB không đổi gì. Nếu chỉ đọc exit
code rồi đi tiếp thì `0542` sẽ vào PR dưới dạng một file SQL không bao giờ chạy. Phép thử duy nhất
tin được là **đo lại schema sau khi migrate**, không phải đọc log.

Vá: thêm entry `{"idx": 209, "version": "7", "when": 1717587331000, "tag":
"0542_s7chatclean1_drop_dead_columns", "breakpoints": true}` (nối tiếp `when` của `0541`).

### 7.2 `grep` khoanh vùng bỏ sót 3 file — typecheck mới là bộ đếm đủ

§1.3 dựng bằng `grep` giới hạn ở `apps/app/src/components/chat`, `routes`, `lib`. Nó **bỏ sót 3 file**
fixture nằm ngoài các thư mục đó, và cả ba chỉ lộ ra khi `pnpm typecheck` đỏ TS2353:

- `apps/app/src/hooks/use-chat-realtime.spec.tsx`
- `apps/app/src/stores/chat.store.spec.ts`
- `packages/web-core/src/lib/chat-api.spec.ts`

Bài học cho lần dọn cột sau: `grep` theo thư mục đoán trước là để **định hướng**, không phải để
**kết luận**. Con số "0 tham chiếu" chỉ đáng tin sau khi typecheck toàn workspace xanh — trình biên
dịch quét đúng tập file, còn ta thì đoán.

### 7.3 RED-proof: đột biến để lại vết trong DB, và `lane-db-setup.sh` KHÔNG dọn nó

Ratchet mới được chứng minh ĐỎ bằng hai vector độc lập:

| Đột biến | Kết quả |
| --- | --- |
| `ALTER TABLE chat_rooms ADD COLUMN channel_id uuid` | ❌ `cột khai tử quay lại …: expected [ 'chat_rooms.channel_id' ] to deeply equal []` |
| `DROP INDEX idx_chat_rooms_sync` | ❌ `index phải-giữ của chat_rooms bị gỡ mất (DROP COLUMN nuốt kèm?): expected [ 'idx_chat_rooms_sync' ] to deeply equal []` |

⚠️ **Bẫy đi kèm, đã sập một lần:** sau đột biến, chạy lại `bash scripts/lane-db-setup.sh s7chatclean1`
(không cờ) **KHÔNG khôi phục** `idx_chat_rooms_sync`. Script thấy DB đã tồn tại nên chỉ chain-migrate,
mà `0538` đã nằm trong bảng `__drizzle_migrations` ⇒ bỏ qua ⇒ index vẫn mất. Lần chạy full-suite ngay
sau đó ĐỎ đúng một test, và cái đỏ đó **không nằm trong code** — nó nằm trong DB (cùng lớp lỗi
memory `test-fixture-stamps-global-permission-catalog`: `git stash` không phân biệt được).

Đường đúng: **`bash scripts/lane-db-setup.sh <lane> --reset`** (DROP DATABASE + dựng lại). Sau reset,
full-suite xanh sạch.
