/**
 * S16-SOCIAL-DASH-1 — hai widget Dashboard của SOCIAL trên ĐƯỜNG THẬT (HTTP → guard → registry / handler →
 * service nguồn của SOCIAL → DB lane). Plan `docs/plans/S16-SOCIAL-DASH-1.md` §5.1 · §5.2.
 *
 *   W1 `GET /dashboard/widgets/social-engagement-week` — SOCIAL_ENGAGEMENT_WEEK «Tương tác tuần»:
 *      cặp `view:feed-report` (route 052) · SÀN scope `Department`
 *   W2 `GET /dashboard/widgets/social-news-unacked` — SOCIAL_NEWS_UNACKED «Tin tức chưa đọc»:
 *      cặp `view:feed` (route 020) · SÀN scope `Company`
 *
 * BẢY ĐIỀU ĐƯỢC CHỨNG Ở ĐÂY (FE chỉ có cổng PHỤ theo cặp nên không chứng được điều nào):
 *  1. Mỗi widget mượn ĐÚNG cặp của route nguồn, không mượn chéo (S1 — đối xứng hai chiều).
 *  2. SÀN scope ép ở HAI tầng đọc CÙNG hằng: metadata (ME* · L*w) và data (D1b · D2b).
 *  3. CỔNG CHỒNG: nguồn SOCIAL cũng 403 khi thiếu cặp / dưới sàn ⇒ ca DENY assert NGUYÊN chuỗi thông điệp
 *     của cổng DASH. Chỉ assert status thì gỡ cổng DASH đi ca vẫn xanh (plan K16).
 *  4. Một công thức, một con số: mọi số của widget được đối chiếu với nguồn độc lập trong CÙNG lượt (hàng tuần
 *     hiện tại của `GET /social/stats/engagement` · `GET /social/news?countOnly=true`) VÀ với hằng tường minh.
 *     Test KHÔNG tự tính ranh tuần (ranh theo múi giờ công ty).
 *  5. KHÔNG cache (SOC-DEC-010): lượt gọi thứ hai không bao giờ hit, số đổi ngay; cả hai route widget gắn
 *     `Cache-Control: no-store` (C1 · C2 · H1c).
 *  6. Xoá mềm · ẩn · khôi phục đo trên widget THẬT (bàn giao O1 của S16-SOCIAL-QA-1): X1 · X2a · X2b.
 *  7. Cách ly người xem (I2) và cách ly công ty (T1).
 *
 * App dựng bằng `bootQa1World` (`applyMainPipeline` + `listen(0)`) — KHÔNG dựng tay (ratchet pipeline-parity).
 * CHỈ chạy trên DB cô lập của lane (`hasDb && LANE_DB`). Các ca chạy TUẦN TỰ và dùng chung trạng thái: ca đổi
 * dữ liệu (C* · I2 · X* · T1 · E2) đứng SAU các ca so với hằng tuyệt đối.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { hasDb } from "../helpers/integration-db";
import {
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import {
  ackPost,
  addComment,
  bootQa1World,
  newsPost,
  reactPost,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1Made,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

const W1 = "/dashboard/widgets/social-engagement-week";
const W2 = "/dashboard/widgets/social-news-unacked";
const CODE_1 = "SOCIAL_ENGAGEMENT_WEEK";
const CODE_2 = "SOCIAL_NEWS_UNACKED";

/** Thông điệp 403 của CỔNG DASH — phân biệt «thiếu cặp» với «dưới sàn», và với chuỗi của nguồn SOCIAL. */
const FORBIDDEN_CODE = "AUTH-ERR-FORBIDDEN";
const DENY_PAIR_1 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report";
const DENY_FLOOR_1 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report ở phạm vi đủ rộng";
const DENY_PAIR_2 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed";
const DENY_FLOOR_2 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed ở phạm vi đủ rộng";

const EMPTY_1 = "Tuần này chưa có tương tác nào trong phạm vi của bạn";
const EMPTY_2 = "Bạn đã xác nhận hết các tin cần đọc";

const WEEK_KEYS = ["activeMembers", "comments", "posts", "reactions", "weekStart"];
const ZERO_WEEK = { posts: 0, comments: 0, reactions: 0, activeMembers: 0 } as const;

/**
 * SỐ KỲ VỌNG TƯỜNG MINH của công ty A ngay sau `beforeAll` (xem khối gieo):
 *   bài = 2 (emp) + 1 (emp2) + 4 tin của hr = 7 · bình luận = mgr + emp = 2 · cảm xúc = emp + mgr = 2 ·
 *   người hoạt động = emp · emp2 · mgr · hr = 4.
 * Đơn vị U1 (emp + mgr) — sự kiện quy theo NGƯỜI TẠO: 2 bài · 2 bình luận · 2 cảm xúc · 2 người.
 */
const COMPANY_WEEK = { posts: 7, comments: 2, reactions: 2, activeMembers: 4 } as const;
const UNIT1_WEEK = { posts: 2, comments: 2, reactions: 2, activeMembers: 2 } as const;
/** 3 tin `requiresAck` (tin thứ tư KHÔNG yêu cầu xác nhận ⇒ không được đếm). */
const NEWS_REQUIRING_ACK = 3;
/** Phần của bài đích X1 trong số liệu tuần: 1 bài · 1 bình luận · 2 cảm xúc. */
const X_POST_SHARE = { posts: 1, comments: 1, reactions: 2 } as const;
/** Công ty B sau T1: 1 bài chia sẻ + 1 tin `requiresAck`, cùng một người đăng. */
const B_WEEK = { posts: 2, comments: 0, reactions: 0, activeMembers: 1 } as const;

type Scope = "Own" | "Team" | "Department" | "Company";
type Grant = readonly [pair: string, scope: Scope];

/** Hai cặp nền của Dashboard — vai tuỳ biến phải tự gắn (plan M4): qua guard của route + loại `Employee`. */
const DASH_BASE: readonly Grant[] = [
  ["read:dashboard", "Company"],
  ["view-employee:dashboard", "Own"],
];

/** Người xem tối thiểu — `Qa1Actor` của kit thoả cấu trúc này. */
interface Viewer {
  token: string;
  userId: string;
  label: string;
}

interface Week {
  weekStart: string;
  posts: number;
  comments: number;
  reactions: number;
  activeMembers: number;
}

interface WidgetBody {
  widget_code: string;
  status: string;
  data: Json | null;
  empty_state: Json | null;
  error_state: Json | null;
  last_updated_at: string | null;
  cache: { hit: boolean; ttl_seconds: number; expires_at: string } | null;
}

interface WidgetRead {
  body: WidgetBody;
  cacheControl: string | undefined;
}

interface CatalogItem {
  widget_code: string;
  status?: string;
  data?: unknown;
  cache?: { hit: boolean; ttl_seconds: number } | null;
}

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
const counts = ({ posts, comments, reactions, activeMembers }: Week) => ({
  posts,
  comments,
  reactions,
  activeMembers,
});

/**
 * Vai TUỲ BIẾN cho Dashboard (bộ kit QA-1 đã đóng băng và hàng rào cặp của nó không nhận cặp `dashboard`).
 * Cặp quyền CHỈ ĐƯỢC TRA trong catalog `permissions` (toàn cục, `cleanupTenants` không dọn) — thiếu ⇒ ném,
 * không bao giờ INSERT. Đăng nhập SAU khi gắn quyền.
 */
async function dashActor(
  w: Qa1World,
  login: { password: string; passwordHash: string },
  tenant: SeededTenant,
  label: string,
  grants: readonly Grant[],
): Promise<Viewer> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${tenant.slug}.test`.toLowerCase();
  const userId = await seedUser(w.direct, tenant.companyId, email, login.passwordHash);
  const roleId = await seedRole(w.direct, tenant.companyId, `dash1-${label}-${userId.slice(0, 8)}`);
  for (const [pair, scope] of [...DASH_BASE, ...grants]) {
    const [action, resource] = pair.split(":") as [string, string];
    const found = await w.direct.query<{ id: string }>(
      `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2`,
      [action, resource],
    );
    if (found.rows.length !== 1) {
      throw new Error(`[dash1] catalog thiếu cặp ${pair} (${found.rows.length} hàng)`);
    }
    await seedRolePermission(w.direct, roleId, found.rows[0].id, "ALLOW", scope);
  }
  await seedUserRole(w.direct, userId, roleId, tenant.companyId);

  const body = { companySlug: tenant.slug, email, password: login.password };
  const res = await w.post(null, "/auth/login").send(body);
  if (res.status !== 200) {
    throw new Error(`[dash1] login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.data.accessToken as string, userId, label };
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-DASH-1 · 2 widget DASH của SOCIAL (đường thật)", () => {
  let w: Qa1World;

  // Vai canonical (hàng `roles.company_id IS NULL`):
  //   emp · emp2   nhân viên đơn vị U1 · U2 — `view:feed`@Company, KHÔNG có `view:feed-report`
  //   mgr          quản lý đơn vị U1 — `view:feed-report`@Department
  //   mgrNoUnit    quản lý không thuộc / không đứng đầu đơn vị nào (E1b, quyết định O4 = A)
  //   hr           `view:feed-report`@Company — tác giả 4 tin, có quyền kiểm duyệt
  //   admin        company-admin — người xoá / ẩn / khôi phục KHÁC tác giả
  //   bHr          hr của công ty B
  let emp: Qa1Actor;
  let emp2: Qa1Actor;
  let mgr: Qa1Actor;
  let mgrNoUnit: Qa1Actor;
  let hr: Qa1Actor;
  let admin: Qa1Actor;
  let bHr: Qa1Actor;

  // Vai tuỳ biến (đều rơi về dashboard loại `Employee`):
  //   repOwn · repTeam   `view:feed`@Company + `view:feed-report`@Own · @Team — dưới sàn của 001
  //   onlyReport         `view:feed-report`@Company, KHÔNG có `view:feed`
  //   feedDept           `view:feed`@Department — dưới sàn của 002
  //   bare               không cặp feed nào
  let repOwn: Viewer;
  let repTeam: Viewer;
  let onlyReport: Viewer;
  let feedDept: Viewer;
  let bare: Viewer;

  let s2: Qa1Made;
  /** Bài của emp2 mang đúng 1 bình luận + 2 cảm xúc — đích của X1. */
  let xPost: Qa1Made;
  let n1: Qa1Made;
  let n2: Qa1Made;
  let n3: Qa1Made;

  const get = (who: Viewer, url: string) => w.get(who.token, url);

  /** Gọi một route widget, đòi 200; trả thân + header `Cache-Control`. */
  const widgetOk = async (who: Viewer, url: string): Promise<WidgetRead> => {
    const res = await get(who, url);
    expect(res.status, `${who.label} ${url} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const cacheControl = res.headers["cache-control"] as string | undefined;
    return { body: res.body.data as WidgetBody, cacheControl };
  };

  /** Hàng TUẦN HIỆN TẠI của 052 cho CHÍNH người xem — nguồn độc lập của W1. */
  const sourceWeek = async (who: Viewer): Promise<Week> => {
    const res = await get(who, "/social/stats/engagement");
    expect(res.status, `052 ${who.label} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const totals = (dataOf(res.body).weekTotals ?? []) as Week[];
    expect(totals.length, "052 phải trả ít nhất một hàng tuần").toBeGreaterThan(0);
    return totals[totals.length - 1];
  };

  /** `unackedCount` của 020 (`countOnly`) cho CHÍNH người xem — nguồn độc lập của W2. */
  const sourceUnacked = async (who: Viewer): Promise<number> => {
    const res = await get(who, "/social/news?countOnly=true");
    expect(res.status, `020 ${who.label} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const count = dataOf(res.body).unackedCount;
    expect(typeof count, "020 countOnly phải trả số").toBe("number");
    return count as number;
  };

  /** W1 của `who` (phải `Active`) — payload đối chiếu NGUYÊN với hàng tuần hiện tại của 052. */
  const week = async (who: Viewer): Promise<Week> => {
    const { body } = await widgetOk(who, W1);
    expect(body.status, `W1 ${who.label}`).toBe("Active");
    expect(body.data, `W1 ${who.label} == 052`).toEqual(await sourceWeek(who));
    return body.data as unknown as Week;
  };

  /** W2 của `who` (phải `Active`) — `total` đối chiếu với `unackedCount` của 020. */
  const unacked = async (who: Viewer): Promise<number> => {
    const { body } = await widgetOk(who, W2);
    expect(body.status, `W2 ${who.label}`).toBe("Active");
    const total = (body.data as { total?: unknown } | null)?.total;
    expect(total, `W2 ${who.label} == 020`).toBe(await sourceUnacked(who));
    return total as number;
  };

  /** 403 của CỔNG DASH: mã chung + NGUYÊN chuỗi thông điệp (`toBe`, không `toContain` — plan K16). */
  const expectDenied = (res: Qa1Res, message: string, what: string): void => {
    expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body.error?.code, what).toBe(FORBIDDEN_CODE);
    expect(res.body.error?.message, what).toBe(message);
  };

  /** Lượt đọc KHÔNG cache: `Active`, không hit, TTL 0 (hết hạn ngay lúc sinh), header `no-store`. */
  const expectUncached = (read: WidgetRead): void => {
    expect(read.body.status).toBe("Active");
    expect(read.body.last_updated_at).toEqual(expect.any(String));
    const expiresAt = read.body.last_updated_at;
    expect(read.body.cache).toEqual({ hit: false, ttl_seconds: 0, expires_at: expiresAt });
    expect(read.cacheControl).toBe("no-store");
  };

  const meOf = async (who: Viewer): Promise<{ type: string; codes: string[] }> => {
    const res = await get(who, "/dashboard/me");
    expect(res.status, `/dashboard/me ${who.label} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const data = res.body.data as { dashboard_type: string; widgets: CatalogItem[] };
    return { type: data.dashboard_type, codes: data.widgets.map((x) => x.widget_code) };
  };

  const catalogOf = async (who: Viewer): Promise<string[]> => {
    const res = await get(who, "/dashboard/widgets");
    expect(res.status, `/dashboard/widgets ${who.label} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    return (res.body.data as CatalogItem[]).map((x) => x.widget_code);
  };

  const deletePost = async (by: Qa1Actor, postId: string): Promise<void> => {
    const res = await w.del(by.token, `/social/posts/${postId}`);
    expect(res.status, `005 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    expect(dataOf(res.body)).toEqual({ deleted: true });
  };

  const restorePost = async (by: Qa1Actor, postId: string): Promise<string> => {
    const res = await w.post(by.token, `/recycle-bin/feed-posts/${postId}/restore`);
    expect(res.status, `058 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    expect(dataOf(res.body).id).toBe(postId);
    return dataOf(res.body).status as string;
  };

  const setHidden = async (by: Qa1Actor, postId: string, hidden: boolean): Promise<void> => {
    const res = await w.patch(by.token, `/social/posts/${postId}/moderation`).send({ hidden });
    expect(res.status, `006 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
  };

  /** Chạy seeder default config THẬT của app cho một công ty (NODE_ENV=test không tự seed lúc boot). */
  const reconcileDashConfigs = async (companyId: string): Promise<void> => {
    const seeders = [w.app.get(DashboardConfigSeeder)];
    const outcomes = await w.app.get(MasterDataSeedRunner).reconcileCompany(companyId, seeders);
    expect(outcomes, `seeder dash.default-configs của ${companyId}`).toEqual([
      expect.objectContaining({ seedKey: "dash.default-configs", ok: true }),
    ]);
  };

  beforeAll(async () => {
    w = await bootQa1World("dash1");
    const u1 = await w.orgUnit(w.A, "dash1-u1");
    const u2 = await w.orgUnit(w.A, "dash1-u2");

    emp = await w.actor(w.A, "emp", { canonical: "employee", orgUnitId: u1 });
    emp2 = await w.actor(w.A, "emp2", { canonical: "employee", orgUnitId: u2 });
    mgr = await w.actor(w.A, "mgr", { canonical: "manager", orgUnitId: u1 });
    mgrNoUnit = await w.actor(w.A, "mgrnounit", { canonical: "manager" });
    hr = await w.actor(w.A, "hr", { canonical: "hr" });
    admin = await w.actor(w.A, "admin", { canonical: "company-admin" });
    bHr = await w.actor(w.B, "bhr", { canonical: "hr" });

    const password = loginPasswordFixture("dash1social");
    const login = { password, passwordHash: await w.app.get(PasswordService).hash(password) };
    const custom = (label: string, ...grants: Grant[]) => dashActor(w, login, w.A, label, grants);
    repOwn = await custom("repown", ["view:feed", "Company"], ["view:feed-report", "Own"]);
    repTeam = await custom("repteam", ["view:feed", "Company"], ["view:feed-report", "Team"]);
    onlyReport = await custom("onlyreport", ["view:feed-report", "Company"]);
    feedDept = await custom("feeddept", ["view:feed", "Department"]);
    bare = await custom("bare");

    // Gieo QUA ROUTE (cột đếm · thẻ · outbox chỉ đúng khi đi qua route). Số: xem COMPANY_WEEK / UNIT1_WEEK.
    const s1 = await sharePost(w, emp);
    s2 = await sharePost(w, emp);
    xPost = await sharePost(w, emp2);
    await addComment(w, mgr, s1.id);
    await addComment(w, emp, xPost.id);
    await reactPost(w, emp, xPost.id);
    await reactPost(w, mgr, xPost.id, "love");
    await newsPost(w, hr, { requiresAck: false });
    n1 = await newsPost(w, hr, { requiresAck: true });
    n2 = await newsPost(w, hr, { requiresAck: true });
    n3 = await newsPost(w, hr, { requiresAck: true });
    // Công ty B: KHÔNG gieo gì trước T1 ⇒ E1 đo được trạng thái rỗng.

    for (const companyId of w.companyIds) await reconcileDashConfigs(companyId);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (!w) return;
    const companyIds = [...w.companyIds];
    try {
      const sql = "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])";
      await w.direct.query(sql, [companyIds]);
    } finally {
      await w.close();
    }
  });

  describe("W1 «Tương tác tuần» — tầng DATA", () => {
    it("A1 · ALLOW hr @Company: `Active`, đúng 5 khoá, số = hằng toàn công ty = hàng tuần cuối của 052", async () => {
      const { body } = await widgetOk(hr, W1);
      expect(body.widget_code).toBe(CODE_1);
      expect(body.status).toBe("Active");
      expect(Object.keys(body.data ?? {}).sort()).toEqual(WEEK_KEYS);
      expect(counts(body.data as unknown as Week)).toEqual(COMPANY_WEEK);
      expect(body.data).toEqual(await sourceWeek(hr));
      expect(body.cache).toMatchObject({ hit: false, ttl_seconds: 0 });
    });

    it("D1a · DENY emp (thiếu cặp `view:feed-report`): 403 + thông điệp «thiếu quyền» của cổng DASH", async () => {
      // Đối chứng cùng ca: route + slug đang sống với người có cặp.
      expect((await get(hr, W1)).status).toBe(200);
      expectDenied(await get(emp, W1), DENY_PAIR_1, "emp gọi W1");
    });

    it("A1m · ALLOW mgr @Department: số = phần của đơn vị U1 (nhỏ hơn toàn công ty) = 052 của chính mgr", async () => {
      const mine = await week(mgr);
      expect(counts(mine)).toEqual(UNIT1_WEEK);
      expect(mine.posts).toBeLessThan(COMPANY_WEEK.posts);
    });

    it.each(["repOwn", "repTeam"] as const)(
      "D1b · DENY %s (CÓ cặp, scope dưới sàn `Department`): 403 «ở phạm vi đủ rộng»",
      async (name) => {
        // Đối chứng cùng ca: cùng cặp, scope `Department` thì qua.
        expect((await get(mgr, W1)).status).toBe(200);
        expectDenied(await get({ repOwn, repTeam }[name], W1), DENY_FLOOR_1, `${name} gọi W1`);
      },
    );

    it("E1 · công ty B chưa có hoạt động: 200 `Empty`, `data` null, chữ rỗng do server gửi", async () => {
      const { body } = await widgetOk(bHr, W1);
      expect(body.status).toBe("Empty");
      expect(body.data).toBeNull();
      expect(body.empty_state).toEqual({ message: EMPTY_1 });
      expect(counts(await sourceWeek(bHr)), "nguồn của B cũng bằng 0").toEqual(ZERO_WEEK);
    });

    it("E1b · quản lý không thuộc đơn vị nào (O4 = A): 200 `Empty` — không 403, không lỗi", async () => {
      // Đối chứng: công ty A ĐANG có hoạt động — ô rỗng là do PHẠM VI của người xem, không do thiếu dữ liệu.
      expect((await week(hr)).posts).toBeGreaterThan(0);
      const { body } = await widgetOk(mgrNoUnit, W1);
      expect(body.status).toBe("Empty");
      expect(body.data).toBeNull();
      expect(body.error_state).toBeNull();
      expect(body.empty_state).toEqual({ message: EMPTY_1 });
    });
  });

  describe("W2 «Tin tức chưa đọc» — tầng DATA", () => {
    it("A2 · ALLOW emp: `Active`, payload CHỈ có `total` = hằng = `unackedCount` của 020", async () => {
      const { body } = await widgetOk(emp, W2);
      expect(body.widget_code).toBe(CODE_2);
      expect(body.status).toBe("Active");
      expect(Object.keys(body.data ?? {})).toEqual(["total"]);
      expect(body.data).toEqual({ total: NEWS_REQUIRING_ACK });
      expect(await sourceUnacked(emp)).toBe(NEWS_REQUIRING_ACK);
      expect(body.cache).toMatchObject({ hit: false, ttl_seconds: 0 });
    });

    it("D2a · DENY bare (không cặp feed nào): 403 + thông điệp «thiếu quyền view:feed» của cổng DASH", async () => {
      expect((await get(emp, W2)).status).toBe(200);
      expectDenied(await get(bare, W2), DENY_PAIR_2, "bare gọi W2");
    });

    it("D2b · DENY feedDept (`view:feed`@Department, dưới sàn `Company`): 403 «ở phạm vi đủ rộng», KHÔNG phải chuỗi của nguồn", async () => {
      expect((await get(emp, W2)).status).toBe(200);
      expectDenied(await get(feedDept, W2), DENY_FLOOR_2, "feedDept gọi W2");
    });
  });

  describe("mỗi widget một cặp RIÊNG", () => {
    it("S1 · đối xứng: chỉ `view:feed-report` ⇒ W1 200 · W2 403; chỉ `view:feed` ⇒ W2 200 · W1 403", async () => {
      const company = counts(await week(hr));
      expect(counts(await week(onlyReport)), "onlyReport @Company thấy số toàn công ty").toEqual(
        company,
      );
      expectDenied(await get(onlyReport, W2), DENY_PAIR_2, "onlyReport gọi W2");

      expect(await unacked(emp)).toBe(NEWS_REQUIRING_ACK);
      expectDenied(await get(emp, W1), DENY_PAIR_1, "emp gọi W1");
    });
  });

  describe("tầng METADATA — cùng cặp + cùng hằng sàn với tầng DATA", () => {
    it("ME1 · /dashboard/me: 001 CÓ ở hr · mgr · onlyReport — VẮNG ở emp (thiếu cặp) · repOwn (dưới sàn)", async () => {
      expect((await meOf(hr)).codes).toContain(CODE_1);
      expect((await meOf(mgr)).codes).toContain(CODE_1);

      // Ba người CÙNG loại dashboard `Employee`, cùng config ⇒ khác nhau chỉ ở cặp / scope của grant.
      const only = await meOf(onlyReport);
      const own = await meOf(repOwn);
      const employee = await meOf(emp);
      expect([only.type, own.type, employee.type]).toEqual(["Employee", "Employee", "Employee"]);
      expect(only.codes).toContain(CODE_1);
      // Vế VẮNG đứng cạnh vế CÓ trong CÙNG response (mã 002) — không assert trên danh sách rỗng.
      expect(own.codes).toContain(CODE_2);
      expect(own.codes).not.toContain(CODE_1);
      expect(employee.codes).toContain(CODE_2);
      expect(employee.codes).not.toContain(CODE_1);
    });

    it("L1w · /dashboard/widgets: cùng ma trận với ME1", async () => {
      expect(await catalogOf(hr)).toContain(CODE_1);
      expect(await catalogOf(mgr)).toContain(CODE_1);
      expect(await catalogOf(onlyReport)).toContain(CODE_1);
      const own = await catalogOf(repOwn);
      expect(own).toContain(CODE_2);
      expect(own).not.toContain(CODE_1);
      const employee = await catalogOf(emp);
      expect(employee).toContain(CODE_2);
      expect(employee).not.toContain(CODE_1);
    });

    it("ME2 · /dashboard/me: 002 CÓ ở emp · repOwn — VẮNG ở bare (thiếu cặp) · feedDept (dưới sàn) · onlyReport (cặp của widget anh em)", async () => {
      const seen = { emp: await meOf(emp), repOwn: await meOf(repOwn) };
      const hidden = { bare: await meOf(bare), feedDept: await meOf(feedDept) };
      const only = await meOf(onlyReport);
      // Cả năm người CÙNG loại dashboard, cùng config ⇒ vế VẮNG có vế CÓ đứng cạnh.
      const types = [seen.emp, seen.repOwn, hidden.bare, hidden.feedDept, only].map((x) => x.type);
      expect(new Set(types)).toEqual(new Set(["Employee"]));
      expect(seen.emp.codes).toContain(CODE_2);
      expect(seen.repOwn.codes).toContain(CODE_2);
      expect(hidden.bare.codes).not.toContain(CODE_2);
      expect(hidden.feedDept.codes).not.toContain(CODE_2);
      expect(only.codes).toContain(CODE_1);
      expect(only.codes).not.toContain(CODE_2);
    });

    it("L2w · /dashboard/widgets: cùng ma trận với ME2", async () => {
      expect(await catalogOf(emp)).toContain(CODE_2);
      expect(await catalogOf(repOwn)).toContain(CODE_2);
      expect(await catalogOf(bare)).not.toContain(CODE_2);
      expect(await catalogOf(feedDept)).not.toContain(CODE_2);
      const only = await catalogOf(onlyReport);
      expect(only).toContain(CODE_1);
      expect(only).not.toContain(CODE_2);
    });
  });

  describe("KHÔNG cache (SOC-DEC-010) — TTL 0 + `Cache-Control: no-store`", () => {
    it("C1 · 001: đăng thêm một bài giữa hai lượt gọi ⇒ lượt hai +1 bài, cả hai lượt `hit: false`", async () => {
      const first = await widgetOk(hr, W1);
      await sharePost(w, emp);
      const second = await widgetOk(hr, W1);

      expectUncached(first);
      expectUncached(second);
      const before = first.body.data as unknown as Week;
      const after = second.body.data as unknown as Week;
      expect(after.posts).toBe(before.posts + 1);
      expect(after).toEqual(await sourceWeek(hr));
    });

    it("C2 · 002: xác nhận một tin (021) giữa hai lượt gọi ⇒ lượt hai giảm đúng 1, `hit: false`", async () => {
      const first = await widgetOk(emp, W2);
      await ackPost(w, emp, n1.id);
      const second = await widgetOk(emp, W2);

      expectUncached(first);
      expectUncached(second);
      expect(first.body.data).toEqual({ total: NEWS_REQUIRING_ACK });
      expect(second.body.data).toEqual({ total: NEWS_REQUIRING_ACK - 1 });
      expect(await sourceUnacked(emp)).toBe(NEWS_REQUIRING_ACK - 1);
    });

    it("I2 · cách ly người xem: emp xác nhận không đổi số của emp2 và hr; hr tự xác nhận chỉ đổi số của hr", async () => {
      expect(await unacked(emp)).toBe(NEWS_REQUIRING_ACK - 1);
      expect(await unacked(emp2)).toBe(NEWS_REQUIRING_ACK);
      // Hành vi sẵn có của 020 (ghim): tác giả cũng đếm tin của chính mình cho tới khi tự xác nhận.
      expect(await unacked(hr)).toBe(NEWS_REQUIRING_ACK);

      await ackPost(w, hr, n1.id);
      expect(await unacked(hr)).toBe(NEWS_REQUIRING_ACK - 1);
      expect(await unacked(emp2)).toBe(NEWS_REQUIRING_ACK);
    });

    it("H1c · `GET /dashboard/widgets?include_data=true` cũng chở số của hai widget ⇒ cùng `no-store`", async () => {
      const res = await get(hr, "/dashboard/widgets?include_data=true");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");

      const items = res.body.data as CatalogItem[];
      const uncached = { status: "Active", cache: { hit: false, ttl_seconds: 0 } };
      const one = items.find((x) => x.widget_code === CODE_1);
      expect(one, `thiếu ${CODE_1}`).toMatchObject(uncached);
      expect(one?.data).toEqual(await sourceWeek(hr));
      const two = items.find((x) => x.widget_code === CODE_2);
      expect(two, `thiếu ${CODE_2}`).toMatchObject(uncached);
      expect(two?.data).toEqual({ total: await sourceUnacked(hr) });
    }, 60_000);
  });

  describe("xoá mềm · ẩn · khôi phục trên widget THẬT (bàn giao O1 của S16-SOCIAL-QA-1)", () => {
    it("X1 · 001: xoá bài (005) ⇒ −1 bài · −1 bình luận · −2 cảm xúc; ẩn bài khác (006) ⇒ không đổi; khôi phục (058) ⇒ như trước", async () => {
      const before = await week(hr);

      await deletePost(admin, xPost.id);
      const afterDelete = await week(hr);
      expect(counts(afterDelete)).toMatchObject({
        posts: before.posts - X_POST_SHARE.posts,
        comments: before.comments - X_POST_SHARE.comments,
        reactions: before.reactions - X_POST_SHARE.reactions,
      });

      // Bài ẨN vẫn tính vào số liệu tuần. Neo: người thường (không phải tác giả) thật sự hết thấy bài.
      await setHidden(admin, s2.id, true);
      expect((await get(emp2, `/social/posts/${s2.id}`)).status).toBe(404);
      expect(await week(hr), "ẩn bài KHÁC không đổi số").toEqual(afterDelete);
      await setHidden(admin, s2.id, false);

      // Người xoá KHÁC tác giả ⇒ 058 trả bài về `published` ⇒ số về như trước.
      expect(await restorePost(admin, xPost.id)).toBe("published");
      expect(await week(hr), "sau khôi phục").toEqual(before);
    }, 60_000);

    it("X2a · 002: người KHÁC tác giả xoá một tin ⇒ −1; khôi phục (058) trả `published` ⇒ +1", async () => {
      const before = await unacked(emp);

      await deletePost(admin, n2.id);
      expect(await unacked(emp)).toBe(before - 1);

      expect(await restorePost(admin, n2.id)).toBe("published");
      expect(await unacked(emp)).toBe(before);
    }, 60_000);

    it("X2b · 002: TÁC GIẢ tự xoá ⇒ −1; khôi phục trả `hidden` ⇒ VẪN −1; bỏ ẩn (006) ⇒ +1. Ẩn một tin `published` ⇒ người thường −1, tác giả không đổi", async () => {
      const before = await unacked(emp);

      await deletePost(hr, n3.id);
      expect(await unacked(emp)).toBe(before - 1);
      // Luật O4 của BE-3C: tác giả tự xoá ⇒ khôi phục về `hidden`, nằm ngoài tầm nhìn người thường.
      expect(await restorePost(admin, n3.id)).toBe("hidden");
      expect(await unacked(emp), "bài về `hidden` chưa quay lại số của người thường").toBe(
        before - 1,
      );
      await setHidden(hr, n3.id, false);
      expect(await unacked(emp)).toBe(before);

      // Vế ẩn / hiện RIÊNG trên một tin đang `published`.
      const authorBefore = await unacked(hr);
      await setHidden(admin, n2.id, true);
      expect(await unacked(emp)).toBe(before - 1);
      expect(await unacked(hr), "tác giả vẫn đếm tin đang ẩn của mình").toBe(authorBefore);
      await setHidden(admin, n2.id, false);
      expect(await unacked(emp)).toBe(before);
    }, 60_000);
  });

  describe("cách ly công ty + trạng thái rỗng của W2", () => {
    it("T1 · bài + tin đăng ở công ty B không đổi số của A; B chỉ thấy số của B", async () => {
      const hrBefore = await week(hr);
      const empBefore = await unacked(emp);

      await sharePost(w, bHr);
      await newsPost(w, bHr, { requiresAck: true });

      expect(await week(hr), "W1 của A").toEqual(hrBefore);
      expect(await unacked(emp), "W2 của A").toBe(empBefore);
      // Số của B là số TƯỜNG MINH của riêng B — khác hẳn số của A ở trên.
      expect(counts(await week(bHr))).toEqual(B_WEEK);
      expect(hrBefore.posts).toBeGreaterThan(B_WEEK.posts);
      expect(await unacked(bHr)).toBe(1);
    }, 60_000);

    it("E2 · emp xác nhận hết ⇒ W2 `Empty`, `data` null, chữ rỗng do server gửi", async () => {
      // Đối chứng: ngay trước đó widget còn `Active` với số dương.
      expect(await unacked(emp)).toBe(NEWS_REQUIRING_ACK - 1);
      await ackPost(w, emp, n2.id);
      await ackPost(w, emp, n3.id);

      const { body } = await widgetOk(emp, W2);
      expect(body.status).toBe("Empty");
      expect(body.data).toBeNull();
      expect(body.empty_state).toEqual({ message: EMPTY_2 });
      expect(await sourceUnacked(emp)).toBe(0);
      // Người khác không bị kéo về rỗng theo.
      expect(await unacked(emp2)).toBe(NEWS_REQUIRING_ACK);
    });
  });

  describe("seeder default config", () => {
    it("Z1 · seeder `v7`: 8 hàng config của hai mã (4 loại × 2) @130 / @140; chạy lại không thêm hàng", async () => {
      expect(w.app.get(DashboardConfigSeeder).seedVersion).toBe("v7");

      const configs = async () => {
        const res = await w.direct.query<{ code: string; type: string; sort: number }>(
          `SELECT d.widget_code AS code, c.dashboard_type AS type, c.sort_order AS sort
             FROM dashboard_widget_configs c
             JOIN dashboard_widgets d ON d.id = c.widget_id
            WHERE c.company_id = $1 AND c.deleted_at IS NULL
              AND c.config_scope = 'Company' AND c.is_enabled
            ORDER BY d.widget_code, c.dashboard_type`,
          [w.A.companyId],
        );
        return res.rows;
      };
      const types = ["Admin", "Employee", "HR", "Manager"];
      const first = await configs();
      expect(first.filter((r) => r.code.startsWith("SOCIAL_"))).toEqual([
        ...types.map((type) => ({ code: CODE_1, type, sort: 130 })),
        ...types.map((type) => ({ code: CODE_2, type, sort: 140 })),
      ]);

      await reconcileDashConfigs(w.A.companyId);
      expect((await configs()).length, "lượt seed thứ hai không thêm hàng").toBe(first.length);
    });
  });
});
