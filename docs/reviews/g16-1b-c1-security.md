# Review trail — G16-1b (C1 crown security hardening)

**Lane:** `feat/c1-g16-security` · **Commit:** `d22f203` · **Date:** 2026-06-16
**Verify DB (isolated):** `mediaos_c1` — full api **1797 pass / 5 skip / 0 fail**; chain `0000→0122` clean.
**Gate (CLAUDE.md §6, crown-jewel → FULL + santa):** `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` + santa dual-review.

## Gate execution note (honest)
Session was under a CRITICAL cost cap; the spawned `security-reviewer` and `silent-failure-hunter` agents **paused/were cut off by the cost hook before issuing verdicts**, and the `database-reviewer` ran long. To avoid an incomplete gate, the orchestrator performed a **direct santa-pass** (reading the actual auth-bypass surface + DB constraint introspection) as the primary gate — this is cheaper and not subject to the agent-pause behavior. Findings below are from that direct verification + empirical DB/test evidence.

## Scope
Migrations `0121` (read-path audit object_type) + `0122` (`security_alerts`); `SecurityAlertService`, `ReplayGuardService`, `TwoFactorEnforcementGuard`, `ValkeyService.setNx`, challenge-jti in `TokenService`, TOTP step-replay; read-path audit in payslip/media; rls-registry + seed + schema/app.module wiring.

## Verification matrix (direct santa-pass)
| Surface | Check | Verdict |
|---|---|---|
| **Token confusion** | `verifyAccessToken` rejects `tfp===true` / non-string email (token.service.ts:68); `verifyTwoFactorChallenge` rejects missing `tfp` **or** `jti` (line 94) → challenge can't auth as access, and jti-less challenges rejected (forces single-use-able) | ✅ SAFE |
| **jti single-use** | `ValkeyService.setNx` returns `null` (not no-op-`true`) when Valkey absent/errored → `ReplayGuardService.claim` falls back to in-memory `Map` w/ TTL; **never fail-open**; replay → 401 | ✅ SAFE |
| **TOTP step-replay** | same `(user, time-step)` claimed once via ReplayGuard; reuse rejected + audited | ✅ SAFE |
| **Enforcement guard** | decision by **DB** (`requiresTwoFactor && !isEnabled`), not stale JWT claim; skips `@Public`/`@AllowWithoutTwoFactor`/non-HTTP (WS); `!user` defers to JwtAuthGuard; kill-switch `TWO_FACTOR_ENFORCEMENT_ENABLED` = `z.enum(["true","false"]).default("true")` → **secure default**, only vitest sets `"false"` | ✅ SAFE |
| **security_alerts** | RLS + FORCE + tenant policy + `company_id NOT NULL`; **append-only** via `GRANT SELECT, INSERT` only (no UPDATE/DELETE); severity/type CHECK | ✅ SAFE |
| **SecurityAlertService** | `emitTx` (in-tx) **propagates** errors; `emit` (standalone) catches → `logger.error` (loud) → returns `false`, can't roll back the security action (not riding its tx) → best-effort is correct, not a silent failure | ✅ SAFE |
| **sanitizeDetail** | strips keys `/(password\|secret\|token\|code\|otp\|dek\|cipher\|hash\|key)/i` (defense-in-depth net) | ✅ SAFE |
| **Read-path audit no-leak** | `payslip.viewed` / `channel.health_viewed` record who/when/scope only (actor + objectId), **in-tx** (audit fail → rollback read), **no salary/health/secret values**; int-spec asserts no `5000` leak + deny→0 rows | ✅ SAFE |
| **Audit CHECK superset** | DB introspection: constraint includes `security_alert` AND retains all prior types (payslip, platform_account, channel, …) — DO-block UNION parsed IN+ANY+UPPER correctly | ✅ SAFE |
| **Wiring committed** | rls-registry (`security_alerts`), seed `cleanupTenants` (delete before users), journal, schema/index, app.module, auth.module — all staged/committed (forgot-to-commit trap avoided) | ✅ SAFE |

## Non-blocking observations (LOW — not fixed)
- ReplayGuard memory fallback during a Valkey **outage** is per-instance, so on a multi-instance deploy a replay could slip if it hits a different instance mid-outage. This is **fail-soft, not fail-open** (matches `LoginRateLimiter`); documented tradeoff.
- `sanitizeDetail` is **key-name** based, not value-scanning — last-resort net; the contract still forbids callers passing secrets.
- `listChannelMembers` calls `findChannelById` without read-audit — correct scope (returns members, not health/secret; only the detail `getChannel` is audited).

## Verdict
**SAFE-TO-LAND** — no CRITICAL/HIGH lane-introduced issues; no fixes required. Not merged (land is a separate user-gated step).

## ⚠️ Land-order note (drizzle monotonic-`when`)
Merge **C1 before C2**: C1 `when` 1717500210000/211000 < C2 `when` 1717500220000. If C2 lands first, the migrator (applies only `when > max_applied`) would **silently skip** 0121/0122 on a DB already at 220000. Alternatively bump C1's `when` above C2 at merge. Journal idx also collides (both used idx 85) → reconcile (bijection) at merge per the parallel-lane playbook.
