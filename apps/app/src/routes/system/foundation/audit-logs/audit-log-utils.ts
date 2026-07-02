/**
 * Helpers định dạng/convert cho viewer Audit log (S2-FE-FND-2).
 */

/** Chuyển 1 chuỗi rỗng → undefined (để KHÔNG gửi param rỗng lên API). */
export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** ISO datetime → chuỗi hiển thị vi-VN (an toàn với chuỗi rỗng/không hợp lệ). */
export function toDateFromIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN");
}

/**
 * input[type=date] "yyyy-mm-dd" → ISO datetime đầu ngày (00:00:00.000Z), khớp
 * `auditLogQuerySchema.dateFrom` (z.string().datetime()). Rỗng → undefined.
 */
export function toIsoRangeStart(dateOnly: string): string | undefined {
  const trimmed = dateOnly.trim();
  if (trimmed === "") return undefined;
  return `${trimmed}T00:00:00.000Z`;
}

/**
 * input[type=date] "yyyy-mm-dd" → ISO datetime cuối ngày (23:59:59.999Z), khớp
 * `auditLogQuerySchema.dateTo`. Rỗng → undefined.
 */
export function toIsoRangeEnd(dateOnly: string): string | undefined {
  const trimmed = dateOnly.trim();
  if (trimmed === "") return undefined;
  return `${trimmed}T23:59:59.999Z`;
}
