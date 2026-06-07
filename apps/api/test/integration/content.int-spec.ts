import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { ContentRepository } from "../../src/media/content.repository";
import { ContentService } from "../../src/media/content.service";
import { ProjectsRepository } from "../../src/media/projects.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G6-4 — ContentService qua Postgres thật (RLS app role). Bao: cross-tenant guard project,
 * đăng đa kênh (CNT-002), version chain ERD v2 §11 (one-current uq + flip), soft-delete current flip,
 * suggest-workflow (CNT-001). Chạy logic flip-trước-insert thật để chứng minh one-current không vỡ.
 */
describe.skipIf(!hasDb)("G6-4 content service", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let projectA: string;
  let projectB: string;
  let channel1: string;
  let channel2: string;
  let typeA: string;
  let content: ContentService;

  const user = () => ({ id: userA, companyId: A.companyId });

  async function seedChannel(companyId: string, code: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO channels (company_id, name, platform, platform_id, status)
       VALUES ($1, $2, $3, (SELECT id FROM platforms WHERE code = $3), 'active') RETURNING id`,
      [companyId, `g64-${code}-${randomUUID().slice(0, 8)}`, code],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g64a");
    B = await seedCompany(direct, "g64b");
    userA = await seedUser(direct, A.companyId, `g64-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `g64-${randomUUID().slice(0, 8)}@b.test`);

    projectA = (
      await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `g64-prjA-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0].id;
    projectB = (
      await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [B.companyId, `g64-prjB-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0].id;
    channel1 = await seedChannel(A.companyId, "youtube");
    channel2 = await seedChannel(A.companyId, "tiktok");
    typeA = (
      await direct.query(
        `INSERT INTO content_types (company_id, name, code, default_workflow_template_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [A.companyId, `g64-type-${randomUUID().slice(0, 8)}`, `g64-${randomUUID().slice(0, 8)}`, randomUUID()],
      )
    ).rows[0].id;

    const db = new DatabaseService();
    content = new ContentService(new ContentRepository(db), new ProjectsRepository(db), db, new AuditService());
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("createContent gắn type + entry production_status='idea'", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Video 1", contentTypeId: typeA });
    expect(c.contentTypeId).toBe(typeA);
    expect(c.productionStatus).toBe("idea");
    expect(c.status).toBe("draft");
  });

  it("createContent project tenant khác → NotFound (chặn chéo tenant)", async () => {
    await expect(
      content.createContent(user(), { projectId: projectB, title: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("createContent main_channel tenant khác → NotFound", async () => {
    const chB = await seedChannel(B.companyId, "facebook");
    await expect(
      content.createContent(user(), { projectId: projectA, title: "X", mainChannelId: chB }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("đăng đa kênh (CNT-002): 2 publish target + snapshot platform; trùng kênh → Conflict", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Multi" });
    const t1 = await content.addContentChannel(user(), c.id, { channelId: channel1 });
    const t2 = await content.addContentChannel(user(), c.id, { channelId: channel2 });
    expect(t1.channelId).toBe(channel1);
    expect(t1.platformId).toBeTruthy(); // snapshot platform_id từ kênh
    expect(t1.publishStatus).toBe("not_scheduled");
    expect(t2.channelId).toBe(channel2);
    await expect(
      content.addContentChannel(user(), c.id, { channelId: channel1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await content.listContentChannels(A.companyId, c.id)).toHaveLength(2);
  });

  it("version chain (CNT-003): v1 anchor → v2 flip is_current; one-current giữ ĐÚNG 1", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Asset" });
    const v1 = await content.createAsset(user(), c.id, { assetType: "script", externalUrl: "https://x.test/v1" });
    expect(v1.version).toBe(1);
    expect(v1.isCurrent).toBe(true);
    expect(v1.versionGroupId).toBe(v1.id); // v1 anchor: version_group_id = id

    const v2 = await content.createAssetVersion(user(), c.id, v1.id, { externalUrl: "https://x.test/v2" });
    expect(v2.version).toBe(2);
    expect(v2.isCurrent).toBe(true);
    expect(v2.versionGroupId).toBe(v1.versionGroupId);

    const assets = await content.listContentAssets(A.companyId, c.id);
    const currents = assets.filter((a) => a.isCurrent);
    expect(currents).toHaveLength(1);
    expect(currents[0].id).toBe(v2.id);
    const oldV1 = assets.find((a) => a.id === v1.id);
    expect(oldV1?.isCurrent).toBe(false);
    expect(oldV1?.supersededBy).toBe(v2.id);
  });

  it("soft-delete bản current → giải phóng one-current slot (promote version mới được)", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Del" });
    const v1 = await content.createAsset(user(), c.id, { externalUrl: "https://x.test/d1" });
    const v2 = await content.createAssetVersion(user(), c.id, v1.id, { externalUrl: "https://x.test/d2" });
    expect(v2.isCurrent).toBe(true);

    await content.deleteAsset(user(), c.id, v2.id); // xoá bản current → flip is_current=false + deleted_at

    // group còn 0 bản current (v1 đã flipped, v2 deleted) → tạo version mới (off v1) không vướng one-current uq
    const v3 = await content.createAssetVersion(user(), c.id, v1.id, { externalUrl: "https://x.test/d3" });
    expect(v3.isCurrent).toBe(true);
    expect(v3.version).toBe(3);

    const assets = await content.listContentAssets(A.companyId, c.id); // loại soft-deleted
    expect(assets.find((a) => a.id === v2.id)).toBeUndefined();
    expect(assets.filter((a) => a.isCurrent)).toHaveLength(1);
  });

  it("createAssetVersion off asset đã xoá → NotFound", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "DelTarget" });
    const v1 = await content.createAsset(user(), c.id, { externalUrl: "https://x.test/t1" });
    await content.deleteAsset(user(), c.id, v1.id);
    await expect(
      content.createAssetVersion(user(), c.id, v1.id, { externalUrl: "https://x.test/t2" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("suggestWorkflow (CNT-001) trả default_workflow_template_id của content type", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Suggest", contentTypeId: typeA });
    const s = await content.suggestWorkflow(A.companyId, c.id);
    expect(s.contentTypeId).toBe(typeA);
    expect(s.defaultWorkflowTemplateId).toBeTruthy();
  });

  it("suggestWorkflow content không có type → tất cả null", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "NoType" });
    const s = await content.suggestWorkflow(A.companyId, c.id);
    expect(s.contentTypeId).toBeNull();
    expect(s.defaultWorkflowTemplateId).toBeNull();
  });

  it("updateContent gán owner tenant khác → NotFound (FULL-gate guard chéo tenant)", async () => {
    const c = await content.createContent(user(), { projectId: projectA, title: "Owner" });
    await expect(content.updateContent(user(), c.id, { ownerUserId: userB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
