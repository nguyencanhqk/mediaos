# S16-SOCIAL-BE-3B — thống kê tương tác (052) · xuất XLSX (053) · hàm service cho SOCIAL-WIDGET-001

> Zone 🔴 **red** · **FULL gate** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) — nâng từ amber
> theo plan-reviewer v1 (#1): thêm 2 route `companyFloor:false` + vị từ Department viết tay + ghi audit; tiền lệ duy nhất
> (`reportsList`, BE-1B) là red/crown. Deny-path RED trước; trước PR chạy `bash harness/check.sh --all` (REQUIRE_LANE_DB).
> Tách từ `S16-SOCIAL-BE-3` ngày 28/09/2026. **Plan v2** — vá plan-reviewer v1 (4 chặn + 9 cảnh báo); v2 PASS, 3 cảnh báo đã gộp (W1–W3).

## 0. Khảo sát — có sẵn / còn thiếu

| Có sẵn | Ở đâu |
| --- | --- |
| Cặp `view:feed-report` đã seed: `hr` + `company-admin` @Company, `manager` @Department | `0578` |
| Tiền lệ route `companyFloor:false` + `dataScope:"Department"` + `switch` vét cạn (`Own`/`Team` ⇒ 0 hàng, không ném) | `social-route-pairs.const.ts:204` · `social-reports.repository.ts:167-187` |
| `resolveActor(user, routeKey)` — tầng 2 + `routeScope` + `orgUnitIds` (đơn vị của actor ∪ đơn vị actor đứng đầu, KHÔNG cây con). Tự mở tx riêng (`resolveManyOrNull`) ⇒ gọi NGOÀI `withTenant` của câu thu thập | `social-access.service.ts:108-218` |
| Khuôn báo cáo set-based: LATERAL «đơn vị hiện tại» · TZ công ty `coalesce(companies.timezone, registry)` · `rowsOf` | `payroll/payroll-report.sql.ts:21-56,171` |
| Khuôn xuất: `collectTx` dùng chung với route đọc · audit ĐÚNG 1 hàng cùng tx · `exceljs` import động · `xlsxSafe` | `payroll/payroll-report-export.service.ts` · `payroll/payroll-xlsx.util.ts` |
| `audit_logs.object_type` bị CHECK ở DB (SOCIAL: `feed_post · feed_comment · feed_group · feed_report · feed_kudos_badge`); `entity_type` là varchar tự do; audit SOCIAL mang `action:"social.*"`, `moduleCode:"SOCIAL"`, `entityType` | `db/schema/audit.ts:43,406-438` · `social-reports.service.ts:357-367` |
| ⚠️ **Cảm xúc KHÔNG bị dọn khi xoá mềm BÀI** — `clearForTarget` chỉ có 1 caller (xoá bình luận, `social-comments.service.ts:367`); `softDeletePostTx` không đụng `feed_reactions` và bài khôi phục được (`restorePostTx`) | `social-counters.ts:118,166-209` |
| `feed_groups.deleted_at` (xoá mềm nhóm, không cột status) | `schema/social.ts:519` |

**Không cần migration** (D8). Không bảng/cột mới, không seed quyền mới.

## 1. Quyết định

| # | Quyết định |
| --- | --- |
| D1 | **Tham số `052`/`053`** (contracts `social-api-stats.ts`, `.strict()`): `from?`, `to?` (`YYYY-MM-DD`), `orgUnitId?` (uuid). `from`/`to` đi CÙNG nhau; `from ≤ to`; **nắn trong Zod** (số học lịch thuần, không phụ thuộc TZ): `from` → thứ Hai tuần chứa nó, `to` → Chủ nhật tuần chứa nó (tuần ISO); sau nắn ≤ **26 tuần** — mọi vi phạm ⇒ 400 tại pipe. **(W2) Số học lịch UTC thuần** (`Date.UTC` + `getUTCDay`/`setUTCDate`, cấm getter local) — kết quả không phụ thuộc TZ máy chủ. Schema `.transform` trả `{from, to}` ĐÃ nắn. Vắng cả hai ⇒ mặc định **8 tuần tới hết tuần hiện tại** theo TZ công ty — câu scalar ở SQL (`today` theo TZ ⇒ nắn). Response trả `range {from, to, weeks}` đã nắn. |
| D2 | **Quy thuộc đơn vị = đơn vị HIỆN TẠI của NGƯỜI THỰC HIỆN** (tác giả bài/bình luận, người thả cảm xúc) qua LATERAL `employee_profiles` sống mới nhất, ghim `e.company_id = ev.company_id`. KHÔNG theo `feed_posts.org_unit_id`. Không hồ sơ/không đơn vị ⇒ nhóm `orgUnitId:null`. Đổi đơn vị thì lịch sử đi theo người. Hoạt động trong nhóm riêng tư quy về đơn vị của tác giả — CHỈ số đếm, không nội dung (ghi API-19). |
| D3 | **Định nghĩa «còn sống» — MỘT CTE `alive_posts` dùng cho cả ba nguồn:** `feed_posts` `company_id=$c AND deleted_at IS NULL AND status <> 'deleted' AND (group_id IS NULL OR nhóm còn sống)` (JOIN `feed_groups` ghim `company_id`, `deleted_at IS NULL`). `hidden` VẪN tính (hoạt động đã xảy ra); mọi `type`/`audience`. **posts** = `alive_posts` (mốc `created_at`). **comments** = `feed_comments` `deleted_at IS NULL` JOIN `alive_posts` (ghim `company_id`). **reactions** = `feed_reactions` mà đích còn sống: `target_type='post'` JOIN `alive_posts`; `target_type='comment'` JOIN bình luận sống JOIN `alive_posts` — mọi JOIN ghim `company_id`. Mọi emoji. Bỏ cảm xúc = xoá cứng hàng ⇒ `reactions` nghĩa là «cảm xúc HIỆN còn», không phải «sự kiện thả» (ghi API-19). `activeMembers` = `COUNT(DISTINCT user_id)` trên hợp ba tập. **(W1) `alive_posts` CHỈ là bộ lọc «còn sống», KHÔNG mang khoảng thời gian** — khoảng áp riêng trên `created_at` của CHÍNH nguồn (bài / bình luận / cảm xúc); bình luận/cảm xúc trong khoảng trên bài tạo TRƯỚC khoảng vẫn tính. (W3) Cảm xúc trên một trả lời còn sống vẫn tính dù bình luận cha đã xoá mềm (trả lời không bị xoá theo) — ghi API-19. |
| D4 | **Hình câu (MỘT câu cho khối số liệu):** `tz` = scalar `coalesce(c.timezone, <mặc định registry>)` từ `companies c WHERE c.id=$c AND c.deleted_at IS NULL` (công ty xoá mềm ⇒ NULL ⇒ 0 hàng, fail-closed). Lọc khoảng **nửa mở** ở từng nguồn: `created_at >= ($from::timestamp AT TIME ZONE tz) AND created_at < (($to + 1)::timestamp AT TIME ZONE tz)`. CTE `ev(company_id, kind, user_id, created_at)` = UNION ALL ba nguồn → LATERAL đơn vị → lọc scope (D5) → `week = date_trunc('week', ev.created_at AT TIME ZONE tz)::date` → `GROUP BY GROUPING SETS ((week, org_unit_id), (week))` chọn thêm **`GROUPING(org_unit_id) AS g`**. `rows` = `g = 0` (chỉ ô có hoạt động); `weekTotals` = `g = 1` LEFT JOIN `generate_series(from, to, '1 week')` ⇒ tuần 0 hoạt động vẫn có hàng 0. **TUYỆT ĐỐI không tách hai tập bằng `org_unit_id IS NULL`** (nhóm «chưa gán đơn vị» cũng NULL). `activeMembers` của `weekTotals` = DISTINCT thật của grouping set `(week)`. Câu thứ hai = metadata `units`. KHÔNG cache — `Cache-Control: no-store` ở CẢ HAI route. |
| D5 | **Scope — MỘT hàm thuần** `statsScopeFilter(scope, orgUnitIds)` ⇒ `{kind:"all"} \| {kind:"units", ids} \| {kind:"none"}` (`switch` vét cạn, `default` ⇒ `none`): `System`/`Company` ⇒ `all`; `Department` ⇒ `units` (rỗng ⇒ `none`); `Team`/`Own` ⇒ `none` (200 rỗng, không ném — khuôn `N-H3` của 028). Áp CÙNG kết quả cho metadata và số liệu: `units` ⇒ `ep.org_unit_id = ANY($ids)` (loại luôn nhóm `null`); `none` ⇒ `false`. `weekTotals` tính TRÊN tập đã lọc ⇒ không suy được số đơn vị khác bằng phép trừ. |
| D6 | **Metadata `units` = TẬP HỢP LỆ DUY NHẤT của `orgUnitId`:** `all` ⇒ mọi `org_units` của công ty KỂ CẢ đã xoá mềm (cờ `isDeleted`); `units` ⇒ `org_units WHERE company_id=$c AND id = ANY($ids)` (kể cả xoá mềm); `none` ⇒ rỗng. `orgUnitId` ∉ tập đó ⇒ **403 `SOCIAL_ERR.STATS_UNIT_OUT_OF_SCOPE`** — một chuỗi cho mọi lý do (không tồn tại · tenant khác · ngoài Department · scope `none`) ⇒ không oracle. Có `orgUnitId` ⇒ lọc số liệu (cả `rows` lẫn `weekTotals`) về đúng đơn vị đó. Kiểm TRƯỚC câu số liệu và, ở 053, TRƯỚC audit. Vì tập metadata gồm cả đơn vị đã xoá, «Đơn vị đã xoá» có hoạt động lọc được, không 403. |
| D7 | **Route pairs**: `statsEngagement` · `statsExport` = `{ ...pair("view","feed-report",false,false), dataScope:"Department" }`. Census 2 tầng: ca «`companyFloor` tắt ở ĐÚNG MỘT route» (`:769-774`) ĐỔI CÓ CHỦ Ý thành đẳng thức TẬP tường minh `{reportsList, statsEngagement, statsExport}`; đếm route +2; `ROUTE_TO_KEY`/`SERVICE_SITE_TO_KEYS` +2. Sửa docblock «ĐÚNG MỘT phần tử» ở `social-route-pairs.const.ts:79-86,198`. `tier1IsFloor=false`. Ghi rõ: C2-c chỉ chứng minh `dataScope` được KHAI; bằng chứng vị từ CHẠY là int-spec S2/S4. |
| D8 | **Audit `053`** — `objectType:"feed_report"` (giá trị CHECK sẵn có), `action:"social.stats.exported"`, `moduleCode:"SOCIAL"`, `entityType:"feed_engagement_stats"`, `objectId`/`entityId` null, `resultStatus:"Success"`, `metadata {from, to, orgUnitId, rowCount, format:"xlsx"}` (không số liệu, không tên) — ĐÚNG 1 hàng, cùng tx với câu thu thập. KHÔNG migration: thêm giá trị CHECK = ACCESS EXCLUSIVE trên `audit_logs` cả hệ cho một nhãn; `entityType` riêng tách được khỏi lịch sử báo cáo vi phạm. Ghi API-19 + nợ: thêm object type riêng ở lượt migrate CHECK audit kế tiếp. |
| D9 | **Hàm SOCIAL-WIDGET-001**: `SocialStatsService.weeklyEngagementForWidget(user)` — `resolveActor(user,"statsEngagement")` NGOÀI tx (CÙNG cổng + sàn), rồi `withTenant` → CÙNG `collectTx` với khoảng = tuần hiện tại → `weekTotals[0]`. KHÔNG handler/catalog/slug DASH. Ghi notes `S16-SOCIAL-DASH-1`: (a) mâu thuẫn «DASH cache theo `ttlSecondsFor`» vs SOC-DEC-010 «không cache»; (b) `Own`/`Team` trả số 0 chứ không 403 ⇒ DASH-1 phải ẩn widget. |
| D10 | **XLSX 053**: CÙNG `collectTx`. Sheet «Theo đơn vị» (Tuần bắt đầu · Đơn vị · Bài · Bình luận · Cảm xúc · Thành viên hoạt động) + «Theo tuần». Tên đơn vị qua `xlsxSafe`; `null` ⇒ «Chưa gán đơn vị»; `isDeleted` ⇒ hậu tố « (đã xoá)». Tên tệp `social-tuong-tac-{from}_{to}.xlsx`. Content-Type + Content-Disposition đặt ở đường thành công, viết tại controller SOCIAL. Trần tự nhiên: 26 tuần × số đơn vị. |
| D11 | **Ghép nối module**: SOCIAL KHÔNG import `payroll-report.sql.ts`. Mặc định TZ lấy thẳng `getSettingDefault("company.timezone")` (registry foundation — nguồn gốc mà payroll cũng đọc); LATERAL + `rowsOf` viết lại cục bộ (vài dòng). Riêng `xlsxSafe` import từ `payroll/payroll-xlsx.util.ts` (file tiện ích thuần 1 hàm, không kéo module) — dời ra thư mục chung nằm ngoài `paths` của WO ⇒ ghi nợ. |
| D12 | **Lỗi**: validate ⇒ 400 (ZodValidationPipe, luật chung). Thêm MỘT hằng `STATS_UNIT_OUT_OF_SCOPE` (403, `SOCIAL-ERR:` không đánh số — khuôn BE-3A) vào `STRONG_EVIDENCE` của census mã lỗi. |

## 2. Việc

1. **Contracts** — `packages/contracts/src/social-api-stats.ts`: `feedEngagementQuerySchema` (refine + transform D1), row/week/unit/response schema; export.
2. **Route pairs** — `statsEngagement` · `statsExport` + sửa docblock (D7).
3. **Luật thuần** — `social-stats-scope.ts`: `statsScopeFilter` (D5).
4. **SQL** — `social-stats.repository.ts`: `defaultRangeTx` (D1), `unitsTx` (D6), `engagementTx` (D3/D4). Tham số bind, không nội suy chuỗi.
5. **Service** — `social-stats.service.ts`: `collectTx` (units → kiểm D6 → engagement) · `engagement` (052) · `export` (053 + audit D8) · `weeklyEngagementForWidget` (D9). `resolveActor` luôn NGOÀI `withTenant`.
6. **Controller** — `social-stats.controller.ts`: `GET stats/engagement/export` khai TRƯỚC `GET stats/engagement`; guard từng route từ bảng hằng; `no-store`. Đăng ký `social.module.ts` (additive).
7. **Lỗi** — `STATS_UNIT_OUT_OF_SCOPE` + census mã lỗi.
8. **Census** — two-layer (D7) · regen route census (`ROUTE_CENSUS_WRITE=1`) · OpenAPI nếu có bước sinh.
9. **Docs** — API-19 §052/053 (tham số · nắn tuần ISO · TZ · D2/D3 định nghĩa đếm + «cảm xúc hiện còn» + nhóm riêng tư · D5/D6 scope · D8 audit + nợ · tổng route); backlog: zone red, notes DASH-1 (D9), nợ D8/D11.

## 3. Test (RED trước) — assert theo HẰNG `SOCIAL_ERR.X`

**Deny/scope (int-spec `social-be3b-engagement-stats.int-spec.ts`, LANE_DB):**
- S1 `employee` (không cặp) ⇒ 403 ở 052 + 053; 053 0 audit.
- S1b vai có ALLOW `view:feed-report` + DENY cùng cặp ⇒ 403 cả hai route, 0 audit.
- S2 `manager` @Department (đơn vị A): `rows`/`units` chỉ A; `weekTotals` = tổng đúng của A (không gồm B, không gồm nhóm `null`); `orgUnitId=B` ⇒ 403 `STATS_UNIT_OUT_OF_SCOPE` ở cả hai route, 053 0 audit; **XLSX của manager chỉ chứa A**.
- S2b manager thuộc A và đứng đầu B (B có đơn vị con C) ⇒ thấy A + B, KHÔNG thấy C.
- S3 manager không đơn vị, không đứng đầu ⇒ 200, `units=[]`, `rows=[]`, `weekTotals` toàn 0.
- S4 vai tuỳ biến `@Own` và `@Team` ⇒ 200 rỗng như S3; kèm `orgUnitId` bất kỳ ⇒ 403 cùng chuỗi.
- S5 cross-tenant: hoạt động công ty B không vào số của A; `orgUnitId` của công ty B / không tồn tại ⇒ 403 cùng chuỗi.
- S6 validation ⇒ 400: chỉ `from`; `from > to`; > 26 tuần sau nắn; ngày sai; `orgUnitId` không uuid; tham số lạ.

**Đúng số (allow-path):**
- A1 HR @Company, gieo 2 tuần × 2 đơn vị + 1 người không đơn vị: đếm đúng; bài `deleted`/xoá mềm và bài trong nhóm đã xoá mềm KHÔNG tính; bình luận trên bài đã xoá KHÔNG tính; bài `hidden` CÓ tính; một người đăng + bình luận + thả cảm xúc ⇒ `activeMembers` = 1; đúng MỘT hàng `orgUnitId:null` trong `rows` và `weekTotals` = tổng mọi đơn vị (bắt lỗi GROUPING).
- A1b cảm xúc trên bài đã xoá mềm và trên bình luận của bài đã xoá mềm KHÔNG tính; `restorePostTx` ⇒ tính lại.
- A1c bình luận + cảm xúc TRONG khoảng trên bài tạo TRƯỚC `from` ⇒ tính ở `comments`/`reactions`, bài đó KHÔNG tính ở `posts`.
- A2 TZ `Asia/Ho_Chi_Minh`: Chủ nhật 23:30 địa phương vào tuần đó; thứ Hai 00:30 vào tuần sau; biên khoảng: Chủ nhật 23:30 ngày `to` CÓ, thứ Hai 00:30 sau `to` KHÔNG, thứ Hai 00:10 ngày `from` (= Chủ nhật 17:10 UTC) CÓ.
- A3 nắn: `from`=thứ Tư ⇒ `range.from`=thứ Hai; `weekTotals` đủ tuần kể cả tuần 0.
- A4 mặc định ⇒ `range.weeks=8`, tuần cuối = tuần hiện tại.
- A5 không cache: 052 → thêm bài → 052 ⇒ số tăng; header `no-store` ở 052 và 053.
- A6 HR `orgUnitId=A` ⇒ `rows` VÀ `weekTotals` chỉ của A.
- A7 hoạt động của người thuộc đơn vị đã xoá mềm D: `units` có D (`isDeleted:true`), `orgUnitId=D` ⇒ 200.
- E1 053 HR: 200, Content-Type XLSX, `no-store`; đọc lại bằng exceljs: «Theo đơn vị» khớp `rows` 052 cùng tham số; tên `=HYPERLINK("x")` ra ô chữ có tiền tố `'`; ĐÚNG 1 audit (`objectType feed_report`, `action social.stats.exported`, `entityType feed_engagement_stats`), metadata không số liệu.
- W1 `weeklyEngagementForWidget`: HR ⇒ bằng tuần hiện tại của 052; `employee` ⇒ `ForbiddenException`; manager ⇒ chỉ đơn vị mình; `@Own` ⇒ số 0.

**Unit:** `statsScopeFilter` vét cạn mọi `DataScope` + giá trị lạ ⇒ `none`; schema D1 (nắn, 26 tuần, cặp from/to; biên Chủ nhật/thứ Hai chạy dưới `TZ` âm, vd `America/Los_Angeles`); census 2 tầng + mã lỗi xanh; coverage `social/` ≥ 85%.

## 4. Rủi ro

- `feed_reactions` không có chỉ mục `(company_id, created_at)` — quét theo tenant. N=1 quy mô nhỏ, chấp nhận; ghi nợ nếu p95 > 2s (chỉ mục = migration, WO riêng).
- Tuần ISO bắt đầu thứ Hai — SPEC-16 không nói ⇒ ghi API-19.
- `social-posts.service.ts` đã > 800 dòng — WO này không chạm.
- Trước PR: `bash harness/check.sh --all` (int-spec phải chạy thật) + FULL gate 3 reviewer.
