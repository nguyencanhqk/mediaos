# Audit Hệ thống / Foundation — đối chiếu code ↔ bộ tài liệu (2026-07-02)

> Báo cáo audit read-only, KHÔNG sửa code. Nhánh audit: `wip/s2-fe-hr-5-hr5-wc` (đã sync `origin/master`, bao gồm PR #82–#85).
> Phương pháp: 6 lane audit độc lập chạy song song, mỗi lane đọc doc + code thật rồi đối chiếu từng hạng mục.
> Khi mâu thuẫn: **docs/DB + docs/spec là chuẩn** (CLAUDE.md) — trừ các lệch-có-chủ-đích đã pin (Option-A evolve-additive, single-tenant v2).

**Bộ tài liệu đối chiếu (10):** DB-08 · DB-09 · DB-10 · BACKEND-04 · BACKEND-11 · BACKEND-12 · API-09 · API-10 · FRONTEND-13 · FRONTEND-05.

---

## 1. Kết luận nhanh

| Tầng | Doc | Kết quả đếm | Verdict |
| --- | --- | --- | --- |
| DB schema + index | DB-08, DB-09 | Bảng: 10/15 đúng · 3 lệch · 2 thiếu. Index: 16 đúng · 7 lệch · 11 thiếu | **Khá tốt** — RLS/append-only chắc; thiếu 2 bảng job |
| Migration + seed | DB-10 | 14 đúng · 9 lệch · 12 thiếu · 3 thừa | **Hổng seed** — dựng-từ-DB-trống chưa tự chạy được |
| BE Foundation | BACKEND-04 | 20 đúng · 9 lệch · 11 thiếu · 1 thừa | **Lõi tốt** — nợ audit holiday + admin surface thiếu |
| BE File/Audit/Settings/Jobs | BACKEND-11 | 15 đúng · 9 lệch · 14 thiếu · 2 thừa | **Yếu nhất** — file policy/upload/jobs hụt lớn |
| API contract | API-09, BACKEND-12, API-10 | 21 đúng · 9 lệch · 23 thiếu · 4 thừa | **Guard chắc (0 route hở)** — Swagger chưa tồn tại |
| FE System + Layout | FRONTEND-13, FRONTEND-05 | 12/16 màn đúng · 2 lệch · 2 thiếu; layout ~80% | **Tốt** — lỗi 1-dòng defaultRoute + sidebar thiếu entry |

**Không phát hiện vi phạm CRITICAL nào về 3 bất biến:**
- Mọi bảng foundation có `company_id` đều có RLS + FORCE + policy đúng mẫu; `withTenant` phủ mọi service.
- 6 bảng append-only đã khai báo đều đúng grant SELECT/INSERT-only.
- Không secret plaintext (mask-at-write + redact-at-read + drop `secret_ref` tận nguồn; sticky-secret guard vượt yêu cầu doc).
- Không route foundation nào thiếu guard (JwtAuthGuard + CompanyGuard global; PermissionGuard fail-closed từng controller).

**Nhưng có 8 vấn đề HIGH** (mục 2) và một cụm THIẾU lớn tập trung ở: khung System Jobs, upload file E2E, seed dữ liệu ban đầu, admin surface (system-settings / module toggle / export audit), Swagger/OpenAPI.

---

## 2. Vấn đề HIGH — cần xử lý trước

| # | Vấn đề | Vị trí | Doc vi phạm |
| --- | --- | --- | --- |
| H1 | **File policy resolver registry RỖNG ở production** — HR/ATT/LEAVE/TASK không đăng ký resolver nào (`registerResolver` chỉ xuất hiện trong spec test) ⇒ mọi file, kể cả gắn entity HR nhạy cảm, chỉ gate bằng fallback `FOUNDATION.FILE.*` mức company — ai có `download:foundation-file` tải được mọi file tenant | `apps/api/src/foundation/files/file-policy.service.ts:154-161` | BACKEND-11 §11.10, §25.1 |
| H2 | **Download không kiểm `scan_status`/`upload_status`** — file `Infected` (phải quarantine) hoặc `Pending` vẫn presign được URL tải; chỉ luồng link chặn Infected | `apps/api/src/foundation/files/files.service.ts:231-263` | BACKEND-11 §11.2, §11.9 |
| H3 | **Upload E2E không hoàn chỉnh** — POST /upload chỉ đăng ký metadata (`upload_status='Pending'`); không có đường binary (multipart/presigned-PUT), không endpoint confirm ⇒ file kẹt Pending vĩnh viễn; checksum không bao giờ được tính | `apps/api/src/foundation/files/files.service.ts:84-166` | BACKEND-11 §11.4, §11.6.6 |
| H4 | **Pair-drift audit-log 0435 ↔ 0340 còn nguyên** — seed `view/export:foundation-audit-log` (0435:345-346) nhưng AuditController gate `view:audit-log` (0340); my-apps map capability bằng cặp foundation ⇒ user có cặp foundation thấy app Audit nhưng gọi API 403; `export:foundation-audit-log` orphan hoàn toàn. Fail-closed (không hổng bảo mật) nhưng happy-path gãy — đúng lớp bẫy S1-FND-MODULE | `apps/api/src/foundation/audit/audit.controller.ts:33,58` · `module-app-metadata.ts:37` | API-09 §6.3, API-10 |
| H5 | **Holiday CRUD không ghi audit CONFIG** — nợ deferred từ FOUNDATION-BE-6 → BE-9, đến nay CHƯA trả (comment defer còn trong code) | `apps/api/src/foundation/holidays/holidays.service.ts:75-76, 151-220` | BACKEND-04 §17.4, DoD §8 CLAUDE.md |
| H6 | **`GET /foundation/settings/public` đòi `view:foundation-setting`** — doc quy định Authenticated ⇒ nhân viên thường (không có quyền foundation) bị 403, FE không bootstrap được public settings (timezone/locale/file limits). Lệch theo hướng chặt hơn — cần chốt: mở về Authenticated hoặc pin vào spec | `apps/api/src/foundation/settings/settings.controller.ts:40-41` | BACKEND-04 §9.4 (API-10 AUD-008 khuyến nghị Authenticated) |
| H7 | **Sequence counters không được seed ở bất kỳ tầng nào** — không migration INSERT, không runtime seeder, không API tạo (controller chỉ GET/PATCH), service không có `ensureCounter` ⇒ trên DB sạch không auto-sinh được `employee_code` (`hr-write.service.ts:412-425` throw); smoke test DB-10 §19.3 FAIL | `apps/api/migrations/0434` (chỉ DDL) · `sequence.controller.ts:38-59` | DB-10 §14, §19.3; BACKEND-04 §11.5 rule 3 |
| H8 | **FE app "Hệ thống" defaultRoute trỏ trang placeholder** — `defaultRoute: "/system/settings"` = SystemSettingsPage "sắp ra mắt" ⇒ mở app từ Home Portal rơi vào màn trống thay vì `/system` Overview (sửa 1 dòng) | `packages/web-core/src/lib/registry.ts:556` | FRONTEND-13 §7.1 |

Ngoài ra 2 vấn đề sát ngưỡng HIGH:

- **`GRANT ... DELETE ON companies TO mediaos_app`** (`apps/api/migrations/0002_companies_users.sql:34`) — app role hard-delete được company, trái DB-08 §8.1 rule 4 + tinh thần bất biến #2; mọi bảng foundation mới đều đã bỏ DELETE, riêng `companies` (và `users`) còn giữ.
- **Bảng `companies` chưa reconcile theo DB-08 §8.1** — `company_code` nullable không unique (code dùng `slug`), status CHECK chỉ `active/suspended`, thiếu `legal_name/country_code/default_locale/currency_code/logo_file_id/metadata/created_by...`, thừa cột hướng cũ (`working_days_json`, `payroll_config_json`...).

---

## 3. Tầng DB (DB-08 + DB-09)

### 3.1 Bảng (15 bảng DB-08)

- **ĐÚNG (10):** `modules`, `system_settings`, `company_settings`, `files`, `file_links`, `file_access_logs` (1 lệch nhỏ có chủ đích: `actor_employee_id` không FK vì bảng `employees` không tồn tại — dùng `employee_profiles`), `sequence_counters` (uq mạnh hơn doc nhờ COALESCE company_id), `data_retention_policies`, `seed_batches`, `seed_items`.
- **LỆCH (3):**
  - `companies` (HIGH — xem mục 2).
  - `audit_logs` — đủ 29/29 cột nhưng Option-A: `company_id` NOT NULL (mạnh hơn doc — chủ đích), một số cột doc bắt NOT NULL thì code nullable (ép ở app), thừa cột legacy `object_type/object_id/before/after/ip` + CHECK union (writer v1 vẫn dùng). Đã pin trong comment migration 0438.
  - `public_holidays` — `is_paid` → `is_paid_holiday` (đã pin, mig 0434).
- **THIẾU (2):** `system_job_runs` (§8.14) + `system_job_locks` (§8.15) — chưa build ở bất kỳ đâu; RetentionService đã ship nhưng không có nơi ghi nhật ký run/lock.

### 3.2 Index (DB-09)

- 16 đúng · 7 lệch (phần lớn là **doc-drift nội bộ DB-08↔DB-09**, code nhất quán chọn theo DB-08) · 11 thiếu (4 do 2 bảng job chưa build).
- Thiếu đáng chú ý: `uq_file_links_entity_file_active` (không gì chặn link trùng 1 file vào cùng entity nhiều lần khi non-primary — MEDIUM), `idx_files_company_status`, `idx_files_cleanup_deleted`, `idx_file_access_logs_company_time`, `idx_sequence_counters_reset` (hiệu năng job cleanup/viewer khi dữ liệu lớn).
- `idx_audit_logs_entity` = `(module_code,entity_type,entity_id)` thiếu company_id-first + `created_at DESC` so DB-09 §8.5 (deviation kế thừa, ghi ở 0438:33-35).
- audit_logs thiếu **trigger chặn UPDATE lớp 2** (header DB-08 yêu cầu "REVOKE + trigger"; hiện chỉ grant-level — đủ với app role, thiếu defense-in-depth).

### 3.3 Doc-drift nội bộ cần pin vào spec (không phải lỗi code)

DB-09 tham chiếu cột không tồn tại trong chính DB-08: `file_access_logs.accessed_at` (DB-08 = `created_at`), `files.checksum` (DB-08 = `checksum_sha256`/`content_hash`), uq holiday theo `name` (DB-08 = `holiday_code`), index audit actor có/không company_id-first.

---

## 4. Tầng Migration + Seed (DB-10)

### 4.1 Cơ chế — ĐÚNG

- RLS + FORCE **trước** backfill/seed ✔ · journal đơn điệu, head thực = **0465** ✔ · seed permission ON CONFLICT DO NOTHING (band mới) ✔ · forward-only rollback ✔.
- Seed-tracking 3 tầng khớp doc: migration seed (global) + runtime `MasterDataSeedRunner` per-company (idempotent theo batch/item + SHA-256 checksum, fail-closed nếu payload chứa field nhạy cảm) + ops surface `GET /foundation/seeds`.
- Shift `OFFICE_8H` + rule `DEFAULT_OFFICE_RULE` khớp doc từng field ✔.

### 4.2 Seed data — HỔNG LỚN (dựng-từ-DB-trống chưa tự động)

| Seed theo DB-10 | Hiện trạng |
| --- | --- |
| Sequence counters (§14) | **0 — không tầng nào seed** (H7) |
| Default company (§17.1) | **Bước psql tay** (`scripts/windows/03-migrate.ps1:32-38`); bootstrap admin fail-fast khi company vắng → seed tay + restart |
| System settings (§11.1) | **5/14 key**; lệch giá trị: `file.max_upload_size_mb` 25 vs doc 20, `default_locale` `vi` vs `vi-VN`; fallback hard-code chỉ phủ 6 key |
| Company settings (§11.2) | **0/12** (giảm nhẹ bởi precedence + defaults, nhưng `attendance.*`/`leave.*` defaults không tồn tại) |
| HR master (job_levels 8, contract_types 5, employee_code_config) | **0** — 0445 chủ đích dời runtime nhưng lane chưa làm |
| Leave types (§14.3) | **4/8** (`ANNUAL/SICK/UNPAID/OTHER`; mã khác doc `ANNUAL` vs `ANNUAL_LEAVE`; thiếu MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY; ANNUAL `allowHourly:false` vs doc true) |
| Public holidays VN | **0** — admin nhập tay qua FE |
| Bootstrap admin (§17.2) | ĐÚNG phần lớn (env + argon2id + idempotent + audit in-tx); thiếu `must_change_password=true` |
| `role_permissions.data_scope` CHECK | **5/6 giá trị — thiếu `Project`** (0441:30-31, khớp phát hiện AUTH-audit 2026-07) |
| TASK/NOTI/DASH perms + templates + widgets | Thiếu đúng tiến độ (Sprint 4-6) — theo dõi, không phải lỗi |

**THỪA (park):** ~40 migration seed media-era + `system_modules` (0330) song song `modules` (0435) + 6 role media-era — đúng chính sách park nhưng làm catalog phình, là nguồn nhầm pair-drift.

---

## 5. Tầng Backend (BACKEND-04 + BACKEND-11)

### 5.1 Phần ĐÚNG đáng ghi nhận

- Company update audit in-tx, mask + changedFields ✔ · Settings precedence company→system→default batch ≤2 query ✔ · mask fail-closed + sticky-secret guard (vượt doc) ✔ · Sequence FOR UPDATE trong withTenant, format/reset đúng §11.5 ✔ · Holiday override company>global theo ngày ✔ · SeedTracking idempotent ✔ · AuditService.record in-tx, 180 call-site/47 file ✔ · Audit viewer 2 scope company/operator fail-closed 2 lớp ✔ · Outbox worker claim FOR UPDATE SKIP LOCKED + retry + dead-letter ✔ · Retention dynamic SQL vẫn WHERE company_id + regex identifier ✔.

### 5.2 THIẾU / LỆCH chính (ngoài các HIGH mục 2)

| Hạng mục | Chi tiết | Mức độ |
| --- | --- | --- |
| Khung System Jobs (§18 + §9.9) | Không JobRegistry/JobLock/system_job_runs/API `/system-jobs`; scheduler duy nhất = `setInterval` cho outbox; `RetentionCleanupJob` skeleton **chưa được schedule** (nợ BE-9); TEMP_FILE_CLEANUP thiếu dù cột `is_temporary/expires_at` + index có sẵn | HIGH (gộp) |
| Admin surface thiếu endpoint dù permission ĐÃ seed (orphan) | `update:foundation-module` (không PATCH module → không bật/tắt qua API), `system-manage:foundation-setting` (không system-settings API), `export:foundation-audit-log`, `run:foundation-seed`, `view/run:foundation-job`; retention thiếu POST create + simulate/run route (service có, controller không expose) | MEDIUM |
| Module disable không ép runtime | Cờ enabled chỉ lọc listing; không nơi nào trả `FOUNDATION-ERR-MODULE-DISABLED` 403 khi gọi API module bị tắt (§11.7) | MEDIUM |
| Audit masker thiếu field so §12.5 | Stems thiếu `otp`, `salary_amount`, `personal_health_info`; `identitynumber` không khớp biến thể `id_card_number` — đang dựa kỷ luật DTO-at-source (đã có tiền lệ lọt: S2-HR-BE-2) | MEDIUM |
| File-link không validate entity gốc | Chỉ validate file thuộc tenant; entity polymorphic không kiểm tồn tại/tenant (comment tự nhận, để WO module-owner) | MEDIUM |
| File access log thiếu context | `ip_address/user_agent/request_id` có cột nhưng không caller nào truyền | MEDIUM |
| Settings cache (§11.2/§13.6) | Không có cache layer + invalidation nào — perf-only | MEDIUM |
| SequenceService | Thiếu `ensureCounter` (type có, method không → counter vắng = plain Error dễ 500); timezone hard-code `Asia/Ho_Chi_Minh` (TODO đọc settings); SequenceModule KHÔNG nằm trong FoundationModule — route sống nhờ EmployeesModule import | MEDIUM |
| Error codes | **0/18 mã `FOUNDATION-ERR-*`** được dùng; filter global chỉ map generic (`AUTH-ERR-FORBIDDEN`...); vi phạm validation_schema trả 422 vs doc 400 | MEDIUM |
| MIME/extension | Không đối chiếu extension↔MIME, không `file.blocked_extensions`; `download_count/last_accessed_at` không bao giờ ghi; audit interceptor tự động (§12.3) không có — manual call đủ phủ | LOW-MEDIUM |

### 5.3 Lệch-có-chủ-đích (đề xuất pin vào spec)

Download = 302 presigned TTL-ngắn thay stream (đạt mục tiêu không lộ storage_path) · audit_logs + file_access_logs nằm PROTECTED_TABLES → retention không bao giờ xóa (an toàn hơn doc, nhưng chưa có archive path) · `/settings/public` lọc đúng nhưng gate chặt hơn doc (H6 — cần chốt hướng).

---

## 6. Tầng API contract (API-09 + BACKEND-12 + API-10)

### 6.1 Endpoint (bảng đầy đủ trong output lane API)

- **21 đúng** — toàn bộ company/current, modules (read), settings resolve/patch, files 8 route, file-access-logs, sequences (read/patch/preview), holidays CRUD + check, retention, seeds đều đúng quyền tuple `(action, foundation-*)` khớp seed 0435.
- **23 thiếu** = 16 public (cụm system-settings 4 endpoint, PATCH modules, audit export/entity, POST sequences, holiday import, GET file-links, seed-batches detail/items, nhóm multi-company 4 endpoint — lệch-có-chủ-đích single-tenant) + 7 internal REST (`/internal/v1/foundation/*` — thay bằng in-process call, hợp kiến trúc; riêng `cleanup-jobs/run` + `seeds/run` là thiếu thật vì không có trigger nào).
- **Lệch nhỏ:** path/method (preview POST→GET, `check`→`check-working-day`, `seed-batches`→`seeds`, file-links nested) — đều hợp lý hoặc chặt hơn, nên pin.

### 6.2 Cross-cutting (BACKEND-12)

| Chuẩn | Trạng thái |
| --- | --- |
| Envelope + pagination response | ✅ ĐÚNG |
| `/api/v1` prefix + Zod global pipe | ✅ ĐÚNG |
| **Swagger/OpenAPI** | ❌ **THIẾU hoàn toàn** — không SwaggerModule, không @nestjs/swagger trong package.json, không `openapi/` artifact; file `openapi/enterprise-api.yaml` mà API-10 AUD-005 nói "đã áp dụng" **không tồn tại** |
| Error catalog `FOUNDATION-ERR-*` | ❌ THIẾU (chỉ generic) |
| Pagination request `page`+`per_page` | ❌ LỆCH — code dùng `page`+`limit`; audit dùng `limit`+`offset` |
| DTO từ packages/contracts | ⚠️ Một phần — settings/holidays/company-patch còn Zod cục bộ apps/api (contracts tự ghi nhận nợ) |
| Idempotency-Key (§20/§22) | ❌ THIẾU ở tầng HTTP foundation |

### 6.3 Ma trận quyền (API-10)

- Seed 0435 phủ **đủ 26/26** permission catalog §6.3, cờ sensitive khớp; bulk-grant company-admin đúng AUD-014.
- **7 seed orphan** (đã seed, không endpoint dùng): module.update, setting.system-manage, audit.export, job.view, job.run, seed.run (+ audit-log.view bị drift H4).
- Drift cũ `read/update:company` (0005) đã hết ở phía controller — giờ chỉ là catalog-noise (admin giữ cả 2 cặp).
- **0 route thiếu guard** — không CRITICAL.

---

## 7. Tầng Frontend (FRONTEND-13 + FRONTEND-05)

### 7.1 Màn hình (16 screens FRONTEND-13 §7.1)

- **12 ĐÚNG:** Overview, Company Profile, Company Settings, Module Catalog + Detail (read-only), Files + Detail, File Access Logs, Audit Logs + Detail, Public Holidays, Retention, Health. Chất lượng đồng đều: loading/error/empty/forbidden đủ, Zod form + ConfirmDialog cho mutation, i18n vi đủ, không hard-code role, không dangerouslySetInnerHTML, masking do server.
- **LỆCH (2):** SystemSettingsPage = placeholder DEFER (đúng anti-dead-button nhưng defaultRoute trỏ vào — H8; comment FE nói cặp `system-manage` "chưa seed" là SAI, 0435:343 đã seed); Module Catalog không có toggle status/sort-order (§17.3).
- **THIẾU (2):** Sequence Counters `/system/sequences` (cặp quyền đã seed — MEDIUM), Seed Status `/system/seeds` (doc ghi "nếu API hỗ trợ" — LOW).
- **Sidebar FOUNDATION thiếu 5 entry** (System Settings · Public Holidays · Health · Retention · File Access Logs) — chỉ vào được qua quick-link trên Overview (MEDIUM).

### 7.2 Layout (FRONTEND-05) — khung đúng ~80%

- ĐÚNG: ProtectedShell/ProtectedRoute/route-meta 403-404, GlobalTopbar, HomePortal, AppSwitcher (Ctrl+K, search không dấu, dirty-guard), ModuleWorkspaceLayout + ModuleSidebar (registry-driven, không hard-code role), layout tests có.
- LỆCH/THIẾU: **module-status gating chết runtime** (`/auth/me` chưa trả `modules` → `modules:[]` bypass locked/maintenance — phụ thuộc BE expand) · **không có Breadcrumbs/MainContentShell toàn app** · Bell không unread-count (NOTI chưa build) · Recent/Favorite apps chưa consume · sidebar navigation không check dirty + không beforeunload · layout.store nói persist nhưng không có persist middleware · GROUP_LABELS thiếu `master-data` (HR hiện label thô) · 2 hệ layout song song (packages/ui AppShell chỉ console legacy dùng).

### 7.3 Pair-drift FE↔seed

- **`PERMISSION_CODE_TO_PAIR` (web-core): SẠCH** — đối chiếu từng cặp với seed thật, fix PR #59 còn nguyên.
- **CÒN drift phía BE `MODULE_APP_METADATA`** (`module-app-metadata.ts:52-63`): ATT dùng `read:attendance`, LEAVE `read:leave`, AUTH `read:user/role` — các cặp legacy (0063/0005) chỉ grant cho role UUID legacy; **4 role canonical 0444 không được grant** ⇒ `GET /foundation/modules/my-apps` ẩn app ATT/LEAVE/AUTH với user canonical. Hiện TIỀM ẨN (apps/app build visibility từ APP_REGISTRY cục bộ, chưa gọi my-apps) — sẽ nổ khi FE chuyển sang consume my-apps. MEDIUM.

---

## 8. Đề xuất hành động (WO-able, theo ưu tiên)

### P0 — hành vi sai / rủi ro dữ liệu (red-zone, FULL gate)

1. **FND-FILE-POLICY:** đăng ký resolver cho HR/ATT/LEAVE/TASK hoặc siết fallback tạm thời (deny khi file có entity link ngoài module foundation) — H1.
2. **FND-FILE-DOWNLOAD-GUARD:** chặn presign khi `scan_status='Infected'` hoặc `upload_status!='Uploaded'` — H2 (nhỏ, đi kèm #1).
3. **FND-AUDIT-PAIR-PIN:** chốt 1 cặp chuẩn cho audit-log viewer (`view:audit-log` hay `view:foundation-audit-log`), sửa my-apps metadata + seed cho khớp; xử lý luôn `export:foundation-audit-log` orphan — H4.
4. **FND-HOLIDAY-AUDIT:** trả nợ audit CONFIG cho holiday create/update/delete (BE-9) — H5.
5. **DB-COMPANIES-GRANT:** REVOKE DELETE `companies`/`users` khỏi app role (migration nhỏ) — sát-HIGH mục 2.

### P1 — dựng-từ-trống + surface thiếu

6. **FND-SEED-SEQUENCES:** seeder `sequence_counters` (EMPLOYEE_CODE...) + `ensureCounter` trong SequenceService — H7.
7. **FND-SEED-BOOTSTRAP-COMPANY:** tự seed default company (idempotent) thay bước psql tay + `must_change_password` cho bootstrap admin.
8. **FND-SEED-SETTINGS:** bổ sung 9/14 system key + 12 company key (chốt giá trị 20 vs 25MB, `vi-VN` vs `vi` với owner); HR master (job_levels/contract_types/employee_code_config); leave types 8/8 + pin mã (`ANNUAL` vs `ANNUAL_LEAVE`).
9. **FND-SETTINGS-PUBLIC-GATE:** chốt hướng H6 (Authenticated theo doc, hay pin gate hiện tại vào spec).
10. **FND-JOBS-MIN:** khung jobs tối thiểu — bảng `system_job_runs`/`system_job_locks` (DB-08 §8.14/8.15) + schedule RetentionCleanupJob + TEMP_FILE_CLEANUP.
11. **FND-ADMIN-API:** cụm endpoint thiếu có seed orphan: system-settings GET/PATCH, PATCH modules/{code}, retention POST+simulate route, audit export.
12. **FE-SYSTEM-FIXES:** defaultRoute `/system` (1 dòng — H8) + 5 sidebar entry + màn Sequences; sửa `MODULE_APP_METADATA` sang cặp canonical.
13. **FND-UPLOAD-E2E:** quyết mô hình upload (presigned-PUT + confirm, hay multipart) rồi hoàn thiện luồng + checksum + temp cleanup — H3 (phối hợp #10).

### P2 — hợp đồng/vệ sinh

14. Swagger/OpenAPI theo BACKEND-12 (route /docs + artifact + x-required-permission).
15. Bộ mã lỗi `FOUNDATION-ERR-*` + thống nhất 400/422.
16. Pagination request convention (`per_page` vs `limit`) — chốt 1 chuẩn, sửa doc hoặc code.
17. Migrate DTO settings/holidays/company-patch vào packages/contracts.
18. Index bổ sung DB-09 (files status/cleanup, file_access_logs company_time, uq_file_links_entity_file_active) + trigger chặn UPDATE audit_logs lớp 2.
19. Audit masker: thêm stems `otp/salary/health/id_card`.
20. **Pin vào spec** các lệch-có-chủ-đích: tuple permission, single-tenant cắt multi-company + internal REST, download 302, PROTECTED_TABLES, `is_paid_holiday`, doc-drift DB-08↔DB-09, path/method lệch nhỏ, my-apps Authenticated-only.

---

## 9. Ghi chú xác minh bối cảnh cũ

- Head migration thực tế = **0465** (memory cũ ghi ~045x).
- Pair-drift `*:foundation-company` vs `read/update:company`: **đã hết ở controller** (CompanyController về foundation-company); cặp 0005 giờ chỉ là catalog-noise.
- `PERMISSION_CODE_TO_PAIR` phía FE sạch (fix PR #59 giữ nguyên); drift còn lại nằm phía BE `MODULE_APP_METADATA`.
- Memory "HolidayService có audit-on-CONFIG" cần đọc chính xác là: audit bị **defer sang BE-9** và đến 2026-07-02 **vẫn chưa trả** (H5).
