#!/usr/bin/env node
/**
 * release-artifact.mjs — S6-REL-1 (D3) · ĐÓNG KI-016 + dựng đường ROLLBACK ứng dụng.
 *
 * ═══ VẤN ĐỀ (KI-016, sổ ghi rõ "go-live blocker") ═══
 * Service PROD `MediaOS-API` chạy thẳng `apps/api/dist/main.js` — CHÍNH thư mục mà `m dev-online` và
 * `m dev-online-fast` biên dịch lại. Bật môi trường UAT có thể đẩy binary mới vào PROD trong khi DB
 * PROD chưa áp migration tương ứng (đã gây PROD login 500 ngày 2026-07-08). Ngoài ra `dist` bị ghi đè
 * mỗi lần build ⇒ **không có bản trước để quay về**: `RELEASE-01` §7.3 ghi rollback ứng dụng là
 * "⚠️ có đường nhưng chưa diễn tập" chính vì lý do này.
 *
 * ═══ GIẢI ═══
 * Đóng băng mỗi lần build thành một thư mục BẤT BIẾN `apps/api/releases/<stamp>/`, service trỏ vào
 * junction `apps/api/releases/current`. Deploy = đổi junction. Rollback = đổi junction về bản trước.
 *
 * ═══ VÌ SAO ĐẶT TRONG apps/api (ràng buộc kỹ thuật, không phải sở thích) ═══
 * Node phân giải `node_modules` bằng cách đi LÊN từ thư mục chứa file. Đặt release ở
 * `apps/api/releases/<stamp>/` thì chuỗi tra là:
 *     apps/api/releases/<stamp>/node_modules → apps/api/releases/node_modules
 *   → apps/api/node_modules  ✅ (nơi pnpm đặt dep của @mediaos/api)  → <repo>/node_modules
 * Đặt ở `<repo>/releases/` sẽ TRƯỢT `apps/api/node_modules` (pnpm isolated, KHÔNG hoist) ⇒ vỡ lúc chạy.
 * `current` là junction — Node mặc định phân giải realpath, nên chuỗi tra tính từ thư mục THẬT.
 * Lệnh `verify` dưới đây chứng minh điều này bằng resolver thật, không bằng lý luận.
 *
 * ═══ AN TOÀN ═══
 * - Mọi thao tác xoá/ghi đều bị chặn ngoài `apps/api/releases/` (guard `assertInsideReleases`).
 * - Từ chối đóng gói build KHÔNG có định danh (`build-info.json` thiếu / commit `unknown`): một release
 *   không định danh được thì rollback và smoke không assert được gì. `--force` mở khoá + cảnh báo LOUD.
 * - `prune` không bao giờ xoá bản đang `current`.
 * - Junction (không phải symlink) ⇒ KHÔNG cần Administrator trên Windows.
 *
 * ═══ DÙNG ═══
 *   node scripts/release-artifact.mjs snapshot            # dist → releases/<stamp> + trỏ current
 *   node scripts/release-artifact.mjs list [--json]
 *   node scripts/release-artifact.mjs activate <stamp>
 *   node scripts/release-artifact.mjs rollback [<stamp>]  # bỏ trống = bản NGAY TRƯỚC current
 *   node scripts/release-artifact.mjs verify [<stamp>]    # chứng minh phân giải dep + main.js lành
 *   node scripts/release-artifact.mjs prune --keep 5
 *
 * Exit: 0 OK · 1 thất bại · 2 sai cách dùng.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const API_DIR = path.join(REPO_ROOT, "apps", "api");
const DIST_DIR = path.join(API_DIR, "dist");
const RELEASES_DIR = path.join(API_DIR, "releases");
const CURRENT_LINK = path.join(RELEASES_DIR, "current");
const BUILD_INFO = "build-info.json";
const UNKNOWN = "unknown";
/** Dep đại diện cho phân giải từ release dir — có thì cả cây dep của Nest cũng có. */
const RESOLVE_PROBES = ["@nestjs/core", "@mediaos/contracts", "drizzle-orm"];

const log = (m) => process.stdout.write(`[release] ${m}\n`);
const warn = (m) => process.stderr.write(`[release] !  ${m}\n`);
function die(m, code = 1) {
  process.stderr.write(`[release] X  ${m}\n`);
  process.exit(code);
}

// ── Guard: không bao giờ ghi/xoá ngoài apps/api/releases ─────────────────────────────────────
function assertInsideReleases(target, what) {
  const resolved = path.resolve(target);
  const base = path.resolve(RELEASES_DIR);
  const inside = resolved === base || resolved.startsWith(base + path.sep);
  if (!inside) die(`GUARD: từ chối ${what} — '${resolved}' nằm NGOÀI ${base}`);
  if (resolved === base) die(`GUARD: từ chối ${what} — không thao tác lên chính thư mục releases`);
}

// ── Đọc / ghi ────────────────────────────────────────────────────────────────────────────────
function readBuildInfo(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, BUILD_INFO), "utf8"));
    return {
      version: typeof raw.version === "string" ? raw.version : UNKNOWN,
      commit: typeof raw.commit === "string" ? raw.commit : UNKNOWN,
      builtAt: typeof raw.builtAt === "string" ? raw.builtAt : UNKNOWN,
      migrationHead: typeof raw.migrationHead === "string" ? raw.migrationHead : UNKNOWN,
    };
  } catch {
    return { version: UNKNOWN, commit: UNKNOWN, builtAt: UNKNOWN, migrationHead: UNKNOWN };
  }
}

/** `current` là junction/symlink → tên bản đang chạy; chưa trỏ đâu ⇒ null. */
function currentStamp() {
  try {
    return path.basename(fs.realpathSync(CURRENT_LINK));
  } catch {
    return null;
  }
}

/** Danh sách release, mới nhất TRƯỚC (tên bắt đầu bằng timestamp nên sắp xếp chuỗi là đúng thứ tự). */
function listReleases() {
  if (!fs.existsSync(RELEASES_DIR)) return [];
  return fs
    .readdirSync(RELEASES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "current")
    .map((e) => e.name)
    .sort()
    .reverse()
    .map((name) => ({
      stamp: name,
      dir: path.join(RELEASES_DIR, name),
      ...readBuildInfo(path.join(RELEASES_DIR, name)),
    }));
}

/** `<UTC-compact>__<version>__<commit>` — sắp xếp theo tên = sắp xếp theo thời gian. */
function makeStamp(info) {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const safe = (s) => (s === UNKNOWN ? UNKNOWN : s.replace(/[^A-Za-z0-9._-]/g, "_"));
  return `${ts}__${safe(info.version)}__${safe(info.commit)}`;
}

/**
 * Trỏ `current` sang release. Junction trên Windows (KHÔNG cần Administrator, khác symlink);
 * symlink thư mục trên POSIX. Đổi nguyên tử không làm được trên Windows ⇒ xoá-rồi-tạo, và nếu bước
 * tạo hỏng thì NÓI RÕ hệ thống đang không có `current` (im lặng ở đây = service chết mà không ai biết vì sao).
 */
function pointCurrent(stamp) {
  const target = path.join(RELEASES_DIR, stamp);
  assertInsideReleases(target, "activate");
  if (!fs.existsSync(path.join(target, "main.js"))) die(`release '${stamp}' không có main.js`);
  // Gỡ 'current' cũ. `unlink` cho symlink/junction — TƯỜNG MINH, không dựa vào việc `rmSync` tình cờ
  // làm đúng. (Đã đo trên Windows: `rmSync(junction, {recursive:true})` chỉ gỡ junction, KHÔNG xoá
  // thư mục đích. Nhưng nếu sau này ai đó thay junction bằng bản COPY thật thì nhánh recursive sẽ
  // xoá đúng một release — tức mất bản để rollback. Tách hai nhánh để lỗi đó không xảy ra âm thầm.)
  const link = fs.lstatSync(CURRENT_LINK, { throwIfNoEntry: false });
  if (link) {
    if (link.isSymbolicLink()) fs.unlinkSync(CURRENT_LINK);
    else
      die(
        `'${path.relative(REPO_ROOT, CURRENT_LINK)}' là THƯ MỤC THẬT chứ không phải junction — từ chối xoá. Kiểm tra tay.`,
      );
  }
  try {
    fs.symlinkSync(target, CURRENT_LINK, process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    die(
      `KHÔNG tạo được 'current' → '${stamp}': ${err.message}. Hệ thống đang KHÔNG có current — service sẽ không khởi động được.`,
    );
  }
  log(`current → ${stamp}`);
}

// ── Lệnh ─────────────────────────────────────────────────────────────────────────────────────
function cmdSnapshot(argv) {
  const force = argv.includes("--force");
  if (!fs.existsSync(path.join(DIST_DIR, "main.js"))) {
    die(
      `chưa có ${path.relative(REPO_ROOT, DIST_DIR)}/main.js — chạy 'pnpm --filter @mediaos/api build' trước`,
    );
  }
  const info = readBuildInfo(DIST_DIR);
  if (info.commit === UNKNOWN || info.version === UNKNOWN) {
    const msg = `build KHÔNG có định danh (${BUILD_INFO} thiếu hoặc commit/version = unknown)`;
    if (!force) {
      die(
        `${msg}. Release không định danh được thì rollback/smoke không assert được gì. Build lại (script build đã tự stamp), hoặc --force nếu thật sự cần.`,
      );
    }
    warn(
      `${msg} — vẫn đóng gói vì có --force. Bản này sẽ TRƯỢT cổng 'release-smoke --expect-commit'.`,
    );
  }
  if (info.commit.endsWith("-dirty")) {
    warn(`build từ cây làm việc BẨN (${info.commit}) — không tái lập được từ sha này.`);
  }

  const stamp = makeStamp(info);
  const target = path.join(RELEASES_DIR, stamp);
  assertInsideReleases(target, "snapshot");
  if (fs.existsSync(target))
    die(`release '${stamp}' đã tồn tại — release là BẤT BIẾN, không ghi đè`);

  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  fs.cpSync(DIST_DIR, target, { recursive: true });
  log(
    `đóng gói ${path.relative(REPO_ROOT, target)} (${info.version} · ${info.commit} · ${info.migrationHead})`,
  );

  /**
   * `--no-activate`: đóng gói NHƯNG CHƯA trỏ `current`.
   *
   * VÌ SAO tách: `m prod-update` chạy build → snapshot → **migrate (fail-closed)** → restart. Nếu
   * snapshot trỏ `current` ngay mà bước migrate lại DỪNG (schema chưa ở head), thì service vẫn đang
   * chạy bản CŨ trong bộ nhớ — nhưng `current` đã trỏ bản MỚI. Một lần restart bất kỳ (crash, reboot,
   * NSSM AppExit Restart) sẽ khởi động **bản mới trên schema cũ** — đúng chế độ hỏng mà bước migrate
   * fail-closed sinh ra để chặn. Vì vậy đường deploy phải: snapshot --no-activate → migrate → activate.
   */
  if (argv.includes("--no-activate")) {
    log(`CHƯA trỏ 'current' (--no-activate). Kích hoạt sau khi migrate: activate --latest`);
    return stamp;
  }
  pointCurrent(stamp);
  return stamp;
}

function cmdList(argv) {
  const releases = listReleases();
  const cur = currentStamp();
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ current: cur, releases }, null, 2)}\n`);
    return;
  }
  if (releases.length === 0) {
    log("chưa có release nào — chạy 'node scripts/release-artifact.mjs snapshot'");
    return;
  }
  for (const r of releases) {
    const mark = r.stamp === cur ? "▶ " : "  ";
    log(`${mark}${r.stamp}  ${r.version} · ${r.commit} · ${r.migrationHead}`);
  }
  if (!cur) warn("KHÔNG có 'current' — service sẽ không khởi động được nếu đang trỏ vào đó.");
}

function cmdActivate(argv) {
  // `--latest` = bản mới nhất theo tên (tên bắt đầu bằng timestamp). Dùng ở bước sau migrate của
  // `m prod-update`, nơi PowerShell không tiện bắt lại stamp mà `snapshot` vừa in ra.
  if (argv.includes("--latest")) {
    const newest = listReleases()[0];
    if (!newest) die("chưa có release nào để kích hoạt");
    pointCurrent(newest.stamp);
    return;
  }
  const stamp = argv.find((a) => !a.startsWith("--"));
  if (!stamp) die("thiếu <stamp> (hoặc --latest) — xem 'list'", 2);
  if (!fs.existsSync(path.join(RELEASES_DIR, stamp))) die(`không có release '${stamp}'`);
  pointCurrent(stamp);
}

function cmdRollback(argv) {
  const explicit = argv.find((a) => !a.startsWith("--"));
  const releases = listReleases();
  if (explicit) {
    if (!releases.some((r) => r.stamp === explicit)) die(`không có release '${explicit}'`);
    pointCurrent(explicit);
    return;
  }
  const cur = currentStamp();
  if (!cur) die("chưa có 'current' — không suy ra được 'bản trước'. Dùng: rollback <stamp>");
  const idx = releases.findIndex((r) => r.stamp === cur);
  if (idx < 0) die(`'current' trỏ tới '${cur}' nhưng không thấy trong danh sách release`);
  const prev = releases[idx + 1];
  if (!prev) die(`'${cur}' là release CŨ NHẤT — không có bản nào để quay về`);
  log(`rollback ${cur} → ${prev.stamp} (${prev.version} · ${prev.commit})`);
  pointCurrent(prev.stamp);
}

/**
 * Chứng minh release CHẠY ĐƯỢC mà KHÔNG khởi động app (boot thật sẽ nối DB PROD + chạy job nền —
 * cấm làm trong lúc verify). Hai bằng chứng:
 *   1. `node --check main.js` — file lành, parse được.
 *   2. `createRequire(main.js).resolve(dep)` — CHÍNH resolver của Node, tính từ đúng vị trí file thật
 *      ⇒ trả lời được câu hỏi "đặt ở đây có tìm thấy node_modules không" bằng đo, không bằng lý luận.
 */
function cmdVerify(argv) {
  const stamp = argv.find((a) => !a.startsWith("--")) ?? currentStamp();
  if (!stamp) die("chưa có 'current' và không truyền <stamp>", 2);
  const dir = path.join(RELEASES_DIR, stamp);
  const main = path.join(dir, "main.js");
  if (!fs.existsSync(main)) die(`'${stamp}' không có main.js`);

  execFileSync(process.execPath, ["--check", main], { stdio: "ignore" });
  log(`syntax OK — ${path.relative(REPO_ROOT, main)}`);

  const req = createRequire(main);
  for (const dep of RESOLVE_PROBES) {
    let resolved;
    try {
      resolved = req.resolve(dep);
    } catch (err) {
      die(
        `phân giải '${dep}' TỪ release THẤT BẠI: ${err.message}\n     ⇒ vị trí thư mục release sai (node_modules không nằm trên đường đi lên).`,
      );
    }
    log(`resolve ${dep} → ${path.relative(REPO_ROOT, resolved)}`);
  }
  const info = readBuildInfo(dir);
  log(`định danh: ${info.version} · ${info.commit} · ${info.migrationHead}`);
  if (info.commit === UNKNOWN)
    warn("release này KHÔNG có định danh — smoke --expect-commit sẽ ĐỎ.");
}

function cmdPrune(argv) {
  const i = argv.indexOf("--keep");
  const keep = i >= 0 && argv[i + 1] ? Number.parseInt(argv[i + 1], 10) : 5;
  if (!Number.isInteger(keep) || keep < 1) die("--keep phải là số nguyên ≥ 1", 2);
  const releases = listReleases();
  const cur = currentStamp();
  const beyondKeep = releases.slice(keep);
  const doomed = beyondKeep.filter((r) => r.stamp !== cur);
  // Nói rõ đã CHỪA cái gì: "không có gì để dọn" mà thật ra vừa bỏ qua bản current là báo cáo đánh lừa.
  const spared = beyondKeep.length - doomed.length;
  if (spared > 0) log(`chừa bản đang current ('${cur}') dù nằm ngoài ${keep} bản mới nhất.`);
  if (doomed.length === 0) {
    log(`không có gì để xoá (giữ ${keep}, hiện có ${releases.length}).`);
    return;
  }
  for (const r of doomed) {
    assertInsideReleases(r.dir, "prune");
    fs.rmSync(r.dir, { recursive: true, force: true });
    log(`đã xoá ${r.stamp}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "snapshot":
    cmdSnapshot(rest);
    break;
  case "list":
    cmdList(rest);
    break;
  case "activate":
    cmdActivate(rest);
    break;
  case "rollback":
    cmdRollback(rest);
    break;
  case "verify":
    cmdVerify(rest);
    break;
  case "prune":
    cmdPrune(rest);
    break;
  default:
    process.stderr.write(
      "dùng: release-artifact.mjs snapshot|list|activate <stamp>|rollback [<stamp>]|verify [<stamp>]|prune --keep N\n",
    );
    process.exit(2);
}
