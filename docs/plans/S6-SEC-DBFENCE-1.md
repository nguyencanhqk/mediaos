# S6-SEC-DBFENCE-1 — Bịt nguồn rò "test ghi thẳng vào DB PROD" (KI-028 MỞ LẠI)

> Zone: **red / crown-jewel** · Gate: **FULL** (security-reviewer + rls-tenant-isolation-tester)
> Trạng thái plan: viết 2026-07-28, TRƯỚC khi code.

## 0. Một câu

Lần đóng 27/7 chỉ **dọn rác** (containment 16/74 tenant) mà **không bịt vòi**; 2 ngày sau rác mọc lại
gấp 4,6 lần. WO này bịt vòi TRƯỚC (fail-closed ở tầng resolver + một cổng chặn không thể lách bằng
biến môi trường), rồi mới purge, rồi cắm chốt hồi quy để không có lần thứ ba.

## 1. Số đo TRƯỚC (đo trực tiếp trên PROD `mediaos`, 2026-07-28 03:57Z)

| Chỉ số | Giá trị |
| --- | --- |
| `companies` tổng | **75** |
| khớp mẫu tenant test `slug ~ '-[0-9a-f]{8}$'` | **74** |
| công ty THẬT | **1** (`funtime`) |
| công ty không khớp mẫu nào (rủi ro sót) | **0** |
| `users` thuộc 74 tenant test | **251** (226 chưa xoá · **226 active**) |
| trong đó có hash mật khẩu THẬT (argon2/bcrypt) | **55** |
| grant role TOÀN CỤC (`roles.company_id IS NULL`) | 23 company-admin · 5 platform-admin · 5 employee |
| **GIAO: active + hash thật + giữ role toàn cục** | **18** (13 company-admin + **5 platform-admin**) |
| refresh token còn sống của tenant test | **37** |
| tenant test sinh trong 7 ngày / 48h | **74 / 58** |
| `funtime` (BẤT BIẾN không được chạm) | **46 user** = 35 active + 11 locked + 0 soft-deleted |

Mốc thời gian: cũ nhất `2026-07-25 11:54Z`, mới nhất `2026-07-27 08:08Z` → rác sinh **sau** lần
containment 27/7 ⇒ chứng minh nguồn rò còn sống.

## 2. Nguồn rò — phân tích gốc

`apps/api/vitest.config.ts:11`

```ts
const db = process.env.LANE_DB ?? "mediaos";   // ← thiếu LANE_DB thì trỏ THẲNG DB PROD
```

`laneDbEnv()` **luôn** trả về `DATABASE_URL/DIRECT/WORKER` (không bao giờ rỗng), mà
`test/helpers/integration-db.ts` chốt `hasDb = Boolean(directUrl && appUrl)` ⇒ **`hasDb` luôn `true`**.
Mọi spec gate bằng `describe.skipIf(!hasDb)` (KHÔNG đòi `LANE_DB`) sẽ CHẠY THẬT và seed vào `mediaos`.

`.env` và `.env.prod` trỏ **cùng một DB** `postgres://…@localhost:5432/mediaos` ⇒ DB test mặc định
CHÍNH LÀ DB PROD.

**Đây là một LỚP lỗi, không phải một file.** Đo trên 266 file spec (`*.int-spec.ts` · `*.int.spec.ts` ·
`*.e2e-spec.ts`):

| Nhóm | Số file |
| --- | --- |
| gate có `LANE_DB` (an toàn) | 199 |
| **gate CHỈ `hasDb` — thiếu `LANE_DB`** | **63** |
| ↳ trong đó **tạo company** (nguồn sinh tenant rác) | **56** |
| không dùng cả hai | 4 |

(6/56 hiện bị `exclude` trong vitest.config — finance×3, workflow-lifecycle, webhooks-deny,
ui-config-deny ⇒ ~50 file đang thật sự bắn vào PROD mỗi lần chạy `pnpm test` không có `LANE_DB`.)

⇒ **Sửa ở gốc (resolver + một cổng chung), KHÔNG vá 56 file.** Vá từng file là mời lỗi thứ 57.

## 3. Thiết kế hàng rào (3 lớp, fail-closed)

### L1 — resolver fail-closed (`apps/api/test/db-target.ts` + `vitest.config.ts`)

Tách logic resolve DB đích ra module thuần, kiểm thử được:

1. Không có `LANE_DB` **và** không có `DATABASE_URL/DIRECT/WORKER` tường minh
   ⇒ trả **chuỗi rỗng** cho cả 3 URL. `hasDb = Boolean("" && "")` = `false` ⇒ **mọi int-spec SKIP**.
   Bỏ hẳn fallback `?? "mediaos"`.
2. DB đích (từ `LANE_DB` hoặc parse ra từ URL tường minh) nằm trong **denylist được bảo vệ**
   (`mediaos`, `mediaos_dev` — DB của `.env.prod` / `.env.dev-online`) ⇒ **THROW** ngay lúc load config,
   trừ khi `CI` được set (DB của CI là container ephemeral cùng tên).
   Denylist đọc thêm được từ `TEST_DB_DENYLIST` (phân tách bằng dấu phẩy).

> `pnpm test` (unit, không DB) vẫn chạy bình thường ở nhánh 1 — KHÔNG throw, chỉ skip int-spec.

### L2 — cổng chặn không lách được bằng env (`apps/api/test/global-setup.ts`)

`CI=1` đặt tay ở máy local vẫn lách được L1 (nhánh 2). Lớp 2 đóng cửa đó bằng **con dấu nằm trong
chính DB**, không phải trong env:

- Lane DB hợp lệ mang comment cấp database `mediaos-test-lane`.
- `globalSetup` (chạy **một lần**, trước toàn bộ suite, phủ cả 266 file — không cần sửa file spec nào)
  nối tới DB đích và đọc `shobj_description(…, 'pg_database')`. Không có dấu ⇒ **throw**, cả run dừng
  kèm hướng dẫn chạy `scripts/lane-db-setup.sh`.
- PROD `mediaos` và dev-online `mediaos_dev` **không bao giờ** được đóng dấu ⇒ không có đường ghi.
- Người đóng dấu: `scripts/lane-db-setup.sh` (lane local) + 1 step trong `.github/workflows/api.yml`
  (DB ephemeral của CI).

### L3 — chốt hồi quy (`scripts/check-prod-test-tenants.mjs`)

Đếm company khớp mẫu tenant test trong DB PROD; `!= 0` ⇒ **exit 1**. Chạy được theo lệnh; nối vào
`harness/check.sh` ở tier `--all` và **bỏ qua êm** (exit 0 + cảnh báo) khi không với tới được PROD DB
(máy khác / CI) — không tạo đỏ-giả.

## 4. RED-proof (bắt buộc — cả hai chiều)

| Chiều | Cách chứng minh |
| --- | --- |
| **TRƯỚC khi vá thật sự sinh company trong PROD** | Đếm `companies` trong `mediaos`, chạy **đúng 1** spec có seed (`test/integration/db-rls.int-spec.ts`) **không** set `LANE_DB` trên code CHƯA vá, đếm lại ⇒ delta > 0. Rác này bị dọn ở bước purge cùng WO. |
| **SAU khi vá thì 0** | Lặp lại y hệt trên code ĐÃ vá ⇒ spec SKIP và delta = **0**. |
| L1 (unit, chạy trong `pnpm test` không cần DB) | `test/db-target.unit-spec.ts`: không env ⇒ URL rỗng · `LANE_DB=mediaos` (không CI) ⇒ throw · `LANE_DB=mediaos_x` ⇒ URL đúng · URL tường minh trỏ `mediaos` (không CI) ⇒ throw. |
| L2 | Chạy suite với `LANE_DB` trỏ một DB **chưa đóng dấu** ⇒ throw đúng thông điệp; đóng dấu ⇒ xanh. |
| L3 | Chạy trên PROD lúc còn rác ⇒ exit 1; sau purge ⇒ exit 0. |

> Thêm glob `test/**/*.unit-spec.ts` vào `include` — nếu không, spec unit đặt trong `test/` **không
> bao giờ chạy** (memory `vitest-unit-specs-must-be-colocated`: xanh-giả).

## 5. Purge (SAU khi hàng rào đã đứng — người chốt trước khi chạy)

Thứ tự bắt buộc: **backup → chặn đường vào → xoá con → xoá company → đo lại**.

- `pg_dump -Fc` toàn DB trước khi chạy bất cứ gì.
- 155 FK trỏ `companies`: **144 CASCADE** + **11 NO ACTION** (`users`, `audit_logs`, `outbox_events`,
  `dead_letter_events`, `refresh_tokens`, `password_reset_tokens`, `user_totp`, `user_recovery_codes`,
  `dead_letter_alerts`, `security_alerts`, `device_tokens`) ⇒ xoá 11 bảng này trước, rồi
  `DELETE FROM companies` cho cascade lo phần còn lại.
- `audit_logs` có trigger `trg_audit_logs_block_mutation` nhưng **chỉ chặn `current_user='mediaos_app'`**
  ⇒ superuser `mediaos` xoá được, không cần tắt trigger. Dòng audit của tenant test **chính là rác test**
  — xoá là đúng, và có dump để lùi.
- Chạy trong MỘT transaction, có chốt an toàn: `funtime` lọt tập ⇒ `RAISE EXCEPTION` (rollback).
- Ưu tiên **18 tài khoản vừa-đăng-nhập-được-vừa-role-toàn-cục** (5 platform-admin) — thu hồi grant +
  cắt refresh token TRƯỚC, trong cùng transaction.

## 6. Bằng chứng SAU (điều kiện đóng KI-028)

| Kiểm | Kỳ vọng |
| --- | --- |
| company khớp mẫu tenant test trong PROD | **0** |
| user tenant test active | **0** |
| user tenant test giữ role toàn cục | **0** |
| refresh token sống của tenant test | **0** |
| `funtime` | **46 user** (35 active + 11 locked) — **0 dòng bị chạm** |
| chạy 1 spec seed không `LANE_DB` sau khi vá | SKIP · **0** company mới |
| `scripts/check-prod-test-tenants.mjs` | exit **0** |

## 7. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| CI đỏ hàng loạt vì L2 (DB ephemeral chưa đóng dấu) | Thêm step đóng dấu trong `api.yml` **cùng PR**; verify bằng chính CI của PR này. |
| Lane DB cũ trên máy dev chưa có dấu ⇒ dev bị chặn | Thông điệp lỗi in đúng lệnh `bash scripts/lane-db-setup.sh <lane>` để đóng dấu (idempotent). |
| Purge cascade chạm dữ liệu `funtime` | Chốt `funtime` trong transaction + đối chiếu 46 user trước/sau + dump. |
| `.github/workflows/**` nằm ngoài `paths` của WO | Cập nhật `paths` trong `harness/backlog.mjs` (memory `wo-paths-drive-gate-and-scheduler`). |
| Sửa `vitest.config.ts` làm `pnpm test` unit gãy | L1 nhánh 1 chỉ trả URL rỗng, KHÔNG throw; verify bằng `pnpm --filter @mediaos/api test`. |

## 8. KẾT QUẢ THI CÔNG (2026-07-28) — plan vs thực tế

Ba điều **khác** so với plan, đều do đo được chứ không do đổi ý:

1. **Chẩn đoán ban đầu của WO thiếu một vector.** Plan (và WO) quy nguồn rò về "spec thiếu gate
   `LANE_DB`". Truy nguyên 72/74 company về đúng spec sinh ra chúng (khớp tiền tố slug ↔ đối số
   `label` của `seedCompany`) cho thấy **14 company đến từ spec ĐÃ CÓ gate `LANE_DB`** — mốc thời gian
   07-27 07:55/08:02/08:03 trộn lẫn cả hai nhóm gate trong cùng một lần chạy. Kết luận đổi: **`LANE_DB`
   chưa bao giờ là thuộc tính an toàn; TÊN DB ĐÍCH mới là.** Hàng rào vì thế chốt trên tên DB đã
   resolve — nếu chỉ "thêm gate LANE_DB cho 56 file" như cách đọc ban đầu thì vector V2 vẫn còn nguyên.
2. **Vá hàng rào làm lộ vector thứ ba.** `src/db/check.ts` gọi `main()` ở top-level; `check.spec.ts`
   import các hàm thuần từ đó ⇒ **mỗi lần chạy unit test là một lần `migrate()` chạy trên DB PROD**.
   Chỉ lộ ra khi URL thôi được điền ngầm. Vá: `require.main === module`.
3. **Purge cần một bước không có trong plan.** Chứng minh "khép kín" của plan chỉ sâu MỘT tầng (FK trỏ
   `companies`/`users`). Dry-run ROLLBACK đầu tiên trượt đúng ở đó: 13 dòng `role_permissions` (bảng
   **không có** `company_id`, trỏ `roles`) thành mồ côi. Thêm PHẦN 2b (baseline treo = 0) + PHẦN 4b
   (quét mồ côi tới điểm bất động) + PHẦN 6 (quét toàn vẹn FK toàn schema).

**Bằng chứng cuối:**

| Kiểm | Kết quả |
| --- | --- |
| chạy TRỌN suite 449 file api, KHÔNG `LANE_DB` | int-spec SKIP · **75 → 75 company** (0 mới) |
| lane DB chưa đóng dấu | từ chối chạy, exit 1, thông điệp chỉ đúng cách sửa |
| lane DB đã đóng dấu (`lane-db-setup.sh fence`) | 459 test xanh / 471 (12 skip có sẵn) |
| `test/db-target.unit-spec.ts` | **19/19** xanh (chạy trong `pnpm test`, không cần DB) |
| chunk-test toàn workspace, không DB | **XANH** mọi chunk (762 file) · typecheck + lint xanh |
| purge (sau dry-run ROLLBACK pass) | 56.269 dòng theo `company_id` + 74 company + 13 mồ côi (2 vòng) |
| toàn vẹn FK sau purge | **0** tham chiếu treo trên toàn schema (baseline trước = 0) |
| PROD sau | 1 company · **0** tenant test · **0** user test active · **0** grant `platform-admin` |
| `funtime` | **46 user (35 active + 11 locked)** — 0 dòng bị chạm |
| `check-prod-test-tenants.mjs` | trước purge exit **1** · sau purge exit **0** |
| PROD API sau purge | `/health` 200 · `/health/db` 200 `{"ok":true}` |

**Backup:** `/c/tmp/mediaos-pre-purge-20260728.dump` (`pg_dump -Fc`, 6.1 MB).

> **Lưu ý bàn giao:** sau purge PROD **không còn tài khoản `platform-admin` nào** (cả 5 đều là tài
> khoản test mật khẩu `Passw0rd!test99`). Cần phiên operator thì phải tạo có chủ đích, không khôi phục
> từ dump.

## 8b. FULL gate (2026-07-28) — cả hai PASS, và cả hai tìm ra lỗ thật

Hai reviewer chạy **probe thật**, không đọc suông. Điểm đáng giá nhất: gate tìm lỗ **trong chính hàng
rào**, và một lỗ trong **tuyên bố "đã sạch"** của tôi.

### `security-reviewer` → PASS (có điều kiện) — đã bịt trong PR này

| # | Lỗ | Vì sao nguy |
| --- | --- | --- |
| F-1 | Có URL tường minh mà thiếu `LANE_DB` ⇒ 2 URL còn lại dựng với tên DB RỖNG (`…:5432/`). libpq resolve database về **tên role** = `mediaos` = PROD và nối **thành công**; `parseDbName()` trả `null` nên denylist bỏ qua. **L1 mù, chỉ L2 cứu.** | Vá: không tổng hợp URL khi thiếu lane; URL khác rỗng mà không parse được tên DB ⇒ **chặn** (fail-closed). |
| F-2 | L2 **fail-OPEN** khi không nối được DB (`console.warn` rồi `return`) — comment ghi "KHÔNG nuốt lỗi im lặng" trong khi hành vi ngược lại. Ghép với `CI=1` là đường lách trọn. | Vá: THROW mặc định; muốn bỏ qua phải `TEST_DB_FENCE_ALLOW_UNREACHABLE=1`. |
| F-3 | `lane-db-setup.sh dev` ⇒ **đóng dấu lên `mediaos_dev` (dev-online)** — vĩnh viễn và vô hình, L2 mất hiệu lực cho DB đó mãi mãi; `--reset` còn **DROP** nó. Script này giờ là *người đóng dấu* nên chốt là bắt buộc. | Vá: từ chối `mediaos`/`mediaos_dev`. Verify: exit 1, cả hai DB vẫn `(không dấu)`. |
| F-4 | `CI` **bất kỳ giá trị nào** (kể cả `CI=0`, `CI=false`) đều bỏ qua denylist; `TEST_DB_DENYLIST` **thay thế** danh sách ⇒ `TEST_DB_DENYLIST=mediaos_dev` âm thầm gỡ bảo vệ cho chính PROD. | Vá: `CI` chỉ nhận `true`/`1`; denylist **hợp nhất**, không thay thế. |
| F-5 | L3 chấm **bất kỳ DB nào** `DATABASE_DIRECT_URL` trỏ tới (biến shell thắng `.env.prod`) ⇒ trong shell lane thì `check.sh --all` cho **XANH GIẢ** trong khi PROD bẩn. | Vá: từ chối phán quyết khi `current_database()` không thuộc {`mediaos`,`mediaos_dev`} — BỎ QUA có cảnh báo. |
| F-7 | Thông điệp L2 in sẵn `COMMENT ON DATABASE mediaos IS '…'` — tức đưa lệnh copy-paste để **tự tay tháo lớp chốt cuối khỏi PROD**. | Vá: DB được bảo vệ ⇒ không in lệnh đóng dấu, chỉ in đường đi đúng. |

F-6 (header script purge nói chưa đủ về `session_replication_role = replica` — nó tắt **cả 17 trigger
user**, không riêng FK) và F-8 (`VALKEY_URL=` rỗng nay rơi về adapter in-memory thay vì chặn boot):
đã sửa header; phần còn lại ghi thành việc theo dõi.

### `rls-tenant-isolation-tester` → PASS — nhưng bác một tuyên bố của tôi

- **RLS nguyên vẹn** sau khi chạy `session_replication_role = replica`: diff `--schema-only` giữa dump
  TRƯỚC và live SAU = **không một khác biệt nào**. 155 ENABLE · 155 FORCE · 172 POLICY · **17/17
  trigger `tgenabled='O'`** (đủ 8 `enforce_company_id_immutable`, `trg_audit_logs_block_mutation` BẬT)
  · 464 GRANT. `session_replication_role` hiện = `origin`.
- **funtime không bị chạm**: 46/46 user ID **trùng byte-for-byte với dump**; số dòng giống hệt ở MỌI
  bảng (delta duy nhất `system_job_runs` +18 do scheduler chạy sau khi dump).
- **Dòng toàn cục 402 → 402** (`login_logs` 268 · `notification_events` 59 · `notification_templates`
  45 · `dashboard_widgets` 17 · `roles` hệ thống 13) — không mất dòng catalog nào.
- **0 tham chiếu treo / 635 FK** — mạnh hơn bằng chứng của chính script, vốn chỉ quét FK **đơn cột**
  (`array_length(conkey,1)=1`) nên bỏ sót FK composite duy nhất `tasks_parent_same_company_fk`.
- ⚠️ **BÁC BỎ "PROD đã sạch 100%":** còn **20 dòng của tenant đã xoá** trong **2 materialized view**
  (`mv_dashboard_output` 11 · `mv_dashboard_task_status` 9). Postgres **không hỗ trợ RLS trên
  matview**, purge không `DELETE` được trên matview, và **2 trong 7 `company_id` ma không có cả trong
  dump 28/7** ⇒ tồn dư từ đợt dọn 27/7: **chưa đợt nào từng chạm matview**. Chốt L3 bản đầu **mù** với
  nó — đúng cái bẫy WO này sinh ra để tránh.
  **Đã xử lý:** `REFRESH MATERIALIZED VIEW` bằng role OWNER ⇒ 13→2 và 13→4, **0 dòng ma**; và L3 nay
  đếm dòng ma trong cả 2 matview, ≠0 ⇒ ĐỎ kèm lệnh sửa.

### Bằng chứng chạy lại SAU khi vá gate

| Kiểm | Kết quả |
| --- | --- |
| `db-target.unit-spec.ts` (thêm ca F-1/F-4) | **28/28** |
| `lane-db-setup.sh dev` | exit **1**, `mediaos`/`mediaos_dev` vẫn `(không dấu)` |
| L2 trên DB chưa đóng dấu | exit **1** |
| chunk-test KHÔNG có DB | **XANH** (762 file) |
| chunk-test trên lane ĐÃ đóng dấu | **XANH** (762 file) |
| typecheck · lint | xanh |
| `check-prod-test-tenants.mjs` | `{"ok":true, company_test:0, mv_dong_ma:0}` |

## 9. Thứ tự thi công

1. Plan này + cập nhật `paths` WO. 2. L1 + unit spec + glob. 3. L2 globalSetup. 4. Đóng dấu ở
`lane-db-setup.sh` + CI. 5. RED-proof cả hai chiều. 6. L3 chốt hồi quy. 7. **Người chốt** → backup →
purge → đo lại. 8. Đóng KI-028 kèm số + chấm lại RELEASE-01. 9. FULL gate.
