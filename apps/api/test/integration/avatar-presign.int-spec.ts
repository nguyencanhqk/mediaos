/**
 * S5-ME-BE-5 (security-review deny-path, RED-first) + RECONCILE S5-HR-AVATAR-1 —
 * FileRepository.findVerifiedAvatarsTx trên Postgres THẬT (DB CÔ LẬP). Chốt cổng SELF-DEFENDING của resolve
 * avatar directory-class: CHỈ trả file mà
 *   (a) có 1 file_links ME/avatar/Avatar SỐNG (nguồn tạo có 2: MeAvatarService.setAvatar self-service VÀ
 *       HrEmployeeAvatarService.setEmployeeAvatar HR-managed, S5-HR-AVATAR-1), VÀ
 *   (b) image/* + Uploaded + non-Infected + chưa xoá,
 * kèm employeeId=link.entity_id để caller khớp ĐÚNG cặp (chống đầu độc `avatar_url` đa-người-ghi qua
 * profile-change-request `avatar_file_id`). Mọi ca ĐỎ (non-image / no-link / Pending / Infected / link đã
 * xoá / cross-tenant / wrong linkType) → KHÔNG trả ⇒ resolve KHÔNG ký ⇒ initials (không rò file nội-tenant).
 *
 * RECONCILE 2026-07-18: owner-check đổi từ `files.owner_user_id = employee_profiles.user_id` sang
 * `files.owner_user_id = file_links.created_by` (NGƯỜI TẠO LINK phải sở hữu file) — mở đường HR-managed
 * (owner=HR=created_by) mà VẪN chặn forge (owner victim ≠ created_by kẻ gắn). Xem file.repository.ts
 * findVerifiedAvatarsTx docstring.
 *
 * Gate `hasDb && LANE_DB` (memory integration-test-lane-db-gate). KHÔNG cần MinIO (chỉ test tầng repo/SQL —
 * ca deny không chạm storage; ca allow chỉ assert repo TRẢ ĐÚNG, việc ký ở unit).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { DatabaseService } from "../../src/db/db.service";
import { FileRepository } from "../../src/foundation/files/file.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);

async function insertEmployee(
  direct: Pool,
  companyId: string,
  userId: string,
  code: string,
): Promise<string> {
  const r = await direct.query(
    "INSERT INTO employee_profiles (company_id, user_id, status, employee_code) VALUES ($1,$2,'active',$3) RETURNING id",
    [companyId, userId, code],
  );
  return r.rows[0].id as string;
}

async function insertFile(
  direct: Pool,
  companyId: string,
  ownerId: string,
  opts: { mime?: string; uploadStatus?: string; scanStatus?: string } = {},
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
     VALUES ($1,$2,'avatar.png',$3,$4,10,'MinIO',$5,'Private',$6,$7,$8,$8)`,
    [
      fileId,
      companyId,
      `${fileId}-avatar.png`,
      opts.mime ?? "image/png",
      `${companyId}/files/${fileId}`,
      opts.uploadStatus ?? "Uploaded",
      opts.scanStatus ?? "NotRequired",
      ownerId,
    ],
  );
  return fileId;
}

async function insertAvatarLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  employeeId: string,
  createdBy: string,
  opts: { linkType?: string; entityType?: string; moduleCode?: string; deleted?: boolean } = {},
): Promise<void> {
  await direct.query(
    `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type, created_by, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      companyId,
      fileId,
      opts.moduleCode ?? "ME",
      opts.entityType ?? "avatar",
      employeeId,
      opts.linkType ?? "Avatar",
      createdBy,
      opts.deleted ? new Date() : null,
    ],
  );
}

describe.skipIf(!runDb)("S5-ME-BE-5 findVerifiedAvatarsTx (self-defending avatar gate)", () => {
  let app: INestApplication;
  let direct: Pool;
  let db: DatabaseService;
  let repo: FileRepository;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;

  const pwHash = "x"; // employee/user chỉ cần tồn tại — KHÔNG login trong spec này.

  async function person(tenant: SeededTenant): Promise<{ userId: string; employeeId: string }> {
    const tag = `mebe5-${++seq}-${randomUUID().slice(0, 6)}`;
    const userId = await seedUser(direct, tenant.companyId, `${tag}@x.test`, pwHash);
    const employeeId = await insertEmployee(direct, tenant.companyId, userId, `E-${tag}`);
    return { userId, employeeId };
  }

  /** Chạy findVerifiedAvatarsTx trong withTenant của companyId. */
  function verify(companyId: string, fileIds: string[]) {
    return db.withTenant(companyId, (tx) => repo.findVerifiedAvatarsTx(companyId, fileIds, tx));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DatabaseService);
    repo = app.get(FileRepository);
    direct = directPool();
    A = await seedCompany(direct, "mebe5-a");
    B = await seedCompany(direct, "mebe5-b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("ALLOW — image + link ME/avatar SỐNG → trả kèm employeeId=link.entity", async () => {
    const p = await person(A);
    const fileId = await insertFile(direct, A.companyId, p.userId);
    await insertAvatarLink(direct, A.companyId, fileId, p.employeeId, p.userId);

    const rows = await verify(A.companyId, [fileId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe(p.employeeId);
    expect(rows[0].fileId).toBe(fileId);
    expect(rows[0].storagePath).toBeTruthy();
  });

  it("DENY — file KHÔNG image (application/pdf) dù có link → loại", async () => {
    const p = await person(A);
    const fileId = await insertFile(direct, A.companyId, p.userId, { mime: "application/pdf" });
    await insertAvatarLink(direct, A.companyId, fileId, p.employeeId, p.userId);
    expect(await verify(A.companyId, [fileId])).toHaveLength(0);
  });

  it("DENY — image nhưng KHÔNG có link ME/avatar (avatar_url đầu độc trỏ file bất kỳ) → loại", async () => {
    const p = await person(A);
    const fileId = await insertFile(direct, A.companyId, p.userId); // image, Uploaded, NHƯNG không link
    expect(await verify(A.companyId, [fileId])).toHaveLength(0);
  });

  it("DENY — Pending / Infected → loại", async () => {
    const p = await person(A);
    const pending = await insertFile(direct, A.companyId, p.userId, { uploadStatus: "Pending" });
    await insertAvatarLink(direct, A.companyId, pending, p.employeeId, p.userId);
    const infected = await insertFile(direct, A.companyId, p.userId, { scanStatus: "Infected" });
    await insertAvatarLink(direct, A.companyId, infected, p.employeeId, p.userId);
    expect(await verify(A.companyId, [pending, infected])).toHaveLength(0);
  });

  it("DENY — link đã soft-delete → loại", async () => {
    const p = await person(A);
    const fileId = await insertFile(direct, A.companyId, p.userId);
    await insertAvatarLink(direct, A.companyId, fileId, p.employeeId, p.userId, { deleted: true });
    expect(await verify(A.companyId, [fileId])).toHaveLength(0);
  });

  it("DENY — sai link_type / entity_type (không phải avatar) → loại", async () => {
    const p = await person(A);
    const f1 = await insertFile(direct, A.companyId, p.userId);
    await insertAvatarLink(direct, A.companyId, f1, p.employeeId, p.userId, {
      linkType: "Attachment",
    });
    const f2 = await insertFile(direct, A.companyId, p.userId);
    await insertAvatarLink(direct, A.companyId, f2, p.employeeId, p.userId, {
      entityType: "employee_profile",
    });
    expect(await verify(A.companyId, [f1, f2])).toHaveLength(0);
  });

  it("DENY — cross-tenant: file+link ở B, query tenant A → loại (RLS + company filter)", async () => {
    const pB = await person(B);
    const fileId = await insertFile(direct, B.companyId, pB.userId);
    await insertAvatarLink(direct, B.companyId, fileId, pB.employeeId, pB.userId);
    // Query bằng ngữ cảnh tenant A trên fileId của B → 0 dòng.
    expect(await verify(A.companyId, [fileId])).toHaveLength(0);
  });

  it("DENY — FORGE link: file NGƯỜI KHÁC upload gắn làm avatar của mình → loại (owner_user_id ≠ created_by)", async () => {
    // Vector admin: gắn file của victim (owner=victim) làm avatar employee của mình (entity=empA, created_by=userA).
    const pA = await person(A);
    const victim = await seedUser(
      direct,
      A.companyId,
      `victim-${randomUUID().slice(0, 6)}@x.test`,
      pwHash,
    );
    const victimFile = await insertFile(direct, A.companyId, victim); // image, Uploaded, owner=victim
    await insertAvatarLink(direct, A.companyId, victimFile, pA.employeeId, pA.userId); // FORGE: created_by=userA
    // Link + image + Uploaded ĐỦ, NHƯNG owner_user_id(victim) ≠ file_links.created_by(userA) ⇒ loại
    // (RECONCILE: cổng mới `owner = created_by` VẪN chặn forge — kẻ gắn link ≠ chủ sở hữu file).
    expect(await verify(A.companyId, [victimFile])).toHaveLength(0);
  });

  it("ALLOW (RECONCILE S5-HR-AVATAR-1) — HR-managed: file owner=HR, link created_by=HR, entity=employee KHÁC (HR≠employee.user) → VẪN ký", async () => {
    // Cổng CŨ (owner = employee_profiles.user_id) sẽ CHẶN case này (owner=HR ≠ employeeE.user) — chứng minh
    // reconcile mở đúng cho HR-managed avatar (HrEmployeeAvatarService.setEmployeeAvatar) mà KHÔNG mở forge.
    const hrUser = await seedUser(
      direct,
      A.companyId,
      `hr-${randomUUID().slice(0, 6)}@x.test`,
      pwHash,
    );
    const employeeE = await person(A); // NV được HR đặt avatar hộ — HR ≠ employeeE.user
    const fileId = await insertFile(direct, A.companyId, hrUser); // owner=HR
    await insertAvatarLink(direct, A.companyId, fileId, employeeE.employeeId, hrUser); // created_by=HR

    const rows = await verify(A.companyId, [fileId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe(employeeE.employeeId);
    expect(rows[0].fileId).toBe(fileId);
  });
});
