// harness/lib/claims.mjs — sổ "ai đang giữ Work Order nào" (chia sẻ MỌI worktree, zero-dep).
//
// Vì sao đặt dưới git-common-dir (.git/mediaos-claims/):
//   - git-common-dir là CHUNG cho mọi worktree (linked worktree trỏ về .git của main) →
//     phiên ở worktree/branch khác đọc được claim của nhau (mục tiêu: phát hiện làm TRÙNG Work Order).
//   - Nằm trong .git/ → git KHÔNG BAO GIỜ track → không là artifact commit, không cần .gitignore.
//
// Dùng bởi:
//   - .claude/hooks/guard-claim.mjs  (PreToolUse: claim-on-touch + cảnh báo trùng · Stop: release)
//   - harness/claim.mjs              (CLI người dùng: list / prune / release)
//
// Bộ phân biệt phiên = session_id (Claude Code truyền vào hook qua stdin). Hai phiên Claude khác nhau →
// session_id khác → bắt được cả khác-worktree lẫn cùng-worktree-khác-terminal.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Claim "sống" trong khoảng này (refresh mỗi lần chủ sở hữu Edit). Quá hạn ⇒ coi như phiên chết/bỏ →
// phiên khác được tiếp quản, KHÔNG cảnh báo nữa. Đủ dài để không bẫy phiên dài; release-on-Stop dọn sớm hơn.
export const CLAIM_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function git(args, cwd) {
  // KHÔNG shell:true — git.exe resolve trực tiếp qua PATH (cả win32), tránh DeprecationWarning DEP0190.
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : "";
}

// Thư mục claim chung mọi worktree. Trả null nếu không phải repo git (fail-open ở caller).
export function claimsDir(cwd = process.cwd()) {
  const common = git(["rev-parse", "--git-common-dir"], cwd);
  if (!common) return null;
  const top = git(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const abs = path.isAbsolute(common) ? common : path.resolve(top, common);
  return path.join(abs, "mediaos-claims");
}

export function currentBranch(cwd = process.cwd()) {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "?";
}

function fileFor(dir, id) {
  // id của Work Order vốn đã kebab/UPPER an toàn cho tên file; vẫn lọc phòng hờ.
  return path.join(dir, `${String(id).replace(/[^\w.-]/g, "_")}.json`);
}

export function readClaim(id, cwd = process.cwd()) {
  const dir = claimsDir(cwd);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(fileFor(dir, id), "utf8"));
  } catch {
    return null; // chưa có / hỏng → coi như không có
  }
}

export function writeClaim(id, data, cwd = process.cwd()) {
  const dir = claimsDir(cwd);
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileFor(dir, id), JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function removeClaim(id, cwd = process.cwd()) {
  const dir = claimsDir(cwd);
  if (!dir) return false;
  try {
    fs.rmSync(fileFor(dir, id), { force: true });
    return true;
  } catch {
    return false;
  }
}

// [{ id, claim }] cho mọi claim hiện có.
export function listClaims(cwd = process.cwd()) {
  const dir = claimsDir(cwd);
  if (!dir) return [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      out.push({
        id: n.replace(/\.json$/, ""),
        claim: JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")),
      });
    } catch {
      /* bỏ file hỏng */
    }
  }
  return out;
}

export function isStale(claim, now, ttl = CLAIM_TTL_MS) {
  return !claim || typeof claim.ts !== "number" || now - claim.ts > ttl;
}

// ── Branch-level: PHIÊN nào đang SỐNG trên một branch (gộp theo session_id) ──
// Dùng phát hiện HAI PHIÊN cùng cầm MỘT branch (chống giẫm chân commit/đè nhau), không chỉ trùng 1 WO.
// Trả [{ session_id, branch, cwd, ts, wos[] }] — mỗi session_id một mục, ts = hoạt động gần nhất.
export function sessionsOnBranch(
  branch,
  now = Date.now(),
  cwd = process.cwd(),
  ttl = CLAIM_TTL_MS,
) {
  const bySession = new Map();
  for (const { id, claim } of listClaims(cwd)) {
    if (!claim || claim.branch !== branch || !claim.session_id || isStale(claim, now, ttl))
      continue;
    const s = bySession.get(claim.session_id) || {
      session_id: claim.session_id,
      branch,
      cwd: claim.cwd,
      ts: 0,
      wos: [],
    };
    s.wos.push(id);
    if (claim.ts > s.ts) {
      s.ts = claim.ts;
      s.cwd = claim.cwd;
    }
    bySession.set(claim.session_id, s);
  }
  return [...bySession.values()];
}
