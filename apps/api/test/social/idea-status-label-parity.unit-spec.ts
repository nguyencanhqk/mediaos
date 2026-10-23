import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { IDEA_STATUS_LABEL } from "../../src/social/social-idea-fsm";

/**
 * S16-SOCIAL-IDEALABEL-1 — lưới chống trôi nhãn trạng thái sáng kiến giữa HAI bảng người dùng cùng thấy:
 *
 *   - `IDEA_STATUS_LABEL` (`apps/api/src/social/social-idea-fsm.ts`) — biến `{status_label}` của thông
 *     báo NOTI-032 (template `0581` chỉ có placeholder, KHÔNG chép chữ nhãn ⇒ không cần migration);
 *   - `idea.status.*` của i18n FE (`apps/app/src/i18n/locales/vi/social.ts`) — pill trên thẻ bài, bộ
 *     lọc danh sách sáng kiến, hộp xét duyệt.
 *
 * Owner chốt 16/10/2026 (Đợt 0): bộ nhãn theo THÔNG BÁO — «Đã gửi · Đang xét duyệt · Được duyệt ·
 * Từ chối». Nguồn chuẩn là bảng BE; FE chép theo. Lệch một nhãn ⇒ spec này ĐỎ.
 *
 * ⚠️ AST, KHÔNG REGEX: chỉ lấy PropertyAssignment THẬT của `export default { idea: { status: {…} } }`,
 * nên chuỗi nhãn cũ chỉ được NHẮC trong comment không bao giờ lọt vào phép so. Không `import` thẳng tệp
 * FE: nó kéo thêm các namespace con và nằm ngoài tsconfig của `apps/api`.
 *
 * Tĩnh (`*.unit-spec.ts`), không cần Postgres ⇒ chạy ở mọi lần `pnpm test`, không rơi vào lớp «xanh vì
 * SKIP».
 */

const FE_LOCALE_FILE = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "src",
  "i18n",
  "locales",
  "vi",
  "social.ts",
);

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(p)) return null;
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  return null;
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralExpression {
  const hits = obj.properties.filter(
    (p): p is ts.PropertyAssignment =>
      propName(p) === name &&
      ts.isPropertyAssignment(p) &&
      ts.isObjectLiteralExpression(p.initializer),
  );
  if (hits.length !== 1) {
    throw new Error(`cần đúng MỘT khối object \`${name}\`, gặp ${hits.length}`);
  }
  return hits[0]!.initializer as ts.ObjectLiteralExpression;
}

/** Bóc `{ … } as const` / `{ … } satisfies T` / `({ … })` về object literal bên trong. */
function unwrapExpr(e: ts.Expression): ts.Expression {
  let cur = e;
  while (
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isParenthesizedExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function defaultExportObject(sf: ts.SourceFile): ts.ObjectLiteralExpression {
  const hits = sf.statements
    .filter((s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals)
    .map((s) => unwrapExpr(s.expression))
    .filter(ts.isObjectLiteralExpression);
  if (hits.length !== 1) {
    throw new Error(`cần đúng MỘT \`export default { … }\`, gặp ${hits.length}`);
  }
  return hits[0]!;
}

/** Đọc `idea.status` của tệp i18n FE thành bảng phẳng; phần tử không phải `khoá: "chuỗi"` ⇒ ném. */
function readFeIdeaStatusLabels(): Record<string, string> {
  const text = fs.readFileSync(FE_LOCALE_FILE, "utf8");
  const sf = ts.createSourceFile(FE_LOCALE_FILE, text, ts.ScriptTarget.Latest, true);
  const status = objectProp(objectProp(defaultExportObject(sf), "idea"), "status");
  const out: Record<string, string> = {};
  for (const p of status.properties) {
    const key = propName(p);
    if (key === null || !ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.initializer)) {
      throw new Error(`phần tử lạ trong \`idea.status\`: ${p.getText(sf)}`);
    }
    out[key] = p.initializer.text;
  }
  return out;
}

describe("S16-SOCIAL-IDEALABEL-1 — nhãn trạng thái sáng kiến: thông báo ↔ i18n FE", () => {
  it("neo dương: đọc được ĐỦ 4 nhãn từ tệp i18n FE", () => {
    // Không có neo này, một bộ đọc trả `{}` sẽ chỉ làm phép so bên dưới đỏ với thông điệp mù mờ —
    // hoặc tệ hơn, xanh nếu bảng BE cũng rỗng.
    expect(Object.keys(readFeIdeaStatusLabels()).sort()).toEqual(
      ["accepted", "rejected", "submitted", "under_review"].sort(),
    );
  });

  it("`idea.status.*` (FE) TRÙNG KHỚP `IDEA_STATUS_LABEL` (thông báo NOTI-032) — từng khoá, từng chữ", () => {
    expect(readFeIdeaStatusLabels()).toEqual({ ...IDEA_STATUS_LABEL });
  });

  it("bộ nhãn owner chốt 16/10/2026 — gõ TAY, không suy từ bảng nào", () => {
    // Ghim nguồn chuẩn: nếu ai đó «sửa cho khớp» bằng cách đổi bảng BE theo FE, ca này đỏ.
    expect({ ...IDEA_STATUS_LABEL }).toEqual({
      submitted: "Đã gửi",
      under_review: "Đang xét duyệt",
      accepted: "Được duyệt",
      rejected: "Từ chối",
    });
  });
});
