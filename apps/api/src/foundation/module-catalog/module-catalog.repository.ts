import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/db.service";
import { modules, type Module } from "../../db/schema/seed-tracking";

/**
 * S1-FND-MODULE-1 — đọc catalog `modules` (mig 0435).
 *
 * `modules` là catalog GLOBAL no-RLS (KHÔNG cột company_id) — đọc qua db.withTransaction (KHÔNG set tenant
 * GUC) là ĐÚNG: không có policy keyed company_id để thoả; mirror cách đọc catalog `permissions` no-RLS. KHÔNG
 * dùng withTenant (vô nghĩa cho bảng không tenant — db.service §108).
 */
@Injectable()
export class ModuleCatalogRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Module đang active, chưa soft-delete, ORDER BY sort_order. App role có SELECT (grant mig 0435). */
  findActiveModules(): Promise<Module[]> {
    return this.db.withTransaction((tx) =>
      tx
        .select()
        .from(modules)
        .where(and(eq(modules.isActive, true), isNull(modules.deletedAt)))
        .orderBy(asc(modules.sortOrder)),
    );
  }
}
