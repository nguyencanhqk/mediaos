// backup-db-resolve.test.mjs — S6-GOLIVE-1 (LỖ-1)
//
// Chốt chống mọc lại cho `scripts/backup-db.sh`. Lỗ gốc: script chặn cứng ở `command -v pg_dump`,
// mà máy PROD-host (Windows, Postgres trong docker) KHÔNG có pg_dump trên PATH ⇒ backup CHƯA TỪNG
// chạy được trên chính máy nó phải bảo vệ (KI-050), trong khi RELEASE-08 §4 xếp backup là T-0 bước 3
// BẮT BUỘC trước khi migrate PROD.
//
// Đây là lần thứ BA cùng một lỗ trong repo (migrate-verify-ephemeral.sh → backup-restore-drill.sh →
// backup-db.sh). Test này tồn tại để không có lần thứ tư.
//
// Chạy trong step `tooling-tests` của harness/check.sh (node --test) — không cần DB, không cần docker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, delimiter } from "node:path";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "backup-db.sh");

// Test dựng PATH riêng cho từng ca ⇒ KHÔNG thể trông vào PATH để tìm `bash`. Spawn bằng đường dẫn
// TUYỆT ĐỐI. Trên Windows `where bash` trả cả shim WindowsApps/WSL — chỉ nhận bản Git Bash.
const BASH_BIN = (() => {
  if (process.platform !== "win32") return "/bin/bash";
  const found = execFileSync("where", ["bash"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .find((p) => /\\Git\\/i.test(p));
  if (!found)
    throw new Error("không tìm thấy Git Bash — test này cần bash thật, không phải shim WSL");
  return found;
})();

// Thư mục chứa coreutils đi kèm bash (date/grep/wc). Ca R1/R2 cần chúng; ca R3 thì KHÔNG đưa vào
// PATH để chắc chắn không có pg_dump/docker thật nào lọt vào (trên CI ubuntu /usr/bin có cả hai).
const COREUTILS_DIR = dirname(BASH_BIN);

/** Chạy `backup-db.sh --print-plan` với PATH/env dựng sẵn → trả object {pg_dump, flags, container}. */
function printPlan({ path, env = {} } = {}) {
  const out = execFileSync(BASH_BIN, [SCRIPT, "--print-plan"], {
    encoding: "utf8",
    env: {
      // env TỐI THIỂU, KHÔNG kế thừa process.env: test phải tiên đoán được, không phụ thuộc máy chạy.
      PATH: path,
      BACKUP_PG_DUMP: "",
      BACKUP_PG_CONTAINER: "",
      ...env,
    },
  });
  return Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

/** PATH cho ca "host có pg_dump": thư mục giả đứng TRƯỚC coreutils. */
const withFake = (fakeDir) => [fakeDir, COREUTILS_DIR].join(delimiter);

/** Thư mục bin giả có `pg_dump` chạy được — giả lập máy CI/Linux có postgresql-client. */
function fakeBinDirWithPgDump() {
  const dir = mkdtempSync(join(tmpdir(), "mediaos-fakebin-"));
  const bin = join(dir, "pg_dump");
  writeFileSync(bin, "#!/usr/bin/env bash\necho fake\n");
  chmodSync(bin, 0o755);
  return dir;
}

// ── R1: host CÓ pg_dump ⇒ đi đường cũ, KHÔNG đụng docker ────────────────────────────────────
// Đây là ràng buộc "không đổi một byte hành vi" cho CI (ubuntu có postgresql-client thật).
test("R1 — có pg_dump trên PATH ⇒ dùng binary trần, không rơi vào docker", () => {
  const fake = fakeBinDirWithPgDump();
  const plan = printPlan({ path: withFake(fake) });

  assert.equal(plan.pg_dump, "pg_dump", "phải dùng binary trần khi PATH có pg_dump");
  assert.ok(
    !plan.pg_dump.includes("docker"),
    "KHÔNG được rơi vào fallback container khi PATH đã có",
  );
});

// ── R2: KHÔNG BAO GIỜ dùng --file ───────────────────────────────────────────────────────────
// Bẫy: qua `docker exec`, --file ghi vào filesystem CỦA CONTAINER ⇒ script báo DONE mà host rỗng.
// Ô "tuổi bản backup" của ops-alert-check sẽ xanh trong khi thật ra không có bản backup nào.
test("R2 — cờ dump KHÔNG chứa --file (phải ghi qua STDOUT)", () => {
  const fake = fakeBinDirWithPgDump();
  const plan = printPlan({ path: withFake(fake) });

  assert.ok(!plan.flags.includes("--file"), `cờ dump không được có --file, đang là: ${plan.flags}`);
  assert.ok(
    plan.flags.includes("--format=custom"),
    "vẫn phải giữ custom-format (restore chọn lọc được)",
  );
  assert.ok(plan.flags.includes("--no-owner"), "vẫn phải giữ --no-owner");
  assert.ok(plan.flags.includes("--no-privileges"), "vẫn phải giữ --no-privileges");
});

// Chốt ở tầng văn bản: không ai được thêm --file lại vào lệnh dump trong script.
test("R2b — thân script không còn `--file` ở lệnh pg_dump", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(SCRIPT, "utf8");
  const dumpLines = src
    .split("\n")
    .filter((l) => /PG_DUMP|pg_dump/.test(l) && !l.trimStart().startsWith("#"));

  for (const line of dumpLines) {
    assert.ok(!line.includes("--file"), `dòng dump không được dùng --file: ${line.trim()}`);
  }
});

// ── R3: không có pg_dump lẫn container ⇒ FAIL rõ ràng, KHÔNG skip im lặng ───────────────────
// "Backup không chạy được" phải là lỗi ồn ào. Nếu nó im lặng exit 0, người trực go-live sẽ tin là
// đã có backup rồi bấm tiếp bước migrate PROD — đúng kịch bản mất dữ liệu.
test("R3 — không pg_dump, không docker ⇒ exit ≠ 0 kèm lý do", () => {
  const emptyBin = mkdtempSync(join(tmpdir(), "mediaos-nobin-"));
  let threw = false;
  let stderr = "";
  try {
    execFileSync(BASH_BIN, [SCRIPT, "--print-plan"], {
      encoding: "utf8",
      // PATH CHỈ có thư mục rỗng — không pg_dump, không docker, kể cả trên CI ubuntu.
      env: { PATH: emptyBin, BACKUP_PG_DUMP: "", BACKUP_PG_CONTAINER: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    threw = true;
    stderr = String(err.stderr ?? "");
  }

  assert.ok(threw, "phải exit ≠ 0 khi không phân giải được pg_dump — KHÔNG được skip im lặng");
  assert.match(stderr, /pg_dump/, "thông điệp lỗi phải nói rõ thiếu pg_dump");
});

// ── Override tường minh thắng mọi auto-detect (đường thoát cho vận hành) ─────────────────────
test("BACKUP_PG_DUMP tường minh được tôn trọng", () => {
  const fake = fakeBinDirWithPgDump();
  const plan = printPlan({
    path: withFake(fake),
    env: { BACKUP_PG_DUMP: "/opt/pg17/bin/pg_dump" },
  });

  assert.equal(plan.pg_dump, "/opt/pg17/bin/pg_dump", "env tường minh phải thắng binary trên PATH");
});

// ── --print-plan là read-only: không tạo thư mục backup, không cần DATABASE_DIRECT_URL ──────
test("--print-plan không cần DATABASE_DIRECT_URL và không ghi gì", () => {
  const fake = fakeBinDirWithPgDump();
  // Không set DATABASE_DIRECT_URL → nếu script đòi biến này trước khi in plan sẽ exit ≠ 0.
  const out = execFileSync(BASH_BIN, [SCRIPT, "--print-plan"], {
    encoding: "utf8",
    env: { PATH: withFake(fake), BACKUP_PG_DUMP: "", BACKUP_PG_CONTAINER: "" },
  });
  assert.match(out, /^pg_dump=/m);
});
