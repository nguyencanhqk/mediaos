/**
 * S16-SOCIAL-AVATARPRESIGN-1 — T-CNT · T-ZERO (plan §5, §10 F3): ký avatar thêm ĐÚNG +1 câu cổng mỗi
 * request, 0 `begin` thêm, không N+1. Ca hành vi ở `social-avatarpresign-1.int-spec.ts` (cùng thế giới
 * fixture `bootAvatarWorld`, tenant RIÊNG).
 *
 * Đếm ở tầng driver `pg` (`captureQueries`) — đại lượng rời rạc, không phụ thuộc máy (khuôn
 * `query-capture.ts`). Hai vế của MỘT request: (a) trang có avatar dạng fileId · (b) MỌI `avatar_url`
 * của tenant = NULL (khôi phục ngay sau). Câu cổng = `findVerifiedAvatarsTx` (`file_links` + bind
 * `'Avatar'`). Làm nóng trước mỗi phép đo: cache quyền (Valkey, TTL 300 s) đổi số câu của lượt đầu.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import { feedPostSchema } from "@mediaos/contracts";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb } from "../helpers/integration-db";
import {
  beginCount,
  captured,
  gateQueries,
  withTenantAvatarsCleared,
} from "../helpers/social-avatar-fixtures";
import {
  bootAvatarWorld,
  recipientsOf,
  type AvatarWorld,
  type Json,
} from "../helpers/social-avatar-world";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-AVATARPRESIGN-1 · đếm câu ký avatar (DB cô lập)", () => {
  let w: AvatarWorld;

  beforeAll(async () => {
    w = await bootAvatarWorld("savpc");
    // Trang feed 3 và 12 thẻ, CÓ kudos: 6 bài của author + 6 vinh danh [author, viewer] mới nhất.
    for (let i = 0; i < 6; i += 1) {
      await w.share(w.author.token, `T-CNT ${i}`);
      await w.kudos(w.mod.token, [w.author.employeeId, w.viewer.employeeId]);
    }
  }, 300_000);

  afterAll(async () => {
    await w?.close();
  }, 60_000);

  describe("T-CNT route ĐỌC — cùng request: (a) − (b) = ĐÚNG 1 câu (câu cổng), cùng số begin", () => {
    async function measureRead(label: string, call: () => request.Test): Promise<void> {
      expect((await call()).status, `${label}: làm nóng`).toBe(200);
      const a = await captured(async () => call());
      const b = await withTenantAvatarsCleared(w.direct, w.A.companyId, () =>
        captured(async () => call()),
      );
      expect(a.out.status, `${label} (a)`).toBe(200);
      expect(b.out.status, `${label} (b)`).toBe(200);
      expect(gateQueries(a.qs).length, `${label}: (a) có avatar fileId ⇒ đúng 1 câu cổng`).toBe(1);
      expect(gateQueries(b.qs).length, `${label}: (b) không avatar ⇒ 0 câu cổng`).toBe(0);
      expect(beginCount(a.qs), `${label}: số begin không đổi`).toBe(beginCount(b.qs));
      expect(a.qs.length - b.qs.length, `${label}: tổng câu (a) − (b)`).toBe(1);
    }

    it("001 feed — trang 3 thẻ", () =>
      measureRead("001@3", () => w.get(w.viewer.token, "/social/feed?limit=3")));
    it("001 feed — trang 12 thẻ (có kudos) — vẫn 1 câu (không N+1)", () =>
      measureRead("001@12", () => w.get(w.viewer.token, "/social/feed?limit=12")));
    it("003 chi tiết bài", () =>
      measureRead("003", () => w.get(w.viewer.token, `/social/posts/${w.kPost}`)));
    it("013 người thả cảm xúc", () =>
      measureRead("013", () => w.get(w.mod.token, `/social/posts/${w.sPostA}/reactions`)));
    it("014 bình luận", () =>
      measureRead("014", () => w.get(w.mod.token, `/social/posts/${w.sPostA}/comments?limit=50`)));
    it("022 đã đọc", () =>
      measureRead("022 acked", () =>
        w.get(w.mod.token, `/social/posts/${w.newsAck}/acks?state=acked&limit=100`),
      ));
    it("022 chưa đọc", () =>
      measureRead("022 unacked", () =>
        w.get(w.mod.token, `/social/posts/${w.newsUnack}/acks?state=unacked&limit=100`),
      ));
    it("026 sinh nhật", () =>
      measureRead("026", () => w.get(w.viewer.token, "/social/birthdays?range=today")));
    it("037 thành viên nhóm", () =>
      measureRead("037", () =>
        w.get(w.mod.token, `/social/groups/${w.groupId}/members?limit=100`),
      ));
    it("047 vinh danh", () =>
      measureRead("047", () => w.get(w.viewer.token, "/social/kudos?page=1&limit=50")));
    it("059 danh bạ người nhận", () =>
      measureRead("059", () => w.get(w.mod.token, "/social/kudos/recipients?q=avatar")));
    it("028 hàng đợi báo cáo", () =>
      measureRead("028", () => w.get(w.mod.token, "/social/reports?limit=100")));
  });

  /**
   * Route GHI — mỗi lượt một ĐÍCH MỚI (cùng đích ⇒ nhánh khác: `002`/`015` phát lại bản đệm 0 câu ·
   * `006` noop · `029` 409 — plan M17). CHỈ so câu cổng + `begin` (KHÔNG so tổng: `029` có +2 câu
   * SAVEPOINT theo thiết kế D10, và ghi khác nhánh là hợp lệ).
   */
  describe("T-CNT route GHI — đích mới mỗi lượt: (a) 1 câu cổng · (b) 0 · cùng số begin", () => {
    async function measureWrite(
      label: string,
      prepare: () => Promise<string>,
      call: (target: string) => request.Test,
    ): Promise<void> {
      const warm = await prepare();
      const ta = await prepare();
      const tb = await prepare();
      expect((await call(warm)).status, `${label}: làm nóng`).toBeLessThan(300);
      const a = await captured(async () => call(ta));
      const b = await withTenantAvatarsCleared(w.direct, w.A.companyId, () =>
        captured(async () => call(tb)),
      );
      expect(a.out.status, `${label} (a): ${JSON.stringify(a.out.body)}`).toBeLessThan(300);
      expect(b.out.status, `${label} (b): ${JSON.stringify(b.out.body)}`).toBeLessThan(300);
      expect(gateQueries(a.qs).length, `${label}: (a) đúng 1 câu cổng`).toBe(1);
      expect(gateQueries(b.qs).length, `${label}: (b) 0 câu cổng`).toBe(0);
      expect(beginCount(a.qs), `${label}: số begin không đổi`).toBe(beginCount(b.qs));
    }

    it("002 tạo bài (Idempotency-Key khác nhau)", () =>
      measureWrite(
        "002",
        async () => randomUUID(),
        (key) =>
          w
            .post(w.author.token, "/social/posts")
            .set("Idempotency-Key", key)
            .send({ type: "share", audience: "company", body: `T-CNT 002 ${key}` }),
      ));
    it("004 sửa bài (bài mới mỗi lượt)", () =>
      measureWrite(
        "004",
        () => w.share(w.author.token, "T-CNT 004"),
        (id) => w.patch(w.author.token, `/social/posts/${id}`).send({ body: "T-CNT 004 đã sửa" }),
      ));
    it("006 kiểm duyệt (bài mới mỗi lượt — có UPDATE + audit)", () =>
      measureWrite(
        "006",
        () => w.share(w.author.token, "T-CNT 006"),
        (id) =>
          w.patch(w.mod.token, `/social/posts/${id}/moderation`).send({ commentsLocked: true }),
      ));
    it("015 bình luận (Idempotency-Key khác nhau)", () =>
      measureWrite(
        "015",
        async () => randomUUID(),
        (key) =>
          w
            .post(w.author.token, `/social/posts/${w.sPostA}/comments`)
            .set("Idempotency-Key", key)
            .send({ body: `T-CNT 015 ${key}` }),
      ));
    it("029 xử lý báo cáo (báo cáo mới mỗi lượt — SAVEPOINT không phải begin)", () =>
      measureWrite(
        "029",
        async () => w.report(w.viewer.token, await w.share(w.author.token, "T-CNT 029")),
        (id) => w.patch(w.mod.token, `/social/reports/${id}`).send({ status: "dismissed" }),
      ));
  });

  it("T-ZERO — trang chỉ có avatar null / URL https / scheme lạ ⇒ 0 câu cổng (không ký vô cớ)", async () => {
    const zeroPost = await w.kudos(w.mod.token, [w.dataP.employeeId, w.extP.employeeId]);
    const { out: res, qs } = await captured(async () =>
      w.get(w.viewer.token, `/social/posts/${zeroPost}`),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    feedPostSchema.parse(res.body.data);
    expect(recipientsOf(res.body.data as Json), "neo: hai người nhận có mặt").toHaveLength(2);
    expect(gateQueries(qs).length).toBe(0);
  });
});
