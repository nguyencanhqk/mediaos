# S10-SEC-FKCATALOG-1 — KI-055: bịt lỗ tồn dư lớp G (FK trỏ catalog toàn cục xuyên tenant)

> Zone **đỏ** (crown-jewel: RLS-adjacent · trigger tầng DB · migration). Gate **FULL**
> (security-reviewer + database-reviewer + silent-failure-hunter + santa-method).
> Phụ thuộc: `S6-SEC-XTENANTFK-1` (đã ship — mig `0535`, đóng KI-046, mở KI-055).
> Migration band: **0547** (nối tiếp head THẬT `0546_s7calldb1_chat_calls`, journal idx 213 → mục mới
> idx 214, `when 1717587336000`). Đã kiểm 4 PR mở (#411–#414): 0 file trong `apps/api/migrations`
> ⇒ lane migration nối tiếp đang TRỐNG, không tranh số với WO khác.

---

## Trạng thái cổng plan (đọc trước khi thi công)

| mốc | trạng thái |
|---|---|
| Số đo TRƯỚC trên DB thật (lane + PROD) | ✅ xong 2026-08-25 — §4.0 |
| Vòng `plan-reviewer` đối kháng (1 vòng) | ✅ chạy 2026-08-25 → **BLOCK**, 5 HIGH + 8 MEDIUM |
| Áp phát hiện vào plan | ✅ xong — toàn bộ HIGH + MEDIUM đã ghi vào đúng §, đánh dấu ⛔ |
| **Vòng plan-review thứ hai** | ❌ **KHÔNG chạy — cố ý.** Reviewer kết luận các sửa đều là chỉnh sửa văn bản, không đổi thiết kế, và dự án đã đo được rằng thêm vòng plan-review **đẻ ra lỗ mới** (`plan-review-rounds-inject-new-holes`) |
| Thi công (migration/test/docs) | ✅ **XONG 2026-08-25** — mig `0547` (journal idx 214) · `catalog-fk-tenant-guard.int-spec.ts` (RED 4 ca đỏ vì INSERT LỌT → GREEN 8/8) · waiver 11→0 · ratchet (b) ba trạng thái + (l)(m)(n) · `DECISIONS-10` · `erd-current` §9.1 · RELEASE-02 KI-055 hạ "vá, chờ xác nhận PROD" |
| Còn lại | ⛔ **13 câu đo trên BẢN SAO PROD giữ quyền** (điều kiện đóng hẳn KI-055) · FULL gate + NGƯỜI CHỐT merge |

**Bốn dữ kiện được xác lập bằng THỰC NGHIỆM trong phiên plan** (không phải suy luận, không phải lời của
agent) — chúng là thứ đã cứu bản vá này khỏi ba cách hỏng im lặng:

1. `EXECUTE` **không** đặt `FOUND` ⇒ bản guard nháp là **guard chết** (§5.3 ⛔).
2. `SELECT <hàm RETURNS trigger>()` → `trigger functions can only be called as triggers` (`0A000`) ⇒
   đường thoát fixture của bản nháp **không tồn tại** (§7.5(c)).
3. Trigger **vẫn bắn** dưới `mediaos_app` khi hàm chỉ `REVOKE ALL FROM PUBLIC`, không `GRANT` cho ai ⇒
   bỏ được `GRANT EXECUTE` (§5.3).
4. `proowner` của hàm do migration tạo = `mediaos` (superuser + BYPASSRLS) ⇒ `SECURITY DEFINER` thật sự
   bỏ qua RLS — **và nếu mất tính chất đó thì guard fail-open im lặng** (§7.3(m), §5.5 điều kiện 4).

---

## 0. Gốc lỗi — nói lại cho gọn

`S6-SEC-XTENANTFK-1` đã vá 446/457 cặp FK một-cột tenant→tenant bằng composite FK
`(company_id, x) → parent(company_id, id)`. 11 cặp còn lại ("lớp G") KHÔNG vá được bằng composite FK
vì bảng đích là **catalog toàn cục** (`parent.company_id` NULLABLE, phần lớn hàng `company_id IS
NULL`) — composite FK đòi khớp đúng `company_id`, nên sẽ chặn luôn việc gán một hàng toàn cục hợp lệ
(đã chứng minh: gán `user_roles.role_id` → role hệ thống nổ `Key (company_id, role_id)=(A, <role hệ
thống>) is not present in table "roles"`).

Hệ quả còn mở: trong ngữ cảnh tenant A, FK một-cột cũ (`role_id → roles.id`) vẫn cho phép trỏ tới một
hàng `roles` **thuộc tenant B** (không phải hàng toàn cục) — vì PG FK check bỏ qua RLS theo thiết kế.
Tác hại đã đo (`rls-tenant-isolation-tester`, FULL gate 2026-07-31): A gán được role của B ⇒ B tự xoá
role của B (thao tác hợp lệ trong tenant B) làm hàng `user_roles(company_id=A)` **biến mất theo CASCADE
xuyên tenant** — B tự ý gỡ quyền của A mà A không hay biết. Hệ thống chạy N=1 hôm nay ⇒ 0 hàng thật bị
ảnh hưởng (đã đo lại ở §4.0), nhưng đây là nợ TOÀN VẸN treo sẵn cho lúc mở rộng đa-công-ty và
`user_roles` là bảng phân quyền — crown-jewel, vá phải ĐÚNG chứ không phải NHANH.

11 cặp — **đã xác nhận lại bằng census chạy trên DB thật 2026-08-25** (§4.0), khớp chính xác 11 waiver
đang ký ở `fk-tenant-verdicts.ts`:

| # | pair | constraint | onDelete | child.company_id |
|---|------|-----------|----------|-------------------|
| 1 | `user_roles.role_id -> roles` | `user_roles_role_id_fkey` | **CASCADE** | NOT NULL |
| 2 | `positions.default_role_id -> roles` | `positions_default_role_id_fkey` | SET NULL | NOT NULL |
| 3 | `dashboard_widget_cache.role_id -> roles` | `dashboard_widget_cache_role_id_fkey` | **CASCADE** | NOT NULL |
| 4 | `dashboard_widget_configs.role_id -> roles` | `dashboard_widget_configs_role_id_fkey` | **CASCADE** | NOT NULL |
| 5 | `dashboard_widget_cache.widget_id -> dashboard_widgets` | `dashboard_widget_cache_widget_id_fkey` | **CASCADE** | NOT NULL |
| 6 | `dashboard_widget_configs.widget_id -> dashboard_widgets` | `dashboard_widget_configs_widget_id_fkey` | **CASCADE** | NOT NULL |
| 7 | `notification_templates.event_id -> notification_events` | `notification_templates_event_id_fkey` | **CASCADE** | **NULLABLE** |
| 8 | `notifications.event_id -> notification_events` | `notifications_event_id_fkey` | SET NULL | NOT NULL |
| 9 | `notifications.template_id -> notification_templates` | `notifications_template_id_fkey` | SET NULL | NOT NULL |
| 10 | `leave_request_days.public_holiday_id -> public_holidays` | `leave_request_days_public_holiday_id_fkey` | SET NULL | NOT NULL |
| 11 | `seed_items.seed_batch_id -> seed_batches` | `seed_items_seed_batch_id_fkey` | **CASCADE** | **NULLABLE** |

**6/11 cặp là `ON DELETE CASCADE`** — đó chính là đường CASCADE bắc cầu xuyên tenant mà KI-055 mô tả.

8 bảng CON riêng biệt: `user_roles · positions · dashboard_widget_cache · dashboard_widget_configs ·
notification_templates · notifications · leave_request_days · seed_items`. 6 bảng ĐÍCH: `roles ·
dashboard_widgets · notification_events · notification_templates · public_holidays · seed_batches`.

---

## 1. Ba dữ kiện PHẢI KIỂM — đã kiểm (Grep + đo DB thật, không đoán)

### 1.1 `dashboard_widgets` KHÔNG có trigger bất biến `company_id` — LỖ CÒN MỞ, phải xử lý tường minh

Hai nguồn độc lập cùng kết luận:

- **Grep migration**: `0436_foundation_dbfix1_company_id_immutable.sql` gắn
  `enforce_company_id_immutable` cho **6 bảng** (`sequence_counters · public_holidays ·
  data_retention_policies · seed_batches · seed_items · roles`);
  `0531_s6sec1_noti_catalog_company_immutable.sql` gắn thêm cho **2 bảng**
  (`notification_events · notification_templates`). `dashboard_widgets` KHÔNG có trong cả hai.
- **Đo catalog trên DB thật** (`pg_trigger` JOIN `pg_proc`, cả lane `mediaos_fkcatalog` lẫn PROD
  `mediaos`): đúng **8 bảng** có trigger đó — `data_retention_policies · notification_events ·
  notification_templates · public_holidays · roles · seed_batches · seed_items · sequence_counters`.
  **`dashboard_widgets` vắng mặt.**

⇒ Hôm nay `UPDATE dashboard_widgets SET company_id = '<tenant-của-mình>' WHERE company_id IS NULL`
vẫn thành công — đúng lớp lỗ `0436`/`0531` đã vá cho các bảng kia nhưng bỏ sót bảng này
(`dashboard_widgets` = **17/17 hàng toàn cục** trên PROD, tức 100% bề mặt bị ảnh hưởng).

Vì sao nó là tiền đề của WO này: guard mới kiểm quan hệ con→cha **tại thời điểm ghi hàng CON**. Nếu
cha còn re-home được, một actor "cướp" widget toàn cục về tenant mình sẽ biến mọi
`dashboard_widget_cache`/`dashboard_widget_configs` của tenant KHÁC đang trỏ tới widget đó thành hàng
vi phạm **sau khi đã ghi** — guard trên bảng con không bắt được vì nó không bắn lại.

**Quyết định: vá kèm trong CÙNG migration `0547`** — thêm trigger `enforce_company_id_immutable`
(tái dùng hàm của `0436`, KHÔNG viết hàm mới) cho `dashboard_widgets`, đúng khuôn `0531`. Lý do gộp
thay vì tách WO: (a) `0547` đã đụng đúng 6 bảng đích này; (b) không vá thì bất biến "cha catalog không
đổi chủ" mà guard mới dựa lên bị hở; (c) chi phí thêm = 1 trigger, cùng hàm, cùng file — không mở rộng
bán kính thay đổi. Ghi trong header `0547` + `docs/erd-current.md` rằng đây là **dư nợ của `0531`**,
vá kèm, KHÔNG tự cấp số hiệu KI mới.

### 1.2 Đường seed/init chạm 8 bảng CON — không có landmine "trigger đóng băng bảng giết DB init"

Nguồn ghi thật (app-layer): `permission-admin.repository.ts` (`user_roles`, dùng
`.onConflictDoNothing()`) · `positions.repository.ts` · `notifications.repository.ts` ·
`notification-template.repository.ts` · `leave-request.repository.ts` ·
`foundation/seed/seed-tracking.service.ts` (`seed_items`) · `dashboard-widget-cache.service.ts` +
`dashboard-config.seeder.ts`. Migration seed catalog NOTI (0481, 0490, 0507, 0529, 0538)
`INSERT INTO notification_templates` với `company_id = NULL` trỏ `event_id` vào `notification_events`
cũng toàn cục — tổ hợp **(con NULL, cha NULL)** ở §3, luôn ALLOW (đo được **47 hàng** đúng dạng này).

**Landmine cần loại trừ tường minh**: `permission-admin.repository.ts` dùng
`.insert(userRoles).values({...}).onConflictDoNothing()` — đây không chỉ là seed một lần mà là đường
"cấp role idempotent". `BEFORE INSERT` bắn TRƯỚC khi PG xử lý xung đột khoá ⇒ lần gọi lặp lại vẫn chạy
validate. Nhưng giá trị (`companyId`, `roleId`) do request truyền vào là CỐ ĐỊNH, nên nếu lần đầu hợp
lệ thì lần lặp cũng hợp lệ với đúng dữ liệu đó ⇒ **không có landmine**. Khác với trigger
`BEFORE UPDATE`-bất biến của `0436` (nơi landmine là "seed re-run tưởng no-op nhưng UPDATE vẫn bắn"):
guard này là `BEFORE INSERT OR UPDATE` nhưng không so OLD/NEW, chỉ so NEW với cha — không có khái niệm
"no-op UPDATE" cần lo.

**Đường bị bỏ sót #1 — migration seed catalog NOTI CHẠY SAU `0547`.** Khuôn lặp lại ở `0481`, `0490`,
`0507`, `0529`, `0538` đều là:

```sql
INSERT INTO notification_templates (company_id, event_id, …)
SELECT NULL::uuid, e.id, …
  FROM (VALUES …) t JOIN notification_events e ON e.event_code = t.event_code
```

`notification_events.company_id` NULLABLE và có thể sinh hàng thuộc tenant. Nếu một hàng
`notification_events` mang `company_id = A` trùng `event_code`, `e.id` resolve về hàng của tenant ⇒
template `company_id NULL` trỏ cha có chủ = **tổ hợp #4 = DENY** ⇒ **migration NOTI kế tiếp abort giữa
deploy**. Hôm nay 61/61 event toàn cục nên chưa xảy ra, nhưng dự án đã thêm catalog NOTI **5 lần** —
đây là hot-path.
⇒ **Luật cho migration sau, ghi vào header `0547` + `DECISIONS-10`**: seed template toàn cục **phải**
kèm `AND e.company_id IS NULL` trong mệnh đề join. Một câu, chặn một sự cố deploy.

**Đường bị bỏ sót #2 — `COPY` / restore.** §2 dùng chính lý lẽ "thứ tự restore" để loại `CHECK`, nên
phải phát biểu tính chất tương ứng cho cơ chế ĐÃ CHỌN: **BEFORE ROW trigger CÓ bắn trong `COPY`**. Hôm
nay vô hại chỉ vì `pg_dump` phát trigger ở section **post-data** (sau khi `COPY` xong) — tức an toàn
**do may**, không do thiết kế. Hai hệ quả phải ghi:
(a) clone/restore KHÔNG bị chặn oan (trigger chưa tồn tại lúc nạp dữ liệu);
(b) chính vì thế, **restore là đường DUY NHẤT còn lại để hàng lệch quay vào DB sau `0547`** ⇒ sau mỗi
lần restore phải chạy lại 13 câu §4.1/§4.2 (hoặc `FK_DRIFT_ASSERT=1`). Đây đúng là lý do ca (c) của
ratchet tồn tại ở dạng opt-in — nay nó có một tình huống dùng cụ thể, không còn là nghi thức.

**Kết luận §1.2**: không có đường seed/init nào bị chặn OAN hôm nay. Rủi ro thật duy nhất là nếu một
script demo/import từng vô tình gán xuyên tenant — sẽ ĐÚNG bị chặn, và đó là hành vi MONG MUỐN. Vẫn
phải **chạy thử thật** (`seed-admin.mjs`, `seed-operator.mjs`, `demo-seed-base.mjs`,
`demo-seed-full.mjs`) trên lane đã áp `0547` ở bước GREEN — xác nhận bằng thực thi, không bằng đọc
code (§4.4).

### 1.3 OWNER / app role — cho quyết định `SECURITY DEFINER`

Đo trên DB thật 2026-08-25:

| role | superuser | bypassrls |
|---|---|---|
| `mediaos` | ✅ | ✅ |
| `mediaos_app` | ❌ | ❌ |
| `mediaos_owner` | ❌ | ❌ |
| `mediaos_worker` | ❌ | ❌ |
| `mediaos_readonly` | ❌ | ❌ |

Cả 8 bảng liên quan: `relrowsecurity = on` **VÀ** `relforcerowsecurity = on`, owner = `mediaos`.

**Quyết định: DÙNG `SECURITY DEFINER`.** Lý do loại phương án invoker-rights (mặc định): `mediaos_app`
chịu FORCE RLS đầy đủ. Khi trigger đọc `SELECT company_id FROM roles WHERE id = $1` dưới quyền
`mediaos_app` trong ngữ cảnh tenant A, policy `USING (company_id = GUC OR company_id IS NULL)` **ẩn
hàng của tenant B** — SELECT trả 0 hàng. "0 hàng" khi đó nhập nhằng giữa hai nguyên nhân khác hẳn nhau
(hàng không tồn tại // hàng tồn tại nhưng RLS che). Và diễn giải "0 hàng ⇒ để FK cũ raise 23503" (§3)
sẽ SAI ở đúng trường hợp cần chặn nhất: hàng của B **tồn tại thật**, FK một-cột cũ **thấy được** (FK bỏ
qua RLS) nên KHÔNG raise ⇒ **INSERT lọt qua, guard tưởng đã chạy nhưng thực chất mù**. Đó là lỗ đang
vá tái xuất hiện ngay trong lớp guard mới. `SECURITY DEFINER` đọc dữ liệu thật, không phụ thuộc GUC
phiên, loại nhập nhằng này hoàn toàn.

**Ai sẽ SỞ HỮU hàm mới — đã đo, không suy đoán:** `pg_proc.proowner` của các hàm do migration tạo
(`enforce_company_id_immutable` từ `0436`, `refresh_dashboard_mvs` từ `0534`) đều là **`mediaos`** —
tức đúng cái role superuser + BYPASSRLS ở bảng trên. ⇒ hàm `SECURITY DEFINER` mới cũng sẽ thuộc
`mediaos` và **thật sự bỏ qua RLS** như thiết kế cần. (Đây là dữ kiện phải đo: nếu migration chạy dưới
một role không BYPASSRLS thì `SECURITY DEFINER` KHÔNG cứu được gì và cả §1.3 sụp.)

Khuôn cứng hoá theo tiền lệ `0534_s6secmv1_dashboard_mv_tenant_barrier.sql` (đo được `prosecdef = t`,
`proconfig = {"search_path=public, pg_temp"}`): `SECURITY DEFINER` + `SET search_path` cứng +
`REVOKE ALL ON FUNCTION … FROM PUBLIC` + `GRANT EXECUTE` đích danh + `COMMENT ON FUNCTION`. PG kiểm
quyền EXECUTE của hàm trigger lúc **TẠO** trigger chứ không phải lúc bắn ⇒ revoke khỏi PUBLIC không
giết trigger.

⚠️ Khác biệt có chủ đích so với `0534`: dùng `search_path = pg_catalog, pg_temp` (không `public`) vì
thân hàm đã schema-qualify `public.%I` tường minh — hẹp hơn thì tốt hơn. **Hệ quả phải nhớ khi thi
công**: dưới `search_path` đó, mọi tham chiếu quan hệ KHÔNG qualify sẽ lỗi `relation … does not exist`
(đã đo: `DECLARE r roles%ROWTYPE` gãy lúc biên dịch hàm). Hàm guard không khai `%ROWTYPE` nên không
vướng, nhưng đừng thêm khai báo kiểu đó về sau. `pg_temp` đặt CUỐI (khuyến nghị của PG cho
`SECURITY DEFINER` — chặn bảng tạm che tên).

⚠️ Đánh đổi phải viết ra trong ADR: thêm một hàm `SECURITY DEFINER` thuộc role có BYPASSRLS = thêm một
bề mặt leo thang. Bù lại thân hàm chỉ có đúng một `SELECT company_id FROM <cha> WHERE id = …`, không
nhận tham số do người dùng điều khiển ngoài giá trị cột, và `search_path` bị khoá.

---

## 2. Quyết định cơ chế — trigger, không CHECK; lý do loại tường minh

**Chọn: `BEFORE INSERT OR UPDATE ... FOR EACH ROW` trên 8 bảng CON**, dùng một hàm dùng chung
`enforce_company_id_catalog_fk()`, tham số hoá qua `TG_ARGV` (tên bảng cha, tên cột FK).

**Loại `CHECK` + hàm gọi bảng khác** — hai lý do, cả hai đã trả giá thật trong repo:

1. **`CHECK` không có `OLD`, không nhìn được hàng khác một cách ỔN ĐỊNH.** Muốn tra
   `parent.company_id` thì `CHECK` phải gọi hàm đọc bảng khác — hợp lệ cú pháp, nhưng PG **không đánh
   giá lại CHECK khi bảng cha đổi**. Đúng tình huống §1.1 vừa tìm thấy: cha đổi `company_id` sau đó thì
   CHECK không có cơ chế nào bắt lại. (Cùng lớp bài học `check-cannot-enforce-fsm-transitions`: CHECK
   diễn đạt được "hàng này tự nó hợp lệ", không diễn đạt được quan hệ động.)
2. **`pg_dump`/restore áp CHECK không theo thứ tự đảm bảo với dữ liệu.** Thứ tự COPY là topological
   theo FK, không theo phụ thuộc ẩn của CHECK ⇒ CHECK gọi hàm đọc bảng cha có thể chạy khi cha chưa
   nạp xong. Trigger `BEFORE INSERT` cũng bắn lúc restore, nhưng đó là đường ĐÃ CHỌN và ĐÃ KIỂM ở
   `0436`/`0531` — dùng lại đường đã kiểm thay vì mở đường mới chưa kiểm.

### Chi phí chạy — nói thẳng, không phải "miễn phí"

Mỗi INSERT/UPDATE trên 8 bảng con chạy thêm **1 lượt SELECT PK-lookup** trên bảng cha (qua
`EXECUTE format('SELECT company_id FROM public.%I WHERE id = $1', parent)`), dùng index PK sẵn có.
**3 bảng có 2 cột FK cần kiểm** (`dashboard_widget_cache`, `dashboard_widget_configs`,
`notifications`) ⇒ **2 lượt SELECT** mỗi ghi trên 3 bảng đó. Cộng chi phí `EXECUTE format()` (dynamic
SQL, không hưởng plan cache như static SQL). Chấp nhận được vì 8 bảng này không phải hot-path khối
lượng lớn (`audit_logs`/`system_job_runs` mới là), nhưng PHẢI ghi vào header migration để không ai đọc
nhầm thành "trigger rỗng, không tốn gì".

---

## 3. Ngữ nghĩa NULL — 4 tổ hợp, mỗi tổ hợp có "vì sao" và có SỐ ĐO đỡ lưng

Ký hiệu: **con** = `NEW.company_id` (chỉ khác NULL với `notification_templates` và `seed_items`; 6
bảng còn lại NOT NULL). **cha** = `company_id` của hàng đích mà cột FK trỏ tới. Cột FK tự nó NULL ⇒ bỏ
qua toàn bộ kiểm tra (đã có ràng buộc NOT NULL/nullable riêng trên chính cột đó).

| # | con | cha | Quyết | Vì sao | Hàng thật trên PROD |
|---|-----|-----|-------|--------|---------------------|
| 1 | NOT NULL | NOT NULL, **khác** con | **DENY** | Chính là lỗ đang vá — con thuộc A trỏ tới cha đã "có chủ" là B. Không tổ hợp hợp lệ nào giải thích được. | **0** |
| 2 | NOT NULL | NOT NULL, **bằng** con | ALLOW | Cùng tenant — thiết kế bình thường; composite FK của `0535` cũng cho qua với lớp T. | **89** (`seed_items` 71 + `user_roles` 18) |
| 3 | bất kỳ | **NULL** (hàng toàn cục) | ALLOW | Cha là catalog dùng chung theo đúng thiết kế. **Đây là tổ hợp mà composite FK đã phá và là lý do 11 cặp không vá được ở `0535`** — chặn nó là lặp lại đúng thất bại đã đo. | **96** (`user_roles`→role hệ thống 49 + `notification_templates` 47) |
| 4 | **NULL** | NOT NULL | **DENY** | Chỉ áp cho 2 bảng con nullable. Một hàng CATALOG TOÀN CỤC (tự nhận là dùng chung mọi tenant) không được trỏ tới hàng cha đã có chủ — nếu cho qua, nó kéo dữ liệu riêng của một tenant vào thứ mọi tenant khác cùng đọc. **Rò theo chiều NGƯỢC, phạm vi là TẤT CẢ tenant** — nặng hơn #1. | **0** |

Hàm không branch theo tên bảng — logic chung cho cả 4 tổ hợp (đọc `NEW.company_id` trực tiếp), nên
không có rủi ro quên xử lý case 4 cho 6 bảng NOT NULL (case 4 tự động không xảy ra ở đó vì constraint
cột chặn trước khi trigger chạy).

**Lý do bằng CODE cho tổ hợp #4** (mạnh hơn lý do "0 hàng hôm nay"): `master-data-seed-runner` truyền
`companyId` **của batch** vào `markItem`, nên `seed_items.company_id` là dẫn xuất từ batch — tổ hợp
"(con NULL, cha tenant)" **không sinh ra được trên đường seed**. DENY tổ hợp #4 vì thế không chặn bất
kỳ luồng nghiệp vụ nào đang tồn tại, chứ không chỉ vì hôm nay chưa ai làm thế.

**Trường hợp "cha không tìm thấy" (0 hàng, kể cả dưới `SECURITY DEFINER`)**: KHÔNG phải 1 trong 4 tổ
hợp (đó là tổ hợp về GIÁ TRỊ, không phải SỰ TỒN TẠI). Quyết: `RETURN NEW`, để FK một-cột cũ (giữ
nguyên, không DROP) raise `23503` chuẩn của nó ở bước RI sau đó. Lý do loại "guard tự raise luôn":
tránh hai nguồn lỗi khác thông điệp cho cùng một nguyên nhân (mồ côi khoá ngoại), giữ hành vi lỗi nhất
quán với những gì app-layer đã xử lý từ trước.

⚠️ **Đây là fail-open CÓ KIỂM SOÁT, và nó chỉ đúng chừng nào FK một-cột cũ còn sống.** §5.7 "không
DROP" là ý ĐỊNH, không phải ràng buộc máy đọc được: nếu một migration tương lai đổi/thay
`user_roles_role_id_fkey` (vd ai đó thử lại hướng composite rồi rollback nửa vời), guard lặng lẽ thành
"cha lạ = cho qua" và không test nào đỏ. **Ghim bằng ratchet (l)** — xem §7.3.

---

## 4. Số đo TRƯỚC/SAU

### 4.0 Số đo TRƯỚC — ĐÃ CHẠY 2026-08-25 (không phải "cần đo")

Đo trên **hai** DB: lane `mediaos_fkcatalog` (chain `0000→0546` áp sạch qua
`scripts/lane-db-setup.sh fkcatalog --reset`) và PROD `mediaos` (**chỉ SELECT**, không ghi), bằng
`docker exec mediaos-postgres psql`.

**Cấu trúc — giống nhau trên cả hai DB:**

| chỉ số | giá trị |
|---|---|
| tổng cặp FK một-cột giữa hai bảng tenant | **459** |
| đã covered bằng composite FK | 448 |
| còn hở | **11** |
| lớp T (cha `company_id NOT NULL`) | 448 |
| lớp G (cha `company_id` NULLABLE) | **11** |
| lớp T còn hở | **0** |
| lớp P (con `company_id` NULLABLE) | 24 |

Khớp `FK_SINGLE_COL_PAIRS_FLOOR = 440` và `PARTIAL_ENFORCEMENT_PAIRS = 24`.
⚠️ Tổng là **459**, không phải 460 như header `0535` ghi — số đó đo ở head 0534, trước `0536`–`0546`.

**Hàng catalog toàn cục (PROD, 1 công ty):** `roles` 22/13 toàn cục · `dashboard_widgets` 17/**17** ·
`notification_events` 61/**61** · `notification_templates` 47/**47** · `public_holidays` 1/**0** ·
`seed_batches` 5/**0** · `companies` 1.
⇒ `public_holidays` và `seed_batches` thuộc lớp G vì **CỘT nullable**, không phải vì đang có hàng toàn
cục. Phân lớp theo `attnotnull` là đúng (0 hàng NULL hôm nay vẫn có thể nhận hàng toàn cục ngày mai).

**Vi phạm hiện có (tổ hợp #1) = 0 trên CẢ HAI DB, cả 11 cặp.**
**Vi phạm tổ hợp #4 = 0** (`notification_templates` 47 hàng đều là (NULL, NULL); `seed_items` 71 hàng
đều là (tenant, cùng tenant)).

⇒ Bước tiền kiểm của migration **sẽ không kích hoạt**; không phải xoá/sửa hàng nào (BẤT BIẾN #2 an
toàn). Đây là kết luận của SỐ, không phải mong muốn.

### 4.1 Câu SQL đo — 11 câu tổ hợp #1

```sql
-- lặp cho từng cặp (src, fkcol, tgt) trong 11 cặp:
SELECT count(*) AS drift_1
FROM <src> c JOIN <tgt> p ON p.id = c.<fkcol>
WHERE c.<fkcol> IS NOT NULL
  AND c.company_id IS NOT NULL
  AND p.company_id IS NOT NULL
  AND c.company_id <> p.company_id;
```

### 4.2 Câu SQL đo — 2 câu tổ hợp #4 (chỉ 2 cặp có con nullable)

```sql
SELECT count(*) AS drift_4
FROM notification_templates c JOIN notification_events p ON p.id = c.event_id
WHERE c.event_id IS NOT NULL AND c.company_id IS NULL AND p.company_id IS NOT NULL;

SELECT count(*) AS drift_4
FROM seed_items c JOIN seed_batches p ON p.id = c.seed_batch_id
WHERE c.seed_batch_id IS NOT NULL AND c.company_id IS NULL AND p.company_id IS NOT NULL;
```

### 4.3 Bước (0) của migration

Tiền kiểm bằng đúng 13 câu trên, `RAISE EXCEPTION` kèm danh sách nếu bất kỳ tổng nào > 0 (khuôn
`0535`, **KHÔNG `DELETE`** — BẤT BIẾN #2; `0533` từng dùng DELETE và đó là thứ `0535` phải sửa lại).
Đo được 0 ⇒ nhánh không kích hoạt; nó tồn tại để một DB lạ **dừng ồn ào** thay vì âm thầm để lại hàng
lệch dưới guard mới (guard chỉ chặn ghi MỚI, không tự sửa hàng cũ — §6).

### 4.4 Đo SAU

Chạy lại đúng 13 câu trên lane ĐÃ áp `0547`: phải ra **0** toàn bộ. Cộng bước xác nhận bằng thực thi:
chạy `seed-admin.mjs`, `seed-operator.mjs`, `demo-seed-base.mjs`, `demo-seed-full.mjs` trên lane sạch
đã áp `0547` — PASS, không 23503/23514 lạ (xác nhận kết luận §1.2 bằng chạy thật, không bằng đọc code).

Số TRƯỚC/SAU (13 hàng) ghi vào header `0547` và `RELEASE-02` KI-055.

---

## 5. Thiết kế migration `0547`

Tên: `0547_s10secfkcatalog1_catalog_fk_tenant_guard.sql`. Journal: `idx 214`, `version "7"`,
`when 1717587336000`, `breakpoints true`. **Không vào journal = bị BỎ QUA IM LẶNG.**

### 5.1 Bước (0) — tiền kiểm (13 câu §4.1/§4.2 gộp trong khối `DO $$ … RAISE EXCEPTION`)

### 5.2 Bước (1) — vá nốt `dashboard_widgets` (§1.1)

`DROP TRIGGER IF EXISTS trg_dashboard_widgets_company_immutable ON dashboard_widgets;` →
`CREATE TRIGGER … BEFORE UPDATE ON dashboard_widgets FOR EACH ROW EXECUTE FUNCTION
enforce_company_id_immutable();` — tái dùng hàm của `0436`, khuôn giống hệt `0531`.

### 5.3 Bước (2) — hàm guard mới (khung, không phải bản chép-dán cuối cùng)

```sql
CREATE OR REPLACE FUNCTION enforce_company_id_catalog_fk() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  -- Khoá search_path: bắt buộc với SECURITY DEFINER. Thân hàm schema-qualify `public.%I` tường minh.
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_parent_table   text := TG_ARGV[0];   -- vd 'roles'
  v_fk_col         text := TG_ARGV[1];   -- vd 'role_id'
  v_fk_value       uuid;
  v_parent_company uuid;
  v_found          boolean;              -- cờ SENTINEL — xem cảnh báo ⛔ ngay dưới, KHÔNG thay bằng FOUND
BEGIN
  -- ⛔ `->>` với khoá KHÔNG tồn tại trả NULL chứ không lỗi ⇒ một ký tự gõ nhầm trong TG_ARGV[1] của
  -- một trong 11 CREATE TRIGGER sẽ làm bảng đó KHÔNG được bảo vệ, và không có gì kêu. Chặn tại gốc:
  IF NOT (to_jsonb(NEW) ? v_fk_col) THEN
    RAISE EXCEPTION 'catalog_fk_guard: cột % không tồn tại trên %', v_fk_col, TG_TABLE_NAME
      USING ERRCODE = 'internal_error';
  END IF;

  v_fk_value := (to_jsonb(NEW) ->> v_fk_col)::uuid;
  IF v_fk_value IS NULL THEN
    RETURN NEW;                      -- cột FK tự nó NULL: không phải việc của guard này
  END IF;

  -- Hằng `true` làm cờ sentinel: 0 hàng ⇒ v_found IS NULL; có hàng ⇒ v_found = true,
  -- kể cả khi company_id của hàng đó là NULL. Đây là điểm PHÂN BIỆT sống-còn (xem ⛔ dưới).
  EXECUTE format('SELECT true, company_id FROM public.%I WHERE id = $1', v_parent_table)
    INTO v_found, v_parent_company USING v_fk_value;

  IF v_found IS NULL THEN
    RETURN NEW;                      -- 0 hàng: để FK một-cột cũ raise 23503 chuẩn của nó (§3)
  END IF;

  IF v_parent_company IS NULL THEN
    RETURN NEW;                      -- tổ hợp #3: cha là hàng toàn cục — ALLOW
  END IF;

  IF NEW.company_id IS NULL OR NEW.company_id <> v_parent_company THEN
    RAISE EXCEPTION
      'catalog_fk_tenant_mismatch: %.% trỏ tới hàng % thuộc tenant khác (hoặc con toàn cục trỏ tới hàng có chủ)',
      TG_TABLE_NAME, v_fk_col, v_parent_table
      USING ERRCODE = 'foreign_key_violation';   -- 23503, đồng bộ với composite FK của 0535 / ca W4
  END IF;

  RETURN NEW;                        -- tổ hợp #2: cùng tenant — ALLOW
END;
$$;

REVOKE ALL ON FUNCTION enforce_company_id_catalog_fk() FROM PUBLIC;
-- KHÔNG `GRANT EXECUTE TO mediaos_app`: đã ĐO (lane 2026-08-25) rằng trigger vẫn bắn bình thường
-- dưới `mediaos_app` khi hàm chỉ bị REVOKE khỏi PUBLIC và KHÔNG được grant cho ai — ca DENY raise
-- đúng, ca ALLOW ghi được. PG kiểm EXECUTE lúc TẠO trigger (bởi role chạy migration), không lúc bắn.
-- Bỏ GRANT = hẹp hơn, đúng hướng least-privilege của `0540`.
COMMENT ON FUNCTION enforce_company_id_catalog_fk() IS
  'S10-SEC-FKCATALOG-1 (KI-055): guard lớp G — con chỉ trỏ được tới hàng cha CÙNG TENANT hoặc hàng TOÀN CỤC (company_id IS NULL). SECURITY DEFINER vì mediaos_app chịu FORCE RLS ⇒ invoker sẽ bị RLS che hàng cha của tenant khác và guard hoá mù. Xem DECISIONS-10.';
```

### ⛔ `EXECUTE` KHÔNG ĐẶT `FOUND` — đã ĐO, không phải phòng xa

Bản nháp đầu của kế hoạch này viết `IF NOT FOUND THEN RETURN NEW` ngay sau `EXECUTE … INTO`. **Sai, và
đo được là sai** (thực nghiệm trên `mediaos_fkcatalog` + `mediaos`, 2026-08-25):

| ca | `FOUND` sau `EXECUTE … INTO` |
|---|---|
| id CÓ THẬT, hàng toàn cục (`company_id IS NULL`) | `f` |
| id KHÔNG tồn tại | `f` |
| id KHÔNG tồn tại, **nhưng `FOUND` bị ép `true` bằng một `SELECT INTO` ngay trước đó** | **`t`** |

Ca thứ ba là bằng chứng quyết định: `EXECUTE` **không đụng tới `FOUND`** (PL/pgSQL chỉ cho `EXECUTE`
cập nhật `GET DIAGNOSTICS`, không cập nhật `FOUND`) — giá trị đọc được chỉ là tàn dư của câu lệnh
TRƯỚC đó. Trong thân trigger này không có câu nào đặt `FOUND` trước, nên `FOUND` luôn = `false` khi tới
nhánh đó ⇒ `IF NOT FOUND THEN RETURN NEW` **luôn luôn đúng** ⇒ **guard `RETURN NEW` vô điều kiện, không
bao giờ chặn gì cả**.

Đây là một guard CHẾT trông như đã vá: migration xanh, ratchet (l) xanh (trigger có tồn tại và
`tgenabled='O'`), RELEASE-02 ghi "đã đóng KI-055" — mà lỗ còn nguyên. Cùng lớp
`ui-promises-backend-never-reads` và `tests-can-pin-a-hole-open`.

**Hai cách vá, cả hai đã đo là đúng:**

| cách | ca "hàng toàn cục có thật" | ca "id không tồn tại" | ca "hàng của tenant" |
|---|---|---|---|
| **(đã chọn) cờ sentinel** `SELECT true, company_id INTO v_found, v_parent_company` | `v_found=true`, company=`<NULL>` | `v_found=<NULL>` | `v_found=true`, company=`<uuid>` |
| (dự phòng) `GET DIAGNOSTICS n = ROW_COUNT` ngay sau `EXECUTE` | `ROW_COUNT=1` | `ROW_COUNT=0` | `ROW_COUNT=1` |

Chọn **sentinel** vì nó phân biệt cả ba ca trong đúng MỘT câu lệnh, không phụ thuộc một câu phụ trợ
đứng đúng vị trí (`GET DIAGNOSTICS` đặt sai chỗ là hỏng âm thầm y hệt `FOUND`).

**Chốt cơ học bắt buộc kèm theo** (vì "trigger tồn tại" ≠ "trigger chặn được"): ca ALLOW-global (§7.4
ca 2) bắt lỗi nếu guard chặn nhầm, nhưng **KHÔNG** bắt được guard chết. Thứ bắt được guard chết là ca
**DENY** (§7.4 ca 1) — nên ca DENY của **cả 11 cặp** là điều kiện cần, không phải "nice to have", và
§7.5 (RED trước: DENY phải ĐỎ trước migration, XANH sau) là cách duy nhất chứng minh chính ca DENY đó
không xanh-rỗng.

`ERRCODE = 'foreign_key_violation'` (23503) — chọn thay vì `check_violation` của `0436` vì đây đúng
bản chất là ràng buộc khoá ngoại (mở rộng của FK một-cột cũ), và để nhất quán với đường xử lý
`err.constraint`/23503 mà `tenant-isolation.int-spec.ts` (ca W4, từ `0535`) đã dựng sẵn.

### 5.4 Bước (3) — 11 trigger

Mỗi cặp: `DROP TRIGGER IF EXISTS` → `CREATE TRIGGER … BEFORE INSERT OR UPDATE ON <src> FOR EACH ROW
**WHEN (NEW.<fkcol> IS NOT NULL)** EXECUTE FUNCTION enforce_company_id_catalog_fk('<tgt>', '<fkcol>')`,
ngăn cách `--> statement-breakpoint`. Tên: `trg_<src>_<fkcol>_catalog_fk` (3 bảng có 2 trigger ⇒ hậu tố
cột phân biệt, vd `trg_dashboard_widget_cache_role_id_catalog_fk` và
`trg_dashboard_widget_cache_widget_id_catalog_fk`). Kiểm độ dài tên ≤ 63 ký tự khi thi công.

**Vì sao có mệnh đề `WHEN` tĩnh**: tên cột biết trước ở thời điểm `CREATE TRIGGER` (không cần dynamic),
nên `WHEN` cắt được **trọn** chi phí vào hàm — kể cả `to_jsonb(NEW)` — cho nhánh phổ biến nhất (FK
NULL). Điều này quan trọng với 5 cặp `ON DELETE SET NULL` và với `notifications` (bảng fan-out: 1 sự
kiện → N hàng người nhận). `WHEN` là bộ lọc, KHÔNG thay được kiểm tra trong hàm — hàm vẫn giữ nhánh
`IF v_fk_value IS NULL THEN RETURN NEW` phòng khi trigger bị tạo lại thiếu `WHEN`.

### 5.5 Bước (4) — khối TỰ-KIỂM cuối file (khuôn `0469`/`0473`, chép được)

`RAISE EXCEPTION` nếu bất kỳ điều kiện nào sai — vì "migration chạy xong" KHÔNG chứng minh "guard sống":

1. Đếm trigger `*_catalog_fk` = **11**, và `trg_dashboard_widgets_company_immutable` tồn tại.
2. `pg_proc.prosecdef = true` cho `enforce_company_id_catalog_fk`.
3. `proconfig` chứa `search_path=`.
4. **Chủ hàm (`proowner`) có `rolsuper` HOẶC `rolbypassrls`** — xem §7.3(m) để biết vì sao đây là điều
   kiện sống-còn chứ không phải trang trí (FORCE RLS áp cả lên chủ bảng ⇒ chủ hàm không BYPASSRLS làm
   guard fail-open IM LẶNG).
5. PUBLIC không có EXECUTE trên hàm.

Đặt ở **cuối** file: nếu một trong 5 điều kiện sai, migration abort và transaction cuốn lại toàn bộ —
không để lại trạng thái nửa vời.

### 5.6 Header migration phải ghi (khuôn `0535`)

Journal: ghi ĐÍCH DANH `"tag": "0547_s10secfkcatalog1_catalog_fk_tenant_guard"` — tag phải khớp TÊN
FILE, nếu lệch thì migration bị BỎ QUA IM LẶNG.

SỐ ĐO (§4.0, 13 câu, cả hai DB) · HÀNH VI MỚI (INSERT/UPDATE lệch tenant trên 8 bảng con nay 23503;
`dashboard_widgets` nay bất biến `company_id`) · CHI PHÍ CHẠY (§2: 1–2 SELECT thêm mỗi ghi) · GIỚI HẠN
(**forward-only** — không hồi tố hàng cũ; đo được 0 hàng cũ nên hôm nay vô hại, §6) · ĐƯỜNG LÙI
(khối `Down (manual)`: DROP 11 trigger `*_catalog_fk` → REVOKE → DROP FUNCTION
`enforce_company_id_catalog_fk` → DROP `trg_dashboard_widgets_company_immutable`; **liệt kê ĐÍCH DANH,
KHÔNG dùng `LIKE` quét rộng** — bài học R10 của `0535`, nơi bản lọc `LIKE '%_company_fk'` gỡ nhầm
constraint của `0503`).

### 5.7 KHÔNG làm

- Không đụng `apps/api/src/db/schema/**` — trigger là DB-object thuần, Drizzle không model ⇒ **không
  chạy `db:generate`** (đúng như `0436` nói).
- **Không DROP FK một-cột cũ** trên 11 cặp — nó vẫn là ràng buộc DUY NHẤT bắt "cha không tồn tại"
  (nhánh `NOT FOUND` §3); guard mới CHỒNG lên chứ không THAY.
- Không sửa/xoá dữ liệu (đo trước = 0; §4.3 dùng `RAISE EXCEPTION`, không `DELETE`).

---

## 6. Chiều CASCADE — nói thật, không suy luận suông

Tác hại đã đo: A gán role của B ⇒ B xoá role của B ⇒ hàng `user_roles(company_id=A)` CASCADE theo
tenant B. Trigger mới **không chạm chiều DELETE của bảng cha** (nó là `BEFORE INSERT OR UPDATE` trên
bảng CON) — `ON DELETE CASCADE` giữ nguyên ngữ nghĩa cũ 100%. Vá hoạt động theo cách khác: **chặn việc
TẠO hàng lệch ngay từ đầu**, nên "B xoá role của B kéo theo A" trở thành **bất khả đạt vì tiền đề của
nó không còn tạo được**.

**Đây là vá FORWARD-ONLY, KHÔNG hồi tố.** Hàng lệch tạo TRƯỚC khi `0547` chạy vẫn nguyên trong DB sau
đó, và nếu cha bị xoá thì CASCADE cũ vẫn xảy ra y hệt. §4.0 đo được **0 hàng lệch lớp G** trên cả hai
DB ⇒ giới hạn này không có tác động thực tế lúc deploy, nhưng PHẢI ghi rõ trong ADR + RELEASE-02 để
không ai đọc nhầm thành "0547 đã dọn dữ liệu lịch sử" — nó không dọn gì, vì không có gì để dọn.

### Ca nghiệm thu CASCADE (bắt buộc — không phải suy luận)

File mới `apps/api/test/integration/catalog-fk-tenant-guard.int-spec.ts`, ca `cascade-unreachable`:

0. **BASELINE KHÁC 0 — bước bắt buộc, thiếu nó cả ca này là nghi thức.** Gán cho một user của A một
   **role TOÀN CỤC** (đúng ca ALLOW tổ hợp #3) ⇒ `count(user_roles WHERE company_id = A) = N > 0`.
   ⛔ Vì sao: assert ở bước 5 là "count không đổi trước/sau". Nếu A chưa từng có hàng `user_roles` nào
   thì đó là `0 === 0` — **xanh kể cả khi guard không tồn tại**, và xanh cả khi bước 2 thất bại vì lý
   do khác (thiếu quyền, sai fixture). Baseline > 0 vừa cứu assert, vừa gộp được vế ALLOW và vế DENY
   vào cùng một mạch.
1. Dựng B: `roleB = createRole({companyId: B})` — thao tác BÌNH THƯỜNG, không bị guard chặn (`0436`
   chỉ chặn `UPDATE company_id`, không chặn `INSERT`).
2. Ngữ cảnh A: gọi ĐÚNG đường app thật (`PermissionAdminRepository` / route cấp role) để gán
   `roleB.id` cho user thuộc A. **Assert: bị từ chối**, `ERRCODE 23503` + thông điệp
   `catalog_fk_tenant_mismatch`.
3. Assert phụ: `SELECT count(*) FROM user_roles WHERE company_id = A AND role_id = roleB.id` = **0** —
   đây LÀ bằng chứng "không có gì để CASCADE".
4. Ngữ cảnh B: xoá `roleB` (thao tác hợp lệ trong B).
5. Assert cuối: `count(user_roles WHERE company_id = A)` **vẫn = N (> 0)**, không đổi trước/sau bước
   4 — không phải vì CASCADE "bị chặn", mà vì tiền đề của CASCADE chưa từng tồn tại. **Ghi câu này vào
   comment test** để người sau không hiểu nhầm guard chặn được DELETE-cascade (nó không làm việc đó và
   không cần làm).

**Không dùng `session_replication_role = replica` để "trồng" hàng lệch rồi chứng minh CASCADE vẫn xảy
ra** — làm vậy là dựng lại y hệt lỗ CŨ trong khung test, chỉ tái khẳng định FK CASCADE hoạt động đúng
thiết kế PG (đã biết), không chứng minh gì về bản vá. Rủi ro tồn dư cho dữ liệu lịch sử (hiện = 0
hàng) ghi bằng LỜI trong ADR + RELEASE-02.

---

## 7. Kế hoạch test (RED trước, GREEN sau)

### 7.1 Mở rộng `apps/api/test/foundation/fk-tenant-census.ts` — KHÔNG viết census song song

Thêm `collectCatalogFkGuards(direct)`: đọc `pg_trigger` JOIN `pg_proc` JOIN `pg_class`, lọc
`tgfoid = enforce_company_id_catalog_fk`, trả `{childTable, tgname, tgenabled, argv: [parentTable,
fkCol]}[]`. **0 regex trên mã nguồn, 0 danh sách bảng viết tay** — giữ đúng bất biến của file. Ghép vào
`FkPair` bằng field mới `catalogGuard: {tgname, tgenabled} | null`, so khớp **cả `argv[0]` (bảng cha)
LẪN `argv[1]` (cột FK)** với `pairKey` — chỉ so bảng cha thì một typo ở tên cột sẽ lọt (xem §5.3
kiểm-tên-cột).

⛔ **`collectCatalogFkGuards` CHỈ dùng cho ratchet (l)(m)(n) — TUYỆT ĐỐI không dùng làm nguồn sinh ca
test hành vi.** Nó đọc `pg_trigger`, nên **trước khi áp `0547` nó trả về 0 hàng**; lấy nó làm nguồn
vòng lặp thì bước RED sinh 0 ca và toàn bộ §7.4 thành xanh-rỗng (chi tiết ở §7.4).

### 7.2 Cập nhật `apps/api/test/foundation/fk-tenant-verdicts.ts`

`FK_TENANT_WAIVERS`: **11 → 0**. Không giữ waiver "chờ vá sau" cho cặp nào — không có tiêu chí khách
quan để chọn "cặp nào bỏ lại", và chi phí biên của cặp thứ 9/10/11 là **1 dòng `CREATE TRIGGER`** (hàm
dùng chung đã viết), nên không có phương án giữa vừa an toàn hơn vừa rẻ đáng kể.

Comment giữ lịch sử: "11 cặp từng waiver ở `S6-SEC-XTENANTFK-1`, đã vá bằng trigger
`enforce_company_id_catalog_fk` ở `S10-SEC-FKCATALOG-1` (mig `0547`) — xem `DECISIONS-10`."

Giữ nguyên kiểu `FkWaiver` và mảng (rỗng) — van an toàn cho cặp lớp G MỚI trong tương lai. Nhưng lý do
ký waiver kiểu đó **PHẢI khác lý do cũ**: lý do cũ ("composite FK sẽ phá tham chiếu") **không còn đúng
nữa** vì WO này chứng minh có cách vá khác composite FK. Lý do MỚI bắt buộc có dạng "guard trigger chưa
triển khai, due date `<YYYY-MM-DD>`, theo dõi ở WO `<mã>`" — ép bằng ratchet (l).

Cập nhật `FK_SINGLE_COL_PAIRS_FLOOR`: giữ 440 (đo được 459, còn dư biên); ghi số đo mới 459 vào
doc-comment thay số 460 cũ.

⛔ **HỆ QUẢ BẮT BUỘC XỬ LÝ — gỡ waiver về 0 làm ca (b) HIỆN CÓ ĐỎ.** Ca (b)
(`xtenant-fk-ratchet.int-spec.ts`) lọc `!p.covered && !signed.has(pairKey(p))`. 11 cặp lớp G **vĩnh
viễn `covered = false`** (bản vá này KHÔNG thêm composite FK nào — đó là toàn bộ lý do WO tồn tại).
Waiver về rỗng ⇒ cả 11 rơi vào `unsigned` ⇒ **(b) ĐỎ ngay**.

⛔ **CẤM sửa (b) bằng cách thêm `p.targetTenantOnly &&` vào bộ lọc.** Làm thế biến (b) thành bản sao của
(a) và **xoá mất ngữ nghĩa "cặp hở phải có phán quyết"** — cặp lớp G mới xuất hiện ngày mai sẽ không
còn ai bắt. Cách sửa ĐÚNG là mở (b) thành **ba trạng thái hợp lệ**: cặp hở được chấp nhận khi
`covered` **HOẶC** có guard `*_catalog_fk` ACTIVE khớp `pairKey` **HOẶC** có waiver còn hạn. Không có ô
thứ tư. (b) và (l) không chồng lấn: **(b) = "không có ô thứ tư"**, **(l) = "không được vừa guard vừa
waiver, và trigger phải `tgenabled='O'`"`.

### 7.3 Mở rộng `apps/api/test/integration/xtenant-fk-ratchet.int-spec.ts`

Sửa ca **(b)** theo ⛔ trên, thêm hằng `FK_LAYER_G_GUARD_FLOOR = 11` và 3 ca mới:

- **(l)** Mọi cặp lớp G phải có **đúng một guard đang ACTIVE** HOẶC một waiver **CÒN HẠN**. Có **cả
  hai** (guard active + waiver còn sót) ⇒ ĐỎ (chống "vá rồi vẫn để waiver cho chắc").
  `tgenabled <> 'O'` ⇒ **không tính là đã guard** ⇒ ĐỎ (đây cũng chính là cái làm đường "hạ hoả"
  `DISABLE TRIGGER` ở §10 không thể im lặng).
  - Guard khớp cặp phải so **cả `argv[0]` lẫn `argv[1]`** (§7.1).
  - **"Còn hạn" phải PARSE ngày, không chỉ khớp regex.** `/due date \d{4}-\d{2}-\d{2}/` khớp cả
    `due date 2020-01-01` ⇒ waiver quá hạn xanh vĩnh viễn, van an toàn thành cửa mở. Parse rồi assert
    `> Date.now()`; hết hạn ⇒ ĐỎ kèm "waiver hết hạn, vá hoặc gia hạn có chữ ký".
  - **Assert kèm: mỗi cặp trong 11 phải CÒN `constraintName` FK một-cột trong census.** Nhánh "cha
    không tìm thấy → `RETURN NEW`" (§3) là fail-open **có kiểm soát**, và nó chỉ đúng chừng nào FK
    một-cột cũ còn sống. §5.6 "không DROP" là ý định, không phải ràng buộc máy đọc được — dữ liệu để
    assert đã có sẵn trong `FkPair`, chi phí 3 dòng.
- **(m)** Hàm `enforce_company_id_catalog_fk` phải: `pg_proc.prosecdef = true` **và** `proconfig` chứa
  `search_path=` **và** — quan trọng nhất — **chủ hàm (`pg_proc.proowner`) phải có `rolsuper` HOẶC
  `rolbypassrls`**.
  ⛔ Vì sao vế thứ ba là sống-còn: cả 8 bảng đều `relforcerowsecurity = on`, mà **FORCE RLS áp cả lên
  CHỦ BẢNG**. Nếu hàm thuộc một role KHÔNG BYPASSRLS (kịch bản rất thật: `pg_restore --no-owner` khi
  clone PROD ở §9, hoặc một môi trường chạy migration bằng `mediaos_owner`), thì `SELECT company_id
  FROM roles WHERE id = <role của B>` bị RLS che → 0 hàng → rơi vào nhánh "cha không tìm thấy" →
  `RETURN NEW` → **guard cho qua đúng cái nó phải chặn**, trong khi (l) vẫn xanh (trigger vẫn tồn tại
  và ACTIVE) và RELEASE-02 vẫn ghi "đã vá". Đúng lớp `staging-clone-needs-privilege-preserving-dump`.
- **(n)** `dashboard_widgets` phải có trigger `enforce_company_id_immutable` đang ACTIVE (đóng §1.1 —
  PIN riêng vì đây là dư nợ của `0531`, không phải một trong 11 cặp). (n) chỉ assert **sự tồn tại +
  ACTIVE của trigger**, KHÔNG assert thuộc tính hàm: `enforce_company_id_immutable` (`0436`) cố ý
  **không** `SECURITY DEFINER` và **không** khoá `search_path` — đúng và an toàn vì nó chỉ đọc
  `OLD`/`NEW`, không đọc bảng nào. Ratchet (m) chỉ áp cho hàm MỚI.

### 7.4 File mới `apps/api/test/integration/catalog-fk-tenant-guard.int-spec.ts`

⛔ **NGUỒN SINH CA phải là `collectFkPairs(direct).filter(p => !p.targetTenantOnly)` — KHÔNG phải
`collectCatalogFkGuards`.** `collectFkPairs` đọc `pg_constraint` nên trả về đủ 11 cặp **cả TRƯỚC lẫn
SAU** migration; `collectCatalogFkGuards` đọc `pg_trigger` nên trước `0547` trả 0 hàng.

Kịch bản hỏng nếu lấy nhầm nguồn (đây là lý do đoạn này viết đậm): chạy bước RED trên lane chưa áp
`0547` ⇒ vòng lặp sinh **0 ca DENY, 0 ca ALLOW**; file chỉ đỏ ở PIN "≥ 11". Người thi công thấy đỏ →
kết luận "RED đạt" → áp `0547` → thấy xanh → kết luận "GREEN đạt" — trong khi **hành vi DENY chưa một
lần nào được chạy trên DB chưa vá**. Đúng lớp `deny-cases-vacuous-without-allow-case` +
`same-builder-twice-makes-unit-spec-vacuous`.

Data-driven trên nguồn đúng ở trên. **Loại `super-admin` khỏi mọi actor** (test bằng SA là tautology);
dùng role nghiệp vụ thường, và với ca ALLOW-global thì lấy hàng cha toàn cục bằng query
`WHERE company_id IS NULL LIMIT 1` — **không hard-code id**. Assert lỗi bằng
`await expect(...).rejects.toMatchObject({ code: '23503' })` — **không** `try/catch` (catch nuốt lỗi
thì ca DENY xanh cả khi không có gì bị chặn).

Với **mỗi trong 11 cặp**, tối đa 3 ca:

1. **DENY** (tổ hợp #1): dựng hàng cha thuộc tenant B **qua đường ghi THẬT** của bảng đó, rồi ngữ cảnh
   A cố INSERT/UPDATE con trỏ tới cha B ⇒ assert reject `23503` + `catalog_fk_tenant_mismatch`.
2. **ALLOW-global** (tổ hợp #3): con trỏ tới hàng cha `company_id IS NULL` có thật ⇒ assert **thành
   công**. **Ca này là chốt chống lặp lại thất bại của composite FK** — không có nó thì ca DENY là xanh
   RỖNG.
3. **ALLOW-same-tenant** (tổ hợp #2): con trỏ tới cha cùng tenant A ⇒ assert **thành công**. Chỉ áp cho
   cặp nào bảng cha có đường tạo hàng tenant-owned; cặp nào skip phải **ghi rõ trong code vì sao**.

Riêng cặp **#1 `user_roles.role_id → roles`** (crown-jewel) thêm **2 ca cứng viết tay**, ngoài vòng lặp
data-driven — một bộ lọc data-driven tính sai sẽ xanh với 0 ca chạy thật; ca cứng không phụ thuộc bộ
lọc là chốt tối thiểu.

Thêm **ca DENY tổ hợp #4** cho 2 cặp con nullable (#7, #11).

Thêm **ca `cascade-unreachable`** (§6).

**PIN chống co-về-rỗng cho chính file này**: assert số cặp mà vòng lặp thực sự sinh ca ≥ 11 — cùng lý
do PIN sàn của ratchet.

### 7.5 Fixture — bất biến đặt ĐÚNG CHỖ (bản nháp đặt sai, đã sửa)

Bản nháp viết "mọi fixture *hàng cha thuộc tenant B* phải dựng bằng đường ghi THẬT". **Sai chỗ**: thứ
đang được kiểm là **lệnh ghi hàng CON**, không phải hàng cha. Dựng hàng CHA bằng SQL thẳng không hề vô
hiệu hoá guard — guard nằm trên bảng CON và bắn với mọi role (trừ `session_replication_role='replica'`,
thứ §6 đã cấm). Bất biến đúng là:

- **(a) Hàng CHA** (kể cả hàng thuộc tenant B): được dựng bằng `direct` pool / SQL thẳng. Ghi rõ trong
  comment vì sao điều đó KHÔNG làm ca xanh giả — vì phép thử nằm ở bước ghi con, không ở bước dựng cha.
- **(b) Lệnh ghi hàng CON**: **bắt buộc** chạy dưới role `mediaos_app` với `app.current_company_id = A`
  (RLS còn bật) — có route thì dùng route, không có route thì dùng repository/`withTenant`. Đây mới là
  chỗ ca DENY chứng minh điều nó tuyên bố.
- **(c) ⛔ XOÁ phương án "gọi hàm guard trực tiếp"** của bản nháp — **thao tác đó không tồn tại trong
  PostgreSQL.** Đã đo (lane, 2026-08-25): `SELECT _probe_guard();` trên một hàm `RETURNS trigger` →
  `ERROR: trigger functions can only be called as triggers` (SQLSTATE `0A000`). Bản nháp dành đường
  thoát này cho đúng hai cặp khó nhất (`dashboard_widgets` 17/17 toàn cục, `notification_events` 61/61
  toàn cục) — tức là ở đúng chỗ cần nhất thì nó không có phương án nào chạy được, và người thi công sẽ
  phải tự ứng biến giữa vùng đỏ. Nhờ (a) ở trên, đường thoát này **không còn cần thiết**: cứ dựng hàng
  cha tenant-owned bằng `direct` pool rồi thử ghi con qua `mediaos_app`.
  Nếu vẫn muốn một ca ĐƠN VỊ cho hàm guard, cách khả thi DUY NHẤT là gắn trigger lên một bảng nháp
  trong transaction rồi `ROLLBACK` — nói rõ nếu chọn.

**Thứ tự RED**: viết ca DENY + ALLOW **TRƯỚC** khi viết `0547`, chạy trên lane chưa áp migration —
DENY phải **ĐỎ vì INSERT THÀNH CÔNG** (không phải đỏ vì 0 ca, xem ⛔ §7.4), ALLOW phải XANH. Sau khi áp
`0547`, cả hai XANH. Nếu ALLOW đỏ SAU migration ⇒ bản vá đang lặp lại thất bại của composite FK, DỪNG.

**Thứ tự RED**: viết ca DENY + ALLOW **TRƯỚC** khi viết `0547`, chạy trên lane chưa áp migration —
DENY phải ĐỎ (hiện chưa chặn), ALLOW phải XANH (hiện đã cho qua). Sau khi áp `0547`, cả hai XANH. Nếu
ALLOW đỏ SAU migration ⇒ bản vá đang lặp lại thất bại của composite FK, DỪNG.

---

## 8. Mở rộng lưới ratchet sang lớp G

Đã mô tả ở §7.1/§7.3. Bất biến bắt buộc giữ: hàm quét MỚI đọc THẲNG `pg_trigger`/`pg_proc`/`pg_class`,
**0 danh sách bảng viết tay, 0 regex trên `.sql`/`.ts`** — cùng khuôn `collectFkPairs`. Waiver 11 → 0;
cấu trúc `FkWaiver` giữ làm van an toàn với lý do bắt buộc kèm `due date`.

`xtenant-fk-ratchet.int-spec.ts` **không gate theo `LANE_DB`** (`hasDb` = có `DATABASE_DIRECT_URL` +
`DATABASE_URL`, CI set ở cấp job) ⇒ 3 ca mới chạy THẬT ở CI, là chốt cơ học chứ không phải nghi thức.
Giữ nguyên tính chất này — không thêm gate mới.

---

## 9. Kế hoạch tài liệu

- **ADR mới `docs/DECISIONS/DECISIONS-10_Catalog_FK_Company_Guard_Trigger.md`** — đã kiểm: head hiện
  tại là `DECISIONS-09_Security_Policy_Reauth_And_Object_Grant.md` ⇒ số tiếp theo là **10**.
  Nội dung bắt buộc: (a) cơ chế đã chọn — trigger `BEFORE INSERT OR UPDATE` + `SECURITY DEFINER`, bảng
  4 tổ hợp NULL (§3) kèm số đo đỡ lưng; (b) **hai hướng bị loại kèm vì sao** — `CHECK` + hàm (§2) và
  "không vá, giữ 11 waiver mãi mãi" (nợ crown-jewel không có số hiệu là nợ vô hình — chính là lý do
  KI-055 được mở); cộng ghi lại vì sao **composite FK** đã bị loại từ `0535` (chứng cứ 23503 trên role
  hệ thống); (c) **giới hạn forward-only** (§6); (d) dư nợ vá kèm `dashboard_widgets` (§1.1) và lý do
  gộp vào `0547`; (e) đánh đổi `SECURITY DEFINER` (bề mặt leo thang) và cách giảm thiểu.
- **`docs/erd-current.md`**: cập nhật Phụ lục A — 8 bảng con nay có "guard lớp G" (trỏ `DECISIONS-10`);
  `dashboard_widgets` nay có trigger bất biến `company_id` (trỏ `0547`, ghi rõ là dư nợ vá kèm của
  `0531`).
- **`RELEASE-02_Known_Issues_MVP.md` KI-055** — theo khuôn dòng KI-046 đã đóng. **Đóng chỉ khi đủ ba
  điều kiện có số đo**: (1) `0547` áp được trên lane sạch VÀ trên bản sao PROD (**clone giữ quyền**,
  không phải `pg_dump` thường — nếu không, RLS/GRANT không sang cùng và phép đo là giả); (2) 13 số
  TRƯỚC/SAU = 0/0 trên chính bản sao đó; (3) FULL gate PASS + ratchet (l)(m)(n) PASS ở CI thật.
  Nếu merge được nhưng CHƯA đo trên bản sao PROD ⇒ **HẠ** từ "mở" sang "vá, chờ xác nhận PROD", KHÔNG
  đóng hẳn. Đóng hay hạ là **kết luận của SỐ**, không phải mong muốn.

---

## 10. Rủi ro & đường lùi

| # | Rủi ro | Chặn |
|---|--------|------|
| R1 | Guard lặp lại lỗ cũ vì invoker (`mediaos_app`) bị RLS che hàng cha tenant khác ⇒ "0 hàng" hiểu sai thành ALLOW | `SECURITY DEFINER` (§1.3) — đo được `mediaos_app` không BYPASSRLS và cả 8 bảng FORCE RLS |
| R2 | `search_path` không khoá ⇒ `EXECUTE format()` trỏ nhầm schema | `SET search_path = pg_catalog, pg_temp` + schema-qualify `public.%I`; ratchet (m) kiểm `pg_proc.proconfig` |
| R3 | `dashboard_widgets` re-home được ⇒ vô hiệu ngầm giả định "cha catalog không đổi chủ" | Vá kèm trigger bất biến trong CÙNG `0547` (§1.1, §5.2); ratchet (n) |
| R4 | Landmine "trigger đóng băng bảng giết DB init" — seed/`onConflictDoNothing()` bị chặn oan | §1.2 phân tích + **§4.4 chạy thử thật 4 script seed**, không chỉ đọc code |
| R5 | Ca DENY dựng fixture bằng bypass ⇒ xanh giả | §7.5: fixture qua route/repository thật; bảng không có route thật ⇒ chuyển sang ca đơn vị + ghi rõ giới hạn |
| R6 | Ca CASCADE bị hiểu nhầm là "guard chặn được DELETE-cascade" | §6: comment tường minh trong test + ADR ghi giới hạn forward-only |
| R7 | 3 bảng có 2 trigger cùng event — thứ tự chạy không xác định | Tên phân biệt bằng hậu tố cột (§5.4); mỗi trigger chỉ đọc ĐÚNG 1 cột qua `TG_ARGV`, không state chia sẻ ⇒ thứ tự không ảnh hưởng kết quả |
| R8 | Gỡ waiver 11→0 nhưng thi công dở ⇒ cặp lớp G mất waiver mà chưa có guard | Ratchet (l): mất waiver mà không có guard ACTIVE ⇒ ĐỎ ngay, không xanh-giả. Cộng §12: KHÔNG dừng ở đúng trạng thái đó |
| R9 | Migration "thành công" nhưng thiếu trigger | Assert cứng cuối `0547`: đếm `pg_trigger` `*_catalog_fk` = **11** và `trg_dashboard_widgets_company_immutable` tồn tại — khuôn `0535` |
| R10 | Rollback gỡ nhầm trigger/hàm của `0436`/`0531` (cùng họ tên `*_company_immutable`) | Đường lùi liệt kê **ĐÍCH DANH** 11 + 1 trigger + 1 hàm, **KHÔNG `LIKE`** (bài học R10 của `0535`) |
| R12 | Chủ hàm mất BYPASSRLS (clone `pg_restore --no-owner`, môi trường chạy migration bằng role khác) ⇒ FORCE RLS che hàng cha của tenant khác ⇒ guard **fail-open IM LẶNG** trong khi (l) và RELEASE-02 vẫn xanh | Ratchet (m) assert `rolsuper OR rolbypassrls` của `proowner` + khối tự-kiểm §5.5 điều kiện 4 |
| R13 | Gỡ waiver 11→0 làm ca (b) HIỆN CÓ đỏ ⇒ người thi công "sửa nhanh" bằng `targetTenantOnly` và **xoá mất ngữ nghĩa của (b)** | §7.2 ⛔: mở (b) thành ba trạng thái (covered / guard ACTIVE / waiver còn hạn), CẤM hạ xuống `targetTenantOnly` |
| R14 | Bước RED sinh **0 ca** vì lấy `collectCatalogFkGuards` (đọc `pg_trigger`) làm nguồn vòng lặp ⇒ "RED đạt / GREEN đạt" mà hành vi DENY chưa từng chạy | §7.4 ⛔: nguồn phải là `collectFkPairs().filter(!targetTenantOnly)` (đọc `pg_constraint`, có đủ 11 cặp cả trước lẫn sau migration) |
| R15 | Typo trong `TG_ARGV[1]` ⇒ `to_jsonb(NEW) ->> '<sai>'` trả NULL im lặng ⇒ bảng đó KHÔNG được bảo vệ | §5.3: `IF NOT (to_jsonb(NEW) ? v_fk_col) THEN RAISE`; §7.1: (l) so khớp cả `argv[0]` lẫn `argv[1]` |
| R16 | Waiver quá hạn xanh vĩnh viễn (`/due date \d{4}-\d{2}-\d{2}/` khớp cả `2020-01-01`) | §7.3(l): PARSE ngày, assert `> Date.now()` |
| R17 | Migration seed catalog NOTI chạy SAU `0547` tự abort giữa deploy vì tổ hợp #4 | §1.2 đường bỏ sót #1: luật `AND e.company_id IS NULL` trong join, ghi vào header + ADR |
| R18 | Guard chặn oan một luồng ghi thật ở PROD, chỉ có rollback toàn phần | §10 đường **hạ hoả**: `ALTER TABLE <bảng> DISABLE TRIGGER <tên>` cho ĐÚNG một cặp. Hệ quả MONG MUỐN: ratchet (l) ĐỎ ngay vì `tgenabled <> 'O'` ⇒ tắt guard **không thể im lặng** |
| R11 | **`EXECUTE` KHÔNG đặt `FOUND`** ⇒ `IF NOT FOUND THEN RETURN NEW` luôn đúng ⇒ **guard CHẾT, không chặn gì**, trong khi migration + ratchet + RELEASE-02 đều báo "đã vá" | **ĐÃ ĐO 2026-08-25** (§5.3 ⛔). Dùng cờ sentinel `SELECT true, company_id INTO v_found, …`; `v_found IS NULL` = 0 hàng. Chốt: ca DENY của cả 11 cặp + quy trình RED-trước §7.5 (DENY phải ĐỎ trước migration) — "trigger tồn tại" KHÔNG chứng minh "trigger chặn được" |

---

## 11. Định nghĩa hoàn thành

- [ ] **LÀM TRƯỚC DÒNG CODE ĐẦU TIÊN**: thêm `"apps/api/migrations/**"` (và `"docs/_review/**"` nếu sẽ
      regen artifact census) vào `paths` của `S10-SEC-FKCATALOG-1` trong `harness/backlog.mjs`.
      ⛔ Hiện `paths` chỉ có `apps/api/src/db/**`, **không phủ `apps/api/migrations/**`** — nơi
      `0547_*.sql` và `meta/_journal.json` thực sự nằm. Hệ quả: artifact QUAN TRỌNG NHẤT của WO nằm
      ngoài scope ⇒ hook `guard-scope` cảnh báo mỗi lần ghi (nhiễu → nhờn → bỏ qua cả cảnh báo thật),
      và `paths` là thứ lái **gate + scheduler** ⇒ diff chạm migration có thể bị định tuyến sai tầng
      review, đúng lúc cần FULL gate nhất.
- [ ] `0547` vào `journal` (idx 214, tag khớp tên file), áp được trên lane sạch, **idempotent**.
- [ ] `0547` có **khối tự-kiểm cuối file** (§5.5, 5 điều kiện) — đặc biệt điều kiện 4 (chủ hàm
      BYPASSRLS).
- [ ] 11 `CREATE TRIGGER` đều có mệnh đề `WHEN (NEW.<fkcol> IS NOT NULL)` (§5.4).
- [ ] Ca **(b)** của ratchet đã mở thành ba trạng thái (§7.2 ⛔) — **KHÔNG** hạ xuống `targetTenantOnly`.
- [ ] 13 số đo TRƯỚC/SAU (§4) = 0/0 trên lane; và trên bản sao PROD trước khi ĐÓNG KI-055.
- [ ] `fk-tenant-census.ts` có `collectCatalogFkGuards` (đọc catalog, không regex).
- [ ] `fk-tenant-verdicts.ts`: waiver **11 → 0**, số đo doc-comment cập nhật 460 → 459.
- [ ] `xtenant-fk-ratchet.int-spec.ts` có ca (l)(m)(n), PASS ở CI thật (không gate `LANE_DB`).
      (l) parse hạn waiver + assert FK một-cột còn sống; (m) assert `proowner` BYPASSRLS.
- [ ] `catalog-fk-tenant-guard.int-spec.ts` mới: DENY + ALLOW-global (+ALLOW-same-tenant khi có đường
      thật) cho 11 cặp data-driven + 2 ca cứng cho `user_roles.role_id → roles` + DENY tổ hợp #4 cho 2
      cặp nullable + `cascade-unreachable` + PIN chống co-về-rỗng.
- [ ] Chạy thử `seed-admin.mjs`/`seed-operator.mjs`/`demo-seed-base.mjs`/`demo-seed-full.mjs` trên lane
      đã áp `0547` — PASS, không 23503/23514 lạ.
- [ ] `DECISIONS-10` viết xong: cơ chế + 2 hướng loại + composite FK đã loại từ `0535` + giới hạn
      forward-only + dư nợ `dashboard_widgets` + đánh đổi SECURITY DEFINER.
- [ ] `docs/erd-current.md` Phụ lục A cập nhật.
- [ ] `RELEASE-02` KI-055: đóng (đủ 3 điều kiện §9) hoặc hạ xuống "vá, chờ xác nhận PROD" — KHÔNG để
      nguyên "mở" nếu code đã merge.
- [ ] FULL gate PASS: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` +
      `santa-method`. **NGƯỜI CHỐT merge.**
- [ ] `harness/backlog.mjs` mục `S10-SEC-FKCATALOG-1` cập nhật kèm số đo.

---

## 12. Tiêu chí DỪNG bàn giao nếu ngân sách phiên hết

Việc này đắt (crown-jewel, FULL gate, 12 trigger + 1 hàm + 1 file test mới + mở rộng 3 file). Nếu ngân
sách hết, DỪNG ở mốc **gần nhất đã đạt SẠCH** (mốc sau chỉ có giá trị khi mốc trước không dở dang):

1. **Mốc tối thiểu có giá trị**: plan này PASS `plan-reviewer` — không thi công gì thêm.
2. **Mốc 2**: `0547` viết xong, vào journal, áp được trên lane sạch (idempotent), 13 số đo = 0/0, nhưng
   CHƯA mở rộng census/verdict/ratchet/test hành vi. Bàn giao rõ: "migration đã lên, guard đã chạy
   được, CHƯA có lưới chống mọc thêm và CHƯA có ca nghiệm thu hành vi — **đừng đóng KI-055**".
3. **Mốc 3**: Mốc 2 + census/verdict/ratchet (l)(m)(n) xong và xanh.
4. **Mốc 4 (hoàn thành)**: toàn bộ §11.

⛔ **KHÔNG dừng giữa việc sửa `fk-tenant-verdicts.ts` (waiver 11→0) khi guard tương ứng chưa lên và
chưa xanh ở ratchet** — đó là trạng thái NGUY HIỂM HƠN lúc bắt đầu (waiver gỡ nhưng guard chưa chặn =
lỗ mở mà sổ sách nói đã đóng). Nếu buộc phải dừng đúng lúc đó, **khôi phục waiver cũ (giữ 11)** thay vì
để dở dang.
