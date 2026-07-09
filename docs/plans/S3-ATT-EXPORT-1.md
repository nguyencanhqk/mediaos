# Micro-plan — S3-ATT-EXPORT-1 (ATT export CSV theo quyền)

> Reconcile-refresh cho auto-loop. Bake fix BLOCKING của plan-reviewer (run wf_4a728732).
> Bề mặt export = lộ dữ liệu công-ty → FULL gate. Trọng tâm: CSV an toàn + cap không im lặng + audit có actor.

```yaml
wo: S3-ATT-EXPORT-1
zone: yellow
generated_by: hand-authored (post plan-block wf_4a728732)
reconciled_at: "9f4ca6d"
lanes: [{"id":"s3attexport1-be","task":"BE export: GET /attendance/records/export CSV — gate export:attendance, resolveAndAssert data-scope, buffer-then-wrap có cap, CSV inject-safe + RFC-4180, audit có actor; contract attendanceExportQuerySchema + CSV column set ở packages/contracts (build dual TRƯỚC FE)","paths":["apps/api/src/attendance/**","apps/api/test/integration/**","packages/contracts/src/**"],"builder":"backend-builder"},{"id":"s3attexport1-fe","task":"FE: nút Export trên AttendanceReportsPage/records gate PermissionGate export:attendance; apiFetchBlob tái dùng refresh-on-401 replay","paths":["apps/app/src/routes/attendance/**","packages/web-core/src/lib/**"],"builder":"frontend-builder"}]
acceptanceChecks: ["GET /attendance/records/export (CSV) @RequirePermission export:attendance (cặp seed 0454, HR=Company); resolveAndAssert + resolveContext + buildEmployeeScopeCondition áp data-scope Own/Team/Company TRƯỚC kết xuất; withTenant + company_id; parity filter departmentId/employeeId như listCompanyRecords; sort ổn định (workDate + id tiebreaker)","CSV serializer: (a) neutralize formula-injection — ô bắt đầu =,+,-,@ được prefix ' (hoặc bọc), (b) quote+escape RFC-4180 — nháy kép nhân đôi, bọc field chứa , \" hoặc newline; UTF-8 BOM cho Excel VI","MAX_EXPORT_ROWS: vượt cap → TRẢ LỖI tường minh (422 'thu hẹp khoảng ngày', đo count>cap TRƯỚC serialize) — KHÔNG silent truncate","buffer-then-wrap (bounded by cap) trong withTenant: buffer rows đã cap → build CSV string → audit.record(count chính xác) → commit → trả StreamableFile bọc buffer; KHÔNG true DB-cursor streaming xuyên tx (withTenant commit khi callback return)","audit export: actorUserId=caller (mẫu attendance-adjustment.service.ts) + actorType:'User' + resultStatus:'Success' + dataScope enum {Own/Team/Department/Company/System} (nhãn, KHÔNG object thô) + after={count,fromDate,toDate,scope}; objectType attendance_record; mask qua toAttendanceRecordListItem (KHÔNG location/gps/ip/device — #3 by construction)","FE: nút Export trên AttendanceReportsPage/records gate PermissionGate export:attendance; apiFetchBlob tái dùng refresh-on-401 single-flight + replay (mirror apiFetch api-client.ts:394-421); loading/error","KHÔNG migration mới (grant export:attendance 0454 + object_type 0060 đã có); route records/export đăng ký TRƯỚC records/:id (chống route-collision)","check.sh xanh; FULL gate security-reviewer PASS"]
testTasks: ["deny RED: thiếu export:attendance → 403","scope RED: export chỉ trả bản ghi trong scope (employee KHÔNG xuất được team/company; Team KHÔNG xuất Company); cross-tenant deny","CSV injection RED: field fullName='=cmd|...' + field chứa dấu phẩy → output đã trung hòa (prefix ') + escape (bọc nháy kép) đúng RFC-4180","cap RED: dataset > MAX_EXPORT_ROWS → nhận 422 tường minh (KHÔNG CSV cắt im lặng)","audit RED: assert actorUserId=caller + count khớp + dataScope nhãn đúng","FE RED: apiFetchBlob khi 401 → refreshAccessToken → replay (không fail thẳng)"]
steps: ["Lane1(BE+contract): đọc attendance-read.repository.ts (AttendanceListFilters require sort/page/pageSize → builder filter riêng cho export: default sort, chỉ cap, parity filter), attendance-adjustment.service.ts (audit actor), resolveAndAssert/resolveContext/buildEmployeeScopeCondition, toAttendanceRecordListItem (mask)","Viết int-spec RED-trước (deny/scope/cross-tenant/injection/cap/audit)","contract attendanceExportQuerySchema + CSV column set ở packages/contracts — build dual ESM/CJS TRƯỚC khi FE typecheck","listScopedRecordsForExportTx (buffer-then-wrap, cap, parity) + csv serializer (inject-neutralize + RFC-4180) + audit actor; route records/export TRƯỚC records/:id","Lane2(FE): apiFetchBlob (refresh-replay) ở packages/web-core/src/lib/api-client.ts + nút Export gate export:attendance","check.sh + FULL gate security-reviewer"]
```

## Reconcile notes (prose)

**Bối cảnh block (đều BLOCKING/CẢNH BÁO thật):**
1. **CSV formula-injection + escaping** thiếu → ô do người dùng điều khiển (`fullName`/`employeeCode`/`orgUnitName`) bắt đầu `=,+,-,@` chạy như công thức trong Excel/Sheets; ô chứa `,"\n` vỡ cột. Fix: neutralize + RFC-4180.
2. **Cap tràn im lặng** → người dùng nhận CSV thiếu tưởng đủ, audit count che mất mát. Fix: vượt cap → **422 tường minh** (đo count>cap trước serialize), có test.
3. **Audit thiếu ACTOR** → không truy được ai xuất (vô dụng trên bề mặt exfiltration — bất biến #2). Fix: `actorUserId=caller` + actorType/resultStatus/dataScope, assert trong test.
4. **apiFetchBlob** phải sao chép refresh-on-401 single-flight+replay của `apiFetch` (api-client.ts:394-421); nếu bỏ → hết access token là Export fail thẳng.
5. **Kiến trúc buffer-then-wrap**: `withTenant` commit khi callback return → KHÔNG stream cursor xuyên tx. Với hard cap: buffer rows đã cap → build CSV → audit → commit → StreamableFile bọc buffer.
6. **Scope label**: `after.scope` serialize nhãn (`Company`/`Team`/`Own`) + cột v2 `dataScope` enum theo DB-08 §8.5, KHÔNG object thô từ resolveAndAssert.

**Câu hỏi mở đã chốt:** export dùng builder filter riêng (bỏ page/pageSize, giữ parity departmentId/employeeId dưới Company-scope như listCompanyRecords, sort mặc định workDate+id). Coupling tuần tự Lane1→Lane2: Lane2 typecheck chỉ xanh SAU khi contracts build — builder chạy Lane1 (BE+contract) TRƯỚC Lane2 (FE) trong cùng WO.

**Điểm tốt giữ nguyên (plan-reviewer xác nhận):** reuse nguyên GATE→scope→filter như AttendanceReadService/ReportService; mask by construction (list-item không mang location/gps/ip/device); không migration mới; least-privilege (không tự thêm grant Team/Own); contract-first một nguồn BE+FE.

**Bất biến:** #2 audit export có actor (append-only) · #3 mask server-side + không lộ secret · company_id mọi query (withTenant).
