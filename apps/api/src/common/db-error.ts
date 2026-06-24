/**
 * Shared DB error helpers.
 *
 * drizzle-orm ≥0.40 wraps pg driver errors in a DrizzleQueryError whose `.cause`
 * holds the original pg Error (the one carrying `.code === '23505'` etc.).
 * Walk up to 5 levels of `.cause` so the helper is resilient to future wrapping.
 */

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FK_VIOLATION = "23503";
export const PG_CHECK_VIOLATION = "23514";

/**
 * Return the first `code` string found by walking `err` and its `.cause` chain
 * up to 5 levels deep. Returns `undefined` if no string `code` is found.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) break;
    const node = current as Record<string, unknown>;
    if (typeof node["code"] === "string") return node["code"];
    current = node["cause"];
  }
  return undefined;
}

/**
 * Return the first string value of a named field found by walking `err` and its
 * `.cause` chain up to 5 levels deep. Useful for extracting `constraint`, `detail`,
 * `schema`, etc. from nested pg errors.
 */
export function pgErrorField(err: unknown, field: string): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) break;
    const node = current as Record<string, unknown>;
    if (typeof node[field] === "string") return node[field] as string;
    current = node["cause"];
  }
  return undefined;
}

/** True if `err` is (or wraps) a PostgreSQL unique-violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION;
}

/** True if `err` is (or wraps) a PostgreSQL foreign-key violation (23503). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_FK_VIOLATION;
}
