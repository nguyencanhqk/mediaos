import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles, orgUnits, positions, roles, userRoles, users } from "../db/schema";

/**
 * S5-ME-BE-1 — read-only repository cho MeModule. MỌI query chạy TRONG withTenant(caller.companyId) của
 * service gọi (RLS + FORCE) và ANDs company_id tường minh (belt-and-suspenders, BẤT BIẾN #1). SELECT-only.
 *
 * Chống IDOR (SPEC-09 §14.4/§17.1): mọi method nhận userId = token-resolved (KHÔNG bao giờ từ client) và
 * khoá row theo user_id đó — KHÔNG scope query, KHÔNG nhận owner ID ngoài.
 */

/** 1 dòng employee active tối thiểu (directory-class) — dùng cho current-person resolver + identity link. */
export interface MeActiveEmployeeRow {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  departmentName: string | null;
  positionName: string | null;
}

/** Account (AUTH) tối thiểu cho GET /me identity — KHÔNG password_hash/token/secret. */
export interface MeAccountRow {
  userId: string;
  email: string;
  status: string;
  displayName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date | null;
}

@Injectable()
export class MeRepository {
  /**
   * ĐẾM TẤT CẢ employee ACTIVE của 1 user (status='active' AND deleted_at IS NULL) — KHÔNG LIMIT (SPEC-09
   * §12.4: resolver phải phân biệt 0 / 1 / >1). Partial-unique (company_id,user_id) WHERE deleted_at IS NULL
   * là HÀNG RÀO ĐẦU (DB không cho 2 non-deleted); resolver là defense-in-depth: nếu vẫn >1 → ném lỗi cấu hình.
   * Khoá theo user_id token-resolved + company_id (own-scope, chống IDOR). LEFT JOIN org/position lấy tên
   * hiển thị directory-class (KHÔNG PII).
   */
  findActiveEmployeesByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<MeActiveEmployeeRow[]> {
    return tx
      .select({
        employeeId: employeeProfiles.id,
        employeeCode: employeeProfiles.employeeCode,
        fullName: users.fullName,
        departmentName: orgUnits.name,
        positionName: positions.name,
      })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
        ),
      );
  }

  /** Account của CHÍNH user (self, khoá user_id token-resolved). Không lộ password_hash/secret. */
  async findAccountByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<MeAccountRow | undefined> {
    const [row] = await tx
      .select({
        userId: users.id,
        email: users.email,
        status: users.status,
        displayName: users.fullName,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row as MeAccountRow | undefined;
  }

  /** Role đang hiệu lực của user (tên hiển thị — §10.4, KHÔNG danh mục permission chi tiết §17.1). */
  findActiveRolesByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ id: string; name: string }[]> {
    return tx
      .select({ id: roles.id, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.companyId, companyId),
          eq(userRoles.userId, userId),
          isNull(userRoles.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .orderBy(desc(roles.name));
  }
}
