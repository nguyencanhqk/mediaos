// harness/lib/wo-state.mjs — STATUS HIỆU DỤNG cho Work Order = overlay từ ledger đè lên literal backlog.
//
// Vì sao có file này:
//   `status` trong harness/backlog.mjs là giá trị VIẾT TAY (literal). Để bảng/STATUS tự cập nhật khi
//   bắt đầu/đóng việc mà KHÔNG phải rewrite file JS (dễ vỡ), ta lấy sự kiện vòng đời từ sổ append-only
//   harness/activity.jsonl (ledger) làm nguồn LIVE và ĐÈ lên status literal.
//
//   status hiệu dụng = overlay-từ-ledger (nếu WO có sự kiện) ?? status literal trong backlog.mjs
//
// Một nguồn (activity.jsonl) lái CẢ status board LẪN "Dòng thời gian". backlog.mjs literal = baseline
// (giữ nguyên cho các WO lịch sử đã 'done', và cho item chưa từng chạm tới).
//
// Dùng bởi: dashboard/server.mjs · gen-status.mjs · .claude/hooks/guard-scope.mjs · guard-claim.mjs · finish.sh

import { readEvents, appendEvent } from "../ledger.mjs";

// Phân loại type sự kiện → "rổ" trạng thái. Sự kiện sau (theo thứ tự append) THẮNG → reopen-sau-block tự đúng.
const DONE = new Set(["finished", "done", "committed", "pr_opened"]);
const BLOCKED = new Set(["needs_human", "stopped_red", "evaluate_block", "blocked", "stopped"]);
// 'reopened'/'reset' = MỞ LẠI: gỡ WO khỏi overlay ⇒ về lại status literal (thường 'todo') để loop re-pick được.
//   Vẫn append-only mà reset được: event sau THẮNG, nên 'reopened' đặt SAU 'blocked'/'started' mồ côi ⇒ map.delete.
const REOPEN = new Set(["reopened", "reset"]);
// 'skipped' = bỏ qua (không đổi status, giữ literal). Còn lại (started/milestone/verified/…) ⇒ in_progress.
// QUAN TRỌNG: auto-loop ghi outcome THẬT (needs_human/plan_block/stopped…) DƯỚI type 'finished' + detail.
//   Nếu chỉ nhìn type ⇒ xếp nhầm vào 'done' (FALSE-DONE — đúng cái harness phải tránh). Nên xét detail:
const BLOCK_DETAIL = /^\s*(needs_human|plan_block|stopped_red|evaluate_block|blocked|stopped)\b/i;

// Map<woId, 'in_progress'|'done'|'blocked'> — chỉ chứa WO có sự kiện vòng đời trong ledger.
export function statusOverlay() {
  const map = new Map();
  for (const e of readEvents()) {
    if (!e || !e.wo || !e.type || e.type === "skipped") continue;
    if (REOPEN.has(e.type)) {
      map.delete(e.wo);
      continue;
    } // mở lại ⇒ về literal (todo)
    // detail báo chặn THẮNG type: 'finished — needs_human' là blocked, KHÔNG phải done.
    const bucket = BLOCK_DETAIL.test(e.detail || "")
      ? "blocked"
      : DONE.has(e.type)
        ? "done"
        : BLOCKED.has(e.type)
          ? "blocked"
          : "in_progress";
    map.set(e.wo, bucket); // chronological (append-only) ⇒ last-wins
  }
  return map;
}

// status hiệu dụng của 1 item (overlay thắng literal).
export function effectiveStatusOf(b, ov = statusOverlay()) {
  return ov.has(b.id) ? ov.get(b.id) : b.status;
}

// Trả MẢNG MỚI (bất biến) với status đã đè overlay — drop-in thay cho `backlog`.
export function applyStatus(backlog, ov = statusOverlay()) {
  return backlog.map((b) => (ov.has(b.id) ? { ...b, status: ov.get(b.id) } : b));
}

export function anyInProgress(backlog, ov = statusOverlay()) {
  return backlog.some((b) => effectiveStatusOf(b, ov) === "in_progress");
}

// glob (chỉ ** và *) → RegExp khớp toàn chuỗi, dùng '/'. (Cùng quy ước với guard-scope.)
function globToRe(g) {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = esc.replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*");
  return new RegExp("^" + re + "$");
}

// Các WO 'todo' + READY (depends_on đã done theo status hiệu dụng) mà `rel` rơi vào paths.
function readyTodoMatches(backlog, rel, ov = statusOverlay()) {
  const byId = Object.fromEntries(backlog.map((b) => [b.id, b]));
  const isDone = (id) => !byId[id] || effectiveStatusOf(byId[id], ov) === "done";
  return backlog.filter((b) => {
    if (effectiveStatusOf(b, ov) !== "todo") return false;
    if (!(b.depends_on || []).every(isDone)) return false; // chỉ READY
    return (b.paths || []).some((p) => globToRe(p).test(rel));
  });
}

// START-ON-TOUCH: nếu CHƯA có WO nào in_progress và `rel` khớp ĐÚNG MỘT WO todo+ready ⇒ đóng dấu 'started'.
// Fail-safe: khớp 0 hoặc >1 WO → KHÔNG làm gì (tránh nhảy nhầm). Trả WO vừa start, hoặc null.
export function autoStartOnTouch(backlog, rel, by) {
  const ov = statusOverlay();
  if (anyInProgress(backlog, ov)) return null; // đã có việc đang làm (giữ "1 WO/phiên")
  const cands = readyTodoMatches(backlog, rel, ov);
  if (cands.length !== 1) return null; // mơ hồ → bỏ qua
  const wo = cands[0];
  appendEvent({ wo: wo.id, type: "started", detail: `auto: chạm ${rel}`, by: by || undefined });
  return wo;
}
