import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";

/** Shape of a soft-deleted employee row returned by GET /recycle-bin/employees. */
export const deletedEmployeeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  employeeCode: z.string().nullable(),
  userFullName: z.string().nullable(),
  userEmail: z.string().nullable(),
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
  listDeleted: () =>
    apiFetch("/recycle-bin/employees", z.array(deletedEmployeeSchema)),

  /** Restore a soft-deleted employee (restore:employee, sensitive). */
  restore: (id: string) =>
    apiFetch(`/recycle-bin/employees/${id}/restore`, restoreResultSchema, {
      method: "POST",
    }),
};
