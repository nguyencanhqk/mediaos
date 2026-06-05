import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * roles -- tenant-scoped or system (company_id = NULL). DDL/RLS/grant at migration 0005.
 * System roles (is_system = true, company_id = NULL) are seeded by migration; app cannot write them
 * (WITH CHECK in RLS policy blocks writes where company_id IS NULL).
 * Soft-delete via deleted_at (partial unique index enforces name uniqueness on non-deleted rows).
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("roles_company_id_idx").on(t.companyId),
    index("roles_name_idx").on(t.name),
    // Unique partial indexes (WHERE deleted_at IS NULL) are defined in migration SQL only.
    // Drizzle schema does not support partial unique indexes; they are enforced at DB level.
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

/**
 * permissions -- global catalog seeded by migration. App role has SELECT only.
 * No RLS (no company_id). Sensitive permissions (is_sensitive = true) must be granted per-user only.
 */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    isSensitive: boolean("is_sensitive").notNull().default(false),
  },
  (t) => [
    uniqueIndex("permissions_action_resource_uq").on(t.action, t.resourceType),
  ],
);

export type Permission = typeof permissions.$inferSelect;

/**
 * role_permissions -- maps roles to permissions with ALLOW/DENY effect.
 * ALLOW + DENY can coexist for same (role, permission); deny-overrides logic is in app layer.
 * No UPDATE grant: delete + insert to change effect. RLS via JOIN to roles table.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    effect: text("effect").notNull(),
  },
  // Unique on (role_id, permission_id, effect) -- allows both ALLOW and DENY for same pair.
  // Defined via CONSTRAINT in migration SQL; no Drizzle primaryKey here.
);

export type RolePermission = typeof rolePermissions.$inferSelect;

/**
 * user_roles -- assigns a role to a user within a company context.
 * expires_at enables temporary role grants. RLS on company_id.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_roles_user_company_idx").on(t.userId, t.companyId),
    index("user_roles_role_idx").on(t.roleId),
    // UNIQUE (user_id, role_id, company_id) enforced via CONSTRAINT in migration SQL.
  ],
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;

/**
 * object_permissions -- fine-grained overrides on specific objects.
 * subject_type IN ('user','role'): who the permission applies to.
 * effect IN ('ALLOW','DENY'): deny-overrides logic in app layer. RLS on company_id.
 */
export const objectPermissions = pgTable(
  "object_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    effect: text("effect").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("object_permissions_subject_idx").on(t.companyId, t.subjectType, t.subjectId),
    index("object_permissions_object_idx").on(t.companyId, t.objectType, t.objectId),
    // UNIQUE (company_id, subject_type, subject_id, permission_id, object_type, object_id) in migration SQL.
  ],
);

export type ObjectPermission = typeof objectPermissions.$inferSelect;
export type NewObjectPermission = typeof objectPermissions.$inferInsert;

/** Effect values for role_permissions and object_permissions. */
export const PERMISSION_EFFECTS = ["ALLOW", "DENY"] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

/** subject_type values for object_permissions. */
export const SUBJECT_TYPES = ["user", "role"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
