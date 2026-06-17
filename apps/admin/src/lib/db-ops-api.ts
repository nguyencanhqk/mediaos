import {
  dbBrowserResultSchema,
  dbExportJobDtoSchema,
  dbOpsGrantDtoSchema,
  migrationStatusDtoSchema,
  type DbBrowserQuery,
  type DbBrowserResult,
  type DbExportJobCreate,
  type DbExportJobDto,
  type DbOpsGrantDto,
  type DbOpsGrantRequest,
  type MigrationStatusDto,
} from "@mediaos/contracts";
import { z } from "zod";
import { apiFetch } from "./api-client";

/**
 * AC-9 db-ops API client (operator-only). Map 1-1 vào DbOpsController (/operator/db-ops/*).
 *
 * Mọi route operator (aud=operator) + step-up cross-tenant. `apiFetch` gắn Bearer + gỡ envelope + Zod-parse.
 * Permission server ép (read:db-browser / manage:db-ops, is_sensitive); FE chỉ gate UI bằng useCan.
 */

const grantListSchema = z.array(dbOpsGrantDtoSchema);
const exportListSchema = z.array(dbExportJobDtoSchema);

function buildBrowseQuery(q: DbBrowserQuery): string {
  const qs = new URLSearchParams();
  qs.set("targetCompanyId", q.targetCompanyId);
  qs.set("table", q.table);
  if (q.cols?.length) for (const c of q.cols) qs.append("cols", c);
  if (q.limit != null) qs.set("limit", String(q.limit));
  if (q.offset != null) qs.set("offset", String(q.offset));
  return `?${qs.toString()}`;
}

export const dbOpsApi = {
  // P1 migration status (all-tenant; step-up sentinel)
  getMigrationStatus: (): Promise<MigrationStatusDto> =>
    apiFetch("/operator/db-ops/migration-status", migrationStatusDtoSchema),

  // P2 data browser (tenant-scoped; step-up target)
  browse: (q: DbBrowserQuery): Promise<DbBrowserResult> =>
    apiFetch(`/operator/db-ops/browse${buildBrowseQuery(q)}`, dbBrowserResultSchema),

  // P3 break-glass grants
  listGrants: (): Promise<DbOpsGrantDto[]> =>
    apiFetch("/operator/db-ops/grants", grantListSchema),
  requestGrant: (body: DbOpsGrantRequest): Promise<DbOpsGrantDto> =>
    apiFetch("/operator/db-ops/grants", dbOpsGrantDtoSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approveGrant: (id: string): Promise<DbOpsGrantDto> =>
    apiFetch(`/operator/db-ops/grants/${id}/approve`, dbOpsGrantDtoSchema, { method: "POST" }),
  revokeGrant: (id: string): Promise<DbOpsGrantDto> =>
    apiFetch(`/operator/db-ops/grants/${id}/revoke`, dbOpsGrantDtoSchema, { method: "POST" }),

  // P4 export jobs (scaffold)
  listExports: (): Promise<DbExportJobDto[]> =>
    apiFetch("/operator/db-ops/exports", exportListSchema),
  createExport: (body: DbExportJobCreate): Promise<DbExportJobDto> =>
    apiFetch("/operator/db-ops/exports", dbExportJobDtoSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
