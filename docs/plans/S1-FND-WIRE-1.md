# S1-FND-WIRE-1 — Micro-plan (MINIMAL wire + defer drift)

> Decision (owner 2026-06-24): **minimal wire**, controlled-sequential off master. The files-controller
> route-drift (spec API-09 §137-139: `/upload`,`/download-url`,`/download`,`/links/{id}`) + envelope
> standardization (`meta={request_id,timestamp}` + pagination block per API-01 §16.1) are **DEFERRED** to a
> follow-up WO (S1-FND-WIRE-DRIFT-1). This WO does NOT touch controllers' routes or response envelope.

## Scope (this WO)
1. **`apps/api/src/foundation/foundation.module.ts`** (NEW) — gather the 6 controller-bearing foundation
   feature modules so `/api/v1/foundation/*` is served from one place:
   `AuditModule · SettingsModule(foundation) · CompanyModule · ModuleCatalogModule · FilesModule · HolidaysModule`.
   Re-export them so consumers keep getting their services (SettingService, SequenceService consumers unaffected).
2. **`apps/api/src/app.module.ts`** (EDIT, additive) — add `FoundationModule` to imports; **relocate**
   `AuditModule` (currently the only foundation module wired, line 60 "BE-9 sẽ relocate") into FoundationModule
   → remove the standalone `AuditModule` import + array entry. Nest dedupes, but we keep it clean. No other change.
3. **`packages/contracts/src/foundation/`** (NEW) — Zod response DTOs for the endpoints that currently lack a
   contract: `company.ts` (companyView), `module-catalog.ts` (myAppItem) + `index.ts`; export from
   `packages/contracts/src/index.ts`. Dual-build picks them up.

## Explicitly OUT (folded into S1-FND-WIRE-DRIFT-1)
- Files controller route reconcile to spec (upload/download-url/download/links). 
- Envelope standardization across files/audit controllers (meta shape + pagination block).
- Migrating settings/audit/files/holidays local DTOs into contracts (coupled to envelope work).
- Acceptance "khớp API-09 §137-139" → lowered to "prefix `/foundation/*` đúng + FoundationModule serves them".
- retention/seed/sequences are orphaned service-only (no module, no consumer) → leave standalone (YAGNI);
  fold into FoundationModule when a consumer wires them.

## Acceptance (this WO)
- `FoundationModule` imports the 6 modules; `app.module` imports it additively; AuditModule no longer wired twice.
- `packages/contracts` exports `foundation` DTOs (company, module-catalog); dual-build green.
- `pnpm build` (contracts + api) + `pnpm --filter @mediaos/api typecheck` XANH.
- Foundation endpoints still registered under `/api/v1/foundation/*` (company/current, modules/my-apps,
  settings/*, audit-logs, files, holidays) — verified by build (Nest route registration) / OpenAPI.

## Gate
LIGHT+ : typescript-reviewer + security-reviewer (touches app.module + audit relocation). Build/typecheck green.
