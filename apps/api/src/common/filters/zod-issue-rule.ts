import type { ErrorDetail } from "@mediaos/contracts";

/**
 * S19-OPS-ZOD4-1 — C3a: map issue của zod 4 về `rule` (mã) của zod 3 mà FE/spec đang phụ thuộc (API-01 §12).
 * Bảng đo trên zod 4.6.7. Không khớp ⇒ giữ mã v4 (KHÔNG bịa mã).
 *   invalid_format → invalid_string
 *   invalid_value  → invalid_enum_value (values ≥ 2) | invalid_literal (values = 1)
 *   invalid_union có `discriminator`/`note` → invalid_union_discriminator
 *   invalid_type có expected "date" → invalid_date
 */
interface RawIssue {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  values?: unknown;
  expected?: unknown;
  discriminator?: unknown;
  note?: unknown;
}

export function aliasZodRule(issue: RawIssue): string {
  const code = typeof issue.code === "string" ? issue.code : "custom";
  switch (code) {
    case "invalid_format":
      return "invalid_string";
    case "invalid_value":
      return Array.isArray(issue.values) && issue.values.length === 1
        ? "invalid_literal"
        : "invalid_enum_value";
    case "invalid_union":
      return issue.discriminator !== undefined || issue.note !== undefined
        ? "invalid_union_discriminator"
        : code;
    case "invalid_type":
      return issue.expected === "date" ? "invalid_date" : code;
    default:
      return code;
  }
}

/** Lấy mảng issues theo HÌNH DẠNG (không instanceof ZodError — hai bản zod có thể cùng tồn tại). */
export function extractZodIssues(zodError: unknown): RawIssue[] | null {
  if (typeof zodError !== "object" || zodError === null) return null;
  const issues = (zodError as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  return issues.filter((i): i is RawIssue => typeof i === "object" && i !== null);
}

/** issues → details của envelope. `null` khi không có issues (⇒ 400 không details, không bao giờ 500). */
export function zodIssuesToDetails(zodError: unknown): ErrorDetail[] | null {
  const issues = extractZodIssues(zodError);
  if (issues === null) return null;
  return issues.map((issue) => ({
    // path zod 4 là PropertyKey[] (có thể chứa symbol) — `join` sẽ ném với symbol ⇒ ép chuỗi từng phần tử.
    field: Array.isArray(issue.path) ? issue.path.map((p) => String(p)).join(".") : "",
    message: typeof issue.message === "string" ? issue.message : "",
    rule: aliasZodRule(issue),
  }));
}
