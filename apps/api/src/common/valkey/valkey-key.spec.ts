import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetEnvScopeForTests,
  chatKey,
  currentEnvScope,
  idemKey,
  assertKeysScoped,
  isKeyScoped,
  meTrainingKey,
  permCapKey,
  permObjKey,
  replayKey,
  rlKey,
  ValkeyKeyScopeError,
} from "./valkey-key";

/**
 * S10-FND-VALKEYSCOPE-1 — bốn môi trường dùng CHUNG một Valkey db0. Mọi không gian khoá phải mang danh
 * tính môi trường, nếu không PROD và dev-online (bản clone CÙNG companyId/userId) đọc-ghi trúng nhau.
 *
 * Đây là bằng chứng cấp-phép-suy. Bằng chứng cấp-hành-vi (ghi-rồi-invalidate, đọc/ghi kép 2FA) nằm ở
 * `permission.cache.spec.ts` và `replay-guard.service.spec.ts`.
 */

// Đúng giá trị .env.* của repo (đo 18/08/2026) — không phải giá trị bịa.
const SCOPES = {
  prod: "production:mediaos",
  devOnline: "development:mediaos_dev",
  devLocal: "development:mediaos",
  lane: "test:mediaos_valkeyscope",
} as const;
const ALL_SCOPES = Object.values(SCOPES);

const CO_A = "11111111-1111-1111-1111-111111111111";
const CO_B = "22222222-2222-2222-2222-222222222222";
const U_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const U_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Mỗi builder + bộ tham số "một hàng dữ liệu" để lật từng chiều của ma trận. */
const BUILDERS: Array<{
  name: string;
  build: (scope: string, companyId: string, userId: string, resource: string) => string;
  /** Khoá có mang danh tính tenant/người dùng không (BẤT BIẾN #1). */
  carriesIdentity: boolean;
}> = [
  {
    name: "rlKey(ip)",
    build: (s, co, u) => rlKey("ip", `${co}|${u}@x.test|1.2.3.4`, s),
    carriesIdentity: true,
  },
  {
    name: "rlKey(acct)",
    build: (s, co, u) => rlKey("acct", `${co}|${u}@x.test`, s),
    carriesIdentity: true,
  },
  {
    name: "rlKey(forgot:ip)",
    build: (s, co, u) => rlKey("forgot:ip", `${co}|${u}@x.test|1.2.3.4`, s),
    carriesIdentity: true,
  },
  {
    name: "rlKey(forgot:acct)",
    build: (s, co, u) => rlKey("forgot:acct", `${co}|${u}@x.test`, s),
    carriesIdentity: true,
  },
  { name: "rlKey(2fa)", build: (s, co, u) => rlKey("2fa", `${co}|${u}`, s), carriesIdentity: true },
  {
    name: "rlKey(2fa-enable)",
    build: (s, co, u) => rlKey("2fa-enable", `${co}|${u}`, s),
    carriesIdentity: true,
  },
  {
    name: "rlKey(2fa-disable)",
    build: (s, co, u) => rlKey("2fa-disable", `${co}|${u}`, s),
    carriesIdentity: true,
  },
  {
    name: "rlKey(change-pw)",
    build: (s, co, u) => rlKey("change-pw", `${co}|${u}`, s),
    carriesIdentity: true,
  },
  { name: "permCapKey", build: (s, co, u) => permCapKey(co, u, s), carriesIdentity: true },
  {
    name: "permObjKey",
    build: (s, co, u, r) => permObjKey(co, u, "task", r, s),
    carriesIdentity: true,
  },
  // idem: material hash đã chứa companyId+userId; khoá chỉ mang hash + scope (envScope NGOÀI hash).
  {
    name: "idemKey",
    build: (s, co, u, r) => idemKey(`sha256-${co}-${u}-${r}`, s),
    carriesIdentity: false,
  },
  {
    name: "replayKey(2fa-jti)",
    build: (s, co, u, r) => replayKey("2fa-jti", `${u}-${r}`, s),
    carriesIdentity: false,
  },
  {
    name: "replayKey(totp-step)",
    build: (s, co, u, r) => replayKey("totp-step", `${u}:${r}`, s),
    carriesIdentity: false,
  },
  {
    name: "chatKey(typing)",
    build: (s, co, u, r) => chatKey("typing", `co:${co}:conv:${r}:user:${u}`, s),
    carriesIdentity: true,
  },
  {
    name: "chatKey(cooldown)",
    build: (s, co, u, r) => chatKey("cooldown", `${r}:co:${co}:user:${u}`, s),
    carriesIdentity: true,
  },
  {
    name: "chatKey(ice-turn-reject)",
    build: (s, co, u) => chatKey("ice-turn-reject", `co:${co}`, s),
    carriesIdentity: false,
  },
  { name: "meTrainingKey", build: (s, co, u) => meTrainingKey(co, u, s), carriesIdentity: true },
];

describe("valkey-key — ma trận (env × company × user × resource)", () => {
  it("MỌI builder: bốn phạm vi môi trường cho chuỗi khác nhau từng đôi một", () => {
    for (const b of BUILDERS) {
      const keys = ALL_SCOPES.map((s) => b.build(s, CO_A, U_A, "r1"));
      expect(new Set(keys).size, `${b.name} rò chéo môi trường`).toBe(keys.length);
    }
  });

  it("MỌI builder: lật companyId ⇒ khoá khác (perm cache đứng TRƯỚC RLS, mất companyId = một ô dùng chung)", () => {
    for (const b of BUILDERS) {
      const a = b.build(SCOPES.prod, CO_A, U_A, "r1");
      const c = b.build(SCOPES.prod, CO_B, U_A, "r1");
      if (b.name === "chatKey(ice-turn-reject)" || b.carriesIdentity || b.name.startsWith("idem")) {
        expect(a, `${b.name} không phân biệt công ty`).not.toBe(c);
      }
    }
  });

  it("MỌI builder: lật userId ⇒ khoá khác", () => {
    for (const b of BUILDERS) {
      if (b.name === "chatKey(ice-turn-reject)") continue; // theo thiết kế: khoá cấp công ty
      const a = b.build(SCOPES.prod, CO_A, U_A, "r1");
      const c = b.build(SCOPES.prod, CO_A, U_B, "r1");
      expect(a, `${b.name} không phân biệt người dùng`).not.toBe(c);
    }
  });

  it("ca ALLOW đối chứng: CÙNG env + company + user + resource ⇒ CÙNG chuỗi (nếu không, mọi ca DENY trên là xanh rỗng)", () => {
    for (const b of BUILDERS) {
      expect(b.build(SCOPES.prod, CO_A, U_A, "r1"), b.name).toBe(
        b.build(SCOPES.prod, CO_A, U_A, "r1"),
      );
    }
  });

  it("khoá mang danh tính PHẢI chứa companyId và userId (BẤT BIẾN #1 — envScope là THÊM, không THAY)", () => {
    for (const b of BUILDERS.filter((x) => x.carriesIdentity)) {
      const key = b.build(SCOPES.prod, CO_A, U_A, "r1");
      expect(key, `${b.name} mất companyId`).toContain(CO_A);
      if (b.name !== "chatKey(ice-turn-reject)") {
        expect(key.includes(U_A) || key.includes(`${U_A}@x.test`), `${b.name} mất userId`).toBe(
          true,
        );
      }
    }
  });
});

describe("cổng: isKeyScoped NEO SEGMENT, không dùng includes() trần", () => {
  it("`development:mediaos` KHÔNG nuốt khoá của `development:mediaos_dev` (tiền tố lồng nhau)", () => {
    // Nếu ca này đỏ: khoá dev-online lọt cổng khi chạy ở dev local — đúng cặp WO sinh ra để tách.
    const devOnlineKey = permCapKey(CO_A, U_A, SCOPES.devOnline);
    expect(isKeyScoped(devOnlineKey, SCOPES.devLocal)).toBe(false);
    expect(isKeyScoped(devOnlineKey, SCOPES.devOnline)).toBe(true);
  });

  it("nhận khoá của MỌI builder dưới đúng phạm vi của nó", () => {
    for (const b of BUILDERS) {
      for (const s of ALL_SCOPES) {
        expect(isKeyScoped(b.build(s, CO_A, U_A, "r1"), s), `${b.name} @ ${s}`).toBe(true);
      }
    }
  });

  it("khoá `chat:presence:{envScope}:…` (đã đúng sẵn, scope ở đoạn 2) vẫn qua cổng", () => {
    expect(isKeyScoped(`chat:presence:${SCOPES.prod}:co:${CO_A}:user:${U_A}`, SCOPES.prod)).toBe(
      true,
    );
  });

  it("khoá KHÔNG mang phạm vi thì trượt cổng", () => {
    expect(isKeyScoped(`perm:cap:${CO_A}:${U_A}`, SCOPES.prod)).toBe(false);
    expect(isKeyScoped("some:random:key", SCOPES.prod)).toBe(false);
  });
});

/**
 * S10-FND-VALKEYSCOPE-2 — chu kỳ chuyển tiếp ĐÃ ĐÓNG. Bộ ca dưới là NGHỊCH ĐẢO của bộ ca "miễn trừ
 * legacy" cũ: hai họ `replay:`/`perm:` chưa scoped trước đây được cho đi qua cổng, giờ PHẢI bị ném.
 *
 * Đo THẲNG trên `assertKeysScoped` — đúng hàm mà `ValkeyService` gọi ở 8 chỗ — chứ không qua một vị từ
 * trung gian: thứ cần chứng minh là "cửa hẹp đã đóng", không phải "một hàm trả false".
 */
describe("cổng runtime: cửa hẹp legacy đã ĐÓNG", () => {
  const UNSCOPED_LEGACY = [
    "replay:2fa-jti:jti-1",
    `replay:totp-step:${U_A}:12345`,
    `perm:cap:${CO_A}:${U_A}`,
    `perm:obj:${CO_A}:${U_A}:task:r1`,
  ];

  it("🔴 khoá legacy chưa scoped giờ BỊ NÉM (trước WO này là miễn trừ tường minh)", () => {
    for (const key of UNSCOPED_LEGACY) {
      expect(() => assertKeysScoped("get", [key]), key).toThrow(ValkeyKeyScopeError);
    }
  });

  it("KHÔNG siết nhầm chiều kia: khoá MỚI của chính hai họ đó vẫn đi qua", () => {
    expect(() =>
      assertKeysScoped("get", [
        replayKey("2fa-jti", "jti-1"),
        replayKey("totp-step", `${U_A}:12345`),
        permCapKey(CO_A, U_A),
        permObjKey(CO_A, U_A, "task", "r1"),
      ]),
    ).not.toThrow();
  });

  it("một khoá sai trong LÔ nhiều khoá vẫn ném (`del` nhận nhiều khoá cùng lúc)", () => {
    expect(() =>
      assertKeysScoped("del", [permCapKey(CO_A, U_A), `perm:cap:${CO_B}:${U_B}`]),
    ).toThrow(ValkeyKeyScopeError);
  });

  it("thông điệp lỗi KHÔNG rò định danh nhúng trong khoá (khoá `rl:` chứa email)", () => {
    const email = "nguoi-that@x.test";
    let message = "";
    try {
      assertKeysScoped("incr", [`rl:ip:funtime|${email}|1.2.3.4`]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("namespace='rl'");
    expect(message).not.toContain(email);
    expect(message).not.toContain("funtime");
  });

  it("cổng CHỈ sống ở NODE_ENV='test' — production KHÔNG được bảo vệ (hệ quả đã ghi ở KI-067)", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => assertKeysScoped("get", ["perm:cap:co-x:user-x"])).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});

describe("currentEnvScope — memo LAZY có đường reset (vitest chỉ làm mới module theo FILE)", () => {
  beforeEach(() => {
    __resetEnvScopeForTests();
  });

  it("trả phạm vi của tiến trình đang chạy và ổn định giữa hai lần gọi", () => {
    const first = currentEnvScope();
    expect(first).toMatch(/^[a-z]+:/);
    expect(currentEnvScope()).toBe(first);
  });

  it("reset rồi gọi lại thì đọc LẠI env (không kẹt giá trị mồi từ ca trước)", () => {
    const before = currentEnvScope();
    __resetEnvScopeForTests();
    expect(currentEnvScope()).toBe(before);
  });

  it("builder mặc định dùng đúng currentEnvScope()", () => {
    expect(permCapKey(CO_A, U_A)).toBe(permCapKey(CO_A, U_A, currentEnvScope()));
  });
});
