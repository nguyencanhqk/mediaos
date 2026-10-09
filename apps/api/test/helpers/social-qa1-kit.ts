import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import "reflect-metadata";
import type { SocialErrorCode } from "@mediaos/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { expect } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import type { SocialErrorMessage } from "../../src/social/social.errors";
import { applyMainPipeline } from "./bootstrap-app";
import { loginPasswordFixture } from "./fixture-secrets";
import { directPool } from "./integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "./seed";

/**
 * S16-SOCIAL-QA-1 (L0) — BỘ ĐỒ NGHỀ QA SOCIAL (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L0, D1 · D5 · D7 · D13).
 *
 * ĐÓNG BĂNG sau L0: tám lát sau KHÔNG sửa file này (kể cả thêm hàm) — cần thêm tiện ích thì đặt trong
 * spec của lát hoặc file helper mới mang tên lát. Phần đua + PRNG ở `social-qa1-kit-race.ts`; đối soát
 * 7 cột đếm ở `social-qa1-kit-counters.ts` (cùng đóng băng).
 *
 * Helper TỰ CHỨA (luật `supertest-listen-ratchet`): app do CHÍNH file này dựng, `init()` + `listen(0)`
 * + `close()`; mọi request trao ra đều tới server đang nghe.
 *
 * Luật dữ liệu: mọi tên / email / mã mang hậu tố ngẫu nhiên theo lượt (hai lane DB chạy song song, CI
 * chạy mọi file trên MỘT DB); mọi phép đếm chỉ trong công ty do `bootQa1World` tạo.
 */

export type Json = Record<string, unknown>;
export type Qa1Scope = "Own" | "Team" | "Department" | "Company";

/** 15 cặp `feed*` của catalog (14 ở mig 0578 + `restore:feed-post` ở mig 0590) — LITERAL, không đọc từ sản phẩm. */
export const FEED_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "create:feed-poll",
  "create:feed-idea",
  "create:feed-kudos",
  "create:feed-group",
  "manage:feed-news",
  "manage:feed-post",
  "manage:feed-group",
  "manage:feed-kudos",
  "manage:feed-report",
  "approve:feed-idea",
  "view:feed-report",
  "restore:feed-post",
] as const;
export type FeedPair = (typeof FEED_PAIRS)[number];

/** Cặp NGOÀI feed được phép gắn (D13): tín hiệu sẵn sàng của socket + cửa tệp. */
export const QA1_EXTRA_PAIRS = [
  "view:chat-room",
  "view:foundation-file",
  "download:foundation-file",
] as const;
export type Qa1Pair = FeedPair | (typeof QA1_EXTRA_PAIRS)[number];

/** 7 cặp của vai `employee` theo `docs/permission-matrix-spec.md:707-713` — tiện cho actor «nhân viên» tuỳ biến. */
export const EMPLOYEE_FEED_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "create:feed-poll",
  "create:feed-idea",
  "create:feed-kudos",
  "create:feed-group",
] as const satisfies readonly FeedPair[];

/** 9 vai canonical đưa vào ma trận (D20); hàng vai hệ thống `company_id IS NULL`. */
export const CANONICAL_ROLES = [
  "employee",
  "manager",
  "hr",
  "company-admin",
  "payroll-officer",
  "recruiter",
  "asset-manager",
  "office-admin",
  "hr-manager",
] as const;
export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

const ALLOWED_PAIRS: ReadonlySet<string> = new Set<string>([...FEED_PAIRS, ...QA1_EXTRA_PAIRS]);
const QA1_SCOPES: ReadonlySet<string> = new Set<string>(["Own", "Team", "Department", "Company"]);

/**
 * HÀNG RÀO cặp quyền (D13) — ném nếu có key ngoài 15 cặp `feed*` + 3 cặp ngoài feed cho phép.
 * Thuần (không chạm DB): `actor()` gọi nó TRƯỚC mọi câu SQL, nên một key gõ sai / wildcard không bao
 * giờ tới được catalog `permissions` toàn cục.
 */
export function assertQa1PairKeys(keys: readonly string[]): asserts keys is readonly Qa1Pair[] {
  const bad = keys.filter((k) => !ALLOWED_PAIRS.has(k));
  if (bad.length > 0) {
    throw new Error(
      `[social-qa1-kit] cặp quyền ngoài danh sách cho phép: ${bad.join(", ")} — ` +
        `chỉ nhận 15 cặp feed literal + ${QA1_EXTRA_PAIRS.join(" · ")} (plan D13; không wildcard).`,
    );
  }
}

export interface Qa1ActorSpec {
  /** Vai TUỲ BIẾN chứa đúng các cặp này (qua hàng rào D13). Vắng = không tạo vai tuỳ biến. */
  pairs?: readonly Qa1Pair[];
  /** Scope riêng cho từng cặp của `pairs` (mặc định `Company`). Key phải nằm trong `pairs`. */
  scopes?: Readonly<Partial<Record<Qa1Pair, Qa1Scope>>>;
  /** Một hoặc NHIỀU vai canonical thật (hàng `roles.company_id IS NULL`) — tổ hợp hai vai truyền mảng. */
  canonical?: CanonicalRole | readonly CanonicalRole[];
  /** Đơn vị của hồ sơ nhân viên (`employee_profiles.org_unit_id`). */
  orgUnitId?: string | null;
  profile?: {
    /** `YYYY-MM-DD`; tính theo giờ CỤC BỘ của tiến trình (xem `localDateParts`). */
    dob?: string | null;
    /** Trạng thái làm việc (CHECK `emp_status_check`). Mặc định `active`. */
    status?: "active" | "inactive" | "resigned" | "terminated";
    fullName?: string;
    /** `true` = tài khoản KHÔNG có hồ sơ nhân viên (`employeeId = null`). */
    none?: boolean;
  };
}

export interface Qa1Actor {
  /** Access token dùng được ngay. */
  token: string;
  userId: string;
  /** `null` khi `profile.none`. */
  employeeId: string | null;
  email: string;
  fullName: string;
  tenant: SeededTenant;
  label: string;
}

/** Hình dạng tối thiểu của một response supertest mà các hàm assert cần. */
export interface Qa1Res {
  status: number;
  body: {
    success?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; type?: string; details?: unknown } | null;
  };
}

export interface Qa1World {
  app: INestApplication;
  /** Pool superuser (`max: 4`) — gieo / đọc cột; ca giữ khoá dùng pool riêng của `holdRowLock`. */
  direct: Pool;
  /** Cổng app đang nghe — cho socket client thật (L8). */
  port: number;
  A: SeededTenant;
  B: SeededTenant;
  /** `[A.companyId, B.companyId]` — đầu vào của `reconcileSocialCounters`. */
  companyIds: readonly string[];
  /** Agent supertest trên app đang nghe — trao cho helper bảng-route (L1). Route KHÔNG có tiền tố `/api/v1`. */
  http(): ReturnType<typeof request>;
  /** `token = null` ⇒ không gửi `Authorization` (ca 401). */
  get(token: string | null, url: string): request.Test;
  post(token: string | null, url: string): request.Test;
  put(token: string | null, url: string): request.Test;
  patch(token: string | null, url: string): request.Test;
  del(token: string | null, url: string): request.Test;
  /** Tạo đơn vị trong công ty `tenant` (tên có hậu tố ngẫu nhiên). */
  orgUnit(tenant: SeededTenant, name: string, parentId?: string | null): Promise<string>;
  /** Dựng tài khoản + hồ sơ + vai rồi đăng nhập. Hàng rào D13 chạy TRƯỚC mọi câu SQL. */
  actor(tenant: SeededTenant, label: string, spec: Qa1ActorSpec): Promise<Qa1Actor>;
  /** Đóng app → dọn hai công ty → đóng pool. Gọi trong `afterAll`. */
  close(): Promise<void>;
}

const short = (n = 8): string => randomUUID().replace(/-/g, "").slice(0, n);

/**
 * Dựng «thế giới» QA: 2 công ty (A · B), app thật qua `applyMainPipeline`, `listen(0)`.
 *
 * @param label nhãn riêng của FILE spec (chữ thường + số) — vào slug công ty và tag mật khẩu fixture.
 * @returns `Qa1World`; PHẢI `await world.close()` trong `afterAll`.
 * Bẫy: route gọi KHÔNG có tiền tố `/api/v1`; `direct` chỉ có 4 kết nối.
 */
export async function bootQa1World(label: string): Promise<Qa1World> {
  const direct = directPool();
  const A = await seedCompany(direct, `${label}a`);
  const B = await seedCompany(direct, `${label}b`);
  const companyIds = [A.companyId, B.companyId] as const;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = applyMainPipeline(moduleRef.createNestApplication());
  await app.init();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;

  const loginPassword = loginPasswordFixture(`socialqa1${label}`);
  const passwordHash = await app.get(PasswordService).hash(loginPassword);

  const http = () => request(app.getHttpServer());
  const withAuth = (t: request.Test, token: string | null): request.Test =>
    token === null ? t : t.set({ Authorization: `Bearer ${token}` });

  /** id của cặp trong catalog — CHỈ ĐỌC; cặp không có ⇒ ném (không bao giờ INSERT vào catalog toàn cục). */
  async function permissionId(pair: Qa1Pair): Promise<string> {
    const [action, resource] = pair.split(":") as [string, string];
    const r = await direct.query<{ id: string }>(
      `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2`,
      [action, resource],
    );
    if (r.rows.length !== 1) {
      throw new Error(`[social-qa1-kit] catalog thiếu cặp ${pair} (${r.rows.length} hàng)`);
    }
    return r.rows[0].id;
  }

  const orgUnit: Qa1World["orgUnit"] = async (tenant, name, parentId = null) => {
    const r = await direct.query<{ id: string }>(
      `INSERT INTO org_units (company_id, name, parent_id, head_user_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [tenant.companyId, `${name}-${short(6)}`, parentId],
    );
    return r.rows[0].id;
  };

  const actor: Qa1World["actor"] = async (tenant, actorLabel, spec) => {
    // ── Hàng rào: mọi kiểm tra đầu vào chạy TRƯỚC câu SQL đầu tiên ──
    const pairs = spec.pairs ?? [];
    assertQa1PairKeys(pairs);
    const scopes = spec.scopes ?? {};
    for (const [key, scope] of Object.entries(scopes)) {
      if (!pairs.includes(key as Qa1Pair)) {
        throw new Error(`[social-qa1-kit] scopes có cặp ${key} không nằm trong pairs`);
      }
      if (!QA1_SCOPES.has(String(scope))) {
        throw new Error(`[social-qa1-kit] scope lạ cho ${key}: ${String(scope)}`);
      }
    }
    const canonical =
      spec.canonical === undefined
        ? []
        : typeof spec.canonical === "string"
          ? [spec.canonical]
          : [...spec.canonical];
    for (const name of canonical) {
      if (!CANONICAL_ROLES.includes(name)) {
        throw new Error(`[social-qa1-kit] vai canonical lạ: ${String(name)}`);
      }
    }

    const email = `${actorLabel}-${short(10)}@${tenant.slug}.test`.toLowerCase();
    const fullName = spec.profile?.fullName ?? `Qa ${actorLabel} ${short(6)}`;
    const userId = await seedUser(direct, tenant.companyId, email, passwordHash);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);

    let employeeId: string | null = null;
    if (!spec.profile?.none) {
      const p = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles
           (company_id, user_id, org_unit_id, status, work_type, employee_code, date_of_birth)
         VALUES ($1, $2, $3, $4, 'offline', $5, $6) RETURNING id`,
        [
          tenant.companyId,
          userId,
          spec.orgUnitId ?? null,
          spec.profile?.status ?? "active",
          `QA1-${short(10)}`,
          spec.profile?.dob ?? null,
        ],
      );
      employeeId = p.rows[0].id;
    }

    if (spec.pairs !== undefined) {
      const roleId = await seedRole(direct, tenant.companyId, `qa1-${actorLabel}-${short(8)}`);
      for (const pair of pairs) {
        await seedRolePermission(
          direct,
          roleId,
          await permissionId(pair),
          "ALLOW",
          scopes[pair] ?? "Company",
        );
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
    }
    for (const name of canonical) {
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL`,
        [name],
      );
      if (r.rows.length !== 1) {
        throw new Error(
          `[social-qa1-kit] vai hệ thống ${name}: cần đúng 1 hàng, có ${r.rows.length}`,
        );
      }
      await seedUserRole(direct, userId, r.rows[0].id, tenant.companyId);
    }

    const res = await http()
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: loginPassword });
    if (res.status !== 200) {
      throw new Error(`[social-qa1-kit] login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return {
      token: res.body.data.accessToken as string,
      userId,
      employeeId,
      email,
      fullName,
      tenant,
      label: actorLabel,
    };
  };

  return {
    app,
    direct,
    port,
    A,
    B,
    companyIds,
    http,
    get: (token, url) => withAuth(http().get(url), token),
    post: (token, url) => withAuth(http().post(url), token),
    put: (token, url) => withAuth(http().put(url), token),
    patch: (token, url) => withAuth(http().patch(url), token),
    del: (token, url) => withAuth(http().delete(url), token),
    orgUnit,
    actor,
    close: async () => {
      await app.close();
      await cleanupTenants(direct, [...companyIds]);
      await direct.end();
    },
  };
}

/** Số hàng catalog mang resource `feed` / `feed-*` — để ca tự-kiểm hàng rào so trước/sau. */
export async function countFeedCatalogRows(direct: Pool): Promise<number> {
  const r = await direct.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM permissions
      WHERE resource_type = 'feed' OR resource_type LIKE 'feed-%'`,
  );
  return r.rows[0].n;
}

/** `{ y, m, d, mmdd }` của một `Date` theo giờ CỤC BỘ tiến trình (sinh nhật tính theo múi giờ tiến trình API — plan §6-B13). */
export function localDateParts(date: Date = new Date()): {
  y: number;
  m: number;
  d: number;
  mmdd: string;
} {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return {
    y: date.getFullYear(),
    m,
    d,
    mmdd: `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}

// ─── Assert lỗi trên dây (D5) ────────────────────────────────────────────────────────────────────

const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;

/**
 * Lỗi mang mã SOCIAL: status + `error.code` + `error.message` byte-y-hệt.
 * Nhận HẰNG (`SOCIAL_ERR.K`, `SOCIAL_ERROR_CODES.K`) — census mã lỗi chỉ tính tham chiếu hằng trong
 * file spec; chuỗi trần không phân biệt được các khoá chung một số.
 */
export function expectSocial(
  res: Qa1Res,
  status: number,
  message: SocialErrorMessage,
  code: SocialErrorCode,
): void {
  expect(res.status, dump(res)).toBe(status);
  expect(res.body.error?.code, `error.code của «${message}»`).toBe(code);
  expect(res.body.error?.message).toBe(message);
}

/** 403 TẦNG 1 (thiếu cặp của decorator): code `AUTH-ERR-FORBIDDEN` + message bắt đầu `Permission denied: `. */
export function expectGuardDenied(res: Qa1Res, what = "tầng 1"): void {
  expect(res.status, `${what}: ${dump(res)}`).toBe(403);
  expect(res.body.error?.code, what).toBe("AUTH-ERR-FORBIDDEN");
  expect(res.body.error?.message ?? "", `${what}: phải là từ chối của guard tầng 1`).toMatch(
    /^Permission denied: /,
  );
}

/** 403 SÀN SCOPE ở tầng 2: code `AUTH-ERR-FORBIDDEN` + message bắt đầu `AUTH-ERR-SCOPE-DENIED` (mã chỉ nằm trong message). */
export function expectScopeFloorDenied(res: Qa1Res, what = "sàn scope"): void {
  expect(res.status, `${what}: ${dump(res)}`).toBe(403);
  expect(res.body.error?.code, what).toBe("AUTH-ERR-FORBIDDEN");
  expect(res.body.error?.message ?? "", `${what}: phải là từ chối sàn scope`).toMatch(
    /^AUTH-ERR-SCOPE-DENIED/,
  );
}

/** 401 không token: code `AUTH-ERR-UNAUTHENTICATED`. */
export function expectUnauthenticated(res: Qa1Res, what = "không token"): void {
  expect(res.status, `${what}: ${dump(res)}`).toBe(401);
  expect(res.body.error?.code, what).toBe("AUTH-ERR-UNAUTHENTICATED");
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * Bản sao sâu đã bỏ phần «bay hơi»: khoá `meta` / `request_id` / `timestamp` bị gỡ, mốc ISO trong
 * chuỗi thành `<ts>`; `opts.uuids` ⇒ UUID thành `<uuid>` (mặc định GIỮ UUID — một id lạ lộ ra phải
 * làm phép so đỏ). Dùng trước khi so hai thân, và trước khi dò regex năm (UUID / mốc thời gian khớp
 * nhầm — plan §6-B12: khi dò năm hãy truyền `uuids: true`).
 */
export function stripVolatile(value: unknown, opts: { uuids?: boolean } = {}): unknown {
  if (typeof value === "string") {
    const s = value.replace(ISO_RE, "<ts>");
    return opts.uuids ? s.replace(UUID_RE, "<uuid>") : s;
  }
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v, opts));
  if (value !== null && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (k === "meta" || k === "request_id" || k === "timestamp") continue;
      out[k] = stripVolatile(v, opts);
    }
    return out;
  }
  return value;
}

/**
 * Hai response lỗi KHÔNG phân biệt được với nhau: cùng status và cùng thân sau `stripVolatile`
 * (UUID được GIỮ). Dùng cho «tồn tại mà không thấy» ≡ «id bịa».
 */
export function sameErrorBody(actual: Qa1Res, reference: Qa1Res, what = "thân lỗi"): void {
  expect(actual.status, `${what}: ${dump(actual)} ≠ ${dump(reference)}`).toBe(reference.status);
  expect(stripVolatile(actual.body), what).toEqual(stripVolatile(reference.body));
}

/**
 * Dò danh tính trong một giá trị JSON bất kỳ: trả danh sách `đường.dẫn=<needle>` của MỌI chỗ một
 * `needle` xuất hiện (trong chuỗi — không phân biệt hoa thường — hoặc trong tên khoá).
 *
 * @param needles userId · employeeId · email · họ tên … (chuỗi rỗng bị bỏ qua).
 * @returns `[]` = không lộ. Ca dùng hàm này PHẢI có vế tự-kiểm dương (cùng hàm, trên thân CÓ danh tính).
 */
export function findIdentity(value: unknown, needles: readonly string[]): string[] {
  const wanted = needles.filter((n) => n.length > 0).map((n) => n.toLowerCase());
  const hits: string[] = [];
  const scan = (text: string, path: string): void => {
    const low = text.toLowerCase();
    for (const n of wanted) if (low.includes(n)) hits.push(`${path}=${n}`);
  };
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") scan(v, path);
    else if (typeof v === "number" || typeof v === "boolean") scan(String(v), path);
    else if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Json)) {
        scan(k, `${path}.{${k}}`);
        walk(child, `${path}.${k}`);
      }
    }
  };
  walk(value, "$");
  return hits;
}

// ─── Dựng dữ liệu QUA API (counter · thẻ · outbox chỉ đúng khi đi qua route — plan §6-B18) ────────

export interface Qa1Made {
  id: string;
  /** `body.data` của response. */
  data: Json;
}

function okData(res: Qa1Res, status: number, what: string): Json {
  if (res.status !== status) {
    throw new Error(`[social-qa1-kit] ${what}: mong ${status}, nhận ${dump(res)}`);
  }
  return (res.body.data ?? {}) as Json;
}

export interface Qa1PostPlace {
  /** Mặc định `company`. */
  audience?: "company" | "org_unit" | "group";
  orgUnitId?: string;
  groupId?: string;
}

/** `002` với body tuỳ ý (đã hợp lệ) ⇒ 201. Trả `id` + thẻ bài. Ca TỪ CHỐI thì gọi thẳng `w.post(...)`. */
export async function createPost(w: Qa1World, by: Qa1Actor, body: Json): Promise<Qa1Made> {
  const data = okData(await w.post(by.token, "/social/posts").send(body), 201, "002 tạo bài");
  return { id: data.id as string, data };
}

const place = (p: Qa1PostPlace): Json => ({
  audience: p.audience ?? "company",
  ...(p.orgUnitId ? { orgUnitId: p.orgUnitId } : {}),
  ...(p.groupId ? { groupId: p.groupId } : {}),
});

/** Bài `share`. `text` có thể chứa `#thẻ` (dùng `uniqueTag()` để không đụng lượt khác). */
export function sharePost(
  w: Qa1World,
  by: Qa1Actor,
  text = `Bài chia sẻ ${short()}`,
  where: Qa1PostPlace = {},
): Promise<Qa1Made> {
  return createPost(w, by, { type: "share", ...place(where), body: text });
}

/** Bài `news` (cần `manage:feed-news`). `requiresAck` mặc định `false`. */
export function newsPost(
  w: Qa1World,
  by: Qa1Actor,
  opts: { text?: string; requiresAck?: boolean } & Qa1PostPlace = {},
): Promise<Qa1Made> {
  return createPost(w, by, {
    type: "news",
    ...place(opts),
    body: opts.text ?? `Tin ${short()}`,
    requiresAck: opts.requiresAck ?? false,
  });
}

/** Bài `idea` (cần `create:feed-idea`). */
export function ideaPost(
  w: Qa1World,
  by: Qa1Actor,
  text = `Sáng kiến ${short()}`,
  where: Qa1PostPlace = {},
): Promise<Qa1Made> {
  return createPost(w, by, { type: "idea", ...place(where), body: text });
}

export interface Qa1PollMade extends Qa1Made {
  /** id các lựa chọn theo thứ tự `position` (đọc từ khối `poll.options` của thẻ bài). */
  optionIds: string[];
}

/** Bài `poll` (cần `create:feed-poll`). Mặc định 3 lựa chọn, một-lựa-chọn, không ẩn danh, không hạn. */
export async function pollPost(
  w: Qa1World,
  by: Qa1Actor,
  opts: {
    question?: string;
    options?: readonly string[];
    multipleChoice?: boolean;
    isAnonymous?: boolean;
    closesAt?: string;
  } & Qa1PostPlace = {},
): Promise<Qa1PollMade> {
  const made = await createPost(w, by, {
    type: "poll",
    ...place(opts),
    poll: {
      question: opts.question ?? `Câu hỏi ${short()}`,
      options: [...(opts.options ?? ["Một", "Hai", "Ba"])],
      multipleChoice: opts.multipleChoice ?? false,
      isAnonymous: opts.isAnonymous ?? false,
      ...(opts.closesAt ? { closesAt: opts.closesAt } : {}),
    },
  });
  const options = ((made.data.poll as Json | undefined)?.options ?? []) as Json[];
  if (options.length === 0) {
    throw new Error(`[social-qa1-kit] thẻ bài poll không mang khối poll.options: ${made.id}`);
  }
  return { ...made, optionIds: options.map((o) => o.id as string) };
}

/** Bài `kudos` (cần `create:feed-kudos`; `isOfficial` cần `manage:feed-kudos`). Người nhận là `employee_profiles.id`. */
export function kudosPost(
  w: Qa1World,
  by: Qa1Actor,
  recipientEmployeeIds: readonly string[],
  opts: { message?: string; badgeId?: string; isOfficial?: boolean } & Qa1PostPlace = {},
): Promise<Qa1Made> {
  return createPost(w, by, {
    type: "kudos",
    ...place(opts),
    kudos: {
      recipientEmployeeIds: [...recipientEmployeeIds],
      message: opts.message ?? `Cảm ơn ${short()}`,
      ...(opts.badgeId ? { badgeId: opts.badgeId } : {}),
      ...(opts.isOfficial === undefined ? {} : { isOfficial: opts.isOfficial }),
    },
  });
}

/** `015` bình luận (201). `parentCommentId` = trả lời một bình luận gốc. */
export async function addComment(
  w: Qa1World,
  by: Qa1Actor,
  postId: string,
  text = `Bình luận ${short()}`,
  parentCommentId?: string,
): Promise<Qa1Made> {
  const data = okData(
    await w
      .post(by.token, `/social/posts/${postId}/comments`)
      .send({ body: text, ...(parentCommentId ? { parentCommentId } : {}) }),
    201,
    "015 bình luận",
  );
  return { id: data.id as string, data };
}

export type Qa1Emoji = "like" | "love" | "haha" | "wow" | "sad" | "angry";

/** `011` thả cảm xúc lên BÀI (200). ⚠️ `likeCount` trong thân là COUNT thật, không phải cột đếm. */
export async function reactPost(
  w: Qa1World,
  by: Qa1Actor,
  postId: string,
  emoji: Qa1Emoji = "like",
): Promise<Json> {
  return okData(
    await w.put(by.token, `/social/posts/${postId}/reaction`).send({ emoji }),
    200,
    "011 cảm xúc bài",
  );
}

/** `018` thả cảm xúc lên BÌNH LUẬN (200). */
export async function reactComment(
  w: Qa1World,
  by: Qa1Actor,
  commentId: string,
  emoji: Qa1Emoji = "like",
): Promise<Json> {
  return okData(
    await w.put(by.token, `/social/comments/${commentId}/reaction`).send({ emoji }),
    200,
    "018 cảm xúc bình luận",
  );
}

/** `007` ghi lượt xem (201). Lượt lặp của cùng người: thân KHÔNG có `viewCount`. */
export async function viewPost(w: Qa1World, by: Qa1Actor, postId: string): Promise<Json> {
  return okData(await w.post(by.token, `/social/posts/${postId}/view`), 201, "007 lượt xem");
}

/** `008` lưu bài (201). */
export async function savePost(w: Qa1World, by: Qa1Actor, postId: string): Promise<Json> {
  return okData(await w.post(by.token, `/social/posts/${postId}/save`), 201, "008 lưu bài");
}

/** `021` xác nhận đã đọc tin `requiresAck` (201). */
export async function ackPost(w: Qa1World, by: Qa1Actor, postId: string): Promise<Json> {
  return okData(await w.post(by.token, `/social/posts/${postId}/ack`), 201, "021 xác nhận đọc");
}

/** `031` tạo nhóm (201, cần `create:feed-group`); người tạo là `owner` / `active`, `member_count = 1`. */
export async function createGroup(
  w: Qa1World,
  by: Qa1Actor,
  visibility: "public" | "private",
  name = `Nhóm ${short(10)}`,
): Promise<Qa1Made> {
  const data = okData(
    await w.post(by.token, "/social/groups").send({ name, visibility }),
    201,
    "031 tạo nhóm",
  );
  return { id: data.id as string, data };
}

/**
 * `035` tham gia nhóm (201). Trả thẻ NHÓM (`myStatus` · `myRole` · `memberCount`): nhóm public ⇒
 * `myStatus = "active"`; nhóm private ⇒ `"pending"` (chờ `approveMember`).
 */
export async function joinGroup(w: Qa1World, by: Qa1Actor, groupId: string): Promise<Json> {
  return okData(await w.post(by.token, `/social/groups/${groupId}/join`), 201, "035 tham gia nhóm");
}

/** `038` duyệt một yêu cầu `pending` (200) — `by` là owner / admin của nhóm hoặc có `manage:feed-group`. */
export async function approveMember(
  w: Qa1World,
  by: Qa1Actor,
  groupId: string,
  userId: string,
): Promise<Json> {
  return okData(
    await w
      .patch(by.token, `/social/groups/${groupId}/members/${userId}`)
      .send({ decision: "approve" }),
    200,
    "038 duyệt thành viên",
  );
}

/** Thành viên `active` của nhóm bất kể public / private: `join` rồi (nếu `pending`) để `owner` duyệt. */
export async function joinAsActiveMember(
  w: Qa1World,
  owner: Qa1Actor,
  member: Qa1Actor,
  groupId: string,
): Promise<void> {
  const joined = await joinGroup(w, member, groupId);
  if (joined.myStatus === "pending") await approveMember(w, owner, groupId, member.userId);
}

/** `041` bỏ phiếu (200). Poll một-lựa-chọn: gửi đúng 1 id; gửi lại id khác = ĐỔI phiếu. */
export async function votePoll(
  w: Qa1World,
  by: Qa1Actor,
  postId: string,
  optionIds: readonly string[],
): Promise<Json> {
  return okData(
    await w.put(by.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [...optionIds] }),
    200,
    "041 bỏ phiếu",
  );
}

/** `027` báo cáo một bài / bình luận (201). */
export async function reportTarget(
  w: Qa1World,
  by: Qa1Actor,
  targetType: "post" | "comment",
  targetId: string,
  reason = "spam",
): Promise<Qa1Made> {
  const data = okData(
    await w.post(by.token, "/social/reports").send({ targetType, targetId, reason }),
    201,
    "027 báo cáo",
  );
  return { id: data.id as string, data };
}

/** Thẻ hashtag riêng của lượt (chữ thường + số, không dấu `#`): chèn `#${tag}` vào body bài. */
export const uniqueTag = (prefix = "qa"): string => `${prefix}${short(10)}`;
