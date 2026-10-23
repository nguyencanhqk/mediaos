/**
 * S16-SOCIAL-QA-1 (L2) — 9 VAI CANONICAL × 59 route SOCIAL
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L2, D2 · D5 · D20).
 *
 *   QA1-M-R-<vai>-<mã>       employee · manager · hr · company-admin, mỗi vai một lát dữ liệu RIÊNG
 *   QA1-M-R-<vai>-002-news   biến thể tin tức của route đăng bài (cặp kiểm ở tầng 2)
 *   QA1-M-R-<vai>-0cap       năm vai không giữ cặp feed nào ⇒ 403 tầng 1 trên cả 59 route
 *   QA1-M-R-<a>+employee     tổ hợp hai vai ⇒ đúng cột employee («không thêm gì»)
 *   QA1-M-R-me-<vai>         `/auth/me` liệt kê đúng tập cặp feed + scope của vai
 *   QA1-M-R-neo-*            ca chống rỗng của cả ma trận
 *
 * Ba bảng LITERAL viết tay từ tài liệu (D2), không đọc hằng sản phẩm:
 *   (i)  route → cặp tầng 1: `test/helpers/social-qa1-routes.ts` (API-19 §5.1);
 *   (ii) vai → cặp + scope: `ROLE_GRANTS` dưới đây (`docs/permission-matrix-spec.md:707-721`);
 *   (iii) route × vai: `DENIED_CODES` dưới đây. Ca neo đối chiếu (iii) với (i) × (ii).
 *
 * Song sinh (D5): mỗi ô TỪ CHỐI của một route có ô CHO PHÉP của CÙNG request ở cột hr /
 * company-admin (lát riêng, cùng bộ gieo); ca neo cuối file đếm trên các ô ĐÃ CHẠY THẬT.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  CANONICAL_ROLES,
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  bootQa1World,
  expectGuardDenied,
  expectSocial,
  type CanonicalRole,
  type FeedPair,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1Scope,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import {
  QA1_ROUTES,
  callQa1Route,
  type Qa1Route,
  type Qa1Slice,
} from "../helpers/social-qa1-routes";
import { ensureQa1FileDoorEnv, seedQa1Slice } from "../helpers/social-qa1-seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

type Grants = Readonly<Partial<Record<FeedPair, Qa1Scope>>>;

const allAt = (pairs: readonly FeedPair[], scope: Qa1Scope): Grants =>
  Object.fromEntries(pairs.map((p) => [p, scope]));

/** (ii) Vai → cặp feed + scope — `docs/permission-matrix-spec.md:707-721` (45 grant = 7 + 8 + 15 + 15). */
const ROLE_GRANTS: Readonly<Record<CanonicalRole, Grants>> = {
  employee: allAt(EMPLOYEE_FEED_PAIRS, "Company"),
  manager: { ...allAt(EMPLOYEE_FEED_PAIRS, "Company"), "view:feed-report": "Department" },
  hr: allAt(FEED_PAIRS, "Company"),
  "company-admin": allAt(FEED_PAIRS, "Company"),
  "payroll-officer": {},
  recruiter: {},
  "asset-manager": {},
  "office-admin": {},
  "hr-manager": {},
};

const ALL_CODES = Array.from({ length: 59 }, (_, i) => String(i + 1).padStart(3, "0"));

/** (iii) Route × vai — các mã bị TỪ CHỐI ở tầng 1; mã còn lại là cho phép (plan §3, «Kỳ vọng theo vai»). */
const EMPLOYEE_DENIED = [
  "006",
  "022",
  "028",
  "029",
  "046",
  "049",
  "050",
  "051",
  "052",
  "053",
  "056",
  "057",
  "058",
] as const;
const MANAGER_DENIED = [
  "006",
  "022",
  "029",
  "046",
  "049",
  "050",
  "051",
  "056",
  "057",
  "058",
] as const;
const DENIED_CODES: Readonly<Record<CanonicalRole, readonly string[]>> = {
  employee: EMPLOYEE_DENIED,
  manager: MANAGER_DENIED,
  hr: [],
  "company-admin": [],
  "payroll-officer": ALL_CODES,
  recruiter: ALL_CODES,
  "asset-manager": ALL_CODES,
  "office-admin": ALL_CODES,
  "hr-manager": ALL_CODES,
};

/** Ba route đọc được với grant hẹp hơn Company (API-19 §5.1: «Sàn scope Company; manager Department»). */
const NO_COMPANY_FLOOR: ReadonlySet<string> = new Set(["028", "052", "053"]);

const WITH_FEED = ["employee", "manager", "hr", "company-admin"] as const;
const ZERO_FEED = [
  "payroll-officer",
  "recruiter",
  "asset-manager",
  "office-admin",
  "hr-manager",
] as const;
const COMBOS = [
  ["payroll-officer", "employee"],
  ["recruiter", "employee"],
] as const;

const each = QA1_ROUTES.map((r) => [r.code, `${r.method} ${r.template}`, r] as const);
const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;
const isDenied = (role: CanonicalRole, code: string): boolean => DENIED_CODES[role].includes(code);

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L2 · 9 vai canonical × 59 route (DB cô lập)", () => {
  let w: Qa1World;
  let priv: Qa1Actor;
  const actors = new Map<string, Qa1Actor>();
  const slices = new Map<string, Qa1Slice>();
  /** Ô ĐÃ CHẠY THẬT: mã route → nhãn người gọi đã được cho phép / bị từ chối. */
  const ran = new Map<string, { allow: Set<string>; deny: Set<string> }>();

  const need = <T>(map: Map<string, T>, key: string): T => {
    const v = map.get(key);
    if (v === undefined) throw new Error(`thiếu fixture ${key}`);
    return v;
  };
  const mark = (code: string, who: string, kind: "allow" | "deny"): void => {
    const cell = ran.get(code) ?? { allow: new Set<string>(), deny: new Set<string>() };
    cell[kind].add(who);
    ran.set(code, cell);
  };

  /** Một ô của ma trận: cho phép ⇒ đúng mã `ok`; từ chối ⇒ 403 của guard tầng 1. */
  async function cell(
    who: string,
    route: Qa1Route,
    slice: Qa1Slice,
    token: string,
    denied: boolean,
  ): Promise<void> {
    const res = await callQa1Route(w, route, slice, token);
    if (denied) {
      expectGuardDenied(res, `${who} · ${route.code} ${route.template}`);
      mark(route.code, who, "deny");
    } else {
      expect(res.status, `${who} · ${route.code} ${route.template}: ${dump(res)}`).toBe(route.ok);
      mark(route.code, who, "allow");
    }
  }

  beforeAll(async () => {
    ensureQa1FileDoorEnv();
    w = await bootQa1World("qa1roles");
    priv = await w.actor(w.A, "priv", { pairs: FEED_PAIRS });

    for (const role of WITH_FEED) {
      const a = await w.actor(w.A, role.replace(/[^a-z]/g, ""), { canonical: role });
      actors.set(role, a);
      slices.set(role, await seedQa1Slice(w, w.A, a, { privileged: priv }));
    }
    for (const role of ZERO_FEED) {
      actors.set(role, await w.actor(w.A, role.replace(/[^a-z]/g, ""), { canonical: role }));
    }
    for (const combo of COMBOS) {
      const key = combo.join("+");
      const a = await w.actor(w.A, key.replace(/[^a-z]/g, ""), { canonical: combo });
      actors.set(key, a);
      slices.set(key, await seedQa1Slice(w, w.A, a, { privileged: priv }));
    }
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  // ══════════════ neo tĩnh — ba bảng tay khớp nhau ══════════════

  it("QA1-M-R-neo-bảng · bảng route × vai bằng đúng (cặp tầng 1 của route) × (cặp của vai), đủ 9 vai × 59 mã", () => {
    expect(QA1_ROUTES.map((r) => r.code)).toEqual(ALL_CODES);
    expect(Object.keys(DENIED_CODES).sort()).toEqual([...CANONICAL_ROLES].sort());
    expect(Object.keys(ROLE_GRANTS).sort()).toEqual([...CANONICAL_ROLES].sort());

    for (const role of CANONICAL_ROLES) {
      const derived = QA1_ROUTES.filter((r) => {
        const scope = ROLE_GRANTS[role][r.pair];
        if (scope === undefined) return true;
        return scope !== "Company" && !NO_COMPANY_FLOOR.has(r.code);
      }).map((r) => r.code);
      expect(derived, role).toEqual([...DENIED_CODES[role]]);
    }

    const count = (role: CanonicalRole): number => Object.keys(ROLE_GRANTS[role]).length;
    expect(WITH_FEED.map(count)).toEqual([7, 8, 15, 15]);
    expect(ZERO_FEED.map(count)).toEqual([0, 0, 0, 0, 0]);
    expect(59 - EMPLOYEE_DENIED.length).toBe(46);
    expect(59 - MANAGER_DENIED.length).toBe(49);

    // Mỗi route có ≥ 1 vai được phép và ≥ 1 vai bị từ chối NGAY TRONG BẢNG.
    for (const code of ALL_CODES) {
      expect(
        CANONICAL_ROLES.some((role) => !isDenied(role, code)),
        `${code} cho phép`,
      ).toBe(true);
      expect(
        CANONICAL_ROLES.some((role) => isDenied(role, code)),
        `${code} từ chối`,
      ).toBe(true);
    }
  });

  // ══════════════ /auth/me — tập cặp feed của từng vai ══════════════

  describe("me · `/auth/me` liệt kê đúng cặp feed của vai", () => {
    const expectMe = async (who: string, grants: Grants): Promise<void> => {
      const res = await w.get(need(actors, who).token, "/auth/me");
      expect(res.status, `${who}: ${JSON.stringify(res.body)}`).toBe(200);
      const me = (res.body as { data?: Json }).data ?? {};
      const capabilities = (me.capabilities ?? {}) as Record<string, unknown>;
      const scopes = (me.scopes ?? {}) as Record<string, unknown>;

      const held = FEED_PAIRS.filter((p) => capabilities[p] === true);
      expect([...held].sort(), who).toEqual(Object.keys(grants).sort());
      for (const pair of held) {
        expect(scopes[pair], `${who} · scope của ${pair}`).toEqual([grants[pair]]);
      }
      // Không cặp feed nào xuất hiện dưới dạng khoá scope mà vắng ở capabilities.
      const feedScopeKeys = Object.keys(scopes).filter((k) => /:feed(-|$)/.test(k));
      expect(feedScopeKeys.sort(), who).toEqual(Object.keys(grants).sort());
    };

    it.each(CANONICAL_ROLES)("QA1-M-R-me-%s", async (role) => {
      await expectMe(role, ROLE_GRANTS[role]);
    });

    it.each(COMBOS.map((c) => c.join("+")))(
      "QA1-M-R-me-%s · bằng đúng tập của employee",
      async (key) => {
        await expectMe(key, ROLE_GRANTS.employee);
      },
    );

    it("QA1-M-R-me-neo · số cặp feed theo vai là 7 / 8 / 15 / 15 và 0 cho năm vai còn lại", () => {
      expect(CANONICAL_ROLES.map((r) => Object.keys(ROLE_GRANTS[r]).length)).toEqual([
        7, 8, 15, 15, 0, 0, 0, 0, 0,
      ]);
    });
  });

  // ══════════════ bốn vai có cặp feed — mỗi vai một lát riêng ══════════════

  describe.each(WITH_FEED)("R · %s", (role) => {
    it.each(each)(`QA1-M-R-${role}-%s · %s`, async (code, _name, route) => {
      await cell(role, route, need(slices, role), need(actors, role).token, isDenied(role, code));
    });

    it(`QA1-M-R-${role}-002-news · đăng bài loại tin tức`, async () => {
      const res = await w
        .post(need(actors, role).token, "/social/posts")
        .send({ type: "news", audience: "company", body: `Tin của ${role}`, requiresAck: false });
      if (ROLE_GRANTS[role]["manage:feed-news"] === "Company") {
        expect(res.status, `${role}: ${dump(res)}`).toBe(201);
        expect((res.body.data as Json).type).toBe("news");
      } else {
        expectSocial(
          res,
          403,
          SOCIAL_ERR.NEWS_MANAGE_REQUIRED,
          SOCIAL_ERROR_CODES.NEWS_MANAGE_REQUIRED,
        );
      }
    });
  });

  // ══════════════ năm vai không cặp feed ══════════════

  describe("R · vai không giữ cặp feed nào", () => {
    it.each(ZERO_FEED)("QA1-M-R-%s-0cap · 403 tầng 1 trên cả 59 route", async (role) => {
      const token = need(actors, role).token;
      // Đối chứng: tài khoản dùng được (đăng nhập được, gọi được route ngoài SOCIAL).
      expect((await w.get(token, "/auth/me")).status, `${role} /auth/me`).toBe(200);

      const slice = need(slices, "employee");
      let denied = 0;
      for (const route of QA1_ROUTES) {
        await cell(role, route, slice, token, true);
        denied += 1;
      }
      expect(denied).toBe(59);
    });
  });

  // ══════════════ tổ hợp hai vai — «không thêm gì» ══════════════

  describe("R · tổ hợp với employee bằng đúng cột employee", () => {
    it.each(COMBOS.map((c) => c.join("+")))("QA1-M-R-%s", async (key) => {
      const token = need(actors, key).token;
      const slice = need(slices, key);
      let allowed = 0;
      let denied = 0;
      for (const route of QA1_ROUTES) {
        const deny = isDenied("employee", route.code);
        await cell(key, route, slice, token, deny);
        if (deny) denied += 1;
        else allowed += 1;
      }
      expect([allowed, denied]).toEqual([46, 13]);

      const news = await w
        .post(token, "/social/posts")
        .send({ type: "news", audience: "company", body: `Tin của ${key}`, requiresAck: false });
      expectSocial(
        news,
        403,
        SOCIAL_ERR.NEWS_MANAGE_REQUIRED,
        SOCIAL_ERROR_CODES.NEWS_MANAGE_REQUIRED,
      );
    });
  });

  // ══════════════ neo lúc chạy — chống rỗng của cả ma trận ══════════════

  it("QA1-M-R-neo-chạy · đủ 59 mã, mỗi route đã có ≥ 1 ô cho phép và ≥ 1 ô từ chối CHẠY THẬT (cần chạy trọn file)", () => {
    expect([...ran.keys()].sort()).toEqual(ALL_CODES);
    const thin: string[] = [];
    let cells = 0;
    for (const code of ALL_CODES) {
      const c = ran.get(code);
      cells += (c?.allow.size ?? 0) + (c?.deny.size ?? 0);
      // Song sinh của mọi ô từ chối: hai vai đủ cặp đều đã chạy đúng request đó ra mã thành công.
      if (!c || !c.allow.has("hr") || !c.allow.has("company-admin") || c.deny.size < 5) {
        thin.push(`${code}: allow=[${[...(c?.allow ?? [])].join(",")}] deny=${c?.deny.size ?? 0}`);
      }
    }
    expect(thin).toEqual([]);
    // 4 vai có feed + 5 vai không cặp + 2 tổ hợp = 11 người gọi × 59 route.
    expect(cells).toBe(11 * 59);
    const allowCells = [...ran.values()].reduce((n, c) => n + c.allow.size, 0);
    expect(allowCells).toBe(46 + 49 + 59 + 59 + 46 + 46);
  });
});
