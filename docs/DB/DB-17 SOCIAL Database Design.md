# DB-17: SOCIAL — THIẾT KẾ CƠ SỞ DỮ LIỆU (MẠNG XÃ HỘI NỘI BỘ)

> **📚 Bộ tài liệu DB** — [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index & Performance](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-12 CHAT](<DB-12 CHAT Database Design.md>) · [DB-14 RECRUIT](<DB-14 RECRUIT Database Design.md>) · **DB-17 SOCIAL**
>
> **Nguồn nghiệp vụ:** [SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) — file này **không** nhân bản rule, chỉ hiện thực hoá.

---

## 1. Thông tin tài liệu

| Trường       | Nội dung                                                            |
| ------------ | ------------------------------------------------------------------- |
| Mã tài liệu  | DB-17                                                               |
| Tên tài liệu | SOCIAL - Thiết kế cơ sở dữ liệu                                     |
| Module code  | SOCIAL                                                              |
| Tài liệu cha | DB-01 · SPEC-16                                                     |
| Phiên bản    | v1.0                                                                |
| Trạng thái   | Approved (thiết kế) — **CHƯA migrate**                              |
| Wave         | `S16-SOCIAL` — `DB-1` (Track A, 10 bảng) · `DB-2` (Track B, 9 bảng) |
| Ngày tạo     | 18/09/2026                                                          |

---

## 2. Mục đích tài liệu

Đặc tả schema 19 bảng `feed_*` của mạng xã hội nội bộ: cột, kiểu, CHECK, index, RLS, composite tenant-FK, GRANT, seed và kế hoạch migration — đủ để `S16-SOCIAL-DB-1` và `DB-2` viết migration mà không phải suy diễn.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng MỚI — 19

**Track A (`S16-SOCIAL-DB-1`) — 10 bảng:** `feed_posts` · `feed_comments` · `feed_reactions` · `feed_mentions` · `feed_tags` · `feed_post_tags` · `feed_saved_posts` · `feed_post_views` · `feed_post_acks` · `feed_reports`.

**Track B (`S16-SOCIAL-DB-2`) — 9 bảng:** `feed_groups` · `feed_group_members` · `feed_polls` · `feed_poll_options` · `feed_poll_votes` · `feed_ideas` · `feed_kudos` · `feed_kudos_recipients` · `feed_kudos_badges`.

> ⚠️ Con số **19** là bản chốt của [SPEC-16 §5.1](<../SPEC/SPEC-16 SOCIAL.md>); ước lượng «15 bảng» lúc seed wave đã lỗi thời — xem SPEC-16 §23.1.

### 3.2 Bảng SỬA — UNION-ADD, KHÔNG rewrite

| Bảng                | Thay đổi                                                                                                  | Trạng thái                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `audit_logs`        | CHECK `object_type` (**số ít**) **UNION-ADD** `feed_post` · `feed_comment` · `feed_group` · `feed_report` | ✅ DB-1 mig `0579` — **127 → 131 giá trị** |
| ~~`file_links`~~    | ~~CHECK `object_type` UNION-ADD~~                                                                         | ❌ **KHÔNG CẦN** — đã ĐO, xem dưới         |
| ~~**recycle-bin**~~ | ~~registry / CHECK loại đối tượng~~                                                                       | ❌ **KHÔNG CẦN** — đã ĐO, xem dưới         |

> CHECK `audit_logs` là **hot-file**: đọc giá trị hiện có, hợp nhất, ghi lại — không gõ lại danh sách từ trí nhớ (bẫy `audit-check-union-parse-anchor-trap`).

> ✅ **`file_links` — nợ ĐO ĐÃ ĐÓNG (S16-SOCIAL-DB-1, đo trên DB thật 19/09/2026): KHÔNG CÓ GÌ ĐỂ LÀM.**
> Cột thật trên `file_links` tên **`entity_type`** (`varchar`), **không** phải `object_type`; và `file_links` chỉ có **2 CHECK** — `chk_file_links_link_type` (Avatar/Attachment/Contract/Proof/Document/Import/Export/Other) và `chk_file_links_access_scope` (Owner/Team/Department/Company/System). **KHÔNG có CHECK nào trên `entity_type`** — cột tự do, không allow-list (nguồn: `apps/api/migrations/0433_foundation_db3_files.sql:159-164`, `apps/api/src/db/schema/files.ts:116`).
> ⇒ Gắn tệp vào bài/bình luận chỉ cần ghi `module_code='SOCIAL'`, `entity_type='feed_post'|'feed_comment'`, `link_type='Attachment'` (giá trị **đã có** trong CHECK) — hoàn toàn ở tầng **SERVICE** (BE-1). **0 dòng DDL.**

> ✅ **Recycle-bin — nợ ĐO ĐÃ ĐÓNG (đo 19/09/2026): KHÔNG CẦN ĐĂNG KÝ GÌ.**
> Recycle-bin **không có registry và không có CHECK loại đối tượng**: `apps/api/src/recycle-bin/recycle-bin.repository.ts` **hard-code** `employeeProfiles`. Vì vậy DB-1 không có chỗ nào để UNION-ADD.
> ⚠️ Hệ quả cho **BE-1**: «thùng rác bài viết» của SPEC-16 §13.1/§16 **không** tự động có — nó phải là **màn riêng của SOCIAL** (đường khôi phục dựng trong module SOCIAL), hoặc một WO riêng mở rộng recycle-bin thành registry. `done_when` của `S16-SOCIAL-BE-1` («recycle-bin khôi phục trả lại đủ») cần đọc theo nghĩa đó.

### 3.3 Bảng dùng lại — không tạo mới

`companies` · `users` · `employees` · `org_units` · `files` · `file_links` · `audit_logs` · `user_preferences` · `notification_*` (outbox) · `system_jobs`.

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 19 bảng, policy literal-GUC mẫu `0479`/`0549`; tạo policy **TRƯỚC** mọi INSERT (BẤT BIẾN 1); đăng ký `rls-registry` và `cleanupTenants`.
2. **Composite tenant FK** `(company_id, x_id) REFERENCES t (company_id, id)` cho **mọi** FK chéo bảng nghiệp vụ (mẫu `0535`/`0549`; bảng đích phải có `UNIQUE (company_id, id)`). **FK về `users` CŨNG composite** — FK một cột giữa hai bảng có `company_id` làm `xtenant-fk-ratchet` ĐỎ (khuôn DB-15 §4.2; sàn `FK_SINGLE_COL_PAIRS_FLOOR` **không hạ**).

   **2a. Bảng ĐÍCH ngoài module — trạng thái ĐO ngày 18/09/2026 (KHÔNG suy diễn):**

   | Đích (tên thiết kế) | Tên THẬT trong code     | `UNIQUE (company_id, id)` | Nguồn                                                                                |
   | ------------------- | ----------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
   | `users`             | `users`                 | ✅ đã có                  | `0535` (danh sách 63 bảng)                                                           |
   | `org_units`         | `org_units`             | ✅ đã có                  | `0535`                                                                               |
   | `files`             | `files`                 | ✅ đã có                  | `0535`                                                                               |
   | **`employees`**     | **`employee_profiles`** | ✅ đã có                  | `0535` — tiền lệ DB-15 §4.2 ghi rõ «`employees`/`employee_profiles` đã có từ `0535`» |

   > ⚠️ **KHÔNG có bảng tên `employees` trong code** — HR dùng **`employee_profiles`** (lệch tên đã ghi ở [erd-current Phụ lục A2](../erd-current.md); tiền lệ [DB-15](<DB-15 ASSET Database Design.md>) §4.2/§6 đã ship dùng đúng cách này). Vì vậy: văn bản thiết kế viết `employees`, **SQL migration viết `employee_profiles`**, và **KHÔNG cần `ALTER TABLE … ADD CONSTRAINT` nào** cho bốn đích trên — cả bốn đã đủ điều kiện từ `0535`. Năm cột chịu luật này: `feed_posts.author_employee_id` · `feed_comments.author_employee_id` · `feed_mentions.mentioned_employee_id` · `feed_group_members.employee_id` · `feed_kudos_recipients.employee_id`.

   **2b. Luật còn lại:**
   - `company_id` của cả 19 bảng: `REFERENCES companies (id) ON DELETE CASCADE` — teardown `DELETE FROM companies` dọn được.
   - **Composite FK nội bộ: `ON DELETE NO ACTION`, TUYỆT ĐỐI KHÔNG `RESTRICT`** — cascade từ `companies` xoá các bảng anh em theo thứ tự bất định (bài học `cleanupTenants` đỏ hàng loạt, DB-15 §4.2).
   - **FK về `users` — danh sách ĐÓNG, chia theo tính NULL của cột** (verify đếm đúng-bằng ở §9):

   | Nhóm                                | Cột                                                                                                                                                                                                               | RI action                                               | Vì sao                                                                                                                                                                                                                                                                                  |
   | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Cột **NOT NULL** (chủ thể của hàng) | `feed_posts.author_user_id` · `feed_comments.author_user_id` · `feed_reports.reporter_user_id` · `feed_reactions.user_id` · `feed_saved_posts.user_id` · `feed_poll_votes.user_id` · `feed_group_members.user_id` | **`NO ACTION`**                                         | `SET NULL` trên cột NOT NULL **nổ lúc DELETE** (`null value in column … violates not-null constraint`) — đúng kịch bản `companies` CASCADE xoá `users` **trước** `feed_posts` ⇒ teardown lane DB đỏ hàng loạt. Xoá user là việc của soft-delete AUTH, không được biến hàng thành vô chủ |
   | Cột **nullable** (vết kiểm toán)    | `feed_posts`/`feed_comments`/`feed_groups` (`created_by`, `updated_by`, `deleted_by`) · `feed_reports.resolved_by` · `feed_ideas.reviewed_by` · `feed_kudos_badges` (`created_by`, `updated_by`)                  | **`SET NULL (<cột>)`** (liệt kê cột — khuôn `0535:682`) | Cột vốn nullable; mất người thao tác không làm hỏng hàng                                                                                                                                                                                                                                |
   | Bảng **chỉ-INSERT**                 | `feed_post_views.user_id` · `feed_post_acks.user_id` · `feed_mentions.mentioned_user_id`                                                                                                                          | **`NO ACTION`**                                         | RI action chạy ở tầng owner; `SET NULL` ghi đè cột **không có grant UPDATE** (đính chính `0549`, BẤT BIẾN 2)                                                                                                                                                                            |

   > **Luật một dòng cho DB-1/DB-2:** `SET NULL` **chỉ** đặt lên cột nullable. Cột NOT NULL luôn `NO ACTION`.
   >
   > ⚖️ **Bảng cột ở §6.x/§7.x phải KHỚP bảng này. Lệch thì BẢNG NÀY THẮNG.** DB-1/DB-2 viết DDL theo bảng cột của từng bảng (đó là nơi có tên cột), nên một ô ghi chú lạc hậu ở §6.x đủ để tái tạo đúng lỗi mà luật này sinh ra để chặn.

3. **Append-only** (app role `GRANT SELECT, INSERT`, **không** UPDATE/DELETE — BẤT BIẾN 2): `feed_post_views` · `feed_post_acks`. `mediaos_worker` nhận `SELECT` theo KHUÔN `0549`/`0552` trên các bảng mà job đóng bình chọn cần đọc (`feed_polls`, `feed_poll_options`, `feed_poll_votes`, `feed_posts`).
4. **FSM ép ở service, DB chỉ CHECK tập giá trị** + UNIQUE/partial-unique làm chốt cuối (phiếu đôi · thích đôi · ack đôi · lưu đôi).
5. **Hợp đồng Zod mirror CHECK HAI CHIỀU, ĐÚNG BẰNG** (`packages/contracts/src/social/feed*.ts`) — không chặt hơn, không lỏng hơn; export prefix `feed*` để không đụng barrel park (`contracts-barrel-collides-with-parked-media`, bẫy TS2308).
6. UUID PK `gen_random_uuid()`, timestamptz UTC, soft delete `deleted_at` ở `feed_posts` · `feed_comments` · `feed_groups` — theo DB-01.
   - **Miễn trừ có chủ ý — 7 bảng quan hệ KHÔNG có cột `id`**, dùng **PK tổ hợp**: `feed_post_tags` · `feed_saved_posts` · `feed_post_views` · `feed_post_acks` · `feed_group_members` · `feed_poll_votes` · `feed_kudos_recipients`. Chúng là quan hệ n-n hoặc sổ theo cặp, PK tổ hợp **chính là** ràng buộc chống trùng. DB-1/DB-2 phải **đo** rằng `rls-registry`, `RetentionService.PROTECTED_TABLES`, recycle-bin và audit **không giả định** có cột `id` trước khi đăng ký — nếu có chỗ giả định, thêm `id` cho bảng đó thay vì sửa hạ tầng.
7. **Bộ đếm denormalized** (`like_count` · `comment_count` · `view_count`) cập nhật **trong cùng transaction** với hàng nguồn, **không** trigger đồng bộ (trigger đóng băng là bẫy `frozen-table-triggers-break-db-init`).
8. **Membership nhóm KHÔNG phải cặp quyền** — là hàng `feed_group_members.role`; RLS không biết membership, service phải lọc trong SQL (SPEC-16 §3.4).

### 4.9 Bảng GRANT — đủ 19/19 bảng (app role)

| Bảng                    | SELECT | INSERT | UPDATE | DELETE | Ghi chú                                                   |
| ----------------------- | :----: | :----: | :----: | :----: | --------------------------------------------------------- |
| `feed_posts`            |  YES   |  YES   |  YES   |   no   | soft delete                                               |
| `feed_comments`         |  YES   |  YES   |  YES   |   no   | soft delete                                               |
| `feed_reactions`        |  YES   |  YES   |  YES   |  YES   | đổi emoji = UPDATE; bỏ thích = DELETE                     |
| `feed_mentions`         |  YES   |  YES   |   no   |  YES   | sửa bài ⇒ đồng bộ lại tập mention (DELETE + INSERT)       |
| `feed_tags`             |  YES   |  YES   |  YES   |   no   | `usage_count` UPDATE; từ điển không xoá                   |
| `feed_post_tags`        |  YES   |  YES   |   no   |  YES   | nối bài↔thẻ; sửa bài ⇒ gán lại                            |
| `feed_saved_posts`      |  YES   |  YES   |   no   |  YES   | bỏ lưu = DELETE (tương tác cá nhân, không phải sổ)        |
| `feed_post_views`       |  YES   |  YES   |   no   |   no   | **append-only**                                           |
| `feed_post_acks`        |  YES   |  YES   |   no   |   no   | **append-only**                                           |
| `feed_reports`          |  YES   |  YES   |  YES   |   no   | xử lý = UPDATE `status`                                   |
| `feed_groups`           |  YES   |  YES   |  YES   |   no   | soft delete                                               |
| `feed_group_members`    |  YES   |  YES   |  YES   |  YES   | xem quyết định dưới bảng                                  |
| `feed_polls`            |  YES   |  YES   |  YES   |   no   | đóng = UPDATE                                             |
| `feed_poll_options`     |  YES   |  YES   |  YES   |   no   | `vote_count` UPDATE; lựa chọn bất biến sau khi tạo (§7.4) |
| `feed_poll_votes`       |  YES   |  YES   |   no   |  YES   | đổi/rút phiếu khi poll còn `open`                         |
| `feed_ideas`            |  YES   |  YES   |  YES   |   no   | FSM = UPDATE                                              |
| `feed_kudos`            |  YES   |  YES   |  YES   |   no   |                                                           |
| `feed_kudos_recipients` |  YES   |  YES   |   no   |  YES   | sửa bài kudos ⇒ gán lại người nhận                        |
| `feed_kudos_badges`     |  YES   |  YES   |  YES   |   no   | xoá = tắt `is_active`, **không** hard-delete              |

> **Quyết định `feed_group_members` — DELETE CỨNG, có chủ ý.** Membership **không phải sổ kiểm toán**: nó là trạng thái hiện tại của quan hệ người↔nhóm. Rời nhóm / bị mời ra ⇒ xoá hàng, và **vết nằm ở `audit_logs`** (`object_type='feed_group'`), không ở bảng quan hệ. Không thêm `status='removed'` vì sẽ bắt mọi truy vấn membership (đường nóng nhất của module — §7.2) mang thêm một vị từ, và làm UNIQUE mất tác dụng chống xin-vào-lại. `SOCIAL-API-039` ghi audit bắt buộc.

---

## 5. ERD cấp module

```text
employees/users ─1─n feed_posts ─0..1─ org_units (audience='org_unit')
                                └─0..1─ feed_groups (audience='group')
feed_posts 1─n feed_comments (1 cấp: parent_comment_id → feed_comments WHERE parent IS NULL)
feed_posts 1─n feed_post_views   (append-only, UNIQUE post×user)
feed_posts 1─n feed_post_acks    (append-only, UNIQUE post×user — chỉ bài type='news')
feed_posts 1─n feed_saved_posts  (UNIQUE user×post)
feed_posts 1─n feed_post_tags n─1 feed_tags
feed_posts 1─n feed_mentions     (target_type = post|comment)
feed_posts 1─n feed_reactions    (target_type = post|comment, UNIQUE target×user)
feed_posts 1─n feed_reports      (target_type = post|comment — đa hình, như feed_reactions)
feed_comments ─n feed_reports    n─0..1 users (resolved_by)

feed_groups 1─n feed_group_members (role hàng: owner|admin|member; status active|pending)
feed_posts  1─0..1 feed_polls  1─n feed_poll_options 1─n feed_poll_votes
feed_posts  1─0..1 feed_ideas  (FSM + reviewed_by/at/note)
feed_posts  1─0..1 feed_kudos  1─n feed_kudos_recipients n─1 employees
feed_kudos  n─0..1 feed_kudos_badges (catalog)
```

---

## 6. Chi tiết bảng — Track A

### 6.1 Bảng `feed_posts`

| Cột                                             | Kiểu        | Bắt buộc | Ghi chú                                                                                                                                               |
| ----------------------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                            | UUID        | Có       | PK                                                                                                                                                    |
| `company_id`                                    | UUID        | Có       | FK `companies.id` CASCADE, RLS                                                                                                                        |
| `author_user_id`                                | UUID        | Có       | composite FK → `users (company_id, id)` **`ON DELETE NO ACTION`** — cột NOT NULL, `SET NULL` sẽ nổ lúc teardown (§4.2b)                               |
| `author_employee_id`                            | UUID        | Không    | composite FK → `employees (company_id, id)` NO ACTION — hiển thị tên/avatar                                                                           |
| `type`                                          | VARCHAR(16) | Có       | `share`/`news`/`idea`/`poll`/`kudos`                                                                                                                  |
| `audience`                                      | VARCHAR(16) | Có       | `company`/`group`/`org_unit`, default `company`                                                                                                       |
| `group_id`                                      | UUID        | Không    | composite FK → `feed_groups (company_id, id)` NO ACTION — ⚠️ **DB-1 tạo cột KHÔNG kèm FK**, xem ghi chú «FK hoãn» dưới bảng index                     |
| `org_unit_id`                                   | UUID        | Không    | composite FK → `org_units (company_id, id)` NO ACTION                                                                                                 |
| `body`                                          | TEXT        | Không    | nội dung; CHECK độ dài ≤ 20000. **Nullable** vì bài `poll` mang nội dung ở `feed_polls.question`, `kudos` ở `feed_kudos.message` — xem CHECK kéo theo |
| `status`                                        | VARCHAR(16) | Có       | `published`/`hidden`/`deleted` (SPEC-01 §17.18), default `published`                                                                                  |
| `pinned`                                        | BOOLEAN     | Có       | default `false` — chỉ bài `news` được ghim                                                                                                            |
| `comments_locked`                               | BOOLEAN     | Có       | default `false`                                                                                                                                       |
| `requires_ack`                                  | BOOLEAN     | Có       | default `false` — chỉ bài `news`                                                                                                                      |
| `like_count`                                    | INTEGER     | Có       | default 0, CHECK ≥ 0                                                                                                                                  |
| `comment_count`                                 | INTEGER     | Có       | default 0, CHECK ≥ 0                                                                                                                                  |
| `view_count`                                    | INTEGER     | Có       | default 0, CHECK ≥ 0                                                                                                                                  |
| `published_at`                                  | TIMESTAMPTZ | Có       | default `now()` — **mốc sắp xếp «Mới đăng»**; set 1 lần lúc tạo, **KHÔNG** đổi khi sửa bài                                                            |
| `last_activity_at`                              | TIMESTAMPTZ | Có       | default `now()` — **mốc sắp xếp «Hoạt động mới»**; xem luật bump dưới                                                                                 |
| `search_vector`                                 | TSVECTOR    | Có       | **cột sinh** — xem §6.1b                                                                                                                              |
| `edited_at`                                     | TIMESTAMPTZ | Không    | set khi sửa nội dung ⇒ FE hiện nhãn «đã chỉnh sửa»                                                                                                    |
| `created_at/by` `updated_at/by` `deleted_at/by` |             |          | chuẩn chung, soft delete                                                                                                                              |

```sql
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_type     CHECK (type IN ('share','news','idea','poll','kudos'));
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience CHECK (audience IN ('company','group','org_unit'));
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_status   CHECK (status IN ('published','hidden','deleted'));

-- CHECK CẶP: phạm vi kéo theo khoá ngoại tương ứng (dạng kéo theo, KHÔNG vế "IS NULL OR" rỗng)
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience_group
  CHECK (audience <> 'group'    OR group_id    IS NOT NULL);
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience_org
  CHECK (audience <> 'org_unit' OR org_unit_id IS NOT NULL);
-- chiều ngược: mỗi phạm vi CHỈ mang đúng khoá của nó — hai khoá loại trừ nhau
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience_company
  CHECK (audience <> 'company'  OR (group_id IS NULL AND org_unit_id IS NULL));
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience_group_excl
  CHECK (audience <> 'group'    OR org_unit_id IS NULL);
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_audience_org_excl
  CHECK (audience <> 'org_unit' OR group_id    IS NULL);

-- ghim và yêu cầu xác nhận đọc CHỈ dành cho bài tin tức
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_pinned_news
  CHECK (pinned = false OR type = 'news');
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_ack_news
  CHECK (requires_ack = false OR type = 'news');

-- ba loại bài kể chuyện bằng body; poll/kudos có nội dung ở bảng con
ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_body_required
  CHECK (type IN ('poll','kudos') OR (body IS NOT NULL AND length(btrim(body)) > 0));

ALTER TABLE feed_posts ADD CONSTRAINT chk_feed_posts_counts
  CHECK (like_count >= 0 AND comment_count >= 0 AND view_count >= 0);
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_company_id_id_uq UNIQUE (company_id, id);
```

```sql
-- feed công ty: bài mới nhất / hoạt động mới nhất
CREATE INDEX idx_feed_posts_company_created ON feed_posts (company_id, created_at DESC)
  WHERE deleted_at IS NULL AND status = 'published';
CREATE INDEX idx_feed_posts_company_group   ON feed_posts (company_id, group_id, created_at DESC)
  WHERE deleted_at IS NULL AND group_id IS NOT NULL;
CREATE INDEX idx_feed_posts_company_org     ON feed_posts (company_id, org_unit_id, created_at DESC)
  WHERE deleted_at IS NULL AND org_unit_id IS NOT NULL;
CREATE INDEX idx_feed_posts_company_type    ON feed_posts (company_id, type, created_at DESC)
  WHERE deleted_at IS NULL;
-- tin ghim
CREATE INDEX idx_feed_posts_company_pinned  ON feed_posts (company_id, created_at DESC)
  WHERE deleted_at IS NULL AND pinned = true;
-- trang cá nhân
CREATE INDEX idx_feed_posts_company_author  ON feed_posts (company_id, author_user_id, created_at DESC)
  WHERE deleted_at IS NULL;
-- tìm kiếm toàn văn
CREATE INDEX idx_feed_posts_search ON feed_posts USING GIN (search_vector);

-- phân trang KEYSET của SOCIAL-API-001 (sắp xếp `latest` | `active`) — S16-SOCIAL-DB-1 §0.5
CREATE INDEX idx_feed_posts_company_activity ON feed_posts (company_id, last_activity_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
CREATE INDEX idx_feed_posts_company_published ON feed_posts (company_id, published_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
```

GRANT app role: `SELECT, INSERT, UPDATE`. **Không** `DELETE` (soft delete).

> 🔴 **FK `group_id` HOÃN sang DB-2 — ngoại lệ DUY NHẤT của luật «mọi FK mới kèm composite tenant-FK».**
> `feed_groups` thuộc Track B nên lúc `S16-SOCIAL-DB-1` chạy nó **chưa tồn tại**; migration `0577` vì thế tạo `group_id uuid NULL` **không kèm FK**, nhưng **giữ đủ 5 CHECK cặp** `audience` ở trên.
> **`S16-SOCIAL-DB-2` BẮT BUỘC thêm** (additive, không rewrite bảng):
>
> ```sql
> ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_group_fk
>   FOREIGN KEY (company_id, group_id) REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION;
> ```
>
> Nợ này **không** dựa vào ai đọc ghi chú: `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts` có assert **TỰ LÊN NÒNG** — `to_regclass('feed_groups') IS NULL` ⇒ khẳng định 0 FK (nợ còn hạn); khác NULL mà FK chưa có ⇒ **spec ĐỎ**. Cộng một assert rẻ: `count(*) WHERE audience='group' AND group_id IS NOT NULL` = 0 chừng nào FK chưa có (bắt hàng mồ côi **trước** khi `ALTER` của DB-2 nổ).

> ⏱️ **Luật «ai bump» hai cột mốc sắp xếp (S16-SOCIAL-DB-1 §0.5) — BE-1 phải theo đúng:**
>
> | Cột                | Ai ghi                                                                                                                                                                                                                               |
> | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | `published_at`     | set **một lần** lúc tạo bài. **KHÔNG** đổi khi sửa nội dung (sửa bài dùng `edited_at`).                                                                                                                                              |
> | `last_activity_at` | service bump **CÙNG TRANSACTION** khi có **bình luận mới** hoặc **reaction mới**. ⚠️ **TUYỆT ĐỐI KHÔNG** bump theo `feed_post_views` — bump là biến «Hoạt động mới» thành «vừa có người xem», và `view_count` tăng ở mọi lần mở bài. |
>
> Vì sao hai cột này nằm ở DB-1 chứ không ở BE-1: `done_when` của `S16-SOCIAL-BE-1` đòi keyset `(last_activity_at, id)` và `(published_at, id)`, nhưng `paths` của BE-1 **không có** `apps/api/migrations/**` — BE-1 không thể tự thêm cột mà không trip `guard-scope`, và DB-1 là lane migration nối tiếp **duy nhất** của wave. Không cấp ở đây thì BE-1 chỉ còn đường xấu: dùng `updated_at` (bị bump bởi **mọi** lần tăng `view_count`, và không có index) hoặc subquery tương quan `max(comments.created_at)` (không index được, cursor không ổn định).

### 6.1b Cột sinh `search_vector` — ĐO `unaccent` lúc chạy

> ✅ **NỢ ĐO ĐÃ ĐÓNG — CHỐT PHƯƠNG ÁN A (S16-SOCIAL-DB-1, đo 19/09/2026 trên `mediaos` = DB PROD, PG 17.10).**
> `unaccent` **ĐÃ CÀI** (v1.1) ở `mediaos` và mọi lane DB, và **`public.f_unaccent(text)` ĐÃ TỒN TẠI** sẵn `IMMUTABLE PARALLEL SAFE STRICT` — cài bởi `0538_s7chatdb1_chat_v1.sql:363-372` (đã chạy PROD, dùng cho `chat_messages.search_vector`).
> ⇒ Migration `0577` **TÁI DÙNG `public.f_unaccent`**, **KHÔNG** tạo `feed_immutable_unaccent` như gợi ý bên dưới (tạo thêm = tách nguồn sự thật cho cùng một phép bỏ dấu), và **KHÔNG** phát `CREATE EXTENSION`. Khối tiền-kiểm của `0577` **hậu kiểm** hàm tồn tại + `provolatile='i'` rồi mới chạy tiếp (không tin không đo).
>
> ```sql
> ALTER TABLE feed_posts ADD COLUMN search_vector tsvector
>   GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(coalesce(body, '')))) STORED;
> ```
>
> ⚠️ **schema-qualify TUYỆT ĐỐI** (`public.f_unaccent`): cột sinh **neo vào OID hàm**, sai `search_path` lúc migrate là hỏng **VĨNH VIỄN** (phải rewrite bảng để sửa).

Bối cảnh của nợ đo (giữ lại để hiểu vì sao có hai phương án): `unaccent` **có thể không có** trên Postgres PROD và migration **KHÔNG** được `CREATE EXTENSION` mù (cần superuser). Hai phương án đã cân nhắc:

```sql
-- Bước đo (trong migration, không phải bằng tay):
--   SELECT 1 FROM pg_extension WHERE extname = 'unaccent';

-- Phương án A — CÓ unaccent (cần hàm IMMUTABLE bọc lại, vì unaccent() mặc định STABLE
-- nên không dùng trực tiếp trong cột sinh được):
CREATE FUNCTION feed_immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE feed_posts ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('simple', feed_immutable_unaccent(coalesce(body, '')))) STORED;

-- Phương án B — KHÔNG có unaccent:
ALTER TABLE feed_posts ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;
```

> ⚠️ **Bẫy đã biết:** `unaccent(text)` là `STABLE`, không phải `IMMUTABLE` ⇒ dùng thẳng trong `GENERATED ALWAYS AS` sẽ bị Postgres từ chối. Phải bọc bằng hàm IMMUTABLE có chỉ định `regdictionary` như trên.
>
> 🚫 **CHỈ CÓ HAI hình dạng schema — A hoặc B, KHÔNG có nhánh thứ ba.** Cột `search_vector` **LUÔN tồn tại** trên `feed_posts` ở mọi môi trường; A và B chỉ khác **biểu thức sinh**, không khác sự tồn tại của cột. Cấm nhánh «bỏ hẳn cột sinh»: nó đẻ hình dạng schema thứ ba ⇒ drizzle `db:generate` drift, contracts phải `optional` theo môi trường, PROD lệch dev (lớp bẫy «PROD lệch 3 chiều»). Nếu chất lượng tìm kiếm không đạt, **fallback `ILIKE` là quyết định ở tầng SERVICE** (SPEC-16 §13.5) — DDL không đổi.

### 6.2 Bảng `feed_comments`

| Cột                                             | Kiểu        | Bắt buộc | Ghi chú                                                                               |
| ----------------------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------- |
| `id`                                            | UUID        | Có       | PK                                                                                    |
| `company_id`                                    | UUID        | Có       | CASCADE, RLS                                                                          |
| `post_id`                                       | UUID        | Có       | composite FK → `feed_posts (company_id, id)` NO ACTION                                |
| `parent_comment_id`                             | UUID        | Không    | composite FK → `feed_comments (company_id, id)` NO ACTION — **chỉ trỏ bình luận gốc** |
| `author_user_id`                                | UUID        | Có       | composite FK → `users`, **`ON DELETE NO ACTION`** — cột NOT NULL (§4.2b)              |
| `author_employee_id`                            | UUID        | Không    | composite FK → `employees` NO ACTION                                                  |
| `body`                                          | TEXT        | Có       | CHECK độ dài ≤ 5000                                                                   |
| `like_count`                                    | INTEGER     | Có       | default 0, CHECK ≥ 0                                                                  |
| `edited_at`                                     | TIMESTAMPTZ | Không    |                                                                                       |
| `created_at/by` `updated_at/by` `deleted_at/by` |             |          | soft delete                                                                           |

```sql
ALTER TABLE feed_comments ADD CONSTRAINT feed_comments_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE feed_comments ADD CONSTRAINT chk_feed_comments_like_count CHECK (like_count >= 0);
CREATE INDEX idx_feed_comments_company_post ON feed_comments (company_id, post_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_feed_comments_company_parent ON feed_comments (company_id, parent_comment_id)
  WHERE deleted_at IS NULL AND parent_comment_id IS NOT NULL;
```

> **Một cấp trả lời ép ở SERVICE, không ở DB.** CHECK cấp hàng không nhìn được hàng cha, và trigger là bẫy đóng băng (§4.7). Service kiểm `parent.parent_comment_id IS NULL` trong cùng tx ⇒ `SOCIAL-ERR-005`.

GRANT app role: `SELECT, INSERT, UPDATE`. Không `DELETE`.

### 6.3 Bảng `feed_reactions`

Dùng cho **cả** bài và bình luận — một bảng, phân biệt bằng `target_type` (SOC-DEC-008).

| Cột                       | Kiểu        | Bắt buộc | Ghi chú                                                                             |
| ------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------- |
| `id`                      | UUID        | Có       | PK                                                                                  |
| `company_id`              | UUID        | Có       | CASCADE, RLS                                                                        |
| `target_type`             | VARCHAR(16) | Có       | `post`/`comment`                                                                    |
| `target_id`               | UUID        | Có       | **không** FK đơn — xem ghi chú dưới                                                 |
| `user_id`                 | UUID        | Có       | composite FK → `users` NO ACTION — luôn = actor                                     |
| `emoji`                   | VARCHAR(32) | Có       | thuộc **bộ emoji CHAT** — ép ở Zod/service, **KHÔNG CHECK ở DB** (xem ghi chú dưới) |
| `created_at` `updated_at` |             |          | đổi emoji ⇒ UPDATE tại chỗ                                                          |

```sql
ALTER TABLE feed_reactions ADD CONSTRAINT chk_feed_reactions_target
  CHECK (target_type IN ('post','comment'));
ALTER TABLE feed_reactions ADD CONSTRAINT feed_reactions_target_user_uq
  UNIQUE (company_id, target_type, target_id, user_id);
CREATE INDEX idx_feed_reactions_company_target ON feed_reactions (company_id, target_type, target_id);
```

> **Vì sao KHÔNG có CHECK trên `emoji` — quyết định tường minh.** Nguồn sự thật của bộ emoji là hằng dùng chung với CHAT (`chat-reactions.emoji-set`) ở tầng app (SOC-DEC-008). Sao chép tập đó vào một CHECK là **đẻ nguồn sự thật thứ hai**: CHAT đổi bộ emoji ⇒ CHECK cũ lặng lẽ chặn reaction hợp lệ, và phải sinh một migration UNION-ADD chỉ để đuổi theo một hằng TypeScript. Vì vậy `emoji` **validate ở Zod + service** ⇒ `SOCIAL-ERR-006`; DB không ràng buộc. Đánh đổi đã cân nhắc: một INSERT đi vòng qua service có thể ghi emoji lạ — chấp nhận được vì đây không phải dữ liệu nhạy cảm và không có đường ghi nào ngoài service.

> **Vì sao `target_id` không có FK:** đích là hai bảng khác nhau (`feed_posts` / `feed_comments`), Postgres không có FK đa hình. Toàn vẹn ép ở service + ca test; dọn hàng mồ côi đi theo xoá mềm bài/bình luận trong cùng tx (§8.3). Đây là **đánh đổi có chủ ý**, chép đúng khuôn `chat_message_reactions` của DB-12.

GRANT app role: `SELECT, INSERT, UPDATE, DELETE` (bỏ thích).

### 6.4 Bảng `feed_mentions`

Bảng **THẬT** — không lặp lại nợ `task_comment_mentions` (SOC-DEC-008).

| Cột                     | Kiểu        | Bắt buộc | Ghi chú                                                       |
| ----------------------- | ----------- | -------- | ------------------------------------------------------------- |
| `id`                    | UUID        | Có       | PK                                                            |
| `company_id`            | UUID        | Có       | CASCADE, RLS                                                  |
| `target_type`           | VARCHAR(16) | Có       | `post`/`comment`                                              |
| `target_id`             | UUID        | Có       | đa hình như §6.3                                              |
| `mentioned_user_id`     | UUID        | Có       | composite FK → `users` **NO ACTION** (bảng chỉ-INSERT/DELETE) |
| `mentioned_employee_id` | UUID        | Không    | composite FK → `employees` NO ACTION                          |
| `created_at`            |             |          |                                                               |

```sql
ALTER TABLE feed_mentions ADD CONSTRAINT chk_feed_mentions_target CHECK (target_type IN ('post','comment'));
ALTER TABLE feed_mentions ADD CONSTRAINT feed_mentions_uq
  UNIQUE (company_id, target_type, target_id, mentioned_user_id);
CREATE INDEX idx_feed_mentions_company_user ON feed_mentions (company_id, mentioned_user_id, created_at DESC);
```

GRANT app role: `SELECT, INSERT, DELETE` (sửa bài ⇒ đồng bộ lại tập mention trong cùng tx).

### 6.5 Bảng `feed_tags`

| Cột           | Kiểu        | Bắt buộc | Ghi chú                         |
| ------------- | ----------- | -------- | ------------------------------- |
| `id`          | UUID        | Có       | PK                              |
| `company_id`  | UUID        | Có       | CASCADE, RLS                    |
| `tag`         | VARCHAR(64) | Có       | đã chuẩn hoá: lowercase, bỏ `#` |
| `usage_count` | INTEGER     | Có       | default 0, CHECK ≥ 0            |
| `created_at`  |             |          |                                 |

```sql
ALTER TABLE feed_tags ADD CONSTRAINT feed_tags_company_tag_uq UNIQUE (company_id, tag);
ALTER TABLE feed_tags ADD CONSTRAINT feed_tags_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE feed_tags ADD CONSTRAINT chk_feed_tags_usage CHECK (usage_count >= 0);
CREATE INDEX idx_feed_tags_company_usage ON feed_tags (company_id, usage_count DESC);
```

### 6.6 Bảng `feed_post_tags`

| Cột          | Kiểu | Bắt buộc | Ghi chú                               |
| ------------ | ---- | -------- | ------------------------------------- |
| `company_id` | UUID | Có       | CASCADE, RLS                          |
| `post_id`    | UUID | Có       | composite FK → `feed_posts` NO ACTION |
| `tag_id`     | UUID | Có       | composite FK → `feed_tags` NO ACTION  |

```sql
ALTER TABLE feed_post_tags ADD CONSTRAINT feed_post_tags_pk PRIMARY KEY (company_id, post_id, tag_id);
CREATE INDEX idx_feed_post_tags_company_tag ON feed_post_tags (company_id, tag_id);
```

GRANT app role: `SELECT, INSERT, DELETE`.

### 6.7 Bảng `feed_saved_posts`

| Cột          | Kiểu | Bắt buộc | Ghi chú                                         |
| ------------ | ---- | -------- | ----------------------------------------------- |
| `company_id` | UUID | Có       | CASCADE, RLS                                    |
| `user_id`    | UUID | Có       | composite FK → `users` NO ACTION — luôn = actor |
| `post_id`    | UUID | Có       | composite FK → `feed_posts` NO ACTION           |
| `created_at` |      |          |                                                 |

```sql
ALTER TABLE feed_saved_posts ADD CONSTRAINT feed_saved_posts_pk PRIMARY KEY (company_id, user_id, post_id);
CREATE INDEX idx_feed_saved_posts_company_user ON feed_saved_posts (company_id, user_id, created_at DESC);
```

GRANT app role: `SELECT, INSERT, DELETE`.

### 6.8 Bảng `feed_post_views` — **append-only**

| Cột          | Kiểu        | Bắt buộc | Ghi chú                                            |
| ------------ | ----------- | -------- | -------------------------------------------------- |
| `company_id` | UUID        | Có       | CASCADE, RLS                                       |
| `post_id`    | UUID        | Có       | composite FK → `feed_posts` NO ACTION              |
| `user_id`    | UUID        | Có       | composite FK → `users` **NO ACTION** (append-only) |
| `viewed_at`  | TIMESTAMPTZ | Có       | default `now()`                                    |

```sql
ALTER TABLE feed_post_views ADD CONSTRAINT feed_post_views_pk PRIMARY KEY (company_id, post_id, user_id);
CREATE INDEX idx_feed_post_views_company_post ON feed_post_views (company_id, post_id);
```

GRANT app role: **`SELECT, INSERT`** — không UPDATE/DELETE (BẤT BIẾN 2). Ghi bằng `ON CONFLICT DO NOTHING` ⇒ reload **không** tăng `view_count`.

### 6.9 Bảng `feed_post_acks` — **append-only**

| Cột          | Kiểu        | Bắt buộc | Ghi chú                               |
| ------------ | ----------- | -------- | ------------------------------------- |
| `company_id` | UUID        | Có       | CASCADE, RLS                          |
| `post_id`    | UUID        | Có       | composite FK → `feed_posts` NO ACTION |
| `user_id`    | UUID        | Có       | composite FK → `users` **NO ACTION**  |
| `acked_at`   | TIMESTAMPTZ | Có       | default `now()`                       |

```sql
ALTER TABLE feed_post_acks ADD CONSTRAINT feed_post_acks_pk PRIMARY KEY (company_id, post_id, user_id);
CREATE INDEX idx_feed_post_acks_company_post ON feed_post_acks (company_id, post_id);
```

GRANT app role: **`SELECT, INSERT`**. Xác nhận đã đọc là **vết không rút lại được** — đúng nghĩa nghiệp vụ.

### 6.10 Bảng `feed_reports`

| Cột                       | Kiểu        | Bắt buộc | Ghi chú                                                                  |
| ------------------------- | ----------- | -------- | ------------------------------------------------------------------------ |
| `id`                      | UUID        | Có       | PK                                                                       |
| `company_id`              | UUID        | Có       | CASCADE, RLS                                                             |
| `target_type`             | VARCHAR(16) | Có       | `post`/`comment`                                                         |
| `target_id`               | UUID        | Có       | đa hình như §6.3                                                         |
| `reporter_user_id`        | UUID        | Có       | composite FK → `users`, **`ON DELETE NO ACTION`** — cột NOT NULL (§4.2b) |
| `reason`                  | VARCHAR(32) | Có       | `spam`/`harassment`/`inappropriate`/`misinformation`/`other`             |
| `note`                    | TEXT        | Không    |                                                                          |
| `status`                  | VARCHAR(16) | Có       | `open`/`resolved`/`dismissed`, default `open`                            |
| `resolved_by`             | UUID        | Không    | composite FK → `users`, `SET NULL (resolved_by)`                         |
| `resolved_at`             | TIMESTAMPTZ | Không    |                                                                          |
| `resolution_note`         | TEXT        | Không    |                                                                          |
| `created_at` `updated_at` |             |          |                                                                          |

```sql
ALTER TABLE feed_reports ADD CONSTRAINT chk_feed_reports_target CHECK (target_type IN ('post','comment'));
ALTER TABLE feed_reports ADD CONSTRAINT chk_feed_reports_reason
  CHECK (reason IN ('spam','harassment','inappropriate','misinformation','other'));
ALTER TABLE feed_reports ADD CONSTRAINT chk_feed_reports_status CHECK (status IN ('open','resolved','dismissed'));
-- đã xử lý thì phải có người xử lý và mốc thời gian (CHECK cặp dạng kéo theo)
ALTER TABLE feed_reports ADD CONSTRAINT chk_feed_reports_resolved_pair
  CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL));
ALTER TABLE feed_reports ADD CONSTRAINT feed_reports_company_id_id_uq UNIQUE (company_id, id);
-- một người báo cáo một đối tượng một lần khi còn 'open'
CREATE UNIQUE INDEX feed_reports_open_uq ON feed_reports (company_id, target_type, target_id, reporter_user_id)
  WHERE status = 'open';
CREATE INDEX idx_feed_reports_company_status ON feed_reports (company_id, status, created_at DESC);
```

GRANT app role: `SELECT, INSERT, UPDATE`.

---

## 7. Chi tiết bảng — Track B

### 7.1 Bảng `feed_groups`

| Cột                                             | Kiểu         | Bắt buộc | Ghi chú                          |
| ----------------------------------------------- | ------------ | -------- | -------------------------------- |
| `id`                                            | UUID         | Có       | PK                               |
| `company_id`                                    | UUID         | Có       | CASCADE, RLS                     |
| `name`                                          | VARCHAR(255) | Có       |                                  |
| `description`                                   | TEXT         | Không    |                                  |
| `visibility`                                    | VARCHAR(16)  | Có       | `public`/`private`               |
| `avatar_file_id`                                | UUID         | Không    | composite FK → `files` NO ACTION |
| `member_count`                                  | INTEGER      | Có       | default 0, CHECK ≥ 0             |
| `created_at/by` `updated_at/by` `deleted_at/by` |              |          | soft delete                      |

```sql
ALTER TABLE feed_groups ADD CONSTRAINT chk_feed_groups_visibility CHECK (visibility IN ('public','private'));
ALTER TABLE feed_groups ADD CONSTRAINT chk_feed_groups_member_count CHECK (member_count >= 0);
ALTER TABLE feed_groups ADD CONSTRAINT feed_groups_company_id_id_uq UNIQUE (company_id, id);
CREATE UNIQUE INDEX feed_groups_company_name_uq ON feed_groups (company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_feed_groups_company_visibility ON feed_groups (company_id, visibility) WHERE deleted_at IS NULL;
```

### 7.2 Bảng `feed_group_members`

**Vai trò là HÀNG, không phải cặp quyền** (SOC-DEC-006, khuôn per-project role của DECISIONS-04).

| Cột                       | Kiểu        | Bắt buộc | Ghi chú                                                                                                                                                        |
| ------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company_id`              | UUID        | Có       | CASCADE, RLS                                                                                                                                                   |
| `group_id`                | UUID        | Có       | composite FK → `feed_groups` NO ACTION                                                                                                                         |
| `user_id`                 | UUID        | Có       | composite FK → `users` NO ACTION                                                                                                                               |
| `employee_id`             | UUID        | Không    | composite FK → `employees` NO ACTION                                                                                                                           |
| `role`                    | VARCHAR(16) | Có       | `owner`/`admin`/`member`                                                                                                                                       |
| `status`                  | VARCHAR(16) | Có       | `active`/`pending` — **`DEFAULT 'pending'`**; service set `active` cho nhóm `public` và cho người tạo nhóm (DEFAULT của Postgres **không** đọc được bảng khác) |
| `joined_at`               | TIMESTAMPTZ | Không    | set khi `status` thành `active`                                                                                                                                |
| `created_at` `updated_at` |             |          |                                                                                                                                                                |

```sql
ALTER TABLE feed_group_members ADD CONSTRAINT feed_group_members_pk PRIMARY KEY (company_id, group_id, user_id);
ALTER TABLE feed_group_members ADD CONSTRAINT chk_feed_group_members_role   CHECK (role IN ('owner','admin','member'));
ALTER TABLE feed_group_members ADD CONSTRAINT chk_feed_group_members_status CHECK (status IN ('active','pending'));
-- thành viên đang chờ duyệt KHÔNG được mang vai trò quản trị nhóm
ALTER TABLE feed_group_members ADD CONSTRAINT chk_feed_group_members_pending_role
  CHECK (status = 'active' OR role = 'member');
-- mỗi nhóm luôn có ĐÚNG >= 1 owner: ép ở service (SOCIAL-ERR-015), DB chỉ hỗ trợ đếm nhanh
CREATE INDEX idx_feed_group_members_company_group_role ON feed_group_members (company_id, group_id, role)
  WHERE status = 'active';
CREATE INDEX idx_feed_group_members_company_user ON feed_group_members (company_id, user_id, status);
```

> `idx_feed_group_members_company_user` là index **nóng nhất** của module: mọi truy vấn feed có bài nhóm đều nối qua nó để lọc membership trong SQL (SPEC-16 §3.4).

### 7.3 Bảng `feed_polls`

| Cột                       | Kiểu         | Bắt buộc | Ghi chú                                                                       |
| ------------------------- | ------------ | -------- | ----------------------------------------------------------------------------- |
| `id`                      | UUID         | Có       | PK                                                                            |
| `company_id`              | UUID         | Có       | CASCADE, RLS                                                                  |
| `post_id`                 | UUID         | Có       | composite FK → `feed_posts` NO ACTION, **UNIQUE** (1-1 với bài `type='poll'`) |
| `question`                | VARCHAR(500) | Có       |                                                                               |
| `multiple_choice`         | BOOLEAN      | Có       | default `false`                                                               |
| `is_anonymous`            | BOOLEAN      | Có       | default `false`                                                               |
| `status`                  | VARCHAR(16)  | Có       | `open`/`closed` (SPEC-01 §17.20), default `open`                              |
| `closes_at`               | TIMESTAMPTZ  | Không    | job đóng khi quá hạn                                                          |
| `closed_at`               | TIMESTAMPTZ  | Không    |                                                                               |
| `created_at` `updated_at` |              |          |                                                                               |

```sql
ALTER TABLE feed_polls ADD CONSTRAINT chk_feed_polls_status CHECK (status IN ('open','closed'));
ALTER TABLE feed_polls ADD CONSTRAINT chk_feed_polls_closed_pair
  CHECK (status = 'open' OR closed_at IS NOT NULL);
ALTER TABLE feed_polls ADD CONSTRAINT feed_polls_company_post_uq UNIQUE (company_id, post_id);
ALTER TABLE feed_polls ADD CONSTRAINT feed_polls_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_feed_polls_open_deadline ON feed_polls (company_id, closes_at)
  WHERE status = 'open' AND closes_at IS NOT NULL;
```

> `idx_feed_polls_open_deadline` phục vụ **job đóng bình chọn** — quét theo hạn, không quét toàn bảng.

### 7.4 Bảng `feed_poll_options`

| Cột          | Kiểu         | Bắt buộc | Ghi chú                               |
| ------------ | ------------ | -------- | ------------------------------------- |
| `id`         | UUID         | Có       | PK                                    |
| `company_id` | UUID         | Có       | CASCADE, RLS                          |
| `poll_id`    | UUID         | Có       | composite FK → `feed_polls` NO ACTION |
| `label`      | VARCHAR(255) | Có       |                                       |
| `position`   | SMALLINT     | Có       | thứ tự hiển thị                       |
| `vote_count` | INTEGER      | Có       | default 0, CHECK ≥ 0                  |

```sql
ALTER TABLE feed_poll_options ADD CONSTRAINT feed_poll_options_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE feed_poll_options ADD CONSTRAINT chk_feed_poll_options_vote_count CHECK (vote_count >= 0);
ALTER TABLE feed_poll_options ADD CONSTRAINT feed_poll_options_position_uq UNIQUE (company_id, poll_id, position);
CREATE INDEX idx_feed_poll_options_company_poll ON feed_poll_options (company_id, poll_id, position);
```

> **Lựa chọn BẤT BIẾN sau khi tạo poll.** `UNIQUE (company_id, poll_id, position)` không `DEFERRABLE`, nên sắp xếp lại bằng một câu UPDATE sẽ va unique giữa chừng. Service không cho sửa/chèn/xoá lựa chọn sau khi poll tồn tại (đi cùng luật `multiple_choice` bất biến ở §7.5).

> **Ràng buộc 2–10 lựa chọn ép ở SERVICE** (`SOCIAL-ERR-018`) — CHECK cấp hàng không đếm được số hàng anh em.

### 7.5 Bảng `feed_poll_votes`

| Cột          | Kiểu | Bắt buộc | Ghi chú                                                       |
| ------------ | ---- | -------- | ------------------------------------------------------------- |
| `company_id` | UUID | Có       | CASCADE, RLS                                                  |
| `poll_id`    | UUID | Có       | composite FK → `feed_polls` NO ACTION                         |
| `option_id`  | UUID | Có       | composite FK → `feed_poll_options` NO ACTION                  |
| `user_id`    | UUID | Có       | composite FK → `users` NO ACTION — **lưu kể cả poll ẩn danh** |
| `created_at` |      |          |                                                               |

```sql
ALTER TABLE feed_poll_votes ADD CONSTRAINT feed_poll_votes_pk PRIMARY KEY (company_id, poll_id, option_id, user_id);
CREATE INDEX idx_feed_poll_votes_company_poll ON feed_poll_votes (company_id, poll_id);

-- ─── Chốt cuối «một người một phiếu» cho poll MỘT lựa chọn — DB-2 CHỌN A hoặc B ───
-- PHƯƠNG ÁN A (khuyến nghị): cột dẫn xuất + partial unique. Service ghi `single_choice`
-- cùng lúc chèn phiếu, lấy từ `feed_polls.multiple_choice` (bất biến — xem ghi chú dưới).
ALTER TABLE feed_poll_votes ADD COLUMN single_choice BOOLEAN NOT NULL;
CREATE UNIQUE INDEX feed_poll_votes_single_uq
  ON feed_poll_votes (company_id, poll_id, user_id)
  WHERE single_choice;

-- PHƯƠNG ÁN B: không chốt ở DB (không thêm DDL nào);
-- một-phiếu ép ở service dưới row-lock `SELECT … FROM feed_polls FOR UPDATE`,
-- SOCIAL-ERR-017 là lưới duy nhất.
```

> ⚠️ **Vì sao phải chọn: partial unique KHÔNG tham chiếu được bảng khác.** `multiple_choice` nằm ở `feed_polls`, nên vị từ `WHERE` của partial unique **không** đọc được nó — đó là lý do phương án A phải denormalize cờ xuống `feed_poll_votes`. **KHÔNG** dùng trigger đồng bộ (bẫy `frozen-table-triggers-break-db-init`). DB-2 ghi lại phương án đã chọn vào chính mục này.
>
> 🔒 **Điều kiện BẮT BUỘC đi kèm phương án A — `feed_polls.multiple_choice` BẤT BIẾN sau khi tạo.** `single_choice` là bản sao của nó; nếu poll đổi `multiple_choice` khi đã có phiếu thì partial unique **sai lệch im lặng** (hàng cũ giữ cờ cũ, hàng mới cờ mới). Service **chặn** mọi cập nhật `multiple_choice` **và** `is_anonymous` sau khi poll được tạo (SPEC-16 §13.4), kèm ca QA riêng.

**`user_id` lưu nhưng KHÔNG BAO GIỜ ra DTO khi `is_anonymous = true`** — kể cả cho `company-admin` (SOC-DEC-009). Đây là điểm mà một `SELECT *` vô ý sẽ làm rò; QA có ca ghim.

GRANT app role: `SELECT, INSERT, DELETE` (đổi phiếu = xoá + chèn trong cùng tx khi poll còn `open`).

### 7.6 Bảng `feed_ideas`

| Cột                       | Kiểu        | Bắt buộc | Ghi chú                                                                       |
| ------------------------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| `id`                      | UUID        | Có       | PK                                                                            |
| `company_id`              | UUID        | Có       | CASCADE, RLS                                                                  |
| `post_id`                 | UUID        | Có       | composite FK → `feed_posts` NO ACTION, **UNIQUE** (1-1 với bài `type='idea'`) |
| `status`                  | VARCHAR(16) | Có       | `submitted`/`under_review`/`accepted`/`rejected` (SPEC-01 §17.19)             |
| `reviewed_by`             | UUID        | Không    | composite FK → `users`, `SET NULL (reviewed_by)`                              |
| `reviewed_at`             | TIMESTAMPTZ | Không    |                                                                               |
| `review_note`             | TEXT        | Không    | **bắt buộc khi `rejected`**                                                   |
| `created_at` `updated_at` |             |          |                                                                               |

```sql
ALTER TABLE feed_ideas ADD CONSTRAINT chk_feed_ideas_status
  CHECK (status IN ('submitted','under_review','accepted','rejected'));
-- đã xét duyệt thì phải có vết (CHECK cặp dạng kéo theo)
ALTER TABLE feed_ideas ADD CONSTRAINT chk_feed_ideas_reviewed_pair
  CHECK (status IN ('submitted','under_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
-- từ chối bắt buộc ghi lý do
ALTER TABLE feed_ideas ADD CONSTRAINT chk_feed_ideas_reject_note
  CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0));
ALTER TABLE feed_ideas ADD CONSTRAINT feed_ideas_company_post_uq UNIQUE (company_id, post_id);
ALTER TABLE feed_ideas ADD CONSTRAINT feed_ideas_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_feed_ideas_company_status ON feed_ideas (company_id, status, created_at DESC);
```

> **FSM ép ở service** bằng `assertIdeaTransition` (khuôn `assertPeriodTransition` của PAYROLL) ⇒ `SOCIAL-ERR-019`. CHECK ở đây chỉ giữ **tập giá trị** và **tính đầy đủ của vết**, không giữ thứ tự chuyển.

### 7.7 Bảng `feed_kudos`

| Cột                       | Kiểu    | Bắt buộc | Ghi chú                                                                        |
| ------------------------- | ------- | -------- | ------------------------------------------------------------------------------ |
| `id`                      | UUID    | Có       | PK                                                                             |
| `company_id`              | UUID    | Có       | CASCADE, RLS                                                                   |
| `post_id`                 | UUID    | Có       | composite FK → `feed_posts` NO ACTION, **UNIQUE** (1-1 với bài `type='kudos'`) |
| `badge_id`                | UUID    | Không    | composite FK → `feed_kudos_badges` NO ACTION                                   |
| `message`                 | TEXT    | Không    |                                                                                |
| `is_official`             | BOOLEAN | Có       | default `false` — HR ghim vinh danh chính thức, cần `manage:feed-kudos`        |
| `created_at` `updated_at` |         |          |                                                                                |

```sql
ALTER TABLE feed_kudos ADD CONSTRAINT feed_kudos_company_post_uq UNIQUE (company_id, post_id);
ALTER TABLE feed_kudos ADD CONSTRAINT feed_kudos_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_feed_kudos_company_created ON feed_kudos (company_id, created_at DESC);
```

### 7.8 Bảng `feed_kudos_recipients`

| Cột           | Kiểu | Bắt buộc | Ghi chú                               |
| ------------- | ---- | -------- | ------------------------------------- |
| `company_id`  | UUID | Có       | CASCADE, RLS                          |
| `kudos_id`    | UUID | Có       | composite FK → `feed_kudos` NO ACTION |
| `employee_id` | UUID | Có       | composite FK → `employees` NO ACTION  |

```sql
ALTER TABLE feed_kudos_recipients ADD CONSTRAINT feed_kudos_recipients_pk
  PRIMARY KEY (company_id, kudos_id, employee_id);
CREATE INDEX idx_feed_kudos_recipients_company_emp ON feed_kudos_recipients (company_id, employee_id);
```

### 7.9 Bảng `feed_kudos_badges` — catalog

| Cột                             | Kiểu         | Bắt buộc | Ghi chú               |
| ------------------------------- | ------------ | -------- | --------------------- |
| `id`                            | UUID         | Có       | PK                    |
| `company_id`                    | UUID         | Có       | CASCADE, RLS          |
| `code`                          | VARCHAR(32)  | Có       | ổn định, dùng để seed |
| `name`                          | VARCHAR(255) | Có       |                       |
| `description`                   | TEXT         | Không    |                       |
| `icon`                          | VARCHAR(64)  | Không    | tên icon hoặc emoji   |
| `is_active`                     | BOOLEAN      | Có       | default `true`        |
| `position`                      | SMALLINT     | Có       | thứ tự hiển thị       |
| `created_at/by` `updated_at/by` |              |          |                       |

```sql
ALTER TABLE feed_kudos_badges ADD CONSTRAINT feed_kudos_badges_company_code_uq UNIQUE (company_id, code);
ALTER TABLE feed_kudos_badges ADD CONSTRAINT feed_kudos_badges_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_feed_kudos_badges_company_active ON feed_kudos_badges (company_id, is_active, position);
```

**Seed catalog ban đầu** (`ON CONFLICT DO NOTHING`): `teamwork` «Tinh thần đồng đội» · `innovation` «Sáng tạo» · `customer-first` «Tận tâm với khách hàng» · `mentor` «Người dẫn dắt» · `above-beyond` «Vượt mong đợi».

---

## 8. Enum chuẩn — mirror `packages/contracts` HAI CHIỀU, ĐÚNG BẰNG

| Enum                    | Giá trị                                                              | Nơi dùng                                            |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| `feedPostType`          | `share` · `news` · `idea` · `poll` · `kudos`                         | `feed_posts.type`                                   |
| `feedAudience`          | `company` · `group` · `org_unit`                                     | `feed_posts.audience`                               |
| `feedPostStatus`        | `published` · `hidden` · `deleted`                                   | `feed_posts.status` (SPEC-01 §17.18)                |
| `feedReactionTarget`    | `post` · `comment`                                                   | `feed_reactions` · `feed_mentions` · `feed_reports` |
| `feedReportReason`      | `spam` · `harassment` · `inappropriate` · `misinformation` · `other` | `feed_reports.reason`                               |
| `feedReportStatus`      | `open` · `resolved` · `dismissed`                                    | `feed_reports.status`                               |
| `feedGroupVisibility`   | `public` · `private`                                                 | `feed_groups.visibility`                            |
| `feedGroupRole`         | `owner` · `admin` · `member`                                         | `feed_group_members.role`                           |
| `feedGroupMemberStatus` | `active` · `pending`                                                 | `feed_group_members.status`                         |
| `feedPollStatus`        | `open` · `closed`                                                    | `feed_polls.status` (SPEC-01 §17.20)                |
| `feedIdeaStatus`        | `submitted` · `under_review` · `accepted` · `rejected`               | `feed_ideas.status` (SPEC-01 §17.19)                |

> ⚠️ **Ngoại lệ DUY NHẤT của luật mirror:** `feed_reactions.emoji` **nằm ngoài** bảng này và ngoài luật «mirror CHECK ↔ Zod đúng bằng», vì cột đó **không có CHECK** (§6.3). Nguồn của nó là hằng `chat-reactions.emoji-set` của CHAT; test mirror không được kỳ vọng tìm thấy CHECK cho `emoji`.

> **Bẫy đã biết:** contract phải mirror CHECK **cả hai chiều** — test phải làm đỏ khi DB có giá trị mà Zod thiếu **và** khi Zod có giá trị mà DB thiếu. Export prefix `feed*` để barrel `packages/contracts/src/index.ts` không đụng export park (TS2308).

---

## 9. Seed & kế hoạch migration

### 9.1 Thứ tự bắt buộc

```text
DB-1 (Track A)                         DB-2 (Track B, nối tiếp DB-1)
─────────────────────────────          ─────────────────────────────
1. CREATE TABLE 10 bảng                1. CREATE TABLE 9 bảng
2. RLS policy + FORCE  ← TRƯỚC dữ liệu 2. RLS policy + FORCE  ← TRƯỚC dữ liệu
3. composite tenant-FK + index         3. composite tenant-FK + index
4. GRANT theo §4.9                    4. GRANT theo §4.9
5. UNION-ADD file_links.object_type    5. seed catalog huy hiệu
   + audit_logs.object_types           6. UNION-ADD NOTI catalog + template
6. seed 14 cặp quyền + grant §9.2         (**CẢ HAI bảng** — xem §9.3)
7. rls-registry + cleanupTenants       7. rls-registry + cleanupTenants
   + RetentionService.PROTECTED_TABLES    + RetentionService.PROTECTED_TABLES
```

Số migration **đo `apps/api/migrations/meta/_journal.json` lúc chạy** và lấy `idx = max + 1`. Head lúc viết tài liệu là `idx 243` = `0576_s15payrolldash1_widget_budget_advance` ⇒ **dự kiến `0577+`**, nhưng con số thật chốt lúc merge. **Lane migration của S15 và S16 KHÔNG chạy cùng ngày.**

> ⚠️ Migration **không có mặt trong `_journal.json` sẽ bị bỏ qua im lặng** — luôn kiểm tra journal sau khi sinh file.

### 9.2 Seed 14 cặp quyền + grant

`ON CONFLICT DO NOTHING` cho cả `permissions` lẫn `role_permissions`. Grant per-(cặp, vai) theo [SPEC-16 §11.1](<../SPEC/SPEC-16 SOCIAL.md>) và ma trận quyền §9h:

| Cặp                                                                       | employee | manager        | hr      | company-admin |
| ------------------------------------------------------------------------- | -------- | -------------- | ------- | ------------- |
| `view:feed`                                                               | Company  | Company        | Company | Company       |
| `create:feed-post` · `-comment` · `-poll` · `-idea` · `-kudos` · `-group` | Company  | Company        | Company | Company       |
| `manage:feed-news` · `-post` · `-group` · `-kudos` · `-report`            | —        | —              | Company | Company       |
| `approve:feed-idea`                                                       | —        | —              | Company | Company       |
| `view:feed-report`                                                        | —        | **Department** | Company | Company       |

- **Tổng seed = 14 hàng `permissions` + 43 hàng `role_permissions`** (`employee` 7 · `manager` 8 · `hr` 14 · `company-admin` 14). Migration **verify fail-loud đúng số** như khuôn `0560`/`0565`; `super-admin` **không** enumerate (nhận qua `SuperAdminBootstrapService`). Các role hệ thống `payroll-officer`/`recruiter`/`asset-manager`/`office-admin` nhận **0 hàng** ở wave này.
- **KHÔNG đụng** ba cặp `social-*` của fbpost; migration `0544` có verify đếm grant `social*` của `employee` và sẽ RAISE nếu bị chạm.
- Census grant phải phủ **4 hình dạng wildcard** (`*:*` · `verb:*` · `*:resource` · cặp tường minh) — quyền SOCIAL không được lọt vào vai nào qua đường wildcard ngoài ý muốn.

### 9.3 NOTI catalog — **CHECK sống ở HAI bảng**

9 sự kiện `NOTI-EVENT-028..036` (SPEC-16 §17.1) phải UNION-ADD vào **cả hai** bảng catalog có CHECK **và** bản mẫu (template). Dải **đo lại lúc merge** — cao nhất đang dùng là `027` (S15-PAYROLL-V2).

---

## 10. Đối chiếu bất biến (CLAUDE.md §2)

| Bất biến                                   | Cách tuân thủ                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — `company_id` mọi query + RLS FORCE** | 19/19 bảng có `company_id` + policy + FORCE, tạo **trước** dữ liệu; mọi repository đi qua `withTenant`; composite tenant-FK chặn tham chiếu chéo tenant                                                                                                                |
| **2 — không hard-delete, append-only**     | Soft delete ở `feed_posts`/`feed_comments`/`feed_groups`; `feed_post_views` + `feed_post_acks` chỉ `SELECT, INSERT`; vào `RetentionService.PROTECTED_TABLES` **theo tiêu chí dưới bảng** — DB-1 đã thêm **10/10 bảng Track A**, DB-2 tự đo Track B theo cùng công thức |
| **3 — không secret plaintext**             | SOCIAL không lưu secret nào. Dữ liệu nhạy cảm duy nhất là ngày sinh — **không lưu lại** ở SOCIAL, đọc từ `employees` và cắt còn ngày+tháng ở DTO (SPEC-16 §3.5)                                                                                                        |

> 📌 **`RetentionService.PROTECTED_TABLES` — TIÊU CHÍ, không phải con số** (đính chính của `S16-SOCIAL-DB-1`; bản trước ghi «19 bảng» như một hằng số, dễ bị hiểu thành «cứ đếm cho đủ»).
> Tiêu chí THẬT ghi trong docblock `apps/api/src/foundation/retention/retention.service.ts`: **«bảng mà `runCleanup` TUYỆT ĐỐI không được xoá»** — **KHÔNG** phải «thiếu GRANT DELETE». Một bảng vào tập này nếu thoả **bất kỳ** điều nào:
>
> 1. **append-only / ledger / snapshot**;
> 2. **app role KHÔNG có GRANT DELETE** — retention phát lệnh DELETE sẽ ăn `42501` **UNCAUGHT và làm hỏng CẢ LƯỢT cleanup của tenant**;
> 3. **cascade-guard** — hard-delete kéo cascade sang một ledger append-only;
> 4. **bảng CÓ GRANT DELETE nhưng lệnh retention sẽ xoá CỨNG hàng đang sống** — vì `_deleteEligible` lọc theo **`created_at < cutoff`**, KHÔNG theo `deleted_at`, và `entityType` của `POST /foundation/retention-policies` là chuỗi **tự do** (chỉ regex `^[a-z_][a-z0-9_]*$`, **không** allowlist bảng).
>
> Áp lên **Track A ⇒ đủ 10/10 bảng**, chia hai nhóm với hai lý do khác nhau:
>
> | Nhóm                  | Bảng                                                                                                 | Tiêu chí | Vì sao                                                                                                                                                                                                                                                                                                                                  |
> | --------------------- | ---------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Không có GRANT DELETE | `feed_posts` · `feed_comments` · `feed_tags` · `feed_post_views` · `feed_post_acks` · `feed_reports` | (1)+(2)  | DB đã là tuyến hai (`42501`); có mặt ở tập để retention **no-op trước khi phát lệnh**, tránh hỏng cả lượt cleanup                                                                                                                                                                                                                       |
> | **CÓ** GRANT DELETE   | `feed_reactions` · `feed_mentions` · `feed_post_tags` · `feed_saved_posts`                           | (4)      | ⚠️ tập này là **lớp phòng thủ DUY NHẤT** — lệnh retention **chạy thật**. Hậu quả: `feed_posts.like_count`/`feed_tags.usage_count` lệch **vĩnh viễn** so với `COUNT(*)` (bộ đếm chỉ cập nhật cùng tx với hàng nguồn — §4.7 — retention không đi qua đường đó); mention và «Đã lưu» bốc hơi, không soft-delete, không audit nội dung hàng |
>
> ⚠️ `chat_message_reactions` (cùng hình dạng nhóm hai, **không** nằm trong tập) là một **bỏ sót chưa từng được review**, KHÔNG phải tiền lệ để noi theo. **DB-2 phải tự áp 4 tiêu chí này lên 9 bảng Track B**, không suy từ con số.

---

## 11. Rủi ro dữ liệu đã nhận diện

| #   | Rủi ro                                                    | Giảm thiểu                                                                  |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| R1  | `target_id` đa hình không có FK ⇒ hàng mồ côi             | Dọn theo trong cùng tx khi xoá mềm bài/bình luận; script đối soát cho QA    |
| R2  | Bộ đếm lệch `COUNT(*)` khi có race                        | Cập nhật trong cùng tx + ca test hai lượt thích đồng thời + script đối soát |
| R3  | `unaccent` vắng trên PROD                                 | Đo `pg_extension` lúc chạy, hai phương án ở §6.1b, fallback cuối là `ILIKE` |
| R4  | Partial unique một-phiếu không đọc được `multiple_choice` | Hai đường hợp lệ ở §7.5, DB-2 chọn và ghi lại — **không** trigger           |
| R5  | Nhóm mất `owner` cuối cùng                                | `SOCIAL-ERR-015` ở service + index đếm vai trò §7.2                         |
| R6  | `SELECT *` làm rò `user_id` của poll ẩn danh              | Repository dùng **tập cột tường minh**, không `select()` trần; ca QA ghim   |
| R7  | Seed quyền chạm nhầm `social-*` của fbpost                | Tiền tố `feed-` bắt buộc + verify `0544` là lưới an toàn                    |
| R8  | Migration thiếu trong `_journal.json`                     | Kiểm journal sau khi sinh — bỏ qua im lặng là bẫy đã gặp                    |

---

## 12. Liên quan

[SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) · [API-19 SOCIAL](<../API Design/API-19_SOCIAL_API_Design.md>) · [Ma trận phân quyền §9h](../permission-matrix-spec.md) · [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-12 CHAT](<DB-12 CHAT Database Design.md>) · [Kế hoạch wave](../plans/S16-SOCIAL-WAVE.md)
