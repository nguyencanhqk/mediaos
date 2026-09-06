import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  listenWithoutClose,
  offenders,
  scanIntegrationSpecs,
  sharedRequestHelpers,
} from "./supertest-listen-census";

/**
 * S18-QA-SUPERTESTLISTEN-1 — RATCHET chống tái phát cờ `ECONNRESET` của supertest.
 *
 * Bất biến ép ở đây: *một int-spec chạy request supertest SONG SONG (`Promise.all`) trên một
 * `INestApplication` mới `init()` mà chưa `listen` là ĐỎ*. Lý do đầy đủ ở docblock của
 * `supertest-listen-census.ts`; tóm tắt: supertest tự đóng server tạm khi request ĐẦU về, nên
 * request thứ hai của cùng lô ăn `ECONNRESET` — cục bộ gần như luôn xanh, nổ ở CI của một PR
 * KHÔNG liên quan.
 *
 * ⚠️ Cổng này đọc CÚ PHÁP, nên nó tự mù được: một census trả về rỗng (đổi thư mục, đổi đuôi file,
 * đổi tên `Promise.all`) sẽ làm ca chính XANH mà không đo gì. Vì vậy mọi ca dưới đây đi kèm ca
 * chống-xanh-rỗng, và bộ nhận dạng được đo bằng nguồn TỔNG HỢP chứ không chỉ bằng cây thật.
 */
describe("S18-QA-SUPERTESTLISTEN-1 — supertest song song đòi app.listen(0)", () => {
  const scans = scanIntegrationSpecs();

  // ── Chống xanh-rỗng: census phải THẤY thứ nó tuyên bố quét ────────────────────────────────────
  it("census KHÔNG rỗng: quét được thư mục int-spec và nhận ra app.init/Promise.all", () => {
    expect(scans.length, "không đọc được apps/api/test/integration/*.int-spec.ts").toBeGreaterThan(
      200,
    );
    expect(
      scans.filter((s) => s.apps.length > 0).length,
      "không nhận ra app nào gọi init()",
    ).toBeGreaterThan(100);
    expect(
      scans.filter((s) => s.promiseAlls.length > 0).length,
      "không nhận ra Promise.all",
    ).toBeGreaterThan(10);
    expect(
      scans.filter((s) => s.promiseAlls.some((p) => p.touchesSupertest)).length,
      "không lan truyền được vết supertest qua helper cục bộ ⇒ mọi ca dưới đây xanh RỖNG",
    ).toBeGreaterThan(10);
    expect(
      scans.filter((s) => s.apps.length > 0 && s.appsWithoutListen.length === 0).length,
      "không nhận ra app.listen() của bất kỳ file nào",
    ).toBeGreaterThan(10);
  });

  // ── Ca chính ─────────────────────────────────────────────────────────────────────────────────
  it("KHÔNG file nào vừa chạy supertest trong Promise.all vừa thiếu app.listen(0)", () => {
    const bad = offenders(scans).map(
      (s) =>
        `${s.file} — app chưa listen: ${s.appsWithoutListen.join(", ")} (Promise.all chạm supertest ở dòng ${s.promiseAlls
          .filter((p) => p.touchesSupertest)
          .map((p) => p.line)
          .join(", ")})`,
    );
    expect(
      bad,
      `Thêm \`await app.listen(0)\` NGAY SAU \`await app.init()\` trong các file sau — ` +
        `KHÔNG được đổi \`Promise.all\` thành vòng \`await\` tuần tự (xem docblock census):\n` +
        bad.map((b) => `  • ${b}`).join("\n"),
    ).toEqual([]);
  });

  it("app đã listen(0) thì afterAll phải close() — nếu không, rò cổng sang spec sau", () => {
    expect(
      listenWithoutClose(scans).map((s) => `${s.file}: ${s.appsListenedNotClosed.join(", ")}`),
    ).toEqual([]);
  });

  /**
   * Lỗ CÒN LẠI của cổng, có tripwire chứ không im lặng: census phân tích TỪNG FILE, không giải
   * import. Hôm nay 0 helper dùng chung nào dựng request nên vết luôn nằm trong file; ngày điều đó
   * đổi, ca này ĐỎ và người sửa buộc phải nâng census thay vì nhận một cổng đã hoá mù.
   */
  it("tiền đề của cổng còn đúng: KHÔNG helper dùng chung nào dựng request supertest", () => {
    expect(
      sharedRequestHelpers(),
      "Có helper dùng chung chạm `getHttpServer` ⇒ census per-file KHÔNG còn thấy vết supertest của " +
        "các file dùng nó. PHẢI nâng `supertestTaint` thành phân tích xuyên file (giải import) TRƯỚC " +
        "khi chuyển tiếp int-spec sang helper đó.",
    ).toEqual([]);
  });

  // ── Bộ nhận dạng đo bằng nguồn TỔNG HỢP (không phụ thuộc cây thật) ────────────────────────────
  describe("bộ nhận dạng", () => {
    const APP_BOOT = `
      let app: INestApplication;
      beforeAll(async () => {
        app = moduleRef.createNestApplication();
        await app.init();
      });
      afterAll(async () => { await app?.close(); });
    `;

    it("DƯƠNG — vết supertest lan qua chuỗi helper cục bộ (http → post → assign)", () => {
      const s = analyzeSource(
        "synthetic-positive.int-spec.ts",
        `${APP_BOOT}
        const http = () => request(app.getHttpServer());
        const post = (u: string) => http().post(u);
        const assign = (id: string) => post(\`/assets/\${id}/assign\`);
        it("đua", async () => { await Promise.all([assign("a"), assign("a")]); });`,
      );
      expect(s.apps).toEqual(["app"]);
      expect(s.appsWithoutListen).toEqual(["app"]);
      expect(s.promiseAlls.map((p) => p.touchesSupertest)).toEqual([true]);
      expect(offenders([s]).map((x) => x.file)).toEqual(["synthetic-positive.int-spec.ts"]);
    });

    it("DƯƠNG — vết đi qua BIẾN TRUNG GIAN giữ mảng request (Promise.all(calls))", () => {
      const s = analyzeSource(
        "synthetic-array.int-spec.ts",
        `${APP_BOOT}
        const authGet = (t: string, u: string) => request(app.getHttpServer()).get(u);
        it("lô", async () => {
          const calls = [authGet("t", "/a"), authGet("t", "/b")];
          for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
        });`,
      );
      expect(s.promiseAlls.map((p) => p.touchesSupertest)).toEqual([true]);
    });

    it("DƯƠNG — mảng bồi bằng `.push()` rồi mới Promise.all (không phải initializer)", () => {
      const s = analyzeSource(
        "synthetic-push.int-spec.ts",
        `${APP_BOOT}
        const http = () => request(app.getHttpServer());
        it("lô", async () => {
          const calls: unknown[] = [];
          calls.push(http().get("/a"));
          calls.push(http().get("/b"));
          await Promise.all(calls);
        });`,
      );
      expect(s.promiseAlls.map((p) => p.touchesSupertest)).toEqual([true]);
    });

    it("DƯƠNG — biến GÁN LẠI sau khi khai báo rỗng (`let calls; calls = [...]`)", () => {
      const s = analyzeSource(
        "synthetic-reassign.int-spec.ts",
        `${APP_BOOT}
        const http = () => request(app.getHttpServer());
        it("lô", async () => {
          let calls;
          calls = [http().get("/a"), http().get("/b")];
          await Promise.all(calls);
        });`,
      );
      expect(s.promiseAlls.map((p) => p.touchesSupertest)).toEqual([true]);
    });

    it("DƯƠNG — `.listen()` của một server KHÁC không được tính cho app", () => {
      const s = analyzeSource(
        "synthetic-other-listen.int-spec.ts",
        `${APP_BOOT}
        const http = () => request(app.getHttpServer());
        beforeAll(async () => { server.listen(9999); });
        it("đua", async () => { await Promise.all([http().get("/a"), http().get("/b")]); });`,
      );
      expect(
        s.appsWithoutListen,
        "bắt `.listen(` theo TÊN METHOD sẽ dán nhãn an toàn cho app chưa hề listen",
      ).toEqual(["app"]);
      expect(offenders([s]).map((x) => x.file)).toEqual(["synthetic-other-listen.int-spec.ts"]);
    });

    it("ÂM — Promise.all chỉ gieo DB thì KHÔNG bị tính (đây là ca đã loại khỏi phạm vi WO)", () => {
      const s = analyzeSource(
        "synthetic-db-only.int-spec.ts",
        `${APP_BOOT}
        const direct = () => directPool();
        const authGet = (t: string, u: string) => request(app.getHttpServer()).get(u);
        it("gieo", async () => {
          const trio = await Promise.all([
            insertFile(direct(), "p1"), insertFile(direct(), "p2"), insertFile(direct(), "p3"),
          ]);
          expect((await authGet("t", "/files")).status).toBe(200);
        });`,
      );
      expect(
        s.promiseAlls.map((p) => p.touchesSupertest),
        "helper supertest CÓ trong file nhưng KHÔNG nằm trong Promise.all ⇒ không phải diện vá",
      ).toEqual([false]);
      expect(offenders([s])).toEqual([]);
    });

    it("ÂM — giá trị ĐÃ `await` không còn là request đang bay", () => {
      const s = analyzeSource(
        "synthetic-awaited.int-spec.ts",
        `${APP_BOOT}
        const http = () => request(app.getHttpServer());
        const createTask = async (t: string) => (await http().post("/tasks")).body.data;
        const queryTask = (id: string) => direct.query("SELECT 1", [id]);
        it("đọc", async () => {
          const c1 = await createTask("t");
          const c2 = await createTask("t");
          await Promise.all([c1.id, c2.id].map((id) => queryTask(id)));
        });`,
      );
      expect(
        s.promiseAlls.map((p) => p.touchesSupertest),
        "c1/c2 là HÀNG đã đọc xong, không đua được với ai — đây là 2 dương-tính-giả đã đo ở task-subtask-tree",
      ).toEqual([false]);
    });

    it("ÂM — đã có app.listen(0) thì không còn là vi phạm", () => {
      const s = analyzeSource(
        "synthetic-listened.int-spec.ts",
        `let app: INestApplication;
        beforeAll(async () => { await app.init(); await app.listen(0); });
        afterAll(async () => { await app?.close(); });
        const http = () => request(app.getHttpServer());
        it("đua", async () => { await Promise.all([http().get("/a"), http().get("/b")]); });`,
      );
      expect(s.appsWithoutListen).toEqual([]);
      expect(offenders([s])).toEqual([]);
    });

    it("NHIỀU app trong một file: mỗi app tự chịu trách nhiệm listen/close", () => {
      const s = analyzeSource(
        "synthetic-two-apps.int-spec.ts",
        `beforeAll(async () => {
          await app.init(); await app.listen(0);
          await app2.init();
        });
        afterAll(async () => { await app?.close(); await app2?.close(); });
        const http = () => request(app2.getHttpServer());
        it("đua", async () => { await Promise.all([http().get("/a"), http().get("/b")]); });`,
      );
      expect(s.apps).toEqual(["app", "app2"]);
      expect(s.appsWithoutListen).toEqual(["app2"]);
      expect(offenders([s]).map((x) => x.file)).toEqual(["synthetic-two-apps.int-spec.ts"]);
    });

    it("`app?.close()` (optional-chaining) vẫn được tính là có close", () => {
      const s = analyzeSource(
        "synthetic-close.int-spec.ts",
        `beforeAll(async () => { await app.init(); await app.listen(0); });
         afterAll(async () => { await app?.close(); });`,
      );
      expect(s.appsListenedNotClosed).toEqual([]);
      expect(listenWithoutClose([s])).toEqual([]);
    });
  });
});
