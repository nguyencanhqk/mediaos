/**
 * ops-alert-notify.mjs — S10-OPS-ALERTCHAN-1 · nửa (b) của sự cố 11–12/08: **BÁO ĐỘNG**.
 *
 * `S10-OPS-SITEWATCH-1` đóng nửa (a) = PHÁT HIỆN (dò fbpost :3500 · LMS :3400). Nhưng phát hiện xong
 * mà không ai được báo thì kết cục vẫn y hệt: `ops-alert-check` ra `crit` exit 2 đúng lúc, ghi vào
 * `logs/ops-alerts.log` — **một file không ai mở** — và app vẫn chết 15 tiếng. File này là đường ra.
 *
 * ═══ MỘT CẢNH BÁO KHÔNG NÓI ĐƯỢC CHUYỆN GÌ ĐANG HỎNG THÌ KHÔNG PHẢI CẢNH BÁO ═══
 * Bản trước gửi `{ text: '[MediaOS ops] CRIT', ...payload }`. Slack và Google Chat **chỉ render
 * `text`** ⇒ người bị ping lúc 3h sáng thấy đúng chữ "CRIT", không biết rule nào nổ, phải mở máy PROD
 * ra mới biết; phần spread `payload` là rác thuần vì chat không hiện. Nên `formatAlertText` dựng thân
 * tin liệt kê TỪNG hàng không-ok kèm chi tiết + mốc thời gian + máy đang đo.
 *
 * Hàng `ok` **KHÔNG** vào tin nhắn. Rác hoá tin báo động là cách nhanh nhất để người ta ngừng đọc nó,
 * và một cảnh báo không ai đọc thì tệ hơn không có cảnh báo (cùng lý do với luật chống báo-sai ở
 * `ops-alert-check.mjs` — xem `loadDotEnv`).
 *
 * ═══ SAI KHOÁ = TIN BAY MẤT ═══
 * Hình dạng thân khác nhau theo kênh, và gửi sai khoá KHÔNG báo lỗi ở phía ta:
 *   Slack · Google Chat · kênh lạ → `{ text }`
 *   Discord                       → `{ content }`  (gửi `text` ⇒ Discord trả 400, tin bay mất)
 *   Telegram (.../sendMessage)    → `{ chat_id, text }`
 * Trần độ dài: Discord 2000 · Slack ~3000 · Telegram 4096. Gửi vượt trần = **MẤT TRẮNG** cả tin, nên
 * `MAX_ALERT_TEXT` lấy mức an toàn nhất cho MỌI kênh và cắt có-thông-báo (xem `formatAlertText`).
 *
 * ═══ URL WEBHOOK LÀ SECRET (BẤT BIẾN #3) ═══
 * Token nằm trong ĐƯỜNG DẪN (`hooks.slack.com/services/T/B/xxx`, `api.telegram.org/bot<token>/…`).
 * Mọi thứ in ra đi qua `redactWebhook` — chỉ còn host, đủ để chẩn đoán mà không rò khoá vào log/CI.
 */

import fs from "node:fs";
import path from "node:path";

/** Các kênh biết hình dạng thân. Kênh lạ rơi về `generic` (`{text}`) chứ KHÔNG ném. */
export const WEBHOOK_FORMATS = ["slack", "google-chat", "discord", "telegram", "generic"];

/**
 * Trần độ dài thân tin — MỘT con số cho mọi kênh, lấy dưới trần THẤP NHẤT (Discord 2000).
 *
 * Chỉnh riêng theo kênh sẽ đổi lấy vài trăm ký tự bằng một lớp cấu hình nữa có thể sai — trong khi
 * thứ ta muốn đọc lúc 3h sáng là 5 dòng đầu, không phải dòng thứ 40.
 */
export const MAX_ALERT_TEXT = 1900;

const SEVERITY_ICON = { ok: "✓", unknown: "?", warn: "!", crit: "✗" };

/** Che token trong URL webhook — chỉ giữ host. Dùng cho MỌI đường in ra (stderr, sổ, stdout). */
export function redactWebhook(url) {
  try {
    return `${new URL(String(url)).host}/…`;
  } catch {
    return "<url không đọc được>";
  }
}

/**
 * Thân tin nhắn báo động — phải trả lời được "ĐANG HỎNG CÁI GÌ" mà không cần mở máy PROD.
 *
 * @param {{at?:string,baseUrl?:string,windowMin?:number,worst?:string,
 *          rows?:Array<{id?:string,title?:string,severity?:string,detail?:string}>}} payload
 * @param {{maxLength?:number}} [opts]
 * @returns {string} luôn KHÁC RỖNG — kể cả khi mọi hàng đều `ok` (ca `--test-alert`).
 */
export function formatAlertText(payload, { maxLength = MAX_ALERT_TEXT } = {}) {
  const worst = String(payload?.worst ?? "unknown").toUpperCase();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const bad = rows.filter((r) => r?.severity !== "ok");

  // Tin nhắc lại / tin hồi phục PHẢI tự nói mình là gì ở dòng đầu — người đọc lúc 3h sáng cần biết
  // ngay đây là sự cố MỚI, sự cố CŨ chưa hết, hay đã hết (xem `decideAlertDelivery`).
  const kind = payload?.deliveryKind;
  const firstLine =
    kind === "recovered"
      ? `[MediaOS ops] ĐÃ HỒI PHỤC — mọi luật ok (lần báo trước: ${String(payload?.previousWorst ?? "?").toUpperCase()})`
      : kind === "resync"
        ? "[MediaOS ops] OK — mọi luật ok (sổ gửi trước đó không đọc được; tin hỏng cũ trong kênh, nếu có, đã hết)"
        : `[MediaOS ops] ${worst}${kind === "remind" ? " (NHẮC LẠI — chưa hết)" : ""} — ${bad.length}/${rows.length} nhóm bất thường`;

  const head = [
    firstLine,
    `${payload?.at ?? "?"} · ${payload?.baseUrl ?? "?"} · cửa sổ ${payload?.windowMin ?? "?"} phút`,
    "",
  ].join("\n");

  const body =
    bad.length === 0
      ? ["Không có nhóm nào bất thường — mọi luật đều ok."]
      : bad.map((r) => {
          const sev = String(r?.severity ?? "unknown");
          const icon = SEVERITY_ICON[sev] ?? "?";
          return `${icon} ${sev.padEnd(7)} ${r?.title ?? r?.id ?? "?"} — ${r?.detail ?? "?"}`;
        });

  // Cắt có-thông-báo. Trước khi nhận dòng thứ i, phải chắc rằng NẾU sau đó cần ghi chú cắt thì tin
  // vẫn vừa trần — nếu không, tin bị kênh từ chối nguyên khối và ta MẤT TRẮNG cả cảnh báo.
  const note = (n) => `… còn ${n} dòng nữa — xem đầy đủ ở logs/ops-alerts.log`;
  let out = head;
  let kept = 0;
  for (let i = 0; i < body.length; i += 1) {
    const remaining = body.length - i;
    const reserve = remaining > 1 ? 1 + note(remaining - 1).length : 0;
    const candidate = `${out}\n${body[i]}`;
    if (candidate.length + reserve <= maxLength) {
      out = candidate;
      kept += 1;
      continue;
    }
    // Không vừa. Nếu CHƯA giữ được dòng nào thì cắt CHÍNH dòng này thay vì bỏ trắng: một tin chỉ có
    // "… còn 1 dòng nữa" vô dụng đúng bằng bản `[MediaOS ops] CRIT` mà WO này sinh ra để vá. Tiêu đề
    // nhóm nằm ở ĐẦU dòng nên nó luôn sống sót qua nhát cắt — đó là thứ đọc lúc 3h sáng.
    if (kept === 0) {
      const room = maxLength - out.length - 2 - reserve; // 2 = "\n" ở đầu + "…" ở cuối
      if (room > 0) {
        out = `${out}\n${body[i].slice(0, room)}…`;
        return remaining > 1 ? `${out}\n${note(remaining - 1)}` : out;
      }
    }
    return `${out}\n${note(remaining)}`;
  }
  return out.length <= maxLength ? out : `${out.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * Suy kênh từ host của URL. Khai tường minh THẮNG suy đoán.
 *
 * Fail-soft có chủ đích: URL rác hoặc host lạ ⇒ `generic`, KHÔNG ném. Cấu hình sai không được làm
 * sập cả lệnh kiểm tra vận hành — mất cảnh báo vì gõ nhầm URL còn tệ hơn gửi sai hình dạng thân.
 * Giá trị `format` khai tường minh nhưng KHÔNG hợp lệ cũng rơi về suy đoán theo host (người gọi có
 * trách nhiệm kiểm bằng `WEBHOOK_FORMATS` và kêu to — xem `ops-alert-check.mjs`).
 */
export function detectWebhookFormat(url, explicit) {
  const declared = String(explicit ?? "")
    .trim()
    .toLowerCase();
  if (WEBHOOK_FORMATS.includes(declared)) return declared;

  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  const at = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (at("slack.com")) return "slack";
  if (at("chat.googleapis.com")) return "google-chat";
  if (at("discord.com") || at("discordapp.com")) return "discord";
  if (at("telegram.org")) return "telegram";
  return "generic";
}

/**
 * Dựng request POST cho kênh tương ứng. KHÔNG chế biến URL — gửi đúng cái người vận hành đã đặt.
 *
 * Thân chỉ mang ĐÚNG khoá kênh đó đọc: bản cũ spread nguyên `payload` vào thân, nhưng chat chỉ hiện
 * `text` nên phần dư vừa vô dụng vừa đẩy thân tới sát trần.
 *
 * @throws khi Telegram thiếu `chat_id` — ném lúc DỰNG còn hơn gửi một request chắc chắn hỏng rồi
 *         đứng đoán vì sao cảnh báo không tới.
 */
export function buildWebhookRequest({ payload, url, format, telegramChatId, maxLength } = {}) {
  const resolved = detectWebhookFormat(url, format);
  const text = formatAlertText(payload, { maxLength: maxLength ?? MAX_ALERT_TEXT });

  let body;
  if (resolved === "discord") {
    body = { content: text };
  } else if (resolved === "telegram") {
    const chatId = String(telegramChatId ?? "").trim();
    if (chatId === "") {
      throw new Error(
        "Telegram cần chat_id — đặt OPS_ALERT_TELEGRAM_CHAT_ID; thiếu nó thì tin KHÔNG có nơi để tới.",
      );
    }
    body = { chat_id: chatId, text };
  } else {
    body = { text };
  }

  return {
    url,
    format: resolved,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  };
}

/**
 * Giao tin — và KÊU TO khi hỏng.
 *
 * Bản cũ là `catch {}` trần, không kiểm `res.ok`, không timeout: URL sai hoặc hết hạn ⇒ cảnh báo im
 * lặng đi vào hư vô. Đó ĐÚNG lớp lỗi mà `S10-OPS-SITEWATCH-1` vừa vá ở tầng phát hiện, chỉ là lần
 * này nằm ở tầng báo động. Nên ở đây: có timeout · kiểm `res.ok` · mọi chế độ hỏng đều trả về một
 * phán quyết mô tả được, KHÔNG bao giờ nuốt.
 *
 * KHÔNG ném ra ngoài (kể cả khi `buildWebhookRequest` ném): kênh báo động hỏng không được làm sập
 * lệnh kiểm tra vận hành — nhưng người gọi PHẢI in `error` ra stderr và ghi sổ.
 *
 * @returns {Promise<{ok:boolean,status:number|null,error:string|null,format:string|null,target:string}>}
 */
export async function sendAlert({
  payload,
  url,
  format,
  telegramChatId,
  timeoutMs = 8000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const target = redactWebhook(url);
  let req;
  try {
    req = buildWebhookRequest({ payload, url, format, telegramChatId });
  } catch (err) {
    return { ok: false, status: null, error: String(err?.message ?? err), format: null, target };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Thân lỗi là thứ NÓI ĐƯỢC vì sao (Discord 400 "Cannot send an empty message", Slack
      // "invalid_token"…). Cắt ngắn để không đổ nguyên trang HTML vào sổ cảnh báo.
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
        format: req.format,
        target,
      };
    }
    return { ok: true, status: res.status, error: null, format: req.format, target };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error:
        err?.name === "AbortError"
          ? `timeout sau ${timeoutMs}ms`
          : String(err?.cause?.code ?? err?.code ?? err?.message ?? err),
      format: req.format,
      target,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ═══ CHỐNG SPAM WEBHOOK mà KHÔNG nuốt cảnh báo thật (S19-OPS-PRODDBBOOT-1) ═══════════════════════
// Tác vụ `MediaOS-OpsAlert` chạy mỗi 10 phút. Bản trước gửi webhook MỖI lần worst ≠ ok ⇒ một luật
// warn kéo dài = 144 tin/ngày ⇒ người nhận tắt tiếng kênh ⇒ sự cố THẬT kế tiếp đi vào hư vô. Nhưng
// chiều hỏng ngược lại — nuốt một cảnh báo thật — còn tệ hơn, nên MỌI chỗ nghi ngờ nghiêng về GỬI:
//   · trạng thái đọc lỗi / mốc gửi lạ (tương lai) ⇒ gửi;  · gửi hỏng ⇒ KHÔNG ghi trạng thái (lần
//     sau gửi lại);  · tập (luật, độ nặng) không-ok đổi ⇒ gửi, kể cả khi worst giữ nguyên.
// Chỉ ghi trạng thái sau một lần GỬI THÀNH CÔNG — file là "lần cuối ta THẬT SỰ báo được cái gì".

/** Hạn nhắc lại mặc định (giờ) khi vẫn còn hỏng y nguyên. Ghi đè: `OPS_ALERT_REMIND_HOURS`. */
export const DEFAULT_REMIND_HOURS = 6;

/**
 * Phải ok LIÊN TỤC bao nhiêu phút mới gửi tin hồi phục. Không có hạn này thì một luật chập chờn
 * (warn · ok · warn …) bắn cặp tin cảnh báo/hồi phục MỖI lượt 10 phút — đúng thứ spam đang chống.
 * Chỉ HOÃN tin hồi phục; KHÔNG bao giờ hoãn một cảnh báo.
 */
export const DEFAULT_RECOVERY_HOLD_MINUTES = 20;

const STATE_SEVERITIES = new Set(["ok", "unknown", "warn", "crit"]);

/**
 * Đọc `OPS_ALERT_REMIND_HOURS`. Rác (chữ, ≤ 0, vô hạn) ⇒ mặc định + `invalid:true` để người gọi KÊU
 * stderr — im lặng dùng mặc định sẽ giấu một cấu hình người vận hành tưởng là đã có hiệu lực.
 */
export function parseRemindHours(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { hours: DEFAULT_REMIND_HOURS, invalid: false };
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return { hours: DEFAULT_REMIND_HOURS, invalid: true };
  return { hours: n, invalid: false };
}

/** Tập (id, severity) KHÔNG-ok, sắp theo id — so được bằng chuỗi, bỏ qua `detail` (số đếm đổi liên tục). */
function nonOkAlerts(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.severity !== "ok")
    .map((r) => ({ id: String(r?.id ?? "?"), severity: String(r?.severity ?? "unknown") }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const fingerprint = (alerts) => alerts.map((a) => `${a.id}:${a.severity}`).join("|");

/** Trạng thái ghi sau một lần gửi THÀNH CÔNG. */
export function nextAlertState({ worst, rows }, now = Date.now()) {
  return {
    version: 1,
    worst: String(worst),
    alerts: nonOkAlerts(rows),
    sentAt: new Date(now).toISOString(),
  };
}

/**
 * Quyết định có gửi webhook lần này không.
 *
 * `stateUpdate` = việc ghi sổ KHÔNG kèm gửi: "mark-ok" (bắt đầu đếm chuỗi ok — mốc `okSince`) ·
 * "clear-ok" (hỏng lại giữa chừng ⇒ chuỗi ok đứt, lần về ok sau phải chờ lại từ đầu) · null.
 *
 * @param {{worst:string, rows:Array, state:object|null, stateError:string|null, now:number,
 *          remindHours:number, recoveryHoldMin?:number}} input
 * @returns {{send:boolean, kind:"alert"|"change"|"remind"|"recovered"|"resync"|null, reason:string,
 *            stateUpdate:"mark-ok"|"clear-ok"|null}}
 */
export function decideAlertDelivery({
  worst,
  rows,
  state,
  stateError,
  now,
  remindHours,
  recoveryHoldMin = DEFAULT_RECOVERY_HOLD_MINUTES,
}) {
  if (worst === "ok") return decideWhenOk({ state, stateError, now, recoveryHoldMin });
  const d = decideWhenNotOk({ worst, rows, state, stateError, now, remindHours });
  if (!d.send && state?.okSince) return { ...d, stateUpdate: "clear-ok" };
  return { ...d, stateUpdate: null };
}

function decideWhenOk({ state, stateError, now, recoveryHoldMin }) {
  if (stateError) {
    // Sổ hỏng thì không biết kênh đang treo tin gì: báo "ok" MỘT lần — ghi được sổ sau đó là hết lặp.
    return {
      send: true,
      kind: "resync",
      reason: `ok; sổ gửi không đọc được (${stateError}) — báo ok một lần và ghi lại sổ`,
      stateUpdate: null,
    };
  }
  if (!state || state.worst === "ok") {
    return { send: false, kind: null, reason: "ok; không nợ tin hồi phục", stateUpdate: null };
  }
  if (!state.okSince) {
    return {
      send: false,
      kind: null,
      reason: `về ok — chờ ok liên tục ${recoveryHoldMin} phút rồi mới báo hồi phục (chống chập chờn)`,
      stateUpdate: "mark-ok",
    };
  }
  const okMs = now - Date.parse(state.okSince);
  if (okMs >= 0 && okMs < recoveryHoldMin * 60_000) {
    return {
      send: false,
      kind: null,
      reason: `ok được ~${Math.round(okMs / 60_000)} phút — chờ đủ ${recoveryHoldMin} phút mới báo hồi phục`,
      stateUpdate: null,
    };
  }
  return {
    send: true,
    kind: "recovered",
    reason:
      okMs < 0
        ? "mốc ok nằm ở tương lai — gửi hồi phục cho chắc"
        : `ok liên tục ≥ ${recoveryHoldMin} phút sau tin ${state.worst} đã gửi`,
    stateUpdate: null,
  };
}

function decideWhenNotOk({ worst, rows, state, stateError, now, remindHours }) {
  if (stateError) {
    return {
      send: true,
      kind: "alert",
      reason: `không đọc được trạng thái gửi (${stateError}) — gửi để KHÔNG nuốt cảnh báo`,
    };
  }
  if (!state) return { send: true, kind: "alert", reason: "chưa từng gửi" };
  if (state.worst === "ok")
    return { send: true, kind: "alert", reason: "hỏng lại sau tin hồi phục" };
  if (state.worst !== worst) {
    return { send: true, kind: "change", reason: `worst đổi ${state.worst} → ${worst}` };
  }
  if (fingerprint(nonOkAlerts(rows)) !== fingerprint(state.alerts)) {
    return { send: true, kind: "change", reason: "tập luật không-ok/độ nặng đổi" };
  }
  const ageMs = now - Date.parse(state.sentAt);
  const remindMs = remindHours * 3_600_000;
  if (!(ageMs >= 0 && ageMs < remindMs)) {
    return {
      send: true,
      kind: "remind",
      reason:
        ageMs < 0 ? "mốc gửi nằm ở tương lai — gửi cho chắc" : `còn hỏng sau ≥ ${remindHours} giờ`,
    };
  }
  const leftH = Math.round(((remindMs - ageMs) / 3_600_000) * 10) / 10;
  return {
    send: false,
    kind: null,
    reason: `trùng tin đã gửi lúc ${state.sentAt} — nhắc lại sau ~${leftH} giờ nếu còn hỏng`,
  };
}

function validateState(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return "không phải object";
  if (!STATE_SEVERITIES.has(obj.worst)) return `worst lạ: ${JSON.stringify(obj.worst)}`;
  if (!Array.isArray(obj.alerts)) return "thiếu mảng alerts";
  for (const a of obj.alerts) {
    if (typeof a?.id !== "string" || !STATE_SEVERITIES.has(a?.severity))
      return "alerts có phần tử hỏng";
  }
  if (typeof obj.sentAt !== "string" || Number.isNaN(Date.parse(obj.sentAt))) return "sentAt hỏng";
  if (
    obj.okSince !== undefined &&
    (typeof obj.okSince !== "string" || Number.isNaN(Date.parse(obj.okSince)))
  ) {
    return "okSince hỏng";
  }
  return null;
}

/**
 * Đọc file trạng thái. Chưa có file ⇒ `{state:null, error:null}` (lần đầu — bình thường).
 * Mọi lỗi khác (quyền, JSON rác, sai hình dạng) ⇒ `error` để người gọi KÊU và VẪN GỬI. Không ném.
 */
export function readAlertState(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { state: null, error: null };
    return {
      state: null,
      error: `đọc ${path.basename(file)}: ${err?.code ?? err?.message ?? err}`,
    };
  }
  try {
    const obj = JSON.parse(raw);
    const problem = validateState(obj);
    if (problem) return { state: null, error: `${path.basename(file)}: ${problem}` };
    return { state: obj, error: null };
  } catch (err) {
    return { state: null, error: `${path.basename(file)}: JSON hỏng (${err?.message ?? err})` };
  }
}

/**
 * Sổ mới cho việc ghi KHÔNG kèm gửi (`decision.stateUpdate`). Trả bản SAO, không sửa `state`.
 * Không có gì để ghi ⇒ null.
 */
export function applyStateUpdate(state, update, now = Date.now()) {
  if (!state || !update) return null;
  if (update === "mark-ok") return { ...state, okSince: new Date(now).toISOString() };
  if (update === "clear-ok") {
    const next = { ...state };
    delete next.okSince;
    return next;
  }
  return null;
}

/** Windows: AV/tiến trình khác đang mở file đích ⇒ rename đè ném các mã này — thường chỉ thoáng qua. */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = Object.freeze([50, 200]);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* dọn file tạm hỏng thì thôi — lỗi chính được trả về ở người gọi */
  }
}

/**
 * Ghi NGUYÊN TỬ: file tạm cùng thư mục rồi `rename` đè lên — tiến trình chết giữa chừng không để lại
 * một file trạng thái cụt. Rename bị khoá tạm (Windows) ⇒ thử lại 2 lần; vẫn khoá ⇒ ghi THẲNG vào
 * file đích (không nguyên tử, nhưng sổ cụt chỉ làm lần sau gửi thêm — vẫn hơn giữ sổ CŨ rồi gửi
 * trùng/lỡ tin hồi phục). Không ném.
 */
export function writeAlertState(
  file,
  state,
  { renameImpl = fs.renameSync, retryDelaysMs = RENAME_RETRY_DELAYS_MS } = {},
) {
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(state, null, 2)}
`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, body, "utf8");
  } catch (err) {
    removeQuietly(tmp);
    return { ok: false, error: String(err?.code ?? err?.message ?? err) };
  }
  let lastErr = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      renameImpl(tmp, file);
      return { ok: true, error: null };
    } catch (err) {
      lastErr = err;
      if (!RENAME_RETRY_CODES.has(err?.code)) break;
      if (attempt < retryDelaysMs.length) sleepSync(retryDelaysMs[attempt]);
    }
  }
  if (RENAME_RETRY_CODES.has(lastErr?.code)) {
    try {
      fs.writeFileSync(file, body, "utf8");
      removeQuietly(tmp);
      return { ok: true, error: null, via: "direct-write" };
    } catch (err) {
      lastErr = err;
    }
  }
  removeQuietly(tmp);
  return { ok: false, error: String(lastErr?.code ?? lastErr?.message ?? lastErr) };
}
