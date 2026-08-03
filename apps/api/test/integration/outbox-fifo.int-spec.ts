import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoggerAlertSink } from "../../src/events/alert.service";
import { EventBus } from "../../src/events/event-bus";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S7-INT-OUTBOX-FIFO-1 (KI-059) — `OutboxWorker.claim()` phải giao event cho consumer THEO ĐÚNG
 * thứ tự `available_at` trong CÙNG một lô claim.
 *
 * Vì sao lỗi tồn tại được lâu: `ORDER BY` nằm trong CTE `claimed` chỉ quyết định **hàng nào** được
 * claim, KHÔNG quyết định thứ tự hàng của `RETURNING` ở câu `UPDATE` bọc ngoài — thứ tự đó do planner
 * sinh. Bảng nhỏ thì plan tình cờ ra đúng FIFO ⇒ chạy cô lập là XANH, chỉ lộ dưới tải, dạng hỏng-im-lặng.
 *
 * ══ BA RÀNG BUỘC VỆ SINH — đọc trước khi sửa spec này ══
 * `outbox_events` là bảng CHUNG và claim dùng `FOR UPDATE SKIP LOCKED` **không lọc tenant**, trong khi
 * vitest chạy các file int-spec SONG SONG trên cùng một lane DB. Ba chiều hỏng, cả ba đã có tiền lệ
 * trên master (xem `test/helpers/outbox-drain.ts` — CI đỏ 2 lần liên tiếp 2026-07-15):
 *
 *  (a) BỊ CƯỚP — worker của spec khác claim probe của mình trước ⇒ `received` thiếu. Giảm thiểu: probe
 *      KHÔNG được là hàng già nhất DB (`ORDER BY available_at` khiến hàng già bị nhặt trước, tất định),
 *      nên gieo `available_at` chỉ lùi vài trăm ms thay vì 1 giờ. Còn sót thì bước (3) bắt và nói rõ lý do.
 *  (b) ĐI CƯỚP — `processEvent` gặp event KHÔNG có consumer trong bus của mình sẽ đánh `'done'`, TERMINAL
 *      và IM LẶNG (`outbox-worker.ts` nhánh `consumers.length === 0`) ⇒ nuốt mất event của spec khác.
 *      Giảm thiểu: batch đúng bằng số probe (không phải 50), và bước (4) TRẢ LẠI mọi event đã bị đánh
 *      `'done'` mà không có dòng `processed_events` nào — tức thứ mình lỡ nuốt chứ không xử lý.
 *  (c) BỊ CHIẾM SLOT (S7-QA-OUTBOXPROBE-1) — event của spec khác, `available_at` GIÀ hơn probe, đứng
 *      TRƯỚC theo `ORDER BY available_at` và ăn mất một chỗ trong lô N ⇒ chỉ N-1 probe được claim.
 *      KHÔNG cần worker nào khác chạy: chỉ cần spec khác ĐÃ enqueue và CHƯA drain. Mutex
 *      `acquireOutboxWorkerLock` không với tới chiều này (nó chỉ tuần-tự-hoá WORKER, không cấm ENQUEUE).
 *      Giảm thiểu: bước (5) claim NHIỀU LƯỢT tới khi đủ N probe, thay vì đúng một lượt.
 *
 * Đòn bẩy RED là **chèn ngược**: `available_at` tăng dần nhưng thứ tự chèn là nghịch đảo, nên thứ tự vật
 * lý trong heap ngược với thứ tự logic. Plan nào trả theo thứ tự heap (bitmap heap scan, hash semi-join)
 * sẽ lộ ngay — và seq scan chính là plan phơi bug rõ nhất, hàng nhiễu ở đây chỉ để bảng không nhỏ tới mức
 * mọi plan đều trùng nhau. KHÔNG assert planner chọn gì (memory: pg-planner-index-assert-trap) — chỉ
 * assert HÀNH VI thứ tự consumer thực sự nhận được.
 */
describe.skipIf(!hasDb)("S7-INT-OUTBOX-FIFO-1 — outbox dispatch đúng thứ tự (KI-059)", () => {
  const direct = directPool();
  const EVENT_TYPE = "fifo.probe";
  const NOISE_TYPE = "fifo.noise";
  const CONSUMER = "fifo-probe-consumer";
  const N = 12;
  let A: SeededTenant;
  let outboxLock: OutboxWorkerLock | undefined;

  const purgeProbes = () =>
    direct
      .query(
        `DELETE FROM dead_letter_events WHERE event_id IN
           (SELECT id FROM outbox_events WHERE event_type IN ($1, $2))`,
        [EVENT_TYPE, NOISE_TYPE],
      )
      .then(() =>
        direct.query(
          `DELETE FROM processed_events WHERE event_id IN
             (SELECT id FROM outbox_events WHERE event_type IN ($1, $2))`,
          [EVENT_TYPE, NOISE_TYPE],
        ),
      )
      .then(() =>
        direct.query("DELETE FROM outbox_events WHERE event_type IN ($1, $2)", [
          EVENT_TYPE,
          NOISE_TYPE,
        ]),
      );

  beforeAll(async () => {
    A = await seedCompany(direct, "obfifo");
    // Rác của lượt chạy TRƯỚC bị crash: probe kẹt 'processing' quá 5 phút sẽ được reaper NGAY TRONG
    // `processBatch` trả về 'pending' rồi claim luôn ⇒ `received` dài hơn N, đỏ khó hiểu.
    await purgeProbes();

    // S7-QA-OUTBOXPROBE-1 — mutex toàn cục: chỉ MỘT spec lái worker tại một thời điểm. Khoá này chỉ đóng
    // chiều (a)/(b); ba ràng buộc vệ sinh ở docblock GIỮ NGUYÊN làm đai thứ hai, KHÔNG thay bằng khoá.
    outboxLock = await acquireOutboxWorkerLock("outbox-fifo");
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await outboxLock?.release();
    await purgeProbes();
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("consumer nhận event theo đúng thứ tự available_at, dù thứ tự chèn là NGƯỢC", async () => {
    for (let i = 0; i < 200; i++) {
      await direct.query(
        `INSERT INTO outbox_events (company_id, event_type, payload, status, available_at)
         VALUES ($1, $2, '{}'::jsonb, 'done', now() - interval '2 hours')`,
        [A.companyId, NOISE_TYPE],
      );
    }

    // MỘT mốc thời gian cho cả lô — KHÔNG dùng `now()` của từng câu INSERT. Mỗi INSERT là một transaction
    // riêng nên `now()` nhích theo thời gian thực, trong khi khoảng lùi lại giảm dần theo vòng lặp: hai đại
    // lượng chạy NGƯỢC chiều nhau và chỉ cách nhau 50ms. Dưới tải song song, một câu chậm >50ms là đủ để đảo
    // đúng cái trật tự mà spec đang cố dựng — quan sát thật 2026-08-03: consumer nhận `[0..8, 11, 9, 10]`,
    // seq 11 (chèn ĐẦU, `now()` sớm nhất) vượt lên trước 9/10 vì hai câu sau nó chậm hơn 50ms. Đỏ như thế
    // trông y hệt "bản vá FIFO hỏng" nhưng thực ra là spec tự dựng sai tiền đề. Neo một mốc rồi trừ khoảng
    // cách cố định ⇒ giãn cách ĐÚNG 50ms bất kể độ trễ chèn, và không bao giờ hoà (tie-break không bị gọi tới).
    const { rows: anchorRows } = await direct.query<{ t: Date }>("SELECT now() AS t");
    const anchor = anchorRows[0].t;

    // seq 0..N-1 `available_at` TĂNG DẦN nhưng CHÈN từ N-1 về 0 ⇒ heap order = nghịch đảo.
    // Lùi tối đa ~600ms so với MỐC: đủ để `available_at <= now()`, KHÔNG đủ già để thành mồi ngon cho worker khác.
    for (let seq = N - 1; seq >= 0; seq--) {
      await direct.query(
        `INSERT INTO outbox_events (company_id, event_type, payload, status, available_at)
         VALUES ($1, $2, $3::jsonb, 'pending', $4::timestamptz - make_interval(secs => $5::float8))`,
        [A.companyId, EVENT_TYPE, JSON.stringify({ seq }), anchor, (N - seq) * 0.05],
      );
    }

    const received: number[] = [];
    const bus = new EventBus();
    bus.register({
      consumerName: CONSUMER,
      eventType: EVENT_TYPE,
      handle: async (ctx) => {
        received.push((ctx.payload as { seq: number }).seq);
      },
    });

    const { rows: before } = await direct.query<{ t: Date }>("SELECT now() AS t");
    // Batch ĐÚNG bằng N — không phải 50. Cận trên chặt là thứ giới hạn thiệt hại nếu có event lạ lọt vào lô.
    //
    // (5) NHIỀU LƯỢT, không phải một — S7-QA-OUTBOXPROBE-1. Mutex `acquireOutboxWorkerLock` chặn worker
    // của spec KHÁC chạy đồng thời, nhưng KHÔNG chặn spec khác ENQUEUE: `outbox_events` vẫn là bảng chung,
    // và một spec đang xếp hàng chờ khoá thường đã có event 'pending' nằm sẵn đó. Event lạ nào `available_at`
    // GIÀ hơn probe sẽ đứng trước theo `ORDER BY available_at` và CHIẾM MỘT SLOT của lô 12 ⇒ chỉ 11 probe
    // được claim ⇒ `expected 11 to be 12`. Đo thật trong `check.sh --lane-db` (chunk 11/13, 2026-08-04):
    // đỏ đúng như vậy, kèm chính dòng cảnh báo "đã trả lại 1 event claim nhầm của spec khác" ở bước (4).
    //
    // Lặp tới khi đủ N probe KHÔNG làm yếu phép đo: `ORDER BY available_at` lấy hàng GIÀ NHẤT trước, mà
    // `available_at` của probe tăng đơn điệu ⇒ probe luôn được claim theo đúng thứ tự seq dù rơi vào mấy lô.
    // Đòn bẩy RED (chèn ngược ⇒ heap order nghịch đảo) nằm TRONG từng lô và giữ nguyên hiệu lực.
    const worker = new OutboxWorker(bus, new LoggerAlertSink());
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { claimed } = await worker.processBatch(N);
      if (received.length >= N || Date.now() > deadline) break;
      // Không claim được gì mà vẫn thiếu probe = trạng thái bất thường; nghỉ ngắn rồi thử lại tới hạn chót
      // thay vì quay vòng nóng. Hết hạn thì assert (3) bên dưới báo LOUD kèm chẩn đoán.
      if (claimed === 0) await new Promise((r) => setTimeout(r, 50));
    }

    // (4) TRẢ LẠI thứ đã lỡ nuốt: event bị đánh terminal trong cửa sổ của mình mà KHÔNG consumer nào
    // ghi `processed_events` = event của spec khác, bus của mình không có consumer cho nó.
    const { rowCount: stolen } = await direct.query(
      `UPDATE outbox_events SET status = 'pending', available_at = now(), updated_at = now()
         WHERE status = 'done' AND event_type <> $1 AND updated_at >= $2
           AND NOT EXISTS (SELECT 1 FROM processed_events pe WHERE pe.event_id = outbox_events.id)`,
      [EVENT_TYPE, before[0].t],
    );
    if (stolen) console.warn(`[outbox-fifo] đã trả lại ${stolen} event claim nhầm của spec khác`);

    // (3) Phân biệt "vá hỏng" với "bị spec khác cướp probe" — nếu không, lỗi thứ hai hiện ra dưới dạng
    // lệch length và người đọc sẽ đi sửa nhầm chỗ. Từ S7-QA-OUTBOXPROBE-1, bước (5) đã lặp tới hạn chót
    // nên chiều (c) "bị chiếm slot" KHÔNG còn tới được đây; thiếu probe ở đây nghĩa là probe THẬT SỰ bị
    // worker khác claim mất (chiều a) — tức mutex hở, chứ không phải lô quá nhỏ.
    const { rows: mine } = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM outbox_events o
         JOIN processed_events pe ON pe.event_id = o.id AND pe.consumer_name = $2
        WHERE o.event_type = $1`,
      [EVENT_TYPE, CONSUMER],
    );
    expect(
      Number(mine[0].n),
      "probe bị worker của spec khác claim mất DÙ đã giữ mutex + claim lại tới 15s — KHÔNG phải lỗi thứ tự. " +
        "Kiểm `acquireOutboxWorkerLock` có được gọi ở MỌI spec lái worker không (outbox-worker-lock.unit-spec.ts)",
    ).toBe(N);

    expect(received).toHaveLength(N);
    expect(received).toEqual(Array.from({ length: N }, (_, i) => i));
  });
});
