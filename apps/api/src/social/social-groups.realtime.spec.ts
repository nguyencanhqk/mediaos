import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialGroupsService } from "./social-groups.service";

// Bộ đếm `member_count` chạm DB thật — ngoài phạm vi spec này (đã có int-spec C2 riêng). Giữ
// `groupMemberCountDelta` THẬT (hàm thuần), chỉ thay hàm ghi.
vi.mock("./social-counters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./social-counters")>()),
  bumpGroupMemberCount: vi.fn(async () => undefined),
}));

/**
 * S16-SOCIAL-BE-2C — room-op của 5 đường đổi membership NHÓM (plan §4.5 · §5 AC1–AC6).
 *
 * ═══ Vì sao mock `withTenant` CHẠY XONG thân rồi mới ném ═══ (khuôn `chat-realtime-after-commit.spec.ts`)
 * Mô phỏng ca thật «thân tx chạy hết, COMMIT thất bại». Khi đó:
 *   • `join` đặt ĐÚNG (sau `await withTenant`) ⇒ không bao giờ chạy → 0 lần;
 *   • `join` đặt SAI (trong thân tx) ⇒ chạy trước khi ném → 1 lần ⇒ ĐỎ (mutant M8).
 * `leave` là NGOẠI LỆ có chủ đích (Q-LEAVE (a)): gọi TRONG tx (đóng khe «đã commit rời nhóm mà socket còn
 * nhận bài đăng ngay sau») VÀ sau commit (đóng khe «gateway đọc trước commit rồi join sau lần leave
 * thứ nhất») ⇒ commit hỏng = ĐÚNG 1 lần, commit OK = ĐÚNG 2 lần.
 *
 * Mỗi ca «0 lần» đi cạnh một ca «commit OK ⇒ đúng N lần» của CÙNG đường (neo dương): không có nó, 0 lần
 * có thể chỉ vì stub dựng sai và method chết trước khi tới chỗ room-op.
 */

const C = "c0000000-0000-0000-0000-00000000000a";
const G = "61000000-0000-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Membership = { role: "owner" | "admin" | "member"; status: "active" | "pending" } | null;

interface BuildOpts {
  commitFails: boolean;
  visibility?: "public" | "private";
  actorMembership?: Membership;
  targetMembership?: Membership;
}

function build(opts: BuildOpts) {
  const realtime = { syncFeedGroupMembership: vi.fn() };
  const tx = { execute: vi.fn(async () => ({ rows: [{ ok: 1 }] })) };
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (t: unknown) => Promise<unknown>) => {
      const out = await fn(tx);
      if (opts.commitFails) throw new Error("COMMIT thất bại (mô phỏng)");
      return out;
    }),
  };
  const access = {
    resolveActor: vi.fn(async () => ({
      companyId: C,
      actorUserId: ACTOR,
      canManageGroups: false,
    })),
  };
  const groupAccess = {
    assertGroupVisibleTx: vi.fn(async () => ({ id: G, name: "Nhóm K" })),
    assertGroupRoleTx: vi.fn(async () => ({ viaManage: false })),
    lockGroupRowTx: vi.fn(async () => undefined),
    assertOwnerRemainsTx: vi.fn(async () => undefined),
    getMembershipTx: vi.fn(async (_t: unknown, _c: string, _g: string, uid: string) =>
      uid === ACTOR
        ? (opts.actorMembership ?? { role: "owner", status: "active" })
        : (opts.targetMembership ?? { role: "member", status: "pending" }),
    ),
    // S16-SOCIAL-GROUPTOCTOU-1 (#566) đổi cổng vai của `033`/`034`/`038`/`039` sang hàm này (khoá hàng
    // nhóm RỒI đọc vai, trả `{ membership, viaManage }` của lượt đọc sau khoá). Thiếu nó thì cây gộp với
    // #566 ném TypeError ở 7 ca dưới đây; nhánh này đứng riêng thì service chưa gọi tới — vô hại.
    lockAndAssertGroupRoleTx: vi.fn(async () => ({
      membership: opts.actorMembership ?? { role: "owner", status: "active" },
      viaManage: false,
    })),
  };
  const groups = {
    createGroupTx: vi.fn(async () => ({ id: G })),
    softDeleteGroupTx: vi.fn(async () => true),
    findLiveGroupTx: vi.fn(async () => ({ id: G, visibility: opts.visibility ?? "public" })),
    getGroupTx: vi.fn(async () => ({
      id: G,
      name: "Nhóm K",
      description: null,
      visibility: opts.visibility ?? "public",
      memberCount: 1,
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
      myRole: "owner",
      myStatus: "active",
    })),
  };
  const members = {
    insertMemberTx: vi.fn(async () => undefined),
    approveTx: vi.fn(async () => true),
    setRoleTx: vi.fn(async () => true),
    deleteMemberTx: vi.fn(async () => ({
      role: opts.targetMembership?.role ?? "member",
      status: opts.targetMembership?.status ?? "active",
    })),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const outbox = { enqueue: vi.fn(async () => undefined) };

  const svc = new SocialGroupsService(
    db as never,
    access as never,
    groupAccess as never,
    groups as never,
    members as never,
    audit as never,
    outbox as never,
    // S16-SOCIAL-BE-2C — tham số MỚI ở cuối constructor (plan M12: 0 chỗ dựng tay khác).
    realtime as never,
    // S16-SOCIAL-AVATARPRESIGN-1 — `avatarSigner` (CUỐI, sau `realtime`). Chỉ `037` ký avatar — không
    // route nào của spec này chạm nó; stub rỗng để một lời gọi lạc ĐỎ (`signTx is not a function`).
    {} as never,
  );
  return { svc, realtime };
}

const USER = { id: ACTOR, companyId: C } as never;

/** Lời gọi room-op theo hành động — đếm RIÊNG join/leave (bất đối xứng là điều được đo). */
const opsOf = (rt: { syncFeedGroupMembership: ReturnType<typeof vi.fn> }, action: string) =>
  rt.syncFeedGroupMembership.mock.calls.filter((c) => c[3] === action);

describe("SocialGroupsService — room nhóm bám membership (S16-SOCIAL-BE-2C, §4.5)", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  // ─── JOIN — CHỈ sau commit ─────────────────────────────────────────────────────
  describe("AC1 `031` tạo nhóm ⇒ join người tạo SAU commit", () => {
    it("commit OK ⇒ ĐÚNG 1 join (C, G, actor)", async () => {
      const { svc, realtime } = build({ commitFails: false });
      await svc.create(USER, { name: "N", visibility: "private" } as never);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledTimes(1);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledWith(C, G, ACTOR, "join");
    });

    it("🔒 commit HỎNG ⇒ 0 join (join trước commit rồi rollback = rò)", async () => {
      const { svc, realtime } = build({ commitFails: true });
      await expect(svc.create(USER, { name: "N", visibility: "private" } as never)).rejects.toThrow(
        /COMMIT/,
      );
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });
  });

  describe("AC2/AC3 `035` xin vào", () => {
    it("AC2 nhóm public (∅→active), commit OK ⇒ ĐÚNG 1 join (C, G, actor)", async () => {
      const { svc, realtime } = build({ commitFails: false, visibility: "public" });
      await svc.join(USER, G);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledTimes(1);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledWith(C, G, ACTOR, "join");
    });

    it("🔒 AC2 nhóm public, commit HỎNG ⇒ 0 join", async () => {
      const { svc, realtime } = build({ commitFails: true, visibility: "public" });
      await expect(svc.join(USER, G)).rejects.toThrow(/COMMIT/);
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });

    it("🔒 AC3 nhóm private (∅→pending), commit OK ⇒ 0 room-op — pending KHÔNG phải thành viên", async () => {
      const { svc, realtime } = build({ commitFails: false, visibility: "private" });
      const dto = await svc.join(USER, G);
      // Neo: route đi tới hết (đọc lại DTO) — 0 room-op không phải vì chết sớm.
      expect(dto.id).toBe(G);
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });
  });

  describe("AC4 `038` quyết định thành viên", () => {
    it("duyệt (pending→active), commit OK ⇒ ĐÚNG 1 join (C, G, target)", async () => {
      const { svc, realtime } = build({ commitFails: false });
      await svc.decideMember(USER, G, TARGET, { decision: "approve" } as never);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledTimes(1);
      expect(realtime.syncFeedGroupMembership).toHaveBeenCalledWith(C, G, TARGET, "join");
    });

    it("🔒 duyệt, commit HỎNG ⇒ 0 join", async () => {
      const { svc, realtime } = build({ commitFails: true });
      await expect(
        svc.decideMember(USER, G, TARGET, { decision: "approve" } as never),
      ).rejects.toThrow(/COMMIT/);
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });

    it("từ chối (pending→∅) ⇒ 0 room-op (chưa từng ở room)", async () => {
      const { svc, realtime } = build({ commitFails: false });
      const out = await svc.decideMember(USER, G, TARGET, { decision: "reject" } as never);
      expect(out).toEqual({ userId: TARGET, role: null, status: null });
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });

    it("đổi vai (active→active) ⇒ 0 room-op", async () => {
      const { svc, realtime } = build({
        commitFails: false,
        targetMembership: { role: "member", status: "active" },
      });
      const out = await svc.decideMember(USER, G, TARGET, { role: "admin" } as never);
      expect(out).toEqual({ userId: TARGET, role: "admin", status: "active" });
      expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
    });
  });

  // ─── LEAVE — trong tx VÀ sau commit (Q-LEAVE (a)) ──────────────────────────────
  describe("AC5 `036` tự rời", () => {
    const self: Membership = { role: "member", status: "active" };

    it("commit OK ⇒ ĐÚNG 2 leave (trong tx + sau commit) (C, G, actor), 0 join", async () => {
      const { svc, realtime } = build({
        commitFails: false,
        actorMembership: self,
        targetMembership: self,
      });
      await svc.leave(USER, G);
      expect(opsOf(realtime, "leave")).toHaveLength(2);
      for (const c of opsOf(realtime, "leave")) expect(c).toEqual([C, G, ACTOR, "leave"]);
      expect(opsOf(realtime, "join")).toHaveLength(0);
    });

    it("🔒 commit HỎNG ⇒ ĐÚNG 1 leave (lần trong tx đã chạy — rollback sau leave là fail-safe)", async () => {
      const { svc, realtime } = build({
        commitFails: true,
        actorMembership: self,
        targetMembership: self,
      });
      await expect(svc.leave(USER, G)).rejects.toThrow(/COMMIT/);
      expect(opsOf(realtime, "leave")).toHaveLength(1);
      expect(opsOf(realtime, "leave")[0]).toEqual([C, G, ACTOR, "leave"]);
      expect(opsOf(realtime, "join")).toHaveLength(0);
    });
  });

  describe("AC6 `039` mời ra", () => {
    const active: Membership = { role: "member", status: "active" };

    it("commit OK ⇒ ĐÚNG 2 leave (C, G, target), 0 join", async () => {
      const { svc, realtime } = build({ commitFails: false, targetMembership: active });
      await svc.removeMember(USER, G, TARGET);
      expect(opsOf(realtime, "leave")).toHaveLength(2);
      for (const c of opsOf(realtime, "leave")) expect(c).toEqual([C, G, TARGET, "leave"]);
      expect(opsOf(realtime, "join")).toHaveLength(0);
    });

    it("🔒 commit HỎNG ⇒ ĐÚNG 1 leave", async () => {
      const { svc, realtime } = build({ commitFails: true, targetMembership: active });
      await expect(svc.removeMember(USER, G, TARGET)).rejects.toThrow(/COMMIT/);
      expect(opsOf(realtime, "leave")).toHaveLength(1);
      expect(opsOf(realtime, "leave")[0]).toEqual([C, G, TARGET, "leave"]);
    });
  });

  it("`034` xoá nhóm ⇒ KHÔNG sơ tán room (Q-EVAC (a) — phần dư R9 ghi API-19 §7)", async () => {
    const { svc, realtime } = build({ commitFails: false });
    // Neo dương: route đi tới hết và trả kết quả thật — 0 room-op không phải vì chết sớm.
    await expect(svc.remove(USER, G)).resolves.toEqual({ deleted: true });
    expect(realtime.syncFeedGroupMembership).not.toHaveBeenCalled();
  });
});
