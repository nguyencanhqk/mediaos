import fs from "node:fs";
import path from "node:path";

/**
 * S19-OPS-ZOD4-1 (C3.7, plan §9.2-4) — census HÌNH DẠNG default của schema zod 4 (đọc `_zod.def` của schema THẬT
 * đã build, KHÔNG đọc cú pháp). Hai hình dạng đổi nghĩa khi nâng zod 3 → 4:
 *
 *  A. `optional` bọc `default`/`prefault` — zod 4 ÁP default khi khoá vắng (v3: giữ undefined) ⇒ bẫy cho PATCH/partial.
 *  B. `default` bọc `object` có field mang default — zod 4 trả giá trị default NGUYÊN (không chạy default của field
 *     con) ⇒ `{}` ở lại `{}`; muốn v3-như-cũ phải dùng `.prefault`.
 */

const REPO = path.join(__dirname, "..", "..", "..", "..");

interface Def {
  type: string;
  innerType?: unknown;
  shape?: Record<string, unknown>;
  element?: unknown;
  options?: unknown[];
  left?: unknown;
  right?: unknown;
  keyType?: unknown;
  valueType?: unknown;
  items?: unknown[];
  rest?: unknown;
  in?: unknown;
  out?: unknown;
  getter?: () => unknown;
}

export function defOf(s: unknown): Def | null {
  if (s === null || typeof s !== "object") return null;
  const z = (s as { _zod?: { def?: Def } })._zod;
  return z?.def && typeof z.def.type === "string" ? z.def : null;
}

/** Bóc optional/nullable/readonly/nonoptional/catch để lộ lớp default (nếu có). */
function unwrapToDefault(s: unknown): Def | null {
  let d = defOf(s);
  for (let i = 0; d && i < 8; i++) {
    if (d.type === "default" || d.type === "prefault") return d;
    if (["optional", "nullable", "readonly", "nonoptional", "catch"].includes(d.type))
      d = defOf(d.innerType);
    else return null;
  }
  return null;
}

function children(d: Def): unknown[] {
  const kids: unknown[] = [];
  if (d.innerType) kids.push(d.innerType);
  if (d.shape) kids.push(...Object.values(d.shape));
  if (d.element) kids.push(d.element);
  if (d.options) kids.push(...d.options);
  if (d.left) kids.push(d.left);
  if (d.right) kids.push(d.right);
  if (d.keyType) kids.push(d.keyType);
  if (d.valueType) kids.push(d.valueType);
  if (d.items) kids.push(...d.items);
  if (d.rest) kids.push(d.rest);
  if (d.in) kids.push(d.in);
  if (d.out) kids.push(d.out);
  if (d.type === "lazy" && d.getter) {
    try {
      kids.push(d.getter());
    } catch {
      /* getter lazy chưa sẵn sàng — không phải ca của census */
    }
  }
  return kids;
}

export interface Finding {
  rule: "optional-over-default" | "default-over-object-with-defaults";
  path: string;
}

export interface Walk {
  nodes: number;
  optionalOverDefault: Finding[];
  defaultOverObject: Finding[];
}

export function newWalk(): Walk {
  return { nodes: 0, optionalOverDefault: [], defaultOverObject: [] };
}

/** Duyệt một schema (chống vòng bằng WeakSet). `label` mở đầu `path` để báo lỗi. */
export function walkSchema(root: unknown, label: string, into: Walk, seen = new WeakSet<object>()) {
  const visit = (s: unknown, at: string) => {
    const d = defOf(s);
    if (!d || seen.has(s as object)) return;
    seen.add(s as object);
    into.nodes += 1;
    if (d.type === "optional") {
      const inner = defOf(d.innerType);
      if (inner && (inner.type === "default" || inner.type === "prefault"))
        into.optionalOverDefault.push({ rule: "optional-over-default", path: at });
    }
    if (d.type === "default") {
      const inner = defOf(d.innerType);
      if (inner?.type === "object" && inner.shape) {
        const bad = Object.entries(inner.shape)
          .filter(([, f]) => unwrapToDefault(f))
          .map(([k]) => k);
        if (bad.length)
          into.defaultOverObject.push({
            rule: "default-over-object-with-defaults",
            path: `${at} (field: ${bad.join(",")})`,
          });
      }
    }
    const kids = children(d);
    kids.forEach((k, i) => visit(k, `${at}>${d.type}${kids.length > 1 ? `[${i}]` : ""}`));
  };
  visit(root, label);
}

export const repoRel = (f: string): string => path.relative(REPO, f).split(path.sep).join("/");

/** Tệp `.ts` (không test/d.ts) ngoài contracts có `import … from "zod"` và export const — schema cục bộ cần quét. */
export function localSchemaFiles(): string[] {
  const roots = ["packages/web-core/src", "apps/app/src", "apps/auth/src", "apps/console/src"];
  const out: string[] = [];
  const rec = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") rec(p);
      } else if (/\.ts$/.test(e.name) && !/\.(test|spec|d)\.ts$/.test(e.name)) {
        const src = fs.readFileSync(p, "utf8");
        if (/from ["']zod["']/.test(src) && /export (const|let) \w+/.test(src)) out.push(p);
      }
    }
  };
  for (const r of roots) rec(path.join(REPO, r));
  return out.sort();
}
