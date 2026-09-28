import fs from "node:fs";
import type { INestApplication } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import {
  HELPER_TS,
  MAIN_ONLY_CALLS,
  MAIN_TS,
  analyzeBoot,
  analyzeSpec,
  envFlagsOf,
  pipelineDiff,
  readBoot,
  scanSpecs,
} from "./pipeline-parity-census";

/**
 * S16-TEST-PIPELINE-PARITY-1 — lưới «pipeline int-spec ≡ `main.ts`» + RATCHET spec tự dựng tay.
 *
 * Int-spec không chạy `main.ts` (DECISIONS-15 plan M6). Gỡ/đổi thứ tự một khâu ở `main.ts` mà helper
 * không theo ⇒ cả bộ hồi quy đo một pipeline PROD không chạy. Ca dưới đây ĐỎ khi hai nơi trôi nhau.
 */

/**
 * Số spec còn gọi `createNestApplication` mà KHÔNG qua `applyMainPipeline`. CHỈ ĐƯỢC GIẢM: chuyển
 * một spec sang helper ⇒ hạ số này đúng bằng số file đã chuyển (ca ratchet ĐỎ nếu quên hạ).
 * Spec MỚI phải dùng helper từ đầu. Mốc 28/09/2026: 271 trước WO − 2 file chuyển trong WO = 269.
 */
const HAND_ROLLED_BASELINE = 269;

describe("S16-TEST-PIPELINE-PARITY-1 — helper ≡ main.ts", () => {
  const main = readBoot(MAIN_TS);
  const helper = readBoot(HELPER_TS);

  it("chống xanh-rỗng: census THẤY các khâu của main.ts", () => {
    expect(main.steps.length, "không đọc được khâu nào của main.ts").toBeGreaterThanOrEqual(5);
    expect(main.steps.map((s) => s.arg)).toContain("requestIdMiddleware");
    expect(main.steps.map((s) => s.arg)).toContain("grantMemoMiddleware");
    expect(main.otherCalls, "không thấy lời gọi ngoài pipeline nào").toContain("listen");
  });

  it("helper đăng ký ĐÚNG khâu · ĐÚNG thứ tự · ĐÚNG tính có-điều-kiện của main.ts", () => {
    expect(
      pipelineDiff(main, helper),
      "Sửa test/helpers/bootstrap-app.ts cho khớp main.ts (hoặc ngược lại)",
    ).toEqual([]);
  });

  it("khâu có điều kiện ở main.ts đọc cờ env mà helper CŨNG đọc (kill-switch khớp)", () => {
    const flags = envFlagsOf(main);
    expect(flags, "main.ts: grantMemo phải nằm dưới cờ env").toContain(
      "PERMISSION_GRANT_MEMO_ENABLED",
    );
    const helperSrc = fs.readFileSync(HELPER_TS, "utf8");
    for (const f of flags) {
      expect(helperSrc, `helper phải đọc cờ ${f} như main.ts`).toMatch(new RegExp(`\\b${f}\\b`));
    }
  });

  /**
   * Lưới AST chỉ biết khâu memo CÓ điều kiện, không biết điều kiện ĐÚNG CHIỀU. Ca này chạy helper
   * THẬT trên app giả ghi lại `use()` — đảo `=== "true"` thành `!== "true"` trong helper ⇒ ĐỎ.
   * (Hai int-spec đã chuyển luôn truyền `grantMemo` tường minh nên KHÔNG chạm nhánh mặc định.)
   */
  describe("nhánh mặc định của cờ memo (chạy helper thật)", () => {
    const registered = (flag: string | undefined, opts?: { grantMemo?: boolean }): string[] => {
      const saved = process.env.PERMISSION_GRANT_MEMO_ENABLED;
      if (flag === undefined) delete process.env.PERMISSION_GRANT_MEMO_ENABLED;
      else process.env.PERMISSION_GRANT_MEMO_ENABLED = flag;
      try {
        const used: string[] = [];
        const fake = {
          use: (mw: { name: string }) => used.push(mw.name),
          useGlobalPipes: () => undefined,
          useGlobalInterceptors: () => undefined,
          useGlobalFilters: () => undefined,
        };
        applyMainPipeline(fake as unknown as INestApplication, opts);
        return used;
      } finally {
        if (saved === undefined) delete process.env.PERMISSION_GRANT_MEMO_ENABLED;
        else process.env.PERMISSION_GRANT_MEMO_ENABLED = saved;
      }
    };
    const WITH_MEMO = ["requestIdMiddleware", "grantMemoMiddleware"];

    it("cờ vắng ⇒ BẬT (default của env.schema, như main.ts)", () => {
      expect(registered(undefined)).toEqual(WITH_MEMO);
    });
    it("cờ 'true' ⇒ BẬT · cờ 'false' ⇒ TẮT (vẫn có requestId)", () => {
      expect(registered("true")).toEqual(WITH_MEMO);
      expect(registered("false")).toEqual(["requestIdMiddleware"]);
    });
    it("cờ sai kiểu ⇒ NÉM (enum như main.ts, không coerce)", () => {
      expect(() => registered("1")).toThrow();
    });
    it("grantMemo tường minh thắng env", () => {
      expect(registered("false", { grantMemo: true })).toEqual(WITH_MEMO);
      expect(registered("true", { grantMemo: false })).toEqual(["requestIdMiddleware"]);
    });
  });

  it("KHÔNG khâu pipeline nào gọi nối chuỗi (bộ nhận dạng mù với mắt ngoài)", () => {
    expect(main.chained, "main.ts: tách app.x(a).y(b) thành lời gọi riêng").toEqual([]);
    expect(helper.chained, "helper: tách app.x(a).y(b) thành lời gọi riêng").toEqual([]);
    expect(
      analyzeBoot("c.ts", `app.use(a).use(b); app.getHttpAdapter().getInstance().set("x", 1);`)
        .chained,
    ).toEqual(["use(b)"]);
  });

  it("mọi lời gọi khác trên `app` ở main.ts đã được PHÂN LOẠI (MAIN_ONLY_CALLS)", () => {
    const unknown = main.otherCalls.filter((c) => !(c in MAIN_ONLY_CALLS));
    expect(
      unknown,
      "main.ts có lời gọi mới trên app: hoặc chép vào helper (nếu là khâu request), hoặc thêm vào " +
        "MAIN_ONLY_CALLS kèm LÝ DO không chép",
    ).toEqual([]);
    expect(helper.otherCalls, "helper không được làm việc ngoài pipeline").toEqual([]);
  });

  describe("bộ so khớp (nguồn TỔNG HỢP)", () => {
    const MAIN = `
      app.use(a);
      if (env.FLAG_X === "true") { app.use(b); }
      app.useGlobalFilters(new F());
      app.listen(1);`;

    it("khớp khi giống hệt", () => {
      const h = analyzeBoot(
        "h.ts",
        `app.use(a); if (x) { app.use(b); } app.useGlobalFilters(new F());`,
      );
      expect(pipelineDiff(analyzeBoot("m.ts", MAIN), h)).toEqual([]);
    });

    it("ĐỎ khi đảo thứ tự", () => {
      const h = analyzeBoot(
        "h.ts",
        `if (x) { app.use(b); } app.use(a); app.useGlobalFilters(new F());`,
      );
      expect(pipelineDiff(analyzeBoot("m.ts", MAIN), h).length).toBeGreaterThan(0);
    });

    it("ĐỎ khi helper thiếu khâu / bỏ điều kiện", () => {
      const m = analyzeBoot("m.ts", MAIN);
      expect(pipelineDiff(m, analyzeBoot("h.ts", `app.use(a); app.use(b);`))).toContain(
        "#1: main=use(b) [if] · helper=use(b)",
      );
      expect(pipelineDiff(m, analyzeBoot("h.ts", `app.use(a); if (x) { app.use(b); }`))).toContain(
        "#2: helper THIẾU useGlobalFilters(new F)",
      );
    });

    it("comment nhắc khâu KHÔNG được tính", () => {
      expect(analyzeBoot("c.ts", `// app.use(a);\n/* app.use(b) */`).steps).toEqual([]);
    });

    it("cờ env đọc từ điều kiện", () => {
      expect(envFlagsOf(analyzeBoot("m.ts", MAIN))).toEqual(["FLAG_X"]);
    });
  });
});

describe("S16-TEST-PIPELINE-PARITY-1 — ratchet spec tự dựng pipeline", () => {
  const specs = scanSpecs();
  const creators = specs.filter((s) => s.createsApp);

  it("chống xanh-rỗng: census quét được cây spec", () => {
    expect(specs.length, "không đọc được *.int-spec.ts/*.e2e-spec.ts").toBeGreaterThan(300);
    expect(creators.length, "không nhận ra createNestApplication").toBeGreaterThan(200);
    expect(
      creators.filter((s) => s.usesHelper).length,
      "không nhận ra spec nào dùng helper",
    ).toBeGreaterThan(0);
  });

  it(`số spec tự dựng tay == ${HAND_ROLLED_BASELINE} (chỉ được giảm)`, () => {
    const hand = creators.filter((s) => !s.usesHelper).length;
    expect(
      hand,
      hand > HAND_ROLLED_BASELINE
        ? "Spec MỚI phải dựng app qua applyMainPipeline (test/helpers/bootstrap-app.ts)"
        : `Đã chuyển thêm spec sang helper — hạ HAND_ROLLED_BASELINE xuống ${hand}`,
    ).toBe(HAND_ROLLED_BASELINE);
  });

  it("spec đã dùng helper KHÔNG tự đăng ký lại khâu pipeline (đăng ký đôi)", () => {
    expect(
      creators
        .filter((s) => s.usesHelper && s.handRolledSteps.length > 0)
        .map((s) => `${s.file}: ${s.handRolledSteps.join(", ")}`),
    ).toEqual([]);
  });

  it("bộ nhận dạng spec", () => {
    const helperUse = analyzeSpec(
      "a.int-spec.ts",
      `import { applyMainPipeline } from "../helpers/bootstrap-app";
       const app = applyMainPipeline(moduleRef.createNestApplication());`,
    );
    expect(helperUse).toMatchObject({ createsApp: true, usesHelper: true, handRolledSteps: [] });

    const hand = analyzeSpec(
      "b.int-spec.ts",
      `app = moduleRef.createNestApplication();
       app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
       // applyMainPipeline(app) — comment không tính
       app.use(requestIdMiddleware);`,
    );
    expect(hand.usesHelper).toBe(false);
    expect(hand.handRolledSteps).toEqual(["useGlobalInterceptors", "requestIdMiddleware"]);

    const IMPORT = `import { applyMainPipeline } from "../helpers/bootstrap-app";\n`;
    const viaVar = analyzeSpec(
      "c.int-spec.ts",
      `${IMPORT}const built = moduleRef.createNestApplication();
       return applyMainPipeline(built, { grantMemo: false });`,
    );
    expect(viaVar.usesHelper, "biến gán từ createNestApplication rồi truyền vào helper").toBe(true);

    const decoy = analyzeSpec(
      "d.int-spec.ts",
      `${IMPORT}app = moduleRef.createNestApplication();
       if (process.env.NEVER_SET) applyMainPipeline(other);`,
    );
    expect(decoy.usesHelper, "gọi helper trên biến KHÁC không phải là chuyển").toBe(false);

    const partial = analyzeSpec(
      "e.int-spec.ts",
      `${IMPORT}app = applyMainPipeline(moduleRef.createNestApplication());
       app2 = ref2.createNestApplication();`,
    );
    expect(partial.usesHelper, "file 2 app mà chỉ bọc 1").toBe(false);
  });
});
