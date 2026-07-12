import { Controller, Delete, Get, Post, GoneException } from "@nestjs/common";

/**
 * TaskAttachmentsController — DEPRECATED-IN-PLACE (S4-TASK-BE-5 L4, CROWN/security,
 * SUPERSEDE OWNER 2026-07-12).
 *
 * WHY 410, NOT a membership/data-scope fix: `listByTask`/`getDownloadUrl` (in the now-orphaned
 * TaskAttachmentsService) only ever asserted the task belongs to the tenant — they never checked
 * data-scope/membership. The `read:task` grant is handed out at Own/Team/Company scope (employee/
 * manager/hr/admin), so ANY user holding `read:task` could list/download attachments of ANY task in
 * the tenant (in-tenant IDOR, membership bypass). Fixing the scope check in-place was rejected in
 * favour of killing the route because:
 *  (a) `task_attachments` is PARKED — no new writes are wanted, so POST must die too;
 *  (b) the canonical replacement `/tasks/:id/files` (TaskFilesController, S4-TASK-BE-5 L2) already
 *      does the real membership/data-scope + STRICT scan-status guard this legacy path never had;
 *  (c) the legacy table has no `scan_status` column, so the new scan-guard cannot be retrofitted here;
 *  (d) 410 closes the IDOR with the least code and zero risk of a second buggy scope re-implementation.
 *
 * `task-attachments.service.ts` and the `task_attachments` table are left UNTOUCHED (park — no drop,
 * no new writes). This controller no longer calls the service at all: every handler short-circuits to
 * `GoneException` before touching any service/DB call. Global JwtAuthGuard + CompanyGuard (app-wide)
 * still apply, so unauthenticated/cross-tenant requests are rejected before even reaching here; no
 * PermissionGuard is attached because permission is no longer a relevant axis — the route is dead for
 * everyone, regardless of grant.
 */
const SUPERSEDED = {
  code: "TASK_ATTACHMENTS_SUPERSEDED",
  message:
    "Route legacy /tasks/:taskId/attachments đã ngừng hoạt động (410). Dùng /tasks/:taskId/files.",
};

function gone(): never {
  throw new GoneException(SUPERSEDED);
}

@Controller("tasks/:taskId/attachments")
export class TaskAttachmentsController {
  /** POST /tasks/:taskId/attachments — superseded, always 410 (no metadata row is ever written). */
  @Post()
  createIntent(): never {
    return gone();
  }

  /** GET /tasks/:taskId/attachments — superseded, always 410 (no listing, no scope leak). */
  @Get()
  list(): never {
    return gone();
  }

  /** GET /tasks/:taskId/attachments/:attachmentId/download — superseded, always 410 (no signed URL). */
  @Get(":attachmentId/download")
  download(): never {
    return gone();
  }

  /** DELETE /tasks/:taskId/attachments/:attachmentId — superseded, always 410 (no soft-delete). */
  @Delete(":attachmentId")
  remove(): never {
    return gone();
  }
}
