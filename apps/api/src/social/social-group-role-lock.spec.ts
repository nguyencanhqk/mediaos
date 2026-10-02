import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import { SocialGroupAccessService } from "./social-group-access.service";
import { SOCIAL_ERR } from "./social.errors";
import type { FeedGroupRole, SocialGroupActor, SocialGroupMembership } from "./social.types";

/**
 * S16-SOCIAL-GROUPTOCTOU-1 — lưới KHÔNG cần DB cho luật «route GHI theo vai đọc vai ACTOR SAU khoá
 * hàng nhóm» (plan `docs/plans/S16-SOCIAL-GROUPTOCTOU-1.md` §5.3). Ca đua thật nằm ở
 * `test/integration/social-grouptoctou-race.int-spec.ts` — chỉ chạy khi có `LANE_DB`; file này chạy ở
 * MỌI môi trường.
 *
 * - U1: `lockAndAssertGroupRoleTx` KHOÁ rồi mới ĐỌC (đảo thứ tự = TOCTOU nguyên vẹn).
 * - U2: nguồn quyền (`viaManage`) suy từ hàng ĐỌC SAU khoá (owner ký D1=(a)).
 * - U3: CẤU TRÚC theo THÂN HÀM của `social-groups.service.ts` — route nào gọi cổng nào. Đếm theo
 *   file thì hoán đổi cổng giữa hai route vẫn xanh (plan §10 F4, mutant M-8).
 */

const TX = {} as TenantTx;
const GROUP_ID = "00000000-0000-4000-8000-0000000000a1";
const WRITE_ROLES: readonly FeedGroupRole[] = ["owner", "admin"];

const actor = (canManageGroups: boolean): SocialGroupActor => ({
  actorUserId: "00000000-0000-4000-8000-0000000000b1",
  companyId: "00000000-0000-4000-8000-0000000000c1",
  canManageGroups,
});

/** Dịch vụ thật, hai câu SQL bị thay bằng spy ghi vào `calls`; hàng đọc được là `row`. */
function serviceWith(row: SocialGroupMembership | null): {
  svc: SocialGroupAccessService;
  calls: string[];
} {
  const svc = new SocialGroupAccessService();
  const calls: string[] = [];
  vi.spyOn(svc, "lockGroupRowTx").mockImplementation(() => {
    calls.push("lock");
    return Promise.resolve();
  });
  vi.spyOn(svc, "getMembershipTx").mockImplementation(() => {
    calls.push("read");
    return Promise.resolve(row);
  });
  return { svc, calls };
}

describe("U1 — lockAndAssertGroupRoleTx khoá hàng nhóm TRƯỚC khi đọc vai actor", () => {
  it("thứ tự lời gọi là [lock, read]", async () => {
    const { svc, calls } = serviceWith({ role: "admin", status: "active" });
    await svc.lockAndAssertGroupRoleTx(TX, actor(false), GROUP_ID, WRITE_ROLES);
    expect(calls).toEqual(["lock", "read"]);
  });

  it("ném 403 cũng chỉ SAU khi đã khoá (không có nhánh đọc-trước-khoá)", async () => {
    const { svc, calls } = serviceWith({ role: "member", status: "active" });
    await expect(
      svc.lockAndAssertGroupRoleTx(TX, actor(false), GROUP_ID, WRITE_ROLES),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toEqual(["lock", "read"]);
  });
});

describe("U2 — nguồn quyền theo hàng ĐỌC SAU khoá (D1=(a): «vai hoặc manage»)", () => {
  it("hàng member/active + manage ⇒ viaManage:true (admin kiêm manage vừa bị hạ vai vẫn qua)", async () => {
    const { svc } = serviceWith({ role: "member", status: "active" });
    await expect(
      svc.lockAndAssertGroupRoleTx(TX, actor(true), GROUP_ID, WRITE_ROLES),
    ).resolves.toEqual({ membership: { role: "member", status: "active" }, viaManage: true });
  });

  it("hàng admin/active ⇒ viaManage:false (cả khi có manage — vai hàng khớp là nguồn quyền)", async () => {
    const { svc } = serviceWith({ role: "admin", status: "active" });
    await expect(
      svc.lockAndAssertGroupRoleTx(TX, actor(true), GROUP_ID, WRITE_ROLES),
    ).resolves.toEqual({ membership: { role: "admin", status: "active" }, viaManage: false });
  });

  it("hàng member, không manage ⇒ 403 SOCIAL-ERR-014", async () => {
    const { svc } = serviceWith({ role: "member", status: "active" });
    const err = await svc.lockAndAssertGroupRoleTx(TX, actor(false), GROUP_ID, WRITE_ROLES).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: "SOCIAL-ERR-014",
      message: SOCIAL_ERR.GROUP_ROLE_REQUIRED,
    });
  });

  it("hàng actor đã biến mất (bị mời ra giữa chừng), không manage ⇒ 403 SOCIAL-ERR-014 (D3=(a))", async () => {
    const { svc } = serviceWith(null);
    const err = await svc.lockAndAssertGroupRoleTx(TX, actor(false), GROUP_ID, WRITE_ROLES).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: "SOCIAL-ERR-014",
      message: SOCIAL_ERR.GROUP_ROLE_REQUIRED,
    });
  });
});

// ─────────────────────────────── U3 — cấu trúc ───────────────────────────────

/** Bỏ comment — luật nói về CODE, không về văn xuôi giải thích luật (khuôn `social-poll-flags-structure.spec.ts`). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SERVICE_SRC = stripComments(
  readFileSync(join(__dirname, "social-groups.service.ts"), "utf8"),
);

/**
 * Thân từng method của lớp: cắt tại mỗi khai báo `  async <tên>(` / `  private async <tên>(` (thụt 2 —
 * plan §2 M15) tới khai báo kế tiếp. Method cuối kéo tới hết file (phần sau lớp không gọi cổng nào).
 */
function methodBodies(src: string): Map<string, string> {
  const heads = [...src.matchAll(/^ {2}(?:private )?async (\w+)\(/gm)].map((m) => ({
    name: m[1],
    index: m.index,
  }));
  return new Map(
    heads.map((h, i) => [h.name, src.slice(h.index, heads[i + 1]?.index ?? src.length)]),
  );
}

const BODIES = methodBodies(SERVICE_SRC);

/** `\b` + chữ `a` THƯỜNG ⇒ `\bassertGroupRoleTx\(` không khớp bên trong `lockAndAssertGroupRoleTx(`. */
const GATES = {
  lockAndAssert: /\blockAndAssertGroupRoleTx\(/g,
  bareAssert: /\bassertGroupRoleTx\(/g,
  lockOnly: /\blockGroupRowTx\(/g,
} as const;

const countOf = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

/** [lockAndAssertGroupRoleTx, assertGroupRoleTx trần, lockGroupRowTx] — D2=(a): `033`/`034` khoá. */
const EXPECTED_PER_METHOD: Record<string, readonly [number, number, number]> = {
  update: [1, 0, 0], // 033
  remove: [1, 0, 0], // 034
  decideMember: [1, 0, 0], // 038
  removeMember: [1, 0, 0], // 039
  listMembers: [0, 1, 0], // 037 — CHỈ ĐỌC, giữ cổng không khoá
  join: [0, 0, 1], // 035
  leave: [0, 0, 1], // 036
};

describe("U3 — cổng vai nhóm theo THÂN HÀM của social-groups.service.ts", () => {
  it.each(Object.entries(EXPECTED_PER_METHOD))(
    "%s gọi đúng cổng",
    (name, [lockAndAssert, bareAssert, lockOnly]) => {
      const body = BODIES.get(name);
      expect(body, `không tìm thấy thân hàm ${name} — đổi tên/thụt lề?`).toBeDefined();
      const text = body ?? "";
      expect(countOf(text, GATES.lockAndAssert), `${name}: lockAndAssertGroupRoleTx`).toBe(
        lockAndAssert,
      );
      expect(countOf(text, GATES.bareAssert), `${name}: assertGroupRoleTx trần`).toBe(bareAssert);
      expect(countOf(text, GATES.lockOnly), `${name}: lockGroupRowTx`).toBe(lockOnly);
    },
  );

  it.each(["decideMember", "removeMember"])(
    "%s: khoá + đọc vai actor ĐỨNG TRƯỚC lượt đọc target đầu tiên",
    (name) => {
      const text = BODIES.get(name) ?? "";
      const lockAt = text.search(/\blockAndAssertGroupRoleTx\(/);
      const targetReadAt = text.search(/\bgetMembershipTx\(/);
      expect(lockAt, `${name}: lockAndAssertGroupRoleTx`).toBeGreaterThanOrEqual(0);
      expect(targetReadAt, `${name}: getMembershipTx (target)`).toBeGreaterThanOrEqual(0);
      expect(lockAt, `${name}: khoá phải trước đọc target`).toBeLessThan(targetReadAt);
    },
  );

  it("tổng cả file: 4 lockAndAssertGroupRoleTx + 1 assertGroupRoleTx trần (bắt call-site mới ở hàm khác)", () => {
    expect(countOf(SERVICE_SRC, GATES.lockAndAssert), "lockAndAssertGroupRoleTx cả file").toBe(4);
    expect(countOf(SERVICE_SRC, GATES.bareAssert), "assertGroupRoleTx trần cả file").toBe(1);
  });
});
