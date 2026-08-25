import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S10-FND-PARAMUUID-1 (KI-077) — CENSUS "tham số `:id` không validate ở BIÊN".
 *
 * ─── BẢN SAO CỦA KI-068, ĐỔI KÊNH ───────────────────────────────────────────────────────────────
 * KI-068 là "body không validate ở biên ⇒ 500 thay vì 400". KI-077 là **cùng cơ chế, kênh PARAM**:
 * `@Param("id") id: string` không có pipe ⇒ chuỗi rác đi thẳng tới cột `uuid` của Postgres rồi nổ
 * `22P02`, `AllExceptionsFilter` không hiểu ⇒ **500 `SYSTEM-ERR-001`**.
 *
 * ĐO 25/08/2026 trên `LANE_DB=mediaos_paramuuid`, 5 route của `foundation/files`: **cả 5 trả 500 +
 * `error.type='Error'`** (`test/integration/files-param-uuid.int-spec.ts`). Không còn là suy luận.
 *
 * ─── VÌ SAO RATCHET NÀY LÀ "TRẦN", KHÔNG PHẢI "PHẢI BẰNG 0" ─────────────────────────────────────
 * Census toàn `apps/api/src/**\/*.controller.ts` (đo 25/08): **312** `@Param`, **298** id-like,
 * **77** đã có pipe ⇒ **221 CHƯA CÓ**. Vá hết 221 chỗ là một WO riêng, và `paths` của WO này chỉ
 * gồm `foundation/files`. Quan trọng hơn: **221 KHÔNG có nghĩa là 221 bug** — chỉ 5 chỗ đã được ĐO
 * bằng HTTP thật; số còn lại chưa ai chạm, và WO này từ chối ép số cho khớp mô tả.
 *
 * ⇒ Ratchet giữ đúng thứ giữ được: **không MỌC THÊM**. Trần đóng băng ở số đo hôm nay; module đã vá
 * thì đòi bằng 0. Đó là cách chặn "tham số thứ 222" mà không giả vờ đã dọn xong.
 *
 * ⚠️ AST chứ không regex — cùng bài học đã trả giá ba lần ở `body-validation-census.ts`. Regex
 * không phân biệt `@Param("id")` với `@Param("id", ParseUUIDPipe)` khi decorator xuống dòng, và
 * `:linkId` thì `grep '@Param("id")'` TRƯỢT hẳn ([[identity-projection-census-misses-alias]]).
 */

// tsconfig module=commonjs → `__dirname` (mẫu body-validation-census).
const API_SRC = path.join(__dirname, "..", "..", "src");

/**
 * Tên tham số được coi là "trỏ tới một khoá UUID": `id` hoặc đuôi `Id` (`linkId` · `fileId` ·
 * `taskId`…). CỐ Ý không quét mọi `@Param`: `:slug`, `:code`, `:module` là chuỗi thật, thêm
 * `ParseUUIDPipe` cho chúng là chặn nhầm request hợp lệ.
 *
 * ⚠️ Đây là phép xấp xỉ theo TÊN, và nó sai được theo cả hai chiều (một `:key` chứa UUID sẽ lọt;
 * một `:tenantId` dạng slug sẽ bị đếm oan). Chấp nhận: mục đích là chặn tăng, không phải phán quyết
 * từng chỗ. Phán quyết từng chỗ cần đo bằng HTTP như 5 route đã làm.
 */
const ID_LIKE = /^id$|Id$/;

export interface ParamSite {
  /** Đường dẫn tương đối từ `apps/api/src`, dấu `/`. */
  readonly file: string;
  readonly line: number;
  /** Tên tham số trong `@Param("...")`. */
  readonly name: string;
  /** `@Param("x", SomePipe)` — có đối số thứ hai trở đi. */
  readonly hasPipe: boolean;
}

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out);
    } else if (e.name.endsWith(".controller.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Mọi `@Param("<tên id-like>")` trong `apps/api/src/**\/*.controller.ts`. */
export function idLikeParamSites(): readonly ParamSite[] {
  const out: ParamSite[] = [];

  for (const f of walk(API_SRC, [])) {
    const sf = ts.createSourceFile(
      f,
      fs.readFileSync(f, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );
    const rel = path.relative(API_SRC, f).split(path.sep).join("/");

    const visit = (n: ts.Node): void => {
      if (ts.isParameter(n) && ts.canHaveDecorators(n)) {
        for (const d of ts.getDecorators(n) ?? []) {
          const call = d.expression;
          if (!ts.isCallExpression(call)) continue;
          if (!ts.isIdentifier(call.expression) || call.expression.text !== "Param") continue;

          const first = call.arguments[0];
          // `@Param()` không tên (nhận cả object params) — ngoài tầm đo: không có một cột uuid cụ thể.
          if (!first || !ts.isStringLiteralLike(first)) continue;
          if (!ID_LIKE.test(first.text)) continue;

          out.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            name: first.text,
            hasPipe: call.arguments.length > 1,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Tham số id-like KHÔNG có pipe ở biên — tập phải KHÔNG LỚN HƠN trần đã ký. */
export function unpipedIdParamSites(): readonly ParamSite[] {
  return idLikeParamSites().filter((s) => !s.hasPipe);
}
