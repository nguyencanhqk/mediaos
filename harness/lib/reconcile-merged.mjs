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
//   - KHÔNG lật WO đang 'blocked' (xem shouldAutoStamp);
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

// chore(harness) + chore(docs) = commit ghi sổ/bookkeeping (STATUS/ledger/backlog/decisions/INDEX) —
// KHÔNG BAO GIỜ là commit "WO này đã ship". Loại trừ để tránh false-positive khi commit chỉ NHẮC TÊN
// WO id trong ghi chú (vd "record human decisions (S2-HR-BE-6/S3-ATT-BE-5/S2-AUTH-BE-7)").
//
// Vì sao chore(docs) cũng phải nằm đây (thêm 2026-07-29 — false-positive ĐÃ XẢY RA):
//   `chore(docs): regen STATUS/INDEX sau merge #301·#302·#303 + gỡ 2 bẫy trong WO S6-SEC-MV-1` (54fa86c6)
//   chỉ SỬA CHÚ THÍCH của WO trong backlog, nhưng subject mang token `S6-SEC-MV-1` ⇒ reconcile đóng dấu
//   'finished' cho một WO CHƯA HỀ thi công (không migration, không plan, không code).
//   Bằng chứng cho thấy nới rộng là AN TOÀN: toàn bộ commit `chore(docs)` trên origin/master đều là
//   regen STATUS; WO tài liệu ship bằng `docs(<scope>): <WO-ID> — …` (vd 0572b8d7 S5-ME-DOC-1,
//   af33fc15 S5-GOAL-DOC-1, cbd94819 S6-GOV-1) nên KHÔNG bị mất dấu bởi luật này.
//
// Vì sao `chore(gov)` cũng phải nằm đây (thêm 2026-07-31 — false-positive ĐÃ XẢY RA LẦN 2):
//   `chore(gov): HOÃN S6-SEC-IDENTITY-PROJ-1 ra ngoài cửa sổ RC + chặn WIP ảo tái phát (#314)` (555ed415)
//   là commit HOÃN — nội dung của nó nói WO này KHÔNG thi công — nhưng scope `gov` không có trong danh
//   sách trên ⇒ reconcile đọc thành "WO đã ship" và đóng dấu 'finished' cho một WO chưa hề có dòng code
//   nào (KI-053 + KI-054 vẫn MỞ). Commit quản trị (`gov`) mô tả QUYẾT ĐỊNH về WO, không phải việc ship WO.
const BOOKKEEPING_RE = /^chore\((harness|docs|gov)\)/i;

// Subject có phải commit ghi sổ/quản trị (KHÔNG BAO GIỜ là "WO này đã ship") không?
// Tách riêng để test soi được — đây là lớp chắn đã thủng 2 lần (S6-SEC-MV-1 · S6-SEC-IDENTITY-PROJ-1).
export function isBookkeeping(subject) {
  return BOOKKEEPING_RE.test(subject || "");
}

// Có được phép auto-stamp 'finished' cho WO đang ở status hiệu dụng này không?
//   'done'    ⇒ không (đã đúng, không drift).
//   'blocked' ⇒ KHÔNG. Đây là quyết định NGƯỜI (hoãn có chủ đích / chặn chờ chốt). Reconcile chỉ là
//              heuristic khớp chuỗi trên subject — heuristic KHÔNG được lật quyết định người. Bỏ luật
//              này thì mọi commit nhắc tên một WO đang hoãn đều biến nó thành "Đã xong", và vì commit
//              nằm vĩnh viễn trong lịch sử master, dấu sai TÁI PHÁT ở MỌI lần chạy gen-status sau đó.
//              Gỡ chặn là việc của người: `node harness/ledger.mjs event <WO> reopened "<lý do>"`.
export function shouldAutoStamp(effectiveStatus) {
  return effectiveStatus !== "done" && effectiveStatus !== "blocked";
}

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
    })
    .filter((c) => !isBookkeeping(c.subject));
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
    if (!shouldAutoStamp(eff)) continue; // đã done, HOẶC đang blocked (quyết định người) → không đụng
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
