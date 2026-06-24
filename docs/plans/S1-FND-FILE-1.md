```yaml
wo: S1-FND-FILE-1
zone: red
generated_by: auto-loop
reconciled_at: "24ce640"
lanes:
  - id: FILE-MIG-1
    task: "Migration NỐI TIẾP (idx kế head 121/0438): append 'file' + 'file_link' vào CHECK audit_logs_object_type_chk (DROP+ADD CONSTRAINT, union CHỈ-TĂNG, KHÔNG đụng type cũ) để audit Upload/Link/Unlink/Delete không vỡ CHECK. KHÔNG tạo lại DDL files/file_links/file_access_logs (đã có ở 0433). Đồng bộ AUDIT_OBJECT_TYPES TS array (append 'file','file_link'). KHÔNG backfill, KHÔNG seed."
    builder: db-migration
    paths:
      - apps/api/migrations/0440_file1_audit_object_type.sql  # idx 123 (0439 đã bị S1-FND-SETTING-1 chiếm)
      - apps/api/src/db/schema/audit.ts
  - id: FILE-STORAGE-1
    task: "StorageAdapter port (interface put/get/delete/signedUrl) + Local/S3 impl BỌC ObjectStorageService hiện có (KHÔNG rewrite object-storage.service.ts — composition). Server-derive key tenant-scoped {companyId}/files/{fileId} qua storage-key (mở rộng buildFileKey theo mẫu buildAttachmentKey/validateKey). signedUrl chỉ TTL ngắn (presignTtlSec); KHÔNG persist signed-url, KHÔNG trả storage_path ra ngoài port."
    builder: backend-builder
    paths:
      - apps/api/src/storage/storage-adapter.port.ts
      - apps/api/src/storage/s3-storage.adapter.ts
      - apps/api/src/storage/file-storage-key.ts
  - id: FILE-CONTRACTS-1
    task: "Zod contracts file (nguồn sự thật DTO): UploadFileInput (originalName, declaredMimeType, sizeBytes, visibility default Private, optional moduleCode/entityType/entityId), FileMetadataDto (KHÔNG chứa storagePath/checksum/signedUrl dài hạn), DownloadUrlDto (url + expiresAt ngắn hạn), LinkFileInput/FileLinkDto (moduleCode/entityType/entityId/linkType/accessScope), List query+pagination. Tái dùng allowlist/size từ system_settings file.* (KHÔNG hard-code MIME). Export qua packages/contracts/src/index.ts (append)."
    builder: backend-builder
    paths:
      - packages/contracts/src/files.ts
      - packages/contracts/src/index.ts
  - id: FILE-SVC-1
    task: "FileRepository + FileLinkRepository + FileAccessLogService + FileService + FilesController (deny-by-default) qua withTenant. upload: validate size/MIME từ system_settings (KHÔNG tin MIME client — server tự suy file_extension; sanitize originalName chống path-traversal; storedName/storage_path server-derive qua FILE-STORAGE-1), ghi metadata visibility=Private default upload_status=Pending. download-qua-backend: stream qua backend SAU khi FilePolicy.canDownload ALLOW; download-url chỉ trả signed-url TTL-ngắn. link/unlink: validate cùng company + scan_status!=Infected; gỡ link = soft-delete (deleted_by/deleted_at), KHÔNG hard-delete. delete file = soft-delete. Ghi file_access_logs cho private/sensitive (Preview/Download/Upload/Link/Unlink/Delete + access_granted + denied_reason cho cả nhánh DENY) qua FileAccessLogService (append-only). Ghi AuditService.record cùng tx cho Upload/Link/Unlink/Delete (object_type='file'/'file_link' từ FILE-MIG-1). Controller dùng @RequirePermission(action,'foundation-file') + PermissionGuard + @CompanyId/@CurrentUser; FilePolicyService là chốt quyết định. Wire FilesModule (import StorageModule + PermissionModule + EventsModule[AuditService] + FilePolicyService) — KHÔNG sửa app.module ở WO này (để S1-FND-WIRE-1 gom)."
    builder: backend-builder
    paths:
      - apps/api/src/foundation/files/file.repository.ts
      - apps/api/src/foundation/files/file-link.repository.ts
      - apps/api/src/foundation/files/file-access-log.service.ts
      - apps/api/src/foundation/files/files.service.ts
      - apps/api/src/foundation/files/files.controller.ts
      - apps/api/src/foundation/files/files.module.ts
acceptanceChecks:
  - "Upload ghi 1 row files với visibility='Private' (default), upload_status='Pending', company_id = tenant hiện tại; file_extension server-suy (KHÔNG lấy từ client); originalName đã sanitize (loại '/','\\\\','..',NUL) — test path-traversal filename không tạo được storage_path ngoài prefix tenant."
  - "Size/MIME validate ở TẦNG SERVICE từ system_settings (file.max_upload_size_mb, file.allowed_mime_types) — KHÔNG tin Content-Type client; MIME ngoài allowlist hoặc size > ceiling → 4xx (FOUNDATION-FILE-ERR), KHÔNG ghi metadata."
  - "StorageAdapter port có đúng 4 method put/get/delete/signedUrl, bọc ObjectStorageService; FileMetadataDto/response KHÔNG chứa storage_path/checksum/signed-url dài hạn (grep DTO); download-url trả url + expiresAt TTL ngắn (presignTtlSec)."
  - "FilePolicy deny-by-default: request không resolve được (module/entity_type không có resolver) → fallback FOUNDATION.FILE.* ; thiếu permission → DENY (403) + file_access_logs ghi access_granted=false + denied_reason; companyId/userId thiếu → deny-tenant (không gọi storage/permission)."
  - "download-qua-backend: GET /files/{id}/download stream qua backend CHỈ sau FilePolicy.canDownload=ALLOW; deny → 403 + log Download access_granted=false (KHÔNG lộ binary)."
  - "link: validate cùng company_id (file & entity) + file.scan_status != 'Infected' → reject nếu vi phạm; tạo file_links row (created_by). unlink: soft-delete (deleted_at/deleted_by) — file_links còn row, KHÔNG hard-delete (grant DB chỉ SELECT/INSERT/UPDATE). delete file: soft-delete files (deleted_at/deleted_by), upload_status/scan giữ nguyên — KHÔNG DELETE row."
  - "file_access_logs ghi cho action ∈ {Upload,Download,Preview,Link,Unlink,Delete} với access_granted + (denied_reason khi DENY); bảng APPEND-ONLY — app role UPDATE/DELETE PHẢI FAIL (test trên LANE_DB)."
  - "Audit cùng tx: Upload→object_type='file', Link/Unlink→'file_link', Delete→'file' với action/resultStatus; AuditService masker che storage_path/signed_url trong before/after (không lộ trong audit). object_type 'file'/'file_link' có trong CHECK (FILE-MIG-1) — insert audit KHÔNG vỡ CHECK."
  - "Mọi data-access qua db.withTenant(companyId) — không query files/file_links/file_access_logs thẳng ngoài withTenant (RLS+FORCE ép cô lập tenant). Migration head tăng đơn điệu (idx 122 kế 121)."
  - "Coverage ≥80% module files; FilePolicy spec hiện có (14 test) vẫn xanh; build+typecheck xanh (pnpm --filter @mediaos/api typecheck, contracts build trước)."
testTasks:
  - "RED deny-path (viết TRƯỚC, Đội 2 code sau): FilePolicy DENY → controller 403 + file_access_logs.access_granted=false + denied_reason set (QA-05 permission/deny-path)."
  - "RED: upload MIME ngoài allowlist + size vượt ceiling → 4xx, KHÔNG ghi metadata; Content-Type client giả mạo bị bỏ qua (server không tin MIME client) (QA-06 security)."
  - "RED: filename path-traversal ('../', '/etc/x', NUL byte, backslash) → sanitize/reject, storage_path luôn trong prefix {companyId}/files/ (QA-06 + storage-key test)."
  - "RED: link cross-company (file companyA, entity companyB) → reject; link khi file.scan_status='Infected' → reject (QA-05 + QA-06)."
  - "Integration DB cô lập (LANE_DB, skipIf !hasDb || !LANE_DB): file_access_logs append-only — UPDATE/DELETE bằng app role THROW (insufficient privilege); RLS cô lập — tenant B không SELECT được file của tenant A."
  - "Integration: upload→link→unlink→delete happy-path ghi đủ file_access_logs + audit_logs (object_type file/file_link) cùng tx; soft-delete giữ row (deleted_at set)."
  - "Contract test: FileMetadataDto/DownloadUrlDto/FileLinkDto KHÔNG có field storagePath/checksum/signedUrl-dài-hạn (QA-04 contract) — bảo vệ không-leak storage_path ra FE."
  - "Audit masking test: before/after chứa storage_path/signed_url → '***' trong audit row (QA-06 masking)."
steps:
  - "FILE-MIG-1 NỐI TIẾP TRƯỚC: thêm migration idx kế (sau head 121/0438) DROP+ADD CONSTRAINT audit_logs_object_type_chk với union hiện tại + 'file' + 'file_link' (giữ nguyên mọi type cũ — append-only union); append 'file','file_link' vào AUDIT_OBJECT_TYPES (schema/audit.ts). Cập nhật meta/_journal.json qua drizzle-kit nếu cần. Không seed/backfill."
  - "FILE-STORAGE-1 song song được với FILE-CONTRACTS-1: định nghĩa StorageAdapter port (put/get/delete/signedUrl) + adapter bọc ObjectStorageService; thêm buildFileKey/validateKey cho prefix {companyId}/files/{fileId} (mẫu storage-key.ts hiện có)."
  - "FILE-CONTRACTS-1 song song: viết Zod DTO file (upload/metadata/download-url/link/list) — DTO ra-ngoài KHÔNG chứa storage_path/checksum/signed-url dài hạn; export ở index.ts (append additive)."
  - "FILE-SVC-1 SAU khi 3 lane trên xong (depends_on FILE-MIG-1+FILE-STORAGE-1+FILE-CONTRACTS-1): hiện thực repository/service/controller/module ghép FilePolicyService (đã có) + StorageAdapter + FileAccessLog + Audit; tất cả data-access qua withTenant; deny-path fail-closed."
  - "RED trước GREEN cho nhánh nhạy cảm: viết test deny-path (FilePolicy deny → 403 + file_access_log access_granted=false; cross-company link reject; scan_status=Infected link reject; append-only file_access_logs REJECT UPDATE/DELETE) TRƯỚC khi code service."
  - "Gate FULL (security-reviewer + database-reviewer + silent-failure-hunter + santa-method cho crown FilePolicy/storage-key) vì WO chạm permission/RLS/audit/storage. Không auto-commit — red-zone cần người chốt."
```

## GAP-ANALYSIS (đối chiếu code 2026-06-24, head 24ce640/idx121/0438)

**1. DB — DONE (KHÔNG tạo lại)**
Migration `0433_foundation_db3_files` đã tạo `files`/`file_links`/`file_access_logs` với RLS+FORCE+policy `tenant_isolation`, append-only `file_access_logs` (GRANT SELECT,INSERT + REVOKE UPDATE,DELETE app+worker), CHECK visibility default Private / scan_status incl Infected / link_type / access_scope / size>=0, soft-delete grants. Drizzle schema `apps/api/src/db/schema/files.ts` parity. KHÔNG tạo lại DDL files.

**2. Permission seed — DONE**
Migration `0435` seed `foundation-file` (upload/view/download/delete/link/unlink) + `system_settings` `file.max_upload_size_mb=25`, `file.allowed_mime_types[]`.

**3. FilePolicyService — DONE (14 test xanh)**
`apps/api/src/foundation/files/file-policy.service.ts` deny-by-default, resolver registry dispatch (module,entity_type) + module-wildcard, fail-closed (deny-tenant/deny-resolver/deny-error), fallback `FOUNDATION_FILE_PERMISSION` resourceType=`'foundation-file'`.

**LỆCH:** enum `FilePolicyAction` chỉ có `View/Download/Link/Delete` — KHÔNG có `Unlink`; spec seed có quyền `'unlink'`. FileService có thể tái dùng `canLink` cho cả unlink HOẶC mở rộng action. Quyết định ở builder Đội 2: nếu mở rộng phải thêm `Unlink` vào `FOUNDATION_FILE_PERMISSION` + `RESOLVER_METHOD`.

**4. Storage — GAP**
Chỉ có `ObjectStorageService` (S3 cụ thể: createUploadUrl/putObject/getObject-download-url/deleteObject) + `storage-key.ts` (validateKey/assertKeyInTenant/buildAttachmentKey). WO yêu cầu `StorageAdapter PORT` (put/get/delete/signedUrl) BỌC nó — composition, KHÔNG rewrite. Cần `buildFileKey {companyId}/files/{fileId}` (mẫu `buildAttachmentKey`).

**5. FileService/Controller/repo/contracts — GAP**
Chưa tồn tại (grep `FileService`/`FilesController` = rỗng). Đây là phần lõi WO.

**6. Audit object_type — GAP (CHẶN audit)**
`'file'`/`'file_link'` KHÔNG có trong `AUDIT_OBJECT_TYPES` (`schema/audit.ts`) lẫn DB CHECK `audit_logs_object_type_chk` (mới nhất 0090/0093). Insert audit Upload/Link/Unlink/Delete sẽ VỠ CHECK. Cần migration `FILE-MIG-1` append union chỉ-tăng + TS array. `audit-masker.service.ts` ĐÃ mask `storage_path`/`signed_url` — audit before/after an toàn.

---

## INVARIANTS áp dụng

- **§2.1** `company_id` mọi query → `withTenant(companyId)` bắt buộc cho `files`/`file_links`/`file_access_logs` (RLS+FORCE đã có ở DB).
- **§2.2** Append-only `file_access_logs` (REVOKE UPDATE/DELETE đã có) + soft-delete `files`/`file_links` (KHÔNG hard-delete row).
- **§2.3** Không trả `storage_path`/`signed-url` dài hạn ra DTO/FE; không tin MIME client (server suy từ extension/magic bytes nếu có, server-derive key).
- **§3** `PermissionService.can` + `FilePolicyService` PHẢI resolve trước khi gọi storage/DB write.

---

## VERIFY

- Chạy LANE_DB cô lập: `bash scripts/lane-db-setup.sh <lane>` → `export LANE_DB=mediaos_<lane>` → `pnpm --filter @mediaos/api test`. Không set LANE_DB → skipIf gate `!hasDb || !LANE_DB` bảo vệ khỏi đỏ-giả trên DB dev chung.
- Migration đơn điệu: idx 122 sau 121 (0438). Drizzle-kit sinh `meta/_journal.json` — KHÔNG sửa tay band khác.
- Contract leak check: `grep -r 'storagePath\|storage_path\|signedUrl\|checksum' packages/contracts/src/files.ts` → phải rỗng trong DTO ra-ngoài.

---

## GATE

**FULL** (chạm permission/RLS/audit/storage): `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `santa-method` (cho crown-jewel `FilePolicyService`/`storage-key`). Model: **Opus** (tier crown). **KHÔNG auto-commit** — red-zone cần người chốt.

---

## HOT-FILE quy ước APPEND

| File | Quy tắc |
|---|---|
| `apps/api/src/db/schema/audit.ts` | Append `'file','file_link'` vào `AUDIT_OBJECT_TYPES` array — union chỉ-tăng |
| DB CHECK `audit_logs_object_type_chk` | DROP+ADD CONSTRAINT giữ nguyên type cũ; KHÔNG xóa type hiện có |
| `packages/contracts/src/index.ts` | Append `export * from './files'` — KHÔNG xóa export cũ |
| `apps/api/migrations/meta/_journal.json` | Drizzle-kit sinh — KHÔNG sửa tay |
| `apps/api/src/app.module.ts` | KHÔNG đụng ở WO này (để S1-FND-WIRE-1 gom `FoundationModule`) |

---

## OUT-OF-SCOPE (chống scope-creep)

- Antivirus scan thật — `scan_status` để `Pending`/`NotRequired` (Phase sau).
- File versioning / retention / cleanup job — WO riêng.
- Object-storage production lifecycle policy.
- FE upload UI (FRONTEND-13 — WO riêng).
- Wire `app.module.ts` / `FoundationModule` — để `S1-FND-WIRE-1` gom.
- Audit-log / file-access-log viewer API — chỉ ghi log ở WO này, viewer ở WO khác.
- FE lane = KHÔNG (WO thuần backend).
