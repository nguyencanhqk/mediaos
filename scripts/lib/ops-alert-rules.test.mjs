// scripts/lib/ops-alert-rules.test.mjs — S6-REL-1 (D6).
//
// Trọng tâm: luật nền "THIẾU DỮ LIỆU ≠ BÌNH THƯỜNG". Một hệ cảnh báo báo xanh vì không đo được gì là
// chế độ hỏng nguy hiểm nhất — nó làm người trực tin rằng không có sự cố. Vì vậy mỗi luật đều có ca
// thiếu-dữ-liệu, và `worstSeverity` phải xếp `unknown` TRÊN `ok`.
//
// Chạy: node --test scripts/lib/*.test.mjs   (đã gắn vào harness/check.sh + CI)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_THRESHOLDS, evaluate, exitCodeFor, worstSeverity } from "./ops-alert-rules.mjs";

/** Tín hiệu "mọi thứ bình thường" — các ca dưới chỉ đổi ĐÚNG một trường để cô lập luật đang đo. */
const HEALTHY = {
  liveness: { ok: true },
  readiness: { status: "ok", latencyMs: 9 },
  migrationPending: 0,
  jobFailed: 0,
  errorLines: 0,
  diskFreeGb: 120,
  backupAgeHours: 3,
  certExpiryDays: 60,
};

const find = (rows, id) => rows.find((r) => r.id === id);
const sev = (signals, id) => find(evaluate(signals), id).severity;

describe("worstSeverity", () => {
  it("unknown nặng hơn ok — không được nuốt thành xanh", () => {
    assert.equal(worstSeverity(["ok", "unknown", "ok"]), "unknown");
  });

  it("crit thắng tất cả", () => {
    assert.equal(worstSeverity(["ok", "warn", "unknown", "crit"]), "crit");
  });

  it("warn nặng hơn unknown", () => {
    assert.equal(worstSeverity(["unknown", "warn"]), "warn");
  });

  it("rỗng ⇒ ok", () => {
    assert.equal(worstSeverity([]), "ok");
  });
});

describe("evaluate — trạng thái bình thường", () => {
  it("tín hiệu đủ và tốt ⇒ tất cả ok", () => {
    const rows = evaluate(HEALTHY);
    assert.equal(rows.length, 8, "phải phán xét đủ 8 nhóm");
    assert.equal(worstSeverity(rows.map((r) => r.severity)), "ok");
  });
});

describe("evaluate — THIẾU DỮ LIỆU phải ra unknown, KHÔNG phải ok", () => {
  const cases = [
    ["liveness", "BACKEND_DOWN"],
    ["readiness", "DB_CONNECTION"],
    ["migrationPending", "MIGRATION_DRIFT"],
    ["jobFailed", "JOB_FAILED"],
    ["errorLines", "ERROR_SPIKE"],
    ["diskFreeGb", "DISK_FREE"],
    ["backupAgeHours", "BACKUP_AGE"],
    ["certExpiryDays", "CERT_EXPIRY"],
  ];

  for (const [field, id] of cases) {
    it(`${field} = null ⇒ ${id} unknown`, () => {
      assert.equal(sev({ ...HEALTHY, [field]: null }, id), "unknown");
    });
    it(`${field} thiếu hẳn ⇒ ${id} unknown`, () => {
      const signals = { ...HEALTHY };
      delete signals[field];
      assert.equal(sev(signals, id), "unknown");
    });
  }

  it("không có tín hiệu nào ⇒ 8/8 unknown, tổng thể unknown (KHÔNG ok)", () => {
    const rows = evaluate({});
    assert.equal(rows.filter((r) => r.severity === "unknown").length, 8);
    assert.equal(worstSeverity(rows.map((r) => r.severity)), "unknown");
  });

  it("NaN cũng là không đo được", () => {
    assert.equal(sev({ ...HEALTHY, diskFreeGb: Number.NaN }, "DISK_FREE"), "unknown");
  });
});

describe("BACKEND_DOWN + DB_CONNECTION", () => {
  it("liveness không ok ⇒ crit", () => {
    assert.equal(
      sev({ ...HEALTHY, liveness: { ok: false, detail: "HTTP 502" } }, "BACKEND_DOWN"),
      "crit",
    );
  });

  it("readiness fail-soft: HTTP 200 nhưng body.status=down ⇒ crit (phải đọc BODY)", () => {
    assert.equal(sev({ ...HEALTHY, readiness: { status: "down" } }, "DB_CONNECTION"), "crit");
  });

  it("latency vượt ngưỡng ⇒ warn", () => {
    const over = DEFAULT_THRESHOLDS.dbLatencyWarnMs + 1;
    assert.equal(
      sev({ ...HEALTHY, readiness: { status: "ok", latencyMs: over } }, "DB_CONNECTION"),
      "warn",
    );
  });

  it("đúng ngưỡng latency vẫn ok (biên: chỉ VƯỢT mới warn)", () => {
    const at = DEFAULT_THRESHOLDS.dbLatencyWarnMs;
    assert.equal(
      sev({ ...HEALTHY, readiness: { status: "ok", latencyMs: at } }, "DB_CONNECTION"),
      "ok",
    );
  });
});

describe("MIGRATION_DRIFT", () => {
  it("1 migration tồn đọng đã là warn (dist mới trên schema cũ = sự cố PROD 2026-07-24)", () => {
    assert.equal(sev({ ...HEALTHY, migrationPending: 1 }, "MIGRATION_DRIFT"), "warn");
  });

  it("0 tồn đọng ⇒ ok", () => {
    assert.equal(sev({ ...HEALTHY, migrationPending: 0 }, "MIGRATION_DRIFT"), "ok");
  });
});

describe("luật càng LỚN càng nặng — biên", () => {
  it("jobFailed đúng ngưỡng warn ⇒ warn", () => {
    assert.equal(
      sev({ ...HEALTHY, jobFailed: DEFAULT_THRESHOLDS.jobFailedWarn }, "JOB_FAILED"),
      "warn",
    );
  });

  it("jobFailed đúng ngưỡng crit ⇒ crit", () => {
    assert.equal(
      sev({ ...HEALTHY, jobFailed: DEFAULT_THRESHOLDS.jobFailedCrit }, "JOB_FAILED"),
      "crit",
    );
  });

  it("errorLines dưới ngưỡng ⇒ ok", () => {
    assert.equal(
      sev({ ...HEALTHY, errorLines: DEFAULT_THRESHOLDS.errorLogWarn - 1 }, "ERROR_SPIKE"),
      "ok",
    );
  });

  it("backupAge vượt ngưỡng crit ⇒ crit", () => {
    assert.equal(
      sev({ ...HEALTHY, backupAgeHours: DEFAULT_THRESHOLDS.backupAgeCritH + 1 }, "BACKUP_AGE"),
      "crit",
    );
  });
});

describe("luật càng NHỎ càng nặng — biên", () => {
  it("đĩa đúng ngưỡng warn ⇒ warn", () => {
    assert.equal(
      sev({ ...HEALTHY, diskFreeGb: DEFAULT_THRESHOLDS.diskFreeWarnGb }, "DISK_FREE"),
      "warn",
    );
  });

  it("đĩa đúng ngưỡng crit ⇒ crit (crit thắng warn khi cả hai cùng đúng)", () => {
    assert.equal(
      sev({ ...HEALTHY, diskFreeGb: DEFAULT_THRESHOLDS.diskFreeCritGb }, "DISK_FREE"),
      "crit",
    );
  });

  it("đĩa trên ngưỡng warn ⇒ ok", () => {
    assert.equal(
      sev({ ...HEALTHY, diskFreeGb: DEFAULT_THRESHOLDS.diskFreeWarnGb + 1 }, "DISK_FREE"),
      "ok",
    );
  });

  it("cert sắp hết hạn ⇒ warn; hết hạn tới nơi ⇒ crit", () => {
    assert.equal(
      sev({ ...HEALTHY, certExpiryDays: DEFAULT_THRESHOLDS.certExpiryWarnDays }, "CERT_EXPIRY"),
      "warn",
    );
    assert.equal(
      sev({ ...HEALTHY, certExpiryDays: DEFAULT_THRESHOLDS.certExpiryCritDays }, "CERT_EXPIRY"),
      "crit",
    );
  });

  it("cert đã hết hạn (số âm) ⇒ crit", () => {
    assert.equal(sev({ ...HEALTHY, certExpiryDays: -1 }, "CERT_EXPIRY"), "crit");
  });
});

describe("ngưỡng ghi đè được", () => {
  it("nới ngưỡng đĩa thì cùng số liệu chuyển warn → ok", () => {
    const signals = { ...HEALTHY, diskFreeGb: 8 };
    assert.equal(find(evaluate(signals), "DISK_FREE").severity, "warn");
    assert.equal(find(evaluate(signals, { diskFreeWarnGb: 5 }), "DISK_FREE").severity, "ok");
  });
});

describe("exitCodeFor", () => {
  it("ok ⇒ 0", () => assert.equal(exitCodeFor("ok"), 0));
  it("warn ⇒ 1", () => assert.equal(exitCodeFor("warn"), 1));
  it("unknown ⇒ 1 — im lặng KHÔNG được tính là xanh ở cổng lệnh", () =>
    assert.equal(exitCodeFor("unknown"), 1));
  it("crit ⇒ 2", () => assert.equal(exitCodeFor("crit"), 2));
});

describe("mỗi phán quyết có đủ trường để in ra và gửi đi", () => {
  it("id · title · severity · detail đều có nội dung", () => {
    for (const row of evaluate(HEALTHY).concat(evaluate({}))) {
      assert.ok(row.id && row.title && row.severity && row.detail, JSON.stringify(row));
    }
  });
});
