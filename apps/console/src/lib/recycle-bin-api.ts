import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";

/**
 * Shape of a soft-deleted employee row returned by GET /recycle-bin/employees.
 *
 * S6-SEC-IDENTITYBOUND-1 (N-1d, KI-051) — `userFullName`/`userEmail` là `.optional()`: SERVER **bỏ
 * hẳn hai khoá này** cho hàng ngoài `data_scope` của cặp danh bạ `view:user` (masking là việc của
 * server — client không nhận được thì không render được, CLAUDE.md §5).
 *
 * ⚠️ ĐỪNG gỡ `.optional()` để "cho gọn": `apiFetch` parse bằng schema này, nên khoá vắng mặt mà
 * schema đòi bắt buộc ⇒ **ZodError runtime dù HTTP 200** ⇒ vỡ TRẮNG cả trang thùng rác cho đúng
 * những role mà bản vá bảo vệ (memory `apifetch-drops-pagination-bare-array`).
 */
export const deletedEmployeeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  employeeCode: z.string().nullable(),
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  orgUnitId: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  positionId: z.string().nullable(),
  positionName: z.string().nullable(),
  workType: z.string(),
  employmentType: z.string(),
  status: z.string(),
  deletedAt: z.string().nullable(),
});

export type DeletedEmployee = z.infer<typeof deletedEmployeeSchema>;

/** Shape returned by POST /recycle-bin/employees/:id/restore. */
const restoreResultSchema = z.object({ id: z.string() });

export const recycleBinApi = {
  /** List all soft-deleted employees for the tenant (read:employee). */
  listDeleted: () => apiFetch("/recycle-bin/employees", z.array(deletedEmployeeSchema)),

  /** Restore a soft-deleted employee (restore:employee, sensitive). */
  restore: (id: string) =>
    apiFetch(`/recycle-bin/employees/${id}/restore`, restoreResultSchema, {
      method: "POST",
    }),
};
