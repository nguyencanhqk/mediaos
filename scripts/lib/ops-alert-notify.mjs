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

  const head = [
    `[MediaOS ops] ${worst} — ${bad.length}/${rows.length} nhóm bất thường`,
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
