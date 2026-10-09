/**
 * S16-SOCIAL-QA-1 (L4) — CHÉO CÔNG TY trên mọi route SOCIAL nhận id
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L4, D5 · D10).
 *
 * Hai công ty A · B, mỗi bên một quản trị viên canonical (`company-admin`) và một lát dữ liệu riêng.
 * BA PHA chạy đúng thứ tự (các `describe` trong file chạy tuần tự):
 *
 *   Pha 1 — vế TỪ CHỐI của B
 *     QA1-T-<mã>    39 dòng: 37 route nhận id ở đường dẫn + 052 · 053 nhận `orgUnitId`; B gọi với id
 *                   THẬT của A ⇒ status + mã ghi tay từng dòng, và thân trả về không phân biệt được
 *                   với thân của một id bịa
 *     QA1-T-B-1…9   id của A đặt trong THÂN request của B
 *     QA1-T-L-<mã>  15 route danh sách: thân của B không mang dấu nào của dữ liệu A
 *     QA1-T-Q-1…4   bộ lọc của bảng tin mang id của A
 *   Pha 2 — «A nguyên vẹn»: số hàng + nội dung mọi hàng của A không đổi sau pha 1; không hàng nào
 *           của B tham chiếu id của A
 *   Pha 3 — vế CHO PHÉP: quản trị viên của A gọi CÙNG request trên CHÍNH object đó ⇒ đúng mã thành
 *           công (đọc trước, đổi trạng thái sau, xoá cuối cùng). Một dòng pha 3 đỏ nghĩa là dòng từ
 *           chối tương ứng ở pha 1 không chứng minh được gì.
 *
 * Kỳ vọng từng dòng là LITERAL viết tay theo API-19 §5.1 + §9 (không suy từ code).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import type { SeededTenant } from "../helpers/seed";
import {
  FEED_PAIRS,
  addComment,
  bootQa1World,
  createGroup,
  expectSocial,
  findIdentity,
  kudosPost,
  localDateParts,
  newsPost,
  pollPost,
  sameErrorBody,
  savePost,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { expectCountersReconciled } from "../helpers/social-qa1-kit-counters";
import {
  QA1_ROUTES,
  callQa1Route,
  qa1Route,
  type Qa1Slice,
  type Qa1Verb,
} from "../helpers/social-qa1-routes";
import { ensureQa1FileDoorEnv, seedQa1Slice } from "../helpers/social-qa1-seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;
/** Các dòng của một trang keyset: `{ data: { data: [...], nextCursor } }`. Sai hình dạng ⇒ ném. */
function items(body: Qa1Res["body"]): Json[] {
  const page = body.data as { data?: unknown } | undefined;
  if (!Array.isArray(page?.data))
    throw new Error(`không phải trang keyset: ${JSON.stringify(body)}`);
  return page.data as Json[];
}

/** Mọi thứ MỘT công ty có trong spec này. */
interface Side {
  tenant: SeededTenant;
  admin: Qa1Actor;
  priv: Qa1Actor;
  slice: Qa1Slice;
  /** Đơn vị mà `admin` thuộc về. */
  unitId: string;
  /** Tệp đã tải xong, thuộc `admin`, chưa gắn vào đâu. */
  fileId: string;
  /** Bình chọn riêng của các ca thân request (không dùng chung với bảng route). */
  pollId: string;
  optionId: string;
}

// ── Bảng QA1-T: kỳ vọng ghi TAY cho từng route khi B đưa id của A ──────────────────────────────
type Deny = "post" | "comment" | "report" | "group" | "badge" | "file" | "stats" | "empty";

const T_TABLE: ReadonlyArray<readonly [code: string, deny: Deny]> = [
  ["003", "post"],
  ["004", "post"],
  ["005", "post"],
  ["006", "post"],
  ["007", "post"],
  ["008", "post"],
  ["009", "post"],
  ["011", "post"],
  ["012", "post"],
  ["013", "post"],
  ["014", "post"],
  ["015", "post"],
  ["016", "comment"],
  ["017", "comment"],
  ["018", "comment"],
  ["019", "comment"],
  ["021", "post"],
  ["022", "post"],
  ["025", "empty"],
  ["029", "report"],
  ["032", "group"],
  ["033", "group"],
  ["034", "group"],
  ["035", "group"],
  ["036", "group"],
  ["037", "group"],
  ["038", "group"],
  ["039", "group"],
  ["041", "post"],
  ["042", "post"],
  ["043", "post"],
  ["044", "post"],
  ["046", "post"],
  ["050", "badge"],
  ["051", "badge"],
  ["052", "stats"],
  ["053", "stats"],
  ["055", "file"],
  ["058", "post"],
];

/** Hai route thống kê nhận id qua query `orgUnitId` thay vì đường dẫn. */
const UNIT_QUERY: ReadonlySet<string> = new Set(["052", "053"]);
/** Route làm MẤT object nó chạm — pha 3 gọi sau cùng. */
const REMOVING: ReadonlySet<string> = new Set(["005", "017", "034", "036", "039", "051"]);

/** Mã chung của 404 không mang mã riêng của module (055: tệp lạ). */
const GENERIC_NOT_FOUND = "RESOURCE-ERR-NOT-FOUND";

function expectDenied(deny: Deny, res: Qa1Res): void {
  switch (deny) {
    case "post":
      return expectSocial(res, 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND);
    case "comment":
      return expectSocial(
        res,
        404,
        SOCIAL_ERR.COMMENT_NOT_FOUND,
        SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND,
      );
    case "report":
      return expectSocial(
        res,
        404,
        SOCIAL_ERR.REPORT_NOT_FOUND,
        SOCIAL_ERROR_CODES.REPORT_NOT_FOUND,
      );
    case "group":
      return expectSocial(res, 404, SOCIAL_ERR.GROUP_NOT_FOUND, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND);
    case "badge":
      return expectSocial(
        res,
        404,
        SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND,
        SOCIAL_ERROR_CODES.KUDOS_BADGE_NOT_FOUND,
      );
    case "stats":
      return expectSocial(
        res,
        403,
        SOCIAL_ERR.STATS_UNIT_OUT_OF_SCOPE,
        SOCIAL_ERROR_CODES.STATS_UNIT_OUT_OF_SCOPE,
      );
    case "file":
      expect(res.status, dump(res)).toBe(404);
      expect(res.body.error?.code).toBe(GENERIC_NOT_FOUND);
      return;
    case "empty":
      expect(res.status, dump(res)).toBe(200);
      expect(items(res.body), "danh sách phải rỗng").toEqual([]);
  }
}

// ── Bảng QA1-T-B: id của công ty KHÁC đặt trong thân request ──────────────────────────────────
interface BodyCase {
  id: string;
  what: string;
  /** `home` = công ty của người gọi; `foreign` = công ty có id được đưa vào thân. */
  build(home: Side, foreign: Side): { verb: Qa1Verb; url: string; body: Json };
  /** Kỳ vọng khi `foreign` KHÁC `home`. */
  denied(res: Qa1Res, foreign: Side): void;
  /** Mã thành công khi `foreign` chính là `home`. */
  ok: 200 | 201;
}

const share = (extra: Json): Json => ({
  type: "share",
  audience: "company",
  body: `Bài thân request ${randomUUID().slice(0, 8)}`,
  ...extra,
});
const kudos = (recipient: string, extra: Json = {}): Json => ({
  type: "kudos",
  audience: "company",
  kudos: { recipientEmployeeIds: [recipient], message: "Cảm ơn bạn", ...extra },
});

const BODY_CASES: readonly BodyCase[] = [
  {
    id: "QA1-T-B-1",
    what: "002 · groupId",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: share({ audience: "group", groupId: f.slice.groupId }),
    }),
    denied: (res) =>
      expectSocial(res, 404, SOCIAL_ERR.GROUP_NOT_FOUND, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND),
    ok: 201,
  },
  {
    id: "QA1-T-B-2",
    what: "002 · orgUnitId",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: share({ audience: "org_unit", orgUnitId: f.unitId }),
    }),
    denied: (res) =>
      expectSocial(
        res,
        403,
        SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE,
        SOCIAL_ERROR_CODES.WRITE_OUT_OF_AUDIENCE,
      ),
    ok: 201,
  },
  {
    id: "QA1-T-B-3",
    what: "002 · kudos.badgeId",
    build: (h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: kudos(h.slice.privilegedEmployeeId, { badgeId: f.slice.badgeId }),
    }),
    denied: (res) =>
      expectSocial(
        res,
        422,
        SOCIAL_ERR.KUDOS_BADGE_INVALID,
        SOCIAL_ERROR_CODES.KUDOS_BADGE_INVALID,
      ),
    ok: 201,
  },
  {
    id: "QA1-T-B-4",
    what: "002 · kudos.recipientEmployeeIds",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: kudos(f.slice.privilegedEmployeeId),
    }),
    denied: (res) =>
      expectSocial(
        res,
        422,
        SOCIAL_ERR.KUDOS_RECIPIENT_INVALID,
        SOCIAL_ERROR_CODES.KUDOS_RECIPIENT_INVALID,
      ),
    ok: 201,
  },
  {
    id: "QA1-T-B-5",
    what: "002 · attachmentIds",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: share({ attachmentIds: [f.fileId] }),
    }),
    denied: (res) =>
      expectSocial(res, 422, SOCIAL_ERR.ATTACHMENT_INVALID, SOCIAL_ERROR_CODES.ATTACHMENT_INVALID),
    ok: 201,
  },
  {
    id: "QA1-T-B-6",
    what: "002 · mentionedUserIds",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/posts",
      body: share({ mentionedUserIds: [f.priv.userId] }),
    }),
    // Nhắc tên ngoài phạm vi KHÔNG phải lỗi: 201, lượt nhắc bị bỏ và chỉ dội lại đúng id đã gửi.
    denied: (res, f) => {
      expect(res.status, dump(res)).toBe(201);
      const data = res.body.data as Json;
      expect(data.droppedMentions).toEqual([f.priv.userId]);
      expect(data.mentions ?? []).toEqual([]);
      expect(
        findIdentity(res.body, [f.priv.email, f.priv.employeeId ?? "", f.priv.fullName]),
        "thân không được mang danh tính của người bị bỏ",
      ).toEqual([]);
    },
    ok: 201,
  },
  {
    id: "QA1-T-B-7",
    what: "015 · parentCommentId",
    build: (h, f) => ({
      verb: "post",
      url: `/social/posts/${h.slice.postId}/comments`,
      body: { body: "Trả lời", parentCommentId: f.slice.commentId },
    }),
    denied: (res) =>
      expectSocial(res, 404, SOCIAL_ERR.COMMENT_NOT_FOUND, SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND),
    ok: 201,
  },
  {
    id: "QA1-T-B-8",
    what: "027 · targetId",
    build: (_h, f) => ({
      verb: "post",
      url: "/social/reports",
      body: { targetType: "post", targetId: f.slice.reportTargetPostId, reason: "spam" },
    }),
    denied: (res) =>
      expectSocial(res, 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND),
    ok: 201,
  },
  {
    id: "QA1-T-B-9",
    what: "041 · optionIds",
    build: (h, f) => ({
      verb: "put",
      url: `/social/posts/${h.pollId}/poll/vote`,
      body: { optionIds: [f.optionId] },
    }),
    denied: (res) =>
      expectSocial(
        res,
        404,
        SOCIAL_ERR.POLL_OPTION_NOT_FOUND,
        SOCIAL_ERROR_CODES.POLL_OPTION_NOT_FOUND,
      ),
    ok: 200,
  },
];

/** 15 route danh sách (GET không tham số đường dẫn, trừ hai route thống kê đã nằm ở bảng T). */
const LIST_CODES = [
  "001",
  "010",
  "020",
  "023",
  "024",
  "026",
  "028",
  "030",
  "040",
  "045",
  "047",
  "048",
  "056",
  "057",
  "059",
] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L4 · chéo công ty (DB cô lập)", () => {
  let w: Qa1World;
  let A: Side;
  let B: Side;
  /** Mọi dấu của dữ liệu A: id · từ riêng · thẻ · email · tiền tố tên riêng. */
  let needlesA: string[];
  /** Tiền tố họ tên chỉ một người của A mang (sinh nhật hôm nay) — dấu của 026 và 059. */
  let nameMark: string;
  /** Dấu mà A PHẢI thấy trên từng route danh sách (neo dương của T-L). */
  let listAnchor: Record<(typeof LIST_CODES)[number], string>;
  /** Bộ lọc bảng tin mang id của A + dấu mà A phải thấy với đúng bộ lọc đó. */
  let feedFilters: ReadonlyArray<readonly [id: string, query: string, anchor: string]>;
  let tables: string[];
  let before: Record<string, { n: number; h: string }>;

  async function seedFile(owner: Qa1Actor): Promise<string> {
    const id = randomUUID();
    await w.direct.query(
      `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,'image/png',2048,'MinIO',$5,'Uploaded','Clean',$6,$6)`,
      [
        id,
        owner.tenant.companyId,
        `anh-${id.slice(0, 6)}.png`,
        `stored-${id}`,
        `${owner.tenant.companyId}/social/${id}`,
        owner.userId,
      ],
    );
    return id;
  }

  async function side(tenant: SeededTenant): Promise<Side> {
    const unitId = await w.orgUnit(tenant, "Đơn vị chéo");
    const admin = await w.actor(tenant, "admin", { canonical: "company-admin", orgUnitId: unitId });
    const priv = await w.actor(tenant, "priv", { pairs: FEED_PAIRS });
    const slice = await seedQa1Slice(w, tenant, admin, { privileged: priv });
    const poll = await pollPost(w, admin);
    return {
      tenant,
      admin,
      priv,
      slice,
      unitId,
      fileId: await seedFile(admin),
      pollId: poll.id,
      optionId: poll.optionIds[0],
    };
  }

  /** Số hàng + băm nội dung của MỌI hàng thuộc một công ty, theo từng bảng. */
  async function snapshot(companyId: string): Promise<Record<string, { n: number; h: string }>> {
    const out: Record<string, { n: number; h: string }> = {};
    for (const table of tables) {
      const r = await w.direct.query<{ n: number; h: string }>(
        `SELECT count(*)::int AS n,
                coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))), '') AS h
           FROM "${table}" t WHERE t.company_id = $1`,
        [companyId],
      );
      out[table] = r.rows[0];
    }
    return out;
  }

  /** Số hàng của một công ty có chứa ít nhất một trong các id đã cho, theo từng bảng (chỉ bảng > 0). */
  async function rowsMentioning(companyId: string, ids: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of tables) {
      const r = await w.direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table}" t WHERE t.company_id = $1 AND t::text ~ $2`,
        [companyId, ids.join("|")],
      );
      if (r.rows[0].n > 0) out[table] = r.rows[0].n;
    }
    return out;
  }

  /** Lát giả: mọi id của lát thật được thay bằng UUID bịa. */
  function bogus(real: Qa1Slice): Qa1Slice {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(real)) out[k] = UUID_RE.test(v) ? randomUUID() : v;
    return out as unknown as Qa1Slice;
  }

  async function callT(
    code: string,
    slice: Qa1Slice,
    unitId: string,
    token: string,
  ): Promise<Qa1Res> {
    const route = qa1Route(code);
    if (!UNIT_QUERY.has(code)) return callQa1Route(w, route, slice, token);
    const res = await w.get(token, `${route.path(slice)}?orgUnitId=${unitId}`);
    return { status: res.status, body: res.body as Qa1Res["body"] };
  }

  async function send(by: Qa1Actor, c: ReturnType<BodyCase["build"]>): Promise<Qa1Res> {
    const res = await w[c.verb](by.token, c.url).send(c.body);
    return { status: res.status, body: res.body as Qa1Res["body"] };
  }

  const listUrl = (code: string): string => {
    if (code === "026") return "/social/birthdays?range=month";
    if (code === "059") return `/social/kudos/recipients?q=${encodeURIComponent(nameMark)}`;
    return qa1Route(code).path(A.slice);
  };

  const ids = (): string[] => needlesA.filter((n) => UUID_RE.test(n));

  beforeAll(async () => {
    ensureQa1FileDoorEnv();
    w = await bootQa1World("qa1xten");
    A = await side(w.A);
    B = await side(w.B);

    // Dấu riêng của A cho các route danh sách mà lát không gieo sẵn.
    nameMark = `Zq${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const born = await w.actor(w.A, "born", {
      pairs: ["view:feed"],
      profile: { dob: `1990-${localDateParts().mmdd}`, fullName: `${nameMark} Sinh Nhat` },
    });
    const kudosMade = await kudosPost(w, A.admin, [A.priv.employeeId ?? ""]);
    const openGroup = await createGroup(w, A.admin, "public");
    const groupPost = await sharePost(w, A.admin, undefined, {
      audience: "group",
      groupId: openGroup.id,
    });
    const unitPost = await sharePost(w, A.admin, undefined, {
      audience: "org_unit",
      orgUnitId: A.unitId,
    });
    const tagged = await sharePost(w, A.admin, `Bài gắn thẻ #${A.slice.tag}`);
    const extraComment = await addComment(w, A.admin, A.slice.postId);
    const news = await newsPost(w, A.admin);
    const mark = await sharePost(w, A.admin, `Bài mang dấu ${A.slice.marker}`);
    await savePost(w, A.admin, mark.id);

    listAnchor = {
      "001": mark.id,
      "010": mark.id,
      "020": news.id,
      "023": mark.id,
      "024": A.slice.tag,
      "026": nameMark,
      "028": A.slice.reportId,
      "030": openGroup.id,
      "040": A.pollId,
      "045": A.slice.ideaPostId,
      "047": kudosMade.id,
      "048": A.slice.badgeId,
      "056": A.slice.badgeId,
      "057": A.slice.trashedPostId,
      "059": nameMark,
    };
    feedFilters = [
      ["QA1-T-Q-1", `groupId=${openGroup.id}`, groupPost.id],
      ["QA1-T-Q-2", `authorUserId=${A.admin.userId}`, mark.id],
      ["QA1-T-Q-3", `orgUnitId=${A.unitId}`, unitPost.id],
      ["QA1-T-Q-4", `tag=${A.slice.tag}`, tagged.id],
    ];
    needlesA = [
      ...Object.values(A.slice).filter((v) => UUID_RE.test(v)),
      A.unitId,
      A.fileId,
      A.pollId,
      A.optionId,
      born.userId,
      born.employeeId ?? "",
      kudosMade.id,
      openGroup.id,
      groupPost.id,
      unitPost.id,
      tagged.id,
      extraComment.id,
      news.id,
      mark.id,
      A.slice.marker,
      A.slice.tag,
      nameMark,
      A.admin.email,
      A.priv.email,
      born.email,
    ].filter((n) => n.length > 0);

    const found = await w.direct.query<{ table_name: string }>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
          AND t.table_type = 'BASE TABLE'
          AND (c.table_name LIKE 'feed\\_%' OR c.table_name = 'files')
        ORDER BY c.table_name`,
    );
    tables = found.rows.map((r) => r.table_name).filter((name) => /^[a-z_]+$/.test(name));
    before = await snapshot(w.A.companyId);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  // ══════════════ Pha 1 — vế TỪ CHỐI của B ══════════════

  describe("Pha 1 · B đưa id của A", () => {
    it("neo · bảng T phủ đúng mọi route nhận id; bảng T-L phủ đúng mọi route danh sách", () => {
      const withId = QA1_ROUTES.filter((r) => r.pathParams.length > 0).map((r) => r.code);
      expect(T_TABLE.map(([code]) => code)).toEqual([...withId, ...UNIT_QUERY].sort());
      expect(T_TABLE).toHaveLength(39);

      const lists = QA1_ROUTES.filter(
        (r) => r.method === "GET" && r.pathParams.length === 0 && !UNIT_QUERY.has(r.code),
      ).map((r) => r.code);
      expect([...LIST_CODES]).toEqual(lists);
      expect(LIST_CODES).toHaveLength(15);
    });

    it("neo · ảnh chụp trước pha 1 có dữ liệu thật của A và bộ dò tìm được hàng của chính B", async () => {
      expect(tables.length).toBeGreaterThanOrEqual(10);
      for (const table of ["feed_posts", "feed_comments", "feed_groups", "files"]) {
        expect(before[table]?.n, table).toBeGreaterThan(0);
      }
      const own = await rowsMentioning(w.B.companyId, [B.slice.postId]);
      expect(own.feed_posts).toBeGreaterThanOrEqual(1);
      expect(needlesA.length).toBeGreaterThan(40);
    });

    it.each(T_TABLE)("QA1-T-%s · id của công ty khác ⇒ %s", async (code, deny) => {
      const res = await callT(code, A.slice, A.unitId, B.admin.token);
      expectDenied(deny, res);
      expect(findIdentity(res.body, needlesA), "thân không mang dấu nào của A").toEqual([]);
      // Không phân biệt được với một id không tồn tại.
      const ghost = await callT(code, bogus(A.slice), randomUUID(), B.admin.token);
      sameErrorBody(res, ghost, `${code}: id thật của công ty khác ≡ id bịa`);
    });

    it.each(BODY_CASES.map((c) => [c.id, c.what, c] as const))(
      "%s · %s của công ty khác trong thân request",
      async (_id, _what, c) => {
        const res = await send(B.admin, c.build(B, A));
        c.denied(res, A);
        expect(
          findIdentity(res.body, [A.slice.marker, A.admin.email, A.priv.email, nameMark]),
        ).toEqual([]);
      },
    );

    it.each(LIST_CODES)("QA1-T-L-%s · danh sách của B không mang dấu nào của A", async (code) => {
      const res = await w.get(B.admin.token, listUrl(code));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(findIdentity(res.body, needlesA)).toEqual([]);
    });

    it("QA1-T-Q-1…4 · bộ lọc bảng tin mang id của A ⇒ danh sách rỗng", async () => {
      for (const [id, query] of feedFilters) {
        const res = await w.get(B.admin.token, `/social/feed?${query}`);
        expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(items(res.body), id).toEqual([]);
        expect(findIdentity(res.body, needlesA), id).toEqual([]);
      }
    });
  });

  // ══════════════ Pha 2 — A nguyên vẹn ══════════════

  describe("Pha 2 · A nguyên vẹn sau pha 1", () => {
    it("QA1-T-X-1 · số hàng và nội dung mọi hàng của A không đổi", async () => {
      expect(await snapshot(w.A.companyId)).toEqual(before);
    });

    it("QA1-T-X-2 · không hàng nào của B tham chiếu id của A", async () => {
      expect(await rowsMentioning(w.B.companyId, ids())).toEqual({});
    });
  });

  // ══════════════ Pha 3 — vế CHO PHÉP của A trên chính object đó ══════════════

  describe("Pha 3 · A gọi cùng request trên chính object đó", () => {
    it.each(LIST_CODES)("QA1-T-L-%s · neo dương: A thấy dấu của mình", async (code) => {
      const res = await w.get(A.admin.token, listUrl(code));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(findIdentity(res.body, [listAnchor[code]]).length, listAnchor[code]).toBeGreaterThan(
        0,
      );
    });

    it("QA1-T-Q-1…4 · neo dương: cùng bộ lọc, A thấy bài của mình", async () => {
      for (const [id, query, anchor] of feedFilters) {
        const res = await w.get(A.admin.token, `/social/feed?${query}`);
        expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(
          items(res.body).map((p) => p.id),
          id,
        ).toContain(anchor);
      }
    });

    it.each(BODY_CASES.map((c) => [c.id, c.what, c] as const))(
      "%s · %s của CHÍNH công ty mình ⇒ thành công",
      async (_id, _what, c) => {
        const res = await send(A.admin, c.build(A, A));
        expect(res.status, dump(res)).toBe(c.ok);
      },
    );

    const rank = (code: string): number =>
      REMOVING.has(code) ? 2 : qa1Route(code).method === "GET" ? 0 : 1;
    const ordered = [...T_TABLE].sort((x, y) => rank(x[0]) - rank(y[0]));

    it.each(ordered)("QA1-T-%s · chủ dữ liệu ⇒ đúng mã thành công", async (code) => {
      const res = await callT(code, A.slice, A.unitId, A.admin.token);
      expect(res.status, `${code}: ${dump(res)}`).toBe(qa1Route(code).ok);
      // Dòng «danh sách rỗng» của pha 1 chỉ có nghĩa khi chủ dữ liệu thấy danh sách KHÔNG rỗng.
      if (code === "025") {
        expect(items(res.body).map((p) => p.id)).toContain(listAnchor["001"]);
      }
    });

    it("QA1-T-X-3 · tự-kiểm: pha 3 làm ảnh chụp của A ĐỔI; 7 cột đếm vẫn khớp", async () => {
      const after = await snapshot(w.A.companyId);
      expect(after.feed_posts).not.toEqual(before.feed_posts);
      expect(after.feed_groups).not.toEqual(before.feed_groups);
      await expectCountersReconciled(w.direct, w.companyIds);
    });
  });
});
