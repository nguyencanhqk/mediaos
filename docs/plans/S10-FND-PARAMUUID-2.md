# S10-FND-PARAMUUID-2 (KI-078) — vá tham số `:id` THEO NHÓM RỦI RO

## 0. MỨC ĐỘ — đọc trước mọi số đo

**Lớp hỏng này KHÔNG phải lỗ bảo mật.** Chuỗi rác ở `:id` làm request bị **TỪ CHỐI** (500 thay vì
400): không hàng nào rò, không quyền nào bị vượt, không ghi được gì. Nó hỏng **ĐÚNG CHIỀU AN TOÀN**.

Giá trị của bản vá là hai thứ, cả hai đều KHÔNG phải bảo mật:

1. **Hợp đồng API** — client gửi id sai dạng phải nhận `400` có mã, không phải `500 SYSTEM-ERR-001`.
2. **Chấm dứt 500 GIẢ bơm vào giám sát** — payload rác tự sinh 500 làm loãng tín hiệu 500 THẬT. Đây
   đúng lớp giá trị của KI-068 (kênh BODY) và KI-077 (kênh PARAM của `foundation/files`).

Viết ra ở đây để người review KHÔNG phải tự suy, và để WO không bị đọc nhầm thành "vá lỗ bảo mật"
rồi bị ép leo FULL gate oan (WO này 🟡 LIGHT: diff chỉ thêm pipe + import ở BIÊN).

---

```yaml
wo: S10-FND-PARAMUUID-2
zone: yellow
generated_by: auto-loop
reconciled_at: "9452197e"
lanes: [{"id":"L1-LEAVE-PARAM","task":"ĐO-RỒI-VÁ 15 tham số `:id` của LEAVE (SPEC-05, workflow phê duyệt FSM). RED TRƯỚC: viết `leave-param-uuid.int-spec.ts` table-driven đo BẰNG HTTP cả 15 route với actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe ⇒ probe không token chỉ ra 401 = số 0 đội lốt) + ĐÚNG cặp quyền lấy từ catalog thật + BODY HỢP LỆ (body sai ăn 400 của ZodValidationPipe và ngụy trang thành 'route đã đúng') + TUYỆT ĐỐI KHÔNG gửi header `Idempotency-Key` (đã kiểm `common/idempotency/idempotency.interceptor.ts:69-70`: header RỖNG thì `return next.handle()` nên bỏ header là an toàn, còn gửi thì interceptor chạy TRƯỚC pipe và phát lại/409 làm hỏng số đo — `requests/:id/approve` có `@Idempotent()` ở `leave.controller.ts:311`). Ghi status + `error.type` THẬT vào docblock từng ca, kể cả route hoá ra KHÔNG trả 500. Sau đó vá `@Param(\"id\", ParseUUIDPipe)` theo khuôn `api-keys.controller.ts:71` CHỈ cho tham số ĐO ĐƯỢC là hỏng-sai-hợp-đồng; lật assert DENY sang 400 ĐƠN TRỊ. Dòng @Param: 162 (PATCH types/:id) · 211 (GET me/requests/:id) · 238 (GET balances/:id/transactions) · 287 (PATCH requests/:id) · 301 submit · 317 approve · 334 reject · 349 cancel · 364 revoke · 419 (PATCH admin/types/:id) · 430 admin/types/:id/delete · 458 (PATCH admin/policies/:id) · 469 admin/policies/:id/delete · 494 (GET admin/balances/:id/transactions) · 505 admin/balances/:id/adjust. ⚠️ ALLOW-200 HÀNG THẬT bắt buộc cho 4 LOẠI KHOÁ của lane: leave_type · leave_request · leave_balance · leave_policy. ⚠️ `leave_types.id` là `uuid` PK (`db/schema/hr.ts:328`) NHƯNG bảng CÓ cột `code` — phải chứng minh bằng hàng thật rằng `PATCH types/:id` nhận UUID chứ không nhận mã nghiệp vụ, nếu nhận mã thì KHÔNG vá + ghi verdict `skipped`. ⚠️ FIXTURE FSM: approve/reject cần bản ghi ĐÚNG trạng thái + approver KHÁC người nộp (self-approval → 422 LEAVE-ERR-APPROVER-INVALID, `leave.controller.ts:307-308`) — nêu fixture trong plan kẻo ca ALLOW rơi 422 rồi bị 'chữa' bằng nới assert. ⚠️ LITERAL-SIBLING (đọc file, không đoán): `types`(144/152) · `me/requests`(199) · `balances`(215/221) · `requests`(247/258) · `requests/calculate`(270) · `admin/types`(397/405) · `admin/policies`(436/444) · `admin/balances`(475) — mỗi cái phải có ca ALLOW 200 sau khi gắn pipe. DB riêng: `mediaos_paramuuid2a`.","builder":"backend-builder","paths":["apps/api/src/leave/leave.controller.ts","apps/api/test/integration/leave-param-uuid.int-spec.ts"]},{"id":"L2-ATT-PARAM","task":"ĐO-RỒI-VÁ 14 tham số `:id` của ATTENDANCE (SPEC-04: điều chỉnh công + làm việc từ xa = workflow phê duyệt; ca/rule = cấu hình). RED TRƯỚC: `attendance-param-uuid.int-spec.ts` table-driven, CÙNG LUẬT ĐO của L1 (actor có quyền, body hợp lệ, KHÔNG `Idempotency-Key`, ghi số THẬT vào docblock). Dòng @Param: attendance-adjustment 96 (GET adjustment-requests/:id) · 105 approve · 116 reject · 129 (POST records/:id/adjust-direct); remote-work-request 81 (:id/submit) · 109 (GET :id) · 118 approve · 129 reject · 140 cancel; attendance 166 (GET records/:id/logs) · 174 (GET records/:id) · 196 (PATCH schedules/:id); attendance-shift 92 (PATCH shifts/:id) · 145 (PATCH rules/:id). ⚠️ ALLOW-200 HÀNG THẬT theo LOẠI KHOÁ (6 loại): attendance_adjustment_request · attendance_record · work_schedule · shift · attendance_rule · remote_work_request. ⚠️ `attendance_rules.id` là `uuid` PK (`db/schema/attendance.ts:159`) NHƯNG bảng CÓ `rule_code` — chứng minh bằng hàng thật rằng `PATCH rules/:id` nhận UUID; nếu nhận `rule_code` thì KHÔNG vá + verdict `skipped` (đây đúng ca 'đếm oan' mà `param-uuid-census.ts:36-40` tự cảnh báo). ⚠️ CHỐNG HỒI QUY ĐỊNH TUYẾN — danh sách LIỆT KÊ BẰNG ĐỌC FILE, gồm ba route done_when kê đích danh: `attendance-adjustment.controller.ts:74` `adjustment-requests/my` · `:80` `adjustment-requests/team` · `:86` `adjustment-requests` (cùng cấp `:id` ở `:94`); `attendance.controller.ts:148` `records/export` (cùng cấp `records/:id/logs`:162 + `records/:id`:170 — route dùng `@Res()` library-mode, BỎ QUA envelope interceptor ⇒ CHỈ assert status, không assert body JSON) · `:133` `records` · `:121` `my-records` · `:127` `team-records` · `:180/:186` `schedules`; `attendance-shift.controller.ts:119` `rules/effective` · `:125/:131` `rules` · `:70/:78` `shifts` · `:100/:108` `shift-assignments`; `remote-work-request.controller.ts:87` `my` · `:93` `team` · `:99` `@Get()`. Mỗi cái cần ca ALLOW 200 SAU khi gắn pipe. ⚠️ ĐÃ KIỂM SHADOWING XUYÊN FILE: năm controller cùng base `@Controller(\"attendance\")` (attendance · adjustment · shift · report · audit) nên định tuyến giải theo THỨ TỰ ĐĂNG KÝ trong `attendance.module.ts:107-115`, KHÔNG theo thứ tự trong một file. Đã đọc: `attendance-report` chỉ khai `reports/team`+`reports`, `attendance-audit` chỉ khai `audit-logs` ⇒ KHÔNG va chạm với `:id` nào. Ghi kết luận này vào docblock để lần sau không phải đọc lại. DB riêng: `mediaos_paramuuid2b`.","builder":"backend-builder","paths":["apps/api/src/attendance/attendance.controller.ts","apps/api/src/attendance/attendance-adjustment.controller.ts","apps/api/src/attendance/attendance-shift.controller.ts","apps/api/src/attendance/remote-work-request.controller.ts","apps/api/test/integration/attendance-param-uuid.int-spec.ts"]},{"id":"L3-APPROVAL-PARAM","task":"ĐO-RỒI-VÁ 2 tham số của APPROVAL inbox, và ĐO-KHÔNG-VÁ 1 tham số của AUTH session. (a) `approval-inbox.controller.ts:38` (POST requests/:id/approve) · `:50` (reject) — cùng luật đo của L1; ALLOW-200 hàng thật cho LOẠI KHOÁ `approval_request`; literal-sibling `inbox`(:27) phải còn 200. (b) AUTH `sessions/:id/revoke`: ⛔ **KHÔNG được đưa `apps/api/src/auth/auth.controller.ts` vào paths GHI của lane này** — CLAUDE.md §6: diff chạm `auth` ⇒ FULL gate, mà WO này là 🟡 LIGHT (ghim ở notes WO). Đo bằng HTTP KHÔNG cần quyền ghi file: đã có bằng chứng ghim sẵn ở `test/integration/auth-session-selfservice.int-spec.ts:93-98` — `POST /auth/sessions/not-a-uuid/revoke` → **404, KHÔNG 500** (và `:88-91` UUID hợp lệ không tồn tại cũng 404). Chạy lại spec đó để XÁC NHẬN số, rồi ghi verdict `skipped` KÈM LÝ DO trong `param-uuid-verdicts.ts` (L4): đã hỏng ĐÚNG CHIỀU, không bơm 500 giả, và gắn pipe sẽ đổi 404→400 tức phá một hợp đồng bảo mật đang cố tình dùng 404 đơn trị để KHÔNG mở kênh dò tồn tại phiên. NẾU builder kết luận ngược lại ⇒ **DỪNG**, không sửa ở WO này, seed WO riêng zone 🔴 + FULL gate (kèm lý lẽ vì sao 400 không mở kênh dò tồn tại + sửa kèm `auth-session-selfservice.int-spec.ts:96`). Cấm im lặng bỏ qua. DB riêng: `mediaos_paramuuid2c`.","builder":"backend-builder","paths":["apps/api/src/approval/approval-inbox.controller.ts","apps/api/test/integration/approval-param-uuid.int-spec.ts"]},{"id":"L4-RATCHET-VERDICTS-DOCS","task":"NỐI TIẾP SAU L1–L3 (đọc kết quả đo của cả ba). (a) Thêm trường `handler` (tên method chứa `@Param`) vào `ParamSite` + `idLikeParamSites()` của `param-uuid-census.ts` để có KHOÁ ỔN ĐỊNH `file#handler:param` — số dòng TRÔI theo chính commit vá nên KHÔNG dùng làm khoá ([[index-ratchet-must-pin-definition-not-name]]). (b) Tạo `param-uuid-verdicts.ts` = SỔ PHÁN QUYẾT CHỈ CHO NHÓM ĐỢT-1 (32 tham số, KHÔNG ledger cả 221) theo khuôn `test/foundation/fk-tenant-verdicts.ts` / `identity-projection-verdicts.ts`: mỗi dòng = khoá `file#handler:param` + `decision: 'piped' | 'skipped'` + status ĐO ĐƯỢC trước vá + lý do. (c) `param-uuid-ratchet.unit-spec.ts`: HẠ `UNPIPED_CEILING` (đang 221, dòng 27) xuống ĐÚNG số census mới — ca (3) là ĐẲNG THỨC nên quên = ĐỎ; ⛔ CẤM nâng trần. Nới `CLEAN_PREFIXES` (đang `[\"foundation/files/\"]`, dòng 33) cho MỌI module đạt 0 unpiped — kỳ vọng `leave/`, `attendance/`, `approval/` NHƯNG chỉ thêm prefix nào census thực sự về 0 (nếu `rules/:id` hoặc `types/:id` hoá ra là mã nghiệp vụ và bị `skipped` thì prefix đó KHÔNG được thêm); ⛔ `auth/` KHÔNG BAO GIỜ vào danh sách này (còn 1 unpiped cố ý). Thêm ca (5) phủ verdict, assert HAI CHIỀU: với mọi dòng verdict `decision==='piped'` ⟺ `site.hasPipe===true`, VÀ mỗi site nhóm đợt-1 có ĐÚNG MỘT dòng verdict — chỉ kiểm TỒN TẠI dòng thì gỡ pipe xong ca (5) vẫn xanh. (d) RELEASE-02: cập nhật hàng KI-078 với số TRƯỚC/SAU (221 → số mới) + danh sách nhóm đã vá kèm số đo trước-vá + phản-ví-dụ auth-session + nhóm còn nợ — **GIỮ KI MỞ** (không gạch tiêu đề, cột trạng thái vẫn ❌). (e) `harness/backlog.mjs`: đóng WO + seed gợi ý đợt 2 (tasks 75 · workflow 36 · goals 21 · employees 21). ⚠️ Ca (3) là đẳng thức trên census SỐNG ⇒ PR khác merge thêm/bớt `@Param` làm nó ĐỎ OAN: rebase + chạy lại census NGAY TRƯỚC commit cuối, dán số vào PR.","builder":"backend-builder","paths":["apps/api/test/foundation/param-uuid-census.ts","apps/api/test/foundation/param-uuid-verdicts.ts","apps/api/test/foundation/param-uuid-ratchet.unit-spec.ts","docs/RELEASE/RELEASE-02_Known_Issues_MVP.md","docs/plans/S10-FND-PARAMUUID-2.md","harness/backlog.mjs"]}]
acceptanceChecks: ["plan doc mở đầu bằng phát biểu MỨC ĐỘ (hỏng đúng chiều an toàn, KHÔNG phải lỗ bảo mật) — có mặt TRƯỚC mọi số đo, không để reviewer tự suy (done_when #1).","plan doc khai NHÓM + TIÊU CHÍ RỦI RO + SỐ LƯỢNG: 32 tham số / 7 controller, tiêu chí 'workflow phê duyệt + module nhạy cảm SPEC-04/05 + route ghi', kèm danh sách 189 tham số CÒN NỢ theo module — chứng minh WO không cố vá 221 (done_when #2 'CHỌN NHÓM, KHÔNG VÁ TẤT').","MỌI tham số trong nhóm 32 có ĐÚNG MỘT dòng số đo HTTP TRƯỚC-VÁ (status + `error.type`) trong docblock spec; không dòng nào ghi 'suy ra'. Route không trả 500 được ghi ĐÚNG NHƯ ĐO (auth `sessions/:id/revoke` = 404) (done_when #3).","Mỗi tham số ĐƯỢC VÁ có ca DENY assert **400 ĐƠN TRỊ** + neo hiện vật `error.type ∉ {'Error','ZodError'}`; grep ba spec mới KHÔNG có `[400, 500]` / `toContain` trên assert status.","**Oracle ALLOW loại CẢ 400 VÀ 500** — grep ba spec mới: mọi helper ALLOW có ĐỦ hai dòng `not.toBe(400)` VÀ `not.toBe(500)` (khuôn `expectPassedBoundary`, files-param-uuid.int-spec.ts:172-176), hoặc tốt hơn là `toBe(<403|404 đơn trị>)`. Ca chỉ đòi `≠400` là VI PHẠM done_when #5.","**ALLOW → status 2xx ĐƠN TRỊ ĐO ĐƯỢC trên HÀNG THẬT theo LOẠI KHOÁ, không theo controller**: đếm được ĐỦ 11 ca ALLOW-2xx đơn trị (**200**; hoặc **201** với route `@Post` KHÔNG khai `@HttpCode(200)` — đó là mặc định Nest và là SỐ ĐO THẬT, ⛔ CẤM sửa assert 201→200 để khớp chữ nghiệm thu: ép số cho khớp mô tả đúng là lớp lỗi WO này tồn tại để diệt) cho leave_type · leave_request · leave_balance · leave_policy · attendance_adjustment_request · attendance_record · work_schedule · shift · attendance_rule · remote_work_request · approval_request (done_when #6). Loại khoá nào bị `skipped` thì miễn ca 200 nhưng PHẢI có dòng verdict giải thích.","Ca chống hồi quy ĐỊNH TUYẾN có ĐỦ ba route done_when #7 kê đích danh: `GET /attendance/adjustment-requests/my` · `/team` · `GET /attendance/records/export` (route `@Res()` ⇒ chỉ assert status) — CỘNG danh sách literal-sibling đọc-từ-file còn lại: `remote-work-requests/my` · `/team` · `@Get()` · `attendance/rules/effective` · `attendance/records` · `my-records` · `team-records` · `schedules` · `shifts` · `shift-assignments` · `leave/types` · `me/requests` · `balances` · `requests` · `requests/calculate` · `admin/types` · `admin/policies` · `admin/balances` · `approval/inbox` — tất cả 200 sau khi gắn pipe.","`param-uuid-census.ts` chạy lại cho UNPIPED = 221 − (số THỰC vá); `UNPIPED_CEILING` BẰNG ĐÚNG số đó (ca (3) là đẳng thức nên tự chứng); trần KHÔNG bị nâng ở BẤT KỲ commit nào của PR (done_when #8).","`CLEAN_PREFIXES` được nới cho MỌI module đạt 0 unpiped (kỳ vọng `leave/`, `attendance/`, `approval/`); module còn tham số bỏ qua có ý thức KHÔNG được đưa vào — đặc biệt `auth/` (còn 1) phải VẮNG MẶT.","`param-uuid-verdicts.ts` có đủ 32 dòng (`piped`/`skipped` + status đo được + lý do), khoá là `file#handler:param` (census xuất `handler`), KHÔNG dùng số dòng ([[index-ratchet-must-pin-definition-not-name]]).","Ca (5) của ratchet assert **HAI CHIỀU**: `decision==='piped'` ⟺ `site.hasPipe===true`, và mỗi site nhóm đợt-1 có ĐÚNG MỘT dòng verdict. Chứng minh bằng đột biến: gỡ một pipe ⇒ ca (5) ĐỎ (không chỉ ca (2)/(3)); xoá một dòng verdict ⇒ ca (5) ĐỎ. Kết quả dán vào plan doc.","⛔ `git diff --name-only` của PR **KHÔNG chứa `apps/api/src/auth/auth.controller.ts`** (notes WO: chạm auth ⇒ FULL gate, WO này 🟡 LIGHT). Tham số auth-session được ĐO qua spec sẵn có và chỉ nhận dòng verdict `skipped`.","RELEASE-02 hàng KI-078 có số trước/sau + danh sách nhóm đã vá + phản-ví-dụ auth-session, và KI **vẫn MỞ** (không gạch tiêu đề, cột trạng thái ❌) (done_when #9).","Census hộ tiêu thụ được ghi trong PR là đã quét ĐỦ TÁM chỗ: `apps/api/test/**` · `apps/api/src/**/*.spec.ts` · `apps/app/src` · `apps/console/src` · `apps/auth/src` · `packages/**` · `scripts/**` · repo `apps/lms`.","`bash harness/check.sh --lane-db=paramuuid2` XANH và KHÔNG rơi vào trạng-thái-thứ-ba 'XANH KHÔNG ĐỦ BẰNG CHỨNG' (int-spec THẬT SỰ chạy, không SKIP — CLAUDE.md §9.5).","Không `@ts-ignore` / `eslint-disable` mới; diff mỗi controller chỉ gồm dòng `@Param` + dòng `import` từ `@nestjs/common`; không đổi chữ ký service/DTO/schema; `harness/backlog.mjs` cập nhật (DoD §8).","KHÔNG có migration, KHÔNG chạm permission/RLS/secret/audit — nếu diff chạm, WO đổi tier và phải leo FULL gate trước khi merge (CLAUDE.md §6)."]
testTasks: ["`apps/api/test/integration/leave-param-uuid.int-spec.ts` — table-driven 15 route LEAVE: mỗi hàng {method, path, body HỢP LỆ, cặp quyền} × {garbage `:id` → 400 đơn trị + `error.type` không phải 'Error'/'ZodError', UUID hợp lệ → `expectPassedBoundary` (≠400 VÀ ≠500)}, + ALLOW 200 trên hàng thật cho ĐỦ 4 loại khoá (leave_type · leave_request · leave_balance · leave_policy), + ca literal-sibling 200 cho `types` · `me/requests` · `balances` · `requests` · `requests/calculate` · `admin/types` · `admin/policies` · `admin/balances`. Gate cứng `hasDb && LANE_DB`. DB `mediaos_paramuuid2a`.","`apps/api/test/integration/attendance-param-uuid.int-spec.ts` — 14 route ATT theo cùng khuôn, ALLOW 200 hàng thật cho ĐỦ 6 loại khoá, KÈM ca literal-sibling 200 cho `adjustment-requests/my` · `/team` · `adjustment-requests` · `records/export` (chỉ assert status vì `@Res()`) · `records` · `my-records` · `team-records` · `schedules` · `rules/effective` · `rules` · `shifts` · `shift-assignments` · `remote-work-requests/my` · `/team` · `remote-work-requests`. Docblock ghi kết luận đã-kiểm về shadowing xuyên file (5 controller cùng base `attendance`, thứ tự `attendance.module.ts:107-115`, không va chạm). DB `mediaos_paramuuid2b`.","`apps/api/test/integration/approval-param-uuid.int-spec.ts` — 2 route approval-inbox (DENY 400 đơn trị + ALLOW `expectPassedBoundary` + ALLOW 200 hàng thật cho `approval_request` + literal-sibling `inbox` 200). Ca ĐO auth `sessions/:id/revoke` KHÔNG viết mới ở đây mà CHẠY LẠI `auth-session-selfservice.int-spec.ts:88-98` để xác nhận 404 (KHÔNG 500) — kết quả đi vào dòng verdict, KHÔNG đi vào diff của `auth.controller.ts`. DB `mediaos_paramuuid2c`.","**Deny-path RED TRƯỚC (CLAUDE.md §6):** ba spec trên phải được commit/chạy Ở TRẠNG THÁI ĐỎ (ghi số 500 THẬT) TRƯỚC commit vá — bằng chứng (output) dán vào plan doc; cấm viết test sau khi đã vá.","**Anti-tautology của chính ca đo:** actor KHÔNG phải super-admin ([[superadmin-not-a-canonical-role]]) · KHÔNG seed `*:*` (permissions là catalog TOÀN CỤC, `cleanupTenants` không dọn — [[test-fixture-stamps-global-permission-catalog]]) · body PHẢI hợp lệ để 400 quan sát được đến từ PARAM chứ không từ body-pipe · **KHÔNG gửi `Idempotency-Key`** (interceptor `common/idempotency/idempotency.interceptor.ts:69-70` chạy TRƯỚC pipe; header rỗng thì `return next.handle()` nên BỎ header là an toàn, GỬI thì phát lại/409 làm hỏng số đo).","**Fixture FSM cho ca ALLOW-200 route phê duyệt:** approve/reject/revoke/cancel cần bản ghi ĐÚNG trạng thái tiền điều kiện + approver KHÁC người nộp (self-approval → 422 `LEAVE-ERR-APPROVER-INVALID`, `leave.controller.ts:307-308`). Nêu fixture trong plan; nếu ca ALLOW rơi 422 thì SỬA FIXTURE, TUYỆT ĐỐI không 'chữa' bằng nới assert ([[deny-cases-vacuous-without-allow-case]], [[tests-can-pin-a-hole-open]]).","**Ca chứng minh `:id` là UUID chứ không phải mã nghiệp vụ:** `PATCH leave/types/:id` và `PATCH attendance/rules/:id` — cả hai bảng có PK `uuid` (`db/schema/hr.ts:328`, `db/schema/attendance.ts:159`) NHƯNG cũng có `code`/`rule_code`. Trả lời bằng HÀNG THẬT đã seed (ALLOW 200 với UUID), không bằng suy luận. Nếu route nhận mã ⇒ KHÔNG vá + verdict `skipped`.","`param-uuid-ratchet.unit-spec.ts` (spec TĨNH, chạy cả khi không có Postgres): giữ ca (1) module sạch = 0 · ca (2) trần · ca (3) đẳng thức ép hạ trần · ca (4) neo chống-xanh-rỗng (thấy CẢ HAI phía `hasPipe`, thấy alias `*Id`) + THÊM ca (5) phủ verdict assert HAI CHIỀU.","**Kiểm chứng ĐỘT BIẾN của thước đo** (bắt buộc, ghi kết quả vào plan doc): gỡ tạm một `ParseUUIDPipe` vừa thêm ⇒ ca (2)/(3) VÀ ca (5) phải ĐỎ; xoá tạm một dòng verdict ⇒ ca (5) ĐỎ; đổi tạm `skipped`→`piped` ⇒ ca (5) chiều-hai ĐỎ.","**Hồi quy hộ tiêu thụ:** chạy lại `leave-qa2-api` · `routehttp3-attendance-leave` · `routehttp3-hr-employee` · `att-core-tenant-deny` · `approval-inbox.e2e` · `auth-session-selfservice` · `dashboard-cache-invalidate` · `foundation/route-http-coverage.e2e` (MIN_COVERED_COUNT=500 GIỮ NGUYÊN) để bắt hồi quy 500→400.","**Chạy với DB cô lập (CLAUDE.md §9.5):** phát triển mỗi lane một DB (`bash scripts/lane-db-setup.sh paramuuid2a|b|c`) chống nhiễu chéo ([[parallel-int-specs-share-one-outbox]]); verify CUỐI hợp nhất tuần tự: `bash scripts/lane-db-setup.sh paramuuid2` + `export LANE_DB=mediaos_paramuuid2` (KHÔNG `source .env` — [[sourcing-dotenv-poisons-test-run-node-env]]) → `bash harness/check.sh --lane-db=paramuuid2`."]
steps: ["0. PHÁT BIỂU MỨC ĐỘ TRƯỚC (đầu plan doc + docblock MỖI spec, trước mọi số đo): hỏng ĐÚNG CHIỀU AN TOÀN — request vẫn bị từ chối, không hàng nào rò, không quyền nào bị vượt ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị = hợp đồng API + chấm dứt payload rác bơm 500 GIẢ vào giám sát (y như KI-068/KI-077). Đừng để reviewer tự suy.","1. CENSUS ĐÃ ĐO LẠI TRONG LÚC PHÂN RÃ (26/08/2026, chạy chính `param-uuid-census.ts` qua tsx trên `apps/api/src/**/*.controller.ts`): **ID_LIKE=298 · PIPED=77 · UNPIPED=221** — TRÙNG seed 25/08, chưa trôi; `UNPIPED_CEILING=221` khớp thực tế. Builder ĐO LẠI lần nữa trước commit đầu; nếu ra số khác thì lấy số của builder và ghi lệch vào plan ([[wo-seed-hand-measurements-can-be-incomplete]]).","2. KHAI NHÓM ĐỢT-1 trong plan doc: tiêu chí = 'workflow phê duyệt (FSM nghỉ phép/điều chỉnh công) + module nhạy cảm SPEC-04/SPEC-05 + route GHI', phạm vi = **32 tham số / 7 controller** (leave 15 · attendance-adjustment 4 · remote-work 5 · attendance 3 · attendance-shift 2 · approval-inbox 2 · auth-session 1) = 14,5% của 221 — con số này KHỚP CHÍNH XÁC phân bố census vừa đo. Ghi RÕ 189 tham số còn lại thuộc đợt sau (tasks 43+13+11+4+4=75 · workflow 24+12=36 · goals 12+9=21 · employees 8+5+4+3+1=21 · org 9+6+3=18 · notifications 3+3=6 · foundation audit/holidays/retention/sequences 2+2+2+2=8 · positions 3 · recycle-bin 1) — KHÔNG vá ở WO này.","3. RED TRƯỚC — dựng BA int-spec đo HTTP (L1/L2/L3) theo khuôn `test/integration/files-param-uuid.int-spec.ts`. Luật đo bắt buộc: actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe ⇒ probe không token chỉ ra 401 = số 0 đội lốt) · ĐÚNG cặp quyền lấy từ catalog THẬT · **KHÔNG super-admin, KHÔNG seed `*:*`** (permissions là catalog TOÀN CỤC, `cleanupTenants` không dọn) · body HỢP LỆ · **KHÔNG header `Idempotency-Key`**. Chạy lần một, DÁN số đo THẬT (status + `error.type`) vào docblock từng ca. Commit/chạy ở TRẠNG THÁI ĐỎ trước commit vá — bằng chứng dán vào plan doc.","4. PHÂN LOẠI THEO SỐ ĐO, KHÔNG THEO MÔ TẢ KI: tham số trả 500 ⇒ VÁ; tham số đã trả 4xx (đã biết: auth `sessions/:id/revoke` → 404, ghim ở `auth-session-selfservice.int-spec.ts:93-98`) ⇒ GHI SỰ THẬT + quyết định có ý thức, mặc định KHÔNG vá; tham số bị body-pipe chặn trước ⇒ sửa payload cho HỢP LỆ rồi đo lại (400-do-body là số đo GIẢ); tham số hoá ra nhận MÃ NGHIỆP VỤ (`leave_types.code` / `attendance_rules.rule_code`) ⇒ KHÔNG vá, verdict `skipped`.","5. VÁ: `@Param(\"id\", ParseUUIDPipe)` theo khuôn `api-keys.controller.ts:71`. Diff của mỗi controller = dòng `@Param` + dòng `import` từ `@nestjs/common` (phát biểu 'chỉ chạm dòng @Param' là BẤT KHẢ — mỗi file phải thêm `ParseUUIDPipe` vào import). KHÔNG đổi chữ ký service/DTO/schema. Lật assert DENY sang **400 ĐƠN TRỊ** + neo hiện vật `error.type ∉ {'Error','ZodError'}` (khuôn `expectRejectedAtBoundary`, files-param-uuid.int-spec.ts:158-163) — cấm `expect([400,500]).toContain(...)`.","6. CA ALLOW BẮT BUỘC (chống deny-xanh-rỗng), BA TẦNG: (a) UUID hợp lệ không tồn tại → dùng oracle `expectPassedBoundary` loại **CẢ 400 VÀ 500** (files-param-uuid.int-spec.ts:172-176) — chỉ đòi `≠400` là XANH-RỖNG vì route vẫn 500/429/401 mà lưới vẫn xanh; tốt hơn nữa: ghim status ĐƠN TRỊ đo được cho từng route (403 hoặc 404), đối xứng luật DENY 400 đơn trị. (b) ≥1 ca ALLOW → **200** trên HÀNG THẬT đã seed cho **MỖI LOẠI KHOÁ** được vá (11 loại: leave_type · leave_request · leave_balance · leave_policy · attendance_adjustment_request · attendance_record · work_schedule · shift · attendance_rule · remote_work_request · approval_request) — KHÔNG phải mỗi controller; đây là vế DUY NHẤT bắt được ca `:id` hoá ra là mã nghiệp vụ/slug bị `ParseUUIDPipe` CHẶN OAN. (c) LITERAL-SIBLING vẫn 200 — danh sách đã liệt kê bằng ĐỌC FILE ở lane L1/L2/L3, gồm ba route done_when kê đích danh: `adjustment-requests/my` · `adjustment-requests/team` · `records/export` (route này `@Res()` library-mode ⇒ CHỈ assert status).","7. CENSUS HỘ TIÊU THỤ trước khi khoá diff (đổi 500→400 là ĐỔI HÀNH VI QUAN SÁT ĐƯỢC): quét `apps/api/test/**` + `apps/api/src/**/*.spec.ts` + `apps/app/src` + `apps/console/src` + **`apps/auth/src`** + **`packages/**` (web-core api-client)** + **`scripts/**`** + **repo `apps/lms` (git riêng, có gọi API MediaOS)** TRƯỚC khi tuyên bố 'hộ tiêu thụ duy nhất'. Vòng trước mới quét 4/8 chỗ. Rồi chạy lại spec chạm route nhóm này: `leave-qa2-api` · `routehttp3-attendance-leave` · `routehttp3-hr-employee` · `att-core-tenant-deny` · `approval-inbox.e2e` · `auth-session-selfservice` · `dashboard-cache-invalidate` · `foundation/route-http-coverage.e2e` (MIN_COVERED_COUNT=500 giữ nguyên) để bắt hồi quy 500→400.","8. L4 (NỐI TIẾP): thêm `handler` vào census → viết `param-uuid-verdicts.ts` cho đủ 32 tham số → HẠ `UNPIPED_CEILING` xuống số census mới (kỳ vọng **190** nếu chỉ auth-session `skipped`; cao hơn nếu `rules/:id`/`types/:id` cũng skipped — LẤY SỐ ĐO THẬT, không lấy kỳ vọng) → nới `CLEAN_PREFIXES` cho module đạt 0 (`auth/` KHÔNG bao giờ) → thêm ca (5) assert HAI CHIỀU `decision==='piped' ⟺ site.hasPipe`.","9. KIỂM CHỨNG ĐỘT BIẾN của chính cái thước ([[vitest-globalsetup-teardown-exits-zero]] — đo cổng cần VI PHẠM thật): gỡ tạm một `ParseUUIDPipe` vừa thêm ⇒ ca (2)/(3) phải ĐỎ đúng chỗ; xoá tạm một dòng verdict ⇒ ca (5) phải ĐỎ; đổi tạm một verdict `skipped`→`piped` ⇒ ca (5) chiều hai phải ĐỎ. Ghi cả ba kết quả vào plan doc.","10. RELEASE-02 hàng KI-078: số trước/sau (221 → số mới) + danh sách nhóm đã vá kèm số đo trước-vá + phản-ví-dụ auth-session, và **giữ KI MỞ** (❌) vì còn ~189 tham số chưa xử.","11. VERIFY như CI với DB cô lập: phát triển mỗi lane một DB (`paramuuid2a`/`b`/`c`) để tránh nhiễu chéo, rồi HỢP NHẤT TUẦN TỰ ở verify cuối: `bash scripts/lane-db-setup.sh paramuuid2` → `export LANE_DB=mediaos_paramuuid2` (TUYỆT ĐỐI KHÔNG `source .env` — đầu độc NODE_ENV) → `bash harness/check.sh --lane-db=paramuuid2`. Rebase + chạy lại census NGAY TRƯỚC commit cuối (ca (3) là đẳng thức trên census sống ⇒ PR khác làm nó đỏ oan). Cập nhật `harness/backlog.mjs` (DoD §8)."]
```

RECONCILE 26/08/2026 @ HEAD 9452197e — plan cũ TÁI DÙNG ĐƯỢC PHẦN LỚN nhưng phải CẬP NHẬT (reused=false).

VÌ SAO KHÔNG TÁI DÙNG NGUYÊN: khối yaml cũ (reconciled_at 9452197e) viết TRƯỚC khi plan-review vòng 1 ghim 4 điểm vào `done_when` + 4 điểm vào `notes`. Bốn xung đột thật:
(1) lane L3 cũ đưa `apps/api/src/auth/auth.controller.ts` vào paths GHI — notes CẤM tuyệt đối (chạm auth ⇒ FULL gate, WO là 🟡 LIGHT). Đã gỡ; auth chỉ còn ĐO (qua spec sẵn có) + 1 dòng verdict `skipped`. Lane đổi tên L3-APPROVAL-PARAM.
(2) acceptance cũ đòi ALLOW "status ≠ 400"; done_when #5 đòi loại CẢ 400 VÀ 500 (khuôn `expectPassedBoundary`, files-param-uuid.int-spec.ts:172-176), vì "≠400" để lọt 500/429/401 = ca XANH-RỖNG.
(3) acceptance cũ đòi ALLOW-200 hàng thật theo CONTROLLER; done_when #6 đòi theo LOẠI KHOÁ. Đã liệt kê 11 loại — đây là vế DUY NHẤT bắt được ca `:id` hoá ra là mã nghiệp vụ và bị pipe chặn OAN (đúng ca "đếm oan" mà `param-uuid-census.ts:36-40` tự cảnh báo).
(4) literal-sibling cũ chỉ kê 3 route (remote-work /my · /team · rules/effective) và BỎ SÓT đúng ba route done_when #7 kê đích danh: `attendance-adjustment.controller.ts:74` /my · `:80` /team · `attendance.controller.ts:148` records/export.

SỐ ĐO ĐÃ XÁC MINH LẠI (không chép seed): chạy chính `param-uuid-census.ts` qua tsx trên `apps/api/src/**/*.controller.ts` → **ID_LIKE=298 · PIPED=77 · UNPIPED=221**, TRÙNG seed 25/08, chưa trôi. `UNPIPED_CEILING=221` (param-uuid-ratchet.unit-spec.ts:27) vẫn khớp. `CLEAN_PREFIXES=["foundation/files/"]` (dòng 33). Phân bố top: tasks 43 · workflow-templates 24 · leave 15 · projects 13 · goals 12 · workflow 12 · task-files 11 · task-templates 9 · org 9 · employee-file 8 · hr-master-data 6 · remote-work 5 · contract 5 · attendance-adjustment 4 · profile-change-request 4 · labels 4 · project-states 4 · (3) attendance, employees, my-notifications, notification-admin, hr-department, positions · (2) approval-inbox, attendance-shift, foundation audit/holidays/retention/sequences · (1) auth, hr-read, recycle-bin. Nhóm đợt-1 = 32 = 15+4+5+3+2+2+1 KHỚP CHÍNH XÁC census.

PHÁT HIỆN MỚI CỦA LẦN RECONCILE NÀY (đọc file, chưa ai kê trước đó):
- **Shadowing đi XUYÊN FILE, không chỉ trong file.** Năm controller cùng base `@Controller("attendance")`: attendance.controller.ts:73 · attendance-adjustment:60 · attendance-shift:62 · attendance-report:38 · attendance-audit:40. Nest giải route theo THỨ TỰ ĐĂNG KÝ ở `attendance.module.ts:107-115` (AttendanceController TRƯỚC), không theo thứ tự khai báo trong một file. ĐÃ KIỂM: attendance-report chỉ khai `reports/team`+`reports`, attendance-audit chỉ khai `audit-logs` ⇒ KHÔNG va chạm với `:id` nào. Kết luận này phải vào docblock để lần sau khỏi đọc lại — nhưng nó là lớp rủi ro mà "đọc một file" KHÔNG thấy được.
- **`POST leave/requests/calculate` (leave.controller.ts:270) là literal-sibling** của họ `requests/:id/*` (281/294/317/334/349/364) — chưa ai kê. Hiện an toàn (không có `POST requests/:id` trần) nhưng ca ALLOW 200 rẻ, thêm vào.
- **`records/export` là `@Res()` library-mode** (attendance.controller.ts:148-160, có `@Header("Content-Type","text/csv")`, `res.send(Buffer)`) ⇒ BỎ QUA ResponseEnvelopeInterceptor ⇒ ca ALLOW CHỈ assert status, không assert body JSON. Comment ngay trên nó đã tự nhận là "route-collision guard".
- **Câu hỏi ❓ của notes đã trả lời được MỘT NỬA ở tầng schema:** `leave_types.id` = `uuid("id").primaryKey().defaultRandom()` (db/schema/hr.ts:328) và `attendance_rules.id` = `uuid(...)` (db/schema/attendance.ts:159). NHƯNG cả hai bảng ĐỀU có cột mã song song (`leave_types.code`, `attendance_rules.rule_code`) ⇒ vẫn PHẢI chứng minh bằng HÀNG THẬT rằng controller tra theo `id` chứ không theo mã. Schema chỉ loại được giả thuyết "PK là text", không loại được "route nhận mã".
- **`Idempotency-Key` an toàn khi VẮNG MẶT:** idempotency.interceptor.ts:69-70 — `if (key === "") return next.handle()`. Nên "không gửi header" KHÔNG đẻ 400 giả. `leave.controller.ts:311` có `@Idempotent()` trên approve ⇒ nếu GỬI header thì interceptor chạy trước pipe và phát lại/409 làm hỏng số đo.
- **Bằng chứng auth-session đã ghim SẴN, không cần viết mới:** `auth-session-selfservice.int-spec.ts:88-98` có ĐÔI ca — UUID hợp lệ không tồn tại → 404, và `not-a-uuid` → 404 (KHÔNG 500). Tức route này hỏng ĐÚNG CHIỀU và dùng 404 ĐƠN TRỊ có chủ ý để không mở kênh dò tồn tại phiên.

SỰ THẬT ĐÃ CÓ BẰNG CHỨNG, ĐỪNG ÉP SỐ: giả thuyết "mọi id-like unpiped đều 500" SAI ngay trong chính nhóm 32 (auth-session). Mỗi tham số phải tự đo.

BẤT BIẾN (CLAUDE.md §2 · §3): bản vá KHÔNG chạm `company_id`/RLS (pipe nằm ở BIÊN, TRƯỚC service; mọi truy vấn vẫn qua `withTenant`), KHÔNG chạm soft-delete, KHÔNG chạm secret. KHÔNG có migration ⇒ KHÔNG có lane `db-migration`, không có thứ tự RLS-trước-backfill nào phải giữ. Guard permission chạy TRƯỚC pipe (thứ tự Nest: guard → pipe) nên bản vá KHÔNG nới cổng quyền — hệ quả NGƯỢC LẠI: mọi ca đo PHẢI có actor đăng nhập + đúng cặp quyền, nếu không chỉ đo được 401 và số đo là số 0 đội lốt.

RỦI RO ĐÃ BIẾT: (1) Số đo GIẢ do body — route ghi mà body sai ăn 400 của ZodValidationPipe trước khi param chạm DB ⇒ ghi nhầm "route này đã đúng"; body phải HỢP LỆ trong mọi ca đo. (2) Verdict khoá theo số dòng sẽ TRÔI ngay ở commit vá ⇒ bắt buộc thêm `handler` vào census, khoá `file#handler:param`. (3) Ca (5) chỉ kiểm TỒN TẠI dòng verdict thì gỡ pipe xong vẫn xanh ⇒ phải assert HAI CHIỀU `decision==='piped' ⟺ hasPipe`. (4) Cám dỗ nới `expect([400,500])` khi một route cứng đầu = ghim lỗ mở trong khi sổ ghi đóng. (5) Cám dỗ vá luôn tasks/workflow vì "đằng nào cũng sửa" = scope creep, phá đúng hình dạng WO. (6) int-spec NGỦ khi thiếu `LANE_DB` ⇒ xanh-giả; verify phải qua `--lane-db`. (7) Ca (3) là ĐẲNG THỨC trên census SỐNG ⇒ PR khác merge thêm/bớt `@Param` làm nó ĐỎ OAN; rebase + chạy lại census NGAY TRƯỚC commit cuối, dán số vào PR. Rollback = revert PR, không cần feature-flag. (8) Ca ALLOW của route FSM rơi 422 (self-approval) rồi bị "chữa" bằng nới assert — sửa FIXTURE, không sửa assert. (9) Nhiều lane cùng boot AppModule + seed + `cleanupTenants` trên CÙNG một lane DB gây nhiễu chéo ⇒ mỗi lane một DB khi phát triển, hợp nhất tuần tự ở verify cuối.

GATE & MODEL: 🟡 LIGHT gate (`typescript-reviewer` + `quality-gate`) đúng notes WO — diff chỉ thêm pipe + import ở biên. LEO LÊN FULL gate NẾU diff kết thúc có chạm `auth.controller.ts` (bất kỳ hướng nào) hoặc bất kỳ file permission/RLS/secret/audit/migration nào. Việc thường ⇒ Sonnet, không cần micro-plan riêng từng lane. Mức S4 — không chặn UAT/go-live.

NGHIỆM THU "DIFF SẠCH" PHÁT BIỂU ĐÚNG: "diff chỉ gồm dòng `@Param` + dòng `import` từ `@nestjs/common`; không đổi chữ ký service/DTO/schema". Phát biểu "chỉ chạm dòng `@Param`" là BẤT KHẢ và sẽ làm reviewer đánh trượt oan.

OUT-OF-SCOPE (viết ra để chống trôi): không vá 189 tham số còn lại; không đổi `AllExceptionsFilter`; không đổi hình dạng envelope lỗi; không đụng `body-validation-*` (kênh BODY đã đóng ở KI-068); không đóng KI-078; không nâng trần; không dựng ledger cho cả 221 (verdict CHỈ phủ nhóm đợt-1 32 dòng); không sửa `auth.controller.ts` ở WO này.

VERIFY: `bash scripts/lane-db-setup.sh paramuuid2` → `export LANE_DB=mediaos_paramuuid2` (KHÔNG `source .env`) → `bash harness/check.sh --lane-db=paramuuid2`. Ratchet là spec TĨNH nên chạy ở mọi lần `pnpm test`; ba spec đo là int-spec nên chỉ có giá trị khi `LANE_DB` được set.


---

## L4 — RATCHET · SỔ PHÁN QUYẾT · TÀI LIỆU (nối tiếp L1–L3)

### L4.0 Bằng chứng RED TRƯỚC — output ĐỎ, dán nguyên văn

Bằng chứng "test viết TRƯỚC bản vá" nằm ở THỨ TỰ COMMIT, và thứ tự commit **biến mất khi PR bị
squash**. Vì thế số đo ĐỎ được chép xuống đây kèm **sha** — sau squash vẫn tra lại được bằng
`git show <sha>` trên nhánh gốc (testTask #4).

Ba commit RED, mỗi commit chỉ thêm ĐÚNG MỘT file spec, KHÔNG chạm một dòng `src/` nào (đó là điều
làm nó thật sự RED chứ không phải "đỏ dàn dựng"):

```
$ git show eb666b8c --stat --format=""
 apps/api/test/integration/leave-param-uuid.int-spec.ts  | 719 +++++++++++++++++++++
 1 file changed, 719 insertions(+)

$ git show 77a9158f --stat --format=""
 apps/api/test/integration/attendance-param-uuid.int-spec.ts | 530 +++++++++++++++++
 1 file changed, 530 insertions(+)

$ git show 1b5194ea --stat --format=""
 apps/api/test/integration/approval-param-uuid.int-spec.ts | 314 +++++++++++++++++++
 1 file changed, 314 insertions(+)
```

**`eb666b8c` — L1 LEAVE, `LANE_DB=mediaos_paramuuid2a`. Kết quả chạy: `15 failed | 35 passed (50)`.**

```
Số đo TRƯỚC-VÁ (26/08/2026) — 15/15 HỎNG:
  1 PATCH types/:id                       500 InternalServerErrorException
  2 GET   me/requests/:id                 500 Error
  3 GET   balances/:id/transactions       500 Error
  4 PATCH requests/:id                    500 InternalServerErrorException
  5 POST  requests/:id/submit             500 InternalServerErrorException
  6 POST  requests/:id/approve            500 InternalServerErrorException
  7 POST  requests/:id/reject             500 InternalServerErrorException
  8 POST  requests/:id/cancel             500 Error
  9 POST  requests/:id/revoke             500 InternalServerErrorException
 10 PATCH admin/types/:id                 500 InternalServerErrorException
 11 POST  admin/types/:id/delete          500 InternalServerErrorException
 12 PATCH admin/policies/:id              500 InternalServerErrorException
 13 POST  admin/policies/:id/delete       500 InternalServerErrorException
 14 GET   admin/balances/:id/transactions 500 Error
 15 POST  admin/balances/:id/adjust       500 InternalServerErrorException

15 ca đỏ ĐÚNG là 15 ca DENY; mọi ca ALLOW (404 đơn trị), ALLOW-200 hàng thật cho 4 loại khoá
và 8 ca literal-sibling đều XANH ⇒ 500 đến từ ĐÚNG hình dạng :id, không từ hạ tầng.
```

**`77a9158f` — L2 ATTENDANCE, `LANE_DB=mediaos_paramuuid2b`. `14 failed | 35 passed (49)`.**

```
SỐ ĐO 26/08/2026, 14/14 = 500 SYSTEM-ERR-001:
  error.type='Error'  (PG 22P02 lọt thẳng tới DB, không ai bọc):
    GET  adjustment-requests/:id · GET remote-work-requests/:id
    GET  records/:id/logs        · GET records/:id
  error.type='InternalServerErrorException' (service mapError bọc lại 22P02):
    POST adjustment-requests/:id/approve · /reject · POST records/:id/adjust-direct
    POST remote-work-requests/:id/submit · /approve · /reject · /cancel
    PATCH schedules/:id · PATCH shifts/:id · PATCH rules/:id

35 ca còn lại XANH ngay ở RED, đúng thiết kế: chúng là lưới chống-xanh-rỗng (14 ALLOW
expectPassedBoundary + 6 ALLOW-200 hàng THẬT theo LOẠI KHOÁ + 15 literal-sibling), không phải
bằng chứng của lỗi. Việc của chúng là GIỮ xanh SAU khi gắn pipe.
```

**`1b5194ea` — L3 APPROVAL, `LANE_DB=mediaos_paramuuid2c`. `2 failed / 5 passed`.**

```
POST /approval/requests/khong-phai-uuid/approve -> 500 · error.type='Error' · SYSTEM-ERR-001
POST /approval/requests/khong-phai-uuid/reject  -> 500 · error.type='Error' · SYSTEM-ERR-001
POST /approval/requests/<uuid khong ton tai>/approve -> 404 NotFoundException
POST /approval/requests/<uuid khong ton tai>/reject  -> 404 NotFoundException
POST /approval/requests/<HANG THAT pending>/approve -> 201
POST /approval/requests/<HANG THAT pending>/reject  -> 201
GET  /approval/inbox (literal-sibling) -> 200

Log 500 ghim tham so rac di TOI TAN DB (approval-multilevel.service.ts:160 loadPendingRequest):
  Failed query: select ... from "approval_requests" where ... "id" = $2  params: ...,khong-phai-uuid
```

Dòng log cuối là hiện vật MẠNH NHẤT của cả WO: nó cho thấy chuỗi rác **đi hết đường tới DB** rồi
mới nổ — chứ không phải bị chặn ở đâu đó rồi vô tình mang mã 500.

⚠️ Hai ca ALLOW-2xx của approval đo được **201**, KHÔNG phải 200 (`@Post` mặc định 201, route không
khai `@HttpCode(200)` — `approval-param-uuid.int-spec.ts:270` có docblock giải thích, assert ở
`:273` và `:296`). Đây là SỐ ĐO THẬT và được ghim ĐƠN TRỊ đúng như đo. ⛔ **CẤM** sửa assert
201→200 để khớp chữ "11 ca 200" của nghiệm thu — đó chính là lớp lỗi "ép số cho khớp mô tả" mà WO
này tồn tại để diệt. Chữ nghiệm thu đã được đính chính thành "2xx đơn trị đo được".

### L4.1 Census ĐO LẠI ngay trước commit của lane (26/08/2026)

Chạy chính `apps/api/test/foundation/param-uuid-census.ts` (AST, không regex) trên
`apps/api/src/**/*.controller.ts`, SAU ba bản vá của L1/L2/L3:

```
ID_LIKE = 298   PIPED = 108   UNPIPED = 190
```

Đối chiếu số của bước phân rã (trước vá): `ID_LIKE=298 · PIPED=77 · UNPIPED=221`. `ID_LIKE` KHÔNG
đổi (bản vá không thêm/bớt `@Param` nào, chỉ thêm đối số thứ hai) và `221 − 31 = 190` ⇒ **đúng 31
tham số được vá**, khớp với "32 tham số nhóm đợt-1 trừ 1 tham số cố ý bỏ qua".

ĐO LẠI LẦN HAI (vòng sửa tài liệu FX1, 26/08/2026, chạy chính `param-uuid-census.ts` qua
`npx tsx` từ `apps/api`, trên cây SAU cả bốn commit) — **KHÔNG TRÔI**:

```
ID_LIKE = 298   PIPED = 108   UNPIPED = 190
tasks/ 75 · workflow/ 36 · employees/ 21 · goals/ 21 · org/ 18 · foundation-ngoài-files/ 8 ·
notifications/ 6 · positions/ 3 · auth/ 1 · recycle-bin/ 1   ⇒ SUM = 190
tasks/ chi tiết: tasks.controller 43 · projects 13 · task-files 11 · labels 4 · project-states 4
```

⚠️ **ĐÍNH CHÍNH SỐ (vòng FX1):** `tasks/` là **75**, không phải 71. Con số 71 sai **ngay ở seed WO**
(cộng nhầm `43+13+11+4+4`) rồi được chép xuống bảng dưới, §L4.7, docblock ratchet và hàng KI-078.
Hệ quả là dòng tổng của chính plan doc SAI SỐ HỌC (`71+36+…` cộng ra 186 chứ không phải 190). Đã sửa
cả bốn nơi. **Trần 190 và "còn nợ 189" KHÔNG ĐỔI** — chúng đến từ `221 − 31`, không đến từ tổng
phân bố, nên `UNPIPED_CEILING` và mọi assert giữ nguyên. Đây đúng lớp lỗi `done_when` cấm ("đừng ép
số cho khớp mô tả"), chỉ khác chiều: mô tả sai được chép đi, số đo mới là thứ đúng.

Phân bố unpiped theo module sau vá (dùng để quyết định `CLEAN_PREFIXES`, **không dùng kỳ vọng**):

| module | tổng id-like | unpiped |
| --- | --- | --- |
| `tasks/` | 75 | **75** |
| `workflow/` | 36 | **36** |
| `employees/` | 28 | **21** |
| `goals/` | 21 | **21** |
| `org/` | 18 | **18** |
| `foundation/` | 15 | **8** (đều nằm NGOÀI `foundation/files/`) |
| `notifications/` | 6 | **6** |
| `positions/` | 3 | **3** |
| `recycle-bin/` | 1 | **1** |
| `auth/` | 1 | **1** ← CỐ Ý, xem L4.4 |
| `leave/` | 15 | **0** ← vá ở WO này |
| `attendance/` | 14 | **0** ← vá ở WO này |
| `approval/` | 2 | **0** ← vá ở WO này |
| `chat/` | 36 | 0 |
| `users/` | 13 | 0 |
| `permission/` | 10 | 0 |
| `user-invites/` | 2 | 0 |
| `api-keys/` · `dashboard/` | 1 · 1 | 0 |

Tổng unpiped = 75+36+21+21+18+8+6+3+1+1 = **190** ✓ (khớp `UNPIPED_CEILING` mới).

### L4.2 Khoá ỔN ĐỊNH: census xuất `handler`

`ParamSite` thêm trường `handler` (tên method chứa `@Param`) + hàm `siteKey()` trả
`file#handler:param`. Lý do KHÔNG dùng `line`: thêm một dòng `@Param("id", ParseUUIDPipe)` đẩy MỌI
site phía sau trong file xuống một dòng ⇒ sổ khoá theo số dòng trỏ sai **ngay ở chính commit vá**
([[index-ratchet-must-pin-definition-not-name]]). Đã kiểm trên census sống: **0 site có `handler`
rỗng, 0 khoá trùng** trên toàn bộ 298 site.

### L4.3 Sổ phán quyết — 32 dòng, KHÔNG PHẢI 221

`apps/api/test/foundation/param-uuid-verdicts.ts` (khuôn `fk-tenant-verdicts.ts`): mỗi dòng =
`key` (`file#handler:param`) + `route` + `decision: 'piped' | 'skipped'` + `before` (status +
`error.type` ĐO ĐƯỢC trước vá) + `reason`.

Cố ý **chỉ** phủ nhóm đợt-1. Dựng ledger 221 dòng mà 189 dòng chưa ai đo bằng HTTP là đúng thứ
`done_when` cấm ("đừng ép số cho khớp mô tả").

Tổng hợp `before` (chép từ docblock ba int-spec RED, không suy luận):

| nhóm | số | đo được TRƯỚC vá |
| --- | --- | --- |
| LEAVE (`leave.controller.ts`) | 15 | 15/15 → **500 SYSTEM-ERR-001** — 11 `InternalServerErrorException`, 4 `Error` |
| ATTENDANCE (4 controller) | 14 | 14/14 → **500** — 10 `InternalServerErrorException`, 4 `Error` |
| APPROVAL (`approval-inbox`) | 2 | 2/2 → **500** · `error.type='Error'` |
| AUTH (`revokeSession`) | 1 | **404 NotFoundException — KHÔNG 500** |

⇒ 31 `piped` + 1 `skipped` = 32.

### L4.4 Phản-ví-dụ auth-session — vì sao KHÔNG vá

`POST /auth/sessions/:id/revoke` đo được **404**, không 500 (`auth-session-selfservice.int-spec.ts`,
ca ":id dạng KHÔNG PHẢI uuid → 404"). HAI lý do độc lập, mỗi lý do đủ để không vá:

1. **Route không hỏng, và vá sẽ làm TỆ HƠN.** Owner-check ở service trả 404 đơn trị cho cả
   UUID-không-tồn-tại lẫn chuỗi rác. `ParseUUIDPipe` sẽ đổi 404 → 400 cho nhánh chuỗi rác ⇒ **tách
   được hai trường hợp** ⇒ đẻ oracle liệt kê session id.
2. **Luật WO.** `notes` cấm tuyệt đối đưa `auth.controller.ts` vào diff (chạm auth ⇒ FULL gate, WO
   này 🟡 LIGHT). `git diff --name-only` của PR KHÔNG chứa file đó.

⇒ `auth/` **KHÔNG BAO GIỜ** vào `CLEAN_PREFIXES`. Đây cũng là lý do trần mới là **190**, không phải
189: 221 − 31, chứ không phải 221 − 32.

### L4.5 Ratchet — trần hạ, `CLEAN_PREFIXES` nới, ca (5) mới

- `UNPIPED_CEILING`: **221 → 190**. Ca (3) là ĐẲNG THỨC nên quên hạ = ĐỎ; ⛔ trần không bị nâng ở
  bất kỳ commit nào của PR.
- `CLEAN_PREFIXES`: **1 → 10**. Chỉ thêm prefix census ĐO ĐƯỢC bằng 0, chia rõ hai nhóm trong
  docblock: *đo-bằng-HTTP* (`foundation/files/` · `leave/` · `attendance/` · `approval/`) và
  *sạch-sẵn, ghim để khỏi tụt lại* (`api-keys/` · `chat/` · `dashboard/` · `permission/` ·
  `user-invites/` · `users/`). `auth/` VẮNG MẶT.
- **Ca (5) mới** assert HAI CHIỀU: `decision === 'piped'` ⟺ `hasPipe === true`, và ánh xạ
  site ↔ dòng verdict là **SONG ÁNH** (thiếu dòng ⇒ ĐỎ, dòng mồ côi ⇒ ĐỎ, khoá trùng ⇒ ĐỎ). Chỉ
  kiểm "tồn tại dòng" thì gỡ pipe xong ca (5) vẫn xanh ([[tests-can-pin-a-hole-open]]). Kèm neo
  chống-xanh-rỗng: census phải thấy ĐÚNG 32 site trong 7 controller, và sổ phải có CẢ HAI quyết định
  (31 `piped` / 1 `skipped`) để không nhánh nào chạy rỗng
  ([[deny-cases-vacuous-without-allow-case]]).

**Vì sao ca (5) cần thiết dù đã có ca (2)/(3):** hai ca đó đếm TỔNG. Gỡ một pipe ở `leave` rồi thêm
một pipe ở `tasks` giữ nguyên tổng ⇒ cả hai xanh trong khi nhóm đã-đo vừa thủng.

### L4.6 KIỂM CHỨNG ĐỘT BIẾN của chính cái thước ([[vitest-globalsetup-teardown-exits-zero]])

Bốn đột biến, chạy `npx vitest run test/foundation/param-uuid-ratchet.unit-spec.ts` sau mỗi lần rồi
khôi phục nguyên trạng:

| # | đột biến | kỳ vọng | KẾT QUẢ THẬT |
| --- | --- | --- | --- |
| A | gỡ 1 `ParseUUIDPipe` vừa thêm ở `leave.controller.ts` | (1)(2)(3)(5) ĐỎ | ✅ **4 failed** — đúng ca (1), (2), (3), (5); ca (4) xanh (census vẫn khoẻ) |
| B | xoá 1 dòng verdict (`rejectRequest:id`) | chỉ (5) ĐỎ | ✅ **1 failed** — ca (5), thông báo "Site nhóm đợt-1 KHÔNG có dòng…" |
| C | đổi verdict auth `skipped` → `piped` (code KHÔNG đổi) | (5) ĐỎ ở chiều-hai | ✅ **1 failed** — ca (5): "sổ ghi 'piped' nhưng code KHÔNG có pipe" |
| D | giữ verdict `skipped`, GẮN pipe vào `auth.controller.ts` | (3)+(5) ĐỎ | ✅ **2 failed** — ca (5): "sổ ghi 'skipped' nhưng code CÓ pipe" + ca (3) (đẳng thức 189 ≠ 190) |

Đột biến C và D là hai chiều ngược nhau của cùng một ⟺, và cả hai đều bị bắt ⇒ ca (5) thật sự
assert HAI CHIỀU chứ không phải chỉ kiểm tồn tại. Sau cả bốn:
`git status --porcelain apps/api/src` **rỗng** (không sót mutation nào trong cây).

### L4.7 Đợt 2 — gợi ý đã seed vào `harness/backlog.mjs`

189 tham số còn nợ, **CHƯA ai đo bằng HTTP**: `tasks/` 75 · `workflow/` 36 · `goals/` 21 ·
`employees/` 21 · `org/` 18 · `foundation/` ngoài `files` 8 · `notifications/` 6 · `positions/` 3 ·
`recycle-bin/` 1. Bốn nhóm lớn nhất (tasks · workflow · goals · employees = 153) là ứng viên đợt 2.

⚠️ Cùng khuôn, không được rút gọn: ĐO bằng HTTP TRƯỚC → vá → hạ trần → ký verdict. Giả thuyết "mọi
id-like unpiped đều 500" đã SAI một lần ngay trong nhóm 32 (auth-session = 404), nên đợt 2 KHÔNG
được vá mù.

### L4.8 Cảnh báo cho người merge

Ca (3) là **đẳng thức trên census SỐNG**. Một PR khác thêm/bớt `@Param` id-like sẽ làm nó ĐỎ OAN ở
PR này. Cách xử lý ĐÚNG: **rebase + chạy lại census ngay trước commit cuối**, dán số vào PR. Cách xử
lý SAI: nới ca (3) thành `toBeLessThanOrEqual` — đó là tháo chính cái van vừa lắp.

#### FLAKE ĐÃ QUAN SÁT ĐƯỢC — 500 cold-start ở ca DENY `PATCH /leave/types/:id`

**Đọc mục này TRƯỚC khi kết luận "bản vá thủng".**

Số đo: lần chạy **ĐẦU TIÊN** của `leave-param-uuid.int-spec.ts` trên `mediaos_paramuuid2` (DB vừa
chain-migrate xong, pool còn lạnh) cho **1 failed / 49 passed** — ca DENY `PATCH /leave/types/:id`
trả **500 `SYSTEM-ERR-001`** thay vì 400, AssertionError tại `leave-param-uuid.int-spec.ts:379`
(chính dòng `expect(res.status).toBe(400)` trong `expectRejectedAtBoundary`). **Ba lần chạy sau đó
đều 50/50 XANH**: chạy đơn lẻ, chạy gộp ba spec hai lượt, và chạy trong `harness/check.sh`.

Suy luận từ số đo, KHÔNG từ mô tả: `ParseUUIDPipe` là **TẤT ĐỊNH** — cùng chuỗi vào thì cùng kết quả
ra, nó không có nhánh nào phụ thuộc DB/thời gian. Vậy 500 đó **không thể** phát sinh TỪ pipe; nó chỉ
có thể đến từ tầng chạy **TRƯỚC** pipe trong thứ tự Nest (guard → interceptor → pipe): guard quyền
đọc permission-cache lạnh, hoặc pool đi qua PgBouncer ở lượt kết nối đầu. Khớp với việc chính lần
chạy đó `check.sh` báo `@mediaos/api: 3 lần chạy lại (crash hạ tầng)`.

⚠️ **KẾT LUẬN: KHÔNG phải lỗ của bản vá** (nếu pipe hỏng thì nó phải hỏng ở **cả 4 lần chạy**, và
phải kéo theo 14 ca DENY còn lại chứ không đúng một ca). **NHƯNG** đây là spec biên **có thể ĐỎ
NGẪU NHIÊN ở CI**. Xử lý đúng khi gặp lại: chạy lại spec đó một mình trên lane DB đã ấm; nếu 500 tái
hiện ĐỀU ĐẶN thì mới là hồi quy, và điểm cần soi là **guard/interceptor**, không phải dòng `@Param`.
Việc còn nợ: một WO nhỏ truy nguồn 500 cold-start (ngoài phạm vi WO này — nó KHÔNG do WO này gây ra,
chỉ được WO này QUAN SÁT ĐƯỢC lần đầu vì đây là spec đầu tiên đo biên PARAM trên lane DB nguội).

### L4.9 Census HỘ TIÊU THỤ — ĐỦ TÁM chỗ (nghiệm thu #14)

Đổi `500 → 400` là **đổi hành vi quan sát được**, nên phải chứng minh không hộ nào đang ĐỌC mã 500
của đúng những route này. Vòng trước mới quét 4/8 chỗ; đây là bản quét đủ 8, mỗi dòng ghi LỆNH đã
chạy và số khớp THẬT (26/08/2026, từ gốc repo):

| # | Chỗ quét | Lệnh đã chạy | Khớp | Kết luận |
| --- | --- | --- | --- | --- |
| 1 | `apps/api/test/**` | `grep -rn "toBe(500)\|toContain(500)" apps/api/test \| grep -i "leave\|attendance\|approval"` | **2** | Cả 2 là `not.toBe(500)` của chính oracle ALLOW mới (`approval-param-uuid:247`, `attendance-param-uuid:317`) ⇒ KHÔNG hộ nào **đòi** 500 |
| 2 | `apps/api/src/**/*.spec.ts` | `grep -rn "toBe(500)" --include="*.spec.ts" apps/api/src` | **1** | `common/filters/all-exceptions.filter.spec.ts:68` — unit spec của FILTER, không gắn route nào ⇒ không bị bản vá chạm |
| 3 | `apps/app/src` | `grep -rn "leave/requests/\|attendance/records/\|approval/requests/\|leave/types/\|attendance/rules/"` + `grep -rn "=== *500\|== *500"` | **14** path · **1** nhánh-500 | 14 khớp đều là **path ROUTER/API-client**, không nhánh nào rẽ theo status. Nhánh 500 duy nhất là `routes/goals/GoalFormPage.tsx:480` (`err.status !== 500`) — thuộc **`goals/`**, module KHÔNG nằm trong nhóm đã vá |
| 4 | `apps/console/src` | cùng hai lệnh trên | **0** · **0** | Console không gọi route nào của nhóm |
| 5 | `apps/auth/src` | cùng hai lệnh trên | **0** · **0** | App đăng nhập không chạm |
| 6 | `packages/**` | cùng hai lệnh trên | **77** path · **0** nhánh-500 | 77 khớp nằm ở `contracts/src/{leave,attendance,approval}.ts` + `web-core/src/lib/*-api.ts` (+ bản `dist/`) — toàn **chuỗi đường dẫn** và schema, 0 chỗ đọc `status===500` |
| 7 | `scripts/**` | cùng hai lệnh trên | **0** · **0** | Không script vận hành nào phụ thuộc |
| 8 | repo `apps/lms` (git RIÊNG) | `grep -rn "/api/v1/leave\|/api/v1/attendance\|approval/requests/" apps/lms/src` + `grep -rn "== *500"` | **0** · **0** | LMS gọi API MediaOS nhưng KHÔNG chạm nhóm route này |

**KẾT LUẬN:** phía FE chỉ tồn tại **path ROUTER / API-client**, **KHÔNG hộ tiêu thụ nào phụ thuộc mã
500** của các route được vá ⇒ đổi `500 → 400` **AN TOÀN**. Nhánh 500 duy nhất tìm thấy trong toàn bộ
FE (`GoalFormPage.tsx:480`) thuộc `goals/` — nằm trong **189 tham số CÒN NỢ**, không bị WO này chạm;
ghi ra đây để đợt 2 (goals 21 tham số) biết trước là có một hộ tiêu thụ ĐANG đọc status 500 và phải
được xử lý cùng lúc với bản vá, chứ không phát hiện sau.
