import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * S14-QA-COVGATE-1 — RATCHET: cổng coverage KHÔNG được CHẾT TRONG IM LẶNG.
 *
 * VÌ SAO TỒN TẠI. Vitest **bỏ qua trong im lặng** — không cảnh báo, không đỏ — bất kỳ khoá
 * `coverage.thresholds` nào không khớp file nào trong report. `S13-PAYROLL-QA-1` (2026-09-01) đo được
 * 5/7 khoá của module PAYROLL là cổng CHẾT kiểu này (4 khoá `src/workflow/*` — module đã xoá hẳn ở
 * `S10-CLEAN-WORKFLOWCLUSTER-2` — và một khoá payroll gõ nhầm số ít/số nhiều). Cùng họ lỗi sống ở
 * `apps/api/package.json`: script `test:cov` (đã XOÁ ở WO này) vẫn trỏ `vitest run src/workflow` —
 * thư mục không còn tồn tại, nên lệnh "chạy được" (exit 0, 0 test) mà không đo gì cả.
 *
 * Ratchet này khoá HAI bề mặt cùng họ:
 *   (1) mọi khoá của `test.coverage.thresholds` trong `vitest.config.ts` trỏ file CÓ THẬT;
 *   (2) mọi đường dẫn `src/**`/`test/**` cụ thể (không glob) xuất hiện trong một script `test:cov*`
 *       của `package.json` trỏ file/thư mục CÓ THẬT.
 *
 * ⚠️ AST, KHÔNG REGEX, cho (1). Một scan chuỗi/regex trên TOÀN VĂN `vitest.config.ts` sẽ khớp cả
 * đường dẫn chỉ được NHẮC trong comment (chính docblock phía trên có nhắc `src/workflow/*` trong văn
 * xuôi) ⇒ dương tính giả hoặc âm tính giả tuỳ chiều — đúng bẫy đã vấp ở `vitest-exclude-selfcheck-
 * reads-comments`. Đọc AST và chỉ lấy PropertyAssignment THẬT của object `thresholds` thì comment
 * không bao giờ lọt vào (memory `index-ratchet-must-pin-definition-not-name`: ghim theo ĐỊNH NGHĨA,
 * không theo tên/chuỗi xuất hiện trong file).
 *
 * (2) đọc `package.json` bằng `JSON.parse` (JSON không có comment nên không có bẫy trên) rồi tokenize
 * TỪNG chuỗi lệnh; token chứa `*` (glob — vd `src/chat/chat-call*.ts`, `src/assets/**`) bị LOẠI vì nó
 * là MẪU chứ không phải một đường dẫn cụ thể để kiểm tồn-tại.
 *
 * KHÔNG cần Postgres: spec TĨNH (`*.unit-spec.ts`, glob đã khai ở `vitest.config.ts`) ⇒ chạy ở MỌI lần
 * `pnpm test`, kể cả không có `LANE_DB` — không rơi vào lớp "xanh vì SKIP".
 */

const API_ROOT = path.join(__dirname, "..", "..");

function parseTs(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

function propKey(p: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(p)) return null;
  return p.name.getText().replace(/^["']|["']$/g, "");
}

function objectLiteralProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | null {
  for (const p of obj.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      propKey(p) === name &&
      ts.isObjectLiteralExpression(p.initializer)
    ) {
      return p.initializer;
    }
  }
  return null;
}

/** Đối số object-literal đầu tiên của lời gọi `defineConfig({...})` — null nếu không tìm thấy. */
function findDefineConfigArg(sf: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "defineConfig" &&
      n.arguments.length > 0 &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      found = n.arguments[0];
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Khoá THẬT của `test.coverage.thresholds` — đọc qua AST (xem docblock ở trên vì sao KHÔNG regex).
 * Trả `[]` khi không tìm thấy cấu trúc mong đợi (parser hỏng/đổi cấu trúc) — ca "xanh-rỗng" bên dưới
 * bắt trường hợp này.
 */
function coverageThresholdKeys(sourceText: string, fileName = "vitest.config.ts"): string[] {
  const root = findDefineConfigArg(parseTs(sourceText, fileName));
  const testObj = root && objectLiteralProp(root, "test");
  const coverageObj = testObj && objectLiteralProp(testObj, "coverage");
  const thresholdsObj = coverageObj && objectLiteralProp(coverageObj, "thresholds");
  if (!thresholdsObj) return [];
  return thresholdsObj.properties.map(propKey).filter((k): k is string => k !== null);
}

/** Khoá nào trong `keys` KHÔNG trỏ file/thư mục có thật dưới `baseDir`. */
function missingPaths(keys: readonly string[], baseDir: string): string[] {
  return keys.filter((k) => !fs.existsSync(path.join(baseDir, k)));
}

/**
 * Token đường dẫn `src/**`/`test/**` CỤ THỂ trong một chuỗi lệnh script — loại token chứa `*` (glob,
 * không phải một đường dẫn để kiểm tồn-tại) và bỏ dấu `/` thừa ở cuối (từ `--coverage.include='dir/**'`
 * bị cắt ngay trước `**`).
 */
function commandPathTokens(cmd: string): string[] {
  const tokens = cmd.match(/(?:src|test)\/[A-Za-z0-9_.\-/*]+/g) ?? [];
  const trimmed = tokens.map((t) => t.replace(/\/+$/, ""));
  return [...new Set(trimmed)].filter((t) => !t.includes("*"));
}

describe("coverage threshold + test:cov:* ratchet (S14-QA-COVGATE-1)", () => {
  it("mọi khoá coverage.thresholds trong vitest.config.ts trỏ file CÓ THẬT", () => {
    const source = fs.readFileSync(path.join(API_ROOT, "vitest.config.ts"), "utf8");
    const keys = coverageThresholdKeys(source);

    // Chốt chặn xanh-RỖNG: parser hỏng (đổi cấu trúc defineConfig/test/coverage/thresholds) trả `[]`
    // và MỌI assert dưới đây xanh dù không đo gì. 10 là NGƯỠNG DƯỚI đo tại 2026-09-02 (15 khoá thật) —
    // thêm khoá mới không phải sửa số này, chỉ khoá nào GỠ khoá mới cần nhìn lại.
    expect(keys.length, "parser rỗng — hỏng, không phải bề mặt biến mất").toBeGreaterThanOrEqual(
      10,
    );

    const missing = missingPaths(keys, API_ROOT);
    expect(
      missing,
      `${missing.length} khoá coverage.thresholds trỏ file KHÔNG tồn tại. Vitest BỎ QUA khoá này ` +
        "trong im lặng (không cảnh báo, không đỏ) — cổng CHẾT trông y hệt cổng sống. Sửa lại đường dẫn " +
        "theo file crown-jewel hiện tại, hoặc gỡ khoá nếu file đã xoá hẳn.",
    ).toEqual([]);
  });

  it("mọi script `test:cov*` trong package.json trỏ đường dẫn CÓ THẬT (không tệp ma)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(API_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const covScripts = Object.entries(pkg.scripts).filter(([key]) => key.startsWith("test:cov"));

    // Chốt chặn xanh-RỖNG: nếu không còn script test:cov* nào, ca dưới xanh vì rỗng chứ không phải vì
    // mọi thứ đã đúng — đừng để module coverage-scoped biến mất trong im lặng.
    expect(
      covScripts.length,
      "không còn script test:cov* nào trong package.json — census rỗng, không phải bề mặt biến mất",
    ).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const [key, cmd] of covScripts) {
      for (const token of commandPathTokens(cmd)) {
        if (!fs.existsSync(path.join(API_ROOT, token))) {
          violations.push(`${key}: ${token}`);
        }
      }
    }
    expect(
      violations,
      "script test:cov* tham chiếu đường dẫn KHÔNG tồn tại. Lệnh vẫn 'chạy được' (vitest không lỗi khi " +
        "positional-arg/`--coverage.include` không khớp file nào — nó chỉ chạy/đo 0), nên không cảnh " +
        "báo được bằng exit-code; đây là ratchet DUY NHẤT bắt việc này.",
    ).toEqual([]);
  });

  // --- Đai đối kháng: chứng minh CƠ CHẾ THẬT bắt được khoá/đường dẫn ma — không phải test xanh-rỗng ---

  it("PHẢN CHỨNG (1) — khoá thresholds trỏ file ma PHẢI bị bắt (đo cổng phải VI PHẠM thật)", () => {
    const fixture = `
      import { defineConfig } from "vitest/config";
      export default defineConfig({
        test: {
          coverage: {
            thresholds: {
              "src/payroll/payroll-fsm.ts": { lines: 95 },
              "src/ghost/does-not-exist.service.ts": { lines: 90 },
            },
          },
        },
      });
    `;
    const keys = coverageThresholdKeys(fixture, "fixture.ts");
    expect(keys).toEqual(
      expect.arrayContaining(["src/payroll/payroll-fsm.ts", "src/ghost/does-not-exist.service.ts"]),
    );
    expect(missingPaths(keys, API_ROOT)).toEqual(["src/ghost/does-not-exist.service.ts"]);
  });

  it("ĐAI CHỐNG-BẪY — đường dẫn chỉ xuất hiện trong COMMENT KHÔNG được tính là khoá thật (memory vitest-exclude-selfcheck-reads-comments)", () => {
    const fixture = `
      import { defineConfig } from "vitest/config";
      export default defineConfig({
        test: {
          // Nợ ghi nhận: từng có khoá "src/workflow/does-not-exist.ts" ở đây, đã gỡ (xem WO S14-QA-COVGATE-1).
          coverage: {
            thresholds: {
              "src/payroll/payroll-fsm.ts": { lines: 95 },
            },
          },
        },
      });
    `;
    const keys = coverageThresholdKeys(fixture, "fixture.ts");
    expect(keys).not.toContain("src/workflow/does-not-exist.ts");
    expect(keys).toEqual(["src/payroll/payroll-fsm.ts"]);
  });

  it("PHẢN CHỨNG (2) — token đường dẫn CỤ THỂ trong lệnh test:cov* trỏ file ma PHẢI bị bắt", () => {
    const violations = commandPathTokens(
      "vitest run src/ghost-module --coverage --coverage.include=src/ghost-module/**",
    ).filter((t) => !fs.existsSync(path.join(API_ROOT, t)));
    expect(violations).toEqual(["src/ghost-module"]);
  });

  it("ĐAI CHỐNG-BẪY (2) — glob giữa chuỗi (`chat-call*.ts`) KHÔNG bị cắt cụt thành một đường dẫn ma", () => {
    // `src/chat` có thật nhưng KHÔNG có file/thư mục tên đúng "chat-call" (chỉ có các file
    // "chat-call-*.spec.ts") — một regex dừng ở dấu `*` mà không loại cả token sẽ tạo dương tính giả
    // đúng ở CHÍNH script `test:cov:call` (`--coverage.include='src/chat/chat-call*.ts'`).
    const tokens = commandPathTokens(
      "vitest run --coverage --coverage.include='src/chat/chat-call*.ts'",
    );
    expect(tokens).toEqual([]);
  });
});
