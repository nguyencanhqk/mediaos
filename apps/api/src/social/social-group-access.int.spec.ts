/**
 * S16-SOCIAL-BE-2A · Bước 1.6 — `SocialGroupAccessService` (cổng quyền TRONG nhóm, DB cô lập).
 *
 * Phủ: G2 (404 nhóm private cho người ngoài) · G12 (nhóm xoá mềm) · G6/G6b (`allowedRoles` theo từng
 * route — admin KHÔNG xoá được nhóm) · G8 (`manage:feed-group` can thiệp + cờ `viaManage` để caller
 * ghi audit) · G5 (owner cuối) · **G5d — ĐUA THẬT**.
 *
 * 🔴 G5d là ca DUY NHẤT phân biệt được bất biến THẬT với bất biến TRANG TRÍ: `COUNT` không khoá vẫn
 * xanh ở mọi ca TUẦN TỰ nhưng vỡ khi hai owner rời ĐỒNG THỜI — hai tx xoá hai hàng KHÁC nhau nên
 * không đụng khoá hàng nào. Khuôn: `attendance-adjustment.int.spec.ts:520-523`.
 *
 * Gate cứng `hasDb && LANE_DB`. Colocated ⇒ tự vào `test:cov:social`.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../../test/helpers/seed";
import { SocialGroupAccessService } from "./social-group-access.service";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialGroupActor } from "./social.types";

const runDb = hasDb && Boolean(process.env.LANE_DB);

function actor(userId: string, companyId: string, canManageGroups = false): SocialGroupActor {
  return { actorUserId: userId, companyId, canManageGroups };
}

describe.skipIf(!runDb)("S16-SOCIAL-BE-2A SocialGroupAccessService (DB cô lập)", () => {
  let direct: Pool;
  let dbsvc: DatabaseService;
  let svc: SocialGroupAccessService;
  let A: SeededTenant;
  let owner1 = "";
  let owner2 = "";
  let admin = "";
  let member = "";
  let outsider = "";
  let manager = "";
  let privateGroup = "";
  let publicGroup = "";
  let deletedGroup = "";

  async function mkGroup(
    name: string,
    visibility: "public" | "private",
    deleted = false,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, deleted_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, name, visibility, deleted ? new Date() : null],
    );
    return r.rows[0].id as string;
  }

  async function mkMember(
    groupId: string,
    userId: string,
    role: "owner" | "admin" | "member",
    status: "active" | "pending" = "active",
  ): Promise<void> {
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (company_id, group_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
      [A.companyId, groupId, userId, role, status],
    );
  }

  async function countActiveOwners(groupId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM feed_group_members
        WHERE company_id = $1 AND group_id = $2 AND role = 'owner' AND status = 'active'`,
      [A.companyId, groupId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    direct = directPool();
    dbsvc = new DatabaseService();
    svc = new SocialGroupAccessService();
    A = await seedCompany(direct, "socgrpacc");
    const tag = randomUUID().slice(0, 8);

    owner1 = await seedUser(direct, A.companyId, `o1-${tag}@t.local`);
    owner2 = await seedUser(direct, A.companyId, `o2-${tag}@t.local`);
    admin = await seedUser(direct, A.companyId, `ad-${tag}@t.local`);
    member = await seedUser(direct, A.companyId, `mb-${tag}@t.local`);
    outsider = await seedUser(direct, A.companyId, `os-${tag}@t.local`);
    manager = await seedUser(direct, A.companyId, `mg-${tag}@t.local`);

    privateGroup = await mkGroup(`Kín ${tag}`, "private");
    publicGroup = await mkGroup(`Mở ${tag}`, "public");
    deletedGroup = await mkGroup(`Đã xoá ${tag}`, "public", true);

    await mkMember(privateGroup, owner1, "owner");
    await mkMember(privateGroup, admin, "admin");
    await mkMember(privateGroup, member, "member");
    await mkMember(deletedGroup, owner1, "owner");
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G2 — người ngoài nhóm private ⇒ 404 ERR-012; thành viên và nhóm public thì thấy", async () => {
    // Neo dương TRƯỚC: thành viên đọc được (nếu không, ca deny dưới có thể xanh vì lý do khác).
    const seen = await dbsvc.withTenant(A.companyId, (tx) =>
      svc.assertGroupVisibleTx(tx, actor(member, A.companyId), privateGroup),
    );
    expect(seen.id).toBe(privateGroup);
    expect(seen.membership?.role).toBe("member");

    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        svc.assertGroupVisibleTx(tx, actor(outsider, A.companyId), privateGroup),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_NOT_FOUND);

    const pub = await dbsvc.withTenant(A.companyId, (tx) =>
      svc.assertGroupVisibleTx(tx, actor(outsider, A.companyId), publicGroup),
    );
    expect(pub.membership).toBeNull(); // thấy nhóm public mà không cần tham gia
  });

  it("G12 — nhóm ĐÃ XOÁ MỀM ⇒ 404 ERR-012 kể cả với chính owner của nó (D13)", async () => {
    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        svc.assertGroupVisibleTx(tx, actor(owner1, A.companyId), deletedGroup),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_NOT_FOUND);
  });

  it("G6/G6b — allowedRoles THEO TỪNG ROUTE: admin qua 033 nhưng KHÔNG qua 034", async () => {
    const asAdmin = actor(admin, A.companyId);
    // 033 — owner|admin
    const ok = await dbsvc.withTenant(A.companyId, (tx) =>
      svc.assertGroupRoleTx(tx, asAdmin, privateGroup, ["owner", "admin"]),
    );
    expect(ok.viaManage).toBe(false);

    // 034 — owner MỘT MÌNH (API-19 §5.1 dòng 102)
    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        svc.assertGroupRoleTx(tx, asAdmin, privateGroup, ["owner"]),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_ROLE_REQUIRED);

    // member thường không qua cửa nào
    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        svc.assertGroupRoleTx(tx, actor(member, A.companyId), privateGroup, ["owner", "admin"]),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_ROLE_REQUIRED);
  });

  it("G8 — manage:feed-group can thiệp nhóm không phải của mình, cờ viaManage BẬT (để ghi audit)", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      svc.assertGroupRoleTx(tx, actor(manager, A.companyId, true), privateGroup, ["owner"]),
    );
    expect(out.viaManage).toBe(true);
    expect(out.membership).toBeNull();

    // Cùng người đó KHÔNG có cờ ⇒ 403 (đối chứng: cờ là thứ DUY NHẤT tạo khác biệt).
    await expect(
      dbsvc.withTenant(A.companyId, (tx) =>
        svc.assertGroupRoleTx(tx, actor(manager, A.companyId, false), privateGroup, ["owner"]),
      ),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_ROLE_REQUIRED);
  });

  it("G5 — owner DUY NHẤT rời ⇒ 409 ERR-015; có owner thứ hai thì qua", async () => {
    await expect(
      dbsvc.withTenant(A.companyId, async (tx) => {
        await svc.lockGroupRowTx(tx, A.companyId, privateGroup);
        await svc.assertOwnerRemainsTx(tx, A.companyId, privateGroup, owner1);
      }),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_LAST_OWNER);

    await mkMember(privateGroup, owner2, "owner");
    await dbsvc.withTenant(A.companyId, async (tx) => {
      await svc.lockGroupRowTx(tx, A.companyId, privateGroup);
      await svc.assertOwnerRemainsTx(tx, A.companyId, privateGroup, owner1);
    });
  });

  it("G5d 🔴 — ĐUA THẬT: hai owner cùng rời đồng thời, nhóm vẫn còn ≥1 owner active", async () => {
    const raceGroup = await mkGroup(`Đua ${randomUUID().slice(0, 8)}`, "private");
    await mkMember(raceGroup, owner1, "owner");
    await mkMember(raceGroup, owner2, "owner");
    expect(await countActiveOwners(raceGroup)).toBe(2); // neo dương

    const leave = (userId: string) =>
      dbsvc
        .withTenant(A.companyId, async (tx) => {
          await svc.lockGroupRowTx(tx, A.companyId, raceGroup);
          await svc.assertOwnerRemainsTx(tx, A.companyId, raceGroup, userId);
          // Xoá CỨNG hàng thành viên — ngoại lệ đã CHỐT của BẤT BIẾN 2 (DB-17 §4.9).
          await tx.execute(
            sql`DELETE FROM feed_group_members
                 WHERE company_id = ${A.companyId}
                   AND group_id = ${raceGroup}
                   AND user_id = ${userId}`,
          );
        })
        .then(
          () => "ok" as const,
          () => "rejected" as const,
        );

    const results = await Promise.all([leave(owner1), leave(owner2)]);

    // Bất biến ĐẾM ĐƯỢC — không phải "409 HOẶC hội tụ": hai tx xếp thế nào cũng KHÔNG được về 0.
    expect(await countActiveOwners(raceGroup)).toBeGreaterThanOrEqual(1);
    expect(results.filter((r) => r === "ok").length).toBe(1);
  });
});
