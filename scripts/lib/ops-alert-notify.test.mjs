// scripts/lib/ops-alert-notify.test.mjs — S10-OPS-ALERTCHAN-1.
//
// ⚠️ FILE NÀY ĐANG **ĐỎ CÓ CHỦ ĐÍCH** — `./ops-alert-notify.mjs` CHƯA TỒN TẠI.
// Đây là bước RED của WO `S10-OPS-ALERTCHAN-1`, commit trước để phiên sau có điểm vào sạch.
// Vì vậy nó **CỐ Ý chưa được đăng ký** vào `harness/check.sh` step `tooling-tests` và hai
// workflow `.github/workflows/{ci,api}.yml` — cả ba nơi liệt kê tên file TƯỜNG MINH, nên
// chừng nào chưa thêm tên vào đó thì file này không chạy ở đâu cả và CI vẫn xanh.
// 🔴 PR nào thêm `ops-alert-notify.mjs` PHẢI đăng ký file này vào CẢ BA nơi trong CÙNG PR —
// quên là test thành mồ côi, đúng lỗi repo từng dính với `scripts/`+`harness/` trước S6-REL-1.
//
// Trọng tâm: **một cảnh báo không nói được chuyện gì đang hỏng thì không phải cảnh báo**. Bản trước
// gửi đúng một dòng `[MediaOS ops] CRIT` — người bị ping lúc 3h sáng không biết rule nào nổ, phải
// mở máy PROD ra mới biết. Nhóm test dưới ghim: thân tin nhắn PHẢI liệt kê các hàng không-ok.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWebhookRequest, detectWebhookFormat, formatAlertText } from "./ops-alert-notify.mjs";

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
