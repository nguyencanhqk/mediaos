#!/usr/bin/env node
/**
 * stamp-build.mjs — S6-REL-1 (D1) · đóng dấu ĐỊNH DANH cho artifact `apps/api/dist`.
 *
 * VÌ SAO: `nest build` sinh ra một thư mục `dist` không mang bất kỳ dấu vết nào về "bản nào". Hệ quả
 * đo được trên chính dự án này: `m prod-restart` làm PID/log/env trông như đã deploy trong khi dist
 * vẫn là code CŨ (memory `prod-restart-does-not-rebuild-dist`), và không ai phát hiện được bằng cách
 * gọi API. Đóng dấu vào ARTIFACT (không phải đọc git lúc boot) là điểm mấu chốt: một service đang chạy
 * dist cũ phải khai đúng sha CŨ — nếu đọc `git rev-parse` lúc khởi động thì nó lại khai sha MỚI của
 * repo và ta quay về đúng cái bẫy cần chặn.
 *
 * CHẠY: tự động ở cuối `pnpm --filter @mediaos/api build` (xem apps/api/package.json). Chạy tay:
 *   node scripts/stamp-build.mjs [--out <đường-dẫn-json>]
 *
 * ĐỌC BỞI: `apps/api/src/health/build-info.ts` → `GET /api/v1/health` → `build`.
 *
 * KHÔNG BAO GIỜ làm build đỏ: thiếu git / không đọc được journal ⇒ ghi "unknown" cho trường đó và
 * vẫn exit 0. Build đỏ vì thiếu metadata là đánh đổi sai — nhưng "unknown" thì các cổng phía sau
 * (`release-smoke.mjs --expect-commit`) coi là ĐỎ, nên bản không stamp không lọt được ra PROD.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const API_DIR = path.join(REPO_ROOT, "apps", "api");
const UNKNOWN = "unknown";

/** `--out <path>` để test/CI ghi ra chỗ khác mà không đụng dist thật. */
function parseOut(argv) {
  const i = argv.indexOf("--out");
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.join(API_DIR, "dist", "build-info.json");
}

/** Version = nguồn duy nhất ở package.json ROOT (packages con đều private, không bump riêng). */
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version.trim() !== ""
      ? pkg.version.trim()
      : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/**
 * Short SHA + cờ dirty. `-dirty` là thông tin THẬT và cần thiết: build từ cây làm việc bẩn không tái
 * lập được từ sha đó, nên nó phải hiện ra ở /health thay vì bị làm tròn thành một sha "sạch".
 */
function readCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!sha) return UNKNOWN;
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return status === "" ? sha : `${sha}-dirty`;
  } catch {
    return UNKNOWN;
  }
}

/** Tag migration cuối trong journal LÚC BUILD — để đối chiếu với DB (phát hiện dist-mới-trên-schema-cũ). */
function readMigrationHead() {
  try {
    const journal = JSON.parse(
      fs.readFileSync(path.join(API_DIR, "migrations", "meta", "_journal.json"), "utf8"),
    );
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (entries.length === 0) return { migrationHead: UNKNOWN, migrationCount: 0 };
    const head = entries[entries.length - 1];
    return {
      migrationHead: typeof head?.tag === "string" && head.tag !== "" ? head.tag : UNKNOWN,
      migrationCount: entries.length,
    };
  } catch {
    return { migrationHead: UNKNOWN, migrationCount: 0 };
  }
}

function main() {
  const out = parseOut(process.argv.slice(2));
  const { migrationHead, migrationCount } = readMigrationHead();
  const info = {
    version: readVersion(),
    commit: readCommit(),
    builtAt: new Date().toISOString(),
    migrationHead,
    migrationCount,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`, "utf8");
  process.stdout.write(
    `[stamp-build] ${path.relative(REPO_ROOT, out)} ← ${info.version} · ${info.commit} · ${info.migrationHead}\n`,
  );
}

main();
