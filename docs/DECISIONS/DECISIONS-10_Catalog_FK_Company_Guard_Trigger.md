# DECISIONS-10 — FK trỏ catalog TOÀN CỤC: guard bằng TRIGGER, không composite FK, không CHECK (KI-055)

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-08-25** — thi hành trong WO `S10-SEC-FKCATALOG-1`, mig `0547` |
| **Ngày** | 2026-08-25 |
| **Bối cảnh** | KI-055 (RELEASE-02) — 11 cặp FK "lớp G" còn hở sau `S6-SEC-XTENANTFK-1`/mig `0535`; nặng nhất `user_roles.role_id → roles` |
| **Vùng** | 🔴 ĐỎ — crown-jewel: cô lập tenant ở tầng DB (BẤT BIẾN #1), chạm bảng phân quyền `user_roles`, thêm hàm `SECURITY DEFINER` |
| **Phạm vi** | 1 hàm plpgsql + 11 trigger trên 8 bảng con + 1 trigger bất biến cho `dashboard_widgets`. **KHÔNG** đụng policy RLS, grant, schema Drizzle, dữ liệu |

---

## 1. Vấn đề — cái mà composite FK KHÔNG vá được

Kiểm tra khoá ngoại của Postgres chạy với quyền hệ thống và **không áp RLS** (hành vi thiết kế). Nên
FK một-cột `child.x → parent(id)` giữa hai bảng đều có `company_id` cho phép app role đứng trong ngữ
cảnh tenant A ghi hàng `company_id = A` mà `x` trỏ tới hàng của B — FK thấy hàng đó tồn tại nên cho
qua, RLS `WITH CHECK` chỉ soi `company_id` (= A, hợp lệ). Đó là KI-046.

`0535` vá **448/459** cặp bằng composite FK `(company_id, x) → parent(company_id, id)`. **11 cặp
không vá được** vì bảng đích là **catalog TOÀN CỤC** (`parent.company_id` NULLABLE, phần lớn hàng
`company_id IS NULL` dùng chung mọi tenant): `roles` · `dashboard_widgets` · `notification_events` ·
`notification_templates` · `public_holidays` · `seed_batches`.

**Tác hại đã ĐO** (rls-tenant-isolation-tester, FULL gate 2026-07-31): A gán được role của B ⇒ B xoá
role của chính B (thao tác hợp lệ trong tenant B) làm hàng `user_roles(company_id = A)` **biến mất
theo CASCADE xuyên tenant** — tenant B tự ý gỡ quyền của người thuộc tenant A.

**Đo lại 2026-08-25 trên lane đã áp `0000→0546`**, bằng ca hành vi chứ không bằng suy luận:
**11/11 cặp GHI THÀNH CÔNG** hàng lệch tenant dưới `mediaos_app` + GUC. Lỗ khai thác được, không phải
rủi ro lý thuyết. Hệ thống chạy N=1 nên **0 hàng thật** bị ảnh hưởng hôm nay — đây là nợ TOÀN VẸN cho
lúc mở rộng đa-công-ty, nhưng `user_roles` là bảng phân quyền nên bản vá phải ĐÚNG chứ không phải NHANH.

---

## 2. Hai hướng bị LOẠI — kèm bằng chứng, để không ai thử lại

**(a) Composite FK (khuôn của `0535`) — ĐÃ THỬ, ĐÃ HỎNG.** Thêm composite FK cho `user_roles.role_id`:

```text
Key (company_id, role_id)=(A, <role hệ thống>) is not present in table "roles"
```

Composite FK đòi khớp ĐÚNG `company_id`, nên nó chặn luôn tham chiếu **hợp lệ** tới hàng toàn cục ⇒
không gán được role hệ thống, không cấu hình được widget/template dùng chung. Đây chính là lý do 11 cặp
được ký waiver ở `0535` thay vì vá.

**(b) `CHECK` + hàm đọc bảng khác — loại vì hai lý do đã trả giá thật trong repo:**

1. **`CHECK` không diễn đạt được quan hệ ĐỘNG.** PG **không đánh giá lại** CHECK khi bảng CHA đổi, nên
   một hàng cha bị "re-home" sang tenant khác sau đó sẽ không bị bắt lại. (Cùng lớp bài học
   "CHECK không ép được chuyển tiếp FSM".)
2. **`pg_dump`/restore áp CHECK không theo thứ tự đảm bảo với dữ liệu** — thứ tự `COPY` là topological
   theo FK, không theo phụ thuộc ẩn của một CHECK gọi hàm đọc bảng cha.

---

## 3. Quyết định — trigger `BEFORE INSERT OR UPDATE` trên bảng CON

Một hàm dùng chung `enforce_company_id_catalog_fk()`, tham số hoá qua `TG_ARGV` (bảng cha, cột FK), gắn
11 trigger có mệnh đề `WHEN (NEW.<col> IS NOT NULL)`.

**Ngữ nghĩa — 4 tổ hợp** (con = `NEW.company_id`, cha = `company_id` của hàng đích):

| # | con | cha | quyết | vì sao |
| --- | --- | --- | --- | --- |
| 1 | tenant | tenant **khác** | **DENY** 23503 | chính là lỗ đang vá |
| 2 | tenant | **cùng** tenant | ALLOW | luồng nghiệp vụ bình thường |
| 3 | bất kỳ | **TOÀN CỤC** (NULL) | ALLOW | catalog dùng chung — thứ composite FK đã phá |
| 4 | **TOÀN CỤC** (NULL) | tenant | **DENY** 23503 | rò theo chiều NGƯỢC, phạm vi là MỌI tenant ⇒ nặng hơn #1 |

Cột FK tự nó NULL ⇒ bỏ qua. **Cha không tồn tại ⇒ `RETURN NEW`**, để FK một-cột cũ raise 23503 chuẩn
của nó (một nguồn lỗi duy nhất cho "mồ côi khoá ngoại"). Đây là fail-open **có kiểm soát** và nó chỉ
đúng chừng nào FK một-cột cũ còn sống ⇒ **KHÔNG DROP FK một-cột**, và ghim bằng ratchet (l).

`ERRCODE = foreign_key_violation` (23503, không phải `check_violation` của `0436`) vì đây đúng bản chất
là mở rộng của ràng buộc khoá ngoại, và để nhất quán với đường xử lý `err.constraint`/23503 mà
`tenant-isolation.int-spec.ts` (ca W4, từ `0535`) đã dựng sẵn.

### 3.1 Ba cách hỏng IM LẶNG đã bị chặn TẠI GỐC (đo bằng thực nghiệm, không phải phòng xa)

1. **`EXECUTE` KHÔNG đặt `FOUND`.** Bản nháp viết `IF NOT FOUND THEN RETURN NEW` ngay sau
   `EXECUTE … INTO`. PL/pgSQL chỉ cho `EXECUTE` cập nhật `GET DIAGNOSTICS`, **không** cập nhật `FOUND`
   ⇒ giá trị đọc được chỉ là tàn dư của câu TRƯỚC đó; trong thân trigger này không câu nào đặt `FOUND`
   ⇒ điều kiện LUÔN đúng ⇒ **guard `RETURN NEW` vô điều kiện, không bao giờ chặn gì** — mà migration
   vẫn xanh và trigger vẫn "tồn tại". Vá bằng **cờ sentinel** `SELECT true, company_id INTO v_found, …`
   (phân biệt cả ba ca trong đúng một câu lệnh).
2. **`->>` với khoá không tồn tại trả NULL chứ không lỗi** ⇒ một ký tự gõ nhầm trong `TG_ARGV[1]` làm
   bảng đó không được bảo vệ mà không có gì kêu. Vá: `IF NOT (to_jsonb(NEW) ? v_fk_col) THEN RAISE`.
3. **Chủ hàm không BYPASSRLS** — xem §4.

---

## 4. Đánh đổi `SECURITY DEFINER` — nói thẳng

**Vì sao bắt buộc.** Cả 8 bảng con đều `relrowsecurity = on` **VÀ** `relforcerowsecurity = on`;
`mediaos_app` không BYPASSRLS. Nếu hàm chạy bằng quyền invoker, câu `SELECT company_id FROM roles
WHERE id = $1` trong ngữ cảnh tenant A bị policy `USING (company_id = GUC OR company_id IS NULL)` **che
hàng của tenant B** ⇒ trả 0 hàng ⇒ rơi vào nhánh "cha không tồn tại" ⇒ `RETURN NEW` ⇒ **guard cho qua
đúng cái nó phải chặn**. Tức lỗ đang vá tái xuất hiện ngay trong lớp guard mới.

**Giá phải trả.** Thêm một hàm `SECURITY DEFINER` thuộc role có BYPASSRLS = thêm một bề mặt leo thang.
Giảm thiểu: thân hàm chỉ có đúng một `SELECT company_id FROM <cha> WHERE id = …`; không nhận tham số do
người dùng điều khiển ngoài giá trị cột; `search_path = pg_catalog, pg_temp` khoá cứng (hẹp hơn
`public, pg_temp` của `0534` vì thân hàm schema-qualify `public.%I` tường minh); `REVOKE ALL FROM
PUBLIC` và **không** `GRANT EXECUTE` cho ai (đã đo: trigger vẫn bắn, vì PG kiểm quyền EXECUTE lúc TẠO
trigger chứ không lúc bắn).

**⚠️ Điều kiện sống-còn phải canh mãi mãi:** `pg_proc.proowner` của hàm phải có `rolsuper` HOẶC
`rolbypassrls`. Mất tính chất đó (kịch bản thật: `pg_restore --no-owner` khi clone PROD, hoặc migration
chạy bằng `mediaos_owner`) ⇒ guard **fail-open IM LẶNG** trong khi trigger vẫn tồn tại + ACTIVE và mọi
lưới khác vẫn xanh. Ghim ở **hai** chỗ: khối tự-kiểm cuối `0547` (điều kiện 4) và ratchet **(m)**.

---

## 5. Vá kèm: `dashboard_widgets` bất biến `company_id` (dư nợ của `0531`)

`0436` gắn `enforce_company_id_immutable` cho 6 bảng, `0531` thêm 2 — **`dashboard_widgets` bị bỏ sót**
(đo trên `pg_trigger`: đúng 8 bảng, không có nó), trong khi 17/17 hàng của nó là hàng toàn cục. Guard
mới kiểm quan hệ con→cha **tại lúc ghi hàng CON**; nếu cha còn re-home được thì một actor cướp widget
toàn cục về tenant mình sẽ biến mọi `dashboard_widget_cache/_configs` của tenant KHÁC thành hàng vi
phạm **sau khi đã ghi** — guard không bắn lại nên không bắt được. Vá kèm trong cùng migration (chi phí
= 1 trigger, cùng hàm cũ); **không** cấp số hiệu KI mới. Ghim bằng ratchet **(n)**.

---

## 6. Giới hạn đã biết — phải đọc trước khi tuyên bố "đã đóng"

- **FORWARD-ONLY, KHÔNG hồi tố.** Hàng lệch tạo TRƯỚC `0547` vẫn nguyên trong DB; nếu cha bị xoá thì
  CASCADE cũ vẫn xảy ra y hệt. Đo được **0 hàng lệch** trên cả lane lẫn PROD nên hôm nay vô hại — nhưng
  `0547` **không dọn gì cả**, vì không có gì để dọn.
- **`COPY`/restore là đường duy nhất còn lại** để hàng lệch quay vào DB (BEFORE ROW trigger CÓ bắn
  trong `COPY`; hôm nay không bị chặn oan chỉ vì `pg_dump` phát trigger ở section post-data). ⇒ Sau mỗi
  lần restore phải chạy lại 13 câu đo, hoặc `FK_DRIFT_ASSERT=1` + `xtenant-fk-ratchet.int-spec.ts`.
- **Guard không chạm chiều DELETE của bảng cha.** `ON DELETE CASCADE` giữ nguyên ngữ nghĩa 100%; chuỗi
  tác hại đứt ở MẮT ĐẦU TIÊN (không tạo được hàng lệch), không phải ở mắt CASCADE.
- **Chi phí chạy:** mỗi INSERT/UPDATE trên 8 bảng con chạy thêm 1 lượt SELECT PK-lookup trên bảng cha
  (3 bảng có 2 cột FK ⇒ 2 lượt), cộng chi phí dynamic SQL. Mệnh đề `WHEN` cắt trọn chi phí cho nhánh FK
  NULL. Không phải "miễn phí".
- **Oracle tồn-tại (dư nợ chấp nhận được, nói ra để không ai "phát hiện lại" nó như lỗ mới).** Thông
  điệp lỗi phân biệt được ba trạng thái của một UUID do người gọi cung cấp: *ghi được* (cha toàn cục
  hoặc cùng tenant) · *`catalog_fk_tenant_mismatch`* (cha TỒN TẠI nhưng của tenant khác) · *23503 của
  FK cũ* (cha không tồn tại). Trước `0547` chỉ có hai trạng thái (tồn tại / không). Đánh giá: **chấp
  nhận** — muốn dùng được oracle này phải ĐOÁN TRÚNG một UUIDv4, và người gọi đã phải có quyền GHI lên
  bảng con của chính mình; đổi lại là chặn được một đường ghi chéo tenant thật. Không làm mờ thông điệp
  vì thông điệp rõ là thứ giúp chẩn đoán sự cố ghi ở PROD.
- **Hệ quả đo được lên lưới khác:** `tenant-isolation.int-spec.ts` PIN "số bảng CHỨNG MINH được
  `WITH CHECK`" tụt **148 → 147** (đo A/B trên cùng lane: guard BẬT 147/156, guard DISABLE 151/156).
  Bốn bảng (`notification_templates`, `seed_items`, `dashboard_widget_configs`,
  `dashboard_widget_cache`) nay bị guard chặn **trước** khi `WITH CHECK` kịp lên tiếng. Đây là **CHE**,
  không phải MẤT: policy của chúng không bị đụng, và chúng nay có HAI tuyến thay vì một.

---

## 7. Luật cho migration SAU (một câu, chặn một sự cố deploy)

Seed `notification_templates` toàn cục **phải** kèm `AND e.company_id IS NULL` khi JOIN sang
`notification_events`. Khuôn hiện tại (`0481`, `0490`, `0507`, `0529`, `0538`) resolve `e.id` theo
`event_code`; nếu một hàng `notification_events` mang `company_id` của tenant trùng `event_code` thì
template `company_id NULL` sẽ trỏ cha có chủ = **tổ hợp #4 = DENY** ⇒ migration NOTI kế tiếp **abort
giữa deploy**. Hôm nay 61/61 event toàn cục nên chưa xảy ra — nhưng dự án đã thêm catalog NOTI 5 lần.

---

## 8. Lưới giữ quyết định này sống

| chốt | ở đâu | bắt được gì |
| --- | --- | --- |
| tự-kiểm 5 điều kiện | cuối `0547` | migration chạy xong nhưng guard không sống (abort + rollback) |
| ca hành vi 4 tổ hợp | `catalog-fk-tenant-guard.int-spec.ts` | guard chặn sai / chặn nhầm hàng toàn cục |
| (b) ba trạng thái | `xtenant-fk-ratchet.int-spec.ts` | cặp lớp G mới không có phán quyết nào |
| (l) guard XOR waiver + FK cũ còn sống | ratchet | trigger bị DROP/DISABLE · waiver hết hạn · FK một-cột bị gỡ |
| (m) tư thế hàm | ratchet | mất `SECURITY DEFINER`/`search_path`/chủ hàm BYPASSRLS ⇒ fail-open im lặng |
| (n) `dashboard_widgets` immutable | ratchet | dư nợ `0531` mở lại |

`FK_TENANT_WAIVERS` **về 0** và `FK_LAYER_G_GUARD_FLOOR = 11`. Waiver lớp G trong tương lai bắt buộc
kèm `due date YYYY-MM-DD` + WO theo dõi; ratchet **parse ngày** (khớp regex thôi thì `due date
2020-01-01` xanh vĩnh viễn — van an toàn thành cửa mở).
