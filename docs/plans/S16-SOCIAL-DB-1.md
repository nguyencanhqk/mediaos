# Plan S16-SOCIAL-DB-1 — Schema + migration SOCIAL Track A theo DB-17

> 🔴 Crown (permission seed + RLS + audit hot-file). **Nguồn sự thật thi công = [DB-17 §4–§11](<../DB/DB-17 SOCIAL Database Design.md>) + [SPEC-16 §5.1/§11/§23](<../SPEC/SPEC-16 SOCIAL.md>) + [permission-matrix §9h](../permission-matrix-spec.md)**. File này KHÔNG lặp lại thiết kế — chỉ chốt **thứ tự thao tác, neo file cụ thể, các điểm DB-17 SAI/THIẾU đã đo lại trên code + DB THẬT, và bằng chứng nghiệm thu**. Lệch giữa file này và DB-17 ⇒ **file này thắng cho các điểm ở §0** (đã đo ngày 19/09/2026), DB-17 thắng cho phần còn lại.

## §0. Đo thực địa — các điểm DB-17/backlog lệch với hiện trạng

> Mọi con số dưới đây đo trực tiếp trên container `mediaos-postgres` (PG **17.10**, DB `mediaos` = DB PROD) và trên cây code ngày **19/09/2026**. KHÔNG suy diễn từ văn bản.

### 0.0 Số đo nền (dùng thẳng, không đo lại)

| Hạng mục                            | Giá trị đo được                                                                        | Nguồn                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Migration head                      | `0576_s15payrolldash1_widget_budget_advance`, **idx 243**, journal 244 entry           | `apps/api/migrations/meta/_journal.json`                                          |
| ⇒ Số migration DB-1                 | **`0577`/`0578`/`0579`**, idx 244/245/246                                              | dẫn xuất                                                                          |
| `unaccent`                          | **ĐÃ CÀI** (v1.1) trong `mediaos` **và** mọi lane DB                                   | `pg_extension`; cài bởi `0538_s7chatdb1_chat_v1.sql:363` (đã chạy PROD)           |
| `public.f_unaccent(text)`           | **ĐÃ TỒN TẠI**, `IMMUTABLE PARALLEL SAFE STRICT`                                       | `0538_s7chatdb1_chat_v1.sql:365-372`                                              |
| `audit_logs_object_type_chk`        | **127 giá trị**, **chưa có** `feed_*` nào                                              | `pg_get_constraintdef`                                                            |
| ⇒ Sau UNION-ADD 4 giá trị           | phải đúng **131**                                                                      | mốc NO-LOSS + NO-GAIN                                                             |
| recycle-bin                         | **KHÔNG có registry, KHÔNG có CHECK loại đối tượng**                                   | `apps/api/src/recycle-bin/recycle-bin.repository.ts` hard-code `employeeProfiles` |
| `rls-registry` giả định cột `id`?   | **KHÔNG** — có sẵn `idColumn?: string` cho junction table                              | `apps/api/test/integration/rls-registry.ts:22-37`                                 |
| `cleanupTenants` giả định cột `id`? | **KHÔNG** — `DELETE FROM t WHERE company_id = ANY($1)`; **thứ tự con→cha là bắt buộc** | `apps/api/test/helpers/seed.ts:436-513`                                           |

⇒ **Nợ ĐO của DB-17 §6.1b đóng: chọn PHƯƠNG ÁN A (unaccent), TÁI DÙNG `public.f_unaccent`, KHÔNG tạo hàm mới, KHÔNG `CREATE EXTENSION`.**
⇒ **Nợ ĐO recycle-bin (DB-17 §3.2) đóng: KHÔNG CẦN LÀM GÌ.** "Thùng rác bài viết" nếu cần là màn riêng của SOCIAL (BE-3/FE-3), ngoài phạm vi DB-1.
⇒ **Nợ ĐO DB-17 §4.6 (7 bảng PK tổ hợp) đóng: KHÔNG hạ tầng nào giả định có `id`** ⇒ giữ PK tổ hợp, **không** thêm cột `id` thừa.

### 0.1 `file_links.object_type` **KHÔNG TỒN TẠI** — done_when #3 và DB-17 §3.2/§9.1 sai

Đo trên DB thật:

- Cột thật trên `file_links` tên **`entity_type`** (`varchar`), **không** phải `object_type`. Xác nhận `information_schema.columns`.
- `file_links` chỉ có **2 CHECK**: `chk_file_links_link_type` (Avatar/Attachment/Contract/Proof/Document/Import/Export/Other) và `chk_file_links_access_scope` (Owner/Team/Department/Company/System). **KHÔNG có CHECK nào trên `entity_type`** — cột tự do, không allow-list. Đối chiếu nguồn: `apps/api/migrations/0433_foundation_db3_files.sql:159-164`, `apps/api/src/db/schema/files.ts:116`.

⇒ **Không có gì để UNION-ADD.** Gắn file vào bài/bình luận chỉ cần ghi `module_code='SOCIAL'`, `entity_type='feed_post'|'feed_comment'`, `link_type='Attachment'` (giá trị đã có trong CHECK) — hoàn toàn ở tầng SERVICE (BE-1), **0 dòng DDL cho `file_links` ở DB-1**.

**Chốt:** bỏ mục "UNION-ADD `file_links.object_type`" khỏi phạm vi; sửa DB-17 §3.2 + §9.1 ghi lại đúng. done_when #3 phần này thoả bằng **chứng minh KHÔNG CẦN LÀM** (đính bằng chứng đo vào PR).

> Phần `audit_logs` của done_when #3 thì **CÓ THẬT**: cột số ít **`object_type`**, CHECK tên `audit_logs_object_type_chk`, 127 giá trị (backlog viết `object_types` số nhiều — lỗi chính tả trong WO, không phải tên thật). Làm bình thường ở §3 bước 3.

### 0.2 `feed_posts.group_id` — composite FK trỏ bảng **CHƯA TỒN TẠI** (Track B)

DB-17 §6.1 ghi `group_id` là composite FK → `feed_groups (company_id, id)` NO ACTION. `feed_groups` thuộc Track B (`S16-SOCIAL-DB-2`), chạy **sau** DB-1. Migration DB-1 không thể `REFERENCES feed_groups`. Phạm vi WO cấm đụng Track B ⇒ không được "tạo `feed_groups` sớm".

**Chốt (đường khả thi duy nhất):** DB-1 tạo `feed_posts.group_id UUID NULL` **không kèm FK**, nhưng **giữ đủ CHECK cặp** `audience`. DB-2 khi tạo `feed_groups` sẽ `ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_group_fk FOREIGN KEY (company_id, group_id) REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION` — additive, không rewrite bảng.

- Ghi chú này phải vào **DB-17 §6.1** và vào **`notes` của `S16-SOCIAL-DB-2`** trong `harness/backlog.mjs` — nếu DB-2 quên, `group_id` vĩnh viễn không có FK và không ai phát hiện.
- **Rủi ro cửa sổ DB-1→DB-2:** hàng `audience='group'` có thể mang `group_id` mồ côi. Chấp nhận được: DB-1 không có endpoint ghi, và BE-1 chỉ tạo bài nhóm sau khi Track B tồn tại. ALTER của DB-2 sẽ **tự chặn** nếu có hàng mồ côi thật — đó là tính năng, không phải lỗi.
- ⚠️ Đây là **ngoại lệ duy nhất** của luật "mọi FK mới kèm composite tenant-FK" (done_when #1). `database-reviewer` phải xác nhận tường minh.

### 0.3 `RetentionService.PROTECTED_TABLES` — DB-17 §10 nói "19 bảng"; đúng là **10 bảng** = trọn Track A

> ⚠️ **Hai đề xuất sai đã bị bác, ghi lại để không ai đề xuất lần ba:**
>
> - **planner: 2 bảng** (`feed_post_views`, `feed_post_acks`) — lập luận "tập này chỉ chứa ledger thuần", **sai sự thật** (xem dưới).
> - **bản plan v1: 6 bảng** — áp tiêu chí "thiếu GRANT DELETE", tức **đúng tiêu chí đã bị đính chính** ngay trong file đó, và **đảo ngược hướng phòng thủ** (bảo vệ nhóm đã an toàn, bỏ trống nhóm hở).

Tiêu chí THẬT của tập này ghi ngay trong docblock `apps/api/src/foundation/retention/retention.service.ts:38-105`, do một security-reviewer trước đây bắt được và đã đính chính vào DB-13 §13.6 — **"bảng `runCleanup` TUYỆT ĐỐI KHÔNG được xoá"**, gồm 4 nhóm:

1. **append-only / ledger / snapshot** (`audit_logs`, `login_logs`, `attendance_logs`, …);
2. **bảng mà `mediaos_app` KHÔNG có GRANT DELETE** — retention phát lệnh DELETE sẽ ăn **`42501` UNCAUGHT và làm hỏng CẢ LƯỢT cleanup của tenant** (nguyên văn lý do đưa 7 bảng PAYROLL vào);
3. **cascade-guard** (`org_units`, `projects` — hard-delete cascade sang ledger `goal_updates`);
4. **ca `payroll_template_components`** — bảng _có_ GRANT DELETE nhưng vẫn phải bảo vệ, vì `_deleteEligible` lọc theo **`created_at < cutoff`, KHÔNG theo `deleted_at`** ⇒ retention xoá **cứng hàng cấu hình ĐANG SỐNG**, và `entityType` của `POST /foundation/retention-policies` **tự do** (chỉ regex `^[a-z_][a-z0-9_]*$`, **không allowlist bảng**).

**Vì sao lập luận "chỉ ledger thuần" của planner sai:** tập hiện tại CHỨA nhiều bảng soft-delete nghiệp vụ thường — `salary_profiles`, `payroll_periods`, `payroll_period_lines`, `bonus_penalties`, `org_units`, `projects`. Mệnh đề "không bảng soft-delete nghiệp vụ nào trong tập" là **sai sự thật**.

Áp tiêu chí (2) lên **bảng GRANT DB-17 §4.9** cho Track A:

| Bảng               | app có `DELETE`? | Vào `PROTECTED_TABLES`? | Lý do                                                    |
| ------------------ | :--------------: | :---------------------: | -------------------------------------------------------- |
| `feed_posts`       |        no        |           ✅            | 42501 hỏng cả lượt cleanup                               |
| `feed_comments`    |        no        |           ✅            | 42501                                                    |
| `feed_tags`        |        no        |           ✅            | 42501 (từ điển không xoá)                                |
| `feed_post_views`  |        no        |           ✅            | 42501 + append-only                                      |
| `feed_post_acks`   |        no        |           ✅            | 42501 + append-only + **bằng chứng "ai đã đọc tin"**     |
| `feed_reports`     |        no        |           ✅            | 42501                                                    |
| `feed_reactions`   |       YES        |    ✅ _(tiêu chí 4)_    | có DELETE ⇒ lệnh retention **chạy thật** — xem bảng dưới |
| `feed_mentions`    |       YES        |    ✅ _(tiêu chí 4)_    | ditto                                                    |
| `feed_post_tags`   |       YES        |    ✅ _(tiêu chí 4)_    | ditto                                                    |
| `feed_saved_posts` |       YES        |    ✅ _(tiêu chí 4)_    | ditto                                                    |

**Nhưng tiêu chí (2) KHÔNG phải tiêu chí duy nhất — và bốn bảng còn lại mới là chỗ hở thật.** `retention.service.ts:99-101` ghi nguyên văn: _"Tiêu chí THẬT của tập này là câu ở đầu docblock — «bảng `runCleanup` TUYỆT ĐỐI KHÔNG được xoá» — **chứ không phải «thiếu GRANT DELETE»**"_. Áp tiêu chí (4) lên 4 bảng còn lại:

| Bảng               | Có DELETE ⇒ lệnh retention CHẠY THẬT | Hậu quả khi bị xoá theo `created_at`                                                                                                                                       |
| ------------------ | :----------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feed_reactions`   |                  ✅                  | xoá **hàng đang sống**; `feed_posts.like_count` lệch **vĩnh viễn** so với `COUNT(*)` (counter chỉ cập nhật cùng tx với hàng nguồn — §4.7; retention không đi qua đường đó) |
| `feed_post_tags`   |                  ✅                  | ditto với `feed_tags.usage_count`; bài mất thẻ im lặng                                                                                                                     |
| `feed_mentions`    |                  ✅                  | mất dữ liệu người dùng, **không** soft-delete, **không** audit nội dung hàng, **không** khôi phục được                                                                     |
| `feed_saved_posts` |                  ✅                  | ditto — "Đã lưu" của nhân viên bốc hơi                                                                                                                                     |

> ⚠️ **Hướng phòng thủ bị đảo nếu chỉ lấy 6.** Sáu bảng nhóm (2) **không có** GRANT DELETE ⇒ chúng đã có tuyến hai ở DB (`42501` chặn); `PROTECTED_TABLES` chỉ giúp không hỏng cả lượt cleanup. Bốn bảng nhóm (4) **có** GRANT DELETE ⇒ `PROTECTED_TABLES` là **lớp DUY NHẤT**, lệnh chạy thật và xoá thật. Lấy 6 = bảo vệ nhóm đã an toàn, bỏ trống nhóm hở.
>
> Tiền lệ `chat_message_reactions` (cùng hình dạng, **không** trong tập) **không** biện hộ được: đó là một **bỏ sót chưa từng được review**, không phải quyết định — đúng như bản đầu của `S15-PAYROLL-DB-1` để `payroll_template_components` ngoài danh sách và bị security-reviewer bắt. Lấy omission làm tiền lệ là lặp lại chính lớp lỗi file đó dựng ra để chặn. Chi phí thêm = **0**: retention không phải đường ghi hợp lệ của bảng nào trong 4 (bỏ thích · gỡ thẻ · gỡ mention · bỏ lưu đều đi qua DELETE của service).

⇒ **DB-1 thêm đúng 10 tên** = toàn bộ Track A. Sửa DB-17 §10 từ "19 bảng" thành công thức theo tiêu chí (Track A **10** + Track B do DB-2 tự đo theo cùng công thức).

### 0.5 `feed_posts` thiếu **2 cột mốc sắp xếp** mà BE-1 bắt buộc phải có — DB-1 là lane migration DUY NHẤT trước BE-1

`harness/backlog.mjs:16879` (`done_when` của **BE-1**) đòi nguyên văn: _"phân trang keyset theo **`(last_activity_at,id)`** cho «Hoạt động mới» và **`(published_at,id)`** cho «Mới đăng»"_. Đối chiếu `API-19 SOCIAL-API-001` (sắp xếp `latest`|`active`, cursor-based) và SPEC-16 SC-03.

**DB-17 §6.1 KHÔNG có cả hai cột**, và 6 index của §6.1 đều theo `created_at DESC`. Mà `S16-SOCIAL-BE-1` có `paths` = `apps/api/src/social/**`, `app.module.ts`, `realtime/**`, `notifications/**`, `test/**`, `packages/contracts/**` — **không có `apps/api/migrations/**`và không có`apps/api/src/db/schema/**`**. BE-1 không thể tự thêm cột mà không trip `guard-scope`, và backlog `:16848` gọi DB-1 là _"Lane migration NỐI TIẾP duy nhất của wave"_.

Nếu DB-1 không cấp, BE-1 chỉ còn đường xấu: dùng `updated_at` (bị bump bởi **mọi** lần tăng `view_count` ⇒ bài vừa có người xem nhảy lên đầu "Hoạt động mới", và không có index), hoặc subquery tương quan `max(comments.created_at)` (không index được, cursor không ổn định), hoặc mở **WO migration đỏ thứ hai**.

**Chốt — DB-1 cấp CẢ HAI cột + 2 index:**

| Cột                | Kiểu                                 | Ai ghi                                                                                                                                                           |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `published_at`     | `timestamptz NOT NULL DEFAULT now()` | set 1 lần lúc tạo; **không** đổi khi sửa bài                                                                                                                     |
| `last_activity_at` | `timestamptz NOT NULL DEFAULT now()` | service bump **cùng tx** khi có **bình luận / reaction mới**; ⚠️ **KHÔNG** bump theo `feed_post_views` (nếu bump, "Hoạt động mới" biến thành "vừa có người xem") |

```sql
CREATE INDEX idx_feed_posts_company_activity ON feed_posts (company_id, last_activity_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
CREATE INDEX idx_feed_posts_company_published ON feed_posts (company_id, published_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
```

Ghi luật "ai bump / không bump" vào **DB-17 §6.1** cùng PR — nếu không, BE-1 sẽ tự chọn và chọn sai.

### 0.6 Đính chính `done_when` của DB-1 — 3 chỗ văn bản lệch hiện trạng

Ba mục dưới đây **không** phải thay đổi phạm vi, mà là chữ trong WO không khớp thiết kế/hiện trạng. Ghi ra để người chốt không bác WO vì đọc chữ, và sửa luôn `harness/backlog.mjs` (file **nằm trong `paths` của DB-1**):

1. **"emoji ∈ bộ CHAT"** (`:16842`) đọc như một CHECK ở DB. **Không có CHECK emoji** — DB-17 §6.3 cấm (nguồn sự thật là hằng `CHAT_REACTION_EMOJIS`; CHECK = nguồn thứ hai). Lưới nằm ở Zod/service. Đây là **ngoại lệ duy nhất** của luật mirror CHECK↔Zod.
2. **"`audit_logs.object_types`"** (`:16843`, số nhiều) — cột thật là **`object_type`** (số ít), CHECK `audit_logs_object_type_chk`.
3. **"`packages/contracts` `social/feed*.ts`"** (`:16844`, dạng thư mục) — plan dùng **file phẳng `packages/contracts/src/social.ts`**, nhất quán `recruit.ts`/`asset.ts`/`room.ts`/`payroll.ts`. Quyết định thi công, ghi lại để không thành món lệch thứ ba không ai ký.

> Ngoài ra ghi nhận cho BE-1 (không sửa ở đây): `done_when` BE-1 `:16881` đòi _"recycle-bin khôi phục trả lại đủ"_, nhưng recycle-bin **không có registry** (§0.0) — BE-1 sẽ phải tự dựng đường khôi phục trong module SOCIAL hoặc mở WO riêng.

### 0.4 `S16-SOCIAL-BE-1` thiếu phụ thuộc NOTI catalog — **DB-1 sửa luôn `depends_on`**

DB-17 §9.1 gán **toàn bộ** NOTI catalog UNION-ADD cho DB-2, kể cả 5/9 event thuộc Track A (mention · bình luận vào bài của tôi · trả lời · tin tức mới · bài bị báo cáo). Nhưng `S16-SOCIAL-BE-1` trong backlog chỉ `depends_on: ["S16-SOCIAL-DB-1"]`. Nếu BE-1 chạy trước DB-2, nó emit event chưa có trong catalog ⇒ vỡ CHECK khi ghi (nhớ: **CHECK catalog NOTI sống ở HAI bảng**).

**Chốt — DB-1 SỬA LUÔN.** `harness/backlog.mjs` **nằm trong `paths` của DB-1** (`:16831`), `S16-SOCIAL-BE-1` còn `status:'todo'`, và đây là sửa dữ liệu **một dòng**. Để lại như "ghi chú cho người chốt" là mâu thuẫn với chính §0.2 (nơi plan bác bỏ "ghi chú" vì không phải cơ chế).

⇒ Sửa `depends_on` của `S16-SOCIAL-BE-1` thành `["S16-SOCIAL-DB-1", "S16-SOCIAL-DB-2"]`, cộng một `notes` giải thích lý do (NOTI catalog Track A do DB-2 cấp). Vẫn nêu trong PR để người chốt thấy.

---

## §1. Phạm vi & không-phạm-vi

**Trong phạm vi (Track A — 10 bảng):** `feed_posts` · `feed_comments` · `feed_reactions` · `feed_mentions` · `feed_tags` · `feed_post_tags` · `feed_saved_posts` · `feed_post_views` · `feed_post_acks` · `feed_reports`. Cộng: RLS+FORCE, composite tenant-FK, GRANT §4.9 (10 bảng), index, seed **14 cặp `feed-*` + 43 grant**, UNION-ADD `audit_logs.object_type` (4 giá trị), `packages/contracts` mirror Zod, `rls-registry` + `cleanupTenants` + `PROTECTED_TABLES` (6 bảng — §0.3), test LANE_DB.

**Ngoài phạm vi:**

- 9 bảng Track B — kể cả **không** tạo bảng rỗng giữ chỗ.
- `feed_posts_group_fk` — deferred sang DB-2 (§0.2).
- NOTI catalog UNION-ADD — DB-2 (§0.4).
- `file_links` DDL — **không cần** (§0.1).
- Đăng ký recycle-bin — **không cần** (§0.0).
- Bật `modules.is_active` SOCIAL — FE-1.
- `apps/api/src/social/**` (module NestJS, route) — BE-1.

---

## §2. `done_when` → bước thi công

| #   | done_when (`harness/backlog.mjs:16841-16845`)                                                                                                    | Bước       | Bằng chứng thoả                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | migration nối tiếp head + có trong journal; RLS+FORCE TRƯỚC dữ liệu; mọi FK mới kèm composite tenant-FK; `deleted_at` ở posts/comments; 4 UNIQUE | §3 b1      | `_journal.json` có 3 entry; `\d+` cho RLS+FORCE ON cả 10 bảng; đếm composite tenant-FK = **20** (§4, không tính `group_id` — §0.2); 4 UNIQUE đúng cột                           |
| 2   | CHECK type/audience/status/emoji/`search_vector`; đo `unaccent`; KHÔNG `CREATE EXTENSION`                                                        | §3 b1.6    | `unaccent` đã cài (§0.0) ⇒ phương án A, tái dùng `f_unaccent`, **0 lệnh `CREATE EXTENSION`**; `\d feed_reactions` **không** có CHECK trên `emoji` (đúng §6.3)                   |
| 3   | seed 14 cặp `ON CONFLICT DO NOTHING` + grant; không đụng `social-*`; census 4 hình dạng wildcard; UNION-ADD hot-file đúng neo parse              | §3 b2 + b3 | migration seed RAISE PASS đúng 43 grant; census wildcard 0 dòng; `audit_logs_object_type_chk` **127 → 131**, NO-LOSS + NO-GAIN; `file_links` thoả bằng §0.1                     |
| 4   | contracts Zod mirror hai chiều; barrel không TS2308; `rls-registry`+`cleanupTenants` nhận bảng mới; LANE_DB xanh; 4 vi phạm giả đỏ               | §3 b4–b7   | contracts build + `pnpm typecheck` xanh; `rls-guards.int-spec.ts` không báo bảng chưa đăng ký; `s16-social-db1-invariants.int-spec.ts` xanh trên LANE_DB; 4 ca §7 đỏ đúng mã PG |

---

## §3. Thứ tự thi công

> Số migration **đo lại `_journal.json` ngay trước khi code**. `0577/0578/0579` là dự kiến theo head đo 19/09/2026. Nếu lane khác chèn vào giữa, dời số, **giữ nguyên thứ tự nội bộ 3 bước**.

1. **`0577_s16socialdb1_feed_track_a_ddl.sql`** — khuôn `0559_s12recruitdb1_recruit_ddl.sql` (tiền-kiểm `DO $$` → `CREATE TABLE` → RLS/FORCE/policy → composite FK → GRANT → VERIFY; mọi lệnh cách nhau `--> statement-breakpoint`):
   1. **Tiền-kiểm fail-loud**: PG ≥ 15 (cần cú pháp `SET NULL (col)`); `users`/`org_units`/`employee_profiles` có `UNIQUE (company_id, id)` (đã đo ở `0535` — **hậu kiểm lại, không tin không đo**); 10 bảng Track A chưa tồn tại (`to_regclass`). ⚠️ **KHÔNG có bảng tên `employees`** — HR là **`employee_profiles`**; không `ALTER` bảng đích nào.
   2. `CREATE TABLE` theo **thứ tự phụ thuộc**: `feed_posts` → `feed_comments` → `feed_tags` → `feed_post_tags` → `feed_reactions` → `feed_mentions` → `feed_saved_posts` → `feed_post_views` → `feed_post_acks` → `feed_reports`. Cột/CHECK/UNIQUE/PK theo §4.
   3. Mỗi bảng: `ENABLE ROW LEVEL SECURITY` → `FORCE ROW LEVEL SECURITY` → `DROP POLICY IF EXISTS tenant_isolation` → `CREATE POLICY tenant_isolation … USING/WITH CHECK company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid` (nguyên văn khuôn `0559:109-117`) — **TRƯỚC** mọi FK/GRANT/dữ liệu (BẤT BIẾN 1).
   4. Composite tenant-FK — cú pháp khuôn `0535:684`. **20 FK** theo §4; **KHÔNG** có FK nào tới `feed_groups`.
   5. GRANT theo §4.9 (10 dòng) — phát một lần đúng bộ verb, **không** GRANT-rồi-REVOKE.
   6. `search_vector` — **TÁI DÙNG `public.f_unaccent`** (đã có từ `0538`), **KHÔNG** tạo hàm mới (DB-17 §6.1b gợi ý tạo là dành cho trường hợp chưa có; tạo thêm = tách nguồn sự thật):

      ```sql
      ALTER TABLE feed_posts ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(coalesce(body, '')))) STORED;
      CREATE INDEX idx_feed_posts_search ON feed_posts USING GIN (search_vector);
      ```

      Ghi thẳng trong migration: **schema-qualify tuyệt đối** (`public.f_unaccent`) — cột sinh **neo vào OID hàm**, sai `search_path` lúc migrate là hỏng **VĨNH VIỄN** (phải rewrite bảng để sửa).

   7. Index còn lại theo §6.1–§6.10 DB-17.
   8. **VERIFY fail-loud cuối migration**: đếm composite tenant-FK = 20 đúng-bằng; đếm CHECK theo §5; ACL đúng-bằng §4.9 qua `aclexplode` (khuôn `0559` M-series).

2. **`0578_s16socialdb1_seed_feed_perms.sql`** — khuôn `0544_s9socialdb1_seed_social_perms.sql` (resolve theo thuộc tính, **không hard-code id**, VERIFY fail-loud):
   1. INSERT 14 `permissions` (`is_sensitive=false` toàn bộ) `ON CONFLICT (action, resource_type) DO NOTHING`.
   2. 43 hàng `role_permissions` theo §6 — `DELETE … WHERE data_scope <> expected` rồi `INSERT … ON CONFLICT DO NOTHING` (khuôn `0544:48-95`; **không** blanket/CROSS JOIN).
   3. **VERIFY**: (a) đúng 14 cặp; (b) 0 cặp `is_sensitive=true`; (c) tổng 43 grant cho `resource_type = 'feed' OR LIKE 'feed-%'`; (d) breakdown **7/8/14/14**; (e) `manager` đúng **1** hàng `data_scope='Department'` (`view:feed-report`), còn lại Company; (f) census **4 hình dạng wildcard** = 0 dòng; (g) ⚠️ **snapshot count `social-post`/`social-account` của employee/manager/hr TRƯỚC và SAU migration phải ĐÚNG BẰNG** — lưới bảo vệ verify `0544` của fbpost.

3. **`0579_s16socialdb1_audit_union_object_type.sql`** — clone **nguyên khối** `0545_s9socialdb1_audit_social.sql` (2-tầng neo `object_type = ANY(...)`, NO-LOSS + NO-GAIN, `lock_timeout 5s`, fail-closed khi parse fail):
   - `v_new := ARRAY['feed_post','feed_comment','feed_group','feed_report']`. `feed_group` front-load có chủ ý (giá trị CHECK là chuỗi, độc lập với sự tồn tại bảng) — quyết định của DB-17 §3.2, giữ nguyên để DB-2 không phải đụng lại hot-file.
   - **Tách khỏi `0578`** — `ALTER TABLE audit_logs` lấy `ACCESS EXCLUSIVE`; tách để một lock-timeout không rollback luôn transaction seed quyền đã thành công (nguyên lý của `0545`).
   - **Mốc đo cứng: 127 → 131.** VERIFY phải assert cả NO-LOSS (127 giá trị cũ còn đủ) lẫn NO-GAIN (không dư ngoài 4).
   - `apps/api/src/db/schema/audit.ts` `AUDIT_OBJECT_TYPES` += 4 giá trị **cùng commit**.

4. **Drizzle schema — `apps/api/src/db/schema/social.ts` (MỚI) + 1 dòng export.** ⚠️ Bản plan đầu **rơi món này**; khuôn nhà ghi thẳng ở header migration tiền lệ `0559:41` — _"Cùng commit: **schema/recruit.ts + schema/index.ts** · test/helpers/seed.ts cleanupTenants() · test/integration/rls-registry.ts"_ — plan chỉ chép 3/4. **BE-1 KHÔNG được thêm hộ**: `paths` của nó không có `apps/api/src/db/schema/**` ⇒ tự dựng sẽ trip `guard-scope`, mà không cổng nào bắt việc thiếu (typecheck xanh vì không ai import; `rls-registry`/`cleanupTenants` dùng SQL thô).
   - 10 bảng Track A, **PARITY-only** — docblock nguyên khuôn `recruit.ts:26-31`: **"KHÔNG `db:generate`"** (migration viết tay là nguồn sự thật), `.references()` một cột chỉ để **suy kiểu** TS — composite FK thật sống ở SQL.
   - `company_id` dùng `currentCompanyDefault` từ `./_helpers` (khớp DEFAULT literal-GUC ở §4).
   - `apps/api/src/db/schema/index.ts` += **1 dòng** `export * from "./social";` **cuối danh sách** (additive — khuôn `index.ts:125` cho `recruit`).

5. **Contracts** — `packages/contracts/src/social.ts` (**file phẳng**, nhất quán `recruit.ts`/`asset.ts`/`room.ts`/`payroll.ts`; DB-17 viết "`social/feed*.ts`" là gợi ý tên, không phải yêu cầu thư mục):
   - Export **tiền tố `feed*`** — không dùng tên trần `Post`/`Comment`/`Report` (đụng `./media` đã export trong barrel ⇒ **TS2308**).
   - 6 enum Track A (§5) + Zod schema tối thiểu để test mirror chạy được (DTO đầy đủ là việc BE-1).
   - `social.spec.ts` — mirror **hai chiều**, literal **chép tay từ migration `0577`** (cố ý KHÔNG import từ schema — tránh tautology; khuôn `recruit.spec.ts`).
   - `packages/contracts/src/index.ts` += 1 dòng `export * from "./social";` (additive, cuối danh sách).

6. **Hạ tầng test**:
   - `apps/api/test/helpers/seed.ts` `cleanupTenants()` — khối 10 bảng **CON → CHA**: `feed_reports` → `feed_mentions` → `feed_reactions` → `feed_post_acks` → `feed_post_views` → `feed_saved_posts` → `feed_post_tags` → `feed_comments` → `feed_posts` → `feed_tags`; chèn **TRƯỚC `seed.ts:706` (`DELETE FROM org_units`)** — ràng buộc chặt hơn `DELETE FROM users` (`:811`) vì org_units xoá sớm hơn; đặt cạnh khối RECRUIT `:598-610`. `employee_profiles` **không** có lệnh DELETE riêng — nó rơi theo CASCADE từ `users` (`:802`), nên "trước `users`" là đủ cho 3 cột trỏ vào nó. Bài học `seed.ts:515-517`: **"VỊ TRÍ QUAN TRỌNG HƠN SỰ CÓ MẶT"**. Mọi FK trong cụm là `NO ACTION` ⇒ **không cascade nào cứu, thứ tự là bắt buộc**.
   - `apps/api/test/integration/rls-registry.ts` — 10 case mới. 4 bảng PK tổ hợp **PHẢI** khai `idColumn` (khuôn `role_permissions` `idColumn:"role_id"`): `post_id` cho `feed_saved_posts`/`feed_post_views`/`feed_post_acks`, `tag_id` cho `feed_post_tags`.
   - `apps/api/src/foundation/retention/retention.service.ts` `PROTECTED_TABLES` += **10 tên** = trọn Track A (§0.3): `feed_posts`, `feed_comments`, `feed_reactions`, `feed_mentions`, `feed_tags`, `feed_post_tags`, `feed_saved_posts`, `feed_post_views`, `feed_post_acks`, `feed_reports`.

7. **RED trước** — viết `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts` **trước khi chốt migration cuối**; đỏ trên schema nháp, xanh sau khi DDL đúng (CLAUDE §9).

8. **Cổng** — `pnpm --filter @mediaos/contracts build && pnpm typecheck` → `bash harness/check.sh --lane-db` xanh **không banner "XANH KHÔNG ĐỦ BẰNG CHỨNG"** → FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`), xin xác nhận tường minh cho §0.2 và §0.3 → PR.

---

## §4. Bảng cột — 10 bảng Track A

> Cột chuẩn `created_at/by, updated_at/by, deleted_at/by` theo DB-01. RI action theo **DB-17 §4.2b** — và **§4.2b THẮNG** nếu §6.x mâu thuẫn (luật đã ghi ngay trong DB-17; đây chính là chỗ vá-hụt mà DOC-1 vòng 2 bắt được).
> **Luật một dòng: `SET NULL` CHỈ trên cột nullable; cột NOT NULL luôn `NO ACTION`.**
>
> 🔧 **`company_id` của CẢ 10 BẢNG phải có DEFAULT literal-GUC** (khuôn nhà `0559:88-89`, lặp ở `:148, :219, :266, :311`):
> `company_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
> Thiếu default ⇒ đường ghi dựa vào GUC ăn `23502`, và `currentCompanyDefault` trong file drizzle (§3 b4) lệch parity với DB. VERIFY phải so `pg_get_expr(adbin, adrelid)` **đúng chuỗi** cho cả 10 bảng.

### 4.1 `feed_posts`

| Cột                                       | Kiểu        | NULL      | Default             | FK (composite trừ khi ghi khác)           | ON DELETE              | UNIQUE/CHECK                                                         |
| ----------------------------------------- | ----------- | --------- | ------------------- | ----------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `id`                                      | uuid        | NOT NULL  | `gen_random_uuid()` | PK                                        | —                      | —                                                                    |
| `company_id`                              | uuid        | NOT NULL  | —                   | `companies(id)` (đơn cột, base tenant FK) | CASCADE                | —                                                                    |
| `author_user_id`                          | uuid        | NOT NULL  | —                   | `users(company_id,id)`                    | **NO ACTION**          | —                                                                    |
| `author_employee_id`                      | uuid        | NULL      | —                   | `employee_profiles(company_id,id)`        | NO ACTION              | —                                                                    |
| `type`                                    | varchar(16) | NOT NULL  | —                   | —                                         | —                      | CHECK ∈ share/news/idea/poll/kudos                                   |
| `audience`                                | varchar(16) | NOT NULL  | `'company'`         | —                                         | —                      | CHECK ∈ company/group/org_unit + CHECK cặp (§6.1 DB-17, chép nguyên) |
| `group_id`                                | uuid        | NULL      | —                   | **KHÔNG FK ở DB-1** (§0.2)                | n/a                    | —                                                                    |
| `org_unit_id`                             | uuid        | NULL      | —                   | `org_units(company_id,id)`                | NO ACTION              | —                                                                    |
| `body`                                    | text        | NULL      | —                   | —                                         | —                      | CHECK ≤20000; CHECK bắt buộc khi `type NOT IN (poll,kudos)`          |
| `status`                                  | varchar(16) | NOT NULL  | `'published'`       | —                                         | —                      | CHECK ∈ published/hidden/deleted                                     |
| `pinned`                                  | boolean     | NOT NULL  | `false`             | —                                         | —                      | CHECK `pinned=false OR type='news'`                                  |
| `comments_locked`                         | boolean     | NOT NULL  | `false`             | —                                         | —                      | —                                                                    |
| `requires_ack`                            | boolean     | NOT NULL  | `false`             | —                                         | —                      | CHECK `requires_ack=false OR type='news'`                            |
| `like_count`/`comment_count`/`view_count` | integer     | NOT NULL  | 0                   | —                                         | —                      | CHECK ≥0 (mỗi cột)                                                   |
| `search_vector`                           | tsvector    | generated | STORED              | —                                         | —                      | GIN index                                                            |
| `edited_at`                               | timestamptz | NULL      | —                   | —                                         | —                      | —                                                                    |
| `created_at`/`updated_at`                 | timestamptz | NOT NULL  | `now()`             | —                                         | —                      | —                                                                    |
| `created_by`/`updated_by`/`deleted_by`    | uuid        | NULL      | —                   | `users(company_id,id)`                    | **SET NULL (\<cột\>)** | —                                                                    |
| `deleted_at`                              | timestamptz | NULL      | —                   | —                                         | —                      | soft delete                                                          |
| —                                         | —           | —         | —                   | —                                         | —                      | `UNIQUE (company_id, id)`                                            |

### 4.2 `feed_comments`

`id` PK · `company_id` CASCADE · `post_id` NOT NULL → `feed_posts(company_id,id)` **NO ACTION** · `parent_comment_id` NULL → self **NO ACTION** (chỉ 1 cấp — ép ở SERVICE) · `author_user_id` NOT NULL → `users` **NO ACTION** · `author_employee_id` NULL → `employee_profiles` NO ACTION · `body` text NOT NULL CHECK ≤5000 · `like_count` int NOT NULL default 0 CHECK ≥0 · `edited_at` · `created_by`/`updated_by`/`deleted_by` NULL → `users` **SET NULL (\<cột\>)** · `deleted_at` (soft delete) · `UNIQUE (company_id,id)`.

### 4.3 `feed_reactions`

`id` PK · `company_id` CASCADE · `target_type` varchar(16) NOT NULL CHECK ∈ (post,comment) · `target_id` uuid NOT NULL **KHÔNG FK** (đa hình — đối soát ở service, rủi ro R1 của DB-17 §11) · `user_id` uuid NOT NULL → `users(company_id,id)` **NO ACTION** · `emoji` varchar(32) NOT NULL **KHÔNG CHECK** (§0/§5 — nguồn là hằng `CHAT_REACTION_EMOJIS`, `communication.ts:427`) · `created_at`/`updated_at`.
`UNIQUE (company_id, target_type, target_id, user_id)`.

### 4.4 `feed_mentions`

`id` PK · `company_id` CASCADE · `target_type`/`target_id` đa hình như 4.3 · `mentioned_user_id` NOT NULL → `users` **NO ACTION** · `mentioned_employee_id` NULL → `employee_profiles` NO ACTION · `created_at`.
`UNIQUE (company_id, target_type, target_id, mentioned_user_id)`.

### 4.5 `feed_tags`

`id` PK · `company_id` CASCADE · `tag` varchar(64) NOT NULL (lowercase, không `#` — chuẩn hoá ở service) · `usage_count` int NOT NULL default 0 CHECK ≥0 · `created_at`.
`UNIQUE (company_id, tag)` + `UNIQUE (company_id, id)`.

### 4.6 `feed_post_tags` — PK tổ hợp, **không** cột `id`

`company_id` CASCADE · `post_id` → `feed_posts` **NO ACTION** · `tag_id` → `feed_tags` **NO ACTION**.
`PRIMARY KEY (company_id, post_id, tag_id)`.

### 4.7 `feed_saved_posts` — PK tổ hợp

`company_id` CASCADE · `user_id` → `users` **NO ACTION** · `post_id` → `feed_posts` **NO ACTION** · `created_at`.
`PRIMARY KEY (company_id, user_id, post_id)`.

### 4.8 `feed_post_views` — PK tổ hợp, **append-only**

`company_id` CASCADE · `post_id` → `feed_posts` **NO ACTION** · `user_id` → `users` **NO ACTION** · `viewed_at` default `now()`.
`PRIMARY KEY (company_id, post_id, user_id)`. GRANT **chỉ** `SELECT, INSERT`.

### 4.9 `feed_post_acks` — PK tổ hợp, **append-only**

`company_id` CASCADE · `post_id` → `feed_posts` **NO ACTION** · `user_id` → `users` **NO ACTION** · `acked_at` default `now()`.
`PRIMARY KEY (company_id, post_id, user_id)`. GRANT **chỉ** `SELECT, INSERT`.

### 4.10 `feed_reports`

`id` PK · `company_id` CASCADE · `target_type`/`target_id` đa hình · `reporter_user_id` NOT NULL → `users` **NO ACTION** · `reason` varchar(32) NOT NULL CHECK ∈ (spam,harassment,inappropriate,misinformation,other) · `note` text NULL · `status` varchar(16) NOT NULL default `'open'` CHECK ∈ (open,resolved,dismissed) · `resolved_by` uuid NULL → `users` **SET NULL (resolved_by)** · `resolved_at` NULL · `resolution_note` text NULL · CHECK cặp `status='open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)` · `created_at`/`updated_at`.
`UNIQUE (company_id,id)` + `UNIQUE INDEX (company_id,target_type,target_id,reporter_user_id) WHERE status='open'`.

### 4.11 Bảng tuple kỳ vọng — **26 composite tenant-FK** (thay cho một con số trần)

> ⚠️ Bản plan đầu ghi "20" — **SAI**, và sai theo kiểu nguy hiểm: nó **không đếm** 6 cột vết-kiểm-toán mà chính §4.1/§4.2 có liệt kê (`feed_posts` và `feed_comments`, mỗi bảng `created_by`/`updated_by`/`deleted_by`). Hai nhánh hậu quả, nhánh xấu là nhánh im lặng: (i) viết đủ FK ⇒ `VERIFY <> 20` ⇒ `RAISE EXCEPTION`, đốt một vòng vùng đỏ; (ii) "sửa cho khớp 20" bằng cách **bỏ 6 FK audit** ⇒ `created_by` của tenant A trỏ được sang `users` của tenant B, và **không lưới nào bắt** — `0559:613` ghi nguyên văn _"Quên hẳn FK thì fk-tenant-census/xtenant-fk-ratchet IM LẶNG (chỉ đếm FK đang tồn tại)"_; `xtenant-fk-ratchet.int-spec.ts` chỉ soi FK **một-cột đang tồn tại**, mà bảng mới kiểu `0559` không có FK một-cột nào ⇒ vô hình với census. **VERIFY trong migration là lưới DUY NHẤT.**

Đếm lại theo chính §4 (bỏ `group_id` — §0.2): posts **6** + comments **7** + reactions 1 + mentions 2 + tags 0 + post_tags 2 + saved 2 + views 2 + acks 2 + reports 2 = **26**.

VERIFY **không** dùng con số trần. Dùng **bảng tuple `EXCEPT` hai chiều** theo khuôn `0559:612-675` — mỗi dòng `(tbl, col, tgt, confdeltype, confdelsetcols)`:

| #     | Bảng               | Cột                                                                       | Đích                                                           | `confdeltype` | `confdelsetcols`       |
| ----- | ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- | :-----------: | ---------------------- |
| 1–3   | `feed_posts`       | `author_user_id` · `author_employee_id` · `org_unit_id`                   | `users` · `employee_profiles` · `org_units`                    |      `a`      | —                      |
| 4–6   | `feed_posts`       | `created_by` · `updated_by` · `deleted_by`                                | `users`                                                        |    **`n`**    | `ARRAY['<cột>']`       |
| 7–10  | `feed_comments`    | `post_id` · `parent_comment_id` · `author_user_id` · `author_employee_id` | `feed_posts` · `feed_comments` · `users` · `employee_profiles` |      `a`      | —                      |
| 11–13 | `feed_comments`    | `created_by` · `updated_by` · `deleted_by`                                | `users`                                                        |    **`n`**    | `ARRAY['<cột>']`       |
| 14    | `feed_reactions`   | `user_id`                                                                 | `users`                                                        |      `a`      | —                      |
| 15–16 | `feed_mentions`    | `mentioned_user_id` · `mentioned_employee_id`                             | `users` · `employee_profiles`                                  |      `a`      | —                      |
| 17–18 | `feed_post_tags`   | `post_id` · `tag_id`                                                      | `feed_posts` · `feed_tags`                                     |      `a`      | —                      |
| 19–20 | `feed_saved_posts` | `user_id` · `post_id`                                                     | `users` · `feed_posts`                                         |      `a`      | —                      |
| 21–22 | `feed_post_views`  | `post_id` · `user_id`                                                     | `feed_posts` · `users`                                         |      `a`      | —                      |
| 23–24 | `feed_post_acks`   | `post_id` · `user_id`                                                     | `feed_posts` · `users`                                         |      `a`      | —                      |
| 25    | `feed_reports`     | `reporter_user_id`                                                        | `users`                                                        |      `a`      | —                      |
| 26    | `feed_reports`     | `resolved_by`                                                             | `users`                                                        |    **`n`**    | `ARRAY['resolved_by']` |

**7 dòng `deltype='n'`** (6 ở posts/comments + `reports.resolved_by`) — tất cả đều là cột **nullable**, đúng §4.2b. **19 dòng `'a'`**. Cộng 2 assert phụ: (a) `count(FK có ≥2 cột trên 10 bảng) = 26`; (b) **`0` FK một-cột** tới bảng ≠ `companies`.

---

## §5. CHECK ↔ Zod — hai chiều, đúng bằng (trừ emoji)

| CHECK (DB)                                              | Zod (`packages/contracts/src/social.ts`)                                                                                                                                        | Bảng           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `chk_feed_posts_type`                                   | `feedPostTypeSchema` = enum(share,news,idea,poll,kudos)                                                                                                                         | feed_posts     |
| `chk_feed_posts_audience`                               | `feedAudienceSchema` = enum(company,group,org_unit)                                                                                                                             | feed_posts     |
| `chk_feed_posts_status`                                 | `feedPostStatusSchema` = enum(published,hidden,deleted)                                                                                                                         | feed_posts     |
| CHECK cặp audience (group/org_unit + loại trừ)          | `.superRefine()` kéo theo `group_id`/`org_unit_id`                                                                                                                              | feed_posts     |
| `chk_feed_posts_pinned_news`, `chk_feed_posts_ack_news` | `.superRefine()`                                                                                                                                                                | feed_posts     |
| `chk_feed_posts_body_required`, `_body_len`             | `.superRefine()` + `.max(20000)`                                                                                                                                                | feed_posts     |
| `chk_feed_posts_counts` ×3                              | `z.number().int().nonnegative()` ×3                                                                                                                                             | feed_posts     |
| `chk_feed_comments_body_len`, `_like_count`             | `.max(5000)`, `nonnegative()`                                                                                                                                                   | feed_comments  |
| `chk_feed_reactions_target`                             | `feedTargetTypeSchema` = enum(post,comment) — **dùng chung** cho mentions/reports                                                                                               | feed_reactions |
| **`feed_reactions.emoji`**                              | ⚠️ **NGOẠI LỆ DUY NHẤT — KHÔNG mirror.** Nguồn là `CHAT_REACTION_EMOJIS` của CHAT; CHECK ở DB = nguồn sự thật thứ hai. Test mirror **KHÔNG** được kỳ vọng tìm CHECK cho cột này | feed_reactions |
| `chk_feed_mentions_target`                              | tái dùng `feedTargetTypeSchema`                                                                                                                                                 | feed_mentions  |
| `chk_feed_tags_usage`                                   | `nonnegative()`                                                                                                                                                                 | feed_tags      |
| `chk_feed_reports_target`                               | tái dùng `feedTargetTypeSchema`                                                                                                                                                 | feed_reports   |
| `chk_feed_reports_reason`                               | `feedReportReasonSchema` = enum(spam,harassment,inappropriate,misinformation,other)                                                                                             | feed_reports   |
| `chk_feed_reports_status`                               | `feedReportStatusSchema` = enum(open,resolved,dismissed)                                                                                                                        | feed_reports   |
| `chk_feed_reports_resolved_pair`                        | `.superRefine()`                                                                                                                                                                | feed_reports   |

`social.spec.ts` phải **đỏ** khi: (a) DB có giá trị mà Zod thiếu; (b) Zod có giá trị mà DB thiếu. Kiểm bằng tay **một lần** trước merge (lệch 1 giá trị mỗi chiều → xác nhận đỏ → revert).

---

## §6. Seed 14 cặp + 43 grant (SPEC-16 §11.1 + permission-matrix §9h)

| #   | Cặp                   | employee |    manager     |   hr    | company-admin |
| --- | --------------------- | :------: | :------------: | :-----: | :-----------: |
| 1   | `view:feed`           | Company  |    Company     | Company |    Company    |
| 2   | `create:feed-post`    | Company  |    Company     | Company |    Company    |
| 3   | `create:feed-comment` | Company  |    Company     | Company |    Company    |
| 4   | `create:feed-poll`    | Company  |    Company     | Company |    Company    |
| 5   | `create:feed-idea`    | Company  |    Company     | Company |    Company    |
| 6   | `create:feed-kudos`   | Company  |    Company     | Company |    Company    |
| 7   | `create:feed-group`   | Company  |    Company     | Company |    Company    |
| 8   | `manage:feed-news`    |    —     |       —        | Company |    Company    |
| 9   | `manage:feed-post`    |    —     |       —        | Company |    Company    |
| 10  | `manage:feed-group`   |    —     |       —        | Company |    Company    |
| 11  | `manage:feed-kudos`   |    —     |       —        | Company |    Company    |
| 12  | `manage:feed-report`  |    —     |       —        | Company |    Company    |
| 13  | `approve:feed-idea`   |    —     |       —        | Company |    Company    |
| 14  | `view:feed-report`    |    —     | **Department** | Company |    Company    |

**Tổng: employee 7 · manager 8 · hr 14 · company-admin 14 = 43.** `is_sensitive=false` cả 14. `super-admin` **không** enumerate (không phải role canonical). `payroll-officer`/`recruiter`/`asset-manager`/`office-admin` nhận **0** hàng.

⚠️ Tiền tố resource **bắt buộc `feed-`** (và `feed` trần cho #1) — **không** `social-*`, vì verify của `0544` đếm grant `social*` của employee (rủi ro R7 của DB-17 §11).

---

## §7. Test trên LANE_DB — `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts`

Chạy: `bash scripts/lane-db-setup.sh s16db1` → `export LANE_DB=mediaos_s16db1` → `pnpm --filter @mediaos/api test -- s16-social-db1-invariants`.
Dùng pool `direct` (owner, bypass RLS) để chạm thẳng constraint; pool **app** (dưới GUC) để kiểm ACL/RLS/`WITH CHECK`.

### 7.1 Bốn lưới bắt buộc — **3 lưới PG + 1 lưới Zod** (KHÔNG phải "4 ca đỏ PG")

> ⚠️ Nhãn này quan trọng: ca (b) **PG cố ý PASS**. Viết là "4 ca đỏ đúng mã PG" sẽ khiến reviewer sau đọc ra "thiếu CHECK emoji" — đúng hiểu nhầm mà §0.6/§5 dựng ra để chặn.

| Ca                      | Vi phạm giả                                                                               | Tầng bắt | Kỳ vọng                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) audience lệch**   | `INSERT feed_posts(audience='org_unit', org_unit_id=NULL)`                                | PG       | **`23514`**, ghim **tên** constraint. Đối chứng: `audience='company'` kèm `group_id IS NOT NULL` ⇒ `23514` tên khác                                     |
| **(b) emoji lạ**        | `INSERT feed_reactions(emoji='clown')`                                                    | **Zod**  | PG **PASS** (đúng thiết kế §4.3 — không CHECK); `feedReactionSchema.safeParse({emoji:'clown'})` ⇒ `success:false`. **Ghi lý do trong comment của test** |
| **(c) reaction đôi**    | `INSERT feed_reactions` 2 lần cùng `(company_id,target_type,target_id,user_id)`           | PG       | **`23505`** trên UNIQUE                                                                                                                                 |
| **(d) cross-tenant FK** | tenant A + B; `INSERT feed_posts(company_id=A, author_user_id=<user của B>)` qua `direct` | PG       | **`23503`** trên composite FK                                                                                                                           |

> Bẫy: **drizzle giấu mã PG trong `cause`** ⇒ assert `err.cause?.code`, không chỉ `err.code`. **Mỗi ca DENY phải kèm 1 ALLOW đối chứng** — ca DENY rỗng là ca xanh giả. Và `pg-reports-arbitrary-check-when-multiple-violated`: mỗi hàng vi phạm **đúng MỘT** CHECK, ghim **tên** chứ không chỉ mã.

### 7.2 CHECK kéo theo còn lại — RED bắt buộc (bản v1 chỉ phủ `audience`)

Đây đúng hình dạng "vế `IS NULL OR` rỗng" mà DB-17 §6.1 cảnh báo: CHECK **đúng cú pháp mà đúng vĩnh viễn** — không ca nào chứng minh nó chặn được gì.

| Vi phạm                              | Kỳ vọng                                | ALLOW đối chứng                          |
| ------------------------------------ | -------------------------------------- | ---------------------------------------- |
| `pinned=true AND type<>'news'`       | `23514` `chk_feed_posts_pinned_news`   | `pinned=true AND type='news'` ⇒ OK       |
| `requires_ack=true AND type<>'news'` | `23514` `chk_feed_posts_ack_news`      | `requires_ack=true AND type='news'` ⇒ OK |
| `type='share' AND body IS NULL`      | `23514` `chk_feed_posts_body_required` | `type='poll' AND body IS NULL` ⇒ OK      |

### 7.3 RLS — phải có CẢ vế GHI (bản v1 chỉ có vế ĐỌC)

- **Đọc:** không GUC ⇒ 0 hàng cả 10 bảng; cô lập chéo tenant qua `rls-guards.int-spec.ts` (10 case mới).
- **Ghi (`WITH CHECK`) — THIẾU ở bản v1:** dưới pool **app** với GUC = tenant A, `INSERT feed_posts(company_id = B)` ⇒ _"new row violates row-level security policy"_. Không ca nào khác chứng minh vế `WITH CHECK` của policy tồn tại (ca (d) đi qua `direct` = bypass RLS, chỉ chứng minh FK).

### 7.4 Hành vi `SET NULL (col)` — chứng minh 7 FK `deltype='n'` viết đúng

Đây là lớp lỗi `0503` mà `xtenant-fk-ratchet.int-spec.ts:178-188` sinh ra để chặn, **nhưng** spec đó chỉ soi FK **một-cột đã có** ⇒ không soi FK mới của ta.

Ca: xoá một `users` đang là `created_by` của một `feed_post` ⇒ bài **còn**, `created_by = NULL`, và **`company_id` KHÔNG đổi**. (Bản `SET NULL` trần — không liệt kê cột — sẽ null **cả `company_id`**; đây là thứ duy nhất phân biệt hai bản.)

### 7.5 `feed_posts.group_id` — assert **tự lên nòng**, biến nợ §0.2 thành cổng

"Ghi chú cho DB-2" không phải cơ chế; cột **không có FK** thì `xtenant-fk-ratchet` mù hoàn toàn. Spec này sống vĩnh viễn trong CI và tự đổi vế khi Track B land:

```
if (to_regclass('feed_groups') IS NULL)
    → assert: 0 FK trên feed_posts.group_id          // nợ đã đăng ký, còn hạn
else
    → assert: TỒN TẠI composite FK (company_id, group_id) → feed_groups(company_id,id), confdeltype='a'
```

Cộng assert rẻ thứ hai: `COUNT(*) FROM feed_posts WHERE audience='group' AND group_id IS NOT NULL` = 0 **chừng nào FK chưa có** (bắt hàng mồ côi **trước** khi `ALTER` của DB-2 nổ). Ngày DB-2 tạo `feed_groups` mà quên `ALTER`, spec đỏ ngay — không phụ thuộc ai đọc `notes`.

### 7.6 Ràng buộc — phân biệt đúng `contype`, đừng viết `'u'` trơn

"4 UNIQUE" của `done_when` **không cùng loại**:

| Đối tượng                                                 | Loại                                                          | Kiểm ở đâu                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `feed_saved_posts` · `feed_post_views` · `feed_post_acks` | **PRIMARY KEY tổ hợp** (`contype='p'`)                        | `pg_constraint`, khuôn `0559:686-696`                                                                    |
| `feed_reactions` (target+user)                            | **UNIQUE** (`contype='u'`)                                    | `pg_constraint`                                                                                          |
| `feed_reports` (open)                                     | **partial unique INDEX** — **không** có trong `pg_constraint` | `pg_index`, so `pg_get_expr(indpred)` **đúng chuỗi**, khuôn `0559:698-716` — **không** `ILIKE '%WHERE%'` |

Viết `contype='u'` trơn ⇒ hoặc đỏ oan, hoặc đẻ một UNIQUE trùng PK.

### 7.7 Còn lại

- **ACL đúng-bằng §4.9** cho cả 10 bảng qua `aclexplode`; riêng `feed_post_views`/`feed_post_acks`: thử UPDATE/DELETE **thật** dưới app role ⇒ **`42501`**.
- **`PROTECTED_TABLES`**: `RetentionService.isProtectedTable(t) === true` cho **đủ 10 tên** (unit-spec, không cần DB).
- **Grant set-equality** 43 bộ `(role, action, resource_type, data_scope, effect)` + census 4 hình dạng wildcard = 0.
- **`social-*` không đổi**: count 3 cặp fbpost trước/sau đúng bằng (xem §6 — đây là lưới THẬT duy nhất, không phải `0544`).
- **`company_id` DEFAULT**: `pg_get_expr(adbin, adrelid)` khớp chuỗi literal-GUC trên cả 10 bảng.
- **Audit UNION-ADD**: `127 → 131`, NO-LOSS + NO-GAIN đọc lại bằng `pg_get_constraintdef`.
- **Idempotency — thu hẹp đúng phạm vi:** chạy lại **`0578` + `0579`** ⇒ 0 exception, count không đổi. **`0577` chạy lại PHẢI `RAISE`** (tiền-kiểm `to_regclass` fail-loud, khuôn `0559:45-70`) — đó là tính năng, không phải lỗi. Bản v1 viết "chạy lại cả 3 migration ⇒ 0 exception" là **tự mâu thuẫn với §3 b1.1**.
- **Counter bất biến**: `like_count` chỉ đếm hàng **thuộc sở hữu** (bẫy `invariant-count-must-filter-owned-rows`).

---

## §8. Rủi ro → cách chặn

| #   | Bẫy                                                                  | Cách chặn                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hot-file UNION-ADD sai neo parse ⇒ mất giá trị cũ                    | Clone nguyên khối `0545`; mốc cứng 127→131, NO-LOSS + NO-GAIN. `file_links` loại khỏi phạm vi (§0.1)                                                                                                                                                                                                                                                                                                                            |
| 2   | Seed đụng `social-*` của fbpost                                      | **Chỉ một lưới thật: verify (g) snapshot trước/sau.** ⚠️ "Lưới `0544`" là **ẢO, sai theo hai chiều**: (i) `0544:141,166` dùng `resource_type IN ('social-post','social-account')` — danh sách **đúng-bằng**, đặt tên `social-feed` nó cũng không thấy; (ii) `0544` luôn chạy **TRƯỚC** `0578` trong mọi lần migrate ⇒ về thứ tự nó **không thể** bắt hồi quy của ta. Tiền tố `feed-` vẫn bắt buộc, nhưng đừng tưởng có hai lưới |
| 3   | RLS sau dữ liệu / FK thiếu composite                                 | §3 b1.3 trước b1.4; VERIFY bảng tuple **26 dòng** (§4.11) — không dùng số trần; ngoại lệ `group_id` có cổng tự lên nòng (§7.5)                                                                                                                                                                                                                                                                                                  |
| 4   | `SET NULL` trên cột NOT NULL ⇒ teardown đỏ hàng loạt                 | §4 — mọi cột NOT NULL là `NO ACTION`; đúng 7 cột nullable dùng `SET NULL (col)`; ca §7.4 chứng minh `company_id` không bị null theo                                                                                                                                                                                                                                                                                             |
| 5   | Append-only bị UPDATE/DELETE                                         | GRANT chỉ SELECT+INSERT + ca ACL `42501`                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | Retention xoá cứng hàng đang sống                                    | `PROTECTED_TABLES` **+10** (§0.3) + ca `isProtectedTable` đủ 10                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | CHECK emoji ở DB = nguồn sự thật thứ hai                             | Ngoại lệ tường minh §4.3/§5/§0.6; lưới ở Zod (§7.1 ca b)                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | Nhánh "bỏ cột `search_vector`"                                       | Cấm — cột generated luôn tồn tại (§3 b1.6)                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Barrel TS2308 với cụm media park                                     | Export tiền tố `feed*`; cổng cơ học contracts build + `pnpm typecheck`                                                                                                                                                                                                                                                                                                                                                          |
| 10  | `rls-registry`/`cleanupTenants` không nhận bảng PK tổ hợp            | `idColumn` khai rõ cho 4 bảng; thứ tự xoá con→cha + **neo vị trí** (§3 b6)                                                                                                                                                                                                                                                                                                                                                      |
| 11  | Thiếu file drizzle ⇒ BE-1 không có bảng để query, không cổng nào bắt | §3 b4 — `schema/social.ts` + 1 dòng export, cùng commit (khuôn `0559:41`)                                                                                                                                                                                                                                                                                                                                                       |
| 12  | Thiếu cột mốc sắp xếp ⇒ BE-1 phải mở WO migration thứ hai            | §0.5 — `published_at` + `last_activity_at` + 2 index, cấp ở DB-1                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Bật `modules.is_active` SOCIAL nhầm                                  | Không chạm bảng `modules` ở WO này                                                                                                                                                                                                                                                                                                                                                                                              |
| 14  | Migration thiếu trong `_journal.json` ⇒ **bị bỏ qua im lặng**        | Kiểm journal ngay sau khi sinh; 3 entry, `when` tăng nghiêm ngặt                                                                                                                                                                                                                                                                                                                                                                |
| 15  | Heredoc nuốt backslash / chết giữa chừng                             | Script đối soát **Write ra file rồi chạy**; quét lại `chr(8)`                                                                                                                                                                                                                                                                                                                                                                   |
| 16  | `turbo` trả log cache ⇒ xanh giả                                     | Verify bằng `harness/check.sh --lane-db` (có `TURBO_FORCE=1` + đếm skip)                                                                                                                                                                                                                                                                                                                                                        |

**Rủi ro riêng từ §0:**

- **R-A** (§0.2): cửa sổ DB-1→DB-2 cho phép `group_id` mồ côi ở tầng DB. Đã hạ từ "ghi chú" xuống **cổng cơ học** §7.5.
- **R-B** (§0.5): nếu service quên bump `last_activity_at`, "Hoạt động mới" đứng yên — BE-1 phải có ca test bump cùng tx; DB chỉ cấp cột + index.

---

## §9. Điều kiện tự-mở-cổng

- [ ] §0.2 / §0.3 / §0.5 có xác nhận của `database-reviewer` (+ `security-reviewer` cho §0.3) **trước khi** viết migration thật.
- [ ] `_journal.json` đủ 3 entry mới, `when` tăng nghiêm ngặt, thứ tự DDL → seed → audit.
- [ ] VERIFY dùng **bảng tuple 26 dòng** (§4.11) `EXCEPT` hai chiều — **không** con số trần; cộng `count(FK ≥2 cột)=26` và `0` FK một-cột tới bảng ≠ `companies`; 7 dòng `deltype='n'` có `setcols` đúng tên cột.
- [ ] `company_id` cả 10 bảng có DEFAULT literal-GUC, VERIFY so `pg_get_expr` đúng chuỗi.
- [ ] `feed_posts` có `published_at` + `last_activity_at` + 2 index partial (§0.5); luật "ai bump" đã ghi vào DB-17 §6.1.
- [ ] `apps/api/src/db/schema/social.ts` tồn tại (10 bảng, PARITY-only, docblock "KHÔNG `db:generate`") + 1 dòng export cuối `schema/index.ts`.
- [ ] `file_links`: **0 dòng DDL**, kèm bằng chứng đo (§0.1) trong PR description.
- [ ] `audit_logs_object_type_chk`: **127 → 131**, NO-LOSS + NO-GAIN PASS.
- [ ] Seed: đúng 14 cặp / 43 grant / breakdown **7-8-14-14**; census 4 hình dạng wildcard = 0; 3 cặp `social-*` count **không đổi** trước/sau (lưới THẬT duy nhất — §8 hàng 2).
- [ ] `PROTECTED_TABLES` **+10** (không phải +2, không phải +6, không phải +19) — §0.3; ca `isProtectedTable` phủ đủ 10.
- [ ] `rls-registry.ts` +10 case (4 case khai `idColumn`); `cleanupTenants()` +10 dòng đúng thứ tự con→cha, **neo trước `seed.ts:706` (`DELETE FROM org_units`)**.
- [ ] contracts build + `pnpm typecheck` xanh (không TS2308); `social.spec.ts` chứng minh đỏ được theo **cả hai chiều** (kiểm tay 1 lần, revert).
- [ ] `s16-social-db1-invariants.int-spec.ts` xanh trên `LANE_DB`, phủ đủ §7.1–§7.7; mỗi ca DENY có ALLOW đối chứng; ghim **tên** constraint chứ không chỉ mã.
- [ ] `bash harness/check.sh --lane-db` xanh, **không** banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
- [ ] FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) PASS.
- [ ] `docs/DB/DB-17…md` cập nhật: §3.2 (`file_links` không cần đụng · recycle-bin không cần) · §6.1 (`group_id` FK deferred · 2 cột mốc sắp xếp + luật bump) · §10 (19 bảng → tiêu chí + **10** bảng Track A) — **cùng PR**.
- [ ] `harness/backlog.mjs`: `S16-SOCIAL-DB-1` → done + đính chính `done_when` (§0.6: emoji không CHECK · `object_type` số ít · contracts file phẳng); `notes` của **`S16-SOCIAL-DB-2`** ghi "phải tự thêm `feed_posts_group_fk`"; **`S16-SOCIAL-BE-1` `depends_on` += `"S16-SOCIAL-DB-2"`** (§0.4).
