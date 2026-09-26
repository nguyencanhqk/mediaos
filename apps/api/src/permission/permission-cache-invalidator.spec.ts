import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventBus, EventContext } from "../events/event-bus";
import { GrantSnapshotMemo, runWithGrantMemo } from "./grant-snapshot-memo";
import type { CachedPermissionRepository } from "./permission.cache";
import { PermissionCacheInvalidator } from "./permission.module";
import type { CompanyRoleGrantWithScope } from "./permission.types";

/**
 * S16-SOCIAL-PERMMEMO-1 — FULL gate security F2 (ADR-15 D6).
 *
 * `permission.changed` có payload hỏng ⇒ không biết user nào để `invalidateUser` ⇒ handler PHẢI bump
 * epoch toàn tiến trình, nếu không memo của request đang bay giữ ảnh chụp cũ (≤2s) sau một thay đổi quyền.
 * Bump chỉ gây thêm lượt đọc DB, không bao giờ nới quyền.
 */

const C1 = "11111111-1111-1111-1111-111111111111";
const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const GRANTS: CompanyRoleGrantWithScope[] = [
  {
    action: "view",
    resourceType: "feed",
    isSensitive: false,
    effect: "ALLOW",
    expiresAt: null,
    dataScope: "Company",
  },
];

function setup() {
  let handle!: (ctx: EventContext) => Promise<void>;
  const bus = {
    register: (c: { handle: (ctx: EventContext) => Promise<void> }) => {
      handle = c.handle;
    },
  } as unknown as EventBus;
  const invalidateUser = vi.fn(async () => undefined);
  const cachedRepo = { invalidateUser } as unknown as CachedPermissionRepository;
  new PermissionCacheInvalidator(bus, cachedRepo).onModuleInit();
  return { handle: (payload: unknown) => handle({ eventId: "e1", payload } as EventContext), invalidateUser };
}

describe("PermissionCacheInvalidator — payload hỏng vô hiệu memo request (F2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["null", null],
    ["chuỗi", "x"],
    ["thiếu userId", { companyId: C1 }],
    ["thiếu companyId", { userId: U1 }],
  ])("payload %s ⇒ lượt đọc sau trong request PHẢI về DB", async (_label, payload) => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { handle, invalidateUser } = setup();
    const memo = new GrantSnapshotMemo();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return GRANTS;
    };

    await runWithGrantMemo(async () => {
      await memo.read(C1, U1, load);
      await handle(payload);
      await memo.read(C1, U1, load);
    });

    expect(calls, "payload hỏng PHẢI bump epoch: lượt đọc sau về DB").toBe(2);
    expect(invalidateUser).not.toHaveBeenCalled();
  });
});
