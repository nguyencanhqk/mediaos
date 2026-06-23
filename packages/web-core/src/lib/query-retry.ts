// query-retry.ts — Retry policy for TanStack Query (FRONTEND-04 §16.2).
//
// Pure function — NO import from @tanstack/react-query.
// Wire into QueryClient.defaultOptions.queries.retry in apps main.tsx (S1-FE-QUERY-WIRE-1).

import { ApiError } from "./api-client";
import type { ApiErrorKind } from "./api-error-kind";

/**
 * Kinds that should NEVER be retried — client errors where retrying won't help.
 * Network / Server / Maintenance / Unknown → retry (transient, may succeed).
 */
const NO_RETRY_KINDS = new Set<ApiErrorKind>([
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "SCOPE_DENIED",
  "VALIDATION",
  "BUSINESS_RULE",
  "NOT_FOUND",
  "CONFLICT",
]);

/**
 * TanStack Query retry predicate (FRONTEND-04 §16.2).
 *
 * Usage in QueryClient:
 *   new QueryClient({ defaultOptions: { queries: { retry: shouldRetryQuery } } })
 *
 * Rules:
 * - failureCount ≥ 2 → false (max 2 attempts total: initial + 1 retry)
 * - ApiError with non-transient kind → false (auth/permission/validation errors won't fix on retry)
 * - ApiError NETWORK / SERVER / MAINTENANCE / UNKNOWN → true (transient, worth retrying)
 * - Non-ApiError (network exception, parse error) → retry up to limit
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;

  if (error instanceof ApiError) {
    return !NO_RETRY_KINDS.has(error.kind);
  }

  // Non-ApiError (fetch threw, JSON parse failed, etc.) — treat as transient
  return true;
}
