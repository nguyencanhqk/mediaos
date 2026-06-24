```yaml
wo: S1-FND-AUDIT-1
zone: red
generated_by: auto-loop
reconciled_at: "fef0df0"
lanes:
  - id: L1-write-shape
    task: >
      AuditService.record() write side — điền NỐT 11 cột §8.5 mig 0438
      (actor_employee_id, action_group, entity_id_text, entity_code, permission_code,
      data_scope, device_info, diff_summary, error_code, error_message, metadata)
      vào AuditEntry + insert; GIỮ tự-tính changed_fields từ old/new ĐÃ MASK;
      ép enum data_scope ∈ {Own,Team,Department,Company,System} + actor_type/sensitivity_level/result_status
      hợp lệ ở tầng app (fail-closed → mặc định/throw, KHÔNG để vỡ CHECK Postgres).
      MỌI field v2 OPTIONAL/null-default — KHÔNG vỡ 43 caller cũ.
      crown-jewel: audit append-only + bất biến #3 (mask TRƯỚC insert).
      KHÔNG đụng read-side/contracts (lane khác).
    builder: backend-builder
    paths:
      - apps/api/src/events/audit.service.ts
      - apps/api/src/events/audit-masker.service.ts
  - id: L2-read-contracts
    task: >
      Read-API + contracts polish — bổ sung filter §8.5 còn thiếu (data_scope,
      action_group, permission_code) vào auditLogQuerySchema + AuditFilter + buildWhere;
      map thêm 11 cột §8.5 mới vào auditLogDtoSchema + AuditQueryService.toDto
      (oldValues/newValues vẫn redact-at-read, device_info/metadata redact qua masker,
      changed_fields chỉ TÊN field). GIỮ 2-scope tách route + fail-closed 2 lớp.
      KHÔNG đụng events/* (lane L1).
    builder: backend-builder
    paths:
      - apps/api/src/foundation/audit/audit.service.ts
      - apps/api/src/foundation/audit/audit.repository.ts
      - apps/api/src/foundation/audit/audit.dto.ts
      - apps/api/src/foundation/audit/audit.controller.ts
      - apps/api/src/foundation/audit/audit.module.ts
      - packages/contracts/src/observability.ts
  - id: L3-tests-foundation
    task: >
      Re-home + bổ sung test vào apps/api/test/foundation/** —
      (a) unit write-shape: record() điền đủ 11 cột §8.5 mới khi caller cung cấp;
      caller chỉ-v1 → cột mới = null (KHÔNG vỡ); data_scope ngoài enum → reject/normalize;
      (b) integration audit-list/detail filter module/action/actor/entity/from-to +
      scope Company chỉ thấy tenant hiện tại, System thấy chéo;
      (c) deny-path RED: Employee → 403, response KHÔNG chứa token/password/storage_path;
      (d) append-only: app role UPDATE/DELETE bị từ chối.
      DB cô lập (skipIf !hasDb).
      Tái dùng/di chuyển foundation-audit.e2e-spec.ts + audit-logs-appendonly.int-spec.ts.
    builder: backend-builder
    paths:
      - apps/api/test/foundation/**
acceptanceChecks:
  - >
    record() điền ĐỦ field DB-08 §8.5 khi caller cung cấp
    (module_code/action/entity_type/entity_id/actor_type/sensitivity_level/result_status +
    11 cột mig 0438: actor_employee_id/action_group/entity_id_text/entity_code/permission_code/
    data_scope/device_info/diff_summary/error_code/error_message/metadata);
    changed_fields TỰ TÍNH từ old/new ĐÃ MASK (chỉ TÊN field).
  - >
    Caller chỉ-v1 (không cung cấp field v2) → mọi cột v2 = null, changed_fields = null;
    43 caller hiện hữu typecheck XANH (chữ ký record() backward-compatible, field optional).
  - >
    record() ghi TRONG tx withTenant (nhận TenantTx) — audit + thay đổi nghiệp vụ
    cùng commit/rollback (giữ outbox/append-only bất biến #2).
  - >
    data_scope ép enum {Own,Team,Department,Company,System} ở tầng app
    (DB không CHECK — schema note); actor_type/sensitivity_level/result_status hợp lệ
    trước insert ⇒ KHÔNG vỡ CHECK Postgres (fail-closed, KHÔNG xanh-giả).
  - >
    masker che password/token/secret_ref/identity/bank/storage_path/signed_url TRƯỚC insert
    + redact-at-read lúc map DTO; mask KHÔNG vỡ diff
    (key non-secret giữ value; changed_fields chỉ TÊN field).
  - >
    GET /foundation/audit-logs (+/{id}) filter được module/action/actor/entity/from-to
    (+ data_scope/action_group bổ sung); meta total/limit/offset; limit kẹp ≤100 (MAX_AUDIT_PAGE_LIMIT).
  - >
    Scope Company: withTenant → chỉ thấy audit tenant hiện tại (RLS ép);
    Scope System (/all): operator (@OperatorOnly + view:platform-audit) thấy chéo tenant,
    ?companyId khoanh 1 tenant.
  - >
    Deny-path RED: Employee thiếu view:audit-log → 403; tenant token GET /all → 401
    (biên audience); response (list + detail) KHÔNG chứa token/password/storage_path
    (kể cả hàng RAW legacy).
  - >
    Append-only: app role UPDATE/DELETE audit_logs bị từ chối (permission denied);
    repo CHỈ SELECT/COUNT.
  - >
    DoD §8: test có (unit + integration DB cô lập), coverage ≥80% nhánh write-shape/data-scope;
    cập nhật harness/backlog.mjs (WO done);
    KHÔNG cần migration (head idx 121/0438 đã đủ §8.5).
testTasks:
  - >
    RED deny-path (permission): Employee thiếu view:audit-log GET /foundation/audit-logs → 403;
    tenant token GET /foundation/audit-logs/all → 401; operator-audience DENY view:platform-audit → 403.
    (di chuyển/giữ foundation-audit.e2e-spec.ts → apps/api/test/foundation/)
  - >
    RED secret-leak: response list + detail KHÔNG chứa token/password/storage_path/signed_url —
    kể cả hàng audit RAW legacy chưa-mask (chứng minh redact-at-read).
  - >
    Unit write-shape: record() điền đủ 11 cột §8.5 mới khi cung cấp;
    caller chỉ-v1 → cột v2 = null + changed_fields = null;
    changed_fields tính từ old/new ĐÃ MASK (secret 2 vế ⇒ không tính là đổi).
  - >
    Unit data_scope guard: data_scope ngoài {Own,Team,Department,Company,System} →
    reject/normalize (fail-closed); actor_type/sensitivity_level/result_status ngoài enum →
    reject trước insert.
  - >
    Integration (DB cô lập, skipIf !hasDb): audit-list filter module/action/actor/entity/dateFrom-dateTo
    trả đúng tập; scope Company chỉ thấy tenant hiện tại, System thấy chéo + ?companyId khoanh 1 tenant;
    pagination meta/total đúng + limit cap.
  - >
    Integration append-only: INSERT app role OK; UPDATE/DELETE app role DENIED (permission denied) —
    giữ audit-logs-appendonly.int-spec.ts dưới apps/api/test/foundation/.
  - >
    Masker unit (giữ): 8 stem nhạy cảm snake/camel + biến thể ghép, đệ quy nested/array,
    immutable, passthrough null/Date.
steps:
  - >
    L1 (write-shape) TRƯỚC: mở rộng AuditEntry + record() insert 11 cột §8.5 mới (mig 0438) —
    tất cả OPTIONAL, null khi caller không cung cấp; thêm app-tier guard enum
    data_scope/actor_type/sensitivity_level/result_status (fail-closed).
    GIỮ mask-at-write + changed_fields từ old/new đã mask.
    Đối chiếu schema apps/api/src/db/schema/audit.ts (đã có đủ cột) — KHÔNG cần migration.
  - >
    L2 (read-contracts) SAU L1 (độc lập paths, không phụ thuộc runtime): thêm filter §8.5 mới
    vào observability.ts + AuditFilter/buildWhere; map cột mới vào DTO + toDto
    (giữ redact-at-read, redact device_info/metadata).
    Build contracts trước (turbo) để api thấy type mới.
  - >
    L3 (tests) SAU L1+L2: tạo apps/api/test/foundation/**; viết RED deny-path +
    integration filter/scope + append-only + unit write-shape;
    di chuyển foundation-audit.e2e-spec.ts & audit-logs-appendonly.int-spec.ts vào thư mục foundation
    (cập nhật import tương đối). Chạy DB cô lập theo CLAUDE §9.5.
  - >
    Gate FULL (crown audit/permission/secret): security-reviewer + database-reviewer +
    silent-failure-hunter + santa-method; verify pnpm --filter @mediaos/api typecheck/test xanh
    + ≥80% coverage cho nhánh write-shape/data-scope.
```

## RECONCILE-FIRST

WO này phần lớn ĐÃ land ở FOUNDATION-BE-3 (write masker + read-API 2-scope + redact) và DB-6 (mig 0432 + 0438 = full §8.5 23 cột). KHÔNG cần migration mới (STATUS: migration head idx 121 / 0438_foundation_db6_audit_db08_shape). `data_scope` đã có cột DB (mig 0438) NHƯNG KHÔNG có CHECK ở Postgres — schema `apps/api/src/db/schema/audit.ts` §S0-FND-DB-1 note cố ý hoãn en-force enum `Own/Team/Department/Company/System` sang tầng app ở S1-FND-AUDIT-1 → đây là **gap CHÍNH** cần làm.

## ĐÃ XONG (giữ, KHÔNG viết lại)

- `AuditMaskerService` (mask-at-write + redact-at-read dùng CHUNG hàm, `SENSITIVE_STEMS` substring-match, immutable, đệ quy object/array, Date passthrough) + unit test đủ.
- `AuditService.record()` tự-tính `changed_fields` từ old/new ĐÃ MASK + ghi cặp cột mig-0432 v2 khi cung cấp.
- Read: `AuditController` (Company `GET /` + `/:id`; System `GET /all` + `/all/:id`, route-order an toàn, `@OperatorOnly` + `@RequirePermission isSensitive`), `AuditQueryService` (`withTenant` vs `withPlatformReadContext` + redact-at-read), `AuditRepository` (CHỈ SELECT/COUNT — append-only), `AuditLogQueryDto`, `observability.ts` (filter module/action/actor/entity/from-to + limit cap 100), `AuditModule`.
- Append-only DB (REVOKE UPDATE/DELETE mig 0432) + test `audit-logs-appendonly.int-spec.ts`.
- Deny-path e2e `foundation-audit.e2e-spec.ts` (3a 403, 3c tenant-iso, 3d 401 audience, 3e 403 deny-override, 3b redact RAW legacy).

## GAP cần build

1. `record()` CHƯA điền 11 cột §8.5 MỚI của mig 0438 (`actor_employee_id`/`action_group`/`entity_id_text`/`entity_code`/`permission_code`/`data_scope`/`device_info`/`diff_summary`/`error_code`/`error_message`/`metadata`) — chưa có trong `AuditEntry`, chưa insert ⇒ write() chưa "điền đủ field DB-08".
2. Chưa ép enum `data_scope`/`actor_type`/`sensitivity_level`/`result_status` ở tầng app (DB chỉ CHECK 3 cột actor_type/sensitivity/result_status — mig 0432; `data_scope` KHÔNG CHECK).
3. Test chưa nằm dưới `apps/api/test/foundation/**` (path WO — dir hiện CHƯA tồn tại).
4. Filter/DTO read-side chưa expose `data_scope`/`action_group` (tùy chọn — `done_when` chỉ yêu cầu module/action/actor/entity/from-to, đã có).

## INVARIANT CỨNG

43 caller (grep `AuditService` trong `apps/api/src`, trừ spec) phụ thuộc `record()`. MỌI field v2 PHẢI optional + null-default; chữ ký `record(tx, entry)` GIỮ NGUYÊN. Bất biến #2 append-only: repo/read KHÔNG path UPDATE/DELETE; `record()` ghi trong tx `withTenant`. Bất biến #3: mask TRƯỚC insert + redact lúc đọc, `changed_fields` chỉ TÊN field. enum guard fail-closed: `data_scope`/`actor_type`/... sai → reject/normalize TRƯỚC insert (tránh vỡ CHECK Postgres = lỗi 500 + xanh-giả).

## VERIFY

`pnpm build` (contracts trước) → `pnpm --filter @mediaos/api typecheck` + `test`; DB cô lập (CLAUDE §9.5): `scripts/lane-db-setup.sh <lane>` → `LANE_DB=mediaos_<lane>` → test. GATE: FULL (crown audit/permission/secret) = `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `santa-method`. Coverage ≥80% cho write-shape/data-scope (module nhạy cảm).

## OUT-OF-SCOPE

KHÔNG migration mới (cột đủ rồi); KHÔNG đổi chữ ký `record()` phá caller; KHÔNG thêm CHECK `data_scope` ở DB (chủ ý ép ở app); KHÔNG đụng outbox/event-bus; KHÔNG nới `AUDIT_OBJECT_TYPES` (append-only union); media/finance/SaaS/payroll OUT-OF-SCOPE (de-media-fy).
