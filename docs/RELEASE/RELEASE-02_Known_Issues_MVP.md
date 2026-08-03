# RELEASE-02 — KNOWN ISSUES & DEFER LIST (MVP)

> Sổ vấn đề đã biết tại thời điểm chốt cổng Sprint 5 → Sprint 6. Sinh trong `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **0529**.
> Cập nhật: `S6-STAB-1` (KI-021…023) · **`S6-QA-FINAL-1` (KI-024…026)** — `master` `c845a777`.
> Thang mức: `QA-08 §9` (S0 Blocker · S1 Critical · S2 Major · S3 Minor · S4 Trivial).
>
> **Quy tắc của sổ này:** chỉ ghi vấn đề đã **kiểm chứng** (có lệnh/truy vấn/số đo/file:dòng). Không
> ghi nghi ngờ. Mỗi mục có **workaround** và **chủ** — không có mục nào "để đó xem sao".

---

## 1. Bảng tổng hợp

| ID | Vấn đề | Mức | Loại | Chặn UAT | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- | --- |
| ~~KI-001~~ | ~~Tài khoản `uat.*` chưa gắn hồ sơ nhân viên~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| ~~KI-002~~ | ~~Chưa có số dư phép trong công ty `demo`~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| KI-003 | Loại nghỉ phép có 3 bản trùng chữ thường | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-004 | Chưa nhập ngày lễ | S3 | Dữ liệu | ❌ | ⚠️ | Owner/HR |
| KI-005 | Widget "Thông báo" trên dashboard trễ tối đa ~10s | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-006 | LMS→NOTI chưa hoạt động — **migration `0529` ĐÃ áp cho cả PROD+UAT 2026-07-26**; còn thiếu `LMS_NOTI_TOKEN` + deploy | S2→S3 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-007 | CI `Security / Dependency scan` đỏ do lỗi công cụ | S3 | CI | ❌ | ⚠️ | Owner/DevOps |
| ~~KI-008~~ | **ĐÓNG 2026-07-29** — `S6-PERF-DB-1` (#307). Drill KHÔNG chạy được kể từ khi Postgres vào container (thiếu pg client trên PATH host); đã vá bằng fallback `DRILL_PSQL`/`DRILL_PG_DUMP`/`DRILL_PG_RESTORE` qua `docker exec`, rồi chạy THẬT: dump → restore DB tạm → verify chuỗi migration + schema/RLS/index → tự dọn = **PASS** (`DEVOPS-13` §3.1). ⚠️ **KHÔNG kéo theo "đã có backup"** — drill tự `pg_dump` tại chỗ; chuyện chưa hề có bản backup định kỳ nào là **KI-050** riêng | S2 | Vận hành | — | — | ✔ xong |
| KI-009 | Log chưa có cấu trúc JSON | S3 | Quan sát | ❌ | ❌ | Sprint 6 |
| KI-010 | Endpoint cũ `GET /employees` chưa phân trang thật (mới chặn bằng cap 2000) | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| ~~KI-011~~ | **ĐÓNG 2026-07-30** — `S6-REL-1`. `scripts/ops-alert-check.mjs` đo THẬT 8 nhóm (backend down · DB readiness đọc BODY vì /health/db fail-soft · **lệch migration** · job Failed · dòng lỗi log · đĩa · tuổi backup · hạn TLS), quyết định ở `scripts/lib/ops-alert-rules.mjs` — **44 test**, và test ĐƯỢC CHẠY (step `tooling-tests` trong `harness/check.sh` + job trong `api.yml`; trước đó test của `scripts/`+`harness/` nằm ngoài vitest workspace nên mồ côi). Luật nền: **thiếu dữ liệu ⇒ `unknown`, KHÔNG phải `ok`** ⇒ exit ≠ 0 — chính luật này bắt ra KI-050 ngay lần chạy đầu. Rule KHÔNG đo được (5xx theo module · login-fail spike · 403 spike · slow query) ghi thẳng "KHÔNG ĐO ĐƯỢC" ở `RELEASE-09` §2, không tick khống. ⚠️ **cần deploy**: owner phải đăng ký scheduled task (`RELEASE-09` §4) thì cảnh báo mới tự chạy | S2 | Vận hành | — | ⚠️ cần đặt lịch | **ĐÓNG** — `S6-REL-1` |
| KI-012 | Accepted-risk **D3**: widget headcount count-only xuyên phòng ban cho HR scope Department | S3 | Bảo mật (đã chấp nhận) | ❌ | ⚠️ cần chữ ký | Owner |
| KI-013 | `refresh` / `resetPassword` không throttle (theo thiết kế, có mitigation) | S3 | Bảo mật (theo thiết kế) | ❌ | ❌ | — |
| ~~KI-014~~ | **ĐÃ ĐÓNG 2026-07-27** (`S6-QA-CHUNK-1`) — truy được gốc: **bug ngược dòng `tinypool@1.1.1`**, `ProcessWorker.send()` chỉ chặn `isTerminating` chứ không kiểm tra kênh IPC đã đóng. **Ba đính chính so với mô tả cũ:** (1) KHÔNG phải "máy bất ổn ngẫu nhiên" — `pnpm test` đỏ **5/5**, tái hiện 100%; (2) KHÔNG phải file/suite thủ phạm — package nạn nhân đổi mỗi lần chạy (kể cả `console` 23 file, `web-core` 39 file); (3) KHÔNG phải lệch Node 24-local vs 22-CI — **Node 22 vẫn crash**; CI xanh vì runner chỉ 2–4 nhân ⇒ 1–3 worker, còn máy này 32 nhân ⇒ 31 worker/package. Vá = `harness/chunk-test.mjs` (chia chunk + hạ trần worker + chạy lại **chỉ** chunk chết vì hạ tầng), `check.sh` dùng trên Windows, CI giữ đường một-lần. Verify: `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **XANH** (lint+typecheck+test+build), **761/761 file spec** đối chiếu `vitest list`. Số đo đầy đủ: `docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md` | S2 | Hạ tầng test (local) | — | — | ✔ xong |
| KI-015 | Nhiễu log `OutboxNotificationBridge … intake THẤT BẠI` khi chạy test | S3 | Vệ sinh test | ❌ | ❌ | Sprint 6 |
| ~~KI-016~~ | **ĐÓNG 2026-07-30** — `S6-REL-1`. Mỗi build nay đóng băng thành `apps/api/releases/<stamp>` (BẤT BIẾN), service trỏ junction `releases/current`; `m dev-online` biên dịch lại `dist` KHÔNG còn chạm được bản PROD đang chạy. Kèm theo là **đường rollback ứng dụng đầu tiên** của dự án (`m prod-rollback`) — trước đây `dist` bị ghi đè mỗi lần build nên không có bản trước để quay về. Vị trí thư mục là RÀNG BUỘC KỸ THUẬT: phải nằm TRONG `apps/api` để `node_modules` phân giải đi lên trúng `apps/api/node_modules` (pnpm isolated, KHÔNG hoist) — đã chứng minh bằng resolver thật + boot artifact trên DB lane, không bằng lý luận. ⚠️ **cần deploy**: `m prod-cutover` (Administrator) MỘT LẦN; `m prod-status` cảnh báo LOUD khi service còn trỏ `dist` | S2 | Hạ tầng | — | ⚠️ cần cutover | **ĐÓNG** — `S6-REL-1` |
| KI-017 | Refresh materialized view dashboard qua `workerDb` hỏng từ G14 ("must be owner") | S3 | Sản phẩm (ngủ) | ❌ | ⚠️ | Sprint 6 |
| KI-018 | Dữ liệu demo có trạng thái đơn nghỉ lẫn hoa/thường | S3 | Dữ liệu | ❌ | ❌ | Sprint 6 |
| KI-019 | Chỉ 1 ca làm việc + 1 quy tắc chấm công + 0 phân ca trong DB UAT | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-020 | Chưa có dữ liệu GOAL để nghiệm thu | S3 | Dữ liệu | ❌ | ❌ | Owner |
| KI-021 | 3 sự kiện NOTI của ATT bật trong danh mục nhưng **không có producer** (`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED`) | S2 | Sản phẩm | ❌ | ❌ | Sau MVP |
| ~~KI-022~~ | ~~`outboxOf` trong `goal-be2-link.int-spec` không lọc `company_id` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-023~~ | ~~Đua teardown `audit_logs → companies` trong `cleanupTenants` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-024~~ | ~~`foundation-audit.e2e-spec` dùng `action` cố định + đếm tuyệt đối ở System scope ⇒ đỏ-giả **vĩnh viễn** sau một lần chạy bị ngắt~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| KI-025 | **98/346 đường dẫn API (28%) không có test HTTP nào chạm** — phủ ở tầng service (`T-svc`) nên guard/DTO/envelope của route chưa từng chạy. Nặng nhất: `user-invites` (`/users/invite`, `/users/:id/approve`…) + `POST/GET /hr/profile-change-requests` | S2 | Độ phủ test | ❌ | ❌ | Sau MVP |
| ~~KI-026~~ | ~~Nhãn `[BLOCKED — service.ts bug]` + chú thích "KNOWN BROKEN" nằm trên một test ĐANG XANH (`attendance-adjustment.int.spec.ts`) — bug đã sửa cùng PR #81 nhưng chú thích không gỡ~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S3 | Vệ sinh test | — | — | ✔ xong |
| ~~**KI-027**~~ | **ĐÃ ĐÓNG 2026-07-28** — verify cả 3 lớp trên PROD: (1) `TWO_FACTOR_ENFORCEMENT_ENABLED=true` ở **cả** `.env` lẫn `.env.prod` (sửa 27/7 08:36) và service `MediaOS-API` boot lúc **28/7 08:49** ⇒ guard đọc cờ MỚI, ép đang SỐNG; (2) `roles.requires_two_factor=true` cho `company-admin` + `platform-admin`; (3) `admin@funtimemediacorp.com` **đã enroll TOTP** (`user_totp.enabled_at` khác NULL) ⇒ không có cửa sổ tự-khoá. ~~2FA KHÔNG được ép ở PROD cho `company-admin`~~ | **S1** | Bảo mật (cấu hình) | ✅ | ✅ | **ĐÓNG** |
| ~~**KI-028**~~ | **ĐÃ ĐÓNG 2026-07-28 — `S6-SEC-DBFENCE-1`: bịt NGUỒN RÒ trước, purge sau, cắm chốt hồi quy.** *Lần đóng 27/7 chỉ dọn rác nên rác mọc lại gấp 4,6 lần trong 2 ngày; lần này khác ở chỗ có hàng rào + chốt.* **Chẩn đoán lại — có HAI vector, không phải một** (truy nguyên 72/74 company về đúng spec sinh ra chúng qua tiền tố slug ↔ đối số `label` của `seedCompany`): **V1** spec chỉ gate `hasDb` chạy khi thiếu `LANE_DB` → 58 company; **V2** spec ĐÃ gate `LANE_DB` vẫn ghi vào `mediaos` (LANE_DB=mediaos, hoặc `DATABASE_URL` tường minh thắng precedence) → 14 company. ⇒ **sự có mặt của `LANE_DB` chưa bao giờ là thuộc tính an toàn — TÊN DB ĐÍCH mới là**; đó là lý do vá không nằm ở 56 file spec mà ở resolver. **Vector thứ 3 lộ ra khi vá:** `src/db/check.ts` gọi `main()` ở top-level và `check.spec.ts` import nó ⇒ **mỗi lần chạy unit test là một lần `migrate()` chạy trên DB PROD**, im lặng (nay chốt `require.main === module`). **Hàng rào 3 lớp:** L1 `test/db-target.ts` fail-closed (thiếu LANE_DB ⇒ 3 URL RỖNG ⇒ int-spec SKIP, hết fallback `"mediaos"`; đích ∈ {`mediaos`,`mediaos_dev`} ngoài CI ⇒ THROW) · L2 `test/global-setup.ts` đòi **con dấu `COMMENT ON DATABASE = 'mediaos-test-lane'`** nằm TRONG database — không giả được bằng env, phủ cả 266 file spec ở MỘT chỗ · L3 `scripts/check-prod-test-tenants.mjs` (nối vào `check.sh --all`) đếm tenant test trong PROD, ≠0 ⇒ ĐỎ. **Bằng chứng:** chạy TRỌN suite 449 file api không `LANE_DB` ⇒ **0 company mới** (75→75, trước đây sinh hàng chục) · lane DB chưa đóng dấu ⇒ từ chối chạy, đóng dấu ⇒ 459 test xanh · 19 unit RED-proof cho L1. **Purge (owner duyệt, có dump `mediaos-pre-purge-20260728.dump`):** dry-run ROLLBACK trên chính PROD pass trước, rồi chạy thật — **56.269 dòng theo `company_id` + 74 company + 13 mồ côi (quét tới điểm bất động)**; chốt trước/sau + **quét toàn vẹn FK toàn schema = 0 tham chiếu treo**. **SAU:** company khớp mẫu test **0** · user test active **0** · **0** grant `platform-admin` còn lại · token sống của tenant test **0** · `funtime` **46 user (35 active + 11 locked), 0 dòng bị chạm** (46/46 user ID trùng **byte-for-byte** với dump) · dòng toàn cục **402 → 402** · **0** tham chiếu treo/635 FK · `check-prod-test-tenants.mjs` exit **0**. **FULL gate 2× PASS và cả hai tìm ra lỗ thật:** `security-reviewer` bịt 6 lỗ **trong chính hàng rào** (đáng kể nhất **F-1**: có URL tường minh mà thiếu `LANE_DB` ⇒ URL dựng với tên DB rỗng `…:5432/`, libpq resolve về **tên role** = `mediaos` = PROD và nối THÀNH CÔNG trong khi denylist mù; **F-3**: `lane-db-setup.sh dev` sẽ đóng dấu vĩnh viễn lên `mediaos_dev` = tháo lớp chốt cuối; **F-2**: L2 fail-OPEN khi không nối được DB) — tất cả đã vá + có test. `rls-tenant-isolation-tester` xác nhận RLS nguyên vẹn (diff `--schema-only` trước/sau = **rỗng**; 155 ENABLE · 155 FORCE · 172 POLICY · 17/17 trigger BẬT) nhưng **bác tuyên bố "PROD sạch 100%"**: còn **20 dòng tenant đã xoá trong 2 matview** (`mv_dashboard_output` 11 · `mv_dashboard_task_status` 9) — Postgres **không hỗ trợ RLS trên matview** và purge không `DELETE` được trên đó; **2/7 `company_id` ma không có cả trong dump 28/7 ⇒ tồn dư từ đợt dọn 27/7, chưa đợt nào từng chạm matview**. Đã `REFRESH MATERIALIZED VIEW` (role OWNER) ⇒ **0 dòng ma**, và L3 nay đếm luôn vế này (xem KI-041). ~~**MỞ LẠI 2026-07-28 — containment 27/7 chỉ phủ 16/74 tenant.**~~ Đo lại trên PROD `mediaos`: **74/75 company khớp mẫu tenant test, 0 soft-delete** (16 tạo 24/7 = đúng tập đã xử lý; **58 tạo 26/7 chưa ai chạm**); **226 user `active`**, trong đó **55 có hash argon2/bcrypt THẬT (đăng nhập được)** và **33 giữ role TOÀN CỤC** — giao của hai tập: **13 `company-admin` + 5 `platform-admin` vừa đăng nhập được vừa có role toàn cục**. Hai số verify của lần đóng ("user test còn active = 0", "operator-grant ngoài funtime = 0") **nay đều sai**. Nguồn rò CHƯA bịt: `apps/api/vitest.config.ts:11` lấy `LANE_DB ?? "mediaos"` ⇒ spec chỉ gate `hasDb` (vd `tenant-isolation.int-spec`) ghi thẳng vào DB PROD; run crash (KI-014) bỏ `afterAll` cleanup. **Giảm nhẹ:** email mang hậu tố ngẫu nhiên mỗi lần chạy (không có trong repo) nên không đoán được từ bên ngoài; funtime nguyên vẹn (46 user: 35 active + 11 locked), không có dấu hiệu chạm chéo tenant. ~~ĐÃ ĐÓNG 2026-07-27 (owner chạy `scripts/s6sec1-contain-test-tenants.sql`)~~ — mật khẩu `Passw0rd!test99` có trong 86 file của repo PUBLIC (đã verify argon2 trên hash PROD) | **S1** | Bảo mật | ✅ | ✅ | **ĐÓNG 2026-07-28** — `S6-SEC-DBFENCE-1` |
| ~~**KI-032**~~ | ~~**Tenant admin XOÁ được `role_permissions` của role hệ thống TOÀN CỤC**~~ — **ĐÃ ĐÓNG 2026-07-27** (mig `0530` RESTRICTIVE FOR DELETE + gỡ `DELETE ON roles` + guard `isSystem` ở 2 hàm; RED→GREEN 6/6). **`0530` ĐÃ áp cho PROD** — verify: policy `role_permissions_no_delete_system` cmd=`d` permissive=`f`, grant app trên `roles` = `INSERT,SELECT,UPDATE` (hết `DELETE`). — RLS `USING` cho `company_id IS NULL` mà **DELETE không xét `WITH CHECK`**; service thiếu guard `isSystem`. Ghi chéo tenant, **INSERT khôi phục bị chặn ⇒ không hoàn tác qua app**. PROD: 785 grant toàn cục, `funtime` dùng 2 role toàn cục | **S0** | Bảo mật | ✅ | ✅ | **Owner — GẤP** |
| ~~KI-033~~ | **ĐÃ VÁ 2026-07-27** — thêm audit in-tx cho **CẢ HAI** endpoint report. *Đính chính phạm vi so với bản gate:* không phải "leave lạc đàn giữa hai sibling cùng cổng" — `attendance-report` cũng không audit, và nó gate bằng `view-company:attendance` chứ **không** phải `export`. Đúng là: 2 bản CSV có audit, 2 bản report JSON thì không | S1 | Bảo mật (audit) | — | — | ✔ xong |
| ~~KI-034~~ | **ĐÓNG 2026-07-28** — `S6-SEC-NOTITX-1`. `NotificationsService.create` nay mở **MỘT** `withTenant` bọc cả insert + `outbox.enqueue` + `audit.record` (`repo.create`/`repo.markRead` nhận `tx?`); **gỡ cả hai `.catch` nuốt lỗi**, WS emit chỉ chạy SAU commit. `markRead` **gộp luôn** (không giữ best-effort) — lý do đầy đủ ở `docs/plans/S6-SEC-NOTITX-1.md` §5. Nhánh nuốt lỗi **thứ ba** phát hiện khi thi công: `insert` trả 0 hàng từng `logger.error` rồi trả `null`, trộn lẫn với `null` hợp lệ của "bị preference lọc" ⇒ nay **ném**; `null` chỉ còn MỘT nghĩa. **⚠️ Đính chính tiền đề của KI gốc:** mô tả "đường nóng mọi module gọi" **đã SAI từ S4** — đo lại: `NotificationsService.create` có **0 caller production**; `OutboxNotificationBridge` đi `NotificationEngineService.intake()`, vốn **đã atomic sẵn** (một `withTenant`, lỗi non-dedupe `throw`, không `.catch`). Bán kính runtime của vá này = **0**; giá trị = bịt API công khai mà module khác có thể wire vào ngày mai. **RED-first**: 7 ca ĐỎ trên code cũ (outbox ném · audit ném · không-emit-khi-hỏng · cùng-một-tx · insert-0-hàng · markRead ×2), 2 ca hồi quy xanh cả hai phía ⇒ không phải "đỏ vì mọi thứ đều đỏ". **Hồi quy**: `src/notifications/**` 85/85 · `src/events`+`src/realtime` 62/62 · suite **449/449 file chạy** dưới `LANE_DB` — ⚠️ chỉ chạy được bằng **đường vòng tay** của KI-045 (3 URL tường minh), KHÔNG bằng `harness/check.sh --all`; mỗi lần chạy còn 1 đỏ TRÔI (khác test mỗi lần) nhưng **baseline `master` cho kết quả y hệt** ⇒ flake sẵn có, không do WO này. **FULL gate**: `security-reviewer` PASS 0-CRIT/0-HIGH (tự kiểm chứng độc lập 0-caller + RLS `0010:33-35` + `object_type='notification'` có trong CHECK union `0090_g12:49`); 2 MEDIUM về docstring đã vá trong cùng PR | S1 | Bảo mật (audit) | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-NOTITX-1` |
| ~~KI-035~~ | **ĐÃ VÁ 2026-07-27** + **HẠ MỨC S1 → S3**. *Hai claim của gate đều SAI, đã tự kiểm chứng:* (1) nhánh `if (!db) return;` chỉ chạy cho login **THẤT BẠI pre-auth** (`companyId: null` ở `:202`/`:222`) — hai đường login **thành công** (`:375`/`:507`) đều truyền `companyId` thật nên đi nhánh `withTenant`, KHÔNG có chuyện "cấp token mà không có log"; (2) `emitAccountLocked` **có** log ERROR đầy đủ trong catch (chú thích tại chỗ ghi rõ "KHÔNG nuốt câm"). Lỗi thật còn lại: chỗ bỏ ghi đó **im lặng tuyệt đối** ⇒ đã thêm `logger.warn` | S3 | Bảo mật (quan sát) | — | — | ✔ xong |
| ~~KI-036~~ | ~~`.env.example:91` ship `TWO_FACTOR_ENFORCEMENT_ENABLED=false`~~ — **ĐÃ VÁ 2026-07-27** (đổi thành `true` + cảnh báo thứ tự thao tác) — `cp .env.example .env` là bước cài chuẩn ⇒ **gốc rễ tái diễn** của KI-027 ở mọi deploy mới | S2 | Bảo mật (cấu hình) | ❌ | ⚠️ | WO mới |
| ~~KI-038~~ | **ĐÃ ĐÓNG 2026-07-27** — mig `0531` **đã áp cho PROD** (verify: 2 trigger `enforce_company_id_immutable` trên `notification_%`, `tgenabled='O'`; 199 migration applied) — **cùng họ lỗi với KI-032, trên hai bảng khác**: `notification_events` (59 hàng toàn cục PROD) + `notification_templates` (45) cho phép một tenant `UPDATE … SET company_id=<mình> WHERE company_id IS NULL` ⇒ **cướp trọn danh mục NOTI dùng chung**, commit được, **không hoàn tác qua app**; mọi tenant khác mất catalog ⇒ không tạo nổi thông báo. Hai reviewer độc lập cùng tìm ra ở vòng re-gate. Vá = gắn trigger `enforce_company_id_immutable` (mig 0436) | **S0** | Bảo mật | — | — | ✔ xong |
| ~~KI-039~~ | **ĐÃ VÁ 2026-07-27** — `rls-coverage-assert` assert (b) chỉ kiểm **chuỗi** (`WITH CHECK` có nhắc GUC là xanh) nên **mù** với lớp lỗi KI-038. Thêm **assert (c)**: bảng vừa có khe hở `IS NULL` trong `USING` vừa cho app role `UPDATE` thì bắt buộc phải có trigger bất biến. Đã chứng minh đỏ khi gỡ trigger | S2 | Độ phủ test | — | — | ✔ xong |
| ~~KI-040~~ | **ĐÃ VÁ 2026-07-27** — assertion cô lập tenant mà **chính WO này viết** khi vá KI-033 **không thể đỏ được** (`filter(includes("tenant A"))` không khớp fixture nào); reviewer chứng minh spec vẫn 11/11 xanh giữa một vụ rò audit chéo tenant thật. Đã khôi phục đếm tuyệt đối + nghiệm thu bằng cách gieo policy rò (4 case đỏ) | S1 | Độ phủ test | — | — | ✔ xong |
| ~~**KI-041**~~ | **ĐÃ ĐÓNG 2026-07-29 — `S6-SEC-MV-1` (mig 0534): ranh giới chuyển từ kỷ luật service xuống TẦNG DB.** Matview `mv_dashboard_output`/`mv_dashboard_task_status` mang `company_id` nhưng **Postgres không hỗ trợ RLS trên matview** ⇒ nằm ngoài phép đo 153/153. **Vế RED đo được (lane, 2026-07-29):** role `mediaos_app` chạy `SELECT count(*), count(DISTINCT company_id) FROM mv_dashboard_task_status` KHÔNG mệnh đề lọc ⇒ **56 hàng / 38 tenant** — ranh giới duy nhất là `WHERE company_id = $1` viết tay trong service. **Cách vá (owner chốt "wrapper view + REVOKE"):** REVOKE SELECT trên CẢ HAI matview khỏi `mediaos_app`+`mediaos_worker`; app đọc qua view `security_barrier` `v_dashboard_task_status`/`v_dashboard_output` tự lọc `current_setting('app.current_company_id')` (biến `withTenant()` set), fail-closed 0 hàng ngoài ngữ cảnh. Vế `WHERE company_id` trong service GIỮ NGUYÊN làm đai thứ hai. **KHÔNG DROP `mv_dashboard_output`** dù là họ media-era park: CLAUDE.md §1 chốt "không xóa ở đợt này" và `docs/DB/` không có dòng nào xác nhận park ⇒ điều kiện DROP không thoả. *Đính chính tiền đề WO: nó KHÔNG "0 consumer" — `GET /dashboard/mv-stats` (gate `read:dashboard`) trả CẢ hai nửa; chỉ chưa màn hình nào gọi.* **Đường refresh CHẾT từ G14 cũng đã sửa cùng WO (done_when #5):** đo lại — `mediaos_worker` → REFRESH ⇒ `permission denied`, `mediaos` (owner) → OK và làm **56→54 hàng / 38→37 tenant** ⇒ dữ liệu đã cũ THẬT. Vá bằng hàm `refresh_dashboard_mvs()` **SECURITY DEFINER** owner=`mediaos` (CÓ BYPASSRLS), worker chỉ EXECUTE, `search_path` chốt cứng; **cấm** `ALTER … OWNER TO mediaos_worker` (thiếu BYPASSRLS ⇒ MV **rỗng lặng lẽ**). **Bằng chứng:** 13 ca `dashboard-mv-tenant-barrier.int-spec.ts` xanh; **RED-proof chạy thật** — khôi phục grant cũ trên lane ⇒ đúng 3 ca đỏ, REVOKE lại ⇒ xanh; ca "MV không bị làm rỗng sau refresh" khoá đúng cái bẫy đổi-owner | **S2** | Bảo mật | ✅ | ✅ | **ĐÓNG 2026-07-29** — `S6-SEC-MV-1` |
| ~~KI-042~~ | **ĐÓNG 2026-07-28** — `S6-SEC-LOGINLOG-1`, migration `0532`. Vế `USING` của policy `tenant_isolation` bỏ `OR company_id IS NULL`; `WITH CHECK` giữ **nguyên văn** 0443 và grant append-only (`mediaos_app: SELECT,INSERT` · `mediaos_worker: SELECT`) giữ nguyên. **Lỗ nặng hơn mô tả gốc**: không chỉ đọc chéo khi đứng trong tenant — **NGOÀI mọi ngữ cảnh tenant** app role vẫn đọc được toàn bộ hàng NULL, vì `OR company_id IS NULL` đúng vô điều kiện. **Đo PROD (read-only)**: 314 hàng = 46 attributed + **268 NULL-tenant** (165 `blocked/TooManyAttempts` + 103 `failed/CompanyInactive`), phơi 5 email + 5 IP; N=1 company nên **ảnh hưởng sống = 0**, sửa trước khi mở tenant thứ hai. **Mô hình đọc đã chốt** (docs/DB-02 §7.8): hàng NULL = telemetry pre-auth VÔ CHỦ, không tenant nào đọc được qua đường ứng dụng, chỉ superuser đọc trực tiếp cho forensics; **không xoá dữ liệu** (268 hàng còn nguyên). **Gốc rễ = lỗi chép khuôn** từ `public_holidays` (0434) — ở đó hàng NULL là ngày lễ toàn quốc dùng chung có chủ đích, ở `login_logs` là dấu vết bảo mật người lạ. **Ba lớp test đang ĐÓNG ĐINH lỗ hổng đã bị đảo**: `login-logs-rls (d)` từng assert `toContain("preauth@…")`; `rls-registry` để `skipNoContext: true` (che đúng lỗ này khỏi lưới an toàn cả dự án **suốt từ S2** — nay `login_logs > ngoài ngữ cảnh → 0 row` CHẠY THẬT lần đầu). ⚠️ FULL gate bắt được rằng **bỏ miễn trừ THÔI là xanh vô nghĩa**: `seedRow` chỉ gieo hàng attributed, mà dưới policy CŨ đọc không-GUC chỉ trả về hàng NULL ⇒ 0 row ở cả hai phía, không bao giờ ĐỎ (đã đo: `count = 0`). Đã vá bằng cách gieo thêm hàng `company_id IS NULL` (marker) + dọn trong `cleanupTenants`; chứng minh lại: hoàn nguyên policy ⇒ `tenant-isolation` **1 failed/453 passed**, đỏ đúng ca đó; `me-security-activity` từng assert row `company NULL + user A` **phải hiện** — hình dạng row **không thể sinh ra từ code**. **Bẫy đã đo & ghim 3 lớp**: Postgres áp policy SELECT lên `RETURNING`, nên `INSERT … (NULL,…) RETURNING` bị từ chối trong khi INSERT thường vẫn chạy; đường ghi thật không dùng `.returning()` — thêm vào sẽ **giết log pre-auth trong im lặng** (lỗi bị nuốt vào nhánh best-effort). **RED-first**: hoàn nguyên policy về bản 0443 ⇒ đúng 3 ca deny mới ĐỎ, 5 ca cũ xanh cả hai phía (không nới vế ghi). **Hồi quy**: 8/8 + 10/10 + 6/6 + 16/16 + 6/6 + 5/5, `tenant-isolation` **454 passed/11 skipped**, chain `0000→0532` áp sạch trên DB lane **dựng mới** (200 migration) | S3 | Bảo mật | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-LOGINLOG-1` |
| ~~KI-044~~ | **ĐÓNG 2026-07-29** — `S6-SEC-LOGINLOG-2`. **KHÔNG có migration** (thuần code; head vẫn `0533`) và **KHÔNG nới lại vế `USING`** của `tenant_isolation` — vá đúng chỗ gốc: nhánh 429 nay resolve chủ **BÊN TRONG** thân nhánh rồi mới ghi, nên hàng `blocked/TooManyAttempts` với slug HỢP LỆ mang `company_id` THẬT. **Không đảo thứ tự đường login** ⇒ request KHÔNG bị chặn không tốn thêm một lượt tra DB nào (đây là biến thể của `done_when #1`, **ngược** với nguyên văn "chỉ resolve khi đã qua chặn thô" — chọn có chủ đích vì rẻ hơn; xem plan §2.2). Hàng `CompanyInactive`/slug sai **vẫn NULL** (đó mới là hàng thực sự vô chủ). **⚠️ BẢN VÁ TỰ ĐẺ RA MỘT ORACLE — đã bịt cùng lúc, và nó là THẬT chứ không phải lo hão:** sau vá, slug hợp lệ đi `withTenant` (BEGIN + set_config + INSERT + COMMIT = 4 round-trip) còn slug sai đi `db.insert` trần (1 round-trip), mà nhánh 429 **không** có `password.hash` burn để che. Đo N=200/nhánh khi TẮT sàn: hai phân phối **rời nhau hoàn toàn** (hợp lệ p50 **4.5ms** > sai p95 **3.7ms**; mean 4.6±0.0 vs 3.2±0.0, **Δ+1.4ms**) ⇒ ship trần là tặng kèm oracle "slug tenant có tồn tại" phân loại được ~100%. Vá bằng **sàn thời gian đồng nhất** cho cả nhánh (`BLOCKED_LOGIN_FLOOR_MS=250` + jitter, đặt trong `finally`, chạy SAU commit nên không giữ slot pool) — đo lại khi BẬT: 295.2±3.3 vs 299.4±3.2, **Δmean đổi dấu thành −4.2ms** (ngược chiều tín hiệu thật ⇒ nhiễu), `max` **trước** sàn = 6.5ms « 250ms nên sàn chưa từng bị xuyên thủng. Phát hiện bởi `plan-reviewer` **trước khi viết code** (v1 của plan bị BLOCK). **Một cache slug→id đã được đề xuất rồi BỎ:** nó khử đúng 1 index-probe nhưng mở lỗ ghi-chéo-tenant thật — `companies_slug_active_uq` (`0002:19`) cho **tái dùng slug sau soft-delete**, nên một mục dương-cũ sẽ ghi email/IP của người dùng tenant B dưới `company_id` của A, FK vẫn pass, im lặng. **⚠️ RANH GIỚI — đừng đọc là "tầm nhìn đã trở lại" trống trơn:** admin lấy lại được **"bị nện brute-force không · từ IP/UA nào · lúc nào · bao nhiêu lần"**, **KHÔNG** lấy lại được **tài khoản nào đang bị nhắm** — `userRef()` (`auth-logs-viewer.service.ts:88-95`) trả `null` khi thiếu `user_id`, và `LoginLogListItem` không có field `email` (§17 DTO tối giản). Đưa `email` lên DTO là quyết định lộ dữ liệu riêng, KHÔNG gộp vào WO này. *(Chỉ đúng cho `TooManyAttempts`: hàng `blocked/Inactive` — nhánh `result.kind === "blocked"` trong `login()` — **có** `user_id`, ghim bởi `auth-blocked-status.int-spec`.)* **Hệ quả chấp nhận có ghi nhận:** `login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ không bao giờ bị retention xoá, nên tenant bị nện sẽ **tích luỹ vô hạn** hàng hiển thị + `total`/paging của AUTH-API-401 tăng theo — đó chính là tầm nhìn đang đòi lại, nhưng là thay đổi khối lượng dữ liệu admin sẽ thấy đầu tiên. **Fail-soft KHÔNG câm:** resolve lỗi → `logger.warn` rồi ghi vô chủ, 429 **không** biến thành 500. **RED-first**: R1/R2/R6 ĐỎ trước vá (`expected null to be 'd45e456c-…'` · `expected undefined to be defined` · `expected "spy" to be called`), R3/R4/R5 xanh **cả hai phía** (chốt không-hồi-quy, không phải chốt vá). **Hồi quy**: 13 file · **118 test · 0 đỏ** trên DB lane dựng mới chain `0000→0533` (gồm `login-logs-rls` 8/8 · `auth-logs-viewer` 16/16 · `me-security-activity` 10/10 · `auth-blocked-status` 5/5 · `forgot-password-rate-limit` xanh ⇒ tổng quát hoá `applyUniformResponseFloor` bằng tham số CÓ MẶC ĐỊNH không đổi hành vi forgot). Sửa kèm 2 docstring đã thành sai (`recordLoginAttempt`, `me-security-activity.repository`). Đường lui: `git revert` 1 commit, không bước DB. **⚠️ HAI GIỚI HẠN CÒN LẠI, ghi để không ai đọc nhầm là đã kín:** (1) **sàn có điều kiện thủng, và điều kiện đó kẻ tấn công TẠO RA ĐƯỢC** — cơ chế là *lượng tử hoá* (`remaining = target - elapsed`), nên khi `elapsed > 250ms` thì không ngủ nữa và chênh lệch hình dạng lộ lại; nhánh 429 nay giữ một transaction 4 round-trip trong khi pool là `max: 20` (`db/index.ts:18`) và **repo không có throttler tầng HTTP nào**, nên một đợt bắn song song có thể đẩy `elapsed` vượt sàn bằng xếp hàng pool. Đo của WO này (`max` trước sàn 6.5ms) là đo **tuần tự trên DB rảnh** — đừng đọc nó thành "không bao giờ thủng". (2) sàn là **GIẢM THIỂU**, không phải constant-time. **FULL gate 2 reviewer, cả hai tự chạy lại RED-proof độc lập** và cùng chỉ ra rằng chốt chống-oracle KHÔNG có test — đã vá trong cùng PR: R1 (nhánh đắt) + R4 (nhánh rẻ) nay assert `elapsed ≥ 225ms` bằng **literal CỐ Ý** (import hằng số ⇒ hạ sàn về 0 vẫn xanh = tautology), RED-proof: gỡ `finally` ⇒ R1 đỏ ở **16ms**, R4 đỏ ở **3ms**. `rls-tenant-isolation-tester` **PASS** — verify trên DB SỐNG: policy `tenant_isolation` byte-for-byte 0532, `relrowsecurity/relforcerowsecurity = t/t`, grant `mediaos_app = SELECT,INSERT`, 201/201 migration khớp sha256; và chứng minh lưới có răng bằng **đột biến policy**: `USING true` ⇒ 8 ca đỏ (gồm R3), khôi phục đúng lỗ tiền-0532 ⇒ 6 ca đỏ. Ba ca yếu do gate chỉ ra đã siết: R3 thêm **đối chứng dương** (B đọc được hàng của CHÍNH B), R4/R7 thêm vế "không tenant nào đọc được", R5 tự sinh mẫu + assert denominator ≠ 0 (trước đó chạy cô lập là "1 passed" trên tập RỖNG) | S3 | Bảo mật (quan sát) | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-LOGINLOG-2` |
| ~~**KI-049**~~ | **ĐÓNG 2026-07-30 — `S6-SEC-ORGTEAMSCOPE-1` (N-1c).** Route trả HAI lớp dữ liệu nên có HAI chủ quyền: `read:team` giữ vế quan hệ thành viên, còn `userFullName`/`userEmail` nay bound theo **đúng cặp danh bạ `view:user`** mà `/org/employees` + `/auth/users` đã dùng. **CỐ Ý không** định nghĩa ngữ nghĩa `Own`/`Team`/`Department` thứ hai cho `teams` — làm vậy là đẻ hành vi thứ hai cho cùng lớp dữ liệu, đúng điều N-1 đã tránh. Ngoài scope ⇒ **BỎ HẲN KHOÁ**, không trả `null`: contract `teamMemberSchema.userEmail` là `z.string().email().optional()` **không** `.nullable()` ⇒ `null` sẽ vỡ Zod ở FE dù HTTP 200; khử ở tầng SQL (`case when`) nên quên bước xoá khoá cũng chỉ ra `null` (hỏng ỒN ÀO) chứ không rò email im lặng. **RED-proof** (lane `mediaos_teamscope`): trước vá 2 ca ĐỎ — `view:user@Own`+`read:team@Company` nhận danh tính **4/4 hàng** (đúng phải 1) và `read:team@Company` **không có `view:user` nào** cũng nhận **4/4** (đúng phải 0); sau vá **4/4 ca xanh**, gồm 2 ca đối chứng (`Company` vẫn thấy đủ 4 email — chống siết quá tay; thiếu `read:team` vẫn **403** — vá không nới route). Hồi quy: `org.service.spec` 31 · `org.permissions.spec` 56 · `org.permission.spec` 40 · `org-directory-scope` 7 · `org-directory-permission` 12 · `route-guard-coverage` 9 ⇒ **226 ca xanh**. Nhánh fail-closed có `logger.warn` (đo được trong log lần chạy) — không lặp lỗi F1 của gate N-1. **Phơi nhiễm trước khi vá = 0** (`teams`=0 trên PROD) nhưng cấu hình sai có sẵn trong SEED, và siết **không ai mất quyền** (3 role giữ `read:team` đều `@Company`). Gốc rễ chung **vẫn còn** — `PermissionGuard` không đọc `data_scope` ⇒ mở `S6-SEC-IDENTITY-PROJ-1` (`S3`, không chặn RC) buộc tầng chiếu `users.email`/`fullName` phải nhận vị từ scope, thiếu thì vỡ typecheck | **S2** | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ORGTEAMSCOPE-1` |
| **KI-048** | **Hàng `blocked` giờ HIỆN trong màn admin, và tốc độ sinh chúng do KẺ TẤN CÔNG điều khiển** — hệ quả phái sinh của `S6-SEC-LOGINLOG-2`, phát hiện bởi `security-reviewer` ở FULL gate. **Lượng ghi KHÔNG đổi** (những dòng đó vốn đã được ghi, chỉ là dưới `company_id NULL` nên không ai thấy) ⇒ **delta dung lượng = 0**; cái đổi là **khả năng thấy**. Một khi bucket `(slug,email,ip)` đã khoá, MỌI request kế tiếp trong `LOGIN_LOCKOUT_SEC` (900s) sinh một hàng **có chủ** với chi phí server gần bằng 0 (không argon2), trong khi trước đó muốn có hàng có-chủ thì phải qua rate-limiter, mỗi lần tốn một lượt băm. Cộng ba yếu tố: `login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ **không bao giờ được thu hồi**; `loginLogListQuerySchema` (`packages/contracts/src/auth.ts`) **không có filter `failure_reason`** ⇒ admin không lọc nhiễu ra được; `total`/paging của AUTH-API-401 phồng vô hạn. ⇒ Kẻ tấn công vô danh có thể **chôn tín hiệu thật dưới nhiễu ngay trong chính màn hình mà KI-044 vừa khôi phục**. Hướng vá đề xuất: gộp (coalesce) hàng `blocked` theo bucket theo cửa sổ khoá — vá luôn cả giới hạn "sàn thủng khi tải cao" ghi ở KI-044 | S3 | Bảo mật (quan sát) | ❌ | ❌ | WO mới (mở 2026-07-29) |
| **KI-047** | **Bốn đường 429 KHÁC không ghi một dòng `login_logs` nào** — phát hiện khi khoanh ranh giới KI-044. Trong `apps/api/src/auth/**` có 5 chỗ ném `TOO_MANY_REQUESTS` (tra bằng `grep -n TOO_MANY_REQUESTS`, **KHÔNG neo số dòng** — chúng trôi mỗi lần sửa file): trong `auth.service.ts` là nhánh rate-limit của `login()` (đường **DUY NHẤT** ghi `login_logs`), của `verifyTwoFactorLogin` (bước-2), của `disableTwoFactor`, của `changePassword`; cộng một chỗ trong `two-factor.service.ts`. Bốn chỗ sau **không** gọi `recordLoginAttempt`. Đáng kể nhất là **bước-2 2FA** (bucket rate-limit `rlKey` tiền tố `2fa`) — dò mã TOTP 6 số là brute-force thật, hiện chỉ có `securityAlerts.emit`, **không có dòng nào ở AUTH-API-401**, dù `claims.companyId` đang nằm sẵn trong tay (khác hẳn KI-044, ở đó lý do là chưa resolve kịp). ⇒ Sau khi KI-044 đóng, admin thấy được brute-force **mật khẩu** nhưng vẫn mù với brute-force **mã 2FA**. Cùng lớp "mất tầm nhìn của bên phòng thủ", KHÔNG phải rò rỉ | S3 | Bảo mật (quan sát) | ❌ | ❌ | WO mới (mở 2026-07-29) |
| ~~KI-037~~ | Bộ `tenant-isolation.int-spec` **chỉ SELECT** — không có một ca deny GHI chéo tenant nào. ⟲ số đúng: registry **155 bảng** (không phải 156); **465 ca** — con số KI ghi ban đầu là ĐÚNG (một bản sửa trung gian ghi 446, đã thu hồi). | S2 | Độ phủ test | ✅ | ✅ | **ĐÓNG 2026-07-29** — `S6-QA-TENANTWRITE-1`: lưới **465 → 1089 ca** (+4 ca ghi/bảng), `WITH CHECK` **đã chứng minh chạy trên 148/153 bảng** |
| **KI-050** | **Chưa từng có một bản backup nào trên máy PROD** — `scripts/ops-alert-check.mjs` trả `unknown` cho "tuổi bản backup" NGAY lần chạy đầu (2026-07-30): không có thư mục `backups/`, và `Get-ScheduledTask` không có task nào chạy `scripts/backup-db.sh`. **Phân biệt với KI-008 (đã đóng):** `S6-PERF-DB-1` chứng minh **restore drill** chạy được, nhưng drill đó tự `pg_dump` tại chỗ ⇒ nó KHÔNG chứng minh có **backup định kỳ**. Khôi phục được từ bản dump vừa tạo ≠ có bản dump để khôi phục khi máy hỏng. `RELEASE-01` §7.3 tick "Script backup ✅" — script CÓ tồn tại, nhưng **chưa từng chạy**; đúng bài học "script tồn tại ≠ script chạy được" (`DEVOPS-13` §3.1). **Workaround/vá:** chạy tay `bash scripts/backup-db.sh` trước go-live + đăng ký task hằng ngày 02:00 (`RELEASE-09` §4). ⟲ **CẬP NHẬT 2026-07-31 (`S6-GOLIVE-1`) — workaround đó KHÔNG CHẠY ĐƯỢC khi được ghi ra:** `scripts/backup-db.sh` chặn cứng ở `command -v pg_dump`, mà máy PROD-host (Windows, Postgres trong container) không có `pg_dump` trên PATH ⇒ `ERROR: pg_dump not found`, exit 1. Cùng LỚP lỗ đã vá cho `migrate-verify-ephemeral.sh` rồi `backup-restore-drill.sh` (`S6-PERF-DB-1`) — `backup-db.sh` lỡ cả hai đợt, tức một known-issue có workaround hỏng = **không có** workaround. Đã vá bằng fallback `docker exec` (`BACKUP_PG_DUMP`/`BACKUP_PG_CONTAINER`) + bỏ `--file` (qua `docker exec` nó ghi vào filesystem CỦA CONTAINER ⇒ báo DONE mà host rỗng) + chốt bằng **6 test** `node --test` trong `tooling-tests`. **ĐÃ CHẠY THẬT:** bản backup đầu tiên của hệ thống `mediaos-20260731-072306.dump` (3.861.533 byte, ~1s) · `backup-restore-drill.sh` **DRILL PASS** (restore + migration + RLS/FORCE + ledger + index + smoke) · ô "tuổi backup" của `ops-alert-check` chuyển `unknown` → **`ok`**. Cũng đã thêm `backups/` + `*.dump*` vào `.gitignore` — trước đó thư mục này KHÔNG bị ignore (repo PUBLIC, dump chứa PII 45 nhân viên). **CÒN LẠI (vì sao chưa đóng):** chưa có **lịch tự động** (cần Administrator — lệnh ở `RELEASE-09` §4 lại thiếu env, bản đã sửa ở `RELEASE-11` §6.2) · dump **chưa mã hoá** · **chưa đẩy offsite** ⇒ `RELEASE-14` `PGL-001` | **S2** | Vận hành | ❌ | **✅** | Owner/DevOps (mở 2026-07-30, `S6-REL-1`; giảm 2026-07-31, `S6-GOLIVE-1`) |
| **KI-056** | **4/6 tài khoản vai `SA` (super-admin, 379/379 quyền) KHÔNG có lớp bảo vệ thứ hai** — đo trên DB PROD 2026-07-31: `roles.requires_two_factor = false` cho `SA`, `users.require_two_factor = false`, và **0 bản ghi `user_totp`** cho 4/6 tài khoản. Vai `SA` đọc được hồ sơ nhân sự **chưa mask** của cả 45 nhân viên ⇒ 4 tài khoản mức đó hiện chỉ được bảo vệ bằng **mật khẩu**. Trớ trêu: `company-admin` (1 tài khoản, 329 quyền — **kém quyền hơn**) lại `requires_two_factor = true` và đã enroll. **Không phải bug — là cờ cấu hình chưa bật**, và ý định đã ghi sẵn trong code: `apps/api/src/config/env.schema.ts:188` — *"2FA: role này requires_two_factor=false (tiện dùng); bật ở prod nếu cần"*. Chưa ai bật ⇒ đúng khuôn *comment mô tả ý định, không mô tả trạng thái*. **Workaround/vá (rẻ):** 4 người enroll TOTP ở `/me/security/2fa` (hoặc Console `/settings/security`), **sau đó** mới bật cờ trên vai `SA`. ⚠️ **Bật cờ TRƯỚC khi enroll ⇒ 4 tài khoản đó lập tức 403 `TWO_FACTOR_SETUP_REQUIRED` ở MỌI route** (đúng thiết kế, nhưng nhìn hệt như "hệ thống sập toàn bộ"). ⚠️ Mục này đưa `S2` mở từ 3 lên **4 — VƯỢT ngưỡng chặn RC** của `RELEASE-05` §5.3 (≤3) ⇒ là một trong các cổng chặn cắt RC, và là cổng **rẻ nhất** để mở | **S2** | Bảo mật (cấu hình) | ❌ | **✅** | Owner (mở 2026-07-31, `S6-GOLIVE-1`) — `RELEASE-10` §4 · `RELEASE-14` `PGL-003` |
| ~~**KI-046**~~ | **ĐÃ ĐÓNG 2026-07-31 — `S6-SEC-XTENANTFK-1` (mig `0535`).** Kiểm tra FK của Postgres **bỏ qua RLS theo thiết kế** ⇒ FK MỘT-CỘT nối hai bảng đều có `company_id` cho phép ngữ cảnh tenant A gắn hàng của mình trỏ sang bản ghi của **B**. ⟲ **số đúng là 457, không phải 458**: 460 FK một-cột · **3** (không phải 2) đang được composite che — `tasks_parent_same_company_fk` (0503) che `tasks_parent_task_id_fkey`, cộng 2 cặp của `0533`. Dòng dẫn xuất: 460 hở → sau `0503` 459 → sau `0533` **457**. **TRƯỚC/SAU (đo trên `mediaos` head 0534 rồi trên lane đã áp 0535):** hở **457 → 11** · lớp T (đích `company_id NOT NULL`) **446 → 0** · lớp G (catalog toàn cục: `roles` 13/17 hàng NULL · `dashboard_widgets` 17/17 · `notification_events` 59/59 · `notification_templates` 45/45 · `public_holidays` · `seed_batches`) **11, KHÔNG vá được** — composite FK sẽ phá tham chiếu hợp lệ ⇒ ký waiver từng cặp ở `fk-tenant-verdicts.ts`, phần dư mở **KI-055**. **Dữ liệu:** 0 hàng lệch tenant lớp T trên CẢ `mediaos` lẫn `mediaos_dev` (144/132 hàng "lệch" của bản quét thô đều là tham chiếu tới hàng catalog toàn cục — HỢP LỆ) ⇒ **không xoá/sửa hàng nào**, migration dùng tiền kiểm + `RAISE EXCEPTION` thay cho `DELETE` của `0533` (BẤT BIẾN #2). **Chốt chống mọc thêm:** `xtenant-fk-ratchet.int-spec.ts` (10 assert, chạy ở CI vì `hasDb` không gate theo `LANE_DB`) + ca **W4** data-driven trong `tenant-isolation.int-spec` (449 cặp thử · **267 chứng minh bằng chính composite FK** qua 23503 + khớp `err.constraint`; 182 cặp bị chặn bởi cơ chế khác được liệt kê tường minh là CHƯA chứng minh) | S3 | Bảo mật (toàn vẹn) | ✅ | ❌ | **ĐÓNG 2026-07-31** — `S6-SEC-XTENANTFK-1` |
| **KI-057** | **Nghỉ bù (`COMPENSATORY`) KHÔNG trừ quỹ ⇒ không có đối chiếu nào với giờ làm thêm** — `leave_types.deduct_balance = false` (đo PROD 2026-08-01 18:38). Hệ quả: nhân viên xin **bao nhiêu ngày nghỉ bù cũng qua** cửa số dư, hệ thống không kiểm được ngày bù đó có nguồn hay không. **Bối cảnh — đây là quyết định, không phải lỗi:** phương án ban đầu (**C-1**, chốt 2026-08-01) là GIỮ `deduct_balance = true` + HR cấp số dư tay khi có OT thật, đúng bản chất *chỉ nghỉ bù được cái đã làm thêm*. Trong lúc khôi phục hai loại nghỉ bị đặt nhầm `inactive`, `COMPENSATORY` được đặt luôn về `false`; **owner chốt GIỮ NGUYÊN 2026-08-02** ⇒ hiệu lực là phương án **C-2**. **Không có module OT trong hệ thống** (0 bảng overtime) nên kể cả C-1 cũng phải cấp tay — C-2 chỉ bỏ nốt lớp chặn cuối. **Lớp kiểm soát duy nhất còn lại: bước DUYỆT của quản lý/HR** (`approve:leave`) — đây là điều kiện bắt buộc của quyết định này, không phải gợi ý. **Cần nói rõ trong thông báo go-live** để quản lý biết mình là chốt chặn duy nhất. Gỡ về C-1 bất cứ lúc nào bằng 1 thao tác: `/leave/types` → `COMPENSATORY` → tick lại *Trừ số dư phép* | S3 | Sản phẩm (đã chấp nhận) | ❌ | ❌ | Owner (chốt 2026-08-02) |
| ~~KI-059~~ | **ĐÓNG 2026-08-03** — `S7-INT-OUTBOX-FIFO-1`. `claim()` nay bọc `UPDATE … RETURNING` vào **CTE thứ hai** rồi `SELECT … FROM updated ORDER BY available_at, created_at, id` ở **NGOÀI CÙNG** (chỗ duy nhất Postgres bảo đảm thứ tự); `FOR UPDATE SKIP LOCKED` giữ nguyên ⇒ claim vẫn atomic, không mở cửa double-claim. Tie-break `created_at, id` thêm ở **CẢ HAI** vế: vế trong để TẬP hàng được claim tất định khi `available_at` hoà, vế ngoài để thứ tự giao tất định. **RED trước khi vá** (`apps/api/test/integration/outbox-fifo.int-spec.ts`, lane `mediaos_outboxfifo`): gieo seq 0..11 `available_at` tăng dần nhưng **CHÈN NGƯỢC** (⇒ thứ tự vật lý heap = nghịch đảo thứ tự logic, đòn bẩy tất định thay vì cầu may planner) — consumer nhận `[0,8,10,7,6,11,5,2,1,4,3,9]`, tức xáo hoàn toàn chứ không chỉ đảo. **Sau vá:** 49/49 xanh gồm hồi quy `outbox.int-spec.ts` (retry/backoff/dead-letter/reaper không đổi hành vi); **ca 6b của `chat-noti-e2e.int-spec.ts` — ca từng `it.skip` gắn chính KI này — đã BỎ SKIP và xanh 3/3 lượt** chạy cùng spec khác, đây là nghiệm thu end-to-end. ⚠️ **PHẠM VI BẢO ĐẢM — nói chính xác, đừng đọc thành "outbox giờ FIFO tuyệt đối":** bản vá chỉ bảo đảm thứ tự **trong MỘT lô claim của MỘT worker**. Ba chỗ nó không với tới: (1) **cùng một transaction** — `available_at` và `created_at` đều mặc định `now()` = mốc BẮT ĐẦU TRANSACTION nên event enqueue cùng tx bằng nhau ở cả hai cột, tie-break rơi xuống `id` = UUID ngẫu nhiên ⇒ thứ tự trong-tx KHÔNG phải thứ tự enqueue; (2) **sau retry** — `finalizeStatus` đẩy `available_at = now() + backoff` nên event lỗi được giao SAU những event sinh sau nó (đánh đổi có chủ đích của backoff); (3) **đa-instance** — hai worker claim hai tập RỜI NHAU đồng thời, không có thứ tự chéo-worker nào. Muốn đúng tuyệt đối phải thêm cột đơn điệu `bigserial` = migration + đổi hợp đồng đọc ⇒ **WO RIÊNG, chưa mở** (ghi ở đây để không ai đọc mục này thành "outbox giờ FIFO tuyệt đối"). Mô tả gốc giữ lại làm hồ sơ: **`outbox_events` KHÔNG phải FIFO — worker dispatch sai thứ tự ngay trong CÙNG một lô claim.** `OutboxWorker.claim()` (`apps/api/src/events/outbox-worker.ts`) chạy `WITH claimed AS (SELECT id … ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT n) UPDATE … WHERE id IN (SELECT id FROM claimed) RETURNING …`. Vế `ORDER BY` chỉ quyết định **chọn hàng nào**, KHÔNG quyết định thứ tự hàng của `RETURNING` — thứ tự đó do planner sinh và Postgres không bảo đảm gì; `processEvent` rồi lặp đúng theo thứ tự đó. **Bằng chứng đo 2026-08-03** (lane `mediaos_chatbe6`, log tạm đặt ngay sau `claim()`): 3 event `chat.message.direct_sent` enqueue theo thứ tự 1→2→3 quay về `[2, 1, 3]`; ba lượt đo trước đó cho thứ tự **ĐẢO** (3→2→1), đối chứng độc lập bằng `updated_at` của bước finalize. Chạy **cô lập** thì bảng nhỏ và plan tình cờ ra đúng FIFO ⇒ lỗi chỉ lộ khi có spec/instance khác chạy song song, và lộ dưới dạng **hỏng-im-lặng**: không log, không exception, chỉ sai dữ liệu. **Hệ quả:** với consumer mà N event gộp thành 1 thông báo qua dedupe, payload của thông báo lấy từ event **được tiêu thụ trước**, KHÔNG phải event đầu theo thời gian. Quan sát được đầu tiên ở `CHAT_DIRECT_MESSAGE` (`S7-CHAT-BE-6`): `unread_count` nhận 1/2/3 tuỳ lượt chạy. 30 event-type còn lại (TASK · LEAVE · ATT · GOAL · HR-PCR · AUTH) hôm nay mỗi event sinh 1 thông báo độc lập nên chưa quan sát được — nhưng bất kỳ consumer nào phụ thuộc thứ tự sẽ sai âm thầm y hệt. **Hướng vá:** bọc `UPDATE` vào CTE thứ hai rồi `SELECT … ORDER BY available_at, created_at, id` ở ngoài cùng (chỉ `ORDER BY` của SELECT ngoài cùng mới có bảo đảm), kèm test hồi quy đo THỨ TỰ DISPATCH ở tầng events. **Giới hạn tồn dư kể cả sau khi vá:** event enqueue trong CÙNG transaction chia sẻ `now()` cho cả `available_at` lẫn `created_at` ⇒ hoà, chỉ còn phân định bằng uuid ngẫu nhiên; muốn đúng tuyệt đối phải thêm cột `bigserial` (= migration, tách riêng). Theo dõi ở WO **`S7-INT-OUTBOX-FIFO-1`** | S3 | Hạ tầng (event bus) | — | — | **ĐÓNG 2026-08-03** — `S7-INT-OUTBOX-FIFO-1` |
| **KI-060** | **Tệp đính kèm dùng ở NHIỀU nơi: mất `url` ở chỗ mình có quyền, vì một link khác mình không có quyền.** `FilePolicyService.decideForLinkedFile` là AND-khắt-khe-nhất trên MỌI link sống của tệp, tính RIÊNG cho từng user. Nên nếu cùng một `file_id` có hai link (ví dụ hai `chat_message` ở hai phòng), người ở phòng A **không thuộc** phòng B sẽ mất `url` **ngay tại phòng A** — thấy tên + kích thước, bấm tải không được. **Owner CHẤP NHẬN cho v1 (2026-08-03)**, ba lý do: (1) đường UI bình thường tải tệp lên tạo **file mới**, nên tình huống đa-link chỉ phát sinh qua `POST /foundation/files/:id/links` hoặc tính năng "chuyển tiếp tin nhắn" **chưa tồn tại ở v1** ⇒ phơi nhiễm thực tế gần 0; (2) **KHÔNG được vá bằng cách nới AND**: gate `S7-CHAT-BE-GATE-3` đã phân tích — dưới OR trong cùng nhóm `(module, entityType)`, kẻ tấn công chỉ cần link tệp của phòng nó KHÔNG thuộc vào tin nhắn của CHÍNH NÓ là được cấp quyền, tức mở lại đúng lỗ `S5-TASK-COVER-1` đã đóng (dưới AND, thêm link không bao giờ CẤP quyền, chỉ có thể lấy bớt); (3) khuyết tật THẬT là **sự im lặng** — đã vá: `decideForLinkedFile` trả `deniedByLink` (chẩn đoán, CẤM dùng để phân quyền) và CHAT log WARN khi tệp bị chặn bởi một entity KHÁC tin đang đọc. **Điều kiện mở lại:** khi build "chuyển tiếp tin nhắn" hoặc bất kỳ đường nào tạo link thứ hai từ UI ⇒ làm **copy-on-resend** (tạo bản sao tệp thay vì link thứ hai) CÙNG release đó | S3 | Sản phẩm (đã chấp nhận) | ❌ | ❌ | Owner — mở lại khi có forward-message |
| ~~**KI-058**~~ | **ĐÓNG 2026-08-02 — `S6-LEAVE-CAPALLOW-1` (PR #325).** **4 màn QUẢN TRỊ LEAVE không vào được từ UI** dù quyền trong DB có đủ. Cơ chế: `getCapabilities()` lọc bỏ **toàn bộ** cặp `is_sensitive`; chỉ cặp trong `SENSITIVE_CAPABILITY_ALLOWLIST` mới được `getAllowlistedSensitiveCapabilities()` trả lại cho FE. 10 cặp gác LEAVE-SCREEN-010/011/012 + màn Giao dịch số dư (seed mig `0455`, grant @Company cho `hr`+`company-admin`) **chưa bao giờ được thêm** ⇒ `/auth/me` không trả ⇒ màn ẨN với đúng vai ĐƯỢC CẤP quyền. Im lặng: không lỗi, không log, không test nào đỏ. **Chặn go-live** vì LEAVE-SCREEN-011 là đường **DUY NHẤT** bật `accrual_method`, mà `ANNUAL` có `deduct_balance=true` + `leave_balances`=0 ⇒ mọi đơn phép năm trả **422 `BALANCE_NOT_ENOUGH`**. **Vì sao không ai thấy sớm:** chỉ `SA` dùng được, và chỉ nhờ **TAI NẠN** — `SA` có grant `*:*` (`is_sensitive=false`) nên lọt qua fallback wildcard của `useCan()`; màn dùng `useCanExact()` thì `SA` cũng trượt. **Lần lặp thứ 8+** của cùng lớp lỗi (CAP-2 → USEROPS-1 → EXPORT-1 → NOTI-BE-3 → DASH-3 → IDENTITY-READ-1 → IMPORT-FE-1) ⇒ vá kèm **test khoá** `SENSITIVE_SCREEN_GATE_PAIRS` ⊆ allowlist, RED-proof (gỡ đúng 1 cặp ⇒ đỏ đúng thông điệp) ⇒ lần sau quên allowlist thì **CI đỏ** thay vì ẩn màn trong im lặng. Enforcement **KHÔNG đổi** — allowlist chỉ là cờ hiển thị; `@RequirePermission` per-resource + data-scope + RLS vẫn là cổng thật; wildcard `*:*` vẫn không kế thừa cặp nhạy cảm | S2 | Phân quyền (hiển thị) | ✅ | ✅ đã deploy `30540ab0` | **ĐÓNG** — `S6-LEAVE-CAPALLOW-1` |
| **KI-055** | **Lỗ tồn dư lớp G sau `S6-SEC-XTENANTFK-1`**: 11 cặp FK trỏ tới bảng **catalog toàn cục** (`company_id` NULLABLE) KHÔNG vá được bằng composite FK — vá là chặn luôn tham chiếu hợp lệ tới hàng dùng chung (gán role hệ thống, cấu hình widget, template noti). Hệ quả còn lại: trong ngữ cảnh tenant A vẫn trỏ được tới hàng catalog **CỦA TENANT B** (nặng nhất: `user_roles.role_id → roles` — bảng phân quyền, crown-jewel). Phòng thủ hiện tại nằm ở RLS tầng đọc + kiểm tra tầng service, KHÔNG ở tầng DB. Hướng vá: trigger/CHECK "cha cùng tenant **HOẶC** là hàng toàn cục (`company_id IS NULL`)". **Tác hại ĐO ĐƯỢC** (rls-tenant-isolation-tester, FULL gate 2026-07-31): tenant A gán được role của B ⇒ sau đó **B xoá role của chính B thì hàng `user_roles` mang `company_id = A` biến mất** (CASCADE bắc cầu chéo tenant) — tức tenant B tự ý gỡ được quyền của người thuộc tenant A. Ngược lại cũng đã chứng minh composite FK KHÔNG dùng được ở đây: thêm thử `user_roles.role_id` ⇒ `Key (company_id, role_id)=(A, <role hệ thống>) is not present in table "roles"` ⇒ **phá luôn việc gán role hệ thống**. Đã ký waiver từng cặp kèm lý do ở `apps/api/test/foundation/fk-tenant-verdicts.ts`; ratchet ca (e) chặn việc ký waiver cho cặp lớp T | S3 | Bảo mật (toàn vẹn) | ✅ | ❌ | Mở 2026-07-31 (tách từ KI-046) |
| ~~KI-029~~ | **ĐÃ VÁ 2026-07-28** (owner duyệt đổi hành vi sau freeze) — khai `PERMISSION_GUARD_ENABLED` trong `env.schema.ts` (default `"true"`) + `.env.example`; **`NODE_ENV=production` + `"false"` ⇒ CHẶN BOOT** (superRefine), giá trị lạ (`False`/`0`/rỗng) nay ĐỎ thay vì im lặng coi là bật. Guard **vẫn đọc `process.env` mỗi request** có chủ đích: rollback khẩn không cần build lại config, và reviewer dùng chính cờ này để tái lập vế RED của gate quyền. RED-proof: 5 ca mới ĐỎ khi gỡ vá, 24/24 xanh khi có vá; 434 unit vùng permission/auth/config không hồi quy. ~~kill-switch fail-OPEN toàn hệ, ngoài `env.schema`~~ | S2 | Bảo mật (tiềm ẩn) | ✅ | ⚠️ cần deploy | **ĐÓNG** |
| ~~KI-030~~ | **3 route** `/org` không gate trả danh bạ + cơ cấu team toàn tenant cho mọi user đã đăng nhập (`employees` · `teams` · `teams/:id/members`) — lệch với `/hr/employees` vốn ép data_scope. ⟲ mở rộng 1 → 3 route bởi census runtime `S6-SEC-ROUTEMAP-1` | S2 | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG 2026-07-27** — `S6-SEC-ORG-1` |
| KI-031 | `INTERNAL_API_KEY` ngoài `env.schema`/`.env.example` (guard **fail-CLOSED** nên chỉ mất tính năng) | S3 | Vận hành | ❌ | ❌ | Sau MVP |
| ~~KI-045~~ | **ĐÓNG 2026-07-29** — `S6-SEC-ROTATE-1` (chính WO gây ra, nay vá cùng nhánh). Sau rotate 28/7, đường chạy int-spec bằng `LANE_DB` không còn nối được DB: hai chỗ còn giữ credential TIỀN-rotate là `scripts/lane-db-setup.sh` (`DEV_PW` fallback hằng số) và `apps/api/test/db-target.ts` (dựng 3 URL lane từ hằng số) ⇒ `28P01`, db-fence fail-closed nên **toàn bộ suite api từ chối chạy** — hàng rào deny-path/IDOR/cross-tenant thành *không chạy được*. **Vá**: cả hai nay đọc credential từ `.env` qua helper chung `scripts/lib/db-secrets.sh` (`SUPERUSER_DB_PASSWORD` · `APP_DB_PASSWORD` · `WORKER_DB_PASSWORD`); thiếu ⇒ DỪNG kèm chỉ dẫn, KHÔNG đoán. `harness/check.sh --lane-db` tự nạp + export 3 biến đó và `unset` cả 3 `DATABASE_*_URL` trước khi chạy test (URL tường minh THẮNG `LANE_DB` — vector V2 của KI-028). **Về vế "hỏng im lặng"**: CỐ Ý giữ cảnh báo-rồi-chạy-tiếp thay vì hard-fail, vì header `check.sh` hứa không bắt buộc Docker và worktree lane thường không có `.env`; bù lại `lane-db-guard` escalate **ĐỎ** ở tier `--all`/`REQUIRE_LANE_DB` ⇒ không thể mở PR vùng đỏ với bằng chứng deny-path rỗng. **Bằng chứng**: `bash scripts/lane-db-setup.sh rot1` chạy được không cần export tay; rồi chỉ với `LANE_DB` (không URL tường minh) → `db-tenant` + `att-core-tenant-deny` + `admin-users-deny` = **46/46 ca CHẠY THẬT** (không skip), `db-target.unit-spec` 34/34 | **S2** | Độ phủ test / gate | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ROTATE-1` |
| ~~KI-043~~ | **ĐÓNG 2026-07-28** — `S6-SEC-ROTATE-1`. Đã rotate **5 role** (`mediaos` SUPERUSER · `mediaos_owner` · `mediaos_app` · `mediaos_worker` · `pgbouncer_auth`) sang mật khẩu ngẫu nhiên 32 ký tự. **Bằng chứng hai chiều, đo TỪ HOST qua `localhost:5432`** (đường tấn công thật): 3 literal cũ đều `password authentication failed`, ca đối chứng mật khẩu-bậy cũng bị từ chối (chứng minh đang xác thực `scram-sha-256` chứ không phải `trust`), 5/5 mật khẩu mới nối được. ⚠️ Phép thử bằng `docker exec psql -h 127.0.0.1` **CHỨNG MINH SAI** — `pg_hba` của image có `host all all 127.0.0.1 trust`, mọi mật khẩu đều qua. **Nguồn tái nhiễm đã cắt**: `Invoke-Roles` (`mediaos.ps1`) không còn `ALTER ROLE … '<literal>'` mà uỷ quyền cho `scripts/setup-db-roles.mjs` (chỉ đọc env) — chạy lại `m roles` sau rotate rồi thử lại literal cũ: **vẫn bị từ chối**. **Bind**: 5 cổng `5432/6432/6379/9000/9001` từ `0.0.0.0`+`[::]` → **`127.0.0.1`** (firewall KHÔNG dùng làm bằng chứng: máy có 204 rule inbound allow-any-port). **Literal = 0** trên file tracked **và file mới chưa gitignore** (gồm cả docs — không có danh sách miễn trừ). **Chốt hồi quy**: `scripts/check-no-secret-literals.mjs` chạy trong `harness/check.sh` + job `secret-scan` của `security.yml` — bắt loại lỗ hổng gitleaks MÙ (chuỗi `changeme_*` không *trông* giống secret; mật khẩu nằm trong userinfo của connection string). Lưới hồi quy của chính cổng: `scripts/guardproof-secret-literals.sh` — **27 ca, PASS 27/0**, dựng repo git tạm rồi chạy cổng thật. FULL gate chạy **2 vòng, cả hai đều BLOCK**, và cả 6 HIGH đều nằm trong bộ an toàn chứ không phải ở phần rotate — đáng chú ý nhất: cổng ban đầu chỉ quét `git ls-files` nên **mù với chính 2 file mới của WO**, báo XANH tới tận sau khi commit. Script seed (`demo-seed-{base,full,dashboard}` · `seed-operator`) nay **fail-closed**: không khai DB đích ⇒ exit 1; đích là `mediaos`/`mediaos_dev` ⇒ exit 1 trừ khi khai đúng tên qua `SEED_ALLOW_PROTECTED_DB`. **KHÔNG history-rewrite** (quyết định có chủ đích: literal đã public từ lâu, giá trị phòng thủ sau rotate ≈ 0, chi phí thì thật). Dữ liệu sau rotate: `funtime` 46 user, `/health/db` 200, `check-prod-test-tenants` exit 0 | **S0** | Bảo mật | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ROTATE-1` |

| ~~KI-051~~ | **MỞ VÀ ĐÓNG 2026-07-30** — `S6-SEC-IDENTITYBOUND-1` (N-1d). `GET /recycle-bin/employees` gate `read:employee` rồi trả `userFullName` + `userEmail` của **MỌI** hồ sơ xoá mềm — `RecycleBinService.listDeletedEmployees` **không resolve một scope nào**. Đo PROD 2026-07-30: role SEEDED `employee` giữ `read:employee@Own` với **45/46 user sống** và **không có `view:user` nào** ⇒ mỗi nhân viên đọc được danh bạ toàn bộ nhân sự đã nghỉ việc. **Cùng lớp lỗi KI-049 nhưng 45 người giữ cặp thay vì 0.** Phơi nhiễm lúc phát hiện = **0 hàng** (0 hồ sơ xoá mềm) — chặn bởi *thiếu dữ liệu*, không phải bởi lớp kiểm soát nào; off-boarding đầu tiên là nó thành sống. **Vá** (khuôn N-1c, KHÔNG migration): `resolveOrNull(view:user)` → `buildUserScopeCondition` → khử ở tầng SQL (`case when`) rồi bỏ hẳn khoá ở service; `scope=null` ⇒ `logger.warn` + 0 danh tính. **RED chứng minh trước** (`identity-bound-scope.int-spec.ts`): ca `read:employee@Own` không `view:user` trả **2/2 danh tính** trước vá → **0** sau vá; hai ca đối chứng (`Company` thấy đủ · thiếu cặp gate vẫn **403**) xanh ở CẢ HAI phía. FE: `deletedEmployeeSchema` phải `.optional()` — khoá vắng mà schema đòi bắt buộc ⇒ ZodError dù HTTP 200 ⇒ **vỡ trắng trang cho đúng role mà bản vá bảo vệ**; đã khoá bằng ca console, và ca đó **đã chứng minh đỏ** khi gỡ `.optional()` | **S2** | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG** — `S6-SEC-IDENTITYBOUND-1` |
| ~~KI-052~~ | **MỞ VÀ ĐÓNG 2026-07-30** — `S6-SEC-IDENTITYBOUND-1` (N-1e). `GET /org/teams` chiếu `leaderUserName` (họ tên trưởng nhóm) không bound, gate `read:team`. Đúng hình dạng N-1c **ở phương thức bên cạnh trong chính file `org.repository.ts` mà `S6-SEC-ORGTEAMSCOPE-1` vừa vá** — vá lẻ theo route không quét hết file. `S3`: một cái tên mỗi team, `teams` = 0, role duy nhất giữ `read:team` mà thiếu `view:user` là `hr-manager` (**0 user sống**). Vá cùng khuôn. ⚠️ Khác N-1c: contract `leaderUserName` là `.nullable()` hợp lệ (team chưa có trưởng nhóm) ⇒ `null` KHÔNG phân biệt được "chưa có" với "ngoài scope", nên **bắt buộc bỏ khoá**, không được dựa vào `null` mang tin | S3 | Bảo mật (phân quyền) | ❌ | ❌ | **ĐÓNG** — `S6-SEC-IDENTITYBOUND-1` |
| KI-053 | `PermissionAdminRepository.listRoleMembersTx` (`role-admin.repository.ts:158-159`) chiếu `email` + `fullName` của thành viên một role, `where` chỉ có `roleId` + `companyId` + `notDeleted` — **không vị từ scope nào**. Gate `read:role`/`view:role`, hôm nay chỉ `SA`(6) + `company-admin`(1) giữ, cả hai `@Company` ⇒ **rủi ro sống thấp**, nhưng vẫn là điểm chiếu không bound: role bất kỳ đúc sau này với `read:role` hẹp vẫn nhận trọn email. **Workaround:** không cấp `read:role` ngoài admin. Xử lý cùng `S6-SEC-IDENTITY-PROJ-1` (cơ chế). **HOÃN 2026-07-31 (owner chốt)** — verify lại còn thật ở `role-admin.repository.ts:166-174` (`where` = `roleId`+`companyId`+`notDeleted`+chưa-hết-hạn, không vị từ scope), nhưng hoãn theo `done_when` #6 của chính WO: *"S3 KHÔNG chặn RC; đang trong cửa sổ RC thì hoãn"*. Cửa sổ RC ĐANG MỞ (`RELEASE-07` §2: RC-003 + RC-004 CHƯA ĐẠT, tag `v1.0.0-rc.1` chưa tạo) và `S2` = 3/3 **sát ngưỡng** ⇒ refactor 79 điểm/31 file/12 module sinh thêm 1 `S2` là mất quyền cắt RC. Workaround ở trên là lớp kiểm soát duy nhất đang hiệu lực — **không cấp `read:role` cho role mới nào** cho tới khi gỡ hoãn | S3 | Bảo mật (phân quyền) | ❌ | ❌ | `S6-SEC-IDENTITY-PROJ-1` — **HOÃN ngoài cửa sổ RC** (mở 2026-07-30, hoãn 2026-07-31) |
| KI-054 | `login-log.repository.ts:72-73` + `security-event.repository.ts:84-88` chiếu `userEmail`/`userFullName`/`actorEmail`/`actorFullName` không bound; `AuthLogsViewerService` docstring ghi "Company-scope" nhưng **không resolve `data_scope`** — Company là mô tả ý định, không phải thứ được ép. Gate `view:audit-log` (`isSensitive`), hôm nay chỉ `SA` + `company-admin` @Company. Khác KI-053 ở chỗ **có dữ liệu thật**: 316 `login_logs` + 28 `user_security_events`. **Workaround:** không cấp `view:audit-log` ngoài admin. Xử lý cùng `S6-SEC-IDENTITY-PROJ-1`. **HOÃN 2026-07-31 (owner chốt)** — verify lại còn thật: `buildWhere` (`login-log.repository.ts:39-46`) chỉ nhận `userId`/`status`/`dateFrom`/`dateTo` **từ query param của caller**, không nhận `actor`, không resolve `data_scope` ⇒ "Company-scope" vẫn chỉ là chữ trong docstring. Cùng căn cứ hoãn với KI-053 (`done_when` #6 + cửa sổ RC mở + `S2` 3/3). ⚠️ Mức phơi nhiễm cao hơn KI-053 vì **có dữ liệu thật** (316 `login_logs` + 28 `user_security_events`) ⇒ workaround **không cấp `view:audit-log` cho role mới nào** là điều kiện bắt buộc của quyết định hoãn này, không phải gợi ý | S3 | Bảo mật (phân quyền) | ❌ | ❌ | `S6-SEC-IDENTITY-PROJ-1` — **HOÃN ngoài cửa sổ RC** (mở 2026-07-30, hoãn 2026-07-31) |

> **Đánh số:** `S6-QA-FINAL-1` (PR #294) chiếm **KI-024…026**; `S6-SEC-1` (PR #295) tiếp
> **KI-027…042**. Hai PR merge vào cùng bảng này — đã **giữ cả hai khối, không đánh số lại**
> (tài liệu khác đã trỏ tới số hiệu).
>
> **`S6-SEC-IDENTITYBOUND-1` (2026-07-30) chiếm KI-051…054.** KI-051/052 mở **và** đóng trong cùng
> WO ⇒ số `S2` mở ròng **không đổi** (`RELEASE-07` §2 giữ nguyên 3: KI-021 · KI-025 · KI-050).
> KI-053/054 mở dưới dạng **nợ có số hiệu** — cố ý không để chúng nằm dạng văn xuôi, vì một phát
> hiện không có số hiệu thì vô hình với bước bug scrub trước RC (`RELEASE-05` §5.3), đúng lỗi đã
> mắc với chính KI-049.
>
> **HOÃN `S6-SEC-IDENTITY-PROJ-1` — owner chốt 2026-07-31.** Cả KI-053 và KI-054 đã **verify lại là
> còn thật** (file:dòng ở hai dòng trên, đọc code chứ không tin số cũ) nhưng WO cơ chế được hoãn ra
> **ngoài** cửa sổ RC theo `done_when` #6 của chính nó. Ba dữ kiện chống lại việc làm ngay:
> (1) `RELEASE-07` §2 ghi **CHƯA CẮT ĐƯỢC RC** — RC-003 (staging `:3200` không lắng nghe) + RC-004
> (`mediaos_dev` lệch 5 migration) chưa đạt, tag `v1.0.0-rc.1` chưa tạo; (2) `S2` đang **3/3 sát
> ngưỡng** `RELEASE-05` §5.3 — nhận thêm 1 `S2` là mất quyền cắt RC, trong khi cơ chế này đụng **79
> điểm chiếu / 31 file / 12 module** và phải nhận 4 dạng căn cứ khác nhau (scoped-predicate ·
> self-bound-by-actor · waiver đã ký · job không có actor HTTP); (3) rủi ro sống của cả hai KI là
> thấp — chỉ `SA`(6) + `company-admin`(1) giữ cặp gate, cả hai `@Company`.
> **Điều kiện gỡ hoãn:** đã cắt tag `v1.0.0-rc.1` và qua `S6-GOLIVE-1`, hoặc owner chốt lại.
> **Ràng buộc trong thời gian hoãn:** hai workaround là lớp kiểm soát DUY NHẤT đang hiệu lực —
> không cấp `read:role` / `view:audit-log` cho bất kỳ role nào ngoài admin. Cấp là lỗ thành sống.
>
> ⚠️ **Dấu hoãn phải là `blocked`, KHÔNG phải `reopened`.** WO này đã bị `start-on-touch` đóng dấu
> `in_progress` NHẦM **2 lần trong ngày 2026-07-31** (glob `apps/api/test/**` và
> `apps/api/src/**/*.repository.ts` trong `paths` của nó bắt phải file của WO khác đang thi công).
> Cả hai lần đều vá bằng `reopened` — nhưng `harness/lib/wo-state.mjs:76` cho thấy `start-on-touch`
> chỉ xét WO có status hiệu dụng **`todo`**, mà `reopened` trả WO về đúng `todo` ⇒ vá kiểu đó **tái
> phát chắc chắn**. Ledger nay đóng dấu `blocked` (`wo-state.mjs:19`) ⇒ WO rơi khỏi
> `readyTodoMatches` và không auto-start nữa; đã chứng minh bằng cách chạy lại `autoStartOnTouch`
> trên đúng 2 đường dẫn đã gây WIP ảo — cả hai trả `null`. Lưu ý `harness/activity.jsonl` **bị
> gitignore** (state local từng máy) nên quyết định hoãn phải sống ở tài liệu này mới chia sẻ được.

**Tổng (cập nhật 2026-07-27 sau re-gate vòng 2 của `S6-SEC-1`):**
`S0 = **0 mở**` (**KI-043 rời danh sách 2026-07-28** — đóng bởi `S6-SEC-ROTATE-1`: rotate 5 role + cắt nguồn tái nhiễm + bind loopback + chốt hồi quy, bằng chứng hai chiều đo TỪ HOST; KI-028 · KI-032 · KI-038 **đều đã đóng VÀ verify trực tiếp trên PROD**, riêng KI-028 phải đóng lại lần hai ngày 2026-07-28) · `S1 = **0 mở**` (**KI-027 rời danh sách 2026-07-28** — dòng của nó ghi ĐÃ ĐÓNG kèm verify 3 lớp trên PROD, `RELEASE-01` §5 cũng ghi đóng; khối tổng còn ghi "1 mở" tới 2026-07-29 là **lệch sổ**, đã sửa. Cả 8 dòng mức `S1` trong bảng nay đều gạch) — **KI-030 rời danh sách 2026-07-27**, đóng bởi `S6-SEC-ORG-1` (3→2); **KI-034 rời danh sách 2026-07-28**, đóng bởi `S6-SEC-NOTITX-1` (2→1); KI-033 **đã vá**; KI-035 **đã vá + hạ xuống `S3`** (hai claim của gate đều sai, xem dòng của nó). KI-027 nay chỉ còn chờ admin enroll 2FA rồi bật cờ, vì gốc rễ KI-036 đã vá ·
`S2 = **3 mở**` (KI-021 · **KI-025** · **KI-050**) — **cập nhật 2026-07-30 (`S6-REL-1`)**: đóng **KI-011** (cảnh báo tự động) + **KI-016** (dist dùng chung); đối chiếu lại thì **KI-008 đã đóng từ 2026-07-29** bởi `S6-PERF-DB-1` và **KI-029 đã đóng từ 2026-07-28** bởi `S6-SEC-1` (`env.schema.ts:86`) — cả hai còn bị ĐẾM NHẦM là mở ở bản trước của dòng này; đổi lại **mở KI-050** (chưa từng có backup nào). 6 → 3, vừa đúng ngưỡng `RELEASE-05` §5.3 (≤3) — **KI-049 mở và đóng trong cùng ngày 2026-07-29/30** bởi `S6-SEC-ORGTEAMSCOPE-1` (7→6) — **KI-037 rời danh sách 2026-07-29**, đóng bởi `S6-QA-TENANTWRITE-1` (9→8); **KI-045 rời danh sách 2026-07-29**, đóng bởi `S6-SEC-ROTATE-1` (8→7); **KI-041 rời danh sách 2026-07-29**, đóng bởi `S6-SEC-MV-1` (7→6) · `S3 = **19**` (thêm **KI-046** từ lưới GHI mới; **KI-044 đóng** bởi `S6-SEC-LOGINLOG-2`, đổi lại **KI-047** + **KI-048** mở — tất cả 2026-07-29). **Cập nhật 2026-07-31 (`S6-SEC-XTENANTFK-1`):** `S3` vẫn **19** — **KI-046 đóng** (457 cặp hở → 11; lớp T 446 → 0), đổi lại **KI-055 mở** cho phần dư lớp G không vá được bằng composite FK. Đóng-1-mở-1 là CÓ CHỦ ĐÍCH: nợ còn lại phải có SỐ HIỆU, nếu không nó vô hình với bug-scrub trước RC. `S2` không đổi (3).
**Cập nhật 2026-07-31 (`S6-GOLIVE-1`):** `S2 = **4 mở**` (KI-021 · KI-025 · KI-050 · **KI-056**) — **VƯỢT ngưỡng `RELEASE-05` §5.3 (≤3)** ⇒ thêm một cổng chặn cắt RC. **KI-056 mở** (4/6 tài khoản `SA` toàn quyền không có 2FA) — cổng **rẻ nhất** để mở lại ngưỡng: 4 người enroll TOTP là `S2` về 3. **KI-050 KHÔNG đóng nhưng giảm mạnh**: đã có bản backup thật + chứng minh khôi phục được + tín hiệu giám sát hết `unknown`; còn lại lịch tự động + mã hoá + offsite. Nhân đó phát hiện `scripts/backup-db.sh` **chưa từng chạy được** trên máy PROD (đã vá + 6 test) và `backups/` **chưa hề được gitignore** trên repo PUBLIC. `S0` · `S1` · `S3` không đổi.

**Cập nhật 2026-08-02:** `S3` **19 → 20** — thêm **KI-057** (nghỉ bù bỏ trừ quỹ, owner chấp nhận). `S2` vẫn **4** (KI-021 · KI-025 · KI-050 · KI-056) — chưa mục nào đóng. Ghi số hiệu cho KI-057 thay vì để nó nằm dạng văn xuôi: một quyết định nới lỏng kiểm soát mà không có số hiệu thì vô hình với bug-scrub trước RC — đúng bài học đã trả giá với `accrual_method` và `max_negative_days` (biết mà chỉ ghi comment).

**Cập nhật 2026-08-03 (`S7-CHAT-BE-6`):** `S3` **20 → 21** — thêm **KI-059** (`outbox_events` không FIFO). `S2` vẫn **4** (KI-021 · KI-025 · KI-050 · KI-056). Mục này mở ra từ một ca test đỏ ngắt quãng của CHAT nhưng gốc nằm ở **hạ tầng event bus dùng chung**, không ở CHAT ⇒ cấp số hiệu riêng + WO riêng thay vì vá kèm trong WO nghiệp vụ: một khiếm khuyết hạ tầng nấp trong commit của module sẽ không bao giờ được hồi quy ở đúng tầng của nó.

**Cập nhật 2026-08-03 (`S7-INT-OUTBOX-FIFO-1`):** `S3` **21 → 20** — **KI-059 đóng** ngay trong ngày mở, ở
đúng tầng hạ tầng đã cấp số hiệu cho nó (không vá kèm trong WO nghiệp vụ CHAT). `S2` vẫn **4** (KI-021 ·
KI-025 · KI-050 · KI-056). Hai điểm đáng giữ lại làm tiền lệ: (1) **hồi quy đặt ở tầng của lỗi, không ở tầng
quan sát được lỗi** — spec mới sống ở `test/integration/outbox-fifo.int-spec.ts` (tầng events, đo THỨ TỰ
DISPATCH trực tiếp), còn ca 6b của CHAT chỉ là nghiệm thu end-to-end; nếu chỉ vá và dựa vào ca CHAT thì lần
regression sau sẽ đỏ ở một module ngẫu nhiên và mất thêm một phiên để truy lại. (2) **đóng KÈM giới hạn tồn
dư, không đóng lửng** — thứ tự trong CÙNG một transaction vẫn không được bảo đảm và điều đó ghi thẳng ở cả
dòng KI, jsdoc `claim()`, lẫn chú thích ca 6b; ba chỗ này là nơi người sau thực sự đọc.

**Cập nhật 2026-08-03 (`S7-CHAT-BE-GATE-3`, owner chốt 3 mục):** `S3` **20 → 21** — **KI-060 mở** (tệp
đa-link mất `url`, owner CHẤP NHẬN cho v1). `S2` vẫn **4**. Gate 5 lane trên toàn bề mặt CHAT đã vá 1
CRITICAL (URL ký rò cho cả phòng qua WS — hai lane độc lập cùng tìm ra) + 5 HIGH; chi tiết ở commit
`03f9a924`. Ba WO sinh ra và ĐÃ seed vào `harness/backlog.mjs`: **`S7-QA-CATALOGFIXTURE-1`** (🔴) ·
**`S7-CHAT-DB-3`** (🔴 expand-contract least-privilege) · **`S7-CHAT-CLEAN-2`** (🟡 dọn nhẹ). Ghi số hiệu cho KI-060 thay vì
để nó nằm dạng văn xuôi — theo đúng luật đã áp với KI-057: **một quyết định chấp nhận rủi ro mà không có
số hiệu thì vô hình với bug-scrub trước RC**.

**ĐÍNH CHÍNH thứ hai cùng ngày — `users` KHÔNG còn `DELETE` cho app role.** Phát hiện của lane L3 đọc
`0002_companies_users.sql:70` (`GRANT … DELETE ON users`) mà bỏ qua
`0467_s2_fnddb1_companies_users_revoke_delete.sql` **đã thu hồi**. Đo bằng
`has_table_privilege('mediaos_app','users','DELETE')` trên 2 lane DB: **false** ⇒ **runtime không với tới
được**. Phần CÓ THẬT và vẫn nằm trong `S7-CHAT-DB-3`: FK `ON DELETE CASCADE` từ `chat_messages.sender_id`
— hard-delete `users` ở tầng **owner** (script dọn / migration / cleanup của test) vẫn xoá cứng bảng
append-only. Tức đây là rủi ro **quy trình + FK**, KHÔNG phải lỗ phân quyền. Hai vế còn lại của WO đo lại
vẫn ĐÚNG: `UPDATE(visible_from_seq)` và `UPDATE` cấp bảng `chat_rooms` đều đang mở cho `mediaos_app`.

**ĐÍNH CHÍNH cùng ngày (commit `4f52948c`) — KHÔNG có lỗ phân quyền `update:project`.** Bản trước của
dòng này (và WO `S7-AUTH-CAPSWEEP-1`, đã GỠ) khẳng định `update:project` là `is_sensitive` nhưng ngoài
`SENSITIVE_CAPABILITY_ALLOWLIST` ⇒ màn quản trị đang ẩn trên PROD. **Sai.** Catalog thật khai
`('update','project', false)` (`0005:224`); `0485` bước (b) chỉ nâng 8 cặp và không có cặp này. Giá trị
`TRUE` đo được là **rác do fixture `WRITER_PAIRS` của `chat-be5-derived-rooms.int-spec.ts`** đóng dấu vào
`permissions` — bảng TOÀN CỤC, không `company_id`, `cleanupTenants` không chạm. Đo 5 DB: chỉ đúng lane
từng chạy chat-be5 là `t`, bốn DB còn lại `f`. **Bài học phương pháp, đáng nhớ hơn cả sự cố:** phép thử
"`git stash` rồi chạy lại trên CÙNG lane" — vốn trông rất thuyết phục — **không phân biệt được lỗi loại
này**, vì hỏng nằm trong DB chứ không trong code; stash bao nhiêu lần thì hàng catalog vẫn `t`. Muốn quy
trách nhiệm cho code thì phải đổi **DB sạch**, không phải đổi code.
**KI-045 mở 2026-07-28** trong lúc thi công `S6-SEC-NOTITX-1` — rotate của `S6-SEC-ROTATE-1` làm gãy
đường `LANE_DB`, tức **hàng rào deny-path/IDOR không chạy được bằng lệnh chuẩn** (8 → 9). **Đóng
2026-07-29 trong chính nhánh gây ra nó** (credential đọc từ `.env` qua `scripts/lib/db-secrets.sh`,
46/46 ca deny-path chạy thật chỉ với `LANE_DB`) ⇒ 8 → 7.
**⚠️ Đụng số hiệu đã xử lý khi merge (2026-07-29):** `S6-SEC-NOTITX-1` (#301) và `S6-QA-TENANTWRITE-1`
(#303) **cùng lấy số KI-045** vì thi công song song. Giữ **KI-045 = LANE_DB gãy** (merge trước),
**đánh lại số của lưới GHI thành KI-046** (458 FK một-cột) ở cả RELEASE-02 · plan · backlog · migration `0533`.
**KI-014 rời danh sách 2026-07-27** — đóng bởi `S6-QA-CHUNK-1` (9 → 8).
**KI-042 rời danh sách 2026-07-28** — đóng bởi `S6-SEC-LOGINLOG-1` (mig `0532`), `S3` 17 → 16;
**KI-044 mở cùng ngày** từ FULL gate của chính WO đó (hai reviewer độc lập cùng chỉ ra) ⇒ `S3` 16 → **17**.
**KI-044 rời danh sách 2026-07-29** — đóng bởi `S6-SEC-LOGINLOG-2` (18 → 17); **KI-047 mở cùng ngày**
từ chính việc khoanh ranh giới của WO đó (4 đường 429 khác không ghi `login_logs`, nặng nhất là dò mã
2FA ở bước-2 `verifyTwoFactorLogin`) ⇒ `S3` 17 → **18**; **KI-048 mở cùng ngày** từ FULL gate của chính
WO đó (hàng `blocked` nay hiện trong màn admin với tốc độ sinh do kẻ tấn công điều khiển) ⇒ `S3` 18 → **19**.
⇒ `S3` **18 → 19**: đóng 1, mở 2. Phân loại cho đúng, đừng gộp: **KI-047 là lỗ CÓ SẴN** (4 đường 429 chưa
bao giờ ghi `login_logs`), chỉ lộ ra khi khoanh ranh giới. **KI-048 thì KHÁC — nó là hệ quả DO chính bản
vá này tạo ra**: hàng `blocked` chuyển từ vô hình sang hiện trong màn admin, nên nhiễu do kẻ tấn công sinh
ra cũng hiện theo. Không phải rò rỉ, delta dung lượng = 0 (những dòng đó vốn đã ghi), nhưng nói "không
phải hồi quy" thì sai — đúng hơn: **cái giá đã biết của việc lấy lại tầm nhìn**, chấp nhận có ghi nhận.

> ✅ **KHÔNG CÒN `S0` MỞ (2026-07-28, sau `S6-SEC-ROTATE-1`).** KI-043 mở và đóng trong cùng ngày:
> mật khẩu 5 role đã rotate, nguồn tái nhiễm (`m roles`) đã cắt, 5 cổng hạ tầng đã về `127.0.0.1`, và
> literal cũ được chứng minh **hết hiệu lực khi thử TỪ HOST** — kèm ca đối chứng mật khẩu-bậy để loại
> khả năng `trust`. Hết chặn go-live theo `RELEASE-05` §5.3.
>
> ⚠️ **Nợ còn lại (KHÔNG chặn go-live, chưa có KI riêng):** literal cũ **vẫn nằm trong git history** vì
> quyết định không history-rewrite. Sau rotate chúng vô hiệu, nhưng bất kỳ ai đọc lịch sử vẫn thấy
> *hình dạng* cấu hình cũ. Nếu về sau repo chuyển private hoặc có audit ngoài, cân nhắc lại.
>
> ~~✅ **KHÔNG CÒN `S0` MỞ (2026-07-27) — đã verify trực tiếp trên PROD.**~~
> Ba lỗ `S0` do FULL gate của `S6-SEC-1` tìm ra đều đóng:
>
> | | Đóng bằng | Verify trên PROD (read-only) |
> | --- | --- | --- |
> | KI-028 | ⟲ **đóng lại 2026-07-28** bằng `S6-SEC-DBFENCE-1` (hàng rào 3 lớp + `scripts/s6-dbfence-purge-test-tenants.sql`). Bản 27/7 (`s6sec1-contain-test-tenants.sql`) chỉ phủ 16/74 và **không bịt nguồn rò** | company khớp mẫu test = **0**/1 · user test active = **0** · grant `platform-admin` = **0** · `funtime` **46 (35/11)** · `check-prod-test-tenants.mjs` exit **0** · suite 449 file không `LANE_DB` ⇒ **0** company mới |
> | KI-032 | mig `0530` | policy `…no_delete_system` `cmd=d`/`permissive=f` · grant `roles` hết `DELETE` |
> | KI-038 | mig `0531` | 2 trigger `enforce_company_id_immutable` trên `notification_%`, `tgenabled='O'` (đang hoạt động, không phải chỉ tồn tại) |
>
> Chi tiết: `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §0.1 · §7d · §7e.

~~Không có defect sản phẩm mức S0/S1 nào đang mở.~~ — **câu này đúng tới trước FULL gate 2026-07-26,
nay KHÔNG còn đúng** (xem trên). KI-001/KI-002 **đã đóng**; KI-006 hạ xuống S3 (chỉ còn bước cấu hình
token + deploy). Giữ nguyên số hiệu KI để tài liệu khác trỏ tới không bị gãy.

> **Ngưỡng RC** (`RELEASE-05` §5.3) cho phép **≤3** mục S2 mở, mỗi mục có owner + workaround. Hiện
> **7** (KI-014 đã đóng 2026-07-27) ⇒ trước khi tạo RC vẫn phải đóng bớt hoặc owner ký waiver tường
> minh cho phần vượt. Hai mục còn nằm trong tầm đóng ở Sprint 6: **KI-008** (diễn tập restore —
> `S6-PERF-DB-1`) · **KI-016** (tách `dist` — cần mở `S6-OPS-DISTSPLIT-1`).
> **KI-030 đã đóng 2026-07-27** (`S6-SEC-ORG-1` — gate `read:user` + `read:team`); nó **không** nằm
> trong con số 7 nên ngưỡng RC giữ nguyên.
>
> ⚠️ **Lệch số có từ TRƯỚC WO này, không phải do nó gây ra:** bảng đếm ở trên ghi `S2 = 9 mở` trong
> khi khối ngưỡng RC ghi `8` (khối RC không tính **KI-028**, vốn đã đóng nhưng vẫn nằm trong danh
> sách "trong tầm đóng"). `S6-QA-CHUNK-1` chỉ trừ **KI-014** khỏi cả hai (9→8 và 8→7) và **giữ
> nguyên** chênh lệch cũ thay vì sửa lén cho khớp — việc rà lại thuộc `S6-REL-1` (bug scrub trước RC).
>
> **Và một mục `S1` mới: KI-027.** Không chặn RC theo chữ nghĩa của `RELEASE-05` §5.3, nhưng **nên
> đóng trước go-live** — thao tác ~10 phút của owner, không cần sửa code (thứ tự bắt buộc ở
> `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §6.1: **enroll 2FA TRƯỚC, bật cờ SAU** — làm ngược
> là tự khoá mình ra khỏi hệ thống).
---

## 2. Chi tiết

### KI-001 — Tài khoản UAT chưa gắn hồ sơ nhân viên · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** tạo `UAT-EMP-01` (phòng Nội Dung, quản lý trực tiếp = `uat.manager`) · `UAT-MGR-01` ·
> `UAT-HR-01` (phòng Nhân Sự) trong `mediaos_dev`, set **cả** `direct_manager_id` **lẫn**
> `employee_manager_relations`. Bơm bằng SQL idempotent ⇒ **không có vết `audit_logs`** (đánh đổi đã
> ghi rõ ở `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §0).

**Kiểm chứng:** `SELECT u.email, e.employee_code FROM users u LEFT JOIN employee_profiles e ON e.user_id=u.id …`
→ cả 4 tài khoản `uat.*` trả `NULL`.
**Hệ quả:** `GET /attendance/today` trả rỗng kèm thông báo "chưa có hồ sơ"; `POST /attendance/check-in`
→ **403** (`attendance.service.ts:362-363`). Kéo theo chấm công · nghỉ phép · bảng công cá nhân · widget
Employee đều không chạy được.
**Workaround:** `/hr/employees` → tạo/chọn hồ sơ → **Liên kết tài khoản**; rồi `/hr/org-chart` đặt
`uat.manager` làm quản lý trực tiếp của `uat.employee`.

### KI-002 — Chưa có số dư phép · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** số dư 2026 — `uat.employee` ANNUAL 12 + SICK 5 · `uat.manager` ANNUAL 12
> (`remaining_days` là cột GENERATED `total_days - used_days`, không ghi tay).

**Kiểm chứng:** `SELECT count(*) FROM leave_balances` → **0**. `leave_types` `ANNUAL`/`SICK`/`COMPENSATORY`
có `deduct_balance = true`, `allow_negative_balance` NULL.
**Hệ quả:** tạo đơn nghỉ loại trừ phép → **422** "Số dư phép không đủ" (`leave-request.service.ts:545-552`).
**Workaround:** `/leave/balances` → cấp số dư phép năm (ghi giao dịch append-only).

### KI-003 — Loại nghỉ phép trùng bản chữ thường · S3

**Kiểm chứng:** `leave_types` có cả `ANNUAL/SICK/UNPAID` (chuẩn) lẫn `annual/sick/unpaid` (`deduct_balance`
NULL) → 11 dòng.
**Hệ quả:** danh sách chọn loại nghỉ hiện lặp; chọn nhầm bản chữ thường thì **không trừ phép**.
**Workaround:** xoá mềm 3 bản chữ thường ở `/leave/types` sau khi xác nhận không đơn nào tham chiếu.

### KI-004 — Chưa nhập ngày lễ · S3

`SELECT count(*) FROM public_holidays` → **0**. Số ngày nghỉ tính không trừ ngày lễ.
**Workaround:** `/system/public-holidays` nhập lịch lễ trước khi tính công/phép cho kỳ thật.

### KI-005 — Widget "Thông báo" trễ trong TTL · S3

Widget `NOTIFICATIONS` **không tự vô hiệu cache** khi có thông báo mới ⇒ số liệu cũ trong TTL ~10s rồi
tự lành. Đã có test khoá hành vi này: `qa2-e2e-task-noti-dash.int-spec.ts` (ca E3 — "known-issue
QA2-HIGH-001"). Chuông thông báo (không qua widget) **không** bị ảnh hưởng.

### KI-006 — LMS→NOTI chưa hoạt động · S2 → S3 (một nửa đã đóng 2026-07-26)

> **Đã đóng phần migration:** `m migrate` (PROD `mediaos`) + `m dev-online-migrate` (UAT
> `mediaos_dev`) ⇒ **cả hai 197/197**, 4 mã `LMS_*` có mặt. PROD health 200 sau migrate — 0529 chỉ
> nới CHECK + INSERT catalog nên **không cần restart** service. **Còn lại:** đặt `LMS_NOTI_TOKEN`
> hai phía + deploy theo `docs/plans/S5-LMS-NOTI-2.md` §4.

**Kiểm chứng:** `mediaos_dev` **và** `mediaos` (PROD) đều áp **196/197** migration;
`SELECT event_code FROM notification_events WHERE event_code LIKE 'LMS%'` → **0 dòng** ở cả hai.
**Hệ quả:** 4 mã sự kiện `LMS_ENROLLMENT_APPROVED` · `LMS_COURSE_ASSIGNED` · `LMS_EXAM_GRADED` ·
`LMS_COURSE_DEADLINE_NEAR` chưa tồn tại ⇒ intake từ LMS sẽ **404 event không tồn tại**.
**Code đã xong cả hai phía** (`S5-LMS-NOTI-1` merged PR #291 · `S5-LMS-NOTI-2` + runbook deploy
`153e2101`); còn **thiếu bước vận hành**: (1) áp `0529`, (2) đặt `LMS_NOTI_TOKEN` vào **cả**
`.env.prod` lẫn `.env` phía MediaOS và `apps/lms/.env.production` phía LMS, (3) deploy đúng thứ tự
API → LMS.
**Workaround/cách đóng:** `m dev-online-db` (UAT) · `m prod-update` (PROD — đã ép migrate trước
restart) · làm theo `docs/plans/S5-LMS-NOTI-2.md` §4 (runbook).

### KI-007 — CI Dependency scan đỏ vì công cụ · S3

`Security` workflow: job gitleaks **xanh**, job `pnpm audit` **đỏ** với
`ERR_PNPM_AUDIT_BAD_RESPONSE` (endpoint advisory npm trả body gzip pnpm không parse được).
**Tái hiện y hệt khi chạy `pnpm audit --audit-level=high` ở local** ⇒ lỗi phía công cụ/registry, **chưa
chứng minh có lỗ hổng high/critical**. **Cảnh báo:** đừng dùng job này làm bằng chứng "sạch lỗ hổng" —
hiện nó không nói được gì cả.

### KI-008 — Chưa diễn tập khôi phục backup · S2 · ✅ ĐÃ ĐÓNG 2026-07-29 (`S6-PERF-DB-1`)

Mô tả gốc: có `scripts/backup-db.sh` + `scripts/backup-restore-drill.sh` nhưng không có biên bản drill nào.

**Đã đóng (#307, `DEVOPS-13` §3.1).** Truy ra gốc: drill **chưa từng chạy được** kể từ khi Postgres vào
container — script đòi `pg_dump`/`pg_restore`/`psql` trên PATH của host Windows (không có), fail ngay 3
dòng `command -v`. Vá bằng fallback `DRILL_PSQL`/`DRILL_PG_DUMP`/`DRILL_PG_RESTORE` qua `docker exec`,
rồi chạy thật: dump → restore DB tạm → verify chuỗi migration + schema/RLS/index → tự dọn = **PASS**.

⚠️ **Đóng KI này KHÔNG có nghĩa là "đã có backup".** Drill tự `pg_dump` tại chỗ; việc chưa hề có bản
backup định kỳ nào trên máy PROD là vấn đề RIÊNG — **KI-050** (mở 2026-07-30).

### KI-009 / KI-010 / KI-011 — 3 khuyến nghị treo từ S5-PERF-1

Nguyên văn `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` §4.2: R1 log JSON có cấu trúc ·
R2 phân trang thật cho `GET /employees` (hiện chặn bằng cap **2000 dòng**, có warn-log khi chạm cap —
không cắt câm) · R3 cảnh báo tự động. **KI-011 là điều kiện go-live**, hai cái kia không.

### KI-012 / KI-013 — 2 quyết định bảo mật cần đóng sổ

- **D3 (KI-012):** widget `hr-overview` count-only, đã mask PII, gate bằng **quyền widget** chứ không
  theo data-scope ⇒ HR được cấp scope Department vẫn thấy **con số** headcount toàn công ty. Không lộ
  PII cá nhân. **Cần owner ký chấp nhận cho MVP** (`RELEASE-04` §3).
- **D1 (KI-013):** `refresh` không throttle nhưng có reuse-detection + `FOR UPDATE`; `resetPassword`
  không throttle nhưng token entropy cao, lưu hash, dùng-một-lần, hết hạn ngắn. Kết luận: giữ nguyên,
  không thêm throttle suy đoán vào `auth.service.ts` (crown).

### KI-014 — Suite API crash khi chạy 1 tiến trình · S2 (hạ tầng test) — ✔ ĐÃ ĐÓNG 2026-07-27

> **ĐÓNG bởi `S6-QA-CHUNK-1`.** Phần mô tả bên dưới giữ nguyên làm lịch sử; **hai câu quy kết
> "bất ổn native của máy" và "chia chunk là workaround duy nhất" nay đã bị số đo bác bỏ** — xem
> khối *Kết quả truy gốc* ngay sau đó.

Chạy cả `@mediaos/api` một lần → `Unhandled Rejection: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`,
**0 ca test đỏ**, suite chết giữa chừng. `--no-file-parallelism` **không** cứu được (chết ở file thứ 61).
**Workaround duy nhất đang có: chia chunk** (6 lệnh vitest × ~75 file → 445 file / 7.113 test, 0 fail).
**Vì sao là S2:** nó làm `check.sh` in ĐỎ khi thực chất xanh ⇒ dễ dẫn tới bỏ qua đỏ THẬT.

**Cập nhật 2026-07-26 (`S6-STAB-1` — 2 đính chính, chi tiết `RELEASE-06` §4.4):**

1. **Không riêng API.** `@mediaos/app` cũng chết y hệt (`ERR_IPC_CHANNEL_CLOSED`; qua pnpm còn thấy
   exit `3221225477` = `0xC0000005` ACCESS_VIOLATION). Chia nhỏ → **199/199 file spec xanh**. Crash phụ
   thuộc **kích thước chunk**, không gắn với file nào: gộp `routes/{tasks,hr,goals}` (64 file) chết,
   tách từng cái thì xanh.
2. **CI KHÔNG dính — đây là chuyện máy local Windows.** CI chạy `ubuntu-latest`: `ci.yml:140` gọi
   `pnpm test` toàn workspace **một lần**, `apps-frontend.yml:95` chạy từng app; cả `CI` · `API — CI` ·
   `Apps — Frontend CI` đều **success** trên `dcf85eb0`. `api.yml` cũng đã set `LANE_DB: mediaos` ở
   bước Test (từ 2026-07-10) ⇒ deny-path/IDOR **có chạy thật** trong CI.

⇒ **Hạ "chặn go-live" từ ⚠️ xuống ❌**: không chặn release (CI vẫn là cổng thật). Cái nó chặn là **cổng
verify local** — `harness/check.sh` mọi tier không thể xanh trên máy Windows này.

#### Kết quả truy gốc 2026-07-27 (`S6-QA-CHUNK-1`) — ĐÓNG

Số đo đầy đủ (ma trận pool · maxForks · isolate · tầng gọi · Node 22 vs 24, mỗi ô 3 lần chạy):
**`docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md`**.

**Gốc:** `tinypool@1.1.1` — `ProcessWorker.send()` chỉ chặn `if (!this.isTerminating)`, **không** kiểm
tra kênh IPC đã đóng. Worker fork thoát ngoài dự kiến ⇒ message birpc còn trong hàng đợi MessagePort
vẫn bị đẩy vào `process.send()` của tiến trình chết ⇒ `ERR_IPC_CHANNEL_CLOSED` nổ ở **tiến trình
chính** ⇒ vitest tính Unhandled Rejection ⇒ cả run ĐỎ dù 0 test sai.

**Ba đính chính so với mô tả ở trên:**

1. **KHÔNG phải "bất ổn native của máy" (nghi RAM/XMP).** `pnpm test` đỏ **5/5 lần** — tái hiện 100%.
2. **KHÔNG phải kích thước chunk hay file thủ phạm.** Package nạn nhân **đổi ngẫu nhiên mỗi lần**:
   `console` (23 file) · `api` · `app` · `web-core` (39 file). Suite nhỏ cũng chết.
3. **KHÔNG phải lệch runtime Node 24-local vs Node 22-CI.** Chạy lại bằng đúng Node 22.23.1 của CI:
   **vẫn crash**. CI xanh vì runner ubuntu chỉ 2–4 nhân ⇒ vitest sinh 1–3 worker; máy dev 32 nhân sinh
   **31 worker/package** ⇒ trúng đua liên tục.

**Cũng bác bỏ "chia chunk là workaround duy nhất":** hạ trần `maxForks` cứu được `@mediaos/app`
(3/3 xanh ở 16) nhưng **không** cứu `@mediaos/api` ở bất kỳ trần nào; `--pool=threads` **tệ hơn**
(SIGSEGV 139); `--no-isolate` sinh test đỏ thật.

**Vá:** `harness/chunk-test.mjs` — chia chunk (≤40 file/tiến trình) + hạ trần worker (8) + **chạy lại
chỉ chunk chết vì hạ tầng**. Luật chạy-lại an toàn vì đo được **27/27 lần crash đều có 0 test đỏ**;
có test đỏ ⇒ cấm chạy lại. Runner đối chiếu số file với `vitest list` (thiếu file ⇒ ĐỎ) và **công bố**
6 file `exclude` của `apps/api/vitest.config.ts`. `check.sh` dùng runner **chỉ trên Windows**; CI
ubuntu giữ nguyên `pnpm test` một lần.

**Verify (điều kiện đóng WO):** `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **XANH**
(lint ✅ typecheck ✅ test ✅ build ✅, 4m32s) — lần đầu `check.sh` xanh thật trên máy Windows này.
Phủ **761/761 file spec** toàn workspace (api 448 · app 199 · console 23 · web-core 39 · contracts 32 ·
ui 16 · auth 4). `lane-db-guard` vẫn bắt được thiếu `LANE_DB` qua runner mới (184 file skip → `red` ở
tier `--all`); `harness/lane-db-guard.test.mjs` 14/14.

### KI-015 — Nhiễu log outbox bridge trong test · S3

`OutboxNotificationBridge … intake THẤT BẠI` (6 lần trên lane sạch). Truy tới gốc: nhánh `no_recipient`
→ `recordSkip` → INSERT `audit_logs` vỡ **FK `audit_logs_actor_user_id_fkey`** vì outbox drain chạy sau
khi spec đã dọn user của mình. **Production không dính** (user là xoá mềm — BẤT BIẾN #2).
**Việc:** đợi outbox drain xong trước teardown, hoặc bỏ `actorUserId` khỏi audit skip.

### KI-016 — PROD dùng chung `dist` với dev-online · S2

Service PROD `MediaOS-API` chạy thẳng `apps/api/dist/main` của repo dev. Cả `m dev-online` lẫn
`m dev-online-fast` đều biên dịch lại thư mục đó ⇒ bật môi trường UAT có thể làm PROD nạp binary mới
trong khi DB PROD chưa áp migration tương ứng (đã từng gây PROD login 500 ngày 2026-07-08).
**Việc (go-live blocker):** cấp thư mục build riêng cho PROD.

### KI-017 — Refresh MV dashboard qua workerDb hỏng từ G14 · S3

`dashboard-refresh.service.ts:19-22` ghi rõ: REFRESH đòi role **owner** của materialized view (=`mediaos`),
nhưng `refreshDb` ưu tiên `workerDb` (`mediaos_worker`) ⇒ đường refresh runtime fail "must be owner" ở
mọi môi trường có `DATABASE_WORKER_URL`. Hiện **chưa consumer nào gọi tới** nên không lộ ra người dùng.
**Cấm sửa nhanh bằng `ALTER OWNER` cho worker** — worker không BYPASSRLS + `tasks` FORCE RLS ⇒ MV sẽ
**rỗng lặng lẽ**, tệ hơn lỗi hiện tại.

### KI-018 / KI-019 / KI-020 — 3 khoảng trống dữ liệu demo · S3

Trạng thái đơn nghỉ lẫn hoa/thường (`Pending` 1 · `pending` 2 · `approved` 1 · `Draft` 1) · chỉ 1 ca +
1 quy tắc chấm công + 0 phân ca (có fallback nên không chặn) · `goals` = 0.

### KI-021 — 3 sự kiện NOTI của ATT không có producer · S2 · phát hiện 2026-07-26 (`S6-STAB-1`)

`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED` được seed `isEnabled: true` trong
`notification-event-catalog.const.ts:82-84`, nhưng **không có nơi nào phát chúng** — toàn hệ chỉ đăng ký
**3** `@SystemJobHandler` (dọn file tạm · dọn theo chính sách lưu trữ · dọn `system_job_runs`), **không
có job ATT cuối ngày**. Chính code cũng ghi nhận: `dashboard-cache-invalidation.const.ts:43` — *"KHÔNG
có producer nào"*.

**Hệ quả:** người dùng bật/tắt được 3 loại thông báo không bao giờ tới; admin thấy chúng trong danh mục
sự kiện. **KHÔNG sai dữ liệu** — cờ `is_missing_check_out` đặt **đồng bộ** ngay lúc check-in/check-out
(`attendance.builders.ts:63,104`), không chờ job. **Workaround:** đơn điều chỉnh công
(`MISSING_CHECK_OUT`) đã chạy được.

**Defer** vì làm job mới là **tính năng**, bị `RELEASE-05` §4.2 từ chối sau freeze. Sau MVP chọn một
trong hai: build job ATT cuối ngày, **hoặc** đặt `isEnabled: false` cho 3 mã để UI không hứa cái không
có — đúng mẫu `ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER` đang dùng. Chi tiết: `RELEASE-06` §4.1.

### KI-022 / KI-023 — 2 nguồn ĐỎ-GIẢ trong suite · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-STAB-1`)

Cả hai đều **không phải lỗi sản phẩm**, nhưng làm suite đỏ **ngẫu nhiên** rồi xanh lại khi chạy đơn lẻ —
dạng nguy hiểm nhất vì dẫn tới thói quen "chạy lại cho xanh".

- **KI-022:** `outboxOf` trong `goal-be2-link.int-spec` truy vấn `outbox_events` **không lọc
  `company_id`** ⇒ đếm cả sự kiện của spec chạy song song. Đây là chỗ **duy nhất** sót; mọi spec outbox
  khác đã lọc.
- **KI-023:** `cleanupTenants` quét lại `audit_logs` trước `DELETE users` nhưng **không** trước
  `DELETE companies` ⇒ outbox worker còn sống ghi thêm audit trong cửa sổ đó làm vỡ FK
  `audit_logs_company_id_fkey`.

Verify: chạy lại **nguyên chunk `f–l`** (tái tạo đúng điều kiện tranh chấp) → **44/44 file ·
1.022/1.022 test xanh**. Chi tiết: `RELEASE-06` §4.2/§4.3.

### KI-024 — `foundation-audit.e2e-spec` đỏ-giả **vĩnh viễn** · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

Cùng họ với KI-022/023 nhưng **nặng hơn**: nó **không** tự khỏi khi chạy lại. `ACTION_A`/`ACTION_B` là
hằng cố định (`BE3SecretLeakA/B`) trong khi case `3f` đọc ở **System scope** (chéo tenant, RLS không
khoanh) và assert `length === 1`. `audit_logs` **append-only** ⇒ chỉ cần một lần chạy bị ngắt (Ctrl-C
hoặc crash worker KI-014) là hàng của lần đó nằm lại DB lane **vĩnh viễn**, mọi lần sau đếm ra 2 → đỏ.

Fix: gắn `RUN_TAG = randomUUID().slice(0,8)` vào `action`, đúng idiom sẵn có
(`audit-permission-deny.int-spec.ts:66`). Verify: chạy file đó **2 lần liên tiếp không dọn gì ở giữa** →
8/8 xanh cả hai lần, `count(*) … LIKE 'BE3SecretLeak%'` = 0. Chi tiết: `S6-QA-FINAL-1-FINAL-QA-PASS` §8.1.

### KI-025 — 98/346 đường dẫn API không có test HTTP nào chạm · S2 · phát hiện 2026-07-26 (`S6-QA-FINAL-1`)

**Đo, không phải ước lượng:** 452 route thật (decorator NestJS) / 346 đường dẫn phân biệt, đối chiếu với
mọi URL literal trong 446 file spec ⇒ **72% đường dẫn có test chạm, 28% không**.

**Rủi ro thật là gì:** guard · `ZodValidationPipe` · response envelope của các route đó **chưa từng chạy
trong test**. Hai bề mặt nghiệp vụ thật nằm trong nhóm này — `user-invites` (`/users/invite`,
`/users/pending`, `/users/:id/approve|reject|suspend|reactivate`) và `POST/GET /hr/profile-change-requests`
— đều được test **rất kỹ ở tầng service** (`new UserInvitesService(...)`, `profile-change-request.int-spec`)
nên nhìn bảng coverage sẽ tưởng đã phủ.

**Rủi ro KHÔNG phải là gì:** không phải "route bỏ ngỏ quyền". Trong 134 route chưa-test chỉ **9** route
vừa thiếu `@RequirePermission` vừa thiếu `@Public()`, và đều thuộc nhóm self-scoped có chủ đích
(`/auth/2fa/*`, `/auth/sessions/*`, `/me/*`) hoặc module CONTENT đã park — nhóm sau đã bị
`route-guard-coverage.e2e-spec.ts` chặn hồi quy.

**Workaround:** sweep tĩnh `route-guard-coverage.e2e-spec.ts` bắt được route MỚI quên gate.
**Chủ:** Sau MVP (thêm test = việc mới, `RELEASE-05` §4.2 chặn sau freeze).
**Bàn giao:** phán quyết từng dòng trong 35 route không-`@RequirePermission` thuộc `S6-SEC-1` (WS4 §13.2).

### KI-026 — Nhãn `[BLOCKED]` trên test ĐANG XANH · S3 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

`attendance-adjustment.int.spec.ts` mang 9 dòng chú thích "KNOWN BROKEN" + tên test
`… → 200 [BLOCKED — see comment above, service.ts bug]`, mô tả `detailInScope()` hard-code
`orgUnitId/directManagerUserId = null`. **Bug đã sửa trong CHÍNH commit đưa test vào** (`80a1bcd5`,
PR #81, 2026-07-02 — `detailInScope()` nạp employee thật qua `resolveRequestEmployee()`); chú thích
không được gỡ. Test XANH suốt từ đó.

Không phải defect, nhưng đủ để làm người đọc kết luận sai là ATT còn lỗi mở — đúng lớp rủi ro mà
`RELEASE-06` §1 cảnh báo, chỉ theo chiều ngược lại: **"code đọc có vẻ hỏng" cũng không phải bằng chứng**.
Fix: thay bằng ghi chú lịch sử + bỏ nhãn.

### KI-027 — 2FA không được ép ở PROD cho company-admin · **S1** · phát hiện 2026-07-26 (`S6-SEC-1`)

**Kiểm chứng (truy vấn read-only trên PROD `mediaos`):** `roles` có `requires_two_factor = true` cho
**`company-admin`** và **`platform-admin`**. Nhưng **cả ba lớp ép đều tắt**: (1) `.env` **và**
`.env.prod` đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=false` (schema default là `"true"`);
(2) `company_security_policies.two_factor_enforced = NULL` cho `funtime`; (3) user
`admin@funtimemediacorp.com` có `require_two_factor = false`.

Guard tính `effective2FA = globalEnv || policy.two_factor_enforced` ⇒ global OFF thì **chỉ** ép khi
công ty tự bật; công ty không bật ⇒ **không ép ai**.

**Hệ quả:** tài khoản quản trị công ty **duy nhất** của production (quản lý user · vai trò · quyền ·
nhật ký audit) vào được **chỉ bằng mật khẩu**.
**KHÔNG phải:** không phải bypass đăng nhập — ai **đã** enroll TOTP vẫn bị challenge. Vấn đề là
**không ai bị bắt buộc enroll**.
**Cách đóng (thứ tự BẮT BUỘC):** admin enroll 2FA ở `/me/security` → đặt cờ `=true` ở **cả** `.env`
lẫn `.env.prod` (nhớ `m prod-env` ghi đè `.env.prod`) → restart API → smoke login. **Đảo thứ tự = admin
ăn 403 `TWO_FACTOR_SETUP_REQUIRED` trên mọi route.**

### KI-028 — tenant TEST + user còn sống trong DB PROD · **ĐÓNG 2026-07-28** · S1 · (`S6-SEC-1` → `S6-SEC-DBFENCE-1`)

> **ĐO LẠI 2026-07-28 (read-only trên PROD `mediaos`) — con số của lần đóng đã sai.**
>
> | Số | 2026-07-26 (lúc phát hiện) | 2026-07-27 (lúc tuyên bố đóng) | **2026-07-28 (đo lại)** | **2026-07-28 SAU purge** |
> | --- | --- | --- | --- | --- |
> | company khớp mẫu test | 16 | 0 còn phải xử lý | **74** (16 tạo 24/7 + **58 tạo 26/7**), 0 soft-delete | **0** |
> | user test `active` | 25 | **0** | **226** | **0** |
> | trong đó hash argon2/bcrypt THẬT (đăng nhập được) | — | — | **55** | **0** |
> | giữ role TOÀN CỤC | 3 `platform-admin` | **0** | **33** (23 `company-admin` · 5 `platform-admin` · 5 `employee`) | **0** |
> | **giao: đăng nhập được VÀ role toàn cục** | — | — | **18** (13 `company-admin` + **5 `platform-admin`**) | **0** |
> | `funtime` (không được chạm) | 46 | 46 | 46 (35 active + 11 locked) | **46 (35 + 11)** |
>
> **Đóng bằng gì (2026-07-28, `S6-SEC-DBFENCE-1`).** Khác lần trước ở chỗ **bịt nguồn rò TRƯỚC, purge
> SAU, và để lại một chốt hồi quy** — xem dòng KI-028 ở bảng đầu tài liệu cho toàn bộ số đo. Ba điểm
> đáng nhớ nhất:
>
> 1. **`LANE_DB` chưa bao giờ là thuộc tính an toàn.** Truy nguyên 72/74 company về đúng spec sinh ra
>    chúng cho thấy **14 company đến từ spec ĐÃ gate `LANE_DB`** — connection vẫn về `mediaos` do
>    `DATABASE_URL` tường minh thắng precedence (hoặc `LANE_DB=mediaos` chép từ CI). Chỉ **TÊN DB
>    ĐÍCH** mới là thuộc tính an toàn ⇒ hàng rào chốt ở đó, không chốt ở "có LANE_DB hay không".
> 2. **Vá ở resolver, không vá 56 file spec.** 63/266 file gate thiếu `LANE_DB` (56 file có tạo
>    company). Vá từng file là mời file thứ 57; hàng rào đặt ở `test/db-target.ts` +
>    `test/global-setup.ts` phủ cả 266 file tại MỘT chỗ.
> 3. **Vector thứ ba chỉ lộ ra sau khi bịt hai vector đầu:** `src/db/check.ts` chạy `main()` ở
>    top-level, `check.spec.ts` import nó ⇒ **mỗi lần chạy unit test là một lần `migrate()` trên DB
>    PROD**. Không ai thấy suốt thời gian dài vì `DATABASE_DIRECT_URL` luôn được điền ngầm.
>
> **Vì sao lệch:** containment `scripts/s6sec1-contain-test-tenants.sql` chạy đúng trên **tập đã đo**
> (16 company của 24/7). 58 company + 201 user tạo ngày **26/7** chưa từng vào phép đo nên script
> không chạm tới — cả hai câu verify ("user test còn active = 0", "operator-grant ngoài funtime = 0")
> đều đúng **trên tập được hỏi**, và sai trên thực tế. Đây là lớp lỗi "số đo tay trong WO có thể
> thiếu", không phải script chạy hỏng.
>
> **Nguồn rò CHƯA bịt (mới truy được):** `apps/api/vitest.config.ts:11` — `const db = process.env.LANE_DB ?? "mediaos"`.
> Thiếu `LANE_DB`, integration spec trỏ thẳng **DB PROD**. Phần lớn int-spec gate `hasDb && LANE_DB`
> nên tự skip, nhưng spec chỉ gate `hasDb` (vd `test/integration/tenant-isolation.int-spec.ts:12`
> `describe.skipIf(!hasDb)`) VẪN chạy và seed company/user thật. Run chết giữa chừng (KI-014, từng
> 100% trên Windows) bỏ luôn `afterAll` → `cleanupTenants` không chạy ⇒ rác tích lại mỗi lần chạy.
>
> **Giảm nhẹ (đo được, không phải suy đoán):** email seed mang hậu tố ngẫu nhiên mỗi lần chạy
> (`au-admin-5688f84d@…`) — **không** có trong repo, nên không đoán được từ bên ngoài dù mật khẩu là
> literal công khai. `funtime` nguyên vẹn: 46 user (35 `active` + 11 `locked`), không dấu hiệu chạm
> chéo tenant. RLS vẫn giữ ranh giới đọc.
>
> **Thứ tự bắt buộc khi đóng:** bịt nguồn rò TRƯỚC, purge SAU. Purge trước = rác mọc lại ở lần chạy
> test kế tiếp — đúng cái đã xảy ra giữa 24/7 và 26/7.

**Kiểm chứng (bản gốc 2026-07-26):** `select count(*) from companies` → **17**; khớp mẫu tenant test
`slug ~ '-[0-9a-f]{8}$'` → **16**; công ty thật duy nhất **`funtime`**. User thuộc 16 tenant đó: **25**.
**Hệ quả:** tài khoản **đăng nhập được** trong DB production với mật khẩu seed test.
**Giới hạn thiệt hại:** RLS giữ — phiên đó bị khoá trong tenant test của nó, **không** thấy dữ liệu
`funtime`; leo thang chéo tenant đã bị chặn (`rbac-operator-escalation.int-spec:92`).
**Lưu ý:** tái diễn lớp sự cố đã dọn 2026-07-22 (122 công ty test lọt PROD) ⇒ **nguồn rò chưa bịt**.
**Workaround/cách đóng:** xoá 16 tenant test + chặn test trỏ DB `mediaos`. Gợi ý gộp vào `S6-PERF-DB-1`.

### KI-029 — `PERMISSION_GUARD_ENABLED`: kill-switch fail-OPEN không validate · S2 · ✅ ĐÃ ĐÓNG 2026-07-28 (`S6-SEC-1`)

`permission.guard.ts:57-68` đọc thẳng `process.env['PERMISSION_GUARD_ENABLED']`; `=== 'false'` ⇒
`return true` cho **mọi** route đã gate, chỉ để lại một dòng `logger.warn`. Biến **không** có trong
`env.schema.ts` lẫn `.env.example` ⇒ zod không validate, không ai biết nó tồn tại.
**Đã kiểm:** `.env` và `.env.prod` **không** chứa biến này ⇒ guard đang BẬT ở PROD.
**ĐÃ VÁ** (owner duyệt đổi hành vi sau freeze): `env.schema.ts:86` khai
`PERMISSION_GUARD_ENABLED: z.enum(["true","false"]).default("true")` + fail-loud lúc boot khi
`NODE_ENV=production` mà cờ `false`; chốt hồi quy ở `env.schema.spec.ts:168-203`.
*(Mục này từng bị bỏ quên ở lần cập nhật trước — bảng §1 đã ghi ĐÓNG trong khi đoạn văn này vẫn để
nguyên chữ "đề xuất", và §3 vẫn đếm KI-029 là mở. Sửa cả ba nơi 2026-07-30, `S6-REL-1`.)*

### KI-030 — `GET /org/employees` trả danh bạ toàn tenant · S2 · ✅ ĐÃ ĐÓNG 2026-07-27 (`S6-SEC-ORG-1`)

> **Đã đóng.** Cả 3 route nay mang `@UseGuards(PermissionGuard)` + `@RequirePermission`:
> `read:user` cho `/org/employees`; `read:team` cho `/org/teams` + `/org/teams/:id/members`.
> Cặp quyền lấy từ seed CÓ THẬT (`0005_permissions.sql:200,205`) — **0 migration, 0 grant mới**.
>
> | Bằng chứng | Chi tiết |
> | --- | --- |
> | RED trước | `test/integration/org-directory-permission.int-spec.ts` chạy trên code CHƯA vá: **3 failed \| 4 passed** — `expected [200,200,200] to equal [403,403,403]` |
> | GREEN sau | cùng file, **7/7 passed** (deny 3 ca · allow 2 ca · chống-siết-quá-tay 1 ca · cô lập tenant 1 ca) |
> | Lưới census | `route-guard-coverage.e2e-spec.ts` **9/9**; artifact `_review/S6-SEC-ROUTEMAP-1-route-census.json` regen: `GAP 3 → 0`, ungated `43 → 40`, `FROZEN_GAPS = []` |
> | FE | `apps/console` **23/23**; tab Đơn vị bỏ được truy vấn `/org/employees` chết (chỉ đổ vào `<span hidden>`) |
>
> **Ai mất quyền đọc (đo trên PROD `funtime`, 46 user, 2026-07-27):** `46 → 6`. Sáu người còn lại
> giữ role `SA`/`company-admin` (`data_scope = Company`). **40 user chỉ có role `employee` mất quyền
> đọc 3 route này** — đúng chủ đích, và cả 3 chỉ có caller ở `apps/console` (màn quản trị).
> **KHÔNG backfill grant nào** — thêm `read:user` cho `employee` là mở lại chính lỗ vừa vá.
>
> **FULL gate (2026-07-27) — 4 reviewer, tất cả PASS, 0 CRITICAL, 0 HIGH.** Chạy: `security-reviewer`
> · `rls-tenant-isolation-tester` (**thay** `database-reviewer`, agent này không có trong môi trường)
> · `general-purpose` mang brief `silent-failure-hunter` (**thay** agent cùng tên, không có)
> · `completion-evaluator` (97/100). Ghi rõ việc thay thế theo tiền lệ `S6-SEC-1` §7c.
> Bằng chứng đáng kể: reviewer **tự tái lập vế RED** (tắt `PERMISSION_GUARD_ENABLED`) ra log trùng
> từng chữ; normalize-diff chứng minh churn prettier không giấu logic; probe 2-tenant ở tầng SQL
> (`SET LOCAL ROLE mediaos_app`, ROLLBACK) cho **0 rò** kể cả khi gỡ vị từ `company_id` của repo.
> **Đã vá ngay trong WO theo yêu cầu gate:** ô chọn người rỗng không lời giải thích · lỗi tải hiện
> cùng "chưa có nhóm nào" · 4 khẳng định test lỏng · ghim `data_scope` · sửa chữ ký `TENANT_READ`.
>
> ⚠️ **Việc kế tiếp (chưa có WO)** — đầy đủ ở `docs/plans/S6-SEC-ORG-1.md` §7 (N-1…N-8). Hai mục đáng
> chú ý nhất:
>
> - **Lệch cặp quyền ở BA role**, không chỉ một: `hr-manager` (…009) thiếu `read:user`; `hr` (…011)
>   có `view:user` nhưng thiếu cả `read:user` lẫn `read:team`; `manager` (…010) thiếu cả ba. Gốc rễ
>   là **tách từ vựng** `read:user` (legacy) vs `view:user` (canonical §13, mig `0444`) — WO sau phải
>   chốt MỘT động từ. Cả ba hiện **0 user** ở PROD ⇒ không ảnh hưởng sống. Sửa cần migration, nằm
>   ngoài `paths` của `S6-SEC-ORG-1`.
> - 🔴 **MỞ 2026-07-28 — N-1c: cùng lỗ, cửa bên cạnh.** FULL gate của `S6-SEC-ORGSCOPE-1` phát hiện
>   độc lập bởi 2/3 reviewer: `GET /org/teams/:id/members` trả `userEmail` + `userFullName`, gate
>   **chỉ** cặp `read:team`, **không** resolve `data_scope`. Gốc rễ chung: `PermissionGuard` **không
>   đọc `data_scope` một lần nào** (grep `dataScope` trong `permission.guard.ts` = 0 hit), còn ceiling
>   của role-admin chỉ chặn `System`. **Ca tái lập:** role `read:user@Own` + `read:team@Company` ⇒
>   `/org/employees` trả đúng 1 hàng (N-1 đã khoá), rồi `/org/teams` → `/org/teams/:id/members`
>   **lấy lại trọn danh bạ email**. ⇒ **Đừng đọc bảng CHỐT `/org` như "đã chốt toàn bộ"**: vế `teams`
>   chưa có scope. WO: `S6-SEC-ORGTEAMSCOPE-1` (đã seed vào `harness/backlog.mjs`, zone đỏ).
>   Mức: rls-tenant-isolation-tester chấm **HIGH**, security-reviewer chấm **MEDIUM** (không BLOCK
>   PR của N-1 vì không do nó gây ra và nằm ngoài `paths` đã khai).
> - ~~**`listEmployees` không ép `data_scope`**~~ → **ĐÓNG 2026-07-28 bởi `S6-SEC-ORGSCOPE-1`.**
>   Role tenant tự đúc với scope `Own`/`Team`/`Department` từng qua guard rồi nhận trọn danh bạ.
>   Vá bằng `DataScopeService.buildUserScopeCondition` (vị từ hình-`users`, **không** join
>   `employee_profiles` — join sẽ làm tài khoản chưa có hồ sơ rụng khỏi màn RBAC console).
>   RED→GREEN: `test/integration/org-directory-scope.int-spec.ts` **5 failed | 2 passed → 7/7**
>   (2 ca xanh từ vòng RED là chốt *chống siết quá tay*, cố ý phải xanh ở cả hai vòng).
>   `Team`/`Department` fail-closed 0 hàng — giống hệt `GET /auth/users`; chi tiết + hệ quả
>   phi-đơn-điệu ở `docs/plans/S6-SEC-ORGSCOPE-1.md` §2.1.

**Mô tả gốc** (giữ nguyên cho tài liệu khác trỏ tới không gãy):

`org.controller.ts:173` không `@RequirePermission`; `org.repository.ts:322` trả `id · email ·
fullName · status` + team membership của **mọi** user chưa xoá trong tenant, cho **mọi** user đã đăng
nhập. Lệch với `/hr/employees` vốn ép data_scope (Employee Own chỉ thấy hồ sơ mình).
**Vì sao lọt lưới:** `route-guard-coverage.e2e-spec.ts:148` lọc `httpMethod !== "GET"` ⇒ sweep tĩnh
chỉ soi mutation. ⟲ **Lưới đã vá 2026-07-27** (`S6-SEC-ROUTEMAP-1`): bộ lọc GET bị gỡ, thay bằng census
runtime + sổ phán quyết có chữ ký — route đọc mới không gate nay làm ĐỎ test thay vì đi qua im lặng.

⟲ **PHẠM VI MỞ RỘNG 1 → 3 ROUTE (census runtime 2026-07-27).** Cùng lỗ, cùng controller, cùng hạng:

| Route | Lộ gì |
| --- | --- |
| `GET /org/employees` | danh bạ tài khoản toàn tenant (id·email·fullName·status + team) |
| `GET /org/teams` | toàn bộ cơ cấu team của tenant |
| `GET /org/teams/:id/members` | **thành viên từng team** — route này chưa từng xuất hiện trong bản census tĩnh nào (bị bẫy cửa sổ decorator nuốt) |

`GET /org/units/tree` được xét cùng đợt và **KHÔNG** vào KI-030: giữ `TENANT_READ` có chữ ký vì
`apps/app` dùng ở `OrgChartPage.tsx` + `TaskSidebarTree.tsx` ⇒ siết sẽ gãy UI của mọi nhân viên.
Mức **giữ `S2`** (danh bạ/cơ cấu, không có PII hồ sơ HR). Phán quyết đầy đủ: `S6-SEC-1` §7 Phụ lục A.
**Vì sao không cao hơn:** danh bạ tài khoản, **không** phải hồ sơ HR (không lương/CCCD/công/phép);
`withTenant` + RLS giữ, không rò chéo tenant; FE chỉ gọi từ `apps/console`.
**Đường sửa đã khảo sát:** gate `read:user` — PROD đã cấp cho `company-admin`/`SA`/`project-manager`;
caller FE chỉ có 2 màn console của company-admin ⇒ siết không gãy UI.

### KI-031 — `INTERNAL_API_KEY` ngoài `env.schema`/`.env.example` · S3 · (`S6-SEC-1`)

`internal.guard.ts:23` đọc thẳng `process.env`. Guard **fail-CLOSED** (thiếu biến ⇒ 403 mọi route
`/internal/**`), nên hậu quả là **mất tính năng** (recalculate thủ công, invalidate cache), không phải
mất kiểm soát. **Đề xuất:** ghi vào `.env.example` + schema optional để lỗi hiện ra lúc boot.

### KI-050 — chưa từng có một bản backup nào trên máy PROD · **S2** · mở 2026-07-30 (`S6-REL-1`)

Phát hiện bởi chính công cụ vừa dựng trong WO này: `node scripts/ops-alert-check.mjs` trả **`unknown`**
cho luật "tuổi bản backup mới nhất" **ngay lần chạy đầu tiên** trên PROD.

**Đo được:**

- không có thư mục `backups/` ở gốc repo (`BACKUP_DIR` mặc định của `scripts/backup-db.sh`);
- `Get-ScheduledTask` không có task nào chạy `scripts/backup-db.sh` — các task tên `*Backup*` trên máy
  đều thuộc Windows/phần mềm khác.

**Đừng gộp với KI-008.** `S6-PERF-DB-1` đã chứng minh **restore drill** chạy được — nhưng drill đó tự
`pg_dump` tại chỗ rồi restore vào DB tạm. Nó trả lời câu *"khôi phục có hoạt động không"*, KHÔNG trả lời
câu *"có bản nào để khôi phục khi máy này hỏng không"*. Hai câu khác nhau; hôm nay câu thứ hai là KHÔNG.

`RELEASE-01` §7.3 tick "Script backup ✅" — đúng theo nghĩa script tồn tại, nhưng nó **chưa từng chạy**.
Lại đúng bài học `DEVOPS-13` §3.1 vừa ghi cho drill: *script tồn tại ≠ script chạy được*. Lần này bẫy
nằm ở tầng cao hơn một bậc: script đã chạy được rồi, nhưng **không ai gọi nó**.

**Chặn go-live: CÓ.** Đưa hệ thống mang dữ liệu nhân sự thật của 45 người vào vận hành mà không có bản
sao lưu nào là rủi ro mất dữ liệu không chấp nhận được.

**Vá (owner, trước go-live):**

1. Chạy tay một bản ngay: `BACKUP_DIR=./backups bash scripts/backup-db.sh`
2. Đăng ký task hằng ngày 02:00 — lệnh sẵn ở `RELEASE-09` §4
3. Verify: `node scripts/ops-alert-check.mjs` phải chuyển luật "tuổi bản backup" từ `unknown` sang `ok`

---

## 3. Cái KHÔNG được defer

| Không được defer | Lý do |
| --- | --- |
| Bug lộ dữ liệu ngoài phạm vi quyền | Vi phạm BẤT BIẾN #1 |
| Hard-delete dữ liệu nghiệp vụ / ghi đè bảng append-only | Vi phạm BẤT BIẾN #2 |
| Secret dạng plaintext trong code/log/DTO | Vi phạm BẤT BIẾN #3 |
| Migration chưa áp ở PROD khi code đã yêu cầu | Chính là KI-006 — gây 500 hàng loạt |
| Bug chặn login / phiên / phân quyền | Không dùng được hệ thống |

---

## 4. Defer list — chuyển sang sau MVP

| Hạng mục | Chuyển tới | Lý do defer |
| --- | --- | --- |
| Throttle `refresh`/`resetPassword` | Phase sau (nếu nâng threat-model) | Đã có mitigation tương đương (KI-013) |
| Count theo Department cho widget `hr-overview` | Phase sau | Count-only, không lộ PII (KI-012) |
| Log JSON có cấu trúc (R1) | Sprint 6 `DEVOPS-MON-002` | Blast radius rộng, không phải rủi ro release |
| Phân trang thật `GET /employees` (R2) | WO `HR-PAGINATE-LEGACY` | Đã có cap 2000 chặn rủi ro |
| Realtime WebSocket đầy đủ | Post-MVP | MVP dùng polling/refresh thủ công |
| Load test quy mô lớn | Release phase | MVP chỉ smoke/baseline |
| Đa công ty (SaaS) | Post-MVP | Đang chạy N=1; hạ tầng RLS giữ nguyên để mở sau |
| Module Payroll · Recruit · Asset · Room · Chat · Social · Mobile | Phase 2–5 | Ngoài phạm vi MVP theo SPEC-01 §7 |
