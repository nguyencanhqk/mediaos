// scripts/lib/ops-log-window.test.mjs — S6-OPS-LOGWINDOW-1.
//
// Trọng tâm: hai chế độ hỏng của cách đếm cũ (gate bằng `mtime` của FILE).
//   · Dương tính giả — log CŨ + `mtime` MỚI ⇒ đếm cả lịch sử thành "lỗi trong 60 phút". Đây là lỗi
//     ĐANG XẢY RA trên PROD (đo 2026-08-01: trả 1787, sự thật 0) và là lý do WO này tồn tại.
//   · Âm tính giả — log MỚI + `mtime` CŨ ⇒ trả 0 ngay sau khi vừa có lỗi.
// Cả hai ca đều dựng file thật rồi đặt `mtime` bằng tay: nếu ai đó lén đưa `mtime` quay lại làm căn
// cứ, một trong hai ca này phải đỏ.
//
// Chạy: node --test scripts/lib/*.test.mjs   (đã gắn vào harness/check.sh + CI)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  DEFAULT_TAIL_BYTES,
  countErrorLinesInFile,
  countErrorLinesInWindow,
  parseJsonLogLine,
  parseLogTimestamp,
} from "./ops-log-window.mjs";
import { DEFAULT_THRESHOLDS, evaluate, exitCodeFor } from "./ops-alert-rules.mjs";

/** Mốc "bây giờ" cố định cho mọi ca — 15/07/2026 14:30:00 giờ địa phương. */
const NOW = new Date(2026, 6, 15, 14, 30, 0).getTime();
const MIN = 60_000;

const two = (n) => String(n).padStart(2, "0");

/** Dựng đúng chuỗi timestamp Nest in ra cho một mốc thời gian. */
function nestStamp(ms) {
  const d = new Date(ms);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return (
    `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}, ` +
    `${h12}:${two(d.getMinutes())}:${two(d.getSeconds())} ${h24 < 12 ? "AM" : "PM"}`
  );
}

/**
 * Dòng log Nest KÈM mã màu ANSI — sao đúng khuôn `logs/api.err.log` trên PROD. Test trên chuỗi đã
 * tẩy màu sẽ bỏ lọt lỗi thật, vì file thật không bao giờ sạch màu.
 */
function nestLine(ms, level, message, ctx = "WorkerSchedulerService") {
  return (
    `[31m[Nest] 8736  - [39m${nestStamp(ms)} ` +
    `[31m${level.padStart(7)}[39m [38;5;3m[${ctx}] [39m[31m${message}[39m`
  );
}

const TMP_DIRS = [];
function tmpLog(content, mtimeMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-log-window-"));
  TMP_DIRS.push(dir);
  const file = path.join(dir, "api.err.log");
  fs.writeFileSync(file, content, "utf8");
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}
after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

// ── Hai chế độ hỏng của cách đếm cũ ─────────────────────────────────────────────────────────
describe("mtime của file KHÔNG phải căn cứ", () => {
  it("lỗi CŨ + mtime MỚI ⇒ 0 (lỗi PROD 2026-08-01: cách cũ trả 1787)", () => {
    const threeDaysAgo = NOW - 3 * 24 * 60 * MIN;
    const text = Array.from({ length: 5 }, (_, i) =>
      [
        nestLine(threeDaysAgo, "ERROR", `Nhịp worker 'outbox' THẤT BẠI #${i}`),
        "    at NodePgPreparedQuery.queryWithCache (session.cjs:66:15)",
      ].join("\n"),
    ).join("\n");

    // mtime = BÂY GIỜ: đúng tình huống service restart chạm file mà không ghi lỗi mới nào.
    const file = tmpLog(`${text}\n`, NOW);
    assert.equal(countErrorLinesInFile(file, { nowMs: NOW, windowMin: 60 }), 0);
  });

  it("lỗi MỚI + mtime CŨ ⇒ vẫn đếm đủ (âm tính giả của cách cũ)", () => {
    const justNow = NOW - 5 * MIN;
    const text = [
      nestLine(justNow, "ERROR", "lỗi vừa xảy ra 1"),
      nestLine(justNow, "ERROR", "lỗi vừa xảy ra 2"),
    ].join("\n");

    // mtime lùi 3 giờ ⇒ cách cũ trả 0 vì `ageMin > WINDOW_MIN`.
    const file = tmpLog(`${text}\n`, NOW - 180 * MIN);
    assert.equal(countErrorLinesInFile(file, { nowMs: NOW, windowMin: 60 }), 2);
  });
});

// ── Cửa sổ đếm ──────────────────────────────────────────────────────────────────────────────
describe("countErrorLinesInWindow", () => {
  const count = (text, windowMin = 60) => countErrorLinesInWindow(text, { nowMs: NOW, windowMin });

  it("chỉ đếm dòng trong cửa sổ, bỏ dòng ngoài", () => {
    const text = [
      nestLine(NOW - 10 * MIN, "ERROR", "trong cửa sổ 1"),
      nestLine(NOW - 59 * MIN, "ERROR", "trong cửa sổ 2"),
      nestLine(NOW - 61 * MIN, "ERROR", "ngoài cửa sổ"),
      nestLine(NOW - 5 * 24 * 60 * MIN, "ERROR", "5 ngày trước"),
    ].join("\n");
    assert.equal(count(text), 2);
  });

  it("đúng mốc cắt được tính (biên ĐÓNG)", () => {
    assert.equal(count(nestLine(NOW - 60 * MIN, "ERROR", "đúng mốc")), 1);
  });

  it("timestamp ở tương lai VẪN tính — bỏ sót lỗi thật tệ hơn cảnh báo thừa", () => {
    assert.equal(count(nestLine(NOW + 30 * MIN, "ERROR", "đồng hồ lệch")), 1);
  });

  it("dòng ERROR KHÔNG có timestamp ⇒ không tính", () => {
    const text = ["ERROR: cái gì đó hỏng", "[31m  ERROR[39m không tiền tố Nest"].join("\n");
    assert.equal(count(text), 0);
  });

  it("stack trace nhiều dòng dưới 1 tiêu đề ⇒ tính 1", () => {
    const text = [
      nestLine(NOW - MIN, "ERROR", "Failed query:"),
      "Error: Failed query:",
      "    at NodePgPreparedQuery.queryWithCache (session.cjs:66:15)",
      "    at async OutboxWorker.processBatch (outbox-worker.js:53:9)",
    ].join("\n");
    assert.equal(count(text), 1);
  });

  it("chỉ đếm ERROR — LOG/WARN/DEBUG trong cùng cửa sổ bị bỏ qua", () => {
    const text = [
      nestLine(NOW - MIN, "LOG", "RetentionCleanupJob.run", "RetentionCleanupJob"),
      nestLine(NOW - MIN, "WARN", "thiếu MODULE_APP_METADATA", "ModuleCatalogService"),
      nestLine(NOW - MIN, "DEBUG", "RETENTION_CLEANUP", "RetentionCleanupJobHandler"),
      nestLine(NOW - MIN, "ERROR", "cái duy nhất được đếm"),
    ].join("\n");
    assert.equal(count(text), 1);
  });

  it("cửa sổ rộng hơn kéo thêm dòng cũ vào", () => {
    const text = [
      nestLine(NOW - 10 * MIN, "ERROR", "a"),
      nestLine(NOW - 100 * MIN, "ERROR", "b"),
    ].join("\n");
    assert.equal(count(text, 60), 1);
    assert.equal(count(text, 180), 2);
  });

  it("dropFirstLine bỏ dòng đầu (đuôi file cắt giữa dòng)", () => {
    const text = [
      nestLine(NOW - MIN, "ERROR", "dòng này coi như bị cắt"),
      nestLine(NOW - MIN, "ERROR", "dòng nguyên vẹn"),
    ].join("\n");
    assert.equal(countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60 }), 2);
    assert.equal(
      countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60, dropFirstLine: true }),
      1,
    );
  });

  it("rỗng / không phải chuỗi ⇒ 0", () => {
    assert.equal(count(""), 0);
    assert.equal(countErrorLinesInWindow(null, { nowMs: NOW }), 0);
  });
});

// ── Đọc timestamp ───────────────────────────────────────────────────────────────────────────
describe("parseLogTimestamp", () => {
  it("đọc được dòng THẬT lấy từ logs/api.err.log trên PROD", () => {
    const real =
      "[31m[Nest] 8736  - [39m07/30/2026, 7:52:21 AM [31m  ERROR[39m " +
      "[38;5;3m[WorkerSchedulerService] [39m[31mNhịp worker 'outbox' THẤT BẠI[39m";
    assert.equal(parseLogTimestamp(real), new Date(2026, 6, 30, 7, 52, 21).getTime());
  });

  it("12:xx AM = nửa đêm (giờ 0), 12:xx PM = giữa trưa (giờ 12)", () => {
    assert.equal(
      parseLogTimestamp("07/30/2026, 12:05:00 AM"),
      new Date(2026, 6, 30, 0, 5, 0).getTime(),
    );
    assert.equal(
      parseLogTimestamp("07/30/2026, 12:05:00 PM"),
      new Date(2026, 6, 30, 12, 5, 0).getTime(),
    );
  });

  it("11:59:59 PM ra 23:59:59", () => {
    assert.equal(
      parseLogTimestamp("07/30/2026, 11:59:59 PM"),
      new Date(2026, 6, 30, 23, 59, 59).getTime(),
    );
  });

  it("không có timestamp ⇒ null", () => {
    assert.equal(
      parseLogTimestamp("    at OutboxWorker.processBatch (outbox-worker.js:53:9)"),
      null,
    );
    assert.equal(parseLogTimestamp(""), null);
    assert.equal(parseLogTimestamp(undefined), null);
  });

  it("giá trị vô nghĩa ⇒ null, KHÔNG tràn sang tháng/ngày khác", () => {
    assert.equal(parseLogTimestamp("13/01/2026, 1:00:00 AM"), null); // tháng 13
    assert.equal(parseLogTimestamp("02/30/2026, 1:00:00 AM"), null); // 30 tháng Hai
    assert.equal(parseLogTimestamp("07/30/2026, 13:00:00 AM"), null); // giờ 13 ở hệ 12
    assert.equal(parseLogTimestamp("07/30/2026, 1:99:00 AM"), null); // phút 99
  });
});

// ── Đọc file ────────────────────────────────────────────────────────────────────────────────
describe("countErrorLinesInFile", () => {
  it("file không tồn tại ⇒ null (KHÔNG phải 0 — luật nền thiếu-dữ-liệu ≠ bình thường)", () => {
    assert.equal(countErrorLinesInFile(path.join(os.tmpdir(), "khong-ton-tai-ops.log")), null);
  });

  it("file rỗng ⇒ 0", () => {
    assert.equal(countErrorLinesInFile(tmpLog(""), { nowMs: NOW }), 0);
  });

  it("chỉ đọc phần ĐUÔI — dòng lỗi nằm ngoài đuôi không được đếm", () => {
    const padding = `${"x".repeat(500)}\n`.repeat(200); // ~100KB rác không có ERROR
    const text = [
      nestLine(NOW - MIN, "ERROR", "lỗi CŨ nằm ngoài đuôi đọc"),
      padding,
      nestLine(NOW - MIN, "ERROR", "lỗi nằm trong đuôi đọc"),
    ].join("\n");
    const file = tmpLog(`${text}\n`);
    assert.equal(countErrorLinesInFile(file, { nowMs: NOW, windowMin: 60, maxBytes: 4096 }), 1);
    assert.equal(countErrorLinesInFile(file, { nowMs: NOW, windowMin: 60 }), 2);
  });

  it("đuôi cắt giữa ký tự UTF-8 nhiều byte KHÔNG làm hỏng phép đếm", () => {
    const text = [
      nestLine(
        NOW - MIN,
        "ERROR",
        "Nhịp worker 'outbox' THẤT BẠI — tiếng Việt có dấu ăn nhiều byte",
      ),
      nestLine(NOW - MIN, "ERROR", "dòng thứ hai còn nguyên"),
    ].join("\n");
    const file = tmpLog(`${text}\n`);
    // Cắt đuôi rơi vào giữa dòng đầu (và giữa một ký tự có dấu) ⇒ dòng đầu bị bỏ, dòng sau vẫn đếm.
    const tail = Math.floor(Buffer.byteLength(text, "utf8") / 2);
    assert.equal(countErrorLinesInFile(file, { nowMs: NOW, windowMin: 60, maxBytes: tail }), 1);
  });

  it("đuôi mặc định 8MB (bản cũ 2MB — quá ngắn khi log phun mạnh)", () => {
    assert.equal(DEFAULT_TAIL_BYTES, 8 * 1024 * 1024);
  });
});

// ── S10-FND-JSONLOG-1 (KI-009) — API đổi log sang JSON có cấu trúc ─────────────────────────────
// Trọng tâm: đúng cái mà seed WO cảnh báo — "đổi format mà không sửa bộ đếm ⇒ rule đếm 0 mãi mãi ⇒
// cảnh báo vận hành mù trở lại". Ba lớp chứng minh dưới đây, từ trong ra ngoài:
//   1. `parseJsonLogLine` đọc đúng MỘT dòng JSON (đơn vị nhỏ nhất).
//   2. `countErrorLinesInWindow` đếm đúng khi log là JSON — VÀ khi tail lẫn cả JSON lẫn Nest văn
//      xuôi cũ (cửa sổ ngay sau lúc restart/deploy đổi format, log cũ chưa xoay hết).
//   3. BẺ HỎNG toàn tuyến: bơm số lượng dòng lỗi JSON giả khác nhau, đẩy qua `evaluate()` +
//      `exitCodeFor()` thật của `ops-alert-rules.mjs` — đo SEVERITY và EXIT CODE đổi đúng ngưỡng,
//      KHÔNG chỉ nhìn "đang chạy trên hệ khoẻ thấy xanh".
function jsonLine(ms, level, message, context = "TestService") {
  return JSON.stringify({ level, pid: 4242, timestamp: ms, message, context });
}

describe("parseJsonLogLine — đọc MỘT dòng log JSON có cấu trúc", () => {
  it("đọc đúng dòng error hợp lệ", () => {
    const line = jsonLine(NOW - MIN, "error", "Nhịp worker 'outbox' THẤT BẠI");
    assert.deepEqual(parseJsonLogLine(line), { ts: NOW - MIN, isError: true });
  });

  it("level khác 'error' (log/warn/debug/fatal) ⇒ isError=false", () => {
    for (const level of ["log", "warn", "debug", "verbose", "fatal"]) {
      const { isError } = parseJsonLogLine(jsonLine(NOW, level, "x"));
      assert.equal(isError, false, `level=${level}`);
    }
  });

  it("dòng không phải JSON (định dạng Nest cũ) ⇒ null", () => {
    assert.equal(parseJsonLogLine(nestLine(NOW, "ERROR", "cũ")), null);
  });

  it("JSON hợp lệ nhưng thiếu 'timestamp' hoặc 'level' ⇒ null, KHÔNG suy đoán", () => {
    assert.equal(parseJsonLogLine(JSON.stringify({ level: "error", message: "x" })), null);
    assert.equal(parseJsonLogLine(JSON.stringify({ timestamp: NOW, message: "x" })), null);
  });

  it("JSON hỏng cú pháp (bắt đầu bằng '{' nhưng parse lỗi) ⇒ null", () => {
    assert.equal(parseJsonLogLine('{"level":"error", "timestamp":'), null);
  });

  it("chuỗi rỗng / không phải string ⇒ null", () => {
    assert.equal(parseJsonLogLine(""), null);
    assert.equal(parseJsonLogLine(undefined), null);
  });
});

describe("countErrorLinesInWindow — định dạng JSON mới", () => {
  it("đếm dòng level=error trong cửa sổ, bỏ dòng ngoài cửa sổ", () => {
    const text = [
      jsonLine(NOW - 10 * MIN, "error", "trong cửa sổ 1"),
      jsonLine(NOW - 59 * MIN, "error", "trong cửa sổ 2"),
      jsonLine(NOW - 61 * MIN, "error", "ngoài cửa sổ"),
    ].join("\n");
    assert.equal(countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60 }), 2);
  });

  it("chỉ đếm level=error — log/warn/debug JSON trong cùng cửa sổ bị bỏ qua", () => {
    const text = [
      jsonLine(NOW - MIN, "log", "RetentionCleanupJob.run"),
      jsonLine(NOW - MIN, "warn", "thiếu MODULE_APP_METADATA"),
      jsonLine(NOW - MIN, "debug", "RETENTION_CLEANUP"),
      jsonLine(NOW - MIN, "error", "cái duy nhất được đếm"),
    ].join("\n");
    assert.equal(countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60 }), 1);
  });

  it("tail LẪN định dạng cũ (Nest văn xuôi) VÀ định dạng mới (JSON) — cả hai vẫn được đếm cộng dồn (cửa sổ chuyển tiếp ngay sau restart đổi format)", () => {
    const text = [
      nestLine(NOW - 30 * MIN, "ERROR", "dòng cũ trước lúc restart"),
      jsonLine(NOW - 5 * MIN, "error", "dòng mới sau lúc restart"),
    ].join("\n");
    assert.equal(countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60 }), 2);
  });
});

describe("BẺ HỎNG toàn tuyến — ERROR_SPIKE vẫn nổ đúng đọc log JSON (KHÔNG chỉ nhìn hệ đang khoẻ)", () => {
  /** Dựng N dòng lỗi JSON trong cửa sổ rồi chạy trọn pipeline: đếm → evaluate() → exitCodeFor(). */
  function pipelineFor(errorCount) {
    const text = Array.from({ length: errorCount }, (_, i) =>
      jsonLine(NOW - MIN, "error", `lỗi bơm giả #${i}`),
    ).join("\n");
    const errorLines = countErrorLinesInWindow(text, { nowMs: NOW, windowMin: 60 });
    const verdicts = evaluate({ errorLines });
    const spike = verdicts.find((v) => v.id === "ERROR_SPIKE");
    return { errorLines, severity: spike.severity, exitCode: exitCodeFor(spike.severity) };
  }

  it("dưới ngưỡng warn ⇒ ok, exit 0", () => {
    const { errorLines, severity, exitCode } = pipelineFor(DEFAULT_THRESHOLDS.errorLogWarn - 1);
    assert.equal(errorLines, DEFAULT_THRESHOLDS.errorLogWarn - 1);
    assert.equal(severity, "ok");
    assert.equal(exitCode, 0);
  });

  it("đúng ngưỡng warn ⇒ warn, exit 1", () => {
    const { severity, exitCode } = pipelineFor(DEFAULT_THRESHOLDS.errorLogWarn);
    assert.equal(severity, "warn");
    assert.equal(exitCode, 1);
  });

  it("đúng ngưỡng crit ⇒ crit, exit 2 — chứng minh bằng BƠM 200 dòng lỗi JSON giả thật sự", () => {
    const { errorLines, severity, exitCode } = pipelineFor(DEFAULT_THRESHOLDS.errorLogCrit);
    assert.equal(errorLines, DEFAULT_THRESHOLDS.errorLogCrit);
    assert.equal(severity, "crit");
    assert.equal(exitCode, 2);
  });

  it("0 dòng lỗi (hệ khoẻ thật) ⇒ ok, exit 0 — đối chứng, KHÔNG phải bằng chứng chính", () => {
    const { severity, exitCode } = pipelineFor(0);
    assert.equal(severity, "ok");
    assert.equal(exitCode, 0);
  });
});
