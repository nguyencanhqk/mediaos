/**
 * S16-SOCIAL-QA-1 (L8) — FUZZ CÓ HẠT GIỐNG trên đầu vào tự do của bảng tin (plan
 * `docs/plans/S16-SOCIAL-QA-1.md` §4-L8, D11, Bảng 3 các dòng QA1-F).
 *
 *   F-0  tự-kiểm bộ sinh (tái lập được, chạm đủ lớp)    F-M  mảng `mentionedUserIds`
 *   F-B  thân bài                                        F-E  giá trị cảm xúc cho 011 / 018
 *   F-H  hashtag trong thân bài                          F-X  ngân sách request + đối soát cột đếm
 *
 * Luật đo:
 *  - Bộ sinh `mulberry32` với HẠT GIỐNG CỐ ĐỊNH: mỗi lượt chạy gửi đúng cùng một corpus. Ca vi phạm in
 *    ra `seed` + chỉ số + đầu vào (đã JSON hoá) để tái lập bằng tay.
 *  - Bất biến chung: không bao giờ 5xx; lỗi luôn mang hình dạng chuẩn (`success:false` + `error.code`).
 *  - Mỗi cụm phải chạm CẢ HAI nhánh (nhận / từ chối) — fuzz chỉ toàn 400 hay chỉ toàn 201 là rỗng.
 *  - Corpus KHÔNG chứa ký tự điều khiển (trừ xuống dòng / tab): lớp đó có ca riêng ngoài corpus (D11).
 *  - Tổng số request của bộ sinh ≤ 260 (đếm bằng máy ở F-X).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  addComment,
  bootQa1World,
  sharePost,
  stripVolatile,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { expectCountersReconciled } from "../helpers/social-qa1-kit-counters";
import { mapLimit, mulberry32 } from "../helpers/social-qa1-kit-race";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const FUZZ_TIMEOUT_MS = 60_000;
const PARALLEL = 4;
const REQUEST_BUDGET = 260;
const BODY_MAX = 4000;

const SEED_BODY = 0x51a1_b0d1;
const SEED_TAG = 0x51a1_7a65;
const SEED_MENTION = 0x51a1_3e17;
const SEED_EMOJI = 0x51a1_e301;
const hex = (seed: number): string => `0x${seed.toString(16)}`;

// ─── Bộ sinh ──────────────────────────────────────────────────────────────────────────────────────

type Rnd = () => number;
const pick = <T>(rnd: Rnd, items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;
const int = (rnd: Rnd, lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

/** Mảnh ghép của thân bài — KHÔNG có dấu thăng (hashtag đo ở F-H) và không có ký tự điều khiển. */
const BODY_FRAGMENTS: readonly string[] = [
  "Xin chào",
  "tiếng Việt có dấu: ắ ằ ẳ ẵ ặ ữ ợ",
  "😀",
  "🧑\u200D🤝\u200D🧑", // chuỗi nối ZWJ
  "👩🏽\u200D💻",
  "🇻🇳",
  "\u{1F9D1}\u{1F3FF}",
  "\u{20BB7}", // chữ Hán ngoài BMP
  "مرحبا بالعالم", // phải-sang-trái
  "שלום",
  "\u202Eđảo chiều\u202C",
  "\u200F",
  "a\u00A0b", // NBSP ở giữa
  "\u200B", // zero-width space
  "\u200D",
  "\u2060",
  "e\u0301", // dấu rời
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "<b>đậm</b> &amp; &lt;thẻ&gt;",
  "javascript:alert(1)",
  "' OR 1=1 --",
  '"; DROP TABLE x; --',
  "%00 %s %n \\n \\u0000",
  "dòng một\ndòng hai\tcột",
  "{{7*7}} ${7*7}",
  "\\",
];

/** Khoảng trắng mà `trim()` cắt — dùng cho ca «chỉ khoảng trắng» và viền của thân hợp lệ. */
const WHITESPACE: readonly string[] = [" ", "\t", "\n", "\u00A0", "\uFEFF", "\u2003", "\u3000"];

/** Có ký tự điều khiển (C0 trừ tab / xuống dòng, hoặc DEL) hay không — đếm theo mã, không regex. */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

interface BodyCase {
  body: string;
  /** Kỳ vọng tính ĐỘC LẬP với sản phẩm: sau `trim()`, độ dài (đơn vị UTF-16) trong 1…4000 ⇒ 201. */
  expect: 201 | 400;
  kind: string;
}

const expectBody = (body: string): 201 | 400 => {
  const n = body.trim().length;
  return n >= 1 && n <= BODY_MAX ? 201 : 400;
};

function bodyCorpus(): BodyCase[] {
  const rnd = mulberry32(SEED_BODY);
  const out: BodyCase[] = [];
  const push = (body: string, kind: string): void => {
    out.push({ body, expect: expectBody(body), kind });
  };
  // Ca biên đặt tên tường minh.
  push("x".repeat(BODY_MAX), "đúng 4000 đơn vị");
  push("x".repeat(BODY_MAX + 1), "4001 đơn vị");
  push("😀".repeat(BODY_MAX / 2), "2000 ký tự ngoài BMP = 4000 đơn vị");
  push("😀".repeat(BODY_MAX / 2 + 1), "2001 ký tự ngoài BMP");
  push(`  ${"y".repeat(BODY_MAX)}\n`, "4000 đơn vị + viền khoảng trắng");
  push("   ", "chỉ dấu cách");
  push("\u00A0\u00A0", "chỉ NBSP");
  push("\uFEFF", "chỉ BOM");
  push("\n\t \u3000", "chỉ khoảng trắng hỗn hợp");
  push("\u200B", "chỉ zero-width space");
  push("\u2060\u200D", "chỉ ký tự nối vô hình");
  push("<script>alert(1)</script>", "HTML thuần");
  // Súp mảnh ghép có hạt giống.
  for (let n = 0; n < 36; n++) {
    const parts = int(rnd, 1, 6);
    let body = rnd() < 0.3 ? pick(rnd, WHITESPACE) : "";
    for (let k = 0; k < parts; k++) {
      body += pick(rnd, BODY_FRAGMENTS);
      if (rnd() < 0.5) body += pick(rnd, [" ", "\n", ""]);
    }
    if (rnd() < 0.3) body += pick(rnd, WHITESPACE);
    if (rnd() < 0.12) body = pick(rnd, WHITESPACE).repeat(int(rnd, 1, 5));
    push(body, "súp mảnh ghép");
  }
  return out;
}

const TAG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_";

/** Một token `[a-z0-9_]` rồi đổi hoa-thường ngẫu nhiên; trả cả dạng chuẩn (chữ thường). */
function tagToken(rnd: Rnd, pool: readonly string[]): { raw: string; canon: string } {
  const canon = pick(rnd, pool);
  let raw = "";
  for (const ch of canon) raw += rnd() < 0.5 ? ch.toUpperCase() : ch;
  return { raw, canon };
}

interface TagCase {
  body: string;
  /** Tập thẻ kỳ vọng (chữ thường, không trùng) — so theo TẬP. */
  tags: string[];
}

function tagCorpus(prefix: string): TagCase[] {
  const rnd = mulberry32(SEED_TAG);
  const pool: string[] = [];
  for (let i = 0; i < 9; i++) {
    let t = prefix;
    const len = int(rnd, 2, 10);
    for (let k = 0; k < len; k++) t += TAG_ALPHABET[Math.floor(rnd() * TAG_ALPHABET.length)];
    if (!pool.includes(t)) pool.push(t);
  }
  const out: TagCase[] = [];
  for (let n = 0; n < 20; n++) {
    const count = int(rnd, 1, 5);
    const tags: string[] = [];
    const words: string[] = [`bài ${n}`];
    for (let k = 0; k < count; k++) {
      const t = tagToken(rnd, pool);
      words.push(`#${t.raw}`);
      if (!tags.includes(t.canon)) tags.push(t.canon);
      if (rnd() < 0.4) words.push(pick(rnd, ["và", "😀", "—", "xem thêm"]));
    }
    out.push({ body: words.join(" "), tags });
  }
  return out;
}

// ─── Thu kết quả ──────────────────────────────────────────────────────────────────────────────────

const show = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}… (${s.length} ký tự)` : s;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** So TẬP thẻ — thứ tự của `tags` trong thẻ bài không được tài liệu nào cam kết. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  same([...a].sort(), [...b].sort());

/** Lỗi có hình dạng chuẩn: `success:false` + `error.code` là chuỗi không rỗng. */
function badErrorShape(res: Qa1Res): string | null {
  const code = res.body?.error?.code;
  if (res.body?.success !== false) return "thiếu success:false";
  if (typeof code !== "string" || code.length === 0) return "thiếu error.code";
  return null;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L8 · fuzz có hạt giống", () => {
  let w: Qa1World;
  let author: Qa1Actor;
  /** Người được nhắc hợp lệ. */
  let friend: Qa1Actor;
  let friend2: Qa1Actor;
  /** Tài khoản bị khoá sau khi dựng. */
  let locked: Qa1Actor;
  /** Hồ sơ nhân viên đã nghỉ, tài khoản còn hoạt động. */
  let resigned: Qa1Actor;
  /** Người của công ty B. */
  let outsider: Qa1Actor;
  /** Hai người thả cảm xúc: một cho giá trị hợp lệ, một cho giá trị sai. */
  let reactor: Qa1Actor;
  let badReactor: Qa1Actor;

  /** Số request do bộ sinh gửi (không tính dựng thế giới). */
  let sent = 0;
  const tagPrefix = `fz${randomUUID().replace(/-/g, "").slice(0, 6)}`;

  const dataOf = (res: Qa1Res): Json => (res.body?.data ?? {}) as Json;
  const postBody = (body: string, extra: Json = {}): Json => ({
    type: "share",
    audience: "company",
    body,
    ...extra,
  });
  async function send(req: PromiseLike<Qa1Res>): Promise<Qa1Res> {
    sent += 1;
    return req;
  }

  beforeAll(async () => {
    w = await bootQa1World("qa1fuzz");
    author = await w.actor(w.A, "author", { pairs: EMPLOYEE_FEED_PAIRS });
    friend = await w.actor(w.A, "friend", { pairs: ["view:feed"] });
    friend2 = await w.actor(w.A, "friend2", { pairs: ["view:feed"] });
    locked = await w.actor(w.A, "locked", { pairs: ["view:feed"] });
    resigned = await w.actor(w.A, "resigned", {
      pairs: ["view:feed"],
      profile: { status: "resigned" },
    });
    outsider = await w.actor(w.B, "outsider", { pairs: ["view:feed"] });
    reactor = await w.actor(w.A, "reactor", { pairs: ["view:feed"] });
    badReactor = await w.actor(w.A, "badreactor", { pairs: ["view:feed"] });
    await w.direct.query(`UPDATE users SET status = 'locked' WHERE id = $1 AND company_id = $2`, [
      locked.userId,
      w.A.companyId,
    ]);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  it("QA1-F-0 tự-kiểm bộ sinh: cùng hạt giống ⇒ cùng corpus; corpus chạm đủ các lớp và cả hai nhánh", () => {
    const a = bodyCorpus();
    const b = bodyCorpus();
    expect(a.map((c) => c.body)).toEqual(b.map((c) => c.body));
    expect(tagCorpus("p")).toEqual(tagCorpus("p"));
    const all = a.map((c) => c.body).join(" | ");
    for (const [name, re] of [
      ["ngoài BMP", /[\u{10000}-\u{10FFFF}]/u],
      ["ZWJ", /\u200D/],
      ["phải-sang-trái", /[\u0590-\u06FF]/],
      ["NBSP", /\u00A0/],
      ["zero-width", /\u200B/],
      ["HTML", /<script>/],
    ] as const) {
      expect(re.test(all), `corpus có lớp ${name}`).toBe(true);
    }
    // Lớp ký tự điều khiển đứng NGOÀI corpus (trừ xuống dòng và tab); bộ dò tự-kiểm trước.
    expect(hasControlChar(`a${String.fromCharCode(0)}b`)).toBe(true);
    expect(hasControlChar(`a${String.fromCharCode(0x1f)}`)).toBe(true);
    expect(hasControlChar("a\n\tb")).toBe(false);
    for (const c of a) expect(hasControlChar(c.body), show(c.body)).toBe(false);
    expect(a.filter((c) => c.expect === 201).length).toBeGreaterThanOrEqual(10);
    expect(a.filter((c) => c.expect === 400).length).toBeGreaterThanOrEqual(6);
    expect(a.length).toBeLessThanOrEqual(50);
  });

  it(
    "QA1-F-B thân bài: không bao giờ 5xx; nhận ⇔ sau khi cắt viền còn 1…4000 đơn vị; bài nhận đọc lại đúng chuỗi đã gửi",
    async () => {
      const corpus = bodyCorpus();
      const results = await mapLimit(corpus, PARALLEL, async (c) => {
        const created = await send(w.post(author.token, "/social/posts").send(postBody(c.body)));
        let readBack: string | null = null;
        if (created.status === 201) {
          const read = await send(
            w.get(friend.token, `/social/posts/${String(dataOf(created).id)}`),
          );
          readBack = read.status === 200 ? (dataOf(read).body as string) : `<${read.status}>`;
        }
        return { created, readBack };
      });

      const violations: string[] = [];
      let accepted = 0;
      let rejected = 0;
      results.forEach(({ created, readBack }, i) => {
        const c = corpus[i]!;
        const where = `seed=${hex(SEED_BODY)} #${i} (${c.kind}) body=${show(c.body)}`;
        if (created.status >= 500) {
          violations.push(`5xx ${created.status} · ${where} · ${show(created.body)}`);
          return;
        }
        if (created.status !== c.expect) {
          violations.push(`mong ${c.expect} nhận ${created.status} · ${where}`);
          return;
        }
        if (created.status === 201) {
          accepted += 1;
          const want = c.body.trim();
          if (dataOf(created).body !== want)
            violations.push(`thân trả về khác thân gửi · ${where}`);
          if (readBack !== want) violations.push(`đọc lại khác thân gửi · ${where}`);
        } else {
          rejected += 1;
          const bad = badErrorShape(created);
          if (bad) violations.push(`${bad} · ${where} · ${show(created.body)}`);
        }
      });
      expect(violations, violations.join("\n")).toEqual([]);
      expect(accepted, "nhánh nhận được chạm").toBeGreaterThanOrEqual(10);
      expect(rejected, "nhánh từ chối được chạm").toBeGreaterThanOrEqual(6);
    },
    FUZZ_TIMEOUT_MS,
  );

  it(
    "QA1-F-H hashtag: cùng thẻ khác hoa-thường là MỘT thẻ; gửi lại cùng thân ⇒ cùng tập thẻ; cột lượt dùng khớp",
    async () => {
      const p = tagPrefix;
      // Bảng biên viết tay: thân → tập thẻ kỳ vọng.
      const table: TagCase[] = [
        { body: `#${p}Tag #${p}tag #${p}TAG`, tags: [`${p}tag`] },
        { body: `Tuyển #${p}TuyểnDụng gấp`, tags: [`${p}tuyểndụng`] },
        { body: `abc#${p}giua không phải thẻ`, tags: [] },
        { body: `#${p}a1#${p}b1`, tags: [`${p}a1`] },
        { body: `#${p}gach-noi #${p}cham.cau`, tags: [`${p}gach`, `${p}cham`] },
        { body: `#${p}${"k".repeat(64 - p.length)}`, tags: [`${p}${"k".repeat(64 - p.length)}`] },
        { body: `#${p}${"d".repeat(65 - p.length)} quá dài`, tags: [] },
        {
          body: Array.from({ length: 21 }, (_, i) => `#${p}n${i}`).join(" "),
          tags: Array.from({ length: 20 }, (_, i) => `${p}n${i}`),
        },
        { body: `＃${p}fullwidth không phải thẻ`, tags: [] },
        { body: `# ${p}roi ## #`, tags: [] },
      ];
      const violations: string[] = [];
      const tagsOf = (res: Qa1Res, where: string): string[] | null => {
        if (res.status >= 500) {
          violations.push(`5xx ${res.status} · ${where} · ${show(res.body)}`);
          return null;
        }
        if (res.status !== 201) {
          violations.push(`mong 201 nhận ${res.status} · ${where} · ${show(res.body)}`);
          return null;
        }
        return dataOf(res).tags as string[];
      };

      const tableRes = await mapLimit(table, PARALLEL, (c) =>
        send(w.post(author.token, "/social/posts").send(postBody(c.body))),
      );
      // Ca đầu bảng đứng riêng để thông điệp đỏ nói đúng bất biến.
      expect(dataOf(tableRes[0]!).tags, "cùng thẻ khác hoa thường phải là MỘT thẻ").toEqual(
        table[0]!.tags,
      );
      tableRes.forEach((res, i) => {
        const c = table[i]!;
        const tags = tagsOf(res, `bảng biên #${i} body=${show(c.body)}`);
        if (tags !== null && !sameSet(tags, c.tags)) {
          violations.push(
            `bảng biên #${i}: mong ${show(c.tags)} nhận ${show(tags)} · ${show(c.body)}`,
          );
        }
      });
      expect(violations, violations.join("\n")).toEqual([]);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);

      // Corpus có hạt giống — mỗi thân gửi HAI lần.
      const corpus = tagCorpus(p);
      const twice = await mapLimit(corpus, PARALLEL, async (c) => {
        const first = await send(w.post(author.token, "/social/posts").send(postBody(c.body)));
        const second = await send(w.post(author.token, "/social/posts").send(postBody(c.body)));
        return { first, second };
      });
      twice.forEach(({ first, second }, i) => {
        const c = corpus[i]!;
        const where = `seed=${hex(SEED_TAG)} #${i} body=${show(c.body)}`;
        const t1 = tagsOf(first, where);
        const t2 = tagsOf(second, `${where} (lần hai)`);
        if (t1 === null || t2 === null) return;
        if (!sameSet(t1, c.tags)) {
          violations.push(
            `cùng thẻ khác hoa thường phải là MỘT thẻ: mong ${show(c.tags)} nhận ${show(t1)} · ${where}`,
          );
        }
        if (!sameSet(t1, t2)) {
          violations.push(`gửi lại cho tập thẻ khác: ${show(t1)} ≠ ${show(t2)} · ${where}`);
        }
        for (const t of t1) {
          if (t !== t.toLowerCase() || t.length > 64) {
            violations.push(`thẻ sai dạng ${show(t)} · ${where}`);
          }
        }
        if (new Set(t1).size !== t1.length || t1.length > 20) {
          violations.push(`thẻ trùng / quá 20 · ${where}`);
        }
      });
      expect(violations, violations.join("\n")).toEqual([]);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);

      // Neo dương: thẻ thật sự được tạo, lượt dùng đếm theo BÀI (ca đầu bảng chỉ góp 1 lượt).
      const listed = await send(w.get(author.token, `/social/tags?q=${p}tag`));
      expect(listed.status, show(listed.body)).toBe(200);
      const page = listed.body as { data?: { data?: Json[] } | Json[] };
      const items = (Array.isArray(page.data) ? page.data : (page.data?.data ?? [])) as Json[];
      const exact = items.find((t) => t.tag === `${p}tag`);
      expect(exact, `024 liệt kê thẻ ${p}tag: ${show(items)}`).toBeDefined();
      expect(exact!.usageCount).toBe(1);

      // Sửa bài A → B → A rồi xoá: cột lượt dùng vẫn khớp sau từng bước.
      const a = `Sửa thẻ #${p}suaa #${p}chung`;
      const b = `Sửa thẻ #${p}suab #${p}chung`;
      const made = await send(w.post(author.token, "/social/posts").send(postBody(a)));
      expect(made.status, show(made.body)).toBe(201);
      const id = String(dataOf(made).id);
      for (const [text, want] of [
        [b, [`${p}suab`, `${p}chung`]],
        [a, [`${p}suaa`, `${p}chung`]],
      ] as const) {
        const edited = await send(
          w.patch(author.token, `/social/posts/${id}`).send({ body: text }),
        );
        expect(edited.status, show(edited.body)).toBe(200);
        expect([...(dataOf(edited).tags as string[])].sort()).toEqual([...want].sort());
        await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);
      }
      const usage = async (tag: string): Promise<number | undefined> => {
        const r = await w.direct.query(
          `SELECT usage_count FROM feed_tags WHERE company_id = $1 AND tag = $2`,
          [w.A.companyId, tag],
        );
        return r.rows[0]?.usage_count as number | undefined;
      };
      expect(await usage(`${p}suaa`)).toBe(1);
      expect(await usage(`${p}suab`)).toBe(0);
      const removed = await send(w.del(author.token, `/social/posts/${id}`));
      expect(removed.status, show(removed.body)).toBe(200);
      expect(await usage(`${p}suaa`)).toBe(0);
      expect(await usage(`${p}chung`)).toBe(0);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);
    },
    FUZZ_TIMEOUT_MS,
  );

  it(
    "QA1-F-M `mentionedUserIds`: chỉ người hợp lệ được ghi; id công ty khác luôn bị bỏ và không sinh sự kiện; id bịa ≡ id công ty khác",
    async () => {
      const rnd = mulberry32(SEED_MENTION);
      const fake = (): string => randomUUID();
      type Kind = "friend" | "friend2" | "self" | "locked" | "resigned" | "outsider" | "fake";
      const idOf = (k: Kind): string =>
        ({
          friend: friend.userId,
          friend2: friend2.userId,
          self: author.userId,
          locked: locked.userId,
          resigned: resigned.userId,
          outsider: outsider.userId,
          fake: fake(),
        })[k];
      const VALID = new Set<string>([friend.userId, friend2.userId]);
      const KINDS: readonly Kind[] = [
        "friend",
        "friend2",
        "self",
        "locked",
        "resigned",
        "outsider",
        "fake",
      ];

      interface MentionCase {
        ids: string[];
        expect: 201 | 400;
        kind: string;
      }
      const cases: MentionCase[] = [
        { ids: [], expect: 201, kind: "mảng rỗng" },
        { ids: [friend.userId], expect: 201, kind: "một người hợp lệ" },
        { ids: [friend.userId, friend.userId, friend.userId], expect: 201, kind: "trùng lặp" },
        { ids: [author.userId], expect: 201, kind: "chính mình" },
        { ids: [locked.userId], expect: 201, kind: "tài khoản khoá" },
        { ids: [resigned.userId], expect: 201, kind: "người đã nghỉ" },
        { ids: [outsider.userId], expect: 201, kind: "người công ty khác" },
        { ids: Array.from({ length: 50 }, fake), expect: 201, kind: "50 phần tử" },
        { ids: Array.from({ length: 51 }, fake), expect: 400, kind: "51 phần tử" },
        { ids: ["khong-phai-uuid"], expect: 400, kind: "không phải uuid" },
      ];
      for (let n = 0; n < 18; n++) {
        const len = int(rnd, 1, 6);
        const ids: string[] = [];
        for (let k = 0; k < len; k++) ids.push(idOf(pick(rnd, KINDS)));
        // Mọi ca sinh đều mang người công ty khác ở một vị trí ngẫu nhiên.
        ids.splice(int(rnd, 0, ids.length), 0, outsider.userId);
        cases.push({ ids, expect: 201, kind: "tổ hợp có hạt giống" });
      }

      const results = await mapLimit(cases, PARALLEL, (c, i) =>
        send(
          w
            .post(author.token, "/social/posts")
            .send(postBody(`Nhắc tên ca ${i}`, { mentionedUserIds: c.ids })),
        ),
      );

      const violations: string[] = [];
      let acceptedRows = 0;
      let rejected = 0;
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!;
        const res = results[i]!;
        const where = `seed=${hex(SEED_MENTION)} #${i} (${c.kind}) ids=${show(c.ids)}`;
        if (res.status >= 500) {
          violations.push(`5xx ${res.status} · ${where} · ${show(res.body)}`);
          continue;
        }
        if (res.status !== c.expect) {
          violations.push(`mong ${c.expect} nhận ${res.status} · ${where} · ${show(res.body)}`);
          continue;
        }
        if (res.status === 400) {
          rejected += 1;
          const bad = badErrorShape(res);
          if (bad) violations.push(`${bad} · ${where}`);
          continue;
        }
        const postId = String(dataOf(res).id);
        const wantAccepted = [...new Set(c.ids.filter((id) => VALID.has(id)))].sort();
        const wantDropped = [...new Set(c.ids.filter((id) => !VALID.has(id)))].sort();
        const dropped = [...((dataOf(res).droppedMentions ?? []) as string[])].sort();
        if (!same(dropped, wantDropped)) {
          violations.push(
            `droppedMentions: mong ${show(wantDropped)} nhận ${show(dropped)} · ${where}`,
          );
        }
        if (c.ids.includes(outsider.userId) && !dropped.includes(outsider.userId)) {
          violations.push(`id công ty khác KHÔNG nằm trong droppedMentions · ${where}`);
        }
        const rows = await w.direct.query(
          `SELECT mentioned_user_id FROM feed_mentions
            WHERE company_id = $1 AND target_type = 'post' AND target_id = $2`,
          [w.A.companyId, postId],
        );
        const stored = rows.rows.map((r) => r.mentioned_user_id as string).sort();
        if (!same(stored, wantAccepted)) {
          violations.push(
            `hàng nhắc tên: mong ${show(wantAccepted)} nhận ${show(stored)} · ${where}`,
          );
        }
        const events = await w.direct.query(
          `SELECT payload->>'mentionedUserId' AS u FROM outbox_events
            WHERE company_id = $1 AND event_type = 'social.mentioned' AND payload->>'postId' = $2`,
          [w.A.companyId, postId],
        );
        const notified = events.rows.map((r) => r.u as string).sort();
        if (!same(notified, wantAccepted)) {
          violations.push(
            `sự kiện nhắc tên: mong ${show(wantAccepted)} nhận ${show(notified)} · ${where}`,
          );
        }
        acceptedRows += stored.length;
      }
      expect(violations, violations.join("\n")).toEqual([]);
      expect(acceptedRows, "ít nhất một lượt nhắc tên hợp lệ thật sự được ghi").toBeGreaterThan(0);
      expect(rejected, "nhánh từ chối được chạm").toBe(2);

      // Không hàng nào, không sự kiện nào — ở BẤT KỲ công ty nào — trỏ tới người công ty khác.
      const leakedRows = await w.direct.query(
        `SELECT count(*)::int AS n FROM feed_mentions
          WHERE mentioned_user_id = $1 OR company_id = $2`,
        [outsider.userId, w.B.companyId],
      );
      expect(leakedRows.rows[0].n, "hàng nhắc tên chạm công ty khác").toBe(0);
      const leakedEvents = await w.direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
          WHERE event_type = 'social.mentioned'
            AND (payload->>'mentionedUserId' = $1 OR company_id = $2)`,
        [outsider.userId, w.B.companyId],
      );
      expect(leakedEvents.rows[0].n, "sự kiện nhắc tên chạm công ty khác").toBe(0);

      // «id bịa» và «id công ty khác» cho hai response không phân biệt được (trừ chính id).
      const sameText = "Nhắc tên đối chứng";
      const withFake = await send(
        w
          .post(author.token, "/social/posts")
          .send(postBody(sameText, { mentionedUserIds: [fake()] })),
      );
      const withOutsider = await send(
        w
          .post(author.token, "/social/posts")
          .send(postBody(sameText, { mentionedUserIds: [outsider.userId] })),
      );
      expect(withFake.status).toBe(201);
      expect(withOutsider.status).toBe(201);
      expect((dataOf(withOutsider).droppedMentions as string[]) ?? []).toEqual([outsider.userId]);
      expect(stripVolatile(withOutsider.body, { uuids: true })).toEqual(
        stripVolatile(withFake.body, { uuids: true }),
      );
    },
    FUZZ_TIMEOUT_MS,
  );

  it(
    "QA1-F-E cảm xúc 011 / 018: sáu giá trị hợp lệ ⇒ 200; mọi giá trị khác ⇒ đúng 400 và không ghi hàng nào",
    async () => {
      const post = await sharePost(w, author, "Bài nhận cảm xúc fuzz");
      const comment = await addComment(w, author, post.id);
      const VALID = ["like", "love", "haha", "wow", "sad", "angry"] as const;
      const INVALID: readonly Json[] = [
        { emoji: "👍" },
        { emoji: "❤️" },
        { emoji: "LIKE" },
        { emoji: "Like" },
        { emoji: " like" },
        { emoji: "like " },
        { emoji: "like\u200B" },
        { emoji: "" },
        { emoji: null },
        { emoji: 1 },
        { emoji: true },
        { emoji: ["like"] },
        { emoji: { value: "like" } },
        { emoji: "thumbsup" },
        { emoji: "x".repeat(300) },
        {},
        { emoji: "like", mine: true },
        { emoji: "like", userId: author.userId },
      ];
      // Thứ tự gửi xáo theo hạt giống (Fisher–Yates).
      const rnd = mulberry32(SEED_EMOJI);
      const shuffled = [...INVALID];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const targets = [
        { name: "011", url: `/social/posts/${post.id}/reaction`, type: "post", id: post.id },
        {
          name: "018",
          url: `/social/comments/${comment.id}/reaction`,
          type: "comment",
          id: comment.id,
        },
      ] as const;

      const violations: string[] = [];
      for (const t of targets) {
        const bad = await mapLimit(shuffled, PARALLEL, (body) =>
          send(w.put(badReactor.token, t.url).send(body)),
        );
        bad.forEach((res, i) => {
          const where = `seed=${hex(SEED_EMOJI)} ${t.name} #${i} body=${show(shuffled[i])}`;
          if (res.status !== 400) {
            violations.push(`mong 400 nhận ${res.status} · ${where} · ${show(res.body)}`);
          } else if (badErrorShape(res)) {
            violations.push(`${badErrorShape(res)} · ${where}`);
          }
        });
        // Giá trị hợp lệ đi TUẦN TỰ (cùng một người đổi loại): luôn đúng 1 hàng.
        for (const emoji of VALID) {
          const ok = await send(w.put(reactor.token, t.url).send({ emoji }));
          if (ok.status !== 200) {
            violations.push(
              `${t.name} emoji=${emoji}: mong 200 nhận ${ok.status} · ${show(ok.body)}`,
            );
            continue;
          }
          const data = dataOf(ok);
          if (data.likeCount !== 1 || !same(data.reactions, [{ emoji, count: 1, mine: true }])) {
            violations.push(`${t.name} emoji=${emoji}: tổng hợp sai ${show(data)}`);
          }
        }
        const rows = await w.direct.query(
          `SELECT user_id, emoji FROM feed_reactions
            WHERE company_id = $1 AND target_type = $2 AND target_id = $3`,
          [w.A.companyId, t.type, t.id],
        );
        expect(rows.rows, `${t.name}: chỉ một hàng — của người gửi giá trị hợp lệ`).toEqual([
          { user_id: reactor.userId, emoji: "angry" },
        ]);
      }
      expect(violations, violations.join("\n")).toEqual([]);
      const none = await w.direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions WHERE company_id = $1 AND user_id = $2`,
        [w.A.companyId, badReactor.userId],
      );
      expect(none.rows[0].n, "người gửi giá trị sai không có hàng nào").toBe(0);
    },
    FUZZ_TIMEOUT_MS,
  );

  it("QA1-F-X ngân sách request của bộ sinh ≤ 260; đối soát cột đếm sau toàn bộ fuzz", async () => {
    expect(sent, "bộ sinh đã thật sự gửi request").toBeGreaterThan(150);
    expect(sent).toBeLessThanOrEqual(REQUEST_BUDGET);
    await expectCountersReconciled(w.direct, w.companyIds, [
      "feed_posts.like_count",
      "feed_posts.comment_count",
      "feed_comments.like_count",
      "feed_tags.usage_count",
    ]);
  });
});
