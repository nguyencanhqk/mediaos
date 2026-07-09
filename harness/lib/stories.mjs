// harness/lib/stories.mjs — MA TRẬN TIẾN ĐỘ theo Module / Tính năng (story-level).
//
// Vì sao có file này:
//   backlog.mjs (board/STATUS) chỉ giữ ~Work Order của SPRINT HÀNH (S0–S1) — KHÔNG phải toàn bộ
//   112 story của MVP. Người đọc muốn thấy "từng module → từng tính năng → việc cần làm → trạng thái
//   → đã test chưa → cách chạy thử". File này GHÉP 3 nguồn sự thật (KHÔNG nhập tay):
//     1) docs/IMPLEMENTATION/IMPLEMENTATION-02  → 112 story / 12 epic (id·actor·priority·point·AC)
//     2) harness/backlog.mjs (src[] trỏ IMP02-STORY-XXX) → map story → Work Order + done_when + paths
//     3) harness/activity.jsonl (ledger, overlay) → trạng thái HIỆU DỤNG + bằng chứng test
//
// KHÔNG ghi gì — chỉ đọc + suy. Dùng bởi: harness/dashboard/server.mjs (GET /api/progress).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { byWorkOrder } from "../ledger.mjs";
import { applyStatus } from "./wo-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ── epic → module (ISSUE-BOARD §8.2) ───────────────────────────────────────────
const EPIC_MODULE = {
  0: "PROJECT",
  1: "FOUNDATION",
  2: "AUTH",
  3: "HR",
  4: "ATT",
  5: "LEAVE",
  6: "TASK",
  7: "NOTI",
  8: "DASH",
  9: "FRONTEND",
  10: "INTEGRATION",
  11: "QA",
};

// Sprint của 1 story theo IMPLEMENTATION-02 §9 (story trọng tâm mỗi sprint, không chỉ theo epic).
function sprintOfStory(n) {
  const inR = (a, b) => n >= a && n <= b;
  if (inR(1, 4)) return "S0";
  if (inR(5, 12) || inR(93, 96)) return "S1";
  if (inR(13, 37) || inR(98, 99)) return "S2";
  if (inR(38, 64) || n === 100) return "S3";
  if (inR(65, 92) || inR(101, 103)) return "S4";
  if (n === 97 || inR(104, 110)) return "S5";
  if (inR(111, 112)) return "S6";
  return "?";
}

// Override map: story → WO khi backlog src[] KHÔNG trỏ IMP02-STORY-XXX (dùng mã ISSUE-BOARD/FRONTEND…).
//   "__shipped:<note>" = đã ship NGOÀI backlog hành (lịch sử) → coi như done, không có WO sống.
const STORY_WO_OVERRIDE = {
  1: ["S0-GOV-1"],
  2: ["S0-GOV-1"],
  3: ["S0-GOV-1"],
  4: ["S0-QA-1"],
  11: ["__shipped:HolidayService đã ship (apps/api/src/foundation/holidays) — ngoài backlog hành"],
  // ── trace-map bổ sung 2026-07-08: story ĐÃ có WO phủ nhưng src[] dùng mã ISSUE-BOARD/FRONTEND ──
  36: ["S2-HR-EMPFILE-1", "S2-FE-HR-9"], // file hồ sơ NV (gap-closer audit FE)
  46: ["S3-ATT-BE-4", "S3-FE-ATT-3"], // gửi YC điều chỉnh công
  47: ["S3-ATT-BE-4", "S3-FE-ATT-3"], // duyệt/từ chối điều chỉnh công
  48: ["S3-ATT-BE-4", "S3-FE-ATT-3"], // điều chỉnh công trực tiếp (HR/Admin)
  49: ["S3-ATT-BE-5", "S3-FE-ATT-4"], // tạo request remote/công tác
  50: ["S3-ATT-BE-5", "S3-FE-ATT-4"], // duyệt remote/công tác
  59: ["S3-LEAVE-BE-2", "S3-INT-1"], // hủy/thu hồi đơn nghỉ đã duyệt + ATT sync
  60: ["S3-LEAVE-BE-5", "S3-FE-LEAVE-4"], // lịch nghỉ cá nhân/team/phòng ban/company
  80: ["S4-NOTI-BE-1", "S4-FE-NOTI-1"], // danh sách + chi tiết thông báo
  83: ["S4-NOTI-BE-3"], // cấu hình bật/tắt event + template
  84: ["S4-NOTI-BE-3"], // delivery log + retry
  89: ["S4-DASH-BE-1", "S4-FE-DASH-2"], // Admin Dashboard (widget admin-specific = catalog-only defer §11.3)
  92: ["S4-DASH-BE-2", "S4-INT-2"], // cache + invalidate dashboard widget
  93: ["S0-FE-CORE-1"],
  95: ["S0-FE-API-1", "S1-FE-QUERY-WIRE-1"],
  97: ["S5-QA-REG-1"], // responsive mobile web P0 (verify qua responsive smoke)
  101: ["S4-TASK-BE-3"], // TASK↔LEAVE cảnh báo giao việc khi assignee nghỉ phép
};

// Vite dev port mỗi app (apps/*/vite.config.ts) → link "chạy thử" FE.
const APP_PORT = { app: 5273, auth: 5275, console: 5278 };

// ── đọc + parse IMPLEMENTATION-02 ───────────────────────────────────────────────
function imp02Path() {
  const dir = path.join(ROOT, "docs/IMPLEMENTATION");
  try {
    const f = fs.readdirSync(dir).find((n) => /^IMPLEMENTATION-02.*\.md$/i.test(n));
    if (f) return path.join(dir, f);
  } catch {
    /* fallthrough */
  }
  return path.join(dir, "IMPLEMENTATION-02_Detailed_Product_Backlog_Epic_Breakdown.md");
}

// Map<epicNum, {id,num,name,module,stories:[{num,id,actor,title,priority,points,ac}]}>
function parseImp02() {
  let text = "";
  try {
    text = fs.readFileSync(imp02Path(), "utf8");
  } catch {
    return new Map();
  }
  const epicHdr = /^##\s+8\.\d+\s+EPIC-(\d+):\s*(.+?)\s*$/;
  const row =
    /^\|\s*IMP02-STORY-(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(P\d)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/;
  const epics = new Map();
  let cur = null;
  for (const ln of text.split(/\r?\n/)) {
    const h = epicHdr.exec(ln);
    if (h) {
      const num = parseInt(h[1], 10);
      cur = {
        id: `EPIC-${h[1]}`,
        num,
        name: h[2].trim(),
        module: EPIC_MODULE[num] || "?",
        stories: [],
      };
      epics.set(num, cur);
      continue;
    }
    if (!cur) continue;
    const m = row.exec(ln);
    if (m) {
      const num = parseInt(m[1], 10);
      cur.stories.push({
        num,
        id: `IMP02-STORY-${String(num).padStart(3, "0")}`,
        actor: m[2].trim(),
        title: m[3].trim(),
        priority: m[4],
        points: parseInt(m[5], 10) || 0,
        ac: m[6].trim(),
      });
    }
  }
  return epics;
}

// ── story → WO ──────────────────────────────────────────────────────────────────
function storiesInSrc(src) {
  const nums = new Set();
  const re = /IMP02-STORY-([\d/]+)/g;
  let m;
  while ((m = re.exec((src || []).join(" ")))) {
    m[1].split("/").forEach((x) => {
      const n = parseInt(x, 10);
      if (n) nums.add(n);
    });
  }
  return [...nums];
}

// ── bằng chứng test từ ledger ───────────────────────────────────────────────────
// Chỉ tính "đã test" khi có dấu hiệu THỰC THI/PASS (số test, ✓N, "pass", "xanh", "verified",
// "coverage") — KHÔNG bắt chữ "test" trong văn bản kế hoạch (vd "deny-path test viết-trước").
const TESTY =
  /\b\d+\s*(?:tests?|specs?)\b|✓\s?\d+|\bpass(?:ed)?\b|\bxanh\b|\bverified\b|\bcoverage\b/i;
const RUNNABLE = new Set(["done", "in_progress", "partial"]);
function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function testEvidence(woIds, activityById, status) {
  if (!RUNNABLE.has(status)) return { tested: false, summary: null, at: null };
  for (const id of woIds) {
    const g = activityById[id];
    if (!g || !g.events) continue;
    const ev = [...g.events].reverse().find((e) => TESTY.test(e.detail || ""));
    if (ev) return { tested: true, summary: truncate(ev.detail, 180), at: ev.ts };
  }
  return { tested: false, summary: null, at: null };
}

// ── cách "chạy thử" 1 story (suy từ paths + status của WO) ───────────────────────
function runHint(woIds, byId, status) {
  const realWos = woIds.filter((id) => !id.startsWith("__shipped"));
  const paths = [...new Set(realWos.flatMap((id) => byId[id]?.paths || []))];
  const touchesApi = paths.some((p) => p.startsWith("apps/api"));
  const feApps = [
    ...new Set(paths.map((p) => (p.match(/^apps\/(auth|console|app)\b/) || [])[1]).filter(Boolean)),
  ];
  const commands = [];
  const urls = [];
  const runnable = RUNNABLE.has(status);

  if (touchesApi) {
    const lane = (realWos[0] || "wo").toLowerCase().replace(/[^a-z0-9]/g, "");
    commands.push(`bash scripts/lane-db-setup.sh ${lane}   # DB cô lập (chống shared-DB drift)`);
    commands.push(`export LANE_DB=mediaos_${lane} && pnpm --filter @mediaos/api test`);
  }
  feApps.forEach((a) => {
    commands.push(`pnpm --filter @mediaos/${a} test`);
    if (APP_PORT[a])
      urls.push({
        app: a,
        url: `http://localhost:${APP_PORT[a]}`,
        dev: `pnpm --filter @mediaos/${a} dev`,
      });
  });

  let note;
  if (!realWos.length)
    note = woIds.length
      ? "Đã ship trước đó (ngoài backlog hành)."
      : "Chưa có Work Order (sprint chưa kéo vào backlog).";
  else if (!runnable) note = "WO chưa xong — chưa chạy thử end-to-end được.";
  else if (touchesApi)
    note =
      "Backend: kiểm qua test trên DB cô lập (endpoint công khai cần Foundation wire — S1-FND-WIRE-1).";
  else note = "FE: chạy dev server rồi mở URL.";

  return { commands, urls, note, runnable };
}

// ── trạng thái hiệu dụng của story = tổng hợp status WO (overlay ledger) ─────────
function aggregateStatus(woIds, statusOf) {
  if (!woIds.length) return "planned";
  if (woIds.some((id) => id.startsWith("__shipped"))) return "done";
  const st = woIds.map(statusOf);
  if (st.every((s) => s === "done")) return "done";
  if (st.some((s) => s === "in_progress")) return "in_progress";
  if (st.some((s) => s === "blocked")) return "blocked";
  if (st.some((s) => s === "done")) return "partial";
  return "todo";
}

// ── API chính ───────────────────────────────────────────────────────────────────
// backlogItems = đã applyStatus (overlay ledger). Nếu không truyền, tự import + apply.
export async function buildProgress(backlogItems) {
  let backlog = backlogItems;
  if (!backlog) {
    const mod = await import(`../backlog.mjs?u=${Date.now()}`);
    backlog = applyStatus(mod.backlog);
  }
  const byId = Object.fromEntries(backlog.map((b) => [b.id, b]));
  const statusOf = (id) => (id.startsWith("__shipped") ? "done" : byId[id]?.status || "todo");
  const activityById = Object.fromEntries(byWorkOrder().map((g) => [g.wo, g]));

  // story.num → [woId]  (auto từ src[] + override)
  const auto = {};
  for (const b of backlog) {
    for (const n of storiesInSrc(b.src)) (auto[n] ||= []).push(b.id);
  }
  const woForStory = (n) => STORY_WO_OVERRIDE[n] || auto[n] || [];

  const epicsParsed = parseImp02();
  const usedWoIds = new Set();
  const epics = [];

  for (const [, ep] of [...epicsParsed.entries()].sort((a, b) => a[0] - b[0])) {
    const stories = ep.stories.map((s) => {
      const wos = woForStory(s.num);
      wos.filter((w) => !w.startsWith("__shipped")).forEach((w) => usedWoIds.add(w));
      const status = aggregateStatus(wos, statusOf);
      const doneWhen = [...new Set(wos.flatMap((id) => byId[id]?.done_when || []))];
      return {
        ...s,
        epicId: ep.id,
        module: ep.module,
        sprint: sprintOfStory(s.num),
        wos,
        status,
        doneWhen,
        tested: testEvidence(wos, activityById, status),
        run: runHint(wos, byId, status),
      };
    });

    const count = (f) => stories.filter(f).length;
    const sum = (f) => stories.reduce((a, s) => a + (f(s) ? s.points : 0), 0);
    const doneish = (s) => s.status === "done";
    epics.push({
      id: ep.id,
      num: ep.num,
      module: ep.module,
      name: ep.name,
      sprint: ep.stories.length ? sprintOfStory(ep.stories[0].num) : "?",
      priority: stories.reduce((p, s) => (s.priority < p ? s.priority : p), "P3"),
      stats: {
        total: stories.length,
        done: count(doneish),
        inProgress: count((s) => s.status === "in_progress" || s.status === "partial"),
        blocked: count((s) => s.status === "blocked"),
        todo: count((s) => s.status === "todo"),
        planned: count((s) => s.status === "planned"),
        points: stories.reduce((a, s) => a + s.points, 0),
        donePoints: sum(doneish),
        pct: stories.length ? Math.round((count(doneish) / stories.length) * 100) : 0,
      },
      stories,
    });
  }

  // WO trong backlog KHÔNG map tới story nào = WO nền/hạ tầng (DB·CI·env·wire·QA-debt…).
  const infraWOs = backlog
    .filter((b) => !usedWoIds.has(b.id))
    .map((b) => ({
      id: b.id,
      title: b.title,
      zone: b.zone,
      status: b.status,
      module: b.module || null,
      layer: b.layer || null,
    }));

  const allStories = epics.flatMap((e) => e.stories);
  const totals = {
    stories: allStories.length,
    done: allStories.filter((s) => s.status === "done").length,
    inProgress: allStories.filter((s) => s.status === "in_progress" || s.status === "partial")
      .length,
    blocked: allStories.filter((s) => s.status === "blocked").length,
    todo: allStories.filter((s) => s.status === "todo").length,
    planned: allStories.filter((s) => s.status === "planned").length,
    points: allStories.reduce((a, s) => a + s.points, 0),
    donePoints: allStories.filter((s) => s.status === "done").reduce((a, s) => a + s.points, 0),
  };
  totals.pct = totals.stories ? Math.round((totals.done / totals.stories) * 100) : 0;

  // tiến độ theo sprint (S0..S6)
  const sprints = {};
  for (const s of allStories) {
    const k = s.sprint;
    sprints[k] ||= { total: 0, done: 0, points: 0, donePoints: 0 };
    sprints[k].total++;
    sprints[k].points += s.points;
    if (s.status === "done") {
      sprints[k].done++;
      sprints[k].donePoints += s.points;
    }
  }

  return { generatedAt: new Date().toISOString(), totals, sprints, epics, infraWOs };
}
