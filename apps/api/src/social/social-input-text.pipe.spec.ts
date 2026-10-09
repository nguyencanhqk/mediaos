import fs from "node:fs";
import path from "node:path";
import type { ArgumentMetadata } from "@nestjs/common";
import { feedRecycleBinQuerySchema } from "@mediaos/contracts";
import { ZodValidationException } from "nestjs-zod";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_INPUT_TEXT_MAX_ISSUES,
  SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS,
  SOCIAL_INPUT_TEXT_MESSAGE,
  SocialInputTextPipe,
  findNulPaths,
} from "./social-input-text.pipe";

/**
 * S16-SOCIAL-QA-1 (QA1-BUG-2) — lớp chặn U+0000 ở biên đầu vào của SOCIAL.
 *
 *   A. `findNulPaths` — quét sâu (object · mảng · tên khoá), không đệ quy, có trần số mục.
 *   B. `SocialInputTextPipe` — thân + query ⇒ `ZodValidationException`; kênh khác đi qua nguyên vẹn.
 *   C. KIỂM ĐỦ TĨNH — mọi controller SOCIAL gắn lớp chặn ở cấp class, đứng đầu danh sách pipe.
 *      Không cần Postgres, không boot app: đọc AST của file nguồn.
 */

const NUL = String.fromCharCode(0);
const bad = (head = "a", tail = "b"): string => `${head}${NUL}${tail}`;
const meta = (type: ArgumentMetadata["type"], data?: string): ArgumentMetadata => ({ type, data });

describe("findNulPaths", () => {
  it("giá trị sạch (mọi kiểu) ⇒ rỗng", () => {
    const clean = { a: "x", b: [1, true, null, "y", { c: "z" }], d: undefined, e: 3 };
    expect(findNulPaths(clean)).toEqual([]);
    expect(findNulPaths("van ban")).toEqual([]);
    expect(findNulPaths(undefined)).toEqual([]);
    expect(findNulPaths(null)).toEqual([]);
  });

  it("chuỗi ở gốc · trong object lồng · trong mảng ⇒ đúng đường dẫn, theo thứ tự xuất hiện", () => {
    expect(findNulPaths(bad())).toEqual([[]]);
    const value = { body: bad(), poll: { question: bad(), options: ["ok", bad(), "ok", bad()] } };
    expect(findNulPaths(value)).toEqual([
      ["body"],
      ["poll", "question"],
      ["poll", "options", 1],
      ["poll", "options", 3],
    ]);
  });

  it("mảng lồng mảng · object trong mảng ⇒ vẫn tìm thấy", () => {
    expect(findNulPaths([["ok", [bad()]], { items: [{ label: bad() }] }])).toEqual([
      [0, 1, 0],
      [1, "items", 0, "label"],
    ]);
  });

  it("các ký tự điều khiển KHÁC không bị coi là vi phạm", () => {
    const others = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join("");
    expect(findNulPaths({ body: `${others}${String.fromCharCode(127)}` })).toEqual([]);
  });

  it("tên khoá chứa U+0000 hoặc ngoài bảng chữ an toàn ⇒ đường dẫn mang `?`, không mang tên khoá", () => {
    expect(findNulPaths({ [bad("k", "k")]: "sach" })).toEqual([["?"]]);
    expect(findNulPaths({ "khoa <la>": bad() })).toEqual([["?"]]);
    expect(findNulPaths({ ["x".repeat(65)]: bad() })).toEqual([["?"]]);
  });

  it("trần số mục: không trả quá `limit`", () => {
    const many = Array.from({ length: SOCIAL_INPUT_TEXT_MAX_ISSUES * 3 }, () => bad());
    expect(findNulPaths(many)).toHaveLength(SOCIAL_INPUT_TEXT_MAX_ISSUES);
    expect(findNulPaths(many, [], 2)).toEqual([[0], [1]]);
  });

  it("thân lồng rất sâu ⇒ không tràn ngăn xếp, vẫn tìm thấy chuỗi ở đáy", () => {
    const DEPTH = 200_000;
    let deep: unknown = bad();
    for (let i = 0; i < DEPTH; i += 1) deep = [deep];
    const found = findNulPaths(deep);
    expect(found).toHaveLength(1);
    // Đường dẫn nêu ra bị cắt ở số đoạn tối đa — `field` không dài theo độ sâu của request.
    expect(found[0]).toEqual(Array.from({ length: SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS }, () => 0));
  });

  it("đường dẫn dài hơn trần ⇒ giữ các đoạn ĐẦU (tính cả đoạn gốc được trao)", () => {
    const value = { a: { b: { c: { d: bad() } } } };
    expect(findNulPaths(value, ["root"])).toEqual([["root", "a", "b", "c", "d"]]);
    let deep: unknown = bad();
    for (let i = SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS + 3; i >= 0; i -= 1)
      deep = { [`k${i}`]: deep };
    const [only] = findNulPaths(deep, ["root"]);
    expect(only).toEqual([
      "root",
      ...Array.from({ length: SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS - 1 }, (_, i) => `k${i}`),
    ]);
  });
});

describe("SocialInputTextPipe", () => {
  const pipe = new SocialInputTextPipe();

  it("thân / query sạch ⇒ trả NGUYÊN giá trị (cùng tham chiếu)", () => {
    const body = { body: "van ban", poll: { options: ["Một", "Hai"] } };
    expect(pipe.transform(body, meta("body"))).toBe(body);
    const query = { q: "tim", limit: "20" };
    expect(pipe.transform(query, meta("query"))).toBe(query);
  });

  it.each(["body", "query"] as const)(
    "%s có U+0000 ⇒ ZodValidationException nêu trường",
    (type) => {
      let thrown: unknown;
      try {
        pipe.transform({ q: bad("dau", "cuoi"), nested: { list: ["ok", bad()] } }, meta(type));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ZodValidationException);
      const issues = (thrown as ZodValidationException).getZodError().issues;
      expect(issues.map((i) => i.path.join("."))).toEqual(["q", "nested.list.1"]);
      expect(issues.every((i) => i.code === "custom")).toBe(true);
      expect(issues.every((i) => i.message === SOCIAL_INPUT_TEXT_MESSAGE)).toBe(true);
      // Không dội lại nội dung đã gửi ở bất kỳ đâu trong lỗi.
      const dump = JSON.stringify(issues);
      expect(dump.includes("dau")).toBe(false);
      expect(dump.includes("cuoi")).toBe(false);
      expect(dump.includes("\\u0000")).toBe(false);
    },
  );

  it("`@Query('q')` trao riêng một trường ⇒ đường dẫn bắt đầu từ tên trường", () => {
    expect(() => pipe.transform(bad(), meta("query", "q"))).toThrow(ZodValidationException);
    try {
      pipe.transform(bad(), meta("query", "q"));
    } catch (e) {
      expect((e as ZodValidationException).getZodError().issues[0]?.path).toEqual(["q"]);
    }
  });

  it.each(["param", "custom"] as const)(
    "kênh %s ⇒ đi qua nguyên vẹn (không thuộc lớp này)",
    (type) => {
      const value = bad();
      expect(pipe.transform(value, meta(type, "post_id"))).toBe(value);
    },
  );
});

// ───────────────────────────── C. KIỂM ĐỦ TĨNH ─────────────────────────────

const SRC_SOCIAL = __dirname;
const RECYCLE_CONTROLLER = path.join(
  __dirname,
  "..",
  "recycle-bin",
  "recycle-bin-feed-posts.controller.ts",
);
const TWO_LAYER_CENSUS = path.join(
  __dirname,
  "..",
  "..",
  "test",
  "foundation",
  "social-two-layer-guard-census.unit-spec.ts",
);
const PIPE_NAME = "SocialInputTextPipe";
/**
 * Controller SOCIAL sống NGOÀI `src/social/` và KHÔNG gắn lớp chặn — mỗi tên phải có một phép đo
 * riêng bên dưới chứng minh nó không nhận chuỗi tự do nào. Thêm tên vào đây mà không thêm phép đo
 * là mở lại đúng lỗ này.
 */
const NO_FREE_TEXT_CONTROLLERS: ReadonlySet<string> = new Set(["RecycleBinFeedPostsController"]);

interface ControllerSite {
  name: string;
  file: string;
  /** Tên các đối số của `@UsePipes(...)` cấp class, theo thứ tự; `null` = không có decorator đó. */
  classPipes: string[] | null;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function decoratorCall(d: ts.Decorator): { name: string; args: readonly ts.Expression[] } {
  if (ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)) {
    return { name: d.expression.expression.text, args: d.expression.arguments };
  }
  return { name: ts.isIdentifier(d.expression) ? d.expression.text : "", args: [] };
}

function decoratorsOf(node: ts.Node): Array<{ name: string; args: readonly ts.Expression[] }> {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []).map(decoratorCall) : [];
}

/** Mọi class mang `@Controller` trong một file nguồn. */
function controllersIn(file: string): ControllerSite[] {
  const sf = parse(file);
  const out: ControllerSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const decos = decoratorsOf(node);
      if (decos.some((d) => d.name === "Controller")) {
        // Nhiều `@UsePipes` cấp class thì decorator DƯỚI chạy trước; lớp chặn phải đứng đầu của
        // decorator dưới cùng. Ở đây đòi hình dạng đơn giản nhất: đúng MỘT decorator.
        const pipes = decos.filter((d) => d.name === "UsePipes");
        out.push({
          name: node.name.text,
          file: path.basename(file),
          classPipes: pipes.length === 1 ? (pipes[0]?.args ?? []).map((a) => a.getText(sf)) : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function socialControllers(): ControllerSite[] {
  return fs
    .readdirSync(SRC_SOCIAL)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".spec.ts"))
    .sort()
    .flatMap((n) => controllersIn(path.join(SRC_SOCIAL, n)));
}

/** Danh sách trắng controller SOCIAL của census 2 tầng — nguồn ĐỘC LẬP với phép quét thư mục. */
function censusControllerNames(): string[] {
  const text = fs.readFileSync(TWO_LAYER_CENSUS, "utf8");
  const block = /const SOCIAL_CONTROLLERS = new Set\(\[([\s\S]*?)\]\);/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^\s*"([A-Za-z]+Controller)",/gm)].map((m) => m[1] as string);
}

describe("KIỂM ĐỦ TĨNH — mọi controller SOCIAL đi qua lớp chặn U+0000", () => {
  const sites = socialControllers();

  it("phép quét không rỗng: thấy đủ 12 controller trong `src/social/`", () => {
    expect(sites.map((s) => s.name).sort()).toEqual(
      [
        "SocialCommentsController",
        "SocialDiscoveryController",
        "SocialFilesController",
        "SocialGroupsController",
        "SocialIdeasController",
        "SocialKudosController",
        "SocialNewsController",
        "SocialPollsController",
        "SocialPostsController",
        "SocialReactionsController",
        "SocialReportsController",
        "SocialStatsController",
      ].sort(),
    );
  });

  it("mỗi controller có ĐÚNG MỘT `@UsePipes` cấp class và lớp chặn đứng ĐẦU danh sách", () => {
    const missing = sites
      .filter((s) => s.classPipes === null || s.classPipes[0] !== PIPE_NAME)
      .map((s) => `${s.file} › ${s.name} — @UsePipes cấp class: ${JSON.stringify(s.classPipes)}`);
    expect(
      missing,
      `controller SOCIAL chưa gắn \`@UsePipes(${PIPE_NAME}, …)\` ở cấp class:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("khớp danh sách trắng của census 2 tầng: không controller SOCIAL nào nằm ngoài phép đo này", () => {
    const census = censusControllerNames();
    expect(census.length, "không đọc được SOCIAL_CONTROLLERS từ census 2 tầng").toBeGreaterThan(0);
    const covered = new Set([...sites.map((s) => s.name), ...NO_FREE_TEXT_CONTROLLERS]);
    expect(census.filter((n) => !covered.has(n))).toEqual([]);
    expect([...covered].filter((n) => !census.includes(n))).toEqual([]);
  });

  describe("RecycleBinFeedPostsController (057 · 058) — không gắn lớp chặn vì không nhận chuỗi tự do", () => {
    const sf = parse(RECYCLE_CONTROLLER);
    const params: Array<{ name: string; args: string[] }> = [];
    const visit = (node: ts.Node): void => {
      if (ts.isParameter(node)) {
        for (const d of decoratorsOf(node)) {
          params.push({ name: d.name, args: d.args.map((a) => a.getText(sf)) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    it("không `@Body`; mọi `@Query` qua schema thùng rác; mọi `@Param` qua `ParseUUIDPipe`", () => {
      expect(params.filter((p) => p.name === "Body")).toEqual([]);
      const queries = params.filter((p) => p.name === "Query");
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.map((p) => p.args)).toEqual(
        queries.map(() => ["new ZodValidationPipe(feedRecycleBinQuerySchema)"]),
      );
      const routeParams = params.filter((p) => p.name === "Param");
      expect(routeParams.length).toBeGreaterThan(0);
      expect(routeParams.every((p) => p.args[1] === "ParseUUIDPipe")).toBe(true);
    });

    it("schema query đó từ chối U+0000 ở MỌI trường và mọi khoá lạ", () => {
      const keys = Object.keys(feedRecycleBinQuerySchema.shape);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(feedRecycleBinQuerySchema.safeParse({ [key]: bad("1", "") }).success, key).toBe(
          false,
        );
      }
      expect(feedRecycleBinQuerySchema.safeParse({ extra: bad() }).success).toBe(false);
      expect(feedRecycleBinQuerySchema.safeParse({}).success).toBe(true);
    });
  });
});
