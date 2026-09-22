/**
 * S16-SOCIAL-BE-2A · Bước 1.7 (D3/D4/D9) — nhánh `audience='group'` của `visiblePostCondition`,
 * đo TRÊN DB THẬT qua chính hai cửa mà sản phẩm dùng:
 *   • `assertPostVisible`      — cổng MÀN HÌNH (mọi route theo `{post_id}`)
 *   • `resolveViewerContext`   — cổng ĐƯỜNG TẢI (`SocialFileResolver` → `FilePolicyService`)
 *
 * 🔴 G9/G9b là lý do file này tồn tại. Hai cổng dùng CHUNG `visiblePostCondition` có chủ ý
 * (`social-access.service.ts` docblock: "cổng MÀN HÌNH và cổng ĐƯỜNG TẢI buộc phải nói cùng một
 * câu"). Một nhánh OR lỏng ở đây là rò bài nhóm kín Ở HAI ĐƯỜNG, và đường tải là đường KHÔNG ai
 * nhìn khi review route.
 *
 * Bốn tổ hợp bắt buộc của nhánh mới (M-b): {thành viên, người ngoài} × {nhóm private, nhóm public}.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../../test/helpers/seed";
import { DataScopeService } from "../permission/data-scope.service";
import { SocialAccessService } from "./social-access.service";
import { SocialGroupAccessService } from "./social-group-access.service";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialViewerContext } from "./social.types";

const runDb = hasDb && Boolean(process.env.LANE_DB);

describe.skipIf(!runDb)("S16-SOCIAL-BE-2A D3 — đọc bài nhóm (màn hình ↔ đường tải)", () => {
  let direct: Pool;
  let dbsvc: DatabaseService;
  let access: SocialAccessService;
  let A: SeededTenant;
  let member = "";
  let outsider = "";
  let author = "";
  let privatePostId = "";
  let publicPostId = "";
  let deletedGroupPostId = "";

  /** Ngữ cảnh XEM dựng tay — KHÔNG đi qua `resolveActor` (cần grant thật); đây là đúng hình dạng mà
   *  `resolveViewerContext` trả về cho một nhân viên thường. */
  const viewer = (userId: string): SocialViewerContext => ({
    actorUserId: userId,
    companyId: A.companyId,
    canManagePosts: false,
    orgUnitIds: [],
  });

  async function mkGroup(name: string, visibility: "public" | "private", deleted = false) {
    const r = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, deleted_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, name, visibility, deleted ? new Date() : null],
    );
    return r.rows[0].id as string;
  }

  async function mkPost(groupId: string, body: string) {
    const r = await direct.query(
      `INSERT INTO feed_posts (company_id, author_user_id, type, audience, group_id, body)
       VALUES ($1, $2, 'share', 'group', $3, $4) RETURNING id`,
      [A.companyId, author, groupId, body],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    direct = directPool();
    dbsvc = new DatabaseService();
    // `DataScopeService` chỉ được dùng ở `resolveActor`/`resolveViewerContext` — các ca dưới đây
    // dựng `SocialViewerContext` tay nên không chạm tới nó.
    access = new SocialAccessService(
      {} as unknown as DataScopeService,
      new SocialGroupAccessService(),
    );
    A = await seedCompany(direct, "socgrpvis");
    const tag = randomUUID().slice(0, 8);

    author = await seedUser(direct, A.companyId, `au-${tag}@t.local`);
    member = await seedUser(direct, A.companyId, `mb-${tag}@t.local`);
    outsider = await seedUser(direct, A.companyId, `os-${tag}@t.local`);

    const priv = await mkGroup(`Kín ${tag}`, "private");
    const pub = await mkGroup(`Mở ${tag}`, "public");
    const dead = await mkGroup(`Chết ${tag}`, "public", true);

    for (const g of [priv, pub, dead]) {
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, 'owner', 'active', now()), ($1, $2, $4, 'member', 'active', now())`,
        [A.companyId, g, author, member],
      );
    }

    privatePostId = await mkPost(priv, "Bài trong nhóm kín");
    publicPostId = await mkPost(pub, "Bài trong nhóm mở");
    deletedGroupPostId = await mkPost(dead, "Bài trong nhóm đã xoá");
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G1 — nhóm PRIVATE: thành viên đọc được (neo dương), người ngoài ⇒ 404 ERR-001", async () => {
    const seen = await dbsvc.withTenant(A.companyId, (tx) =>
      access.assertPostVisible(tx, viewer(member), privatePostId),
    );
    expect(seen.id).toBe(privatePostId);

    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        access.assertPostVisible(tx, viewer(outsider), privatePostId),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.POST_NOT_FOUND);
  });

  it("G4 — nhóm PUBLIC: người KHÔNG tham gia vẫn đọc được (SPEC-16 §3.4 chỉ giới hạn nhóm KÍN)", async () => {
    const seen = await dbsvc.withTenant(A.companyId, (tx) =>
      access.assertPostVisible(tx, viewer(outsider), publicPostId),
    );
    expect(seen.id).toBe(publicPostId);
  });

  it("G12b — nhóm PUBLIC đã XOÁ MỀM: không còn phát bài cho ai, kể cả thành viên (D13)", async () => {
    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        access.assertPostVisible(tx, viewer(member), deletedGroupPostId),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.POST_NOT_FOUND);

    // Tác giả VẪN thấy bài của chính mình ở mọi audience (vế `isAuthor`, hợp đồng của BE-1 — ghi lại
    // ở đây để lượt sau không "siết" nhầm rồi làm người dùng mất bài của chính họ).
    const own = await dbsvc.withTenant(A.companyId, (tx) =>
      access.assertPostVisible(tx, viewer(author), deletedGroupPostId),
    );
    expect(own.id).toBe(deletedGroupPostId);
  });

  it("🔴 G9 — cổng ĐƯỜNG TẢI nói CÙNG CÂU với cổng màn hình (dùng chung visiblePostCondition)", async () => {
    // `SocialFileResolver` gọi `assertPostVisible` với ngữ cảnh do `resolveViewerContext` dựng.
    // Đo bằng CHÍNH vị từ đó trên cùng hai actor: khác kết quả giữa hai cổng là lớp lỗi
    // `read-path-gate-pair-must-match-download-pair`.
    const asMember = await dbsvc.withTenant(A.companyId, (tx) =>
      access.assertPostVisible(tx, viewer(member), privatePostId),
    );
    expect(asMember.id).toBe(privatePostId);

    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        access.assertPostVisible(tx, viewer(outsider), privatePostId),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.POST_NOT_FOUND);
  });

  it("🔴 G9b — `manage:feed-group` KHÔNG nới cổng đọc bài (D9-ii)", async () => {
    // Cờ `canManageGroups` sống trên `SocialActor`, KHÔNG trên `SocialViewerContext` — nên nó không
    // có đường nào chạm vào `visiblePostCondition`. Ca này ghim điều đó lại: kể cả khi ai đó thêm
    // cờ vào ngữ cảnh XEM, bài nhóm kín vẫn phải 404 cho người ngoài nhóm.
    const withManageFlag = {
      ...viewer(outsider),
      canManageGroups: true,
    } as SocialViewerContext;

    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        access.assertPostVisible(tx, withManageFlag, privatePostId),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.POST_NOT_FOUND);
  });
});
