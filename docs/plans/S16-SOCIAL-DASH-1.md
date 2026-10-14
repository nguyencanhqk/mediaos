# S16-SOCIAL-DASH-1 — hai widget Dashboard của SOCIAL: «Tương tác tuần» (`SOCIAL-WIDGET-001`) · «Tin tức chưa đọc» (`SOCIAL-WIDGET-002`)

> **Trạng thái: plan v2 (12/10/2026) — **ĐÃ THI CÔNG + qua cổng review (sổ vết §10 · xử lý cổng §12)**; đã qua `plan-reviewer` (PASS_WITH_FIXES: 1 HIGH · 6 MEDIUM · 4 LOW, xử lý ở §11); owner chốt O1 = C2 (cắt lát hiệu năng).** Đo trên worktree `MediaOS-s19` @ `f66c94d9` (nhánh
> `feat/s16-social-dash-1`), lane DB `mediaos_dash1` (PG 17.10, đủ schema tới mig `0591`, 0 hàng nghiệp vụ). Backlog ghi
> zone 🟢 nhưng **cổng review chọn theo ĐƯỜNG DẪN** (§9): có migration + sàn scope ⇒ phần BE đi FULL. Nghiệm thu: mục
> `S16-SOCIAL-DASH-1` ở `harness/backlog.mjs:19453-19488` (2 `done_when` + 4 bàn giao trong `notes`). Khuôn thi công:
> `324ec824` (S15-PAYROLL-DASH-1). Nguồn đo: ba bản đồ U1/U2/U3 của phiên điều phối (ngoài kho) + §1.2.
> Viết tắt: `D/` = `apps/api/src/dashboard/` · `S/` = `apps/api/src/social/` · `T/` = `apps/api/test/integration/` · `H/` = `apps/api/test/helpers/` · `F/` = `apps/app/src/components/dashboard/` ·
> `$BIN` = thư mục script bọc của phiên điều phối (`…/scratchpad/dash1/bin`; đường dẫn tuyệt đối nằm trong prompt từng lát). `file:dòng` tính tại `f66c94d9`.

## 0. Hằng ĐÃ CHỐT — migration · BE · FE chép nguyên văn từ bảng này

| | `SOCIAL-WIDGET-001` | `SOCIAL-WIDGET-002` |
| --- | --- | --- |
| `widget_code` · tên | `SOCIAL_ENGAGEMENT_WEEK` · «Tương tác tuần» | `SOCIAL_NEWS_UNACKED` · «Tin tức chưa đọc» |
| slug (`data_source_key`) · `component_key` | `social-engagement-week` · `SocialEngagementWeekWidget` | `social-news-unacked` · `SocialNewsUnackedWidget` |
| `required_permission_code` | `DASH.WIDGET.VIEW_SOCIAL_ENGAGEMENT_WEEK` | `DASH.WIDGET.VIEW_SOCIAL_NEWS_UNACKED` |
| `module_code` · `widget_type` · `default_data_scope` | `SOCIAL` · `Summary` · `Department` | `SOCIAL` · `Summary` · `Own` |
| Cặp gate (mượn của route nguồn) | `view:feed-report` (route 052) | `view:feed` (route 020) |
| SÀN scope của GRANT (hằng `DASH_WIDGET_MIN_DATA_SCOPE`) | `Department` | `Company` |
| `sort_order` (cả 4 loại dashboard) | 130 | 140 |
| Nguồn | `SocialStatsService.weeklyEngagementForWidget(user)` | `SocialNewsService.list(user, { limit: 1, countOnly: true })` |
| `data` khi `Active` (đúng các khoá này) | `{ weekStart, posts, comments, reactions, activeMembers }` | `{ total }` |
| `Empty` khi | `posts + comments + reactions = 0` | `total = 0` |
| Cache | TTL **0** (không bao giờ phục vụ lại) · identity per-user | TTL **0** · identity per-user `Own` |
| FE: cổng ngoài · đích liên kết | `useCanExact(view, feed-report)` · `/feed/stats` (chỉ vẽ nút khi có thêm `view:feed`) | `useCanExact(view, feed)` · `/feed/news` |

## 1. Bối cảnh + phép đo

### 1.1 Hôm nay có gì — thiếu gì

- **Có:** hàm nguồn 001 đã viết · đã export · đã ghim census (`S/social-stats.service.ts:89-101` · `S/social.module.ts:180` · `apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts:232`); con số của 002 có sẵn ở nhánh `countOnly` của route 020 (`S/social-news.service.ts:68-77,125-127`; docblock `S/social-news.repository.ts:86-91` ghi «nguồn của widget 002»); cơ chế sàn scope hai tầng của DASH (`D/dashboard-widget-catalog.const.ts:435-487` · `D/dashboard-widget-registry.service.ts:180-242`); khuôn FE «một con số + link» và «lưới chỉ số» (`F/PayrollAdvancePendingWidget.tsx` · `F/PayrollBudgetWidget.tsx`).
- **Thiếu:** `'SOCIAL'` trong CHECK `chk_dashboard_widgets_module_code` · 2 hàng catalog · mọi hằng / handler / slug / component của hai widget · `SocialNewsService` chưa nằm trong `exports` · `DashboardModule` chưa import `SocialModule`. Nợ (c) (2 chỉ mục + viết lại câu thống kê) KHÔNG thuộc WO này: owner chốt O1 = C2, tách `S16-SOCIAL-STATSPERF-1`.

### 1.2 Phép đo (12/10/2026; «tự đo» = lệnh chạy trong lượt lập plan này)

| # | Điều | Cách đo | Kết quả |
| --- | --- | --- | --- |
| M1 | Đầu migration | `lane-psql.sh "select count(*), max(created_at) from drizzle.__drizzle_migrations"` · đuôi `apps/api/migrations/meta/_journal.json` · vòng `git ls-tree` mọi ref CỤC BỘ tìm `/0592_` | `259 · 1717587380000` · mục cuối idx 258 `0591_…` · 0 nhánh giữ `0592` (KHÔNG fetch ⇒ nhánh chỉ có trên origin: **CHƯA ĐO**, điều phối kiểm lúc mở PR) |
| M2 | CHECK phải nới | `lane-psql.sh` đọc `pg_get_constraintdef` + tách bằng `regexp_matches(def, '''([A-Z_]+)''', 'g')` | đúng **13** giá trị `ASSET,ATT,AUTH,DASH,GOAL,HR,LEAVE,NOTI,PAYROLL,RECRUIT,ROOM,SYSTEM,TASK`, dạng `ARRAY['X'::character varying,…]`; chưa có `SOCIAL` |
| M3 | Grant canonical | `lane-psql.sh` join `role_permissions × roles(company_id IS NULL) × permissions` | `view:feed` = employee · manager · hr · company-admin @Company; `view:feed-report` = manager @**Department** · hr · company-admin @Company; cả hai `is_sensitive = f`; 0 grant wildcard trên vai hệ thống |
| M4 | Cặp nền của Dashboard | cùng câu, `resource_type = 'dashboard'` | `read:dashboard` @Company (không nhạy cảm) có ở mọi vai; `view-employee:dashboard` @Own (không nhạy cảm) chỉ ở 4 vai canonical ⇒ actor tuỳ biến của test phải tự gắn 2 cặp này |
| M5 | Lane | `lane-psql.sh` đếm | 23 widget toàn cục · `max(sort_order) = 120` · 0 hàng `feed_*` · 0 công ty |
| M6 | Bề rộng cột | `information_schema.columns` của `dashboard_widgets` | `widget_code` 100 · `required_permission_code` 150 · `data_source_key` 150 · `is_system_widget` mặc định `false` (phải ghi `true` tường minh) |
| M7 | TTL 0 có chạy không | đọc `D/dashboard-widget-cache.service.ts:65-70,129-152` · `D/dashboard-widget-data.const.ts:67-69` · CHECK `chk_dashboard_widget_cache_time` (lane) | `shouldServe` loại hàng `expiresAt <= now` TRƯỚC nhánh `refresh`; `0 ?? 60 = 0`; CHECK là `expires_at >= generated_at`; `upsert` ghi đè MỘT hàng theo `(company_id, cache_key)`. Runtime **CHƯA ĐO** ⇒ ca C1 · C2 (§5.2) |
| M8 | Trần 800 dòng | `wc -l` | `D/dashboard-widget-catalog.const.ts` **783** · `D/dashboard-widget-handlers.service.ts` **771** |
| M9 | Sổ ghim sẽ đổi | đọc + grep `toHaveLength(` · `toEqual([` trên 18 int-spec `dash*` + 3 spec ngoài tiền tố có gọi route dashboard (plan-review L4 đếm lại) | CHỈ hai nơi: `apps/api/test/foundation/dashboard-scope-roundtrip.unit-spec.ts:101,109,110` (số 5) · `T/dashboard-resolver.int-spec.ts:237-245,277-290,345-354,405-414` (4 danh sách) |
| M10 | Nối module có vỡ spec nào | `git grep` | 0 spec tự lắp `DashboardModule`/`SocialModule` (đều qua `AppModule`); 0 test ghim `exports` của `SocialModule`; 0 chỗ `new DashboardWidgetHandlersService(` trong test |
| M11 | Nợ (c) — hình dạng plan của câu thống kê | tự đo: bench trên lane bằng bảng TẠM cùng cột + cùng bộ chỉ mục liên quan, 10.000 bài · 100.000 bình luận · 200.000 cảm xúc rải 730 ngày, cửa sổ 7 ngày, trong `BEGIN … ROLLBACK` (superuser, không RLS, bỏ nhánh nhóm và tầng `scoped/agg`); tệp `…/scratchpad/dash1/planner/bench-052.sql` · `bench-052b.sql` (ngoài kho); sau bench lane không còn bảng/chỉ mục tạm nào | Lượt 1 — **A0** câu hiện tại: Seq Scan cả 100.000 bình luận + 200.000 cảm xúc, CTE tràn 806 khối tạm, **411 ms** · **A1** câu hiện tại + 2 chỉ mục: nhánh bình luận KHÔNG đổi (CTE `alive_comments` vẫn 100.000 hàng), chỉ nhánh cảm xúc dùng chỉ mục, **323 ms** · **B1** viết lại, giữ `OR`: SubPlan băm vẫn quét 100.000 bình luận, **32 ms**. Lượt 2 (thêm 500 bài + 3.000 bình luận xoá mềm, nửa số cảm xúc trỏ vào bài) — **B2** viết lại + tách nhánh cảm xúc theo `target_type`: cả hai chỉ mục mới được dùng, không còn quét toàn bảng bình luận / cảm xúc, **12 ms**; câu hiện tại và B2 trả CÙNG bộ số. Mỗi biến thể chạy một lần ⇒ chỉ kết luận HÌNH DẠNG plan, không coi là số hiệu năng của PROD |
| M12 | FE | `wc -l` + grep | 14 mã ở `apps/app/src/routes/dashboard/constants.ts:28-50`; slug map `packages/web-core/src/lib/dashboard-api.ts:45-68`; chỉ có locale `vi`; `feedEngagementWeekSchema` đã export (`packages/contracts/src/index.ts:225`); màn 052 gọi cột `reactions` là «Cảm xúc» (`apps/app/src/i18n/locales/vi/social-admin-stats.ts:60`) |
| M13 | Khoá khi tạo chỉ mục | đọc `apps/api/migrations/0587_s16socialattdebt1_file_links_company_file_idx.sql:19-23,35-48` | migrator gộp mọi migration pending vào MỘT transaction ⇒ không `CONCURRENTLY`; khuôn `SET LOCAL lock_timeout = '5s'` … `DEFAULT` (đo ở WO đó, không đo lại) |
| M14 | Bộ dựng test | đọc `H/social-qa1-kit.ts:96-112,191-361` | `bootQa1World` dựng app qua `applyMainPipeline` + `listen(0)`; hàng rào cặp quyền của kit KHÔNG nhận `read:dashboard` ⇒ actor tuỳ biến cần helper cục bộ trong spec (kit đóng băng) |

### 1.3 Đối chiếu từng vế của `done_when` / `notes`

| Vế | Lát | Bằng chứng (ca ở §5) |
| --- | --- | --- |
| Migration catalog 2 widget, CHECK union additive, journal idx = max + 1 | L1 | lệnh đo L1 · `T/dash-seed-catalog-permissions.int-spec.ts` (so DB với hằng từng trường) |
| 001 = `view:feed-report`, «sàn Company; manager Department» | L2 | A1 · A1m · D1a · D1b · ME1 · L1w · U3 |
| 002 = `view:feed`, «Own» | L2 | A2 · D2a · D2b · ME2 · L2w · I2 · U4 |
| Mỗi widget ca deny RIÊNG | L2 · L3 | S1 (đối xứng hai chiều) · F1-D3 · F2-D3 |
| `SocialModule` export CHỈ service cần thiết | L2 | diff đúng 1 tên (`SocialNewsService`) + A2 (DI nạp được) |
| FE `useCanExact` · slug-map ratchet xanh | L3 | F1-D2 · F2-D2 (chỉ wildcard) · G1 · ca ratchet sẵn có (`F/DashboardWidgetGrid.spec.tsx:139-142`) |
| int-spec LANE_DB + FE test · typecheck/build xanh | L2 · L3 · verify | lệnh ở §6 |
| notes (a) cache ↔ SOC-DEC-010 | L2 | C1 · C2 · U8 |
| notes (b) Own/Team không được thấy ô số 0 | L2 | D1b · ME1 · L1w |
| notes (c) nợ hiệu năng | — (TÁCH, O1 = C2) | owner ký 12/10: widget 001 bật mặc định với câu hiện tại khi dữ liệu còn nhỏ; L1 seed `S16-SOCIAL-STATSPERF-1` (căn cứ M11) + công tắc vận hành ở §8 + câu đếm 3 bảng feed trước deploy (§4.1) |
| notes O1 (QA-1) ca xoá mềm trên widget THẬT | L2 | X1 · X2 |

## 2. Bất biến phải giữ

1. **`company_id` ở mọi câu:** handler KHÔNG viết SQL; mọi đọc đi qua service nguồn (đã `withTenant`). Không import repository của SOCIAL vào `D/`.
2. **Handler gọi SERVICE đã gate của module nguồn** (`weeklyEngagementForWidget` · `list`): tầng 2 của SOCIAL vẫn chạy ở đúng chỗ census quét (`src/social/**`). KHÔNG gọi `SocialAccessService.resolveActor` từ `D/` (census không nhìn thấy lời gọi ngoài `social/`).
3. **Sàn scope ép ở CẢ HAI tầng, đọc CÙNG một hằng** `DASH_WIDGET_MIN_DATA_SCOPE`: metadata (`filterByGatePair`) và data (`gateAndResolve` của handler). Không literal scope nào trong handler.
4. **`gate ⊥ fetch`** (`D/dashboard-widget-gate.ts:14-17`): cổng + sàn chỉ ở `gateAndResolve`; không chuyền scope sang `fetch`.
5. **Lỗi không thành số 0:** handler không `try/catch`, không `?? 0`. `HttpException` ⇒ nguyên status; lỗi khác ⇒ `Degraded` (do `D/dashboard-widget-data.service.ts:127-130` làm sẵn).
6. **Hot-file chỉ append:** union module · catalog · gate pair · sàn · default config · TTL · `add()` · `imports`/`providers`/`exports` đều thêm khối cuối, không viết lại khối cũ. Ngoại lệ có chủ đích: dời nguyên khối `DASH_DEFAULT_CONFIG` (K13).
7. **Không hard-code vai:** phân biệt người xem bằng cặp + scope của grant. Default config đặt trên cả 4 loại dashboard.
8. **Payload qua DTO, chỉ số đếm:** liệt kê tường minh từng khoá; không tên người, không nội dung bài.
9. **Không cache số thống kê** (SOC-DEC-010) — xem K6.
10. **Không sửa** `F/WidgetCard.tsx` · `F/useDashboardWidget.ts` (ô «Tổng quan nhân sự» ở rail bảng tin và cổng `test:social-cov` phụ thuộc chúng).

## 3. Quyết định

### 3.1 Đã chốt theo đặc tả / tiền lệ (builder cứ thế làm)

| K | Quyết định | Căn cứ |
| --- | --- | --- |
| K1 | Mã · slug · tên như §0 (tiền tố module như `PAYROLL_*` · `RECRUIT_*`) | `D/dashboard-widget-catalog.const.ts:262-319`; tên theo `docs/SPEC/SPEC-16 SOCIAL.md:512-513` |
| K2 | Nguồn 001 = `weeklyEngagementForWidget` (không sửa) | `docs/API Design/API-19_SOCIAL_API_Design.md:331-332` |
| K3 | Nguồn 002 = `SocialNewsService.list(user, { limit: 1, countOnly: true })`; `unackedCount === null` ⇒ NÉM. Chỉ thêm 1 tên vào `exports`; KHÔNG thêm method ở SOCIAL, KHÔNG thêm dòng pin census | API-19:86 «không cần route riêng»; nhánh `countOnly` không nạp hàng nào (`S/social-news.service.ts:68-77`) — khác `list()` của PAYROLL mà SPEC-11 §10.1b phải tránh; ít bề mặt hơn method mới (file ngoài `paths` + sổ pin) |
| K4 | Sàn 001 = `Department` — đây là cách diễn đạt «sàn Company; manager Department»: tập hợp lệ {Department, Company, System}; Own · Team ⇒ ẩn + 403 | tiền lệ `ASSET_SUMMARY` (`catalog.const.ts:436` · `D/dashboard-widget-office.handlers.ts:110-134`); nguồn tự co số theo scope (`S/social-stats-scope.ts:23-41`) |
| K5 | Sàn 002 = `Company`; `default_data_scope = Own` là NHÃN DỮ LIỆU (đếm cho chính người gọi) | route nguồn 020 chỉ nhận grant @Company (`S/social-route-pairs.const.ts:132-137,176` · `S/social-access.service.ts:190-195`); thiếu sàn ⇒ grant hẹp nhận shell widget rồi ăn 403 ở đường data; SOC-DEC-004 (`SPEC-16:601`) |
| K6 | Không cache: `DASH_WIDGET_TTL_SECONDS.SOCIAL = 0` (cấp module, cả hai widget) **và** `Cache-Control: no-store` ở HAI route của `DashboardWidgetDataController` (plan-review M6, phương án A: hai dòng `@Header`, áp cho mọi widget vì route `widgets?include_data=true` cũng chở số của hai widget này) | SOC-DEC-010 (`SPEC-16:607`, `:545`) cho 001 — route nguồn 052 đã coi «cache trình duyệt/proxy cũng là cache» (`S/social-stats.controller.ts:21,50`); 002: SOCIAL không phát sự kiện nào khi xác nhận / ẩn / xoá / khôi phục (`S/social-news.service.ts:29-36` không có `OutboxService`; sổ `D/dashboard-cache-invalidation.registrar.ts:53-108` có 0 dòng SOCIAL) nên không có gì để làm mới cache. NGOÀI nghĩa «không cache» của WO này (ghi rõ ở SPEC-16 §17.3): FE giữ số tối đa 15 giây (`staleTime` chung của mọi widget — `F/useDashboardWidget.ts:51`, bất biến 10 cấm sửa) và mỗi lượt xem vẫn ghi đè 1 hàng `dashboard_widget_cache` không ai đọc lại (M7) |
| K7 | Cache identity **per-user cho cả hai** (001: `cacheScope` = scope đã resolve; 002: `Own`), không nhánh company-shared | TTL 0 nên không quan sát được qua HTTP; per-user giữ an toàn theo cấu trúc nếu sau này TTL được nới. Ghim bằng ca unit U1 · U2 |
| K8 | `Empty` như §0; chữ rỗng do server gửi | tiền lệ `D/dashboard-widget-payroll.handlers.ts:200-210` |
| K9 | Nhãn hiển thị của `reactions` = «Cảm xúc» (không phải «thích») | cột đếm mọi loại cảm xúc; màn 052 và tệp XLSX đã dùng chữ này (M12) |
| K10 | FE gác bằng `useCanExact`; docblock + tên ca ghi lý do «khớp đúng-bằng như route `/feed*`» — KHÔNG chép câu «cặp nhạy cảm» của PAYROLL | `packages/web-core/src/lib/registry.ts:262-267`; hai cặp `is_sensitive = f` (M3) |
| K11 | Nút dẫn của 001 chỉ vẽ khi có thêm `view:feed` (thiếu thì vẫn hiện 4 số, không có nút) | `/feed/stats` đòi ĐỦ hai cặp (`registry.ts:2381-2386`) ⇒ tránh bấm-vào-403 |
| K12 | Default config: cả 4 loại dashboard, @130 / @140; `DashboardConfigSeeder.seedVersion` `v6 → v7` | `catalog.const.ts:691-703` · `D/dashboard-config.seeder.ts:31-39` |
| K13 | Giữ trần 800: dời NGUYÊN khối `DashDefaultConfigEntry` + `DASH_DEFAULT_CONFIG` (`catalog.const.ts:609-704`) sang `D/dashboard-default-config.const.ts`, file cũ `export { … } from` lại; file mới chỉ `import type` ngược ⇒ không vòng import, 3 nơi import không đổi | M8; `dashboard-widget-handlers.service.ts` +≈ 14 dòng vẫn < 800 (đo lại bằng `wc -l` ở L2) |
| K14 | int-spec mới dựng bằng `bootQa1World` ⇒ `HAND_ROLLED_BASELINE` giữ **269** | `apps/api/test/foundation/pipeline-parity.unit-spec.ts:29`; M14 |
| K15 | Không nối `DASH_CACHE_INVALIDATION_MAP`, không quick action, không audit per-view, không sửa `packages/contracts` | TTL 0; 052 đọc không audit; schema resolver đã lỏng (`packages/contracts/src/dashboard-resolver.ts:15-21`) |
| K16 | Ca DENY assert `status 403` + `error.code = AUTH-ERR-FORBIDDEN` + THÔNG ĐIỆP phân biệt tầng (`…thiếu quyền a:r` cho thiếu cặp, `…ở phạm vi đủ rộng` cho dưới sàn) | cổng chồng: nguồn SOCIAL cũng 403 khi thiếu cặp / dưới sàn (`S/social-access.service.ts:183-195` · `apps/api/src/permission/data-scope.service.ts:67-82`) ⇒ chỉ assert status là xanh-giả (§5.6 m4 · m5). Mã + thông điệp trên dây mới ĐỌC MÃ (`D/dashboard-widget-gate.ts:55-67` · `apps/api/src/common/filters/all-exceptions.filter.ts:92-103`) — đo ở RED; lệch thì ghi số đo vào sổ vết rồi sửa kỳ vọng theo số đo, không bỏ vế thông điệp |
| K17 | Một PR, MỘT migration `0592` (catalog). Chỉ mục thời gian + viết lại câu thống kê thuộc `S16-SOCIAL-STATSPERF-1` (O1 = C2) | owner chốt 12/10; M11: thêm chỉ mục mà không sửa câu gần như vô ích ⇒ không ship nửa vời |

### 3.2 Cần owner — không mục nào chặn thi công; im lặng thì làm theo cột «mặc định»

| # | Câu hỏi | Phương án | Khuyến nghị · lý do | Mặc định |
| --- | --- | --- | --- | --- |
| O1 | Nợ hiệu năng (c) của câu thống kê | **C1** trả ngay trong WO này (mig 2 chỉ mục + viết lại `ev` ở `S/social-stats.repository.ts` + ghim chỉ mục) · **C2** tách WO `S16-SOCIAL-STATSPERF-1`, widget vẫn bật với câu hiện tại | plan v1 khuyến nghị C1 (M11: chỉ thêm chỉ mục mà không sửa câu gần như vô ích, 411 → 323 ms; sửa cả hai ⇒ 12 ms) | **ĐÃ CHỐT 12/10 ~14:50 (hộp hỏi): C2** — owner chấp nhận widget 001 bật mặc định với câu hiện tại (quét toàn lịch sử, không cache) khi dữ liệu còn nhỏ; hiệu năng tách `S16-SOCIAL-STATSPERF-1` (seed ở L1, nội dung ở N7). Lý do cắt: pha plan đã tiêu 202 USD trong khung đầu 150–300 |
| O2 | Cache của hai widget | **A** không cache (TTL 0) · **B** thêm SOC-DEC-014 cho phép 001 cache 60–300 s (khoá cache phải mang `weekStart`); 002 vẫn 0 | **A** — không trái quyết định đã ký; kèm header `no-store` (K6) | **A** |
| O3 | Vị trí mặc định | **A** cuối lưới (@130 / @140) trên cả 4 loại · **B** đưa «Tin tức chưa đọc» lên đầu dashboard Nhân viên | **A** — append thuần, không tạo hoà `sort_order`. Lưu ý: đổi sau khi đã seed cần câu UPDATE cho config đang có (seeder chỉ INSERT hàng thiếu) | **A** |
| O4 | Quản lý có `view:feed-report` @Department nhưng không thuộc / không đứng đầu đơn vị nào | **A** thấy ô rỗng «Tuần này chưa có tương tác nào trong phạm vi của bạn» (nguồn trả 0 cho phạm vi rỗng) · **B** ẩn hẳn (DASH phải tự đọc tập đơn vị — thêm bề mặt và 1 lượt đọc) | **A** — chữ rỗng nói đúng sự thật; ghim bằng ca E1b | **A** |
| O5 | Liên kết của «Tin tức chưa đọc» | **A** mở `/feed/news` trần (màn chưa có bộ lọc «chưa xác nhận» qua URL) + ghi nợ N1 · **B** mở rộng WO sang `NewsPage.tsx` + `router.tsx` | **A** — B ra ngoài `paths` và chạm cổng `test:social-cov` | **A** |

### 3.3 Đặc tả lệch `done_when` / tiêu đề WO — đặc tả + mã nguồn đo được thắng

| Chỗ | WO ghi | Làm theo | Vì |
| --- | --- | --- | --- |
| Scope của 002 | «`view:feed` Own» | cặp `view:feed` + SÀN `Company`; «Own» là nhãn dữ liệu | K5 |
| Sàn của 001 | «sàn Company; manager Department» · `src` ghi «khuôn S13, sàn Company 2 tầng» | hằng sàn `Department` | K4 — sàn Company thuần sẽ giấu widget khỏi chính quản lý |
| «thích» | tiêu đề WO + `SPEC-16:512` | nhãn «Cảm xúc», khoá `reactions` | K9 |
| «đăng ký … (SPEC-01 §9.9)» | tiêu đề WO | chỉ ghi ở `SPEC-16 §17.3`; KHÔNG sửa SPEC-01 | §9.9 là quy ước đặt mã (`docs/SPEC/SPEC-01 Tổng quan.md:355-363`), `:985` đã liệt kê cả hai mã |
| Gate | `layer: "FULL"` nhưng `notes[0]` ghi «LIGHT gate» | chọn theo đường dẫn (§9) | CLAUDE.md §6 · memory `full-gate-must-run-before-pr-opens` |

### 3.4 `paths` của WO còn thiếu — L1 thêm vào `harness/backlog.mjs` TRƯỚC mọi việc khác

`apps/app/src/i18n/locales/vi/dashboard.ts` (tiêu đề + nhãn — bắt buộc) · `docs/plans/S16-SOCIAL-DASH-1.md` (plan + sổ vết) ·
`docs/API Design/API-19_SOCIAL_API_Design.md` (hai câu về widget ở `:86`, `:331-332`) · `docs/TESTABLE-FEATURES.md` (§5k) ·
`apps/api/src/social/social-stats.service.ts` (CHỈ docblock `:82-88` — con trỏ nợ (a)(b) thành cũ).
Kèm một dòng `notes` nêu lý do mở rộng. KHÔNG thêm `apps/app/src/routes/social/**`, `S/social-news.service.ts`, `S/social-stats.repository.ts`, SPEC-01, SPEC-07.
Cùng lượt sửa backlog đó (plan-review L1 · M4): đổi `zone` của WO thành `red`; thay `notes[0]` «LIGHT gate» bằng «FULL gate theo ĐƯỜNG DẪN (migration + cổng quyền) — không gắn nhãn auto-merge, người merge»; thêm dòng `notes` ghi owner chốt O1 = C2 ngày 12/10; và SEED WO `S16-SOCIAL-STATSPERF-1` theo N7 (§7) — chèn NGAY SAU mục `S16-SOCIAL-DASH-1`, không chèn cuối mảng (PR #580 · #581 đang mở cùng sửa file này ở vùng khác).

## 4. Thiết kế theo lớp

### 4.1 Migration (L1 — lát NỐI TIẾP duy nhất chạm schema)

**`apps/api/migrations/0592_s16socialdash1_widget_social.sql`** — journal `idx 259 · version "7" · when 1717587381000 · breakpoints true`.

1. `SET LOCAL lock_timeout = '5s';` (khuôn `0587:44`): `ALTER` cần ACCESS EXCLUSIVE trên `dashboard_widgets`; thà đỏ rồi chạy lại còn hơn treo cả lượt deploy sau một transaction dài.
2. **Chốt tiền đề** (`DO $$`): tách tập giá trị của CHECK hiện tại bằng đúng biểu thức ở M2; chỉ đi tiếp khi tập đó BẰNG 13 giá trị đã biết (hoặc 13 + `SOCIAL` = chạy lại); khác ⇒ `RAISE EXCEPTION '[0592] precheck: …'`. Lý do: superset viết tay sẽ âm thầm xoá giá trị một nhánh khác vừa thêm (memory `audit-check-union-parse-anchor-trap`); đọc không ra ⇒ cũng NÉM (fail-closed).
3. `ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;` + `ADD CONSTRAINT … CHECK (module_code IN (<13 giá trị cũ đúng thứ tự của 0568:48>, 'SOCIAL'))`.
4. `INSERT INTO dashboard_widgets (…12 cột như 0576:50-53…) VALUES` hai hàng của §0 (`company_id NULL`, `is_system_widget true`, `status 'Active'`, `sort_order` 130 / 140) `ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
5. **Verify fail-loud** (`DO $$`): đúng 2 hàng `SOCIAL` còn sống, khớp TỪNG trường mà int-spec so (module · type · permission code · scope · slug · component · `is_system_widget` · status) — `ON CONFLICT` nuốt một hàng cũ lệch thì phải đỏ; và CHECK mới có đủ 14 giá trị.
6. `SET LOCAL lock_timeout = DEFAULT;` (không rò sang migration sau trong cùng transaction — `0587:41-48`). Khối Down dạng chú thích.

KHÔNG seed `permissions` / `role_permissions` (mượn cặp của mig 0578) · KHÔNG seed `dashboard_widget_configs` (seeder runtime) · KHÔNG sửa `apps/api/src/db/schema/dashboard.ts` (drift cố ý, `0568:39-40`).

**Tác động khi chạy trên PROD:** `0592` khoá ACCESS EXCLUSIVE bảng 23 hàng trong vài ms (mọi `GET /dashboard/me` chờ trong lúc đó); WO không có migration nào khác. Thứ tự bắt buộc: **migrate TRƯỚC khi boot bản API mới** (seeder ném khi thiếu hàng catalog và chỉ để lại log — `D/dashboard-config.seeder.ts:69-73`). Trước `m prod-update api`, owner chạy câu đếm `select (select count(*) from feed_posts), (select count(*) from feed_comments), (select count(*) from feed_reactions);` và ghi vào sổ vết: đó là số nền của quyết định O1 = C2 và của ngưỡng mở `S16-SOCIAL-STATSPERF-1` (PROD **CHƯA ĐO** — phiên này không chạm PROD).

### 4.2 Backend (L2)

1. **`D/dashboard-widget-catalog.const.ts`** (append): `| "SOCIAL"` vào `DashModuleCode` (+ ghi `0592` vào chú thích `:18`) · 2 mục `DASH_WIDGET_CATALOG` · 2 khoá `DASH_WIDGET_GATE_PAIR` · 2 khoá `DASH_WIDGET_MIN_DATA_SCOPE` — chú thích nêu HAI lý do khác nhau (001: Own/Team nhận số 0 từ nguồn; 002: khớp `companyFloor` của route 020). Khối default config dời theo K13.
2. **`D/dashboard-default-config.const.ts`** (MỚI): khối dời + 8 dòng mới (2 mã × 4 loại, @130 / @140) kèm chú thích «lọc bằng cặp + sàn, không bằng vắng config».
3. **`D/dashboard-widget-data.const.ts`**: `SOCIAL: 0` + chú thích K6 (thiếu khoá ⇒ đỏ typecheck vì `Record<DashModuleCode, number>`, `:21`).
4. **`D/dashboard-widget-social.handlers.ts`** (MỚI, ≈ 135 dòng, khuôn `payroll.handlers.ts`) — `DashboardWidgetSocialHandlers(permission, dataScope, stats: SocialStatsService, news: SocialNewsService)`:
   - `private gateWithFloor(ctx, code)`: `gateWidgetOrThrow` → `dataScope.resolveAndAssert(…cặp…)` → `meetsMinDataScope(code, scope)` sai ⇒ `ForbiddenException("AUTH-ERR-FORBIDDEN: thiếu quyền a:r ở phạm vi đủ rộng")` → trả `scope`. MỘT hàm cho cả hai widget (không sinh bản sao gate thứ năm).
   - `gateEngagementWeek` / `gateNewsUnacked`: gọi `gateWithFloor`, trả identity theo K7 với `ttlSeconds: ttlSecondsFor(ctx.entry)`.
   - `fetchEngagementWeek`: `const w = await this.stats.weeklyEngagementForWidget(ctx.user)`; tổng ba số = 0 ⇒ `Empty` + `{ message: "Tuần này chưa có tương tác nào trong phạm vi của bạn" }`; còn lại `Active` với ĐÚNG 5 khoá.
   - `fetchNewsUnacked`: `const page = await this.news.list(ctx.user, { limit: 1, countOnly: true })`; `page.unackedCount === null` ⇒ `throw new Error(…)` (`null` nghĩa «không hỏi», không phải 0 — `packages/contracts/src/social-api-b.ts:108-112`); `0` ⇒ `Empty` + «Bạn đã xác nhận hết các tin cần đọc»; còn lại `{ total }`.
5. **`D/dashboard-widget-handlers.service.ts`**: 1 import + 1 tham số constructor + 2 lời gọi `add("social-engagement-week", "SOCIAL_ENGAGEMENT_WEEK", …)` · `add("social-news-unacked", "SOCIAL_NEWS_UNACKED", …)`.
6. **`D/dashboard.module.ts`**: `SocialModule` vào `imports`, `DashboardWidgetSocialHandlers` vào `providers` (không vòng: chỉ `AppModule` import `DashboardModule` — `apps/api/src/app.module.ts:20,79`). **`S/social.module.ts:179-180`**: `exports: [SocialAccessService, SocialStatsService, SocialNewsService]` + sửa chú thích.
7. **`D/dashboard-config.seeder.ts:39`**: `"v7"` + một dòng lịch sử. **`S/social-stats.service.ts:82-88`**: sửa docblock (hai nợ (a)(b) đã chốt ở plan này) — không đổi mã.
8. **Xử lý lỗi (không viết thêm gì):** công ty xoá mềm / không sinh hàng tổng ⇒ nguồn ném `Error` thường ⇒ `Degraded` HTTP 200; thiếu quyền giữa chừng ⇒ `ForbiddenException` của nguồn ⇒ 403.
9. **`D/dashboard-widget-data.controller.ts`** (K6 — plan-review M6, phương án A): thêm `Header` vào import từ `@nestjs/common` và đặt `@Header("Cache-Control", "no-store")` trên CẢ HAI route `widgets` · `widgets/:slug` (khuôn `S/social-stats.controller.ts:50`; route `widgets?include_data=true` cũng chở số của hai widget nên không tách điều kiện theo TTL). `@Header` áp cả cho phản hồi 4xx — với `no-store` điều đó vô hại. Không dùng `@Res`.

### 4.3 Frontend (L3 — không chung file với L2)

1. **`apps/app/src/routes/dashboard/constants.ts`**: 2 mã vào `DASH_WIDGET_CODE` + 2 dòng `DASH_WIDGET_GATE_PAIR` bằng literal (`{ action: "view", resourceType: "feed-report" }` · `{ action: "view", resourceType: "feed" }`) — cụm SOCIAL chưa có file hằng cặp và `routes/social/**` ngoài `paths`. Chú thích theo K10.
2. **`packages/web-core/src/lib/dashboard-api.ts`**: 2 dòng `DASH_WIDGET_SLUG` đúng slug §0 → **build lại `@mediaos/web-core`** (app và ca ratchet đọc `dist`). Kèm hai ca ghim GIÁ TRỊ slug ở `packages/web-core/src/lib/dashboard-api.spec.ts` (plan-review M1; §5.4 WC1 · WC2).
3. **`F/widget-data-schemas.ts`**: `socialEngagementWeekWidgetDataSchema = feedEngagementWeekSchema` (tái dùng từ `@mediaos/contracts` — BE trả đúng DTO đó, không khai lại 5 khoá) · `socialNewsUnackedWidgetDataSchema = z.object({ total: z.number().int().nonnegative() })`.
4. **`F/SocialEngagementWeekWidget.tsx`** (MỚI, khuôn `PayrollBudgetWidget.tsx:122-141`): `Inner` + cổng ngoài `useCanExact`; `<dl>` 2 cột, mỗi `<dd>` một `data-testid` (`social-engagement-posts` · `-comments` · `-reactions` · `-active-members`); dòng «Tuần từ dd/MM/yyyy» dựng bằng tách chuỗi `weekStart` (không `new Date` — FE không có múi giờ công ty); nút dẫn theo K11.
5. **`F/SocialNewsUnackedWidget.tsx`** (MỚI, khuôn `PayrollAdvancePendingWidget.tsx:39-101`): số trong `data-testid="social-news-unacked-total"`, nhãn số nhiều, nút dẫn `/feed/news` (`as "/"`).
6. **`F/DashboardWidgetGrid.tsx:31-32,60-61`**: 2 import + 2 dòng `WIDGET_COMPONENTS`.
7. **`apps/app/src/i18n/locales/vi/dashboard.ts`** (sau `:129`): `socialEngagementWeek { title, empty.title, weekOf, posts, comments, reactions: "Cảm xúc", activeMembers, cta }` · `socialNewsUnacked { title, empty.title, countLabel_one, countLabel_other, cta }`.

Danh sách widget do SERVER quyết (`apps/app/src/routes/dashboard/DashboardMePage.tsx:46-51`); FE không có tín hiệu scope ⇒ cổng FE chỉ là cổng phụ theo cặp. Người chỉ cầm wildcard `*:*`: BE trả widget (cặp không nhạy cảm), FE không vẽ — lệch theo chiều đóng, chấp nhận.

### 4.4 Tài liệu (L6)

- **`docs/SPEC/SPEC-16 SOCIAL.md` §17.3 (`:508-513`)** theo khuôn `SPEC-11 §10.1b`: tiêu đề thêm «(`S16-SOCIAL-DASH-1`, mig `0592` — ĐÃ SHIP)»; bảng 5 cột (mã · `widget_code` · tên + slug · nguồn · gate + sàn); các gạch đầu dòng: sàn hai tầng và nghĩa của «manager Department» · «Own» là nhãn dữ liệu · không cache (áp SOC-DEC-010; lý do riêng của 002) · nghĩa của `Empty` · «cảm xúc» thay «thích» · FE `useCanExact` và lý do · dòng bằng chứng (tên spec + số ca THẬT sau verify). Gạch «không cache» nêu đủ ba tầng (server TTL 0 · header `no-store` · FE giữ tối đa 15 giây theo `staleTime` chung) và việc hàng `dashboard_widget_cache` vẫn được ghi đè mỗi lượt; một dòng ở mục hiệu năng (`:545`) trỏ `S16-SOCIAL-STATSPERF-1`.
- **`docs/API Design/API-19_SOCIAL_API_Design.md:86,331-332`**: thay «Handler/catalog DASH thuộc `S16-SOCIAL-DASH-1`» bằng tên handler + slug. **`docs/TESTABLE-FEATURES.md` §5k**: 2 dòng cách thử tay.
- KHÔNG sửa SPEC-01, SPEC-07, API-08, DB-07 (tiền lệ `324ec824` không sửa; các chỗ lệch có sẵn ghi ở §7). `docs/erd-current.md` cũng KHÔNG sửa: chỗ nhắc widget ở đó (`:468`) là tường thuật theo wave S15, không phải sổ widget (plan-review L4).

## 5. Test RED trước

### 5.1 Fixture của `T/dashboard-social-widgets.int-spec.ts` (MỚI, `describe.skipIf(!(hasDb && LANE_DB))`, < 800 dòng)

- `const w = await bootQa1World("dash1")` (2 công ty A · B) rồi chạy `MasterDataSeedRunner.reconcileCompany` với `DashboardConfigSeeder` cho A và B (khuôn `T/dashboard-payroll-v2-widgets.int-spec.ts:278-286`), assert `ok === true` ⇒ đồng thời đo seeder `v7`.
- Actor canonical qua `w.actor(…, { canonical })`: `emp` (đơn vị U1) · `emp2` (U2) · `mgr` (U1) · `mgrNoUnit` · `hr` · `admin` (canonical `company-admin` — giữ `manage:feed-post` · `restore:feed-post`; cần cho X2a, đo lại cặp ở RED) · `bHr` (công ty B).
- Actor tuỳ biến qua helper CỤC BỘ `dashActor(w, tenant, nhãn, grants)` (kit đóng băng; M4 · M14): `seedUser` → `seedRole` → tra `permissions` CHỈ ĐỌC (thiếu ⇒ ném; không INSERT catalog) → `seedRolePermission` → `seedUserRole` → đăng nhập SAU khi gắn quyền. Mọi actor có `read:dashboard`@Company + `view-employee:dashboard`@Own (⇒ loại dashboard `Employee`):
  `repOwn` (+`view:feed`@Company +`view:feed-report`@**Own**) · `repTeam` (…@**Team**) · `onlyReport` (+`view:feed-report`@Company, KHÔNG `view:feed`) · `feedDept` (+`view:feed`@**Department**) · `bare` (không cặp feed nào). Mật khẩu fixture ghép chuỗi (luật gitleaks).
- Dữ liệu gieo QUA ROUTE bằng hàm của kit (`sharePost` · `newsPost({ requiresAck: true })` · `addComment` · `reactPost` · `ackPost`); xoá / ẩn / khôi phục gọi thẳng route (`DELETE /social/posts/:id` · `PATCH /social/posts/:id/moderation` · `POST /recycle-bin/feed-posts/:id/restore` — chép lời gọi ở `T/s16-social-qa1-softdelete.int-spec.ts:224-231`).
- Số kỳ vọng viết TƯỜNG MINH thành hằng VÀ đối chiếu với nguồn độc lập trong CÙNG lượt (hàng tuần hiện tại của `GET /social/stats/engagement` · `GET /social/news?countOnly=true`). KHÔNG tự tính ranh tuần trong test (ranh theo múi giờ công ty — memory `ci-red-can-depend-on-time-of-day`).

### 5.2 Ca int — `W1` = `GET /dashboard/widgets/social-engagement-week` · `W2` = `GET /dashboard/widgets/social-news-unacked`

| # | Tiền đề | Kỳ vọng |
| --- | --- | --- |
| A1 | **ALLOW** `hr` gọi W1 | 200 · `status "Active"` · `Object.keys(data)` = đúng 5 khoá · số = hằng toàn công ty = hàng tuần cuối của 052 · `cache.hit false` · `cache.ttl_seconds 0` |
| A1m | **ALLOW** `mgr` gọi W1 | 200 · số = phần của U1 (nhỏ hơn A1 ở ít nhất một cột) = 052 của chính `mgr` |
| D1a | **DENY** `emp` (thiếu cặp) gọi W1 — đứng cạnh A1 | 403 · `error.code "AUTH-ERR-FORBIDDEN"` · `error.message` `toBe` NGUYÊN chuỗi `AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report` |
| D1b | **DENY** `it.each([repOwn, repTeam])` gọi W1 — đứng cạnh A1m | 403 · `error.message` `toBe` `AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report ở phạm vi đủ rộng` |
| ME1 | `GET /dashboard/me` | **CÓ** mã 001: `hr` · `mgr` · `onlyReport` — **VẮNG**: `emp` · `repOwn` (`onlyReport` và `repOwn` cùng loại `Employee`, cùng config ⇒ khác nhau chỉ ở scope) |
| L1w | `GET /dashboard/widgets` | cùng ma trận ME1 |
| A2 | **ALLOW** `emp` gọi W2 | 200 · `Active` · `Object.keys(data)` = `["total"]` · `total` = hằng = `unackedCount` của 020 · `cache.hit false` · `ttl_seconds 0` |
| D2a | **DENY** `bare` gọi W2 — cạnh A2 | 403 · `AUTH-ERR-FORBIDDEN` · `error.message` `toBe` `AUTH-ERR-FORBIDDEN: thiếu quyền view:feed` (KHÔNG `toContain` — chuỗi dưới-sàn có cùng tiền tố) |
| D2b | **DENY** `feedDept` gọi W2 — cạnh A2 | 403 · `error.message` `toBe` `AUTH-ERR-FORBIDDEN: thiếu quyền view:feed ở phạm vi đủ rộng` (KHÔNG phải chuỗi `AUTH-ERR-SCOPE-DENIED` của nguồn) |
| ME2 | `GET /dashboard/me` | **CÓ** mã 002: `emp` · `repOwn` — **VẮNG**: `bare` · `feedDept` · `onlyReport` |
| L2w | `GET /dashboard/widgets` | cùng ma trận ME2 |
| S1 | Đối xứng hai chiều | `onlyReport`: W1 200, W2 403 · `emp`: W2 200, W1 403 — cặp của widget này không mở widget kia |
| C1 | Không cache 001 | `hr` gọi W1 → `emp` đăng 1 bài → `hr` gọi lại NGAY: `posts` +1 · `hit false` cả hai lượt · `expires_at = last_updated_at` · header `cache-control` = `no-store` ở cả hai lượt |
| C2 | Không cache 002 + ack | `emp` gọi W2 (n) → `emp` xác nhận 1 tin (021) → gọi lại: n − 1 · `hit false` · header `cache-control` = `no-store` |
| I2 | Cách ly người xem | sau C2: `emp2` vẫn n; `hr` (tác giả tin) vẫn đếm tin của mình tới khi tự xác nhận (hành vi sẵn có của 020 — ghim) |
| X1 | Xoá mềm trên widget 001 (bàn giao O1) | bài có 1 bình luận + 2 cảm xúc: xoá (005) ⇒ `posts −1 · comments −1 · reactions −2`; ẩn bài khác (006) ⇒ KHÔNG đổi; khôi phục (058) ⇒ về như trước |
| X2a | Xoá mềm trên widget 002 — người xoá KHÁC tác giả (O1) | `admin` xoá 1 tin của `hr` (005) ⇒ `emp` −1 → khôi phục (058) trả `status "published"` ⇒ `emp` +1 |
| X2b | Xoá mềm trên widget 002 — TÁC GIẢ tự xoá (luật O4 của BE-3C: `S/social-counters.ts:105-130`) | `hr` xoá tin của chính mình ⇒ `emp` −1 → 058 trả `status "hidden"` ⇒ `emp` VẪN −1 (bài ẩn nằm ngoài tầm nhìn người thường) → `hr` bỏ ẩn (006 `hidden:false`) ⇒ `emp` +1. Vế ẩn / hiện riêng: ẩn một tin đang `published` (006) ⇒ `emp` −1 còn `hr` không đổi; hiện lại ⇒ +1 |
| E1 | Rỗng 001 | `bHr` gọi W1: 200 · `status "Empty"` · `data null` · `empty_state.message` có chữ |
| E1b | Phạm vi rỗng (O4 = A) | `mgrNoUnit` gọi W1: 200 `Empty` (không 403, không lỗi) |
| E2 | Rỗng 002 | `emp` xác nhận hết ⇒ W2: `Empty` · `data null` |
| T1 | Chéo công ty | bài + tin đăng ở B không đổi số của `hr` (A) ở W1 và của `emp` ở W2; `bHr` không thấy số của A |
| Z1 | Seeder `v7` | sau `reconcileCompany(A)`: 8 hàng config của hai mã (4 loại × 2) @130 / @140; chạy lần hai không thêm hàng |
| H1c | Header của route catalog (K6) | `hr` gọi `GET /dashboard/widgets?include_data=true`: 200 · header `cache-control` = `no-store` |

Không có «ca cache hit»: C1 · C2 ghim rằng lượt gọi thứ hai KHÔNG hit (đó là hành vi cần có). Muốn ép miss ở chỗ khác thì xoá hàng `dashboard_widget_cache` của công ty, không dùng `?refresh=true`. Thứ tự chạy (plan-review L2): E1 chạy TRƯỚC T1 (T1 đăng bài ở công ty B); E2 là ca CUỐI của nhóm W2 (sau A2 · C2 · I2 · X2a · X2b) hoặc dùng một người xem riêng.

### 5.3 Ca unit — `D/dashboard-widget-social.handlers.spec.ts` (MỚI, không DB; nguồn là stub, hằng sàn/cặp là hằng THẬT)

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| U1 | identity 001 với scope `Company` / `Department` | `{ shareScope: "user", cacheScope: <scope>, keyDiscriminator: null, scopeReferenceId: user.id, ttlSeconds: 0 }` |
| U2 | identity 002 | `{ shareScope: "user", cacheScope: "Own", scopeReferenceId: user.id, ttlSeconds: 0 }` |
| U3 | bảng sàn 001 (`it.each`) | `Own` · `Team` ⇒ reject khớp «ở phạm vi đủ rộng»; `Department` · `Company` · `System` ⇒ resolve |
| U4 | bảng sàn 002 (`it.each`) | `Own` · `Team` · `Department` ⇒ reject; `Company` · `System` ⇒ resolve |
| U5 | `can()` từ chối | reject khớp «thiếu quyền»; `resolveAndAssert` KHÔNG được gọi; nguồn KHÔNG được gọi |
| U6 | `fetchEngagementWeek` | số dương ⇒ `Active` đúng 5 khoá; toàn 0 ⇒ `Empty` + chữ; nguồn ném `Error` ⇒ reject `toBe` chính lỗi đó |
| U7 | `fetchNewsUnacked` | gọi nguồn với ĐÚNG `{ limit: 1, countOnly: true }`; `3` ⇒ `{ total: 3 }`; `0` ⇒ `Empty`; **`null` ⇒ reject** (không thành 0); nguồn ném `ForbiddenException` ⇒ reject `toBe` lỗi đó |
| U8 | TTL | `DASH_WIDGET_TTL_SECONDS.SOCIAL === 0` và `ttlSecondsFor(<mục SOCIAL>) === 0` |

### 5.4 Ca FE — `F/social-widgets.spec.tsx` (MỚI, khuôn `F/payroll-v2-widgets.spec.tsx:22-64`) + `F/DashboardWidgetGrid.spec.tsx`

| # | Ca | Kỳ vọng DOM |
| --- | --- | --- |
| F1-D1 · F2-D1 | **DENY** không cặp nào | tiêu đề vắng VÀ `getWidgetData` không được gọi |
| F1-D2 · F2-D2 | **DENY** chỉ `{"*:*": true}` | như trên (khớp đúng-bằng) |
| F1-D3 · F2-D3 | **DENY** chỉ có cặp của widget ANH EM | như trên |
| F1-A | **ALLOW** `view:feed-report` + `view:feed` | gọi `getWidgetData("SOCIAL_ENGAGEMENT_WEEK", …)`; 4 `data-testid` mang đúng 4 số (4 giá trị khác nhau) |
| F1-L | Nút dẫn 001 | **DENY** chỉ `view:feed-report` ⇒ 4 số hiện, KHÔNG có nút · **ALLOW** đủ hai cặp ⇒ bấm ⇒ `navigate({ to: "/feed/stats" })` |
| F2-A · F2-L | **ALLOW** `view:feed` | số ở `social-news-unacked-total`; bấm ⇒ `navigate({ to: "/feed/news" })` |
| F1-E · F2-E | `status "Empty"` + `empty_state.message` | hiện chữ của server |
| F1-X · F2-X | payload sai hình (thiếu `reactions` · `total` là chuỗi) | nhánh lỗi «không thể tải dữ liệu»; không vẽ số |
| F1-G · F2-G | `status "Degraded"` | hiện `error_state.message` |
| G1 | Grid: 2 `vi.mock` + ca «wire» | hai mã mới render đúng thứ tự `layout.order` |
| WC1 · WC2 | `packages/web-core/src/lib/dashboard-api.spec.ts` (plan-review M1 — ghim GIÁ TRỊ slug, không mock bản đồ) | `getWidgetData("SOCIAL_ENGAGEMENT_WEEK")` ⇒ URL `toBe("/dashboard/widgets/social-engagement-week")` · `getWidgetData("SOCIAL_NEWS_UNACKED")` ⇒ `toBe("/dashboard/widgets/social-news-unacked")` — cùng literal mà int-spec BE gọi |

`waitFor` bọc CẢ phép đo DOM; số đọc qua `data-testid` (memory `s15-payroll-dash1-wave-state`). Spec PHẢI mock `dashboardApi` (app không có lưới chặn mạng — `apps/app/src/test/setup.ts`).

### 5.5 Sổ pin / ratchet — nâng TRONG CÙNG PR

| Nơi | Từ → thành |
| --- | --- |
| `apps/api/test/foundation/dashboard-scope-roundtrip.unit-spec.ts:101,109,110` | **5 → 7** ở cả ba chỗ (tên ca · `toHaveLength` · `toHaveBeenCalledTimes`) + chú thích liệt kê 7 mã |
| `T/dashboard-resolver.int-spec.ts` M2 `:237-245` · M6 `:345-354` · M10 `:405-414` | thêm `"SOCIAL_NEWS_UNACKED"` vào CUỐI (6 → 7 mã) |
| `T/dashboard-resolver.int-spec.ts` M3 `:277-290` | thêm `"SOCIAL_ENGAGEMENT_WEEK"` + `"SOCIAL_NEWS_UNACKED"` (8 → 10 mã); `codes.slice(0, 3)` không đổi |
| `pipeline-parity.unit-spec.ts:29` | **269 giữ nguyên** (K14) — chép khuôn dựng tay của payroll-v2 là đỏ 270 |
| `social-two-layer-guard-census.unit-spec.ts:186,232,512` | **không đổi** (không site `resolveActor` mới trong `src/social/**`; vẫn 59 route) — đổi nghĩa là đã lỡ thêm method ở SOCIAL |
| `F/DashboardWidgetGrid.spec.tsx:139-142` (ratchet slug) | tự phủ mã mới (so theo tập) — đỏ oan nếu chưa build lại web-core |

### 5.6 Mutant (sao lưu bằng `cp` → cấy → chạy → khôi phục bằng `cp`; KHÔNG `git checkout --`; đỏ phải khớp thông điệp)

| # | Cấy | Phải đỏ đúng ca · thông điệp |
| --- | --- | --- |
| m1 | gỡ `SOCIAL_ENGAGEMENT_WEEK` khỏi hằng sàn | int: D1b (×2) `expected 200 to be 403` · ME1 và L1w ở vế `repOwn` (mã 001 lọt vào danh sách) — ĐÚNG 4 ca; unit: U3; roundtrip `to have a length of 7 but got 6` |
| m2 | gỡ `SOCIAL_NEWS_UNACKED` khỏi hằng sàn | int: D2b (thông điệp nhận chuỗi `AUTH-ERR-SCOPE-DENIED` của nguồn) · ME2 · L2w ở vế `feedDept` — ĐÚNG 3 ca; unit: U4; roundtrip `… length of 7 but got 6` |
| m3 | handler 001 bỏ vế `meetsMinDataScope` (giữ hằng) | CHỈ D1b (×2) + U3 — ME1 · L1w vẫn xanh (tầng metadata còn sàn) |
| m4 | handler 002 bỏ vế sàn | CHỈ D2b ở assert THÔNG ĐIỆP (status vẫn 403 nhờ nguồn — vì thế K16) + U4 |
| m5 | handler 001 bỏ `gateWidgetOrThrow` (lấy cặp bằng `gatePairFor`) | D1a ở assert thông điệp · U5 |
| m6 | đổi cặp gate của 001 thành `view:feed` | S1 vế `onlyReport` (`expected 403 to be 200`) · ME1 · L1w (`emp` · `repOwn` nhận mã 001, `onlyReport` mất) · D1b (×2, `expected 200 to be 403` — `view:feed` của họ ở @Company) · D1a CHỈ ở thông điệp (status vẫn 403 nhờ tầng 2 của nguồn) |
| m7 | `unackedCount ?? 0` thay cho ném | U7 `promise resolved … instead of rejecting` |
| m8 | `SOCIAL: 0` → `300` | C1 · C2 (`expected true to be false` ở `cache.hit`; kéo theo X1 · X2a · X2b · E2 vì số cũ) · A1 · A2 ở `ttl_seconds` · U8 · U1 · U2 |
| m9 | identity của 002 thành `shareScope: "company"` | CHỈ U2 (`expected 'company' to be 'user'`) — HTTP không quan sát được dưới TTL 0, vì thế cần ca unit |
| m10 | `fetchEngagementWeek` trả thêm khoá lạ | A1 (`Object.keys` lệch) · U6 |
| m11 | (L1 tự chứng khối verify, không cần dựng lại lane) trong `BEGIN … ROLLBACK`: `UPDATE` một hàng SOCIAL cho lệch một trường (vd `is_system_widget = false`) rồi chạy lại toàn file `0592` | `ON CONFLICT DO NOTHING` giữ hàng lệch ⇒ khối verify PHẢI ném `[0592] verify: …` |
| m12 | FE: `useCanExact` → `useCan` ở cổng ngoài | F1-D2 · F2-D2 (`getWidgetData` bị gọi 1 lần) |
| m13 | FE: bỏ 1 dòng `WIDGET_COMPONENTS` | G1 |
| m14 | FE: bỏ 1 dòng `DASH_WIDGET_SLUG` (rồi build lại web-core) | ca ratchet slug `expected [ 'SOCIAL_…' ] to deeply equal []` |
| m15 | FE: nút dẫn của 001 không kiểm `view:feed` | F1-L vế DENY |
| m14b | FE: đổi MỘT ký tự trong giá trị slug của `DASH_WIDGET_SLUG` rồi build lại web-core (plan-review M1) | WC1 hoặc WC2 (`expected '/dashboard/widgets/…' to be '/dashboard/widgets/social-…'`) — ca ratchet «có tồn tại» vẫn xanh |
| m16 | BE: gỡ `@Header("Cache-Control", "no-store")` khỏi route `widgets/:slug` | C1 · C2 ở assert header (`expected undefined to be 'no-store'`) |
| m17 | BE: gỡ header khỏi route `widgets` | H1c |

## 6. Lát thi công

| Lát | Agent | Sau | File | Song song |
| --- | --- | --- | --- | --- |
| **L1** migration + sổ | `db-migration` | — | `harness/backlog.mjs` (§3.4: paths · zone · notes · seed `S16-SOCIAL-STATSPERF-1`) · `0592_…sql` · `meta/_journal.json` | không |
| **L2** BE RED → GREEN | `backend-builder` | L1 | §4.2 mục 1–9 · `T/dashboard-social-widgets.int-spec.ts` · `D/dashboard-widget-social.handlers.spec.ts` · 2 sổ pin BE (§5.5) | với L3 |
| **L3** FE RED → GREEN | `frontend-builder` | L1 | §4.3 · `F/social-widgets.spec.tsx` · `F/DashboardWidgetGrid.spec.tsx` · `packages/web-core/src/lib/dashboard-api.spec.ts` | với L2 |
| ~~L4 hiệu năng~~ | — | — | CẮT — O1 = C2 (owner 12/10); chuyển `S16-SOCIAL-STATSPERF-1` | — |
| **L5** kiểm toán mutant độc lập | `qa-test-engineer` | L2 · L3 | chỉ thêm ca vào 3 spec mới (+ `dashboard-api.spec.ts`) nếu có mutant sống | không |
| **L6** tài liệu + sổ vết | `doc-updater` | L5 | §4.4 · §10 của plan này | không |

Thứ tự đóng: L1 → (L2 ∥ L3) → L5 → **cổng review §9** → L6 → verify cuối → PR (cổng chạy TRƯỚC khi mở PR). Luật chung: mỗi lát commit ĐÚNG file của mình bằng đường dẫn tường minh (`git commit -m … -- <đường dẫn>`; không `git add -A`). L2 · L3 commit RED trước (spec + stub ném «chưa thi công»), dán dòng `Tests … failed` + 3 thông điệp đầu vào kết quả lát, rồi mới GREEN. Sửa một migration ĐÃ áp lên lane ⇒ báo điều phối chạy `lane-reset.sh` (script chỉ áp migration MỚI — memory `lane-db-setup-keeps-existing-db`).

```bash
bash "$BIN/heavy.sh" l1-migrate 420 'bash scripts/lane-db-setup.sh dash1'                              # ── L1
bash "$BIN/lane-psql.sh" "select count(*), max(created_at) from drizzle.__drizzle_migrations"        # 260|1717587381000
bash "$BIN/lane-psql.sh" "select count(*), string_agg(m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') m where c.conname='chk_dashboard_widgets_module_code'"   # 14|…,ROOM,SOCIAL,SYSTEM,TASK
bash "$BIN/lane-psql.sh" "select widget_code, module_code, widget_type, required_permission_code, default_data_scope, data_source_key, component_key, is_system_widget, status, sort_order from dashboard_widgets where company_id is null and module_code='SOCIAL' order by sort_order"   # đúng 2 hàng của §0
f="/c/dev 2/MediaOS-s19/apps/api/migrations/0592_s16socialdash1_widget_social.sql"; [ -s "$f" ] || { echo "THIẾU $f"; exit 1; }   # chạy lại tay — đường dẫn TUYỆT ĐỐI + chốt chặn (plan-review M5)
bash "$BIN/lane-psql.sh" "BEGIN; $(cat "$f")
 select count(*) from dashboard_widgets where company_id is null and module_code='SOCIAL';"   # không lỗi, in 2 — không ROLLBACK cuối (phiên đóng tự rollback) để phép đếm là câu CUỐI
bash "$BIN/lane-vitest.sh" l2-red 1 test/integration/dashboard-social-widgets.int-spec.ts              # ── L2 · RED trước khi viết handler
bash "$BIN/heavy.sh" l2-typecheck 480 'pnpm --filter @mediaos/api typecheck'
bash "$BIN/lane-vitest.sh" l2-unit 2 src/dashboard/dashboard-widget-social.handlers.spec.ts test/foundation/dashboard-scope-roundtrip.unit-spec.ts
bash "$BIN/lane-vitest.sh" l2-green 1 test/integration/dashboard-social-widgets.int-spec.ts
bash "$BIN/lane-vitest.sh" l2-reg-a 3 test/integration/dashboard-resolver.int-spec.ts test/integration/dash-seed-catalog-permissions.int-spec.ts test/integration/dashboard-payroll-v2-widgets.int-spec.ts
bash "$BIN/lane-vitest.sh" l2-reg-b 3 test/foundation/pipeline-parity.unit-spec.ts test/foundation/social-two-layer-guard-census.unit-spec.ts test/foundation/supertest-listen-ratchet.unit-spec.ts
bash "$BIN/heavy.sh" l2-lint 420 'pnpm --filter @mediaos/api exec eslint src/dashboard src/social/social.module.ts test/integration/dashboard-social-widgets.int-spec.ts'
( cd "/c/dev 2/MediaOS-s19" && wc -l apps/api/src/dashboard/dashboard-widget-catalog.const.ts apps/api/src/dashboard/dashboard-default-config.const.ts apps/api/src/dashboard/dashboard-widget-handlers.service.ts apps/api/src/dashboard/dashboard-widget-social.handlers.ts apps/api/test/integration/dashboard-social-widgets.int-spec.ts )   # mọi file < 800 — PHẢI đứng trong worktree (shell có thể mở ở checkout chính)
bash "$BIN/heavy.sh" l3-contracts 300 'pnpm --filter @mediaos/contracts build'                            # ── L3
bash "$BIN/heavy.sh" l3-webcore 300 'pnpm --filter @mediaos/web-core build'                              # BẮT BUỘC sau khi sửa dashboard-api.ts
bash "$BIN/heavy.sh" l3-webcore-test 300 'pnpm --filter @mediaos/web-core exec vitest run src/lib/dashboard-api.spec.ts'   # ghim GIÁ TRỊ slug (WC1 · WC2)
bash "$BIN/heavy.sh" l3-test 420 'pnpm --filter @mediaos/app exec vitest run src/components/dashboard/social-widgets.spec.tsx src/components/dashboard/DashboardWidgetGrid.spec.tsx'
bash "$BIN/heavy.sh" l3-typecheck 480 'pnpm --filter @mediaos/app typecheck'
bash "$BIN/heavy.sh" l3-lint 420 'pnpm --filter @mediaos/app exec eslint src/components/dashboard src/routes/dashboard src/i18n/locales/vi/dashboard.ts'
bash "$BIN/heavy.sh" l3-reg 480 'pnpm --filter @mediaos/app exec vitest run src/components/dashboard src/routes/dashboard src/routes/social/feed/components'
bash "$BIN/heavy.sh" l3-build 540 'pnpm --filter @mediaos/app build'
bash "$BIN/check-all.sh" verify-all        # ── verify cuối (điều phối, chạy nền): kết luận phải là XANH, không phải «XANH KHÔNG ĐỦ BẰNG CHỨNG»
```

## 7. Ngoài phạm vi / nợ (ghi vào thân PR; KHÔNG làm trong WO này)

- **N1** `/feed/news` chưa có bộ lọc «chưa xác nhận» qua URL, và `NewsPage.tsx:247-250` không làm mới khoá widget của Dashboard sau khi xác nhận ⇒ quay lại Dashboard trong 15 giây (`F/useDashboardWidget.ts:51`) còn thấy số cũ. Đề xuất WO FE nhỏ.
- **N2** Hai WO láng giềng đang READY, KHÔNG giẫm: **`S4-DASH-HROVERVIEW-FLOOR-1`** (🔴 sàn + tín hiệu scope cho FE của `HR_OVERVIEW`) — WO này không dựng cơ chế tín hiệu scope, không đụng `HR_OVERVIEW`, không sửa chú thích `catalog.const.ts:426-431` (nhắc hàm `gateMinScope` không tồn tại); **`S4-DASH-WIDGETCARD-VARIANT-1`** (🟡) — không sửa `WidgetCard` / `useDashboardWidget`. Cả hai cùng chạm `D/**` · `F/**` ⇒ làm TUẦN TỰ sau khi PR này merge.
- **N3** Số liệu sau khi XOÁ NHÓM (tin trong nhóm · số liệu tuần) chưa được đo ở NGUỒN (`QA1-S-G` không đo hai con số này) ⇒ thuộc WO nợ test `S16-SOCIAL-QADEBT-1`, không phải lớp widget.
- **N4** Lớp cache DASH: kết quả `Empty` được lưu rồi trả lại thành `Active` + `{}` ở lượt hit (`D/dashboard-widget-data.service.ts:345-347` — mới ĐỌC MÃ, chưa tái hiện); dính mọi widget đếm có TTL > 0, KHÔNG dính hai widget này. Đề xuất WO riêng.
- **N5** Lệch tài liệu có sẵn: SPEC-07 §19 ghi `DASH-ERR-FORBIDDEN` (mã thật `AUTH-ERR-FORBIDDEN`); DB-07 `:1066` còn DDL CHECK 8 module. `S16-SOCIAL-DOC-3` (todo) sở hữu các đính chính khác của SPEC-16 / API-19 — WO này chỉ sửa §17.3 và hai câu về widget.
- **N6**  Vết audit per-view cho widget: không làm (052 đọc không audit; hai widget chỉ chở số đếm).
- **N7** (O1 = C2 — owner chốt 12/10) L1 SEED `S16-SOCIAL-STATSPERF-1` (🔴; `deps`: `S16-SOCIAL-DASH-1`; `paths`: `apps/api/src/social/social-stats.repository.ts` · `apps/api/src/db/schema/social.ts` · `apps/api/migrations/**` · `apps/api/test/**` · `docs/DB/**` · `docs/SPEC/SPEC-16*.md` · `docs/plans/**` · `harness/backlog.mjs`). `done_when`: (1) ĐO TRƯỚC trên bảng THẬT của lane dưới vai app + FORCE RLS: `EXPLAIN (ANALYZE, BUFFERS)` câu hiện tại với dữ liệu gieo CÓ hàng `companies` (biên `lo`/`hi` không NULL) và `count(*)` từng nhánh > 0, lệnh gieo đi qua khoá lệnh nặng của máy; (2) mig 2 chỉ mục thời gian (`feed_comments (company_id, created_at) WHERE deleted_at IS NULL` · `feed_reactions (company_id, created_at)`) đặt TRƯỚC mọi migration giữ khoá ACCESS EXCLUSIVE trong cùng lượt, kèm viết lại CTE `ev` (biên vô hướng · quét bảng gốc theo dải · tách nhánh cảm xúc theo `target_type`); (3) `(<câu cũ>) EXCEPT ALL (<câu mới>)` và chiều ngược lại đều 0 hàng cho ba bộ lọc `all` · `units` · `none`; 22 ca `social-be3b-engagement-stats`, ca xoá mềm của QA-1 và ca X1 của widget không đổi số; (4) ghim `indexdef` NGUYÊN CHUỖI của 2 chỉ mục (với `feed_comments` chỉ `indexdef` gác được — chỉ mục cũ cũng dẫn bằng `company_id` nên ca «không Seq Scan» không thể đỏ) và vế `created_at` của nhánh cảm xúc nằm trong `Index Cond`. `notes`: số đo M11 của plan này (411 ms → thêm chỉ mục 323 → viết lại 12; bảng TẠM 310.000 hàng, mỗi biến thể một lượt, superuser không RLS) · ngưỡng mở: trước khi `feed_reactions` của một công ty vượt khoảng 50.000 hàng, hoặc khi Dashboard của quản lý chậm thấy được · công tắc vận hành ở §8. Đóng wave S16 (regen STATUS · memory) là việc của điều phối SAU merge.

## 8. Rủi ro + kích thước

| Rủi ro | Giảm thiểu |
| --- | --- |
| **Xanh-giả do cổng chồng** — nguồn SOCIAL cũng 403 khi thiếu cặp / dưới sàn ⇒ gỡ cổng của DASH mà ca DENY chỉ-status vẫn xanh | K16 (assert thông điệp) + mutant riêng từng vế m3 · m4 · m5 |
| **DENY rỗng** — trước khi thi công, «VẮNG trong `/dashboard/me`» đúng một cách tầm thường | mỗi vế VẮNG đứng cạnh vế CÓ cùng request, cùng loại dashboard (ME1 · ME2) |
| TTL 0 chưa có tiền lệ runtime | C1 · C2 đo trên đường thật; m8 |
| Hai sổ pin nằm xa mã, chỉ đỏ ở job test nặng (S15 đỏ CI sau khi mở PR) | nằm trong danh sách file của L2 + lệnh `l2-unit` · `l2-reg-a` |
| `dist` cũ của web-core ⇒ ratchet slug đỏ oan / typecheck chạy trên bản cũ | `l3-webcore` trước `l3-test` |
| Deploy sai thứ tự (boot trước migrate) ⇒ seeder ném, chỉ để lại log | ghi vào thân PR + sổ vết; sau deploy đo `select count(*) from dashboard_widget_configs c join dashboard_widgets w on w.id = c.widget_id where w.module_code = 'SOCIAL'` (= 8 × số công ty) |
| Lệch bản FE ↔ API lúc deploy (FE tự lên, API deploy tay) | an toàn theo cấu trúc: API cũ không trả mã mới ⇒ Grid không mount; FE cũ bỏ qua mã lạ (`F/DashboardWidgetGrid.tsx:70-72`) ⇒ KHÔNG có điều kiện thứ tự merge |
| Chi phí: pha plan đã tiêu 202 USD (khung đầu 150–300) | owner chọn lại 12/10 ~14:50: cắt L4, khung mới TỔNG 450–550 USD tới khi mở PR; điều phối đo bằng `cost.mjs` sau L2 + L3 và sau cổng review — ước vượt 550 thì hỏi owner TRƯỚC khi chạy bước kế |
| Câu thống kê không cache chạy ở MỖI lượt mở Dashboard của quản lý · HR · admin (O1 = C2) | owner chấp nhận khi dữ liệu còn nhỏ. Công tắc vận hành không cần deploy (ĐỌC MÃ `D/dashboard-widget-registry.service.ts:140-141`, CHƯA ĐO): `UPDATE dashboard_widgets SET status = 'Inactive' WHERE company_id IS NULL AND widget_code = 'SOCIAL_ENGAGEMENT_WEEK'` (superuser) ⇒ widget rời `/dashboard/me`; đường gọi thẳng slug vẫn mở theo quyền. Trả nợ ở `S16-SOCIAL-STATSPERF-1` |

**Kích thước ước tính** (tiền lệ `324ec824`: 22 file, +1.607 dòng): migration ≈ 150 · BE nguồn ≈ 260 (handler 135 · catalog + default-config ròng +60 · nối dây 25 · câu thống kê ≈ 60 đổi) · BE test ≈ 800 (int ≈ 560 · unit ≈ 160 · chỉ mục ≈ 80) · FE nguồn ≈ 290 · FE test ≈ 370 · tài liệu ≈ 60 ⇒ plan v1 ≈ 1.900 dòng / ≈ 34 file; **v2 (đã cắt L4) ≈ 1.650 dòng, ≈ 31 file**.

## 9. Cổng review — chọn theo ĐƯỜNG DẪN file sản phẩm bị đổi (chạy sau L5, TRƯỚC khi mở PR)

Trước khi gọi: `git diff --name-only f66c94d9..HEAD -- apps packages | grep -v -E "spec\.tsx?$"` rồi đối chiếu bảng dưới; file sản phẩm nào không có reviewer tương ứng ⇒ thêm reviewer, không bỏ qua.

| Reviewer | Phạm vi | Câu hỏi KHÔNG đo được bằng một lệnh |
| --- | --- | --- |
| `database-reviewer` | `0592` · `meta/_journal.json` | (1) Chốt tiền đề + DROP/ADD CHECK: còn đường nào làm mất một giá trị hoặc để lọt hàng vi phạm không? (2) Khối verify có thật sự đỏ khi `ON CONFLICT DO NOTHING` giữ một hàng cũ lệch trường không? (3) `SET LOCAL lock_timeout` có rò sang migration sau trong cùng transaction không; khoá ACCESS EXCLUSIVE trên `dashboard_widgets` giữ bao lâu? |
| `security-reviewer` | `D/dashboard-widget-catalog.const.ts` · `D/dashboard-widget-social.handlers.ts` · `D/dashboard.module.ts` · `S/social.module.ts` · `D/dashboard-widget-data.controller.ts` (header `no-store`) · hai component FE | (1) Có cấu hình quyền nào CHƯA ai tạo hôm nay làm widget phục vụ số ngoài phạm vi người xem: nhiều grant khác scope · ALLOW + DENY · wildcard `*:*` / `view:*` · scope `System`? (2) Export `SocialNewsService` đưa `ack` · `listAcks` vào tầm với của DASH — chấp nhận hay cần lớp bọc hẹp? (3) Hai tầng sàn có thật đọc CÙNG hằng không; đường gọi thẳng slug với `dashboard_type` tuỳ ý có vòng qua được không? (4) Số gộp của 001 gồm cả bài nhóm kín mà người xem không đọc được nội dung (giống 052) — số đếm có là rò không? |
| `silent-failure-hunter` | handler + nhánh lỗi FE | (1) Đường nào biến lỗi thành 0 / `Empty` (`??`, `catch`, `null`, mảng rỗng, schema FE có `.catch` / default)? (2) Lỗi lúc `cache.upsert` (ghi một hàng vô dụng dưới TTL 0) biến lượt đọc thành công thành `Degraded` — có đáng tách không? (3) Seeder ném khi thiếu hàng catalog chỉ để lại log — người vận hành biết bằng cách nào? |
| `typescript-reviewer` + `react-reviewer` | toàn diff TS · 2 component + spec | (1) Hook có bị gọi sau `return null` / có điều kiện không? (2) Có `as` nào che lỗi kiểu ngoài `as "/"` của đích điều hướng không? (3) Trợ năng: nút dẫn có tên; 4 số đọc được bằng cặp `dt`/`dd`; không dựa vào màu. (4) Tách chuỗi `weekStart` có an toàn với chuỗi lạ không (rơi về nhánh lỗi hay vẽ rác)? |
| `quality-gate` | toàn diff | file < 800 dòng · hàm < 50 dòng · không `console.log` · không `@ts-ignore` / `eslint-disable` |

Không thêm `santa-method`: phần cổng/sàn là chép khuôn đã qua FULL gate ở S11 · S13 · S15, diff sàn = 2 dòng hằng + 1 helper; nếu `security-reviewer` trả phát hiện HIGH trở lên thì điều phối bật vòng hai trên bản vá. Mỗi phát hiện: xác minh lại bằng mã trước khi vá; mỗi bản vá có ca RED đo thật; commit vá cũng phải qua reviewer của đường dẫn nó chạm. Quyết định miễn này nằm ở sổ vết §10 (plan-review L1).

## 10. Sổ vết (bước sau điền; ô trống = CHƯA làm, không phải «không cần»)

| Bước | Ngày · commit | Kết quả đo (lệnh · số ca · thông điệp) | Ghi chú |
| --- | --- | --- | --- |
| Plan v1 | 12/10/2026 · `8fce9670` | §1.2 M1–M14 | — |
| Plan-review | 12/10/2026 · trên `8fce9670` | PASS_WITH_FIXES: 1 HIGH · 6 MEDIUM · 4 LOW (0 BLOCKER) | nhận cả 11 — bảng §11; plan v2 = commit kế |
| Owner trả lời O1–O5 | 12/10/2026 ~14:50 (hộp hỏi) | O1 = **C2** — cắt lát hiệu năng, widget 001 vẫn bật mặc định; khung chi phí mới TỔNG 450–550 USD | O2–O5 chưa trả lời ⇒ làm theo cột «mặc định», liệt kê trong thân PR |
| L1 — migrate lane + 5 lệnh đo | 12/10 · `0776e6f2` (backlog) + `d43f5e99` (mig `0592`) | lane: 260 migration, `when` cuối 1717587381000 · CHECK 14 giá trị có SOCIAL · đúng 2 hàng của §0 · chạy lại cả file: `INSERT 0 0`, in 2 · tooling tests 185/185 · backlog 611 → 612 mục | hai phép chứng «cổng có thể đỏ»: làm lệch một trường ⇒ `[0592] verify: …` · thêm giá trị lạ vào CHECK ⇒ `[0592] precheck: …` |
| L2 — RED → GREEN + hồi quy + `wc -l` | 12/10 · `9975a17c` RED (int 25/25 đỏ · unit 28/28 đỏ, đều vì hành vi chưa có) → `dd51c676` GREEN | int 25/25 · unit 28/28 · 18 int-spec `dash*` + 3 spec ngoài tiền tố + ratchet nền xanh (12 lượt × 3 file) · typecheck sạch · `wc -l`: catalog 739 · default-config 120 · handlers.service 784 · social.handlers 181 · int-spec 678 | 403 trên dây KHỚP K16: `AUTH-ERR-FORBIDDEN: thiếu quyền <cặp>` / `… ở phạm vi đủ rộng`, `error.code` = `AUTH-ERR-FORBIDDEN`; `HAND_ROLLED_BASELINE` giữ 269 |
| L3 — RED → GREEN + build | 12/10 · worktree FE riêng: `6a37e73b` RED (31 ca đỏ) → `8d36e5b9` GREEN; cherry-pick về nhánh chính thành `6dbe4cf2` + `20d819cb` | FE 36 + 9 ca · slug 25 ca · typecheck + eslint + build app xanh; trên cây ghép: FE 45/45 · web-core 25/25 · typecheck app xanh | lệch plan có chủ ý: hằng `DASH_SOCIAL_ENGINE_PAIRS` thay literal lặp · nút dẫn của 001 là phần tử riêng (K11) |
| L4 | — | CẮT — O1 = C2 | nợ chuyển `S16-SOCIAL-STATSPERF-1` (seed ở L1) |
| L5 — mutant (script của điều phối, không agent) | 12/10 · trên `20d819cb`, rồi `f4f72491` | **0 mutant sống.** BE: m3 + m4 (hàm chung) · m5 · m6 · m7 · m8 · m9 · m10 · m16 · m17 — 9/9; m1 · m2 chạy riêng — 2/2 (mỗi cái 8 ca đỏ: ba bề mặt + unit + roundtrip). FE: m14 · m14b — 2/2; m12 · m13 · m15 do L3 đo gộp (5 ca đỏ đúng kỳ vọng). L1: m11 + chốt tiền đề. Bản vá sau cổng: 13/13 (vòng 2: 8 · vòng 3: 5) | đáng nhớ: bỏ vế sàn ở handler ⇒ người scope Own nhận 200 «Empty» · bỏ `gateWidgetOrThrow` ⇒ chỉ THÔNG ĐIỆP đổi · m14b: ca ratchet «có tồn tại» vẫn xanh, chỉ ca ghim giá trị slug đỏ |
| Gate §9 (từng reviewer) | 12/10 · trên `20d819cb` | 4/4 PASS_WITH_FINDINGS — **0 CRITICAL · 0 HIGH** · 2 MEDIUM · ~20 LOW (7 có sẵn): `ecc:database-reviewer` 3 LOW · `security-reviewer` 4 LOW · `ecc:silent-failure-hunter` 2 MEDIUM + 7 LOW · `ecc:typescript-reviewer` (kiêm React) 10 LOW | xử lý ở §12; bản vá `f58ed93b` (RED: 5 ca BE + 6 ca FE đỏ đúng thông điệp) + `f4f72491` (GREEN: unit 35 · int 25 · FE 44 + 9; sau review hẹp: FE 47 + 9); review hẹp bản vá (`ecc:typescript-reviewer` trên `20d819cb..f4f72491`): PASS_WITH_FINDINGS — 0 CRITICAL / HIGH · 1 MEDIUM · 3 LOW, đều ở ca test + chú thích ⇒ vá ở `a9d952ec` |
| `santa-method` | — | MIỄN theo §9 | bật vòng hai khi `security-reviewer` trả phát hiện HIGH trở lên |
| L6 — tài liệu | 12/10 · commit sổ kế tiếp | SPEC-16 §17.3 (bảng 5 cột + 9 gạch) + dòng NFR thống kê · API-19 (hai câu về widget) · TESTABLE-FEATURES §5k | điều phối tự sửa (không agent) |
| Verify `check-all.sh` | 12/10 · trên `ed57d3d1` (commit làm việc trước khi gộp), lane `mediaos_dash1` vừa dựng lại sạch | `check.sh --all --lane-db=dash1`: **XANH 9/9** trong 15 phút — api 846/846 file (9 lần chạy lại vì crash hạ tầng của máy, 0 ca đỏ) · app 398/398 · web-core 50/50 · contracts 45/45 · ui 24/24 · console 22/22 · auth 4/4 · build 7/7 · gitleaks 13 commit sạch | kết luận «XANH», không phải «XANH KHÔNG ĐỦ BẰNG CHỨNG» |
| PR | 12/10 · `02cf70c2` (#582) | mở từ nhánh `feat/s16-social-dash-1` — MỘT commit gộp. CI của PR XANH 12/10 18:21: 11 check pass · 3 bỏ qua đúng (deploy · release notice · fbpost); job «Build · Typecheck · Migrate · Test» CÓ chạy `dashboard-social-widgets.int-spec.ts` 25/25 + `handlers.spec` 35/35 | owner squash-merge `--admin` 13/10 09:37 = `9f18bf6a`; CI master xanh (5 workflow); job Pages xong 13/10 09:50 ⇒ FE lên PROD trước API |
| Deploy PROD: đếm 3 bảng feed TRƯỚC · migrate → boot · đo config SOCIAL SAU | 14/10 · `85c3b28d` | owner chạy `m prod-update api` cùng lượt deploy của #584 (bước migrate fail-closed của lệnh chạy TRƯỚC restart). `/api/v1/health` 14:34: `build.commit` = `85c3b28d` (chứa `9f18bf6a`) · `migrationHead` = `0592_s16socialdash1_widget_social` · build 14:33 | **Lệch plan:** KHÔNG đếm 3 bảng `feed_*` trước deploy (owner chạy thẳng lệnh deploy). CÒN: đo `dashboard_widget_configs` của SOCIAL = 8 × số công ty + xem hai ô bằng mắt — owner |

## 11. plan-review lượt 1 — xử lý (12/10/2026 · PASS_WITH_FIXES · nhận cả 11, 0 bác)

| # | Mức | Phát hiện | Xử lý ở v2 |
| --- | --- | --- | --- |
| H1 | HIGH | X2 sai luật khôi phục: tác giả tự xoá ⇒ 058 trả `hidden`, số của người xem không tăng lại | Điều phối mở `S/social-counters.ts:105-130` kiểm lại — ĐÚNG. Tách X2a (`admin` xoá ⇒ `published`) / X2b (tác giả xoá ⇒ `hidden` ⇒ bỏ ẩn mới +1); thêm actor `admin` (§5.1) |
| M1 | MEDIUM | Giá trị slug phía FE không ca nào ghim | Thêm WC1 · WC2 ở `packages/web-core/src/lib/dashboard-api.spec.ts` + lệnh `l3-webcore-test` + mutant m14b |
| M2 | MEDIUM | Ca P2 (chỉ mục) không thể đỏ | Hết đối tượng — L4 bị cắt (O1 = C2); luật «chỉ `indexdef` gác được `feed_comments`» chép vào seed `S16-SOCIAL-STATSPERF-1` (N7) |
| M3 | MEDIUM | Bench L4 chạy ngoài khoá · có thể thiếu hàng `companies` · chưa so kết quả cũ ≡ mới | Hết đối tượng — L4 cắt; ba điều kiện chép vào `done_when` của `S16-SOCIAL-STATSPERF-1` (N7) |
| M4 | MEDIUM | Cắt L4 trái bàn giao (c) «trước khi bật widget»; số phận `0593` | Owner KÝ chấp nhận qua hộp hỏi 12/10 (O1 = C2, widget 001 bật mặc định); không còn `0593`; thêm công tắc vận hành (§8) + câu đếm 3 bảng feed trước deploy (§4.1) |
| M5 | MEDIUM | Lệnh đo dùng đường dẫn tương đối, `cat` lỗi vẫn «in 2» | Lệnh chạy lại `0592` và `wc -l` dùng đường dẫn tuyệt đối + chốt `[ -s "$f" ]`; bỏ `ROLLBACK` cuối (§6) |
| M6 | MEDIUM | «Không cache» chưa chốt header HTTP · hàng cache · `staleTime` của FE | Phương án A: `@Header("Cache-Control", "no-store")` ở hai route widget (K6 · §4.2 mục 9 · ca C1 · C2 · H1c · mutant m16 · m17); hàng cache + 15 giây của FE ghi rõ là ngoài nghĩa «không cache» ở SPEC-16 §17.3 |
| L1 | LOW | WO vẫn `green` / «LIGHT gate»; miễn `santa-method` chưa vào sổ | L1 đổi `zone` → `red` + sửa notes (§3.4); dòng `santa-method` ở §10 |
| L2 | LOW | `toContain` khớp nhầm chuỗi dưới-sàn; thứ tự E1 / E2 | Bốn ca DENY assert `toBe` nguyên chuỗi; ghi thứ tự E1 trước T1, E2 cuối nhóm W2 (§5.2) |
| L3 | LOW | Thứ tự hai migration kéo dài khoá; thiếu công tắc tắt widget | Chỉ còn MỘT migration; công tắc `status = 'Inactive'` ở §8 (đọc mã, chưa đo) |
| L4 | LOW | M9 đếm sai · N3 thiếu id · `docs/erd-current.md` | M9 = 18 + 3; N3 ghi `S16-SOCIAL-QADEBT-1`; `erd-current.md` cố ý không sửa (§4.4) |

## 12. Cổng review — xử lý (12/10/2026 · 4/4 PASS_WITH_FINDINGS · 0 CRITICAL / HIGH)

| # | Mức | Phát hiện | Xử lý |
| --- | --- | --- | --- |
| SFH-1 | MEDIUM | FE không ca nào cho nhánh `getWidgetData` reject | VÁ — ca F1-N · F2-N; mutant bỏ cả `isError` lẫn `bodyMissing` ⇒ đỏ đúng hai ca đó |
| SFH-2 | MEDIUM | Unit chỉ ghim một nửa «không nuốt lỗi» của mỗi handler | VÁ — U6 thêm ca nguồn ném `ForbiddenException`; U7 thêm ca nguồn ném `Error` thường |
| SFH-5 | LOW | Chốt của `fetchNewsUnacked` chỉ bắt `null` | VÁ (RED trước, 5 ca đỏ) — phải là số nguyên ≥ 0, còn lại NÉM |
| SFH-3 · TS-04 | LOW | Thẻ `Active` thiếu payload / `Hidden` vẽ tiêu đề với ruột trống | VÁ (RED trước) — `bodyMissing` ⇒ nhánh lỗi; `Hidden` ⇒ không vẽ; ca F1-B · F2-B · F1-H · F2-H |
| TS-07 | LOW | Số và nhãn dính liền trong nút («3tin…») | VÁ (RED trước) — khoảng trắng thật; ca F2-T đo `textContent`. Đo bằng tên trợ năng của Testing Library là ca KHÔNG THỂ đỏ trên jsdom (đã đo: xanh trên mã chưa vá) |
| TS-01 | LOW | `formatWeekStart` nhận ngày không tồn tại (30/02) | VÁ (RED trước) — kiểm bằng số học UTC, chỉ để xác thực |
| DB-1 | LOW | «Khoá chỉ vài ms» chỉ đúng khi 0592 là migration pending cuối | VÁ chú thích migration + ghi chú deploy ở thân PR và hàng «Deploy PROD» |
| DB-2 | LOW | Khối Down không lùi sổ của migrator | VÁ chú thích: vai chạy · CASCADE · xoá hàng của `drizzle.__drizzle_migrations` · UUID mới |
| DB-3 · SFH-9 | LOW (có sẵn) | Thông điệp seeder trỏ «migration 0484» | VÁ — câu trung tính «migration thêm widget này vào catalog chưa chạy» |
| SEC-L2 | LOW | Bẫy khi nới TTL SOCIAL > 0 (khoá cache thiếu tuần; lượt hit làm mất `Empty`) | VÁ chú thích cảnh báo cạnh hằng TTL |
| TS-06 | LOW | «11/11 mutant» chưa gồm m1 · m2 · m11 · m12 · m13 · m15 trong file báo cáo | Chạy riêng m1 · m2; hàng L5 của §10 ghi nguồn đo của từng nhóm |
| SEC-L1 | LOW | Chưa có ca int cho wildcard / đa grant / ALLOW + DENY trên hai widget | NỢ — ghi thân PR (đúng nhờ cấu trúc: cùng `can()` + cùng hằng sàn ở hai tầng) |
| SEC-L3 | LOW | Export nguyên `SocialNewsService` (kéo theo `ack` · `listAcks`) | CHẤP NHẬN — mọi method tự chạy tầng 2; lớp bọc hẹp là tuỳ chọn |
| SFH-4 | LOW | TTL 0 vẫn ghi một hàng cache mỗi lượt; lượt ghi lỗi ⇒ lượt đọc thành `Degraded` | NỢ — nằm ở runner dùng chung, ngoài phạm vi |
| TS-02 · TS-03 | LOW | int-spec đỏ oan nếu lượt chạy vắt qua 00:00 thứ Hai; ca sau dựa trạng thái ca trước | NỢ — ghi thân PR (cửa sổ khoảng 12 giây mỗi tuần) |
| TS-05 · TS-08 | LOW | Đích nút dẫn chưa buộc vào `ROUTE_REGISTRY`; ép kiểu trong fixture test | NỢ — đi cùng N1 |
| RN-1 (review hẹp) | MEDIUM | Sau bản vá, F1-N / F2-N không còn ghim RIÊNG vế `isError` (`bodyMissing` cũng bật ở lần tải đầu bị reject) | VÁ — ca F1-R · F2-R: refetch thất bại khi ĐÃ có số ⇒ nhánh lỗi; mutant «bỏ riêng `isError`» ⇒ đỏ đúng ca đó |
| RN-2 (review hẹp) | LOW | Docblock còn ghi «KHÔNG `new Date`»; tính «chỉ UTC» của phép kiểm ngày chưa ca nào ghim | VÁ — sửa hai chú thích + ca F1-TZ (múi giờ âm, có tự kiểm tiền đề); mutant đọc bằng getter local ⇒ đỏ |
| RN-3 (review hẹp) | LOW | Chú thích F2-T nói quá rộng về `textContent` | VÁ — thu hẹp về ranh giữa hai phần tử inline |
| RN-4 (review hẹp) | LOW | Hai ca «nguồn ném ⇒ reject bằng chính lỗi đó» chưa có phép đo đỏ | ĐO — mutant nuốt lỗi nguồn của từng handler ⇒ mỗi cái đỏ đúng 2 ca |
| SEC-L4 · SFH-6 · SFH-7 · SFH-8 · TS-09 · TS-10 | LOW (có sẵn) | `collectTx` nhận actor từ người gọi · runner không log khi hạ `Degraded` · `Number(row?.n ?? 0)` ở nguồn 020 · nút «Làm mới» lỗi im lặng · khuôn gate chép lần thứ năm · file registry 784 dòng | NỢ có sẵn — liệt kê ở thân PR, không thuộc WO này |