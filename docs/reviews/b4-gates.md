# B4 — Task Attachments (real file upload) · FULL gate

> Lane `b4` · branch `feat/b4-task-attachments` · band migration `0190-0199`.
> Gate: FULL (security file-upload/path-traversal/SSRF/type-confusion · database · silent-failure ·
> typescript · santa dual-review). Verify trên DB cô lập `mediaos_b4`.

## Phạm vi

File đính kèm THẬT cho Task Hub (G9 descoped chỉ link). Upload qua presigned PUT (MinIO/S3),
download qua presigned GET, xoá = soft-delete. Bytes nằm ở object storage dưới key SERVER sinh
`{company_id}/tasks/{task_id}/{uuid}`; DB chỉ lưu metadata + storage_key.

## Bất biến đã ép

| # | Bất biến | Cơ chế |
| --- | --- | --- |
| #1 | `company_id` mọi query + RLS | `task_attachments` ENABLE+FORCE RLS + policy `tenant_isolation` USING+WITH CHECK; mọi repo qua `withTenant` + `eq(company_id)` defense-in-depth |
| #2 | Append-only metadata | GRANT app `SELECT,INSERT` + **column** `UPDATE(deleted_at)` only (KHÔNG UPDATE cột nội dung, KHÔNG DELETE). worker SELECT-only. Xoá = soft-delete `deleted_at` cùng tx với audit |
| #3 | Không secret/PII plaintext | Chỉ lưu metadata + storage_key; KHÔNG signed URL / credential vào DB/audit/DTO. Presigned URL ephemeral, sinh on-demand, KHÔNG persist. Audit KHÔNG ghi storage_key |
| #4 | Task Hub hợp nhất | `task_attachments` là bảng CON của `tasks` (FK `task_id` ON DELETE CASCADE) — KHÔNG bảng attachment riêng |

## Storage key — path-traversal / SSRF

- Client KHÔNG bao giờ truyền key/path. `buildAttachmentKey(companyId, taskId, uuid)` sinh server-side
  từ UUID đã validate. `validateKey` reject: empty · `..`/`.` segment · leading `/` (absolute) ·
  drive-letter `C:` · backslash/UNC · null-byte · control-char · empty segment · ký tự ngoài allowlist.
- `assertKeyInTenant` re-assert key thuộc prefix tenant TRƯỚC khi ký presigned GET (belt-and-suspenders
  trên RLS).
- Presigned PUT pin `ContentType` + `ContentLength` → client KHÔNG upload type/size khác lúc intent.

## Gate findings

### Security — 1 CRITICAL fixed (lane-introduced)

- **CRITICAL (fixed):** thiết kế soft-delete ban đầu chạy audit INSERT trên **worker** connection, nhưng
  `mediaos_worker` KHÔNG có GRANT INSERT trên `audit_logs` (chỉ `mediaos_app`) ⇒ MỌI soft-delete sẽ fail
  runtime. Int-spec ban đầu chỉ test raw worker UPDATE (qua) nên lọt. **Fix:** chuyển soft-delete sang
  app role với **column-grant `UPDATE(deleted_at)`** + audit INSERT cùng tx withTenant (app có cả 2 grant).
  Đơn giản hơn, RLS-safe, audit-or-rollback. Thêm int-spec "soft-delete + audit_logs INSERT cùng tx".

### Database

- Audit CHECK `task_attachment` UNION qua DO-block ADD-only (tiền lệ 0150) — verify constraint là
  **superset** (chứa `encryption_key/payslip/bonus_penalty/...` của lane khác, KHÔNG shrink).
- Journal idx 85 (= master_max 84 + 1), when 1717500220000 (> 1717500200000) — đơn điệu tăng.
- Index `(company_id)` + `(company_id, task_id)` cho list-by-task.

### Silent-failure

- Audit upload/delete trong CÙNG tx (audit fail → rollback). Tenant-FK guard TRƯỚC insert.
- Storage chưa cấu hình → fail-CLOSED (503), KHÔNG fail-open / metadata mồ côi.
- Cross-tenant / not-found download → 404 KHÔNG phân biệt (tránh oracle).

### Residual MEDIUM (non-blocking, defer)

- Orphan metadata nếu presigned-PUT sinh lỗi SAU khi commit metadata: row vô hại, download S3-404,
  worker SELECT-only để dọn object orphan sau (out-of-scope lane FE/cleanup-worker).
- `size_bytes` là client-declared ở intent: server pin ContentLength trên presigned PUT (S3 enforce),
  nhưng KHÔNG HEAD-verify byte thật sau upload (defer — out-of-scope, KHÔNG fail-open).

### Santa dual-review

CONVERGED **NICE** — 0 CRITICAL/HIGH lane-introduced còn lại sau fix security. (Pattern B inline vì
subagent không khả dụng trong worker; rubric: 7 bất biến trên.)

## Verify

- Chain `0000→0190` áp sạch trên `mediaos_b4` fresh (`lane-db-setup.sh b4 --reset`).
- Full api: **1820 pass / 0 fail** (5 skip). B4 mới: **44 test** (storage-key 21 · service 13 · int-spec 10).
- typecheck 0 err · lint B4 files 0 err (11 error pre-existing ở `demo-seed-dashboard.mjs`, KHÔNG lane) ·
  prettier sạch · build api OK · contracts dual-build OK.

## Files

Migration `0190_b4_task_attachments.sql` + journal · schema `workflow.ts` (taskAttachments) + `audit.ts`
(AUDIT_OBJECT_TYPES) · `env.schema.ts` (S3_*) · storage `storage-key.ts`/`object-storage.service.ts`/
`storage.module.ts` · tasks `task-attachments.{service,controller}.ts` + repo/dto/module · contracts
`task.ts` · tests + rls-registry + seed cleanup.
