# S10-CHAT-EMITGUARD-2 — bọc đường PHÁT realtime của NĂM route REST CALL (KI-076)

> 🟡 Vùng vàng · LIGHT gate (`typescript-reviewer` + `quality-gate`) + `silent-failure-hunter`.
> Plan viết sau khi ĐO CÂY THẬT 2026-08-25 ([[wo-plans-built-on-code-comments]]).
> Khuôn tham chiếu: `docs/plans/S10-CHAT-EMITGUARD-1.md` §3 (guard ở HELPER) và §4 (kế toán).

## §0 — PHÁT BIỂU MỨC ĐỘ TRƯỚC (điều kiện nghiệm thu #1)

**Nợ PHÒNG THỦ THEO CHIỀU SÂU, KHÔNG phải lỗ đang chảy máu.** Đo lại từng vế trên cây hôm nay:

| Câu hỏi | Đo được | Kết luận |
| --- | --- | --- |
| `emitChatCall` có ném được không? | `realtime-emitter.service.ts:269-299` — `try` bọc CẢ `.parse()` LẪN `server.to().emit()`; nhánh `!this.server` là `logger.error` + `return` | **KHÔNG**, hôm nay |
| Ai ghim bất biến đó? | `realtime/realtime-emitter.call.spec.ts` (mở ở EMITGUARD-1, có kiểm chứng đột biến) | **CÓ** — khác hẳn KI-075 lúc mở |
| `dto.startedAt` có ném được không? | `ChatCallDto.startedAt` đã là `string` (`toChatCallDto`), KHÔNG `.toISOString()` ở `emitLifecycle` | **KHÔNG** |

⇒ Rủi ro tồn dư không còn là _"ai đó sửa emitter mà không biết"_ mà là _"ai đó CỐ Ý đổi hợp đồng emitter
và sửa luôn ca ghim"_ — **thấp hơn hẳn KI-075 lúc mở**. Đừng chép giọng KI-075 sang đây.

## §1 — Nợ thật là gì, và vì sao 3/5 KHÔNG tự lành

`emitLifecycle` được gọi từ HAI chỗ, cả hai NGOÀI `withTenant` (đúng luật) nhưng KHÔNG bọc:

| Điểm | Route | `action` | Trạng thái sau |
| --- | --- | --- | --- |
| `chat-calls.service.ts:203` | `invite` (CHAT-API-026) | `ringing` | `ringing` |
| `chat-calls.service.ts:558` (`lifecycleTx`) | `accept` · `reject` · `cancel` · `hangup` | `accepted`/`rejected`/`cancelled`/`ended` | `active` / **3 trạng thái CUỐI** |

**Bảng HỒI PHỤC — vế mà đánh giá ban đầu (PR #408) đọc SAI:**

| Trạng thái | Ai quét | Hồi phục |
| --- | --- | --- |
| `ringing` (`invite`) | job `CHAT_CALL_RINGING_TIMEOUT` (45s) **+** bước dọn-trước-khi-mời của lời mời kế | **tự lành** |
| `active` (`accept`) | job `CHAT_CALL_STALE_ACTIVE_SWEEP` (mồ côi grace 2 phút / quá thọ 12h) | **tự lành CHẬM** |
| `rejected` · `cancelled` · `ended` | **KHÔNG job nào** — cả hai job chỉ quét `ringing`/`active`; CALL **không có route ĐỌC** để poll bù | **KHÔNG hồi phục** — peer giữ khung gọi chết tới khi reload/reconnect |

⚠️ PR #408 ghi _"client thấy được trạng thái qua chính response POST"_ — câu đó chỉ đúng cho **ACTOR**, và
chỉ ở 2/5 hình dạng. **PEER không có response POST nào để đọc**; WS là kênh duy nhất báo cho họ.

**Hậu quả HÔM NAY nếu bất biến vỡ:** lời gọi phát nằm SAU commit ⇒ hàng `chat_calls` đã đổi trạng thái
THẬT, nhưng route trả **500** cho một giao dịch ĐÃ commit. Actor tưởng thất bại → thử lại → ăn **422
`CALL_NOT_ACTIONABLE`** (`mustTransition` từ trạng thái đã đổi). Đó là ca RED của §4.

## §2 — Đường vá: MỘT điểm sửa trong `emitLifecycle`, KHÔNG vá lẻ từng route

| Phương án | Vì sao |
| --- | --- |
| (A) `try/catch` quanh `this.emitLifecycle(...)` ở `:203` **và** trong `lifecycleTx` | ❌ hai bản sao của cùng một quy tắc; `lifecycleTx` được dựng ra CHÍNH ĐỂ chống "quên ở một route" — nhân bản guard ra ngoài nó là đi ngược thiết kế |
| **(B) `try/catch` bọc `this.realtime.emitChatCall(...)` TRONG thân `emitLifecycle`** | ✅ MỘT điểm sửa phủ cả 5 route; ✅ cùng khuôn với `emitExpired`/`emitAutoEnded` (guard sống trong helper, EMITGUARD-1 §3); ✅ ratchet `emitChatCall(` **vẫn đúng 3** — không đụng trần |
| (C) bọc trong `emitChatCall` | ❌ đã có rồi — chính là bất biến đang được ghim. Vá vào chỗ không hỏng. |

Chọn **(B)**. `emitLifecycle` chỉ có MỘT lời gọi emit (không vòng lặp) ⇒ không có vế "mất lô còn lại" như
EMITGUARD-1 §3; per-item và bọc-cả-thân là MỘT.

## §3 — Đường REST không có chỗ chứa số đếm: QUYẾT log-only, KHAI RA

Đường job đưa số emit hỏng vào `JobRunResult.failed` + `metadata.emitFailed`. **Đường REST không có
run-row nào để chứa nó** — và không được dựng ra một cái: hợp đồng HTTP của 5 route là `ChatCallDto`
(SPEC-15), nhét trường "emit hỏng" vào DTO là rò rỉ chi tiết vận chuyển vào hợp đồng nghiệp vụ.

**Chốt:**

1. `emitLifecycle` giữ kiểu trả về **`void`** — KHÔNG đổi sang `number`. Trả một con số mà không caller
   nào tiêu thụ là **kế toán giả**: nó trông như có tín hiệu trong khi tín hiệu duy nhất là dòng log.
   (Đối lập có chủ ý với `emitExpired`/`emitAutoEnded`: ở đó `: number` được ratchet GHIM vì job **có**
   chỗ tiêu thụ.)
2. Kênh duy nhất = **`logger.error` trong helper**, mang `callId` · `action` · `roomId`.
3. `invite:202` gọi `this.emitExpired(...)` và **VỨT** số đếm — viết `void this.emitExpired(...)` để chỗ
   vứt là **tường minh và grep được**, kèm chú giải. Helper đã `logger.error` per-item kèm `callId`; một
   dòng tổng ở tầng REST chỉ nhân đôi cùng thông tin.

Cả ba quyết định này phải nằm trong **docblock**, không phải chỉ trong plan — nếu không lần review sau
mở lại đúng cuộc tranh luận này (đó là lý do KI-076 ghi vế thứ hai).

## §4 — Ca test (RED TRƯỚC) — file MỚI `chat-call-rest-emit-guard.spec.ts`

Dựng `ChatCallsService` **THẬT** (guard sống trong helper — fake helper đi là đo một cái vỏ,
[[same-builder-twice-makes-unit-spec-vacuous]]). `describe.each` chạy **cùng một bảng ca cho cả 5 route**.

| Ca | Kỳ vọng |
| --- | --- |
| **DENY** (×5 route) — `emitChatCall` ném | `await` route **KHÔNG reject** · trả về **đúng DTO** như đường xanh · đúng 1 `logger.error` mang `callId` + `action` |
| **ALLOW** (×5 route) — đường xanh | emit **đúng 1 lần** · `action` đúng của route · đích = `participants[].userId` · DTO **không đổi** |
| DENY — `invite` + bước dọn: emit của `missed` ném | `ringing` **VẪN** được phát sau đó (guard không cắt luồng) · route trả 2xx |
| ALLOW đối chứng — `invite` + bước dọn, không ai ném | đúng 2 emit, thứ tự `missed` → `ringing` |

⚠️ Ca ALLOW bắt buộc: thiếu nó thì đột biến "`emitLifecycle` return ngay dòng đầu" vẫn xanh cả 5 ca DENY
([[deny-cases-vacuous-without-allow-case]]).

**Ratchet (nối vào `chat-realtime-after-commit.spec.ts`):**

- `this.realtime.emitChatCall(` vẫn **đúng 3** — trần cũ, KHÔNG hạ ([[index-ratchet-must-pin-definition-not-name]]).
- Ghim `emitLifecycle` giữ `: void` + có `catch` trong thân (chống "dọn sạch" guard hoặc đổi sang kế toán giả).
- Ghim `void this.emitExpired(` ở đường REST — chỗ vứt phải ở lại TƯỜNG MINH.

## §5 — Ngoài phạm vi

3 món hoãn của `S10-CHAT-CALLSWEEP-1` (audit `closedUserIds` · int-spec chéo tenant · gom lô N+1) — chưa
có số hiệu. Không làm ở đây.

## §6 — Verify

```bash
pnpm --filter @mediaos/api test -- chat-call-rest-emit-guard chat-call-emit-guard chat-realtime-after-commit
pnpm typecheck && pnpm lint
```

Không thêm int-spec (mọi ca unit colocated — [[vitest-unit-specs-must-be-colocated]]) ⇒ không cần lane DB.
KHÔNG `source .env` ([[sourcing-dotenv-poisons-test-run-node-env]]).
