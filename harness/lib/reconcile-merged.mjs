// harness/lib/reconcile-merged.mjs — RECONCILE: commit ĐÃ MERGE ↔ ledger 'done'.
//
// Vì sao có file này:
//   Board status suy từ ledger (finish-on-commit). Khi một WO được merge TAY
//   (`gh pr merge --admin`) mà quên đóng dấu `done`, ledger không phản ánh → board kẹt ở
//   ready/reopened DÙ việc đã vào master. Đúng bẫy đã gặp với S2-INT-1 (0 event) và
//   S2-INT-2 (event cuối = 'reopened', merge #46 sau đó không stamp).
//
// Cách phát hiện (OFFLINE — không gọi gh, để gen-status nhanh + chạy được khi mất mạng):
//   mỗi commit squash trên nhánh tích hợp mang MÃ WO trong subject
//   (vd "S2-INT-1 — ..." hoặc "feat(api): S2-HR-BE-2 — ..."). Nếu một WO có commit như vậy
//   NHƯNG status hiệu dụng (overlay ledger ?? literal) != 'done' ⇒ DRIFT ⇒ append 1 sự kiện
//   'finished' (by: gen-status-reconcile). Idempotent: lần sau overlay=done → bỏ qua.
//
// Bảo thủ (fail-closed về phía KHÔNG stamp bừa):
//   - chỉ soi nhánh tích hợp (origin/master → master → HEAD), --first-parent (bỏ commit nội bộ feature);
//   - khớp mã WO theo ranh giới token (không lẫn S2-HR-BE-1 vào S2-HR-BE-12);
//   - chỉ đụng WO CÓ trong backlog (không bịa WO);
//   - git lỗi / không có ref ⇒ trả rỗng (no-op).

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../ledger.mjs";
import { statusOverlay } from "./wo-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DEPTH = 400; // đủ phủ toàn bộ lịch sử nhánh tích hợp cho repo cỡ này

function git(cmd, fallback = "") {
  try {
    return execSync(`git ${cmd}`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

// Ref nhánh tích hợp để soi — ưu tiên origin/master (đường đã merge THẬT), bất kể nhánh đang checkout.
export function integrationRef() {
  for (const r of ["origin/master", "master", "HEAD"]) {
    if (git(`rev-parse --verify --quiet ${r}`)) return r;
  }
  return null;
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const esc = (s) => s.replace(RE_SPECIAL, "\\$&");
// ranh giới token: ký tự trước/sau mã WO không được là chữ-số-gạch (tránh S2-HR-BE-1 ⊂ S2-HR-BE-12).
const tokenRe = (id) => new RegExp(`(^|[^\\w-])${esc(id)}([^\\w-]|$)`);

// Map<woId, {sha,subject}> — commit MỚI NHẤT trên ref tích hợp có subject chứa mã WO.
export function mergedCommits(ids, ref = integrationRef()) {
  const out = new Map();
  if (!ref) return out;
  // Delimiter '::' (KHÔNG dùng '|'): execSync trên Windows chạy qua cmd.exe, '|' là pipe operator
  // của shell ⇒ vỡ lệnh git. '::' không phải metachar của cmd nên qua được; '%h' không chứa ':'.
  const log = git(`log --first-parent --format=%h::%s ${ref} -${SCAN_DEPTH}`);
  if (!log) return out;
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("::");
      return { sha: l.slice(0, i), subject: l.slice(i + 2) };
    });
  for (const id of ids) {
    const re = tokenRe(id);
    const hit = commits.find((c) => re.test(c.subject)); // log mới→cũ ⇒ commit gần nhất
    if (hit) out.set(id, hit);
  }
  return out;
}

// Phát hiện WO đã merge nhưng ledger chưa 'done'.
//   apply=true  ⇒ đóng dấu 'finished' luôn (self-heal).
//   apply=false ⇒ chỉ trả danh sách drift (dry-run, không ghi ledger).
// Trả [{id, sha, subject, was}].
export function reconcileMerged(backlog, { apply = true } = {}) {
  const ov = statusOverlay();
  const merged = mergedCommits(backlog.map((b) => b.id));
  const drift = [];
  for (const b of backlog) {
    const hit = merged.get(b.id);
    if (!hit) continue;
    const eff = ov.has(b.id) ? ov.get(b.id) : b.status;
    if (eff === "done") continue; // ledger (hoặc literal) đã done → không drift
    drift.push({ id: b.id, sha: hit.sha, subject: hit.subject, was: eff });
  }
  if (apply) {
    for (const d of drift) {
      appendEvent({
        wo: d.id,
        type: "finished",
        detail: `reconcile: merged trên nhánh tích hợp (${d.sha} "${d.subject}") nhưng ledger chưa 'done' (was ${d.was}) → auto-stamp`,
        by: "gen-status-reconcile",
      });
    }
  }
  return drift;
}
