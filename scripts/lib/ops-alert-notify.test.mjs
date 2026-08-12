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
import {
  buildWebhookRequest,
  detectWebhookFormat,
  formatAlertText,
  redactWebhook,
  sendAlert,
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
