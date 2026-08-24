import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S10-FND-BODYVALIDATE-1 (KI-068) — CENSUS "handler GHI có `@Body()` KHÔNG validate ở BIÊN".
 *
 * ⚠️ VÌ SAO DÙNG AST CHỨ KHÔNG GREP. Bản census đầu tiên của WO này viết bằng regex và **sai HAI lần
 * liên tiếp**, cả hai lần đều theo chiều GIẤU khoảng trống:
 *   1. đếm 4 thành **2** — vì coi `@UsePipes(ZodValidationPipe)` **cấp class** (thứ không cứu được gì,
 *      xem dưới) là pipe của method;
 *   2. rồi đếm 4 thành **5** — vì `@UsePipes` của method có thể nằm **DƯỚI** `@Post()` (khuôn
 *      `profile-change-request.controller.ts`), mà scanner chỉ quét ngược lên trên.
 * Đúng lớp bài học `identity-projection-census.ts` đã ghi (regex cho 49→38→114→40). AST không có khái
 * niệm "trên/dưới" hay "cột 0": decorator của method là decorator của method, hết.
 *
 * BẤT BIẾN ĐANG ĐO. Một handler GHI (`@Post`/`@Put`/`@Patch`/`@Delete`) nhận `@Body()` được coi là
 * **validate ở BIÊN** khi thoả ÍT NHẤT MỘT trong ba:
 *   (a) type của tham số là **class `createZodDto`** — metatype tồn tại lúc chạy ⇒ `ZodValidationPipe`
 *       chiếu được schema;
 *   (b) chính `@Body(...)` có đối số (pipe tại chỗ, ví dụ `@Body(new ZodValidationPipe(s))`);
 *   (c) method có decorator `@UsePipes(...)`.
 *
 * ⚠️ `@UsePipes(ZodValidationPipe)` **cấp class KHÔNG tính** — và đó là điểm dễ đọc sai nhất của cả
 * KI-068. Pipe lấy schema từ **metatype** của tham số; nếu type là `z.infer` (một TYPE, bị xoá lúc
 * chạy) thì metatype là `Object` và pipe không có gì để chiếu. Cả `api-keys.controller.ts` lẫn
 * `files.controller.ts` ĐỀU có pipe cấp class trong suốt thời gian 4 route đó trả 500.
 *
 * LỚP BẰNG CHỨNG. Đây là parse TĨNH ⇒ con số là **CẬN DƯỚI** của lỗ (sai số dồn về phía "đã phủ").
 * Bằng chứng MẠNH cho 4 route đã biết nằm ở int-spec HTTP thật:
 * `test/integration/files-http-validate.int-spec.ts` + `invite-apikeys-http.int-spec.ts`.
 * Census này giữ vai trò khác: chặn route THỨ NĂM mọc lên im lặng.
 */

// tsconfig module=commonjs → `__dirname`, không `import.meta` (mẫu route-http-coverage.e2e-spec).
const API_SRC = path.join(__dirname, "..", "..", "src");
const CONTRACTS_SRC = path.join(__dirname, "..", "..", "..", "..", "packages", "contracts", "src");

/** Động từ HTTP có thân request. `@Get` không nhận `@Body()` nên không nằm trong tầm đo. */
const WRITE_VERBS = new Set(["Post", "Put", "Patch", "Delete"]);

export interface BodyHandler {
  /** Đường dẫn tương đối từ `apps/api/src`, dùng dấu `/`. */
  readonly file: string;
  readonly line: number;
  readonly verb: string;
  /** `<Controller>#<method>` — khoá ổn định hơn route string (route đổi khi refactor prefix). */
  readonly key: string;
  /** Tên type của tham số `@Body()`. */
  readonly bodyType: string;
  readonly validatedAtBoundary: boolean;
}

function walk(dir: string, out: string[], keep: (n: string) => boolean): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out, keep);
    } else if (keep(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

/** Tên decorator, ví dụ `@Post("x")` → "Post"; `@HttpCode(200)` → "HttpCode". */
function decoratorName(d: ts.Decorator): string {
  const expr = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  return ts.isIdentifier(expr) ? expr.text : "";
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/**
 * Tập class DTO dựng bằng `createZodDto` — quét CẢ `apps/api/src` LẪN `packages/contracts/src`
 * (DTO có thể khai ở một trong hai nơi). Nhận hai hình dạng: `class X extends createZodDto(...)`
 * và `const X = createZodDto(...)`.
 */
export function zodDtoClassNames(): ReadonlySet<string> {
  const names = new Set<string>();
  const files = [
    ...walk(API_SRC, [], (n) => n.endsWith(".ts")),
    ...walk(CONTRACTS_SRC, [], (n) => n.endsWith(".ts")),
  ];
  for (const f of files) {
    const sf = parse(f);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name && node.heritageClauses) {
        for (const h of node.heritageClauses) {
          for (const t of h.types) {
            if (
              ts.isCallExpression(t.expression) &&
              ts.isIdentifier(t.expression.expression) &&
              t.expression.expression.text === "createZodDto"
            ) {
              names.add(node.name.text);
            }
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === "createZodDto"
      ) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return names;
}

/** Mọi handler GHI có `@Body()` trong `apps/api/src/**\/*.controller.ts`. */
export function bodyHandlers(): readonly BodyHandler[] {
  const dtoClasses = zodDtoClassNames();
  const out: BodyHandler[] = [];

  for (const f of walk(API_SRC, [], (n) => n.endsWith(".controller.ts"))) {
    const sf = parse(f);
    const rel = path.relative(API_SRC, f).split(path.sep).join("/");

    const visitClass = (cls: ts.ClassDeclaration): void => {
      const className = cls.name?.text ?? "(anonymous)";
      for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        const decos = decoratorsOf(member);
        const verb = decos.map(decoratorName).find((n) => WRITE_VERBS.has(n));
        if (!verb) continue;

        // `@UsePipes` CỦA METHOD — AST nên không lẫn với decorator cấp class, và không phụ thuộc
        // decorator nằm trên hay dưới `@Post()`.
        const methodPipe = decos.some((d) => decoratorName(d) === "UsePipes");

        for (const param of member.parameters) {
          const bodyDeco = decoratorsOf(param).find((d) => decoratorName(d) === "Body");
          if (!bodyDeco) continue;

          // `@Body(pipe)` có đối số ⇒ pipe tại chỗ.
          const inlinePipe =
            ts.isCallExpression(bodyDeco.expression) && bodyDeco.expression.arguments.length > 0;

          const typeNode = param.type;
          const bodyType =
            typeNode && ts.isTypeReferenceNode(typeNode)
              ? typeNode.typeName.getText(sf)
              : (typeNode?.getText(sf) ?? "(none)");

          out.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
            verb,
            key: `${className}#${member.name.text}`,
            bodyType,
            validatedAtBoundary: dtoClasses.has(bodyType) || inlinePipe || methodPipe,
          });
        }
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) visitClass(node);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** Handler GHI KHÔNG validate ở biên — tập phải RỖNG (trừ waiver đã ký). */
export function unvalidatedBodyHandlers(): readonly BodyHandler[] {
  return bodyHandlers().filter((h) => !h.validatedAtBoundary);
}
