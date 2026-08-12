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
  sites: [
    {
      id: "SOCIAL",
      title: "fbpost",
      url: "http://localhost:3500/login",
      status: 200,
      bodyOk: true,
    },
    { id: "LMS", title: "LMS", url: "http://localhost:3400/login", status: 200, bodyOk: true },
  ],
  nextBuilds: [
    { id: "SOCIAL", dir: "apps/fbpost", mode: "prod" },
    { id: "LMS", dir: "apps/lms", mode: "prod" },
  ],
};

/** Số hàng khi đủ tín hiệu: 8 nhóm nền + 1 hàng/trang dò + 1 hàng bản build Next. */
const HEALTHY_ROWS = 8 + HEALTHY.sites.length + 1;

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
    assert.equal(rows.length, HEALTHY_ROWS, "phải phán xét đủ mọi nhóm");
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
    ["sites", "SITE_PROBES"],
    ["nextBuilds", "NEXT_DEV_BUILD"],
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

  it("không có tín hiệu nào ⇒ 10/10 unknown, tổng thể unknown (KHÔNG ok)", () => {
    const rows = evaluate({});
    assert.equal(rows.filter((r) => r.severity === "unknown").length, 10);
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

// ── Sự cố THẬT 11–12/08: fbpost :3500 trả 500 MỌI đường dẫn suốt ~15 tiếng mà không rule nào kêu,
// vì `ops-alert-check` chỉ dò API :3100. Nhóm test dưới ghim luật: mọi trang PROD đều phải có
// người canh, và "không dò trang nào" KHÔNG được ra xanh.
describe("SITE_* — trang PROD ngoài API (fbpost :3500 · LMS :3400)", () => {
  const withSites = (sites) => evaluate({ ...HEALTHY, sites });

  it("một trang 500 ⇒ CRIT (chính xác sự cố fbpost 11–12/08)", () => {
    const rows = withSites([{ id: "SOCIAL", title: "fbpost", status: 500 }]);
    assert.equal(find(rows, "SITE_SOCIAL").severity, "crit");
    assert.equal(worstSeverity(rows.map((r) => r.severity)), "crit");
  });

  it("503 cũng crit", () => {
    assert.equal(
      find(withSites([{ id: "LMS", title: "LMS", status: 503 }]), "SITE_LMS").severity,
      "crit",
    );
  });

  it("không ai trả lời (ECONNREFUSED) ⇒ crit — đó là PHÉP ĐO, không phải thiếu dữ liệu", () => {
    const rows = withSites([
      { id: "SOCIAL", title: "fbpost", status: null, transport: "ECONNREFUSED" },
    ]);
    assert.equal(find(rows, "SITE_SOCIAL").severity, "crit");
  });

  it("treo không trả lời (timeout) ⇒ crit — người dùng cũng chỉ thấy trang không lên", () => {
    assert.equal(
      find(withSites([{ id: "LMS", title: "LMS", status: null, transport: "timeout" }]), "SITE_LMS")
        .severity,
      "crit",
    );
  });

  it("lỗi lạ không rõ nghĩa ⇒ unknown, KHÔNG đoán bừa thành crit", () => {
    assert.equal(
      find(withSites([{ id: "LMS", title: "LMS", status: null, transport: "EPROTO" }]), "SITE_LMS")
        .severity,
      "unknown",
    );
  });

  it("200 nhưng thân trang mất dấu nhận dạng ⇒ warn (trang trắng/nội dung sai)", () => {
    assert.equal(
      find(
        withSites([
          { id: "SOCIAL", title: "fbpost", status: 200, bodyOk: false, expect: "MediaOS" },
        ]),
        "SITE_SOCIAL",
      ).severity,
      "warn",
    );
  });

  it("307 ⇒ warn — cổng phiên đá trang công khai ra, đường dò đã đổi", () => {
    assert.equal(
      find(withSites([{ id: "SOCIAL", title: "fbpost", status: 307 }]), "SITE_SOCIAL").severity,
      "warn",
    );
  });

  it("404 ⇒ warn — route biến mất là tín hiệu, không phải bình thường", () => {
    assert.equal(
      find(withSites([{ id: "LMS", title: "LMS", status: 404 }]), "SITE_LMS").severity,
      "warn",
    );
  });

  it("danh sách trang RỖNG ⇒ unknown — mù mà im lặng chính là lỗi đang vá", () => {
    const rows = evaluate({ ...HEALTHY, sites: [] });
    assert.equal(find(rows, "SITE_PROBES").severity, "unknown");
    assert.notEqual(worstSeverity(rows.map((r) => r.severity)), "ok");
  });

  it("mỗi trang là MỘT hàng riêng — một trang chết không bị trang khoẻ che", () => {
    const rows = withSites([
      { id: "SOCIAL", title: "fbpost", status: 500 },
      { id: "LMS", title: "LMS", status: 200, bodyOk: true },
    ]);
    assert.equal(find(rows, "SITE_SOCIAL").severity, "crit");
    assert.equal(find(rows, "SITE_LMS").severity, "ok");
  });
});

// ── Cùng sự cố, nhìn từ phía NGUYÊN NHÂN: `next dev` ghi đè `.next` mà `next start` đang phục vụ ⇒
// bundle devtool:'eval' ⇒ edge runtime ném EvalError ⇒ 500 mọi request. Bắt được TRƯỚC khi chết.
describe("NEXT_DEV_BUILD — bản dev đè lên bản PROD", () => {
  const withBuilds = (nextBuilds) => evaluate({ ...HEALTHY, nextBuilds });

  it("một app đang chạy bundle dev ⇒ crit", () => {
    const rows = withBuilds([
      { id: "SOCIAL", dir: "apps/fbpost", mode: "dev" },
      { id: "LMS", dir: "apps/lms", mode: "prod" },
    ]);
    assert.equal(find(rows, "NEXT_DEV_BUILD").severity, "crit");
    assert.match(find(rows, "NEXT_DEV_BUILD").detail, /apps[/\\]fbpost/);
  });

  it("tất cả prod ⇒ ok", () => {
    assert.equal(find(withBuilds(HEALTHY.nextBuilds), "NEXT_DEV_BUILD").severity, "ok");
  });

  it("không đọc được .next của một app ⇒ unknown, KHÔNG ok", () => {
    assert.equal(
      find(
        withBuilds([
          { id: "SOCIAL", dir: "apps/fbpost", mode: "prod" },
          { id: "LMS", dir: "apps/lms", mode: "missing" },
        ]),
        "NEXT_DEV_BUILD",
      ).severity,
      "unknown",
    );
  });

  it("dev THẮNG missing — có bằng chứng hỏng thì không hạ xuống unknown", () => {
    assert.equal(
      find(
        withBuilds([
          { id: "SOCIAL", dir: "apps/fbpost", mode: "dev" },
          { id: "LMS", dir: "apps/lms", mode: "missing" },
        ]),
        "NEXT_DEV_BUILD",
      ).severity,
      "crit",
    );
  });

  it("danh sách rỗng ⇒ unknown", () => {
    assert.equal(
      find(evaluate({ ...HEALTHY, nextBuilds: [] }), "NEXT_DEV_BUILD").severity,
      "unknown",
    );
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
