// scripts/lib/sca-summary.test.mjs — S19-OPS-SCASATELLITE-1 (plan §5, T1–T13).
//
// Trọng tâm: luật nền "KHÔNG ĐO ĐƯỢC ≠ SẠCH". Một lần quét báo xanh vì audit lỗi mạng / JSON hỏng /
// tiến trình không chạy là chế độ hỏng nguy hiểm nhất — nó làm người deploy tin rằng app không còn lỗ.
// Vì vậy: thiếu khoá / sai kiểu ⇒ ném (không coi là 0), và `verdict` đối chiếu JSON với exit code — mọi
// lệch giữa hai nguồn đều là "không đo được" (2), không bao giờ là "sạch" (0).
//
// Fixture tổng hợp, tên gói giả. Chạy: node --test scripts/lib/sca-summary.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countNonRegistry, installDrift, summarizeAudit, verdict } from "./sca-summary.mjs";

const auditJson = (v) =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...v } },
  });

const UNMEASURABLE = /không đo được/;

describe("summarizeAudit + verdict (npm/pnpm audit JSON → exit code)", () => {
  it("T1 npm: 0 high / 0 critical + exit 0 ⇒ 0", () => {
    const c = summarizeAudit(auditJson({}));
    assert.deepEqual(c, { critical: 0, high: 0, moderate: 0, low: 0 });
    assert.equal(verdict(c, 0), 0);
  });

  it("T2 npm: 1 high + exit 1 ⇒ 1", () => {
    const c = summarizeAudit(auditJson({ high: 1 }));
    assert.equal(c.high, 1);
    assert.equal(verdict(c, 1), 1);
  });

  it("T3 npm: 1 critical, 0 high + exit 1 ⇒ 1", () => {
    const c = summarizeAudit(auditJson({ critical: 1 }));
    assert.equal(c.critical, 1);
    assert.equal(verdict(c, 1), 1);
  });

  it("T4 chỉ moderate/low + exit 0 ⇒ 0 (dưới ngưỡng cổng)", () => {
    const c = summarizeAudit(auditJson({ moderate: 3, low: 2 }));
    assert.deepEqual(c, { critical: 0, high: 0, moderate: 3, low: 2 });
    assert.equal(verdict(c, 0), 0);
  });

  it("T5 pnpm audit JSON (advisories/actions/muted) cùng hình dạng metadata", () => {
    const pnpm = JSON.stringify({
      actions: [],
      advisories: { 1: { module_name: "pkg-alpha", severity: "high" } },
      muted: [],
      metadata: {
        vulnerabilities: { info: 0, low: 5, moderate: 17, high: 30, critical: 0 },
        dependencies: 900,
        devDependencies: 0,
        optionalDependencies: 0,
        totalDependencies: 900,
      },
    });
    const c = summarizeAudit(pnpm);
    assert.deepEqual(c, { critical: 0, high: 30, moderate: 17, low: 5 });
    assert.equal(verdict(c, 1), 1);
  });

  it("T6 thiếu metadata ⇒ ném «không đo được» (KHÔNG coi là 0)", () => {
    assert.throws(() => summarizeAudit(JSON.stringify({ vulnerabilities: {} })), UNMEASURABLE);
    assert.throws(() => summarizeAudit(JSON.stringify({ metadata: {} })), UNMEASURABLE);
    assert.throws(() => summarizeAudit("null"), UNMEASURABLE);
  });

  it("T7 high là chuỗi / âm / thiếu khoá ⇒ ném", () => {
    assert.throws(() => summarizeAudit(auditJson({ high: "1" })), UNMEASURABLE);
    assert.throws(() => summarizeAudit(auditJson({ high: -1 })), UNMEASURABLE);
    assert.throws(() => summarizeAudit(auditJson({ critical: 1.5 })), UNMEASURABLE);
    const noHigh = JSON.stringify({
      metadata: { vulnerabilities: { low: 0, moderate: 0, critical: 0 } },
    });
    assert.throws(() => summarizeAudit(noHigh), UNMEASURABLE);
  });

  it("T8 JSON lỗi / đầu ra lỗi mạng / chuỗi rỗng ⇒ ném", () => {
    assert.throws(() => summarizeAudit("npm error code ECONNREFUSED"), UNMEASURABLE);
    assert.throws(() => summarizeAudit(""), UNMEASURABLE);
    const netErr = JSON.stringify({
      message: "request to http://127.0.0.1:9 failed",
      error: { code: "ECONNREFUSED" },
    });
    assert.throws(() => summarizeAudit(netErr), UNMEASURABLE);
  });

  it("T9 JSON sạch nhưng exit 1 ⇒ 2 (lệch nguồn, không phải sạch)", () => {
    assert.equal(verdict(summarizeAudit(auditJson({})), 1), 2);
  });

  it("T10 JSON có high nhưng exit 0 ⇒ 2 (lệch nguồn)", () => {
    assert.equal(verdict(summarizeAudit(auditJson({ high: 2 })), 0), 2);
  });

  it("T11 exitCode null / undefined (lỗi spawn, ENOBUFS, bị kill) ⇒ 2", () => {
    const clean = summarizeAudit(auditJson({}));
    const dirty = summarizeAudit(auditJson({ critical: 1 }));
    assert.equal(verdict(clean, null), 2);
    assert.equal(verdict(dirty, null), 2);
    assert.equal(verdict(clean, undefined), 2);
    assert.equal(verdict(null, 0), 2);
  });
});

describe("countNonRegistry (resolution không đến từ registry trong lockfile)", () => {
  it("T12 pnpm-lock có resolution {tarball: …} ⇒ 1, tên trả về", () => {
    const lock = [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      pkg-alpha:",
      "        specifier: ^1.0.0",
      "        version: 1.2.3",
      "      pkg-beta:",
      "        specifier: https://cdn.example.test/pkg-beta-2.0.0.tgz",
      "        version: https://cdn.example.test/pkg-beta-2.0.0.tgz",
      "",
      "packages:",
      "",
      "  pkg-alpha@1.2.3:",
      "    resolution: {integrity: sha512-AAAAbbbbCCCCdddd+/eeee==}",
      "    engines: {node: '>=18'}",
      "",
      "  '@scope/pkg-gamma@0.1.0':",
      "    resolution: {integrity: sha512-ZZZZyyyy0000==}",
      "",
      "  pkg-beta@https://cdn.example.test/pkg-beta-2.0.0.tgz:",
      "    resolution: {tarball: https://cdn.example.test/pkg-beta-2.0.0.tgz}",
      "    version: 2.0.0",
      "",
      "snapshots:",
      "",
      "  pkg-alpha@1.2.3: {}",
      "",
    ].join("\n");
    const r = countNonRegistry(lock, "pnpm");
    assert.equal(r.count, 1);
    assert.deepEqual(r.names, ["pkg-beta"]);
  });

  it("T12b pnpm: git / directory / block-style integrity — quy tắc DƯƠNG", () => {
    const lock = [
      "packages:",
      "",
      "  pkg-git@git+https://example.test/r.git#abc:",
      "    resolution: {commit: abc, repo: https://example.test/r.git, type: git}",
      "",
      "  pkg-dir@file:../local:",
      "    resolution: {directory: ../local, type: directory}",
      "",
      "  pkg-block@1.0.0:",
      "    resolution:",
      "      integrity: sha512-QQQQ==",
      "",
      "  pkg-mixed@1.0.0:",
      "    resolution: {integrity: sha512-QQQQ==, tarball: https://mirror.example.test/pkg-mixed.tgz}",
      "",
    ].join("\n");
    const r = countNonRegistry(lock, "pnpm");
    assert.equal(r.count, 3);
    assert.deepEqual(r.names, ["pkg-dir", "pkg-git", "pkg-mixed"]);
  });

  it("T13 npm lock: resolved ngoài registry ⇒ 1; toàn registry ⇒ 0", () => {
    const base = {
      name: "app",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "app", dependencies: { "pkg-alpha": "^1.0.0" } },
        "node_modules/pkg-alpha": {
          version: "1.2.3",
          resolved: "https://registry.npmjs.org/pkg-alpha/-/pkg-alpha-1.2.3.tgz",
          integrity: "sha512-AAAA==",
        },
        "node_modules/pkg-alpha/node_modules/@scope/pkg-gamma": {
          version: "0.1.0",
          resolved: "https://registry.npmjs.org/@scope/pkg-gamma/-/pkg-gamma-0.1.0.tgz",
          integrity: "sha512-BBBB==",
        },
      },
    };
    assert.deepEqual(countNonRegistry(JSON.stringify(base), "npm"), { count: 0, names: [] });

    const withTarball = structuredClone(base);
    withTarball.packages["node_modules/pkg-beta"] = {
      version: "2.0.0",
      resolved: "https://cdn.example.test/pkg-beta-2.0.0.tgz",
      integrity: "sha512-CCCC==",
    };
    assert.deepEqual(countNonRegistry(JSON.stringify(withTarball), "npm"), {
      count: 1,
      names: ["pkg-beta"],
    });

    // Tiền tố giả mạo (registry.npmjs.org.evil…) KHÔNG được tính là registry.
    const spoof = structuredClone(base);
    spoof.packages["node_modules/pkg-delta"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org.evil.test/pkg-delta/-/pkg-delta-1.0.0.tgz",
    };
    assert.equal(countNonRegistry(JSON.stringify(spoof), "npm").count, 1);
  });

  it("T13b lockfile hỏng / kind lạ ⇒ ném «không đo được»", () => {
    assert.throws(() => countNonRegistry("{not json", "npm"), UNMEASURABLE);
    assert.throws(
      () => countNonRegistry(JSON.stringify({ lockfileVersion: 3 }), "npm"),
      UNMEASURABLE,
    );
    assert.throws(() => countNonRegistry("lockfileVersion: '9.0'\n", "pnpm"), UNMEASURABLE);
    assert.throws(() => countNonRegistry("{}", "yarn"), UNMEASURABLE);
  });
});

// Gate SCA-1: audit chỉ đọc LOCKFILE. Đổi lockfile mà quên cài lại ⇒ build chạy cây cũ, audit vẫn xanh. Đối
// chiếu bản sao cây đã cài (npm: node_modules/.package-lock.json · pnpm: node_modules/.pnpm/lock.yaml).
describe("installDrift (cây đã cài so với lockfile)", () => {
  const npmLock = (pkgs) =>
    JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app" }, ...pkgs } });
  const pnpmLock = (pkgs, snaps) =>
    [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      alpha:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0",
      "",
      "packages:",
      "",
      ...pkgs.flatMap((k) => [`  '${k}':`, "    resolution: {integrity: sha512-x}", ""]),
      "snapshots:",
      "",
      ...snaps.map((k) => `  '${k}': {}`),
      "",
    ].join(String.fromCharCode(10));

  it("T14 npm: khớp (cây cài thiếu gói dev/optional của nền tảng khác) ⇒ 0 · 0 · 0", () => {
    const wanted = npmLock({
      "node_modules/alpha": { version: "1.0.0" },
      "node_modules/@x/bin-other-os": { version: "1.0.0", optional: true },
      "node_modules/devtool": { version: "2.0.0", dev: true },
      "node_modules/both": { version: "3.0.0", devOptional: true },
    });
    const current = npmLock({ "node_modules/alpha": { version: "1.0.0" } });
    assert.deepEqual(installDrift(wanted, current, "npm"), { extra: 0, missing: 0, changed: 0 });
  });

  it("T14b npm: gói lồng cũ còn trong cây · khác bản · thiếu gói chạy thật ⇒ đếm đủ ba loại", () => {
    const wanted = npmLock({
      "node_modules/alpha": { version: "1.0.1" },
      "node_modules/beta": { version: "1.0.0" },
      "node_modules/devtool": { version: "2.0.0", dev: true },
    });
    const current = npmLock({
      "node_modules/alpha": { version: "1.0.0" },
      "node_modules/alpha/node_modules/gamma": { version: "0.9.0" },
    });
    assert.deepEqual(installDrift(wanted, current, "npm"), { extra: 1, missing: 1, changed: 1 });
  });

  it("T15 pnpm: cùng tập khoá packages/snapshots ⇒ 0; bản cũ còn cài ⇒ thừa + thiếu", () => {
    const wanted = pnpmLock(
      ["alpha@1.0.1", "@s/beta@2.0.0"],
      ["alpha@1.0.1", "@s/beta@2.0.0(alpha@1.0.1)"],
    );
    assert.deepEqual(installDrift(wanted, wanted, "pnpm"), { extra: 0, missing: 0, changed: 0 });
    const stale = pnpmLock(
      ["alpha@1.0.0", "@s/beta@2.0.0"],
      ["alpha@1.0.0", "@s/beta@2.0.0(alpha@1.0.0)"],
    );
    assert.deepEqual(installDrift(wanted, stale, "pnpm"), { extra: 3, missing: 3, changed: 0 });
  });

  it("T16 bản sao hỏng / không phải lockfile / kind lạ ⇒ ném «không đo được» (KHÔNG coi là khớp)", () => {
    const wanted = npmLock({ "node_modules/alpha": { version: "1.0.0" } });
    assert.throws(() => installDrift(wanted, "{hỏng", "npm"), UNMEASURABLE);
    assert.throws(
      () => installDrift(wanted, JSON.stringify({ lockfileVersion: 3 }), "npm"),
      UNMEASURABLE,
    );
    assert.throws(() => installDrift(pnpmLock([], []), "", "pnpm"), UNMEASURABLE);
    assert.throws(() => installDrift(wanted, wanted, "yarn"), UNMEASURABLE);
  });
});
