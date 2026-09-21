# Plan S16-SOCIAL-DB-2 — Schema + migration SOCIAL Track B theo DB-17

> 🔴 Crown (schema + RLS + NOTI catalog hot-file). Nguồn sự thật thi công = [DB-17 §4/§7/§9](<../DB/DB-17 SOCIAL Database Design.md>) + [SPEC-16 §13.3/§13.4/§17](<../SPEC/SPEC-16 SOCIAL.md>) + tiền lệ [plan S16-SOCIAL-DB-1](S16-SOCIAL-DB-1.md). File này KHÔNG lặp lại thiết kế — chỉ chốt thứ tự thao tác, ba quyết định để ngỏ (D1/D2/D3), và các điểm DB-17/backlog lệch hiện trạng đã đo lại (nguồn: phép đo thực địa 21/09/2026 — không đo lại). Lệch giữa file này và DB-17 ⇒ **file này thắng** cho các điểm ở §0, DB-17 thắng cho phần còn lại.

## §0. Phạm vi & nợ mang sang

**Trong phạm vi (Track B — 9 bảng):** `feed_groups` · `feed_group_members` · `feed_polls` · `feed_poll_options` · `feed_poll_votes` · `feed_ideas` · `feed_kudos` · `feed_kudos_recipients` · `feed_kudos_badges`. Cộng: RLS+FORCE, composite tenant-FK (20 mới + 1 additive `feed_posts_group_fk`), GRANT §4.9, index, NOTI-EVENT-028..036 (catalog + template + nới 4 CHECK), seed catalog huy hiệu, contracts Zod mirror, `rls-registry`+`cleanupTenants`+`PROTECTED_TABLES`, test LANE_DB.

**Ngoài phạm vi:** `apps/api/src/social/**` (module NestJS/route — BE-2); `social.master-data` seeder đăng ký runtime (D2 — nợ sang BE-2); FSM service (`assertIdeaTransition`, khoá owner cuối nhóm, bất biến `multiple_choice`/`is_anonymous`) — tất cả ép ở service, DB chỉ giữ tập giá trị.

**⚠️ Tiêu đề WO lỗi thời (sửa trong `harness/backlog.mjs`, đã nằm trong `paths`):** DB-1 (`0578`) đã seed đủ **14/14 cặp quyền `feed-*` + 43 grant** — DB-2 **seed 0 cặp quyền mới** (đo M2). Cụm "cặp manage/approve còn thiếu" trong `title` của `S16-SOCIAL-DB-2` là lỗi thời từ lúc ước lượng wave ban đầu; sửa lại text, và done_when #3 phần "+ cặp còn thiếu ON CONFLICT DO NOTHING" thoả **bằng chứng minh 0 cặp cần thêm** (đính snapshot `0578` verify (c)/(d) = 43/7-8-14-14 vào PR), không viết thêm INSERT quyền nào.

**Nợ BẮT BUỘC từ DB-1 (đã ghi trong `notes` của WO):** `feed_posts.group_id` là cột UUID nullable KHÔNG FK (feed_groups chưa tồn tại lúc DB-1 chạy). DB-2 **PHẢI** thêm:

```sql
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_group_fk
  FOREIGN KEY (company_id, group_id) REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION;
```

Cổng tự lên nòng đã có sẵn ở `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts:668-717` (§7.5) — khi `to_regclass('feed_groups')` khác NULL mà FK chưa có thì spec đó ĐỎ. **DB-2 KHÔNG viết test mới cho CỔNG NÀY** — chỉ chạy lại spec đó trên LANE_DB sau khi DDL của DB-2 chạy, xác nhận nó **tự đổi nhánh** sang "else" (composite FK, `confdeltype='a'`, 2 cột) và PASS.

> 🔴 **NHƯNG spec DB-1 KHÔNG tự xanh hết — có ĐÚNG HAI ca phải bump ratchet có chủ ý** (plan-review vòng 1+2, 21/09/2026, đã kiểm chứng trên code):
>
> | Ca | Dòng | Vì sao đỏ | Bump bắt buộc |
> | --- | --- | --- | --- |
> | `"26 composite tenant-FK, 0 FK một-cột tới bảng ≠ companies"` | `:868-875` | đếm `array_length(conkey,1) >= 2` trên **`FEED_TABLES` (Track A)** — mà `feed_posts` ∈ Track A; thêm `feed_posts_group_fk` ⇒ **26 → 27** | `toBe(26)` → **`toBe(27)`**, đổi tên ca thành `"27 composite tenant-FK, …"`, comment `+ feed_posts_group_fk (mig 0580)` |
> | `"audit_logs.object_type: 131 giá trị, CÓ ĐỦ 4 feed_*, và canary cũ KHÔNG mất (NO-LOSS)"` | `:1051-1065` | `0583` thêm `feed_kudos_badge` ⇒ **131 → 132** | `toHaveLength(131)` → **`toHaveLength(132)`**, đổi tên ca thành `"132 giá trị, CÓ ĐỦ 5 feed_*"`, **thêm `"feed_kudos_badge"` vào `expect.arrayContaining([...])`** (`:1063-1065`), comment `+ feed_kudos_badge (mig 0583)` |
>
> ⇒ Baseline đúng: **45/45 trước khi chạm** (đo M13) → **43/45 sau khi `0580`+`0583` chạy** → **45/45 sau HAI bump**.
> ⚠️ Người thi công thấy đúng **hai** ca đỏ ở đây là **đúng dự báo**. TUYỆT ĐỐI KHÔNG "sửa cho xanh" bằng cách thu hẹp query, bỏ FK, hay nới `toHaveLength` thành `toBeGreaterThanOrEqual` — nới là **giết ratchet**, đúng lớp lỗi mà ratchet sinh ra để chặn. Thấy ca thứ BA đỏ ⇒ DỪNG, đó không phải dự báo.

**Khoảng trống mới phát hiện trong `done_when` (không có trong M1-M12, tự đo khi viết plan):** `done_when` #1 của WO đòi CHECK `closes_at > created_at` trên `feed_polls`, nhưng DB-17 §7.3 **không có CHECK này** (chỉ có `chk_feed_polls_status` + `chk_feed_polls_closed_pair`). Đây là một bổ sung hợp lý (tương tự cách DB-1 §0.5 thêm 2 cột không có trong DB-17 vì done_when downstream đòi) — **chốt: thêm CHECK mới** `chk_feed_polls_closes_future CHECK (closes_at IS NULL OR closes_at > created_at)` (vế `IS NULL OR` ở đây KHÔNG vi phạm bẫy `nullable-escape-clause-makes-check-vacuous` vì `closes_at` **hợp lệ NULL** — poll không hạn — và CHECK có tác dụng thật khi có giá trị). Ghi ngược vào DB-17 §7.3 cùng PR (như DB-1 đã làm với §0.5/§6.1).

---

## §1. Bảng phép đo đã đóng (M1..M16 — không đo lại)

| # | Nội dung | Kết luận | Nguồn |
| --- | --- | --- | --- |
| M1 | Migration head | idx 246 = `0579_s16socialdb1_audit_union_object_type` ⇒ DB-2 bắt đầu **idx 247 = `0580`** | `apps/api/migrations/meta/_journal.json` |
| M2 | Quyền `feed-*` | DB-1 (`0578`) đã seed đủ **14 cặp / 43 grant** (7/8/14/14) — DB-2 seed **0 cặp** | `0578` verify (a)-(g) |
| M3 | NOTI CHECK | 4 CHECK (`chk_notification_events_module_code/_type`, `chk_notifications_module_code/_type`) **CHƯA có SOCIAL/Social** — DB-2 phải nới cả 4, giữ nhánh `IS NULL OR` ở 2 CHECK của `notifications` | `0566:52-170` (khuôn) |
| M4 | Dải NOTI-EVENT | Mã cao nhất đang dùng = `027` (PAYROLL v2); `028..036` sạch, đúng SPEC-01 §20.2 dòng 1765-1773 | đo lại lúc merge, không hard-code |
| M5 | Catalog NOTI code | `notification-event-catalog.const.ts`: `NOTI_EVENT_COUNT=79`, `NOTI_ENABLED_EVENT_COUNT=65` ⇒ sau +9 (toàn bộ enabled) thành **88/74** | `notification-event-catalog.const.ts:223,230` |
| M6 | `feed_posts.group_id` | Chưa FK, có cổng tự lên nòng ở `s16-social-db1-invariants.int-spec.ts:668-717` | như trên |
| M7 | Hạ tầng test | `rls-registry.ts` (khuôn dòng ~3049) · `seed.ts` `cleanupTenants()` khối feed hiện ở dòng 612-630, PHẢI đứng trước `DELETE FROM org_units` · `RetentionService.PROTECTED_TABLES` Track A đã đủ 10/10 (dòng ~153-163) | như trên |
| M8 | Badge catalog per-company | `feed_kudos_badges.company_id NOT NULL` + `UNIQUE(company_id,code)` ⇒ seed-trong-migration chỉ tới công ty ĐÃ TỒN TẠI; `paths` DB-2 KHÔNG có `apps/api/src/social/**` ⇒ không đặt seeder runtime ở đây được — xem D2 | `master-data-seeder.registry.ts:14-39` |
| M9 | Số huy hiệu | DB-17 §7.9 = **5 mã** (`teamwork`/`innovation`/`customer-first`/`mentor`/`above-beyond`); `done_when` ghi "≥6" | xem D3 |
| M10 | `feed_poll_votes` A/B | DB-17 §7.5 để ngỏ — xem D1 | `DB-17 §7.5` |
| M11 | Môi trường | Docker healthy, lane-DB verify chạy được, `lane-db-setup.sh` cần `--reset` | đo 21/09/2026 |
| M12 | Bảng không cột `id` (Track B) | `feed_group_members` · `feed_poll_votes` · `feed_kudos_recipients` — PK tổ hợp, miễn trừ có chủ ý (DB-17 §4.6); Track A đã có 4 bảng cùng hình dạng làm tiền lệ đăng ký `idColumn` | `rls-registry.ts:3117-3138` |
| M13 | Baseline | `s16-social-db1-invariants.int-spec.ts` = **45/45 PASS** trên lane `mediaos_s16socialdb2` sạch (chain 0000→0579) ⇒ mọi đỏ sau đây là của DB-2 | đo 21/09/2026 |
| M14 | Giá trị CHECK NOTI hiện có | Chép nguyên văn từ `pg_get_constraintdef` (15 module_code · 18 notification_type) — dùng để UNION-ADD, KHÔNG gõ lại từ trí nhớ | lane DB |
| M15 | Số đếm NOTI trên DB | `notification_events` global = **79** · `notification_templates` global = **65** — khớp hằng trong code | lane DB |
| M16 | Quyền feed trên DB thật | `permissions LIKE 'feed%'` = **14** · `role_permissions` trỏ vào = **43** (xác nhận M2) | lane DB |

---

## §2. Ba quyết định phải chốt

### D1 — `feed_poll_votes`: chọn **PHƯƠNG ÁN A** (cột dẫn xuất `single_choice` + partial unique)

**Lý do:** đây là phương án được DB-17 §7.5 khuyến nghị, và là lớp phòng thủ DB THẬT DUY NHẤT chống phiếu đôi ở poll một-lựa-chọn (phương án B phó thác 100% cho row-lock service — một lỗi service là mất chốt, đúng lớp rủi ro mà mọi bảng khác trong module đều có UNIQUE/PK ở DB làm chốt cuối, ví dụ `feed_reactions_target_user_uq`, `feed_reports_open_uq`). Chi phí thêm là 1 cột boolean + 1 UNIQUE INDEX — rẻ.

```sql
ALTER TABLE feed_poll_votes ADD COLUMN single_choice boolean NOT NULL;
CREATE UNIQUE INDEX feed_poll_votes_single_uq
  ON feed_poll_votes (company_id, poll_id, user_id)
  WHERE single_choice;
```

**Điều kiện bắt buộc đi kèm (nợ sang BE-2 — xem §10):** service ghi `single_choice` = `NOT feed_polls.multiple_choice` cùng câu INSERT phiếu (không trigger — bẫy `frozen-table-triggers-break-db-init`), và **chặn UPDATE** `feed_polls.multiple_choice`/`is_anonymous` sau khi poll được tạo (SPEC-16 §13.4) — vì partial unique không đọc được bảng khác, đổi `multiple_choice` giữa chừng làm chốt **sai lệch im lặng**.

**Cập nhật ngược DB-17 §7.5** (cùng PR): xoá đoạn "PHƯƠNG ÁN A/B — DB-2 CHỌN", thay bằng "ĐÃ CHỌN PHƯƠNG ÁN A (S16-SOCIAL-DB-2, chốt 21/09/2026)" + giữ nguyên SQL, xoá khối B khỏi tài liệu (chỉ giữ lại trong lịch sử git).

### D2 — Cơ chế seed catalog huy hiệu: **phương án (a)** — migration seed công ty hiện có + nợ seeder sang BE-2

**Lý do:** `paths` của `S16-SOCIAL-DB-2` (`apps/api/src/db/schema/**`, `apps/api/migrations/**`, `apps/api/test/**`, `packages/contracts/**`, `docs/DB/**`, `docs/plans/**`, `harness/backlog.mjs`) **không có** `apps/api/src/social/**` — nơi duy nhất hợp lý để đăng ký một `ModuleMasterDataSeeder` (module NestJS `onModuleInit`, per M8). Mở rộng `paths` giữa chừng một lane migration để nhét một module runtime đi ngược nguyên tắc CLAUDE.md §9 "1 Work Order tại 1 thời điểm" và biến DB-2 từ WO schema thuần thành WO lai schema+runtime — tăng diện review FULL gate không cần thiết cho một crown-jewel WO. Seeder runtime tự nhiên thuộc về BE-2 (nơi module `social` được bootstrap lần đầu, `app.module.ts` được sửa).

**Cơ chế migration (chỉ tới công ty ĐANG TỒN TẠI lúc migrate):**

```sql
INSERT INTO feed_kudos_badges (company_id, code, name, description, icon, is_active, position)
SELECT c.id, x.code, x.name, x.description, x.icon, true, x.position
  FROM companies c
 CROSS JOIN (VALUES
    ('teamwork',       'Tinh thần đồng đội',       'Ghi nhận tinh thần hợp tác, hỗ trợ đồng đội', 'users-round',      1),
    ('innovation',     'Sáng tạo',                  'Ghi nhận ý tưởng hoặc cách làm mới hiệu quả',  'lightbulb',        2),
    ('customer-first', 'Tận tâm với khách hàng',    'Ghi nhận sự tận tâm phục vụ khách hàng',       'heart-handshake',  3),
    ('mentor',         'Người dẫn dắt',             'Ghi nhận việc kèm cặp, hướng dẫn đồng nghiệp', 'graduation-cap',   4),
    ('above-beyond',   'Vượt mong đợi',             'Ghi nhận nỗ lực vượt xa yêu cầu công việc',    'rocket',           5)
 ) AS x(code, name, description, icon, position)
 WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, code) DO NOTHING;
```

Icon là tên icon `lucide` (khớp `packages/ui` shadcn) — mỹ quan thuần tuý, FE có thể đổi sau bằng `UPDATE` (bảng có GRANT UPDATE cho app role), không cần migration mới.

**Nợ ghi vào `notes` của `harness/backlog.mjs` (S16-SOCIAL-BE-2, cùng PR):** _"BE-2 PHẢI đăng ký `social.master-data` ở `MasterDataSeederRegistry` (`apps/api/src/foundation/seed/master-data-seeder.registry.ts`) để công ty tạo SAU migration `0582` cũng có 5 huy hiệu mặc định — DB-2 chỉ seed công ty ĐANG TỒN TẠI lúc migrate (D2 phương án a, `docs/plans/S16-SOCIAL-DB-2.md` §2)."_

### D3 — Số huy hiệu: **chốt 5** (theo DB-17 §7.9), sửa `done_when` của backlog

**Lý do:** DB-17 §7.9 là nguồn thiết kế duy nhất liệt kê tên cụ thể (5 mã); SPEC-16 không liệt kê số nào (chỉ nói "có seed ban đầu"). "≥6" trong `done_when` không neo vào bất kỳ danh sách 6 mã nào — phát minh một mã thứ 6 không có căn cứ thiết kế là tệ hơn sửa một con số trong backlog. **Sửa `done_when` #3** từ `"Seed catalog huy hiệu (≥6 mã hệ thống, không xoá)"` thành `"Seed catalog huy hiệu (5 mã hệ thống theo DB-17 §7.9: teamwork/innovation/customer-first/mentor/above-beyond, không xoá) cho công ty hiện có"`.

---

## §3. Danh sách file migration — đánh số từ **0580**

> Đo lại `_journal.json` **ngay trước khi code** — nếu lane khác chèn số, dời toàn bộ nhưng giữ nguyên thứ tự nội bộ 4 bước. `when` phải tăng nghiêm ngặt (dự kiến `1717587369000` / `370000` / `371000` / `372000`, tiếp theo `0579` = `1717587368000`).

| # | File | Mục đích | Verify fail-loud chính |
| --- | --- | --- | --- |
| 1 | `0580_s16socialdb2_feed_track_b_ddl.sql` | 9 CREATE TABLE + RLS/FORCE/policy + 20 composite FK mới + 1 FK additive `feed_posts_group_fk` + index + GRANT §4.9 (app + worker) | Đếm composite FK = **21** đúng-bằng (bảng tuple EXCEPT hai chiều, không số trần — như 0577); GRANT ACL đúng-bằng per bảng qua `aclexplode`; RLS ENABLE+FORCE+policy trên đủ 9 bảng; `company_id` DEFAULT literal-GUC đúng chuỗi trên cả 9; **0 hàng mồ côi** `feed_posts.audience='group'` trước khi `ALTER` group_fk chạy (nếu có ⇒ RAISE, KHÔNG âm thầm bỏ qua) |
| 2 | `0581_s16socialdb2_noti_track_b.sql` | Nới 4 CHECK NOTI (khuôn `0566`) + seed 9 event `NOTI-EVENT-028..036` + 9 template IN_APP/vi-VN (khuôn `0573` khối B/C/D) | 4 CHECK có `'SOCIAL'`/`'Social'`; `notifications` **giữ** `IS NULL OR`; set-equality 9 event theo mã; mỗi event đúng dedupe/priority/enabled/type; đúng 9 template; **0 biến tiền/PII** trong `variables_schema` |
| 3 | `0582_s16socialdb2_seed_kudos_badges.sql` | Seed 5 huy hiệu cho mọi công ty hiện có (D2) | **ĐẲNG THỨC SỐ HỌC LỌC THEO PHẠM VI SỞ HỮU** (xem dưới); set-equality 5 mã **per-company CHỈ KHI `count(companies) > 0`**; `RAISE NOTICE` số company đã seed; idempotent (`ON CONFLICT DO NOTHING`, chạy lại count không đổi) |
| 4 | `0583_s16socialdb2_audit_union_kudos_badge.sql` | UNION-ADD `feed_kudos_badge` vào CHECK `audit_logs.object_type` (khuôn `0579` NGUYÊN KHỐI — xem dưới) | **2 tầng PARSE** (`'{…}'` literal → fallback `ARRAY[…]`) + **3 verify**: NO-LOSS · NO-GAIN · số học `card(after) = card(cur) + card(add)`; idempotent (`LIKE '%''feed_kudos_badge''%'` ⇒ NOTICE skip) |

> 🔴 **Vì sao PHẢI có `0583`** (plan-review 21/09/2026): SPEC-16 §18.1 liệt kê **"sửa catalog huy hiệu"** trong danh sách hành động `manage:*` bắt buộc ghi audit, nhưng CHECK `audit_logs.object_type` hiện đóng ở **4 giá trị SOCIAL** (`feed_post`·`feed_comment`·`feed_group`·`feed_report`, `0579:58`) — **không giá trị nào khớp `feed_kudos_badges`** ⇒ BE-3 (CRUD catalog huy hiệu, `manage:feed-kudos`) sẽ **không ghi được audit**, hoặc ăn `23514`.
> `0579` cố ý front-load `feed_group` đúng để DB-2 **không phải đụng lại hot-file audit lần hai** (mỗi lần là một `ACCESS EXCLUSIVE` trên `audit_logs`). DB-2 là **cửa sổ rẻ cuối cùng** trước khi BE mở route — nên trả nốt ở đây thay vì để BE-3 mở lại khoá bảng.

> 🔴 **`0582` TUYỆT ĐỐI KHÔNG `RAISE` khi `companies` rỗng** (plan-review 21/09/2026 — đã kiểm chứng): **KHÔNG migration nào INSERT company** (`grep "INSERT INTO companies" apps/api/migrations/` = 0 kết quả); company chỉ sinh ra ở **boot app** (`ensure-default-company.service.ts`) hoặc **fixture test** (`test/helpers/seed.ts:66-73`). `lane-db-setup.sh --reset` = DROP → CREATE DATABASE → chain `0000→latest` bằng `tsx src/db/migrate.ts` — **không boot app** ⇒ lúc `0582` chạy, `companies` = **0 hàng**. Một `RAISE` ở đó sẽ làm **ĐỎ TOÀN BỘ chain migrate** trên mọi DB mới: lane DB của chính §8 bước 6, **CI** (DB mới mỗi job), và **một cài đặt PROD mới**.
> ⇒ `0582` là **no-op có bảo đảm** trên mọi môi trường test. Neo chống-rỗng (`empty-success-is-the-fail-open-shape`) vì thế **phải nằm ở int-spec** — nơi có company thật — chứ không ở migration (xem §7 **Nhóm 13**).
> *(Đo phụ: lane DB của phiên này có 73 company, nhưng đó là do suite test chạy SAU migrate tạo ra — không phải bằng chứng ngược.)*

**Đẳng thức của `0582` PHẢI lọc theo phạm vi sở hữu** (`invariant-count-must-filter-owned-rows` — plan-review vòng 2). Đếm **toàn bảng** `feed_kudos_badges` là SAI hình dạng: bảng có **GRANT INSERT cho app role** (§4.9) nên một huy hiệu do tenant admin tự tạo (BE-3), hàng do §7 Nhóm 13 dựng, hoặc công ty đã seed rồi bị soft-delete **sau đó**, đều làm vế trái > vế phải ⇒ **RAISE oan** ở đường re-run mà chính §7 Nhóm 10 bắt buộc chạy.

```sql
-- vế trái: CHỈ 5 mã hệ thống, CHỈ trên công ty còn sống  ← phạm vi mà 0582 thực sự sở hữu
SELECT count(*) INTO v_left
  FROM feed_kudos_badges b
  JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
 WHERE b.code = ANY (ARRAY['teamwork','innovation','customer-first','mentor','above-beyond']);
SELECT count(*) INTO v_co FROM companies WHERE deleted_at IS NULL;
IF v_left <> 5 * v_co THEN RAISE EXCEPTION '[0582] verify: % hang seed / ky vong % (5 x % cong ty)', v_left, 5 * v_co, v_co; END IF;
RAISE NOTICE '[0582] da seed 5 huy hieu x % cong ty', v_co;   -- 0 company ⇒ 0 = 5*0, PASS, no-op
```

**`0583` chép NGUYÊN KHỐI khuôn `0579`** — không rút gọn. Hai điểm dễ chép thiếu:
- **2 tầng PARSE**: thử `'{…}'` literal trước, **fallback `ARRAY[…]`**; bỏ nhánh fallback ⇒ fail-closed oan trên DB mà `pg_get_constraintdef` in ra dạng còn lại.
- **131 → 132 chỉ được là `RAISE NOTICE`, TUYỆT ĐỐI KHÔNG là điều kiện `RAISE EXCEPTION`.** `0579:40-42` ghi rõ lý do cố ý không hard-code 127/131: một lane khác merge trước sẽ làm con số dịch và migration **đỏ ở MỌI lần migrate**. Điều kiện RAISE là đẳng thức quan hệ `card(after) = card(cur) + card(add)` + NO-LOSS + NO-GAIN, không phải con số tuyệt đối.

**Journal** (`apps/api/migrations/meta/_journal.json`, thêm 4 entry sau idx 246, kiểm tra ngay sau khi sinh file — bẫy `migration-not-in-journal-is-silently-skipped`):

```json
{ "idx": 247, "version": "7", "when": 1717587369000, "tag": "0580_s16socialdb2_feed_track_b_ddl", "breakpoints": true },
{ "idx": 248, "version": "7", "when": 1717587370000, "tag": "0581_s16socialdb2_noti_track_b", "breakpoints": true },
{ "idx": 249, "version": "7", "when": 1717587371000, "tag": "0582_s16socialdb2_seed_kudos_badges", "breakpoints": true },
{ "idx": 250, "version": "7", "when": 1717587372000, "tag": "0583_s16socialdb2_audit_union_kudos_badge", "breakpoints": true }
```

---

## §4. DDL từng bảng (9 bảng Track B)

> Cột chuẩn `created_at/by`, `updated_at/by`, `deleted_at/by` theo DB-01 CHỈ khi bảng đó có trong DB-17 §7.x (không phải bảng nào cũng có — xem cột "by" per bảng dưới). `company_id` cả 9 bảng: `NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid REFERENCES companies(id) ON DELETE CASCADE`, RLS ENABLE+FORCE+policy `tenant_isolation` (literal-GUC, USING+WITH CHECK) TRƯỚC mọi FK/GRANT — khuôn `0577`/`0559`. RI action theo DB-17 §4.2b: **NOT NULL ⇒ NO ACTION; nullable "vết kiểm toán" ⇒ SET NULL (col); nullable "business FK" khác ⇒ vẫn NO ACTION** (không SET NULL trần bao giờ).

### 4.1 `feed_groups`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `name` | varchar(255) | NOT NULL | — | — | — |
| `description` | text | NULL | — | — | — |
| `visibility` | varchar(16) | NOT NULL | — | — | — |
| `avatar_file_id` | uuid | NULL | — | `files(company_id,id)` | NO ACTION |
| `member_count` | integer | NOT NULL | 0 | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |
| `created_by`/`updated_by`/`deleted_by` | uuid | NULL | — | `users(company_id,id)` | **SET NULL (\<cột\>)** |
| `deleted_at` | timestamptz | NULL | — | — | soft delete |

CHECK: `chk_feed_groups_visibility CHECK (visibility IN ('public','private'))` · `chk_feed_groups_member_count CHECK (member_count >= 0)`.
UNIQUE/Index: `feed_groups_company_id_id_uq UNIQUE (company_id,id)` · `feed_groups_company_name_uq UNIQUE INDEX (company_id, lower(name)) WHERE deleted_at IS NULL` · `idx_feed_groups_company_visibility (company_id, visibility) WHERE deleted_at IS NULL`.
Composite FK (4): `feed_groups_avatar_file_tenant_fk` (NO ACTION) · `feed_groups_created_by_tenant_fk`/`_updated_by_tenant_fk`/`_deleted_by_tenant_fk` (SET NULL, liệt kê cột).
GRANT app: `SELECT, INSERT, UPDATE` (soft delete, không DELETE).

### 4.2 `feed_group_members` — PK tổ hợp, không cột `id`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `group_id` | uuid | NOT NULL | — | `feed_groups(company_id,id)` | NO ACTION |
| `user_id` | uuid | NOT NULL | — | `users(company_id,id)` | NO ACTION |
| `employee_id` | uuid | NULL | — | `employee_profiles(company_id,id)` | NO ACTION |
| `role` | varchar(16) | NOT NULL | — | — | — |
| `status` | varchar(16) | NOT NULL | `'pending'` | — | — |
| `joined_at` | timestamptz | NULL | — | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |

CHECK: `chk_feed_group_members_role CHECK (role IN ('owner','admin','member'))` · `chk_feed_group_members_status CHECK (status IN ('active','pending'))` · `chk_feed_group_members_pending_role CHECK (status = 'active' OR role = 'member')`.
PK: `feed_group_members_pk PRIMARY KEY (company_id, group_id, user_id)`.
Index: `idx_feed_group_members_company_group_role (company_id, group_id, role) WHERE status='active'` · `idx_feed_group_members_company_user (company_id, user_id, status)` — **index nóng nhất module** (SOC-DEC-006, mọi truy vấn bài nhóm riêng tư lọc membership qua đây).
Composite FK (3): `feed_group_members_group_tenant_fk` · `_user_tenant_fk` · `_employee_tenant_fk` — cả 3 **NO ACTION** (không cột nào trong bảng này thuộc danh sách "vết kiểm toán" của §4.2b — `employee_id` là business FK, không phải audit trail).
GRANT app: `SELECT, INSERT, UPDATE, DELETE` (SOC-DEC-006: rời/mời-ra-nhóm = DELETE cứng, vết nằm ở `audit_logs` object_type=`feed_group`, KHÔNG cột `status='removed'` — quyết định đã chốt ở DB-17 §4.9 dưới bảng, KHÔNG mở lại).

### 4.3 `feed_polls`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `post_id` | uuid | NOT NULL | — | `feed_posts(company_id,id)` | NO ACTION |
| `question` | varchar(500) | NOT NULL | — | — | — |
| `multiple_choice` | boolean | NOT NULL | `false` | — | — |
| `is_anonymous` | boolean | NOT NULL | `false` | — | — |
| `status` | varchar(16) | NOT NULL | `'open'` | — | — |
| `closes_at` | timestamptz | NULL | — | — | — |
| `closed_at` | timestamptz | NULL | — | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |

CHECK: `chk_feed_polls_status CHECK (status IN ('open','closed'))` · `chk_feed_polls_closed_pair CHECK (status = 'open' OR closed_at IS NOT NULL)` · **MỚI** `chk_feed_polls_closes_future CHECK (closes_at IS NULL OR closes_at > created_at)` (§0).
UNIQUE: `feed_polls_company_post_uq UNIQUE (company_id, post_id)` (1-1 với bài `type='poll'`) · `feed_polls_company_id_id_uq UNIQUE (company_id, id)`.
Index: `idx_feed_polls_open_deadline (company_id, closes_at) WHERE status='open' AND closes_at IS NOT NULL` (job đóng theo hạn quét qua đây).
Composite FK (1): `feed_polls_post_tenant_fk` NO ACTION.
GRANT app: `SELECT, INSERT, UPDATE`. **+ mediaos_worker: `SELECT`** (job đóng bình chọn — DB-17 §4.3).

### 4.4 `feed_poll_options`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `poll_id` | uuid | NOT NULL | — | `feed_polls(company_id,id)` | NO ACTION |
| `label` | varchar(255) | NOT NULL | — | — | — |
| `position` | smallint | NOT NULL | — | — | — |
| `vote_count` | integer | NOT NULL | 0 | — | — |

CHECK: `chk_feed_poll_options_vote_count CHECK (vote_count >= 0)`.
UNIQUE: `feed_poll_options_company_id_id_uq UNIQUE (company_id,id)` · `feed_poll_options_position_uq UNIQUE (company_id, poll_id, position)`.
Index: **KHÔNG có index rời** — `feed_poll_options_position_uq UNIQUE (company_id, poll_id, position)` đã sinh index ngầm trùng 100% (sửa sau FULL gate, M-1).
Composite FK (1): `feed_poll_options_poll_tenant_fk` NO ACTION.
GRANT app: `SELECT, INSERT, UPDATE`. **+ mediaos_worker: `SELECT`**.

> Lựa chọn **bất biến sau khi tạo poll** — service cấm sửa/thêm/xoá sau khi poll tồn tại (UNIQUE `position` không `DEFERRABLE`, sắp xếp lại bằng UPDATE sẽ va unique giữa chừng). Ràng buộc 2-10 lựa chọn ép ở SERVICE (`SOCIAL-ERR-018`) — CHECK cấp hàng không đếm được hàng anh em.

### 4.5 `feed_poll_votes` — PK tổ hợp, **cột `single_choice` mới (D1)**

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `poll_id` | uuid | NOT NULL | — | `feed_polls(company_id,id)` | NO ACTION |
| `option_id` | uuid | NOT NULL | — | `feed_poll_options(company_id,id)` | NO ACTION |
| `user_id` | uuid | NOT NULL | — | `users(company_id,id)` | NO ACTION |
| `single_choice` | boolean | NOT NULL | — (service ghi tường minh) | — | — |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — |

PK: `feed_poll_votes_pk PRIMARY KEY (company_id, poll_id, option_id, user_id)`.
UNIQUE INDEX (D1 — phương án A): `feed_poll_votes_single_uq UNIQUE (company_id, poll_id, user_id) WHERE single_choice`.
Index: `idx_feed_poll_votes_company_poll_user (company_id, poll_id, user_id)` — `(company_id, poll_id)` là prefix chặt của PK nên vô dụng (sửa sau FULL gate, M-2).
Composite FK (3): `feed_poll_votes_poll_tenant_fk` · `_option_tenant_fk` · `_user_tenant_fk` — cả 3 NO ACTION.
GRANT app: `SELECT, INSERT, DELETE` (đổi/rút phiếu = xoá+chèn trong cùng tx khi poll `open`; KHÔNG UPDATE). **+ mediaos_worker: `SELECT`**.

> ⚠️ `user_id` **lưu kể cả poll ẩn danh** nhưng KHÔNG BAO GIỜ ra DTO khi `is_anonymous=true` — kể cả `company-admin` (SOC-DEC-009). Lưới ở tầng repository (tập cột tường minh), ngoài phạm vi DB.
>
> ✅ **Cửa sổ DB-2 → BE-2 KHÔNG fail-open** (trả lời trước câu hỏi của FULL gate): nợ "chặn UPDATE `multiple_choice`/`is_anonymous`" nằm ở service, nhưng trong cửa sổ đó **không tồn tại đường ghi nào** vào `feed_poll_votes`/`feed_polls` — module `apps/api/src/social/**` chưa có, không route nào mở. Đây là **điều kiện phải có TRƯỚC khi BE-2 mở route**, không phải lỗ đang hở ở runtime.
>
> ✅ `ADD COLUMN single_choice boolean NOT NULL` **không DEFAULT** hợp lệ vì bảng vừa `CREATE` (0 hàng) — không vỡ INSERT nào đang có. Xem §6.1 về lý do cố ý không đặt DEFAULT.

### 4.6 `feed_ideas`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `post_id` | uuid | NOT NULL | — | `feed_posts(company_id,id)` | NO ACTION |
| `status` | varchar(16) | NOT NULL | — | — | — |
| `reviewed_by` | uuid | NULL | — | `users(company_id,id)` | **SET NULL (reviewed_by)** |
| `reviewed_at` | timestamptz | NULL | — | — | — |
| `review_note` | text | NULL | — | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |

CHECK: `chk_feed_ideas_status CHECK (status IN ('submitted','under_review','accepted','rejected'))` · `chk_feed_ideas_reviewed_pair CHECK (status IN ('submitted','under_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))` · `chk_feed_ideas_reject_note CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0))`.
UNIQUE: `feed_ideas_company_post_uq UNIQUE (company_id, post_id)` · `feed_ideas_company_id_id_uq UNIQUE (company_id, id)`.
Index: `idx_feed_ideas_company_status (company_id, status, created_at DESC)`.
Composite FK (2): `feed_ideas_post_tenant_fk` (NO ACTION) · `feed_ideas_reviewed_by_tenant_fk` (SET NULL).
GRANT app: `SELECT, INSERT, UPDATE`.

> FSM (`submitted → under_review → accepted/rejected`, `accepted`/`rejected` terminal) ép ở **SERVICE** bằng `assertIdeaTransition` (khuôn `assertPeriodTransition` PAYROLL) ⇒ `SOCIAL-ERR-019`. CHECK ở đây chỉ giữ tập giá trị + tính đầy đủ vết — KHÔNG giữ thứ tự chuyển (bẫy `check-cannot-enforce-fsm-transitions`).

### 4.7 `feed_kudos`

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `post_id` | uuid | NOT NULL | — | `feed_posts(company_id,id)` | NO ACTION |
| `badge_id` | uuid | NULL | — | `feed_kudos_badges(company_id,id)` | NO ACTION |
| `message` | text | NULL | — | — | — |
| `is_official` | boolean | NOT NULL | `false` | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |

Không CHECK bổ sung. UNIQUE: `feed_kudos_company_post_uq UNIQUE (company_id, post_id)` · `feed_kudos_company_id_id_uq UNIQUE (company_id, id)`.
Index: `idx_feed_kudos_company_created (company_id, created_at DESC)`.
Composite FK (2): `feed_kudos_post_tenant_fk` · `feed_kudos_badge_tenant_fk` — cả 2 NO ACTION.
GRANT app: `SELECT, INSERT, UPDATE`.

### 4.8 `feed_kudos_recipients` — PK tổ hợp

| Cột | Kiểu | NULL | FK | ON DELETE |
| --- | --- | --- | --- | --- |
| `kudos_id` | uuid | NOT NULL | `feed_kudos(company_id,id)` | NO ACTION |
| `employee_id` | uuid | NOT NULL | `employee_profiles(company_id,id)` | NO ACTION |

PK: `feed_kudos_recipients_pk PRIMARY KEY (company_id, kudos_id, employee_id)`.
Index: `idx_feed_kudos_recipients_company_emp (company_id, employee_id)`.
Composite FK (2): `feed_kudos_recipients_kudos_tenant_fk` · `_employee_tenant_fk` — cả 2 NO ACTION.
GRANT app: `SELECT, INSERT, DELETE` (sửa bài kudos ⇒ gán lại người nhận; KHÔNG UPDATE).

### 4.9 `feed_kudos_badges` — catalog, per-company

| Cột | Kiểu | NULL | Default | FK | ON DELETE |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | — |
| `code` | varchar(32) | NOT NULL | — | — | — |
| `name` | varchar(255) | NOT NULL | — | — | — |
| `description` | text | NULL | — | — | — |
| `icon` | varchar(64) | NULL | — | — | — |
| `is_active` | boolean | NOT NULL | `true` | — | — |
| `position` | smallint | NOT NULL | — | — | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | `now()` | — | — |
| `created_by`/`updated_by` | uuid | NULL | — | `users(company_id,id)` | **SET NULL (\<cột\>)** |

Không CHECK. UNIQUE: `feed_kudos_badges_company_code_uq UNIQUE (company_id, code)` · `feed_kudos_badges_company_id_id_uq UNIQUE (company_id, id)`.
Index: `idx_feed_kudos_badges_company_active (company_id, is_active, position)`.
Composite FK (2): `feed_kudos_badges_created_by_tenant_fk` · `_updated_by_tenant_fk` — cả 2 SET NULL.
GRANT app: `SELECT, INSERT, UPDATE` — **xoá = `UPDATE is_active=false`, KHÔNG hard-delete** (BẤT BIẾN #2; đây là catalog nên không có `deleted_at`).

### 4.10 Bảng tuple composite FK — **21 dòng** (20 Track B + 1 additive `feed_posts_group_fk`)

VERIFY dùng bảng tuple `EXCEPT` hai chiều (khuôn `0559`/`0577` của DB-1) — **không số trần**. `deltype 'a'` = NO ACTION (15 dòng), `'n'` = SET NULL (6 dòng, đúng-bằng danh sách dưới).

> 🔴 **PHẠM VI CỦA TẬP `actual` — chỗ dễ sai nhất của cả file** (plan-review 21/09/2026, đã kiểm chứng): `feed_posts` **ĐÃ CÓ SẴN 6 composite FK** từ `0577` (`0577:747-752`: `author_user_id`·`author_employee_id`·`org_unit_id`·`created_by`·`updated_by`·`deleted_by`), và `0577:779` tự chốt `= 26` cho 10 bảng Track A.
> ⇒ Nếu `actual` lấy nguyên `conrelid IN (9 bảng Track B + feed_posts)` thì số đo là **27**, KHÔNG phải 21, và `EXCEPT` sẽ báo **6 dòng "THỪA"** của Track A ⇒ **RAISE sai ⇒ chặn migrate**.
> **Cách viết đúng — thu hẹp `actual` theo PHẠM VI SỞ HỮU của `0580`** (`invariant-count-must-filter-owned-rows`):
> ```sql
> WHERE c.contype = 'f'
>   AND ( c.conrelid = ANY (ARRAY['feed_groups','feed_group_members','feed_polls','feed_poll_options',
>                                 'feed_poll_votes','feed_ideas','feed_kudos','feed_kudos_recipients',
>                                 'feed_kudos_badges']::regclass[])
>         OR c.conname = 'feed_posts_group_fk' )   -- ← dòng DUY NHẤT của Track A mà 0580 sở hữu
> ```
> Với phạm vi đó, **`expected` = đúng 21 dòng** dưới đây và assert đếm thô `= 21` mới đúng.

| # | Bảng | Cột | Đích | `confdeltype` | `confdelsetcols` |
| --- | --- | --- | --- | :---: | --- |
| 1 | `feed_groups` | `avatar_file_id` | `files` | `a` | — |
| 2-4 | `feed_groups` | `created_by`·`updated_by`·`deleted_by` | `users` | **`n`** | `ARRAY['<cột>']` |
| 5-7 | `feed_group_members` | `group_id`·`user_id`·`employee_id` | `feed_groups`·`users`·`employee_profiles` | `a` | — |
| 8 | `feed_polls` | `post_id` | `feed_posts` | `a` | — |
| 9 | `feed_poll_options` | `poll_id` | `feed_polls` | `a` | — |
| 10-12 | `feed_poll_votes` | `poll_id`·`option_id`·`user_id` | `feed_polls`·`feed_poll_options`·`users` | `a` | — |
| 13 | `feed_ideas` | `post_id` | `feed_posts` | `a` | — |
| 14 | `feed_ideas` | `reviewed_by` | `users` | **`n`** | `ARRAY['reviewed_by']` |
| 15-16 | `feed_kudos` | `post_id`·`badge_id` | `feed_posts`·`feed_kudos_badges` | `a` | — |
| 17-18 | `feed_kudos_recipients` | `kudos_id`·`employee_id` | `feed_kudos`·`employee_profiles` | `a` | — |
| 19-20 | `feed_kudos_badges` | `created_by`·`updated_by` | `users` | **`n`** | `ARRAY['<cột>']` |
| 21 | `feed_posts` (Track A, additive) | `group_id` | `feed_groups` | `a` | — |

Assert phụ (khuôn `0577`): (a) đếm thô `= 21` **trên đúng tập `actual` đã thu hẹp ở trên** (KHÔNG phải trên nguyên `feed_posts`); (b) `0` FK một-cột tới bảng khác `companies` **trên 9 bảng Track B** (`feed_posts` do `0577` canh, không đo lại); (c) dòng #21 (`feed_posts_group_fk`) hậu-kiểm **0 hàng mồ côi** `feed_posts WHERE audience='group' AND group_id IS NOT NULL AND NOT EXISTS (...feed_groups...)` TRƯỚC khi phát `ALTER` — RAISE nếu có, KHÔNG âm thầm bỏ qua (đây chính là "tính năng" mà DB-1 dự đoán: cửa sổ DB-1→DB-2 để lọt hàng mồ côi thì migration này tự chặn).

---

## §5. NOTI — 9 sự kiện `NOTI-EVENT-028..036` + nới 4 CHECK

### 5.1 Nới CHECK (khuôn `0566` khối B/C, file `0581` khối A)

Idempotent theo khuôn: `IF pg_get_constraintdef(...) LIKE '%''SOCIAL''%' THEN NOTICE skip ELSE DROP+ADD`. **`notifications` giữ nhánh `IS NULL OR`** ở cả 2 CHECK (verify phải RAISE nếu mất nhánh này — khuôn `0573` khối D dòng cuối). Giá trị hiện có chép nguyên văn từ M14, KHÔNG gõ lại từ trí nhớ (bẫy `audit-check-union-parse-anchor-trap`).

```
chk_notification_events_module_code += 'SOCIAL'
chk_notification_events_type        += 'Social'
chk_notifications_module_code       += 'SOCIAL'   (giữ IS NULL OR)
chk_notifications_notification_type += 'Social'   (giữ IS NULL OR)
```

### 5.2 Insight về dedupe — ĐỌC TRƯỚC KHI VIẾT KHOÁ (tránh nhét thừa `user_id`)

`NotificationDedupeService.computeKey`/`isDuplicate` (`apps/api/src/notifications/notification-dedupe.service.ts:71-113`) chống trùng theo tuple **`(company_id, recipient_user_id, event_code, dedupe_key)`** — `recipient_user_id` **đã là một cột riêng trong tuple**, không nằm trong chuỗi `dedupe_key`. Với sự kiện broadcast nhiều người nhận (031 tin tức, 033 vinh danh, 036 báo cáo), **mỗi người nhận có một hàng `notifications` riêng** ⇒ `dedupe_key` chỉ cần content-derived theo **đối tượng** (post/kudos/report), KHÔNG cần nhét `user_id` vào chuỗi — nhét thêm là thừa, không sai nhưng gây hiểu lầm khi đọc lại. Bảng dưới do đó ghi khoá dưới dạng "phần sau `{eventCode}:`" (engine tự ghép tiền tố).

### 5.3 Catalog 9 sự kiện (company_id NULL — global, khuôn `0573` khối B)

⚠️ **Cột của `notification_events` KHÁC cột của `notification_templates`** (plan-review 21/09/2026): `target_url_template` · `title_template` · `body_template` · `short_body_template` · `variables_schema` thuộc **`notification_templates`** (`0573:63-65,95-96`); `event_name` · `module_code` · `notification_type` · `default_priority` · `default_channels` · `is_enabled` · `is_system_event` · `dedupe_strategy` · `dedupe_window_seconds` thuộc **`notification_events`** (`0573:47-49`). Viết lẫn ⇒ `42703`. Bảng dưới CHỈ có cột của `notification_events`; phần template ở §5.4.

| Mã | `event_code` | `event_name` (vi) | `notification_type` | `default_priority` | `is_system_event` | `dedupe_strategy` | Dedupe key (phần sau `{eventCode}:`) |
| --- | --- | --- | --- | :---: | :---: | --- | --- |
| 028 | `SOCIAL_MENTIONED` | Có người nhắc tên bạn | Social | Normal | false | DedupeKey | `{target_type}:{target_id}` |
| 029 | `SOCIAL_POST_COMMENTED` | Bài của bạn có bình luận mới | Social | Normal | false | DedupeKey | `{comment_id}` |
| 030 | `SOCIAL_COMMENT_REPLIED` | Bình luận của bạn có trả lời | Social | Normal | false | DedupeKey | `{comment_id}` |
| 031 | `SOCIAL_NEWS_PUBLISHED` | Tin tức công ty mới | Social | High | false | DedupeKey | `{post_id}` |
| 032 | `SOCIAL_IDEA_STATUS_CHANGED` | Sáng kiến đổi trạng thái | Social | Normal | false | DedupeKey | `{idea_id}:{status}` |
| 033 | `SOCIAL_KUDOS_RECEIVED` | Bạn được vinh danh | Social | Normal | false | DedupeKey | `{kudos_id}` |
| 034 | `SOCIAL_GROUP_JOIN_DECIDED` | Kết quả yêu cầu vào nhóm | Social | Normal | false | **`None`** (xem dưới) | — |
| 035 | `SOCIAL_POLL_CLOSED` | Bình chọn đã đóng | Social | Low | **true** | DedupeKey | `{poll_id}` |
| 036 | `SOCIAL_POST_REPORTED` | Có bài bị báo cáo | Social | High | false | DedupeKey | `{report_id}` |

Mọi mã: `module_code='SOCIAL'`, `default_channels='["IN_APP"]'::jsonb` (SPEC-16 §17.2 — chỉ trong-app), `is_enabled=true`, `dedupe_window_seconds=NULL`.

**Ghi chú từng khoá:**
- **028 BỎ `mentioned_user_id` khỏi khoá** (bản trước có — thừa): `NotificationDedupeService` chống trùng theo tuple `(company_id, recipient_user_id, event_code, dedupe_key)` với `recipient_user_id` là **cột riêng** (`notification-dedupe.service.ts:36-39,102-116`) ⇒ hai người được mention trong cùng một bài đã tách nhau sẵn. Nhét thêm vào chuỗi chỉ gây hiểu nhầm khoá phụ thuộc người nhận.
- **032 `{idea_id}:{status}` an toàn**: SPEC-16 §13.3 chốt `accepted`/`rejected` là **terminal**, không có đường quay lại ⇒ mỗi `status` phát tối đa một lần cho một sáng kiến.
- **035 `is_system_event=true`**: do **job** đóng bình chọn theo hạn phát ra, không phải người — khuôn `ROOM_BOOKING_REMINDER` (`notification-event-catalog.const.ts:158`).
- 🔴 **034 dùng `dedupe_strategy='None'`, KHÔNG phải DedupeKey** (sửa theo plan-review): bản trước đặt khoá `{group_id}:{decided_at_iso}` — **`decided_at` KHÔNG TỒN TẠI** trong `feed_group_members` (§4.2 / DB-17 §7.2), và nhánh **từ chối xoá cứng hàng** (DB-17 §4.9 "DELETE CỨNG, có chủ ý") nên **không có nguồn bền vững nào** phủ được cả hai nhánh: producer chỉ còn cách lấy `now()` ⇒ outbox retry đẻ thông báo trùng — đúng bài học `idempotency-key-must-be-content-derived`.
  Cân nhắc hai hướng hỏng: khoá sai ⇒ **nuốt mất** quyết định thứ hai hợp lệ (xin-vào → từ chối → xin lại → duyệt); `None` ⇒ **trùng** một thông báo khi outbox retry. Mất thông báo tệ hơn trùng thông báo ⇒ chọn `None`. `None` là lựa chọn **thường dùng, không ngoại lệ**: 56/79 event global hiện đang dùng (đo trên lane DB 21/09/2026).
  **Nợ ghi vào §10:** nếu BE-2 thêm bảng nhật ký yêu cầu vào nhóm (có `decided_at` bền vững) thì nâng 034 lên `DedupeKey` bằng một migration nhỏ.

### 5.4 Template IN_APP/vi-VN (khuôn `0573` khối C — KHÔNG biến tiền/PII)

Mọi hàng: `company_id=NULL`, `channel='IN_APP'`, `locale='vi-VN'`, `status='Active'`, `is_default=true`, `template_code = {event_code}__IN_APP__vi-VN`, `event_id` JOIN theo `event_code` (khuôn `0573` khối C).

| `event_code` | `title_template` | `body_template` | `short_body_template` | `target_url_template` | `variables_schema` (keys) |
| --- | --- | --- | --- | --- | --- |
| `SOCIAL_MENTIONED` | `{actor_name} đã nhắc tên bạn` | `{actor_name} đã nhắc tên bạn trong một {target_type_label}. Mở để xem.` | `Bạn được nhắc tên` | `/social/posts/{post_id}` | `actor_name, target_type_label, post_id` |
| `SOCIAL_POST_COMMENTED` | `Bài của bạn có bình luận mới` | `{actor_name} đã bình luận vào bài viết của bạn.` | `Có bình luận mới` | `/social/posts/{post_id}` | `actor_name, post_id` |
| `SOCIAL_COMMENT_REPLIED` | `Bình luận của bạn có trả lời` | `{actor_name} đã trả lời bình luận của bạn.` | `Có trả lời mới` | `/social/posts/{post_id}` | `actor_name, post_id` |
| `SOCIAL_NEWS_PUBLISHED` | `Tin tức mới: {post_title}` | `{actor_name} đã đăng một tin tức công ty. Mở để đọc.` | `Tin tức công ty mới` | `/social/posts/{post_id}` | `actor_name, post_title, post_id` |
| `SOCIAL_IDEA_STATUS_CHANGED` | `Sáng kiến của bạn: {status_label}` | `Sáng kiến của bạn đã chuyển sang trạng thái «{status_label}».` | `Sáng kiến {status_label}` | `/social/posts/{post_id}` | `status_label, post_id` |
| `SOCIAL_KUDOS_RECEIVED` | `Bạn được vinh danh` | `{actor_name} đã gửi lời vinh danh tới bạn.` | `Bạn được vinh danh` | `/social/posts/{post_id}` | `actor_name, post_id` |
| `SOCIAL_GROUP_JOIN_DECIDED` | `Yêu cầu vào nhóm {group_name}: {decision_label}` | `Yêu cầu tham gia nhóm «{group_name}» của bạn đã được {decision_label}.` | `Yêu cầu vào nhóm {decision_label}` | `/social/groups/{group_id}` | `group_name, decision_label, group_id` |
| `SOCIAL_POLL_CLOSED` | `Bình chọn của bạn đã đóng` | `Bình chọn «{poll_question}» đã đóng. Mở để xem kết quả.` | `Bình chọn đã đóng` | `/social/posts/{post_id}` | `poll_question, post_id` |
| `SOCIAL_POST_REPORTED` | `Có nội dung bị báo cáo` | `Một {target_type_label} vừa bị báo cáo với lý do «{reason_label}». Mở hàng đợi kiểm duyệt.` | `Có nội dung bị báo cáo` | `/social/reports` | `target_type_label, reason_label` |

⚠️ Yêu cầu bắt buộc: **không** biến số tiền/lương/PII; **không** lộ `user_id` bỏ phiếu ẩn danh; **không** nhúng `review_note` (nội dung tự do của người duyệt) vào body — chỉ `status_label`. Biến `*_label` là nhãn tiếng Việt do producer dựng, không phải mã máy.

### 5.5 VERIFY (`0581` khối D — khuôn `0573`)

Set-equality 9 mã theo `event_code` (THIẾU/THỪA); mỗi event đúng dedupe/enabled/system/type/priority theo bảng §5.3; đúng 9 template; regex chặn biến tiền `(amount|salary|gross|net|total|tien)` trên `variables_schema` keys; CHECK giữ `IS NULL OR` trên `notifications`.

### 5.6 Cập nhật code cùng commit

`apps/api/src/foundation/seed/notification-event-catalog.const.ts`: thêm khối `// ===== SOCIAL (SPEC-16 §17.1 · NOTI-EVENT-028..036 · mig 0581 · S16-SOCIAL-DB-2) =====` với 9 dòng `{ module: "SOCIAL", eventCode: "...", type: "Social", priority: "...", isEnabled: true, isSystemEvent: ... }, // prettier-ignore`; sửa 2 comment đếm: `NOTI_EVENT_COUNT = 79` → **88** (`+ 9 SOCIAL 0581`), `NOTI_ENABLED_EVENT_COUNT = 65` → **74**.

---

## §6. Hạ tầng test + app phải cập nhật

### 6.1 `apps/api/test/integration/rls-registry.ts` — +9 case

6 bảng có cột `id` (đăng ký như thường): `feed_groups`, `feed_polls`, `feed_poll_options`, `feed_ideas`, `feed_kudos`, `feed_kudos_badges`.
3 bảng PK tổ hợp (M12) — `idColumn` khai rõ, chọn cột **mới-tạo-mỗi-lần-seed** (khuôn `feed_saved_posts`→`post_id`):

| Bảng | `idColumn` | Lý do |
| --- | --- | --- |
| `feed_group_members` | `group_id` | mỗi `seedRow` tạo 1 `feed_groups` mới — cột phân biệt tự nhiên nhất, khuôn cách DB-1 chọn `post_id` (bảng nguồn mới nhất) thay vì `user_id`/`tag_id` (tái dùng) |
| `feed_poll_votes` | `poll_id` | tương tự — mỗi `seedRow` tạo 1 `feed_polls` mới |
| `feed_kudos_recipients` | `kudos_id` | tương tự — mỗi `seedRow` tạo 1 `feed_kudos` mới |

`seedRow` mỗi case cần dựng đủ chuỗi FK (post → group/poll/kudos → hàng đích) qua pool `direct`, khuôn `seedFeedChain` sẵn có trong file — viết thêm helper `seedFeedGroupChain`/`seedFeedPollChain`/`seedFeedKudosChain` nếu chuỗi dựng lặp lại ≥ 3 lần (DRY).

⚠️ **`single_choice` KHÔNG có DEFAULT — mọi INSERT phải truyền tường minh.** `seedRow` của `feed_poll_votes` và **mọi** câu INSERT trong int-spec/fixture phải ghi `single_choice`, nếu không ăn `23502 (not_null_violation)` ngay ca đầu. Việc không đặt DEFAULT là **cố ý**: `DEFAULT false` sẽ biến một lần quên ghi của BE-2 thành **vô hiệu hoá chốt chống-phiếu-đôi im lặng** (fail-open); không DEFAULT ⇒ hỏng thì hỏng ồn ào (fail-closed).

### 6.2 `apps/api/test/helpers/seed.ts` `cleanupTenants()` — thay khối Track A hiện tại (dòng 612-630) bằng khối Track A+B hợp nhất

Thứ tự **con → cha**, tôn trọng CẢ FK cũ (Track A) LẪN FK mới (`feed_posts_group_fk`, và các FK nội bộ Track B trỏ vào `feed_posts`/`feed_groups`/`feed_kudos`/`feed_polls`):

```
DELETE FROM feed_poll_votes        WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_poll_options      WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_kudos_recipients  WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_ideas             WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_kudos             WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_polls             WHERE company_id = ANY($1::uuid[]);
-- ↑ 6 dòng MỚI — TRƯỚC feed_posts (Track B trỏ vào feed_posts qua post_id NO ACTION)
DELETE FROM feed_reports           WHERE company_id = ANY($1::uuid[]);   -- Track A, không đổi
DELETE FROM feed_mentions          WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_reactions         WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_post_acks         WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_post_views        WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_saved_posts       WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_post_tags         WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_comments          WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_posts             WHERE company_id = ANY($1::uuid[]);   -- ⚠️ nay CÒN bị feed_groups giữ (group_id FK) — PHẢI xoá TRƯỚC feed_groups
DELETE FROM feed_tags              WHERE company_id = ANY($1::uuid[]);
-- ↓ 3 dòng MỚI — SAU feed_posts, TRƯỚC feed_groups
DELETE FROM feed_group_members     WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_kudos_badges      WHERE company_id = ANY($1::uuid[]);
DELETE FROM feed_groups            WHERE company_id = ANY($1::uuid[]);   -- LÁ CUỐI: feed_posts.group_id VÀ feed_group_members.group_id đều đã xoá
```

🔴 **DỜI CẢ KHỐI LÊN TRƯỚC `DELETE FROM file_access_logs` (dòng 457)** — KHÔNG để nguyên chỗ cũ (dòng 612) (plan-review 21/09/2026, đã kiểm chứng):
`feed_groups.avatar_file_id → files (company_id,id) NO ACTION` là **FK feed→files ĐẦU TIÊN** (Track A không có FK nào tới `files` — `grep files 0577` = 0). Mà `DELETE FROM files` nằm ở **dòng 459, đầu hàm**, còn khối feed ở **dòng 612-630**. Bất kỳ hàng `feed_groups` nào mang `avatar_file_id` ⇒ `DELETE FROM files` ăn **`23503`** ⇒ teardown đỏ của **MỌI** int-spec dùng chung helper, không chỉ SOCIAL.
⇒ **Phương án đã chốt:** chuyển nguyên khối 19 dòng lên ngay **trước** dòng 457 (`DELETE FROM file_access_logs`), giữ nguyên thứ tự nội bộ. Điều này vẫn thoả ràng buộc cũ (`org_units` xoá ở dòng 726, `users` ở 831 — đều SAU) nên không phá gì.
Comment header mới phải nêu **cả hai** lý do: `feed_posts.org_unit_id → org_units` (cũ) **và** `feed_groups.avatar_file_id → files` (mới, là lý do khối phải lên đầu). Bài học `seed.ts:515-517`: **VỊ TRÍ QUAN TRỌNG HƠN SỰ CÓ MẶT**.

### 6.3 `apps/api/src/foundation/retention/retention.service.ts` `PROTECTED_TABLES` — +9

Áp đúng 4 tiêu chí DB-17 §10 (không suy từ con số) lên 9 bảng:

| Tiêu chí | Bảng | Vì sao |
| --- | --- | --- |
| (2) không GRANT DELETE | `feed_groups`, `feed_polls`, `feed_poll_options`, `feed_ideas`, `feed_kudos`, `feed_kudos_badges` | retention DELETE sẽ ăn `42501` uncaught, hỏng cả lượt cleanup tenant |
| (4) CÓ GRANT DELETE, retention lọc theo `created_at` sẽ xoá cứng hàng đang sống | `feed_group_members`, `feed_poll_votes` | membership/phiếu là trạng thái hiện tại, không phải ledger — xoá theo tuổi tạo sẽ mất thành viên cũ/phiếu cũ đang hợp lệ, không đảo ngược được, không audit. **Cả hai bảng CÓ `created_at`** ⇒ `_deleteEligible` chạy được thật ⇒ tập này là **lớp phòng thủ DUY NHẤT** |
| (4) biến thể — CÓ GRANT DELETE nhưng **KHÔNG có cột `created_at`** | `feed_kudos_recipients` | ⚠️ **Lý do khác hai bảng trên** (plan-review 21/09/2026): bảng chỉ có 3 cột `company_id`·`kudos_id`·`employee_id` (§4.8, DB-17 §7.8) ⇒ `_deleteEligible` lọc `created_at < cutoff` sẽ ăn **`42703` (undefined_column)** trước khi tới guard. Bảng **vẫn phải** vào tập (chống-mất-dữ-liệu nguyên vẹn: người-nhận-kudos là trạng thái hiện tại), nhưng **KHÔNG được đọc thành "đã chặn 42xxx uncaught"** — chép nguyên khuôn đính chính DB-1 đã viết cho `feed_post_tags`/`feed_post_views`/`feed_post_acks` (`retention.service.ts:130-136`) |

> `feed_poll_options` cũng **không có `created_at`** nhưng xếp nhóm (2) (không GRANT DELETE) nên không vướng — ghi 1 dòng comment để reviewer sau không phải suy lại.

⇒ **9/9 bảng Track B vào `PROTECTED_TABLES`**, cộng 10 bảng Track A đã có ở DB-1 ⇒ tổng **19/19** — khớp nguyên văn SPEC-16 §16 ("19 bảng mới phải vào `RetentionService.PROTECTED_TABLES` cùng lượt migration").

### 6.4 `apps/api/src/db/schema/social.ts` — append 9 bảng (PARITY-only, KHÔNG `db:generate`)

Nối tiếp file hiện có (đã có 10 bảng Track A + docblock giải thích BẤT BIẾN #1/#2/#3). Thêm:
- Enum TS mirror: `FeedGroupVisibility`, `FeedGroupRole`, `FeedGroupMemberStatus`, `FeedPollStatus`, `FeedIdeaStatus`.
- 9 `pgTable(...)` theo cột/CHECK/UNIQUE/PK/index ở §4 — `.references()` một cột chỉ để suy kiểu TS (composite FK thật ở SQL, đúng docblock hiện có dòng 30-32).
- Cập nhật docblock đầu file: thêm đoạn giải thích Track B + liệt kê 9 bảng vào nhóm `PROTECTED_TABLES` (khớp §6.3), và xoá dòng "⚠️ CHƯA có FK" của `feedPosts.groupId` — thay bằng `.references(() => feedGroups.id)` thật (không còn ngoại lệ nữa).
- `apps/api/src/db/schema/index.ts`: **không cần dòng export mới** — `export * from "./social"` đã có từ DB-1, các export mới tự động lộ ra.

### 6.5 `packages/contracts/src/social.ts` — append enum + core schema

- 5 enum Zod mirror §8 DB-17: `feedGroupVisibilitySchema`, `feedGroupRoleSchema`, `feedGroupMemberStatusSchema`, `feedPollStatusSchema`, `feedIdeaStatusSchema`.
- `feedGroupMemberCoreSchema` — mirror `chk_feed_group_members_pending_role` bằng `.superRefine()` (status='pending' ⇒ role phải 'member').
- `feedPollCoreSchema` — mirror `chk_feed_polls_closed_pair` bằng `.superRefine()` (status='closed' ⇒ closedAt bắt buộc). **NGOẠI LỆ THỨ HAI của luật mirror** (thứ nhất là emoji): `chk_feed_polls_closes_future` KHÔNG mirror đúng-bằng được — `created_at` chưa tồn tại tại thời điểm validate request (DB set trong cùng câu INSERT), Zod chỉ xấp xỉ bằng `closesAt > new Date()` tại tầng service; DB CHECK là lưới cuối chống ghi tay/lỗi giờ máy chủ. Ghi rõ trong comment, tránh reviewer sau đọc nhầm thành "thiếu superRefine".
- `feedIdeaCoreSchema` — mirror `chk_feed_ideas_reviewed_pair` + `chk_feed_ideas_reject_note` bằng `.superRefine()`.
- Cập nhật `social.spec.ts`: thêm mảng literal **chép tay từ migration `0580`** (không import từ schema drizzle — tránh tautology, khuôn hiện có) cho 5 enum mới; đảm bảo mirror **hai chiều** (DB thừa ⇒ đỏ, Zod thừa ⇒ đỏ) — kiểm tay 1 lần bằng cách lệch 1 giá trị mỗi chiều, xác nhận đỏ, revert.

### 6.6 `harness/backlog.mjs` — sửa cùng PR (đã trong `paths`)

1. `title` của `S16-SOCIAL-DB-2`: bỏ cụm "cặp manage/approve còn thiếu" (M2 — DB-1 đã seed đủ 14/43).
2. `done_when` #3: "≥6 mã hệ thống" → "5 mã hệ thống theo DB-17 §7.9 (…), không xoá, cho công ty hiện có" (D3).
3. `notes` của **S16-SOCIAL-BE-2** += nợ D2 (seeder `social.master-data`).
4. `status` để ledger tự đóng dấu sau khi merge (không sửa tay).

---

## §7. Test — `apps/api/test/integration/s16-social-db2-invariants.int-spec.ts`

Chạy trên LANE_DB, pool `direct` (owner) cho constraint/RI, pool `app` (dưới GUC) cho ACL/RLS/`WITH CHECK` — khuôn DB-1.

**Nhóm 1 — RLS cô lập 2 tenant (9 bảng):** không GUC ⇒ 0 hàng (qua `rls-registry.ts` tự động, §6.1); `WITH CHECK` — dưới GUC tenant A, `INSERT feed_groups(company_id=B)` ⇒ vi phạm RLS policy.

**Nhóm 2 — CHECK từng giá trị + đối chứng ÂM:** `visibility` sai giá trị ⇒ `23514`; `role`/`status` sai; `chk_feed_group_members_pending_role` (status='pending' AND role='admin' ⇒ đỏ; status='pending' AND role='member' ⇒ ALLOW); `chk_feed_polls_closed_pair` (status='closed' AND closed_at IS NULL ⇒ đỏ); `chk_feed_polls_closes_future` (closes_at < created_at ⇒ đỏ; closes_at IS NULL ⇒ ALLOW; closes_at > created_at ⇒ ALLOW); `chk_feed_ideas_status`/`_reviewed_pair`/`_reject_note` (3 ca đỏ + 3 đối chứng ALLOW, gồm ca "rejected không có review_note" ⇒ đỏ, "rejected có review_note" ⇒ ALLOW).

**Nhóm 3 — UNIQUE/PK chống trùng (đúng `contype`, không viết `'u'` trơn — bẫy DB-1):** `feed_group_members_pk` (contype `p`) dup ⇒ `23505`; `feed_polls_company_post_uq`/`feed_ideas_company_post_uq`/`feed_kudos_company_post_uq` (contype `u`) dup ⇒ `23505`; `feed_poll_options_position_uq` dup ⇒ `23505`; `feed_poll_votes_pk` (contype `p`) dup ⇒ `23505`; `feed_kudos_recipients_pk` (contype `p`) dup; `feed_kudos_badges_company_code_uq` dup; `feed_groups_company_name_uq` — **partial UNIQUE INDEX** (không trong `pg_constraint`, so `pg_get_expr(indpred)` đúng chuỗi qua `pg_index`) — trùng tên khác hoa/thường (`lower(name)`) ⇒ `23505`.

**Nhóm 4 — Partial unique một-phiếu (D1):** poll `multiple_choice=false`: 2 lần vote khác `option_id` cùng `(poll,user)` với `single_choice=true` ⇒ `23505` trên `feed_poll_votes_single_uq`; đối chứng: poll `multiple_choice=true`, `single_choice=false`, 2 hàng khác `option_id` cùng `(poll,user)` ⇒ ALLOW (partial index không áp).

**Nhóm 5 — GRANT append-only/thiếu DELETE:** `feed_groups`/`feed_polls`/`feed_poll_options`/`feed_ideas`/`feed_kudos`/`feed_kudos_badges` — thử DELETE thật dưới app role ⇒ `42501`; `feed_group_members` — DELETE thật ⇒ thành công (positive check, khớp GRANT); `feed_poll_votes`/`feed_kudos_recipients` — DELETE thành công NHƯNG UPDATE thật ⇒ `42501` (2 bảng này KHÔNG có GRANT UPDATE).

**Nhóm 6 — Composite FK chặn chéo tenant:** tenant A/B; qua `direct`, `INSERT feed_group_members(company_id=A, user_id=<user của B>)` ⇒ `23503`; tương tự 1 ca cho `feed_poll_votes.user_id`, 1 ca cho `feed_kudos_recipients.employee_id`.

**Nhóm 7 — Mirror Zod ↔ CHECK hai chiều:** `social.spec.ts` (§6.5) đỏ khi lệch 1 giá trị mỗi chiều cho 5 enum mới — kiểm tay 1 lần trong PR.

**Nhóm 8 — Cổng tự lên nòng của DB-1 (KHÔNG viết test mới ở đây):** chạy lại `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts` (đặc biệt describe `§7.5 · nợ group_id → DB-2`) trên **cùng LANE_DB** sau khi `0580` chạy — xác nhận **nhánh ĐÃ ĐỔI** từ "chưa có FK" sang "có FK bắt buộc" và **PASS** cả 2 `it()` (composite FK đúng `confdeltype='a'`/2 cột, và 0 hàng mồ côi). Baseline trước khi sửa: **45/45 PASS** (M13). Ghi rõ trong PR description, KHÔNG lặp lại logic này trong file mới.

**Nhóm 9 — ACL/worker:** `mediaos_worker` có `SELECT` (không hơn) trên `feed_polls`/`feed_poll_options`/`feed_poll_votes` qua `aclexplode`.

**Nhóm 10 — Idempotency (thu hẹp đúng phạm vi, khuôn DB-1):** chạy lại `0581` + `0582` ⇒ 0 exception, count không đổi. **`0580` chạy lại PHẢI `RAISE`** (tiền-kiểm `to_regclass` fail-loud, giống `0577`) — tính năng, không phải lỗi.

**Nhóm 11 — `PROTECTED_TABLES` (unit-spec, không cần DB):** thêm hằng `SOCIAL_TRACK_B_TABLES` (9 tên) + `it.each` set-membership + ca đếm **`toHaveLength(9)`** + ca `deletedRecords=0` — khuôn `retention.service.spec.ts:445-473` (DB-1 dùng `toHaveLength(10)`). Đếm đúng-bằng để một WO sau xoá nhầm một tên thì đỏ.

**Nhóm 12 — HỒI QUY VĨNH VIỄN (bắt buộc: migration verify chỉ chạy MỘT lần, spec chạy mãi):** khuôn DB-1 `s16-social-db1-invariants.int-spec.ts:771-782` (ACL) · `:845-866` (DEFAULT GUC) · `:868-884` (FK) · `:886-906` (RLS/FORCE). Năm ca, áp lên 9 bảng Track B:
- (a) `relrowsecurity` **và** `relforcerowsecurity` = true + có policy `tenant_isolation` (qua `pg_class`/`pg_policy`);
- (b) pin tuple/đếm composite FK **= 21** ở tầng spec (cùng phạm vi thu hẹp như §4.10);
- (c) ACL `mediaos_app` **đúng-bằng** per bảng qua `aclexplode` (`toEqual`, không `toContain`);
- (d) `company_id` NOT NULL + DEFAULT literal-GUC **đúng chuỗi** trên cả 9;
- (e) **0** ACL cấp cột.
> Không có nhóm này, một WO sau `GRANT DELETE ON feed_groups`, tắt `FORCE`, hay đổi `SET NULL (col)` thành `SET NULL` trần sẽ **không có gì đỏ**.

**Nhóm 13 — Seed huy hiệu (bằng chứng DUY NHẤT cho `done_when` #3):** vì `0582` là **no-op trên mọi lane DB/CI** (0 company lúc migrate — xem §3), toàn bộ done_when này **không có bằng chứng tự động** nếu không có ca này. Ca: `seedCompany()` tạo company thật → chạy **cùng thân SQL seed của `0582`** (tách thành hằng chuỗi dùng chung giữa migration và spec, hoặc chép nguyên câu kèm comment trỏ `0582`) → assert set-equality đúng 5 mã `teamwork/innovation/customer-first/mentor/above-beyond`, `is_active=true`, `position` 1..5 → chạy lần hai, assert count **không đổi** (idempotent) → 2 tenant, assert badge của A không lộ sang B.

> **Ngoài phạm vi DB int-spec (nợ sang BE-2, xem §10):** bất biến `multiple_choice`/`is_anonymous` sau khi tạo poll là luật SERVICE (chặn ở PATCH endpoint) — DB không tự kiểm được (partial unique không đọc bảng khác); test cho luật này thuộc QA của BE-2.

---

## §8. Thứ tự thi công + lệnh verify

1. Đo lại `apps/api/migrations/meta/_journal.json` — xác nhận head vẫn `idx 246 = 0579` (nếu lệch, dời số theo §3, giữ thứ tự nội bộ).
2. Viết `s16-social-db2-invariants.int-spec.ts` **TRƯỚC** khi chốt migration (RED trên schema nháp — CLAUDE §9).
3. Viết `0580` → `0581` → `0582` → `0583` theo §3/§4/§5, cập nhật journal ngay, kiểm tra `_journal.json` có đủ **4** entry mới (idx 247-250).
4. Cùng commit:
   - `apps/api/src/db/schema/social.ts` (§6.4) · `packages/contracts/src/social.ts` + `social.spec.ts` (§6.5)
   - `apps/api/test/integration/rls-registry.ts` (§6.1) · `apps/api/test/helpers/seed.ts` `cleanupTenants()` **dời lên trước dòng 457** (§6.2)
   - `apps/api/src/foundation/retention/retention.service.ts` `PROTECTED_TABLES` (§6.3) · `apps/api/src/foundation/seed/notification-event-catalog.const.ts` (§5.6)
   - 🔴 **`apps/api/src/db/schema/audit.ts` — `AUDIT_OBJECT_TYPES` += `"feed_kudos_badge"`** (append cuối khối, giữ thứ tự). **Bắt buộc cùng commit với `0583`** theo luật `0579` tự ghi ở header dòng 45 ("sync CÙNG COMMIT"): nếu CHECK mở mà hằng TS không mở, BE-3 gõ `objectType: "feed_kudos_badge"` **không qua kiểu `AuditObjectType`** ⇒ typecheck đỏ, hoặc lập trình viên ép kiểu để lách = **mất lưới**. *(Đã đo: KHÔNG spec nào ghim `AUDIT_OBJECT_TYPES.length` ⇒ không có ratchet thứ ba.)*
   - **HAI bump ratchet** ở `apps/api/test/integration/s16-social-db1-invariants.int-spec.ts`: `:875 toBe(26)→toBe(27)` và `:1062 toHaveLength(131)→toHaveLength(132)` + thêm `"feed_kudos_badge"` vào `arrayContaining` (§0)
   - `harness/backlog.mjs` (§6.6) · `docs/DB/DB-17…md` (D1 §7.5, D3 §7.9, CHECK mới §7.3, §3.2 thêm dòng `audit_logs` 131→132)
5. `pnpm --filter @mediaos/contracts build && pnpm typecheck` — xanh, không TS2308.
6. Lane DB: `bash scripts/lane-db-setup.sh s16socialdb2 --reset` (⚠️ bắt buộc `--reset` — bẫy `lane-db-setup-keeps-existing-db`).
7. Vòng vá — chạy int-spec **đơn lẻ**, nhiều vòng. ⚠️ `pnpm --filter @mediaos/api test -- <path>` **KHÔNG lọc** (đã kiểm chứng: nó chạy CẢ suite). Lệnh đúng:

```bash
cd "C:/dev 2/MediaOS/apps/api" && export LANE_DB=mediaos_s16socialdb2 \
  APP_DB_PASSWORD="$(grep -m1 '^APP_DB_PASSWORD=' ../../.env | cut -d= -f2-)" \
  WORKER_DB_PASSWORD="$(grep -m1 '^WORKER_DB_PASSWORD=' ../../.env | cut -d= -f2-)" \
  SUPERUSER_DB_PASSWORD="$(grep -m1 '^SUPERUSER_DB_PASSWORD=' ../../.env | cut -d= -f2-)" \
  && npx vitest run test/integration/s16-social-db2-invariants.int-spec.ts
```

   (Lấy 3 mật khẩu bằng `grep` từng biến — KHÔNG `source .env` vì nó đầu độc `NODE_ENV`.) KHÔNG chạy full gate mỗi vòng (chi phí — DB-1 tốn ~$727, chỉ chạy full gate MỘT lần cuối).
8. Chạy lại `s16-social-db1-invariants.int-spec.ts` trên **cùng LANE_DB** — xác nhận Nhóm 8 (§7) PASS ở nhánh mới.
9. Khi cả 2 file xanh ổn định: `bash harness/check.sh --lane-db` **một lần cuối** — PHẢI xanh, **không** banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
10. FULL gate (crown-jewel, model routing `Opus`): `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (+ `santa-method` vì đụng RLS/migration) — xin xác nhận tường minh cho D1/D2/D3 và cho khối §4.10 dòng #21 (`feed_posts_group_fk`, sửa bảng Track A từ lane Track B).
11. PR — đính bằng chứng: `0578` verify snapshot (M2, 0 cặp mới), `_journal.json` diff, kết quả int-spec cả 2 file, `bash harness/check.sh --lane-db` log.

---

## §9. Rủi ro → cách chặn

| # | Rủi ro | Lưới cụ thể trong plan |
| --- | --- | --- |
| 1 | Quên `feed_posts_group_fk` | §4.10 dòng #21 + Nhóm 8 §7 (chạy lại spec DB-1, tự đổi nhánh) |
| 2 | Hàng `feed_posts` mồ côi (`audience='group'`) chặn `ALTER` | Tiền-kiểm §4.10(c) RAISE tường minh, không âm thầm bỏ qua |
| 3 | Badge seed "xanh rỗng" vì lane DB/CI luôn 0 company (fail-open) | §7 **Nhóm 13** — ca seed trên company THẬT là bằng chứng duy nhất. ⚠️ `0582` **CỐ Ý no-op** khi 0 company và **KHÔNG** neo trong migration (neo ở đó sẽ chặn migrate mọi DB mới — §3) |
| 4 | NOTI CHECK mất nhánh `IS NULL OR` trên `notifications` | §5.1/§5.5 VERIFY RAISE nếu mất nhánh (khuôn `0573` khối D) |
| 5 | `single_choice` sai lệch nếu `multiple_choice` đổi sau khi có phiếu | §4.5 ghi rõ điều kiện bắt buộc + nợ chặn UPDATE sang BE-2 (§10) — DB không tự bảo vệ được |
| 6 | `cleanupTenants()` sai thứ tự do FK mới ⇒ teardown đỏ **lan sang MỌI int-spec khác** dùng chung helper | §6.2 — thứ tự đầy đủ 19 dòng (10 Track A tái sắp + 9 Track B), giải thích lý do từng vị trí |
| 7 | `PROTECTED_TABLES` thiếu 1/9 | §6.3 bảng tiêu chí đầy đủ 9/9 + Nhóm 11 §7 |
| 8 | `rls-registry` thiếu `idColumn` cho 3 bảng PK tổ hợp mới | §6.1 bảng idColumn tường minh |
| 9 | Migration `0580`/`0581`/`0582`/`0583` thiếu trong `_journal.json` | §3 kiểm tra ngay sau khi sinh file; §8 bước 3 |
| 10 | Turbo cache trả log cũ ⇒ xanh giả | §8 bước 9 dùng `harness/check.sh --lane-db` (có `TURBO_FORCE=1`) |
| 11 | Chi phí lặp full gate nhiều vòng | §8 bước 7/10 — chỉ 1 lần cuối, vòng vá dùng int-spec đơn lẻ |
| 12 | `social.spec.ts` mirror hai chiều bị bỏ sót 1 enum mới | §6.5 — kiểm tay lệch-1-giá-trị-mỗi-chiều trước merge |
| 13 | `chk_feed_polls_closes_future` bị đọc nhầm là "thiếu mirror Zod" ở review sau | §6.5 ghi rõ đây là NGOẠI LỆ THỨ HAI (cùng cấp emoji), lý do `created_at` chưa tồn tại lúc validate |

---

## §10. Nợ chuyển sang WO sau (chủ yếu BE-2)

| Nợ | Vì sao DB không đỡ được |
| --- | --- |
| Chặn UPDATE `feed_polls.multiple_choice`/`is_anonymous` sau khi tạo | Là luật nghiệp vụ theo thời điểm (trước/sau khi có phiếu), không phải ràng buộc tĩnh — CHECK không đọc được lịch sử |
| Service ghi `single_choice` = `NOT multiple_choice` cùng tx INSERT phiếu | Cần đọc `feed_polls` trước khi ghi `feed_poll_votes` — hai bảng, một transaction, DB không tự suy được |
| `social.master-data` seeder đăng ký ở `MasterDataSeederRegistry` (D2) | Cơ chế runtime (`onModuleInit`) sống trong module NestJS `apps/api/src/social/**`, ngoài `paths` của DB-2 |
| Khoá owner cuối cùng của nhóm (`SOCIAL-ERR-015`) | Cần đếm số hàng `role='owner' AND status='active'` cùng nhóm — CHECK cấp hàng không đếm được hàng anh em; index hỗ trợ đã có (`idx_feed_group_members_company_group_role`) |
| FSM sáng kiến (`assertIdeaTransition`) | CHECK chỉ giữ tập giá trị + tính đầy đủ vết (đã ép ở `chk_feed_ideas_reviewed_pair`/`_reject_note`), không giữ được thứ tự chuyển tiếp |
| 🔴 **Kiểm `option_id` THUỘC ĐÚNG `poll_id`, cùng tx, TRƯỚC mỗi INSERT phiếu** (FULL gate, H-1) | `feed_poll_votes` có HAI FK RỜI — `(company_id, poll_id) → feed_polls` và `(company_id, option_id) → feed_poll_options` — không gì nối hai cột đó, PK cũng không. Cùng tenant, gửi `pollId=P1` + `optionId=O2` (thuộc P2) ⇒ phiếu ghi THÀNH CÔNG, `feed_poll_votes_single_uq` vẫn PASS (chỉ khoá theo `poll_id,user_id`) ⇒ nhồi phiếu chéo-bình-chọn, `vote_count` của P2 lệch VĨNH VIỄN. Bịt ở DB = `feed_poll_options` thêm `UNIQUE (company_id, poll_id, id)` + FK phiếu 3 cột — phải là **WO riêng** vì làm đỏ assert `conkey=2` / 21 dòng tuple FK |
| Giới hạn 2-10 lựa chọn bình chọn (`SOCIAL-ERR-018`) | Đếm hàng anh em `feed_poll_options` theo `poll_id` — ngoài khả năng CHECK cấp hàng |
| Bất biến "lựa chọn không sửa/thêm/xoá sau khi poll tồn tại" | Luật theo thời điểm — `UNIQUE(poll_id,position)` chỉ chặn trùng vị trí, không chặn thêm/xoá |
| DTO ẩn `user_id` khi `is_anonymous=true` | Tầng repository (chọn cột tường minh), không phải ràng buộc DB |
| Membership lọc trong SQL cho bài nhóm riêng tư (SOC-DEC-006) | RLS chỉ biết `company_id`, không biết `feed_group_members` |
| Đăng ký `registerSource()` cho 9 event `NOTI-EVENT-028..036` ở outbox bridge | Registrar là code runtime BE; DB-2 chỉ cấp catalog (boot-guard một chiều: `registerSource()` chỉ đòi mã PHẢI có trong catalog) |
| Room WS `co:{companyId}:feedgroup:{groupId}` payload mirror DTO REST | Thuộc tầng realtime/BE, ngoài phạm vi schema |
| **Nâng 034 `SOCIAL_GROUP_JOIN_DECIDED` từ `None` lên `DedupeKey`** nếu BE-2 thêm bảng nhật ký yêu cầu vào nhóm | Hôm nay không có nguồn bền vững phủ cả hai nhánh duyệt/từ chối (nhánh từ chối **xoá cứng hàng** theo DB-17 §4.9, và `feed_group_members` không có `decided_at`) — xem §5.3 |
| Ghi audit `object_type='feed_kudos_badge'` khi CRUD catalog huy hiệu (SPEC-16 §18.1) | DB-2 chỉ **mở CHECK** ở `0583`; việc PHÁT dòng audit là code service của BE-3 |
| **Bổ sung các bảng `feed_*` nóng vào `childTables` của `deleteWithFkRetry`** khi BE-2 mở route | §6.2 dời khối feed lên đầu hàm ⇒ feed xoá ở ~457 còn `users` ở 831 / `companies` ở 846, **nới rộng cửa sổ đua teardown**. Hôm nay vô hại (không writer feed nào sống — §4.5), nhưng khi BE-2 có worker/outbox ghi `feed_*`, một hàng chèn lại sau 457 làm `DELETE FROM users` ăn `23503` **không có vòng thử lại** (`childTables` hiện chỉ có `audit_logs`) |

---

## §11. Tự kiểm — `done_when` (`harness/backlog.mjs`, entry `S16-SOCIAL-DB-2`)

| `done_when` | Đáp ứng bởi |
| --- | --- |
| "9 bảng RLS+FORCE, composite tenant-FK, UNIQUE …; CHECK: visibility · role · idea status 4 giá trị + CHECK cặp · poll 2-10 options (ép service, đếm test) · `closes_at > created_at`" | §4 (DDL đủ 9 bảng + RLS/FORCE/policy khuôn `0577`) · §4.10 (21 FK, bảng tuple) · §4.3 CHECK `chk_feed_polls_closes_future` mới (§0) · §7 Nhóm 2/3 (test CHECK + UNIQUE) · §10 (2-10 options là **nợ service**) ⚠️ **Cụm "(ép service, đếm test)" của done_when thoả bằng GHI NHẬN NỢ, KHÔNG bằng một ca test trong §7** — CHECK cấp hàng không đếm được hàng anh em, ca đếm 2-10 thuộc QA của BE-2. QA đừng đi tìm ca không tồn tại. |
| "NOTI: dải NOTI-EVENT ĐO lúc chạy…, hàng events + template cho 9 sự kiện…; CHECK module_code nới ở CẢ hai bảng; DedupeKey theo (event, target, user)" | §5 toàn bộ (bảng 9 sự kiện + template + nới CHECK) · §5.2 làm rõ nghĩa đúng của "(event, target, user)" (tuple dedupe, không phải nhét user vào chuỗi) · §8 bước 1 (đo lại dải lúc thi công) |
| "Seed catalog huy hiệu (5 mã hệ thống…) + cặp còn thiếu ON CONFLICT DO NOTHING; contracts mirror hai chiều; rls-registry + cleanupTenants; invariants spec trên LANE_DB xanh" | §2 D3 (chốt 5, sửa backlog) · §3 file `0582` + §0 (0 cặp quyền cần thêm — bằng chứng minh, không phải INSERT) · §6.5 (contracts mirror) · §6.1/§6.2 (rls-registry/cleanupTenants) · §7 + §8 bước 6-9 (invariants LANE_DB xanh) |

---

## Liên quan

[DB-17 SOCIAL](<../DB/DB-17 SOCIAL Database Design.md>) · [SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) · [Plan S16-SOCIAL-DB-1](S16-SOCIAL-DB-1.md) · [API-19 SOCIAL](<../API Design/API-19_SOCIAL_API_Design.md>) · `apps/api/migrations/0577_s16socialdb1_feed_track_a_ddl.sql` · `0578_s16socialdb1_seed_feed_perms.sql` · `0566_s13payrolldb1_noti_payroll.sql` · `0573_s15payrolldb2_noti_trackc.sql`
