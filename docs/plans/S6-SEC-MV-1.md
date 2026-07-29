# S6-SEC-MV-1 — ranh giới tenant cho 2 matview dashboard (KI-041)

> **Zone:** 🔴 red (RLS · migration). **Migration:** `0534_s6secmv1_dashboard_mv_tenant_barrier.sql`.
> **Ngày:** 29/07/2026 · **Hướng chốt với owner:** *wrapper view + REVOKE*, và **sửa đường refresh trong cùng WO**.

---

## 1. Vấn đề

PostgreSQL **không hỗ trợ RLS trên materialized view**. `mv_dashboard_task_status` và `mv_dashboard_output` mang cột `company_id` nhưng nằm **ngoài** phép đo `153/153` bảng RLS, nên ranh giới tenant duy nhất là dòng `WHERE company_id = $1` viết tay trong `mv-dashboard.service.ts` — tức **kỷ luật của dev**, đúng thứ BẤT BIẾN #1 nói không được dựa vào.

**Vế RED đo được** (lane, role `mediaos_app`, không mệnh đề lọc):

```
SELECT count(*), count(DISTINCT company_id) FROM mv_dashboard_task_status
⇒ 56 hàng / 38 tenant
```

---

## 2. Ba tiền đề của WO seed — đo lại, HAI cái sai

WO tự cảnh báo "tiền đề đã sai, đo lại trước". Kết quả:

| Tiền đề trong WO | Số đo 29/07/2026 | Kết luận |
| --- | --- | --- |
| Đường refresh **không chạy** (worker thiếu quyền) | `mediaos_worker` → REFRESH ⇒ `permission denied`; `mediaos` (owner) → OK, và làm **56→54 hàng / 38→37 tenant** | ✅ **ĐÚNG** — và dữ liệu đã cũ THẬT |
| `mv_dashboard_output` **0 consumer** ⇒ ứng viên DROP | `GET /dashboard/mv-stats` (gate `read:dashboard`) trả **CẢ HAI** nửa; `getMvStats` có trong `web-core`. Chỉ là **chưa màn hình nào gọi** | ❌ **SAI** — có route sống, không phải 0 consumer |
| `docs/DB` xác nhận park ⇒ đủ điều kiện DROP | `grep` toàn `docs/DB/` = **0 dòng** nhắc tới hai matview | ❌ **SAI** — điều kiện DROP không thoả; cộng CLAUDE.md §1 "không xóa ở đợt này" ⇒ **KHÔNG DROP** |

⇒ **Rút bề mặt bằng DROP bị loại.** Giữ cả hai object, dựng ranh giới thật quanh chúng.

---

## 3. Cách vá (mig 0534)

1. **REVOKE SELECT** trên **cả hai** matview khỏi `mediaos_app` + `mediaos_worker` — không còn cửa đọc thẳng.
2. **View chắn tenant** `v_dashboard_task_status` · `v_dashboard_output`, `WITH (security_barrier = true)`, lọc
   `company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid`
   — đúng biến `withTenant()` set. `GRANT SELECT` các view này cho `mediaos_app`.
3. Service đọc `v_*`; vế `WHERE company_id = $1` **giữ nguyên** làm đai thứ hai (phòng thủ theo lớp).
4. **Đường refresh:** hàm `refresh_dashboard_mvs()` `SECURITY DEFINER`, owner `mediaos` (**có BYPASSRLS**), `search_path` chốt cứng; worker chỉ `EXECUTE`, `REVOKE ALL … FROM PUBLIC`.

### Vì sao từng lựa chọn

- **`security_barrier`** bắt buộc: thiếu nó planner được đẩy hàm do người dùng cung cấp xuống **dưới** vế lọc tenant (leaky view) ⇒ quan sát được hàng tenant khác trước khi bị loại.
- **`current_setting(..., true)`** (missing_ok): ngoài `withTenant` biến không tồn tại ⇒ `false` sẽ **ném 42704** làm mọi câu thành 500 khó chẩn; `true` trả NULL ⇒ **0 hàng, fail-closed**.
- **`NULLIF(…, '')`**: `set_config` trả `''` chứ không NULL ⇒ thiếu NULLIF thì `''::uuid` ném **22P02**.
- **CẤM `ALTER MATERIALIZED VIEW … OWNER TO mediaos_worker`**: worker **không** có BYPASSRLS mà `tasks` FORCE RLS ⇒ REFRESH dưới quyền worker cho matview **rỗng lặng lẽ**. Đổi chủ sở hữu là cái bẫy, không phải cái vá.
- **CONCURRENTLY trong hàm**: đã **thử nghiệm** trên lane — chạy được (khác `REINDEX`/`VACUUM`). Giữ nguyên chiến lược: `task_status` CONCURRENTLY (unique index cột trần, 0502); `output` luôn refresh thường (unique index là **biểu thức** COALESCE, 0102).

---

## 4. RED → GREEN

**RED chạy thật, không phải suy luận.** Sau khi migration đã áp, tạm **khôi phục grant cũ** trên lane để mô phỏng trạng thái trước 0534:

```
GRANT SELECT ON mv_dashboard_task_status, mv_dashboard_output TO mediaos_app, mediaos_worker;
⇒ 3 ca ĐỎ:  app role KHÔNG đọc thẳng được mv_dashboard_task_status
             app role KHÔNG đọc thẳng được mv_dashboard_output
             worker role cũng KHÔNG đọc thẳng / KHÔNG REFRESH thẳng được MV
REVOKE lại ⇒ 13/13 xanh
```

Suite: `test/integration/dashboard-mv-tenant-barrier.int-spec.ts` — 13 ca phủ: cửa đọc thẳng bị chặn (app + worker) · fail-closed ngoài ngữ cảnh · tenant không tồn tại · chuỗi rỗng (22P02) · **cô lập tenant hai chiều** (chỉ + đủ) · refresh sống lại **và không làm rỗng MV** · hàm không mở cho PUBLIC · view thực sự `security_barrier`.

> **Suite TỰ SEED 2 tenant của mình.** Bản đầu đọc "2 tenant nhiều hàng nhất" từ MV — xanh trên lane dev (sẵn 38 tenant rác) nhưng sẽ **đỏ trên CI** nơi MV rỗng. Đã sửa trước khi push; verify lại trên **lane dựng mới hoàn toàn** (`mediaos_mvfresh`, chain `0000→0534`): **89/89 xanh**.

---

## 5. Ba hồi quy phát hiện khi chạy suite đầy đủ — cả ba là lỗi THẬT, đã vá

| Spec | Triệu chứng | Chẩn đoán |
| --- | --- | --- |
| `mv-dashboard-tenant-isolation.int-spec.ts` | 3 ca ⇒ 0 hàng | Stub `withTenant: (_id, fn) => fn(db)` **bỏ qua GUC tenant** — vô hại khi đọc thẳng MV, nhưng view chắn lọc CHÍNH GUC đó. **Stub bỏ mất cơ chế đang được kiểm mới là bug**; đã sửa stub set `app.current_company_id` thật, trong transaction, đúng như production |
| `rls-guards.int-spec.ts` | `v_dashboard_*` "chưa đăng ký harness" | Lưới liệt kê bằng `information_schema.columns` — **không liệt kê materialized view**. Đây chính là **gốc của KI-041**: chốt "lưới không thủng im lặng" đã thủng đúng chỗ nó hứa canh |
| `dash-seed-catalog-permissions.int-spec.ts` | `'28'` ≠ `'26'` | Flake đếm grant khi chạy song song (memory `super-admin-bootstrap-flaky-count`) — xanh khi chạy cô lập, không liên quan WO |

### 5.1 Nới lưới `rls-guards` — mở RỘNG, không phải nới lỏng

Đổi nguồn liệt kê sang `pg_class` (thấy cả `r` · `m` · `v`) và phân loại theo cơ chế cô lập ĐÚNG của từng loại:

- **bảng (`r`)** → phải có case trong `RLS_TABLES` *(giữ nguyên luật cũ; 153 bảng)*
- **matview (`m`)** → không thể có RLS ⇒ app role **không được** có SELECT thẳng
- **view (`v`)** phơi `company_id` → **phải** `security_barrier`

Đây là chỗ đáng chú ý nhất của WO: nếu lưới nhìn thấy matview từ đầu thì **KI-041 đã không tồn tại**. Nay nó nhìn thấy.

---

## 6. Verify

| Bước | Kết quả |
| --- | --- |
| Migration `0000→0534` trên DB **dựng mới** | ✅ áp sạch (`mediaos_mvfresh`) |
| `dashboard-mv-tenant-barrier` + `src/dashboard` trên lane mới | ✅ 89/89 |
| `lint` · `typecheck` · `build` | ✅ · ✅ · ✅ |
| RED-proof (khôi phục grant cũ) | ✅ đúng 3 ca đỏ, REVOKE lại ⇒ xanh |
| `mv-taskstatus-canonical` (D-30) | ✅ giữ xanh — dùng `directPool()` (owner), không bị REVOKE chạm |

> **FULL gate agent (`database-reviewer`, `rls-tenant-isolation-tester`) KHÔNG chạy** — phiên bị cấu hình cấm gọi sub-agent. Thay bằng: đo ACL/quyền trên Postgres THẬT theo từng role, RED-proof bật/tắt grant chạy thật, dựng lane mới hoàn toàn để loại xanh-giả do dữ liệu sẵn có, và mở rộng chính lưới đã để lọt KI-041. **Cần người chốt trước merge** (zone đỏ, có migration).

---

## 7. Nợ để lại

- **Pha CONTRACT chưa chạy:** `GET /dashboard/mv-stats` vẫn trả nửa `output` từ một matview họ media-era đang park. Khi WO dọn de-media-fy chạy, cân nhắc gỡ nửa đó khỏi contract rồi mới DROP object.
- **Chưa có lịch refresh:** đường refresh nay *chạy được* nhưng **chưa ai gọi định kỳ** (0 cron/job đăng ký). Matview sẽ vẫn cũ cho tới khi có scheduler — cần WO nhỏ cắm `refresh_dashboard_mvs()` vào BullMQ/cron. **Đây là điều kiện để số liệu dashboard đúng, không chỉ an toàn.**
- **`mv_dashboard_output` vẫn dùng taxonomy lowercase legacy** trong khi `taskStatus[]` đã canonical TitleCase — hai bộ giá trị trong một response (đã ghi sẵn trong `mv-dashboard.service.ts`).
