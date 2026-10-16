// scripts/lib/ops-alert-notify.test.mjs — S10-OPS-ALERTCHAN-1.
//
// Đã đăng ký ở CẢ BA cổng (`harness/check.sh` step `tooling-tests` + `.github/workflows/{ci,api}.yml`)
// — cả ba nơi liệt kê tên file TƯỜNG MINH, nên thiếu tên ở bất kỳ nơi nào là test thành mồ côi.
//
// Trọng tâm: **một cảnh báo không nói được chuyện gì đang hỏng thì không phải cảnh báo**. Bản trước
// gửi đúng một dòng `[MediaOS ops] CRIT` — người bị ping lúc 3h sáng không biết rule nào nổ, phải
// mở máy PROD ra mới biết. Nhóm test dưới ghim: thân tin nhắn PHẢI liệt kê các hàng không-ok.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_RECOVERY_HOLD_MINUTES,
  DEFAULT_REMIND_HOURS,
  applyStateUpdate,
  buildWebhookRequest,
  decideAlertDelivery,
  detectWebhookFormat,
  formatAlertText,
  nextAlertState,
  parseRemindHours,
  readAlertState,
  redactWebhook,
  sendAlert,
  writeAlertState,
} from "./ops-alert-notify.mjs";

const PAYLOAD = {
  at: "2026-08-12T03:00:00.000Z",
  baseUrl: "http://localhost:3100/api/v1",
  windowMin: 60,
  worst: "crit",
  rows: [
    { id: "BACKEND_DOWN", title: "Backend down", severity: "ok", detail: "/health 200 status=ok" },
    {
      id: "SITE_SOCIAL",
      title: "fbpost đăng bài (:3500)",
      severity: "crit",
      detail: "HTTP 500 — http://localhost:3500/login — trang chết",
    },
    {
      id: "MIGRATION_DRIFT",
      title: "Lệch migration",
      severity: "warn",
      detail: "1 migration chưa áp",
    },
  ],
};

describe("formatAlertText — phải nói ĐANG HỎNG CÁI GÌ", () => {
  it("liệt kê từng hàng không-ok kèm chi tiết, không chỉ mức tổng thể", () => {
    const text = formatAlertText(PAYLOAD);
    assert.match(text, /CRIT/);
    assert.match(text, /fbpost đăng bài \(:3500\)/, "phải nêu TÊN nhóm đang hỏng");
    assert.match(text, /HTTP 500/, "phải nêu CHI TIẾT — thiếu nó thì phải mở máy PROD mới biết");
    assert.match(text, /Lệch migration/, "warn cũng phải có mặt, không chỉ crit");
  });

  it("KHÔNG rác hoá tin nhắn bằng các hàng ok", () => {
    assert.doesNotMatch(formatAlertText(PAYLOAD), /Backend down/);
  });

  it("có mốc thời gian + máy đang đo để lần ra ngữ cảnh", () => {
    const text = formatAlertText(PAYLOAD);
    assert.match(text, /2026-08-12T03:00:00/);
    assert.match(text, /localhost:3100/);
  });

  it("mọi hàng đều ok (ca --test-alert) ⇒ nói rõ là không có vấn đề, không trả chuỗi rỗng", () => {
    const text = formatAlertText({ ...PAYLOAD, worst: "ok", rows: [PAYLOAD.rows[0]] });
    assert.ok(text.trim().length > 0);
    assert.match(text, /OK/);
  });

  it("cắt bớt khi quá dài — Telegram trần 4096, Discord 2000 ⇒ gửi nguyên = MẤT TRẮNG tin", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `R${i}`,
      title: `Nhóm số ${i} với tiêu đề dài để đẩy tin nhắn vượt trần của Telegram và Discord`,
      severity: "crit",
      detail: "chi tiết dài dòng để tăng độ dài thân tin nhắn lên trên ngưỡng an toàn",
    }));
    const text = formatAlertText({ ...PAYLOAD, rows: many });
    assert.ok(text.length <= 1900, `phải cắt, đang ${text.length}`);
    assert.match(text, /còn \d+ dòng/, "phải NÓI là đã cắt, không im lặng bỏ bớt");
  });

  it("MỘT hàng dài hơn cả trần ⇒ cắt CHÍNH hàng đó, KHÔNG bỏ trắng thân tin", () => {
    // Bỏ trắng ở đây là tái tạo đúng lỗi WO này đi vá: tin gửi đi nhưng không nói được gì.
    const text = formatAlertText({
      ...PAYLOAD,
      worst: "crit",
      rows: [{ id: "R", title: "Trang chết", severity: "crit", detail: "X".repeat(4000) }],
    });
    assert.ok(text.length <= 1900, `phải cắt, đang ${text.length}`);
    assert.match(text, /Trang chết/, "TÊN nhóm đang hỏng phải sống sót qua nhát cắt");
    assert.match(text, /XXXXXXXXXX/, "phải giữ được phần ĐẦU của chi tiết, không cắt cụt tới rỗng");
  });
});

describe("detectWebhookFormat", () => {
  it("suy từ host: Slack · Google Chat · Discord · Telegram", () => {
    assert.equal(detectWebhookFormat("https://hooks.slack.com/services/T/B/x"), "slack");
    assert.equal(
      detectWebhookFormat("https://chat.googleapis.com/v1/spaces/X/messages"),
      "google-chat",
    );
    assert.equal(detectWebhookFormat("https://discord.com/api/webhooks/1/x"), "discord");
    assert.equal(
      detectWebhookFormat("https://api.telegram.org/bot123:abc/sendMessage"),
      "telegram",
    );
  });

  it("host lạ ⇒ generic (gửi `text`), KHÔNG ném", () => {
    assert.equal(detectWebhookFormat("https://vi-du.noi-bo/hook"), "generic");
  });

  it("URL rác ⇒ generic, KHÔNG ném — cấu hình sai không được làm sập cả lệnh kiểm tra", () => {
    assert.equal(detectWebhookFormat("khong-phai-url"), "generic");
  });

  it("khai tường minh THẮNG suy đoán", () => {
    assert.equal(detectWebhookFormat("https://hooks.slack.com/x", "discord"), "discord");
  });
});

describe("buildWebhookRequest — đúng hình dạng thân theo từng kênh", () => {
  const req = (opts) => buildWebhookRequest({ payload: PAYLOAD, ...opts });

  it("Slack + Google Chat + generic dùng `text`", () => {
    for (const format of ["slack", "google-chat", "generic"]) {
      const r = req({ url: "https://x/y", format });
      assert.ok(r.body.text.includes("fbpost"), `${format} phải mang nội dung thật`);
    }
  });

  it("Discord dùng `content`, KHÔNG phải `text` — sai khoá là Discord trả 400 và tin bay mất", () => {
    const r = req({ url: "https://discord.com/api/webhooks/1/x" });
    assert.ok(r.body.content.includes("fbpost"));
    assert.equal(r.body.text, undefined);
  });

  it("Telegram cần chat_id trong THÂN", () => {
    const r = req({
      url: "https://api.telegram.org/bot123:abc/sendMessage",
      telegramChatId: "-1001",
    });
    assert.equal(r.body.chat_id, "-1001");
    assert.ok(r.body.text.includes("fbpost"));
  });

  it("Telegram THIẾU chat_id ⇒ ném ngay khi dựng, KHÔNG gửi một request chắc chắn hỏng", () => {
    assert.throws(
      () => req({ url: "https://api.telegram.org/bot123:abc/sendMessage" }),
      /chat_id/i,
    );
  });

  it("URL giữ nguyên — không tự chế biến đường đi", () => {
    assert.equal(
      req({ url: "https://hooks.slack.com/services/T/B/x" }).url,
      "https://hooks.slack.com/services/T/B/x",
    );
  });

  it("KHÔNG nhồi nguyên payload vào thân — bản cũ spread cả object, chat chỉ hiện `text` nên phần dư là rác thuần", () => {
    const r = req({ url: "https://x/y", format: "slack" });
    assert.deepEqual(Object.keys(r.body), ["text"]);
  });
});

// ── Giao tin: bản cũ là `catch {}` trần, không kiểm res.ok, không timeout ⇒ cảnh báo im lặng đi vào
// hư vô. Nhóm dưới ghim chiều NGƯỢC LẠI: mọi chế độ hỏng phải trả về phán quyết mô tả được.
describe("sendAlert — hỏng thì phải KÊU, cấm nuốt", () => {
  const okRes = { ok: true, status: 204, text: async () => "" };
  const send = (fetchImpl, opts) =>
    sendAlert({
      payload: PAYLOAD,
      url: "https://hooks.slack.com/services/T/B/x",
      fetchImpl,
      ...opts,
    });

  it("giao được ⇒ ok:true + kênh đã suy ra", async () => {
    const r = await send(async () => okRes);
    assert.equal(r.ok, true);
    assert.equal(r.status, 204);
    assert.equal(r.format, "slack");
    assert.equal(r.error, null);
  });

  it("gửi ĐÚNG thân đã dựng, không phải nguyên payload", async () => {
    let seen;
    await send(async (_url, init) => {
      seen = JSON.parse(init.body);
      return okRes;
    });
    assert.deepEqual(Object.keys(seen), ["text"]);
    assert.ok(seen.text.includes("fbpost"));
  });

  it("res.ok=false ⇒ ok:false kèm mã + thân lỗi — KHÔNG được coi là đã giao", async () => {
    const r = await send(async () => ({
      ok: false,
      status: 403,
      text: async () => "invalid_token",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.match(r.error, /403/);
    assert.match(r.error, /invalid_token/);
  });

  it("DNS hỏng / mạng đứt ⇒ ok:false, KHÔNG ném ra ngoài (kênh hỏng không được làm sập lệnh kiểm tra)", async () => {
    const r = await send(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /ENOTFOUND/);
  });

  it("webhook TREO ⇒ bị timeout cắt, không treo luôn scheduled task", async () => {
    const r = await send(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
      { timeoutMs: 30 },
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout/i);
  });

  it("Telegram thiếu chat_id ⇒ trả lỗi mô tả được, KHÔNG ném và KHÔNG gọi fetch", async () => {
    let called = 0;
    const r = await sendAlert({
      payload: PAYLOAD,
      url: "https://api.telegram.org/bot123:abc/sendMessage",
      fetchImpl: async () => {
        called += 1;
        return okRes;
      },
    });
    assert.equal(r.ok, false);
    assert.equal(called, 0, "cấm gửi một request chắc chắn hỏng");
    assert.match(r.error, /chat_id/i);
  });

  it("mọi phán quyết chỉ mang URL ĐÃ CHE — token webhook là secret (BẤT BIẾN #3)", async () => {
    // Phần "token" GHÉP CHUỖI, không viết literal: literal high-entropy cạnh chữ `secret` trip rule
    // gitleaks `generic-api-key` ⇒ đỏ oan CI/PR dù đây rõ ràng không phải secret thật (luật nhà,
    // CLAUDE.md §5). Leak nằm lại trong history nhánh nên vá sau bằng commit mới KHÔNG gỡ được.
    const fakeToken = ["bot123", "khong-phai", "that"].join("-");
    const url = `https://api.telegram.org/${fakeToken}/sendMessage`;
    const r = await sendAlert({ payload: PAYLOAD, url, fetchImpl: async () => okRes });
    assert.doesNotMatch(JSON.stringify(r), new RegExp(fakeToken), "token KHÔNG được lọt ra");
    assert.match(r.target, /api\.telegram\.org/, "vẫn phải đủ để chẩn đoán là kênh nào");
  });
});

describe("redactWebhook", () => {
  it("giữ host, bỏ đường dẫn — token nằm ở ĐƯỜNG DẪN chứ không phải host", () => {
    const fakeToken = ["T", "B", "khong-phai-token-that"].join("/");
    assert.equal(
      redactWebhook(`https://hooks.slack.com/services/${fakeToken}`),
      "hooks.slack.com/…",
    );
  });

  it("URL rác ⇒ chuỗi mô tả, KHÔNG ném và KHÔNG vọt nguyên chuỗi ra ngoài", () => {
    assert.doesNotMatch(redactWebhook("rac-nhung-co-the-la-secret"), /rac-nhung/);
  });
});
// ── S19-OPS-PRODDBBOOT-1: CHỐNG SPAM WEBHOOK mà KHÔNG nuốt cảnh báo thật ──────────────────────────
// Tác vụ chạy mỗi 10 phút; bản trước gửi webhook MỖI lần worst ≠ ok ⇒ một luật warn kéo dài (SITE_LMS
// kêu oan từ 21/09) = 144 tin/ngày ⇒ người ta tắt tiếng kênh ⇒ sự cố thật kế tiếp im lặng. Nhưng chiều
// hỏng NGƯỢC (nuốt một cảnh báo thật) còn tệ hơn — đó là rủi ro số 1 của phần này. Nên mọi chỗ nghi
// ngờ (trạng thái đọc lỗi, mốc thời gian lạ) đều nghiêng về GỬI.
const H = 3_600_000;
const T0 = Date.parse("2026-10-16T08:00:00.000Z");
const row = (id, severity) => ({
  id,
  title: id,
  severity,
  detail: `chi tiết ${id}`,
});
const ROWS_WARN = [row("BACKEND_DOWN", "ok"), row("SITE_LMS", "warn")];
const ROWS_CRIT = [row("BACKEND_DOWN", "crit"), row("SITE_LMS", "warn")];
const ROWS_OK = [row("BACKEND_DOWN", "ok"), row("SITE_LMS", "ok")];
const sentState = (worst, rows, hoursAgo) => nextAlertState({ worst, rows }, T0 - hoursAgo * H);
const decide = (o) =>
  decideAlertDelivery({
    now: T0,
    remindHours: DEFAULT_REMIND_HOURS,
    state: null,
    stateError: null,
    ...o,
  });

describe("decideAlertDelivery — khi nào GỬI", () => {
  it("lần đầu không-ok (chưa có trạng thái) ⇒ gửi", () => {
    const d = decide({ worst: "warn", rows: ROWS_WARN });
    assert.equal(d.send, true);
    assert.equal(d.kind, "alert");
  });

  it("cùng worst + cùng tập luật, trong hạn nhắc ⇒ KHÔNG gửi (đây là spam cần chặn)", () => {
    const d = decide({
      worst: "warn",
      rows: ROWS_WARN,
      state: sentState("warn", ROWS_WARN, 1),
    });
    assert.equal(d.send, false);
    assert.match(d.reason, /\S/);
  });

  it("chỉ đổi CHI TIẾT (số đếm, latency) ⇒ vẫn coi là trùng", () => {
    const rows = ROWS_WARN.map((r) => ({ ...r, detail: "số khác" }));
    const d = decide({
      worst: "warn",
      rows,
      state: sentState("warn", ROWS_WARN, 1),
    });
    assert.equal(d.send, false);
  });

  it("(a) worst đổi — nặng lên HAY nhẹ đi đều gửi", () => {
    const up = decide({
      worst: "crit",
      rows: ROWS_CRIT,
      state: sentState("warn", ROWS_WARN, 0.1),
    });
    const down = decide({
      worst: "warn",
      rows: ROWS_WARN,
      state: sentState("crit", ROWS_CRIT, 0.1),
    });
    assert.equal(up.send, true);
    assert.equal(down.send, true);
  });

  it("(b) cùng worst nhưng THÊM một luật hỏng ⇒ gửi (luật thứ hai không được núp sau luật đầu)", () => {
    const rows = [...ROWS_WARN, row("BACKUP_AGE", "warn")];
    const d = decide({
      worst: "warn",
      rows,
      state: sentState("warn", ROWS_WARN, 0.1),
    });
    assert.equal(d.send, true);
    assert.equal(d.kind, "change");
  });

  it("(b) cùng worst, cùng luật nhưng ĐỘ NẶNG một luật đổi ⇒ gửi", () => {
    const before = [row("A", "crit"), row("B", "warn")];
    const after = [row("A", "crit"), row("B", "unknown")];
    const d = decide({
      worst: "crit",
      rows: after,
      state: sentState("crit", before, 0.1),
    });
    assert.equal(d.send, true);
  });

  it("(b) một luật HẾT hỏng nhưng worst giữ nguyên ⇒ gửi (tập đổi)", () => {
    const before = [row("A", "warn"), row("B", "warn")];
    const after = [row("A", "warn"), row("B", "ok")];
    const d = decide({
      worst: "warn",
      rows: after,
      state: sentState("warn", before, 0.1),
    });
    assert.equal(d.send, true);
  });

  it("(c) còn hỏng y nguyên và lần gửi cuối cũ hơn hạn nhắc ⇒ gửi nhắc", () => {
    const state = sentState("warn", ROWS_WARN, DEFAULT_REMIND_HOURS);
    const d = decide({ worst: "warn", rows: ROWS_WARN, state });
    assert.equal(d.send, true);
    assert.equal(d.kind, "remind");
  });

  it("(c) hạn nhắc lấy từ tham số, không cứng 6 giờ", () => {
    const state = sentState("warn", ROWS_WARN, 2);
    assert.equal(decide({ worst: "warn", rows: ROWS_WARN, state, remindHours: 1 }).send, true);
    assert.equal(decide({ worst: "warn", rows: ROWS_WARN, state, remindHours: 3 }).send, false);
  });

  it("mốc gửi NẰM Ở TƯƠNG LAI (đồng hồ lùi) ⇒ gửi, không im tới mốc đó", () => {
    const d = decide({
      worst: "warn",
      rows: ROWS_WARN,
      state: sentState("warn", ROWS_WARN, -48),
    });
    assert.equal(d.send, true);
  });

  it("(d) lượt ok ĐẦU sau tin không-ok ⇒ chưa gửi, chỉ đánh mốc chuỗi ok", () => {
    const d = decide({
      worst: "ok",
      rows: ROWS_OK,
      state: sentState("crit", ROWS_CRIT, 3),
    });
    assert.equal(d.send, false);
    assert.equal(d.stateUpdate, "mark-ok");
  });

  it("(d) ok liên tục đủ hạn giữ ⇒ MỘT tin hồi phục; chưa đủ ⇒ chờ", () => {
    const withOk = (minutesAgo) => ({
      ...sentState("crit", ROWS_CRIT, 3),
      okSince: new Date(T0 - minutesAgo * 60_000).toISOString(),
    });
    const done = decide({
      worst: "ok",
      rows: ROWS_OK,
      state: withOk(DEFAULT_RECOVERY_HOLD_MINUTES),
    });
    assert.equal(done.send, true);
    assert.equal(done.kind, "recovered");
    const early = decide({ worst: "ok", rows: ROWS_OK, state: withOk(10) });
    assert.equal(early.send, false);
    assert.equal(early.stateUpdate, null);
  });

  it("hỏng lại giữa lúc chờ (trùng tin cũ) ⇒ không gửi nhưng XOÁ mốc chuỗi ok", () => {
    const state = {
      ...sentState("warn", ROWS_WARN, 1),
      okSince: new Date(T0 - 600_000).toISOString(),
    };
    const d = decide({ worst: "warn", rows: ROWS_WARN, state });
    assert.equal(d.send, false);
    assert.equal(d.stateUpdate, "clear-ok");
  });

  it("luật CHẬP CHỜN warn/ok mỗi lượt 10 phút trong 3 giờ ⇒ chỉ 1 tin (không spam cặp cảnh báo/hồi phục)", () => {
    let state = null;
    const sent = [];
    for (let i = 0; i < 18; i += 1) {
      const now = T0 + i * 600_000;
      const worst = i % 2 === 0 ? "warn" : "ok";
      const rows = worst === "ok" ? ROWS_OK : ROWS_WARN;
      const d = decide({ worst, rows, state, now });
      if (d.send) {
        sent.push(d.kind);
        state = nextAlertState({ worst, rows }, now);
      } else {
        state = applyStateUpdate(state, d.stateUpdate, now) ?? state;
      }
    }
    assert.deepEqual(sent, ["alert"]);
  });

  it("hết chập chờn, ok đủ lâu ⇒ tin hồi phục tới (hoãn chứ không nuốt)", () => {
    let state = sentState("warn", ROWS_WARN, 0.5);
    const kinds = [];
    for (let i = 0; i < 4; i += 1) {
      const now = T0 + i * 600_000;
      const d = decide({ worst: "ok", rows: ROWS_OK, state, now });
      if (d.send) {
        kinds.push(d.kind);
        state = nextAlertState({ worst: "ok", rows: ROWS_OK }, now);
      } else state = applyStateUpdate(state, d.stateUpdate, now) ?? state;
    }
    assert.deepEqual(kinds, ["recovered"]);
  });

  it("(d) đã gửi tin hồi phục rồi, vẫn ok ⇒ im", () => {
    const d = decide({
      worst: "ok",
      rows: ROWS_OK,
      state: sentState("ok", ROWS_OK, 0.1),
    });
    assert.equal(d.send, false);
  });

  it("ok và chưa từng gửi gì ⇒ im (không có gì để hồi phục)", () => {
    assert.equal(decide({ worst: "ok", rows: ROWS_OK }).send, false);
  });

  it("hỏng lại SAU tin hồi phục ⇒ gửi ngay, kể cả trong hạn nhắc", () => {
    const d = decide({
      worst: "warn",
      rows: ROWS_WARN,
      state: sentState("ok", ROWS_OK, 0.05),
    });
    assert.equal(d.send, true);
    assert.equal(d.kind, "alert");
  });

  it("trạng thái ĐỌC LỖI + đang hỏng ⇒ VẪN GỬI (thà trùng còn hơn nuốt)", () => {
    const d = decide({
      worst: "warn",
      rows: ROWS_WARN,
      stateError: "JSON hỏng",
    });
    assert.equal(d.send, true);
    assert.match(d.reason, /trạng thái/);
  });

  it("trạng thái đọc lỗi + đang ok ⇒ MỘT tin «resync» (không gọi là hồi phục), để ghi lại sổ", () => {
    const d = decide({ worst: "ok", rows: ROWS_OK, stateError: "JSON hỏng" });
    assert.equal(d.send, true);
    assert.equal(d.kind, "resync");
  });
});

describe("parseRemindHours — OPS_ALERT_REMIND_HOURS", () => {
  it("không đặt ⇒ mặc định 6, không kêu", () => {
    assert.equal(DEFAULT_REMIND_HOURS, 6);
    assert.deepEqual(parseRemindHours(undefined), { hours: 6, invalid: false });
    assert.deepEqual(parseRemindHours("  "), { hours: 6, invalid: false });
  });

  it("số dương (cả số lẻ) ⇒ nhận", () => {
    assert.deepEqual(parseRemindHours("2"), { hours: 2, invalid: false });
    assert.deepEqual(parseRemindHours("0.5"), { hours: 0.5, invalid: false });
  });

  it("giá trị rác ⇒ mặc định + cờ invalid để người gọi KÊU stderr", () => {
    for (const raw of ["abc", "0", "-1", "6h", "Infinity", "NaN"]) {
      assert.deepEqual(parseRemindHours(raw), { hours: 6, invalid: true }, raw);
    }
  });
});

describe("readAlertState / writeAlertState — file trạng thái", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ops-alert-state-"));
  const warnState = () => nextAlertState({ worst: "warn", rows: ROWS_WARN }, T0);

  it("chưa có file ⇒ state null, KHÔNG phải lỗi (lần chạy đầu)", () => {
    const r = readAlertState(path.join(tmp(), "khong-co.json"));
    assert.deepEqual(r, { state: null, error: null });
  });

  it("ghi rồi đọc lại ra đúng nội dung; ghi nguyên tử không để lại file tạm", () => {
    const dir = tmp();
    const file = path.join(dir, "state.json");
    const state = warnState();
    assert.deepEqual(writeAlertState(file, state), { ok: true, error: null });
    assert.deepEqual(readAlertState(file), { state, error: null });
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  });

  it("ghi đè file trạng thái cũ được (rename lên file đã có)", () => {
    const file = path.join(tmp(), "state.json");
    writeAlertState(file, warnState());
    const next = nextAlertState({ worst: "ok", rows: ROWS_OK }, T0 + H);
    assert.deepEqual(writeAlertState(file, next), { ok: true, error: null });
    assert.equal(readAlertState(file).state.worst, "ok");
  });

  it("nextAlertState chỉ giữ luật không-ok, kèm worst + mốc gửi", () => {
    const st = nextAlertState({ worst: "crit", rows: ROWS_CRIT }, T0);
    assert.equal(st.worst, "crit");
    assert.equal(st.sentAt, new Date(T0).toISOString());
    assert.deepEqual(st.alerts, [
      { id: "BACKEND_DOWN", severity: "crit" },
      { id: "SITE_LMS", severity: "warn" },
    ]);
  });

  it("JSON rác hoặc sai hình dạng ⇒ error (để người gọi kêu + vẫn gửi)", () => {
    const dir = tmp();
    const cases = {
      "rac.json": "{rac",
      "mang.json": "[]",
      "thieu.json": JSON.stringify({ worst: "warn" }),
      "worst-la.json": JSON.stringify({
        worst: "xanh",
        alerts: [],
        sentAt: "2026-10-16T00:00:00Z",
      }),
      "moc-hong.json": JSON.stringify({
        worst: "warn",
        alerts: [],
        sentAt: "hôm qua",
      }),
      "luat-hong.json": JSON.stringify({
        worst: "warn",
        alerts: [{ id: 1 }],
        sentAt: "2026-10-16T00:00:00Z",
      }),
    };
    for (const [name, body] of Object.entries(cases)) {
      fs.writeFileSync(path.join(dir, name), body);
      const r = readAlertState(path.join(dir, name));
      assert.equal(r.state, null, name);
      assert.ok(r.error, name);
    }
  });

  it("okSince hỏng ⇒ error; okSince hợp lệ đọc lại nguyên vẹn", () => {
    const dir = tmp();
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ ...warnState(), okSince: "chiều nay" }));
    assert.ok(readAlertState(bad).error);
    const good = path.join(dir, "good.json");
    const st = applyStateUpdate(warnState(), "mark-ok", T0);
    writeAlertState(good, st);
    assert.deepEqual(readAlertState(good), { state: st, error: null });
    assert.equal(applyStateUpdate(st, "clear-ok", T0).okSince, undefined);
    assert.equal(st.okSince, new Date(T0).toISOString(), "applyStateUpdate không sửa bản gốc");
  });

  it("rename bị khoá tạm (EPERM) ⇒ thử lại rồi thành công", () => {
    const dir = tmp();
    const file = path.join(dir, "state.json");
    let calls = 0;
    const flaky = (a, b) => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
      fs.renameSync(a, b);
    };
    const r = writeAlertState(file, warnState(), { renameImpl: flaky, retryDelaysMs: [1, 1] });
    assert.deepEqual(r, { ok: true, error: null });
    assert.equal(calls, 3);
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  });

  it("rename khoá mãi ⇒ ghi THẲNG file đích, không để file tạm", () => {
    const dir = tmp();
    const file = path.join(dir, "state.json");
    writeAlertState(file, warnState());
    const locked = () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    const next = nextAlertState({ worst: "ok", rows: ROWS_OK }, T0 + H);
    const r = writeAlertState(file, next, { renameImpl: locked, retryDelaysMs: [1] });
    assert.equal(r.ok, true);
    assert.equal(r.via, "direct-write");
    assert.equal(readAlertState(file).state.worst, "ok");
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  });

  it("rename lỗi KHÁC loại khoá ⇒ ok:false, không ghi thẳng", () => {
    const dir = tmp();
    const file = path.join(dir, "state.json");
    const xdev = () => {
      throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    };
    const r = writeAlertState(file, warnState(), { renameImpl: xdev, retryDelaysMs: [1] });
    assert.deepEqual(r, { ok: false, error: "EXDEV" });
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it("ghi lỗi (thư mục cha là FILE) ⇒ ok:false kèm error, KHÔNG ném", () => {
    const blocker = path.join(tmp(), "la-file");
    fs.writeFileSync(blocker, "x");
    const r = writeAlertState(path.join(blocker, "state.json"), warnState());
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
});

describe("formatAlertText — tin nhắc lại / hồi phục nói rõ mình là gì", () => {
  const firstLine = (payload) => formatAlertText(payload).split("\n")[0];

  it("tin hồi phục ghi ĐÃ HỒI PHỤC + mức trước đó", () => {
    const head = firstLine({
      worst: "ok",
      rows: ROWS_OK,
      deliveryKind: "recovered",
      previousWorst: "crit",
    });
    assert.match(head, /ĐÃ HỒI PHỤC/);
    assert.match(head, /CRIT/);
  });

  it("tin nhắc lại ghi NHẮC LẠI ở dòng đầu, vẫn liệt kê luật hỏng", () => {
    const payload = { worst: "warn", rows: ROWS_WARN, deliveryKind: "remind" };
    assert.match(firstLine(payload), /NHẮC LẠI/);
    assert.doesNotMatch(
      firstLine({ worst: "ok", rows: ROWS_OK, deliveryKind: "resync" }),
      /HỒI PHỤC/,
    );
    assert.match(
      firstLine({ worst: "ok", rows: ROWS_OK, deliveryKind: "resync" }),
      /không đọc được/,
    );
    assert.match(formatAlertText(payload), /SITE_LMS/);
  });

  it("tin thường giữ nguyên tiêu đề cũ", () => {
    assert.match(
      firstLine({ worst: "warn", rows: ROWS_WARN }),
      /^\[MediaOS ops\] WARN — 1\/2 nhóm/,
    );
  });
});
