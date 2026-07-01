/**
 * S3-ATT-BE-4 — pure DTO mappers for the canonical adjustment surface (no `this`, no DB).
 *
 * The response shapes are the canonical contracts DTOs (attendanceAdjustmentRequestDetailSchema /
 * ListItem / ItemDto). Date → ISO is left to the serializer; we only project columns and pass through
 * the append-only ledger items. requestType is stored TitleCase-free (9-enum) — the row already carries
 * the canonical value written by the service, so no re-mapping is needed.
 */

import type {
  AttendanceAdjustmentItemDto,
  AttendanceAdjustmentListItem,
  AttendanceAdjustmentRequestDetail,
} from "@mediaos/contracts";

/** A joined request row (repo REQUEST_COLUMNS) — untyped columns coerced at the mapper boundary. */
type RequestRow = Record<string, unknown>;
type ItemRow = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function asNullableString(v: unknown): string | null {
  return v == null ? null : asString(v);
}

export function toAdjustmentItemDto(row: ItemRow): AttendanceAdjustmentItemDto {
  return {
    id: asString(row.id),
    fieldName: asString(row.fieldName),
    oldValue: row.oldValue ?? null,
    newValue: row.newValue ?? null,
    appliedValue: row.appliedValue ?? null,
    isApplied: Boolean(row.isApplied),
    note: asNullableString(row.note),
    createdAt: row.createdAt as string,
  };
}

/** Detail = request row + the append-only items ledger. */
export function toAdjustmentDetailDto(
  row: RequestRow,
  items: ItemRow[],
): AttendanceAdjustmentRequestDetail {
  return {
    ...toListItem(row),
    items: items.map(toAdjustmentItemDto),
  };
}

export function toAdjustmentListItem(row: RequestRow): AttendanceAdjustmentListItem {
  return toListItem(row);
}

function toListItem(row: RequestRow): AttendanceAdjustmentListItem {
  return {
    id: asString(row.id),
    requestCode: asNullableString(row.requestCode),
    employeeId: asNullableString(row.employeeId),
    employeeCode: asNullableString(row.employeeCode),
    fullName: asNullableString(row.fullName),
    attendanceRecordId: asNullableString(row.attendanceRecordId),
    workDate: asString(row.workDate),
    requestType: asString(row.requestType) as AttendanceAdjustmentListItem["requestType"],
    requestedCheckInAt: row.requestedCheckInAt as string | null,
    requestedCheckOutAt: row.requestedCheckOutAt as string | null,
    reason: asString(row.reason),
    status: asString(row.status) as AttendanceAdjustmentListItem["status"],
    submittedAt: row.submittedAt as string | null,
    requestedBy: asNullableString(row.requestedBy),
    currentApproverUserId: asNullableString(row.currentApproverUserId),
    reviewedBy: asNullableString(row.reviewedBy),
    reviewedAt: row.reviewedAt as string | null,
    reviewNote: asNullableString(row.reviewNote),
    attachmentFileId: asNullableString(row.attachmentFileId),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}
