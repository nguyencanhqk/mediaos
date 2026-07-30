import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_INFO_FILENAME,
  EMPTY_BUILD_INFO,
  UNKNOWN,
  defaultBuildInfoPath,
  readBuildInfo,
} from "./build-info";

/**
 * S6-REL-1 · D1 — định danh build.
 *
 * Trọng tâm của bộ test này KHÔNG phải "đọc được JSON" mà là **nhánh hỏng**: `/health` là liveness,
 * canary dựa vào nó, nên thiếu file / JSON rác / kiểu sai đều PHẢI ra `unknown` chứ không được ném.
 * Một `readBuildInfo` biết ném là đủ để làm sập cổng canary của chính bản deploy nó đi kèm.
 */
describe("readBuildInfo", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediaos-buildinfo-"));
    delete process.env["MEDIAOS_BUILD_INFO_PATH"];
  });

  function write(content: string): string {
    const file = path.join(dir, BUILD_INFO_FILENAME);
    fs.writeFileSync(file, content, "utf8");
    return file;
  }

  it("đọc đủ 4 trường từ stamp hợp lệ", () => {
    const file = write(
      JSON.stringify({
        version: "1.0.0-rc.1",
        commit: "c4afe351",
        builtAt: "2026-07-30T11:00:00.000Z",
        migrationHead: "0534_s6secmv1_dashboard_mv_tenant_barrier",
        migrationCount: 202,
      }),
    );

    expect(readBuildInfo(file)).toEqual({
      version: "1.0.0-rc.1",
      commit: "c4afe351",
      builtAt: "2026-07-30T11:00:00.000Z",
      migrationHead: "0534_s6secmv1_dashboard_mv_tenant_barrier",
    });
  });

  it("giữ nguyên hậu tố -dirty (build từ cây bẩn KHÔNG được làm tròn thành sha sạch)", () => {
    const file = write(JSON.stringify({ commit: "c4afe351-dirty" }));

    expect(readBuildInfo(file).commit).toBe("c4afe351-dirty");
  });

  it("thiếu file ⇒ unknown, KHÔNG ném", () => {
    const missing = path.join(dir, "khong-ton-tai.json");

    expect(() => readBuildInfo(missing)).not.toThrow();
    expect(readBuildInfo(missing)).toEqual(EMPTY_BUILD_INFO);
  });

  it("JSON hỏng ⇒ unknown, KHÔNG ném", () => {
    const file = write("{ khong-phai-json");

    expect(() => readBuildInfo(file)).not.toThrow();
    expect(readBuildInfo(file)).toEqual(EMPTY_BUILD_INFO);
  });

  it.each([
    ["mảng", "[]"],
    ["null", "null"],
    ["số", "42"],
    ["chuỗi", '"1.0.0"'],
  ])("JSON hợp lệ nhưng không phải object (%s) ⇒ unknown", (_label, body) => {
    expect(readBuildInfo(write(body))).toEqual(EMPTY_BUILD_INFO);
  });

  it.each([
    ["thiếu khoá", "{}"],
    ["rỗng", '{"version":""}'],
    ["toàn khoảng trắng", '{"version":"   "}'],
    ["kiểu số", '{"version":123}'],
    ["null", '{"version":null}'],
  ])("trường không dùng được (%s) ⇒ unknown cho ĐÚNG trường đó", (_label, body) => {
    expect(readBuildInfo(write(body)).version).toBe(UNKNOWN);
  });

  it("trường tốt vẫn đọc được khi trường khác rác — không đánh sập cả object", () => {
    const file = write(JSON.stringify({ version: "1.0.0-rc.1", commit: 0, builtAt: null }));
    const info = readBuildInfo(file);

    expect(info.version).toBe("1.0.0-rc.1");
    expect(info.commit).toBe(UNKNOWN);
    expect(info.builtAt).toBe(UNKNOWN);
  });

  it("cắt khoảng trắng hai đầu", () => {
    expect(readBuildInfo(write('{"commit":"  c4afe351  "}')).commit).toBe("c4afe351");
  });

  it("MEDIAOS_BUILD_INFO_PATH được dùng khi không truyền tham số", () => {
    const file = write(JSON.stringify({ version: "9.9.9-env" }));
    process.env["MEDIAOS_BUILD_INFO_PATH"] = file;

    expect(readBuildInfo().version).toBe("9.9.9-env");
  });

  it("tham số tường minh THẮNG env (đường test không bị env máy làm lệch)", () => {
    process.env["MEDIAOS_BUILD_INFO_PATH"] = write(JSON.stringify({ version: "tu-env" }));
    const other = path.join(dir, "khac.json");
    fs.writeFileSync(other, JSON.stringify({ version: "tu-tham-so" }), "utf8");

    expect(readBuildInfo(other).version).toBe("tu-tham-so");
  });

  it("đường mặc định trỏ vào GỐC dist (build-info.json ở cấp trên module health/)", () => {
    const p = defaultBuildInfoPath();

    expect(path.basename(p)).toBe(BUILD_INFO_FILENAME);
    // Module này biên dịch ra dist/health/ ⇒ file phải nằm ở dist/, tức KHÔNG cùng thư mục với module.
    expect(path.basename(path.dirname(p))).not.toBe("health");
  });

  it("chạy trong test (chưa stamp) ⇒ unknown — nhánh mà mọi môi trường dev sẽ gặp", () => {
    expect(readBuildInfo()).toEqual(EMPTY_BUILD_INFO);
  });
});
