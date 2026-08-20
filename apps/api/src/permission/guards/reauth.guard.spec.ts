import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StepUpWindowService,
  type StepUpWindowKey,
} from "../../auth/step-up/step-up-window.service";
import { isReauthValid } from "../permission.decide";
import { IS_PUBLIC } from "../public.decorator";
import { REQUIRE_PERMISSION, type RequirePermissionMeta } from "../require-permission.decorator";
import { ReauthGuard } from "./reauth.guard";

/**
 * S10-AUTH-STEPUP-1 · L3 RED-first — `ReauthGuard` là **WRITER DUY NHẤT** của `req.reauthContext`
 * (DECISIONS-09 §6 điểm 1 + điểm 11.2).
 *
 * Bốn nhánh dưới đây là toàn bộ hợp đồng của guard, và ba trong bốn nhánh **không ghi gì**:
 *
 *   (A) KHÔNG phải reveal-class (`isSensitive && requiresReauth`) ⇒ `true`, KHÔNG ghi, KHÔNG hỏi store.
 *       Đây là ca giữ cho MỌI route đang chạy hôm nay **0 thay đổi hành vi**: hôm nay không route sản
 *       phẩm nào khai `requiresReauth` (registry `REVEAL_CLASS_PAIRS` rỗng) ⇒ nhánh này là 100% lưu lượng.
 *   (B) reveal-class nhưng `req.params.id` vắng ⇒ `true`, KHÔNG ghi. `PermissionGuard` sẽ tự deny
 *       `deny-object-required` (đó là việc của NÓ, không phải của guard này).
 *   (C) store không có cửa sổ còn hạn ⇒ `true`, KHÔNG ghi ⇒ `deny-reauth-required` ở PermissionGuard.
 *   (D) store trả cửa sổ còn hạn ⇒ ghi ĐÚNG giá trị đọc được, và giá trị đó PHẢI `instanceof Date`.
 *
 * ─── VÌ SAO `instanceof Date` LÀ MỘT ASSERT TRONG CHÍNH GUARD, KHÔNG CHỈ TRONG SPEC (🚩PLAN-BLOCK#1) ──
 * Consumer là `isReauthValid()` (permission.decide.ts) và nó **loại thẳng** mọi thứ không phải `Date`:
 * `if (!(x instanceof Date) || isNaN(...)) return false`. Nghĩa là một chuỗi ISO lọt xuống KHÔNG ném,
 * KHÔNG log, chỉ trả `false` — route 403 VĨNH VIỄN mà không có bằng chứng nào ở đâu. Vì thế guard tự
 * kiểm kiểu TRƯỚC khi ghi và log ERROR khi store phá hợp đồng codec; ca (E) đóng đinh chiều đó.
 *
 * Guard **KHÔNG BAO GIỜ deny** (mọi ca `=== true`): nó chỉ nạp ngữ cảnh. Trộn thêm một `throw` vào đây
 * sẽ đẻ ra đường deny THỨ HAI, ngoài `permission.decide` — đúng thứ mà DECISIONS-09 §3.2 cấm.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_ID = "33333333-3333-3333-3333-333333333333";

const REVEAL_META: RequirePermissionMeta = {
  action: "read",
  resourceType: "employee_salary",
  isSensitive: true,
  requiresReauth: true,
};

/** Request giả — đúng những trường guard được phép đọc, không hơn. */
type FakeRequest = {
  params?: Record<string, string>;
  user?: { id?: string; companyId?: string };
  body?: unknown;
  reauthContext?: { reauthValidUntil: Date | null };
};

function makeReflector(opts: { isPublic?: boolean; meta?: RequirePermissionMeta }): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC) return opts.isPublic ?? false;
      if (key === REQUIRE_PERMISSION) return opts.meta;
      return undefined;
    }),
  } as unknown as Reflector;
}

function makeCtx(req: FakeRequest, type: "http" | "ws" = "http"): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => function revealSecret(): void {},
    getClass: () => class FakeController {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/**
 * Store giả. `getValidWindow` khai trả `unknown` CÓ CHỦ ĐÍCH: ca (E) cần bơm một chuỗi ISO qua seam —
 * tức đúng cái mà TypeScript hứa không xảy ra nhưng runtime (Valkey trả string) làm được nếu ai đó sửa
 * codec. Guard phải sống sót chuyện đó bằng cách TỪ CHỐI GHI, không phải bằng cách tin kiểu.
 */
function makeWindows(result: unknown | (() => Promise<unknown>)): {
  windows: StepUpWindowService;
  getValidWindow: ReturnType<typeof vi.fn>;
} {
  const getValidWindow = vi.fn(
    async (_key: StepUpWindowKey): Promise<unknown> =>
      typeof result === "function" ? (result as () => Promise<unknown>)() : result,
  );
  return { windows: { getValidWindow } as unknown as StepUpWindowService, getValidWindow };
}

function makeGuard(
  opts: { isPublic?: boolean; meta?: RequirePermissionMeta },
  result: unknown | (() => Promise<unknown>),
): { guard: ReauthGuard; getValidWindow: ReturnType<typeof vi.fn> } {
  const { windows, getValidWindow } = makeWindows(result);
  return { guard: new ReauthGuard(makeReflector(opts), windows), getValidWindow };
}

function revealRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    params: { id: RESOURCE_ID },
    user: { id: USER_ID, companyId: COMPANY_ID },
    ...overrides,
  };
}

describe("ReauthGuard (A) — KHÔNG phải reveal-class ⇒ 0 thay đổi hành vi cho MỌI route đang có", () => {
  const NON_REVEAL: Array<[string, RequirePermissionMeta | undefined]> = [
    [
      "nhạy cảm nhưng KHÔNG đòi re-auth (hình dạng của PATCH /settings/security-policy sau KI-065)",
      {
        action: "update",
        resourceType: "security_policy",
        isSensitive: true,
      },
    ],
    [
      "đòi re-auth nhưng KHÔNG nhạy cảm (một vế đúng KHÔNG đủ — decide.ts yêu cầu CẢ HAI)",
      {
        action: "read",
        resourceType: "employee",
        requiresReauth: true,
      },
    ],
    ["route thường, không cờ nào", { action: "list", resourceType: "employee" }],
    [
      "route KHÔNG có @RequirePermission (PermissionGuard tự fail-closed 403, không phải việc guard này)",
      undefined,
    ],
  ];

  it.each(NON_REVEAL)("%s ⇒ true, KHÔNG ghi, KHÔNG hỏi store", async (_name, meta) => {
    const req = revealRequest();
    const { guard, getValidWindow } = makeGuard({ meta }, new Date(Date.now() + 60_000));

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });

  it("route @Public ⇒ true, KHÔNG ghi (không có JWT thì không có bộ-5 để tra)", async () => {
    const req = revealRequest({ user: undefined });
    const { guard, getValidWindow } = makeGuard(
      { isPublic: true, meta: REVEAL_META },
      new Date(Date.now() + 60_000),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });

  it("ngữ cảnh KHÔNG phải http (WS) ⇒ true, KHÔNG ghi — guard toàn cục cũng chạy cho gateway", async () => {
    const req = revealRequest();
    const { guard, getValidWindow } = makeGuard(
      { meta: REVEAL_META },
      new Date(Date.now() + 60_000),
    );

    await expect(guard.canActivate(makeCtx(req, "ws"))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });
});

describe("ReauthGuard (B) — reveal-class nhưng KHÔNG có `:id` ⇒ không tra, không ghi", () => {
  it("thiếu hẳn params ⇒ true, KHÔNG ghi, KHÔNG hỏi store", async () => {
    const req = revealRequest({ params: undefined });
    const { guard, getValidWindow } = makeGuard(
      { meta: REVEAL_META },
      new Date(Date.now() + 60_000),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });

  it("có param khác nhưng KHÔNG có `id` (vd :employeeId/:fileId) ⇒ KHÔNG tra store", async () => {
    // PermissionGuard chỉ đọc `req.params?.id`; guard này PHẢI đọc CÙNG một chỗ, nếu không hai bên tra
    // hai `resourceId` khác nhau ⇒ cửa sổ đúng mà vẫn deny.
    const req = revealRequest({ params: { employeeId: RESOURCE_ID, fileId: RESOURCE_ID } });
    const { guard, getValidWindow } = makeGuard(
      { meta: REVEAL_META },
      new Date(Date.now() + 60_000),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });

  it("JWT thiếu user/companyId ⇒ KHÔNG tra store (bộ-5 không được suy từ params/body)", async () => {
    const req = revealRequest({ user: { id: USER_ID } });
    const { guard, getValidWindow } = makeGuard(
      { meta: REVEAL_META },
      new Date(Date.now() + 60_000),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
    expect(getValidWindow).not.toHaveBeenCalled();
  });
});

describe("ReauthGuard (C) — store KHÔNG có cửa sổ dùng được ⇒ KHÔNG ghi (fail-closed)", () => {
  it.each([
    ["null (chưa step-up / đã hết hạn)", null],
    ["undefined", undefined],
  ])("store trả %s ⇒ true, KHÔNG ghi", async (_name, result) => {
    const req = revealRequest();
    const { guard, getValidWindow } = makeGuard({ meta: REVEAL_META }, result);

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(getValidWindow).toHaveBeenCalledTimes(1);
    expect(req.reauthContext).toBeUndefined();
  });

  it("cửa sổ ĐÃ HẾT HẠN ⇒ KHÔNG ghi (guard không tin store, tự đo lại bằng isReauthValid)", async () => {
    const req = revealRequest();
    const { guard } = makeGuard({ meta: REVEAL_META }, new Date(Date.now() - 1_000));

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
  });

  it("store NÉM (Valkey outage lúc đọc) ⇒ true, KHÔNG ghi ⇒ deny ở PermissionGuard, KHÔNG 500", async () => {
    const req = revealRequest();
    const { guard } = makeGuard({ meta: REVEAL_META }, () =>
      Promise.reject(new Error("valkey read failed")),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
  });
});

describe("ReauthGuard (D) — cửa sổ còn hạn ⇒ ghi ĐÚNG giá trị, và giá trị là Date", () => {
  let req: FakeRequest;
  let until: Date;
  let getValidWindow: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    until = new Date(Date.now() + 300_000);
    req = revealRequest();
    const made = makeGuard({ meta: REVEAL_META }, until);
    getValidWindow = made.getValidWindow;
    await made.guard.canActivate(makeCtx(req));
  });

  it("ghi đúng mốc store trả về — KHÔNG tự tính TTL trong guard", () => {
    expect(req.reauthContext).toEqual({ reauthValidUntil: until });
    expect(req.reauthContext?.reauthValidUntil?.getTime()).toBe(until.getTime());
  });

  it("🚩PLAN-BLOCK#1 — giá trị ghi PHẢI `instanceof Date` và được `isReauthValid` CHẤP NHẬN", () => {
    expect(req.reauthContext?.reauthValidUntil).toBeInstanceOf(Date);
    expect(isReauthValid(req.reauthContext?.reauthValidUntil, new Date())).toBe(true);
  });

  it("tra store bằng ĐÚNG bộ-5, companyId/userId lấy TỪ JWT", () => {
    expect(getValidWindow).toHaveBeenCalledTimes(1);
    expect(getValidWindow).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: USER_ID,
      action: REVEAL_META.action,
      resourceType: REVEAL_META.resourceType,
      resourceId: RESOURCE_ID,
    });
  });

  it("companyId/userId KHÔNG bao giờ lấy từ body/params do client gửi", async () => {
    const spoofed = revealRequest({
      body: { companyId: "99999999-9999-9999-9999-999999999999", userId: "attacker" },
      params: { id: RESOURCE_ID, companyId: "99999999-9999-9999-9999-999999999999" },
    });
    const made = makeGuard({ meta: REVEAL_META }, new Date(Date.now() + 300_000));

    await made.guard.canActivate(makeCtx(spoofed));

    expect(made.getValidWindow.mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      userId: USER_ID,
    });
  });
});

describe("ReauthGuard (E) — store phá hợp đồng codec ⇒ TỪ CHỐI GHI (không để chuỗi ISO lọt xuống)", () => {
  it("store trả STRING ISO ⇒ KHÔNG ghi (nếu ghi, isReauthValid false VĨNH VIỄN, 403 câm)", async () => {
    const req = revealRequest();
    const { guard } = makeGuard(
      { meta: REVEAL_META },
      new Date(Date.now() + 300_000).toISOString(),
    );

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
  });

  it("store trả `Invalid Date` ⇒ KHÔNG ghi", async () => {
    const req = revealRequest();
    const { guard } = makeGuard({ meta: REVEAL_META }, new Date("khong-phai-ngay"));

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext).toBeUndefined();
  });
});

describe("🚩PLAN-BLOCK#4 — DI hỏng phải CRASH lúc boot, KHÔNG phải một guard câm", () => {
  /**
   * `ReauthGuard` là writer DUY NHẤT. Gỡ nó (hoặc gỡ `StepUpWindowService` khỏi `AuthModule.exports`)
   * mà app vẫn boot = mọi route reveal-class deny 403 im lặng, vĩnh viễn — nguyên văn KI-065, thứ đã
   * sống một tháng vì KHÔNG AI NÉM LỖI. `PermissionModule.onModuleInit` khẳng định cả hai lúc boot;
   * ba ca dưới đây chứng minh khẳng định đó KHÔNG rỗng (và khối cũ vẫn còn nguyên hiệu lực).
   */
  async function initWith(missing: unknown[]): Promise<void> {
    const { PermissionModule } = await import("../permission.module");
    const moduleRef = {
      get: (token: unknown) => {
        if (missing.includes(token)) throw new Error(`Nest could not find ${String(token)}`);
        return {};
      },
    };
    new PermissionModule(moduleRef as never).onModuleInit();
  }

  it("đủ provider ⇒ boot im lặng", async () => {
    await expect(initWith([])).resolves.toBeUndefined();
  });

  it("gỡ ReauthGuard ⇒ ném lỗi NÊU TÊN writer duy nhất", async () => {
    await expect(initWith([ReauthGuard])).rejects.toThrow(/ReauthGuard/);
    await expect(initWith([ReauthGuard])).rejects.toThrow(/reauthContext/);
  });

  it("gỡ StepUpWindowService khỏi AuthModule.exports ⇒ ném lỗi NÊU TÊN nó", async () => {
    await expect(initWith([StepUpWindowService])).rejects.toThrow(/StepUpWindowService/);
  });

  it("HỒI QUY: khẳng định SecurityEventWriter cũ vẫn còn hiệu lực (append không nuốt khối cũ)", async () => {
    const { SecurityEventWriter } = await import("../../auth/security-event-writer.service");
    await expect(initWith([SecurityEventWriter])).rejects.toThrow(/SecurityEventWriter/);
  });
});

describe("ReauthGuard — seam THẬT với StepUpWindowService (Valkey trả STRING, không phải Date)", () => {
  /**
   * Ba ca trên dùng store giả nên chúng chứng minh HỢP ĐỒNG chứ chưa chứng minh hai nửa KHỚP NHAU.
   * Ca này nối guard vào `StepUpWindowService` THẬT với một `ValkeyService` giả trả **chuỗi** — đúng
   * hình dạng Valkey thật — để đo rằng codec ở service đủ để guard ghi được một `Date`.
   */
  function makeValkey(seed: Map<string, string>) {
    return {
      isEnabled: () => true,
      get: async (key: string): Promise<string | null> => seed.get(key) ?? null,
      set: async (key: string, value: string): Promise<boolean> => {
        seed.set(key, value);
        return true;
      },
    } as never;
  }

  it("grant() ghi chuỗi ⇒ guard đọc lại và ghi một Date được isReauthValid chấp nhận", async () => {
    const seed = new Map<string, string>();
    const windows = new StepUpWindowService(makeValkey(seed));
    const key: StepUpWindowKey = {
      companyId: COMPANY_ID,
      userId: USER_ID,
      action: REVEAL_META.action,
      resourceType: REVEAL_META.resourceType,
      resourceId: RESOURCE_ID,
    };
    const granted = await windows.grant(key);
    expect([...seed.values()][0]).toBe(granted.toISOString()); // store giữ STRING, không giữ Date

    const req = revealRequest();
    const guard = new ReauthGuard(makeReflector({ meta: REVEAL_META }), windows);
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);

    expect(req.reauthContext?.reauthValidUntil).toBeInstanceOf(Date);
    expect(isReauthValid(req.reauthContext?.reauthValidUntil, new Date())).toBe(true);
    expect(req.reauthContext?.reauthValidUntil?.toISOString()).toBe(granted.toISOString());
  });

  it("cửa sổ của user A KHÔNG mở cho user B (bộ-5 là KHOÁ, không phải một phép kiểm thêm)", async () => {
    const seed = new Map<string, string>();
    const windows = new StepUpWindowService(makeValkey(seed));
    await windows.grant({
      companyId: COMPANY_ID,
      userId: USER_ID,
      action: REVEAL_META.action,
      resourceType: REVEAL_META.resourceType,
      resourceId: RESOURCE_ID,
    });

    const other = revealRequest({
      user: { id: "44444444-4444-4444-4444-444444444444", companyId: COMPANY_ID },
    });
    const guard = new ReauthGuard(makeReflector({ meta: REVEAL_META }), windows);
    await expect(guard.canActivate(makeCtx(other))).resolves.toBe(true);

    expect(other.reauthContext).toBeUndefined();
  });
});
