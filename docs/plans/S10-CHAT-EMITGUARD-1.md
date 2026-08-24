# S10-CHAT-EMITGUARD-1 — ghim hợp đồng biên "emit không ném" cho HAI job CHAT (KI-075)

> 🟡 Vùng vàng · LIGHT gate (`typescript-reviewer` + `quality-gate`) + `silent-failure-hunter`.
> Plan viết sau khi ĐO CÂY THẬT 2026-08-24, không đọc từ comment WO ([[wo-plans-built-on-code-comments]]).

## §0 — PHÁT BIỂU MỨC ĐỘ TRƯỚC (điều kiện nghiệm thu #1)

**Đây là nợ ĐỘ BỀN / hợp đồng biên, KHÔNG phải lỗ đang chảy máu.** Đo lại từng vế trên cây hôm nay:

| Câu hỏi | Đo được | Kết luận |
| --- | --- | --- |
| `emitChatCall` có ném được không? | `realtime-emitter.service.ts:269-299` — `try` bọc CẢ `wsChatCallEventSchema.parse` LẪN `server.to().emit()`; nhánh `!this.server` là `logger.error` + `return` | **KHÔNG**, hôm nay |
| `call.startedAt.toISOString()` có ném được không? | `chat_calls.started_at` khai `notNull` (`db/schema/communication.ts:504`) | **KHÔNG** |
| Ai ghim bất biến đó? | `grep emitChatCall apps/api/src/realtime/*.spec.ts` ⇒ **0 kết quả** | **KHÔNG AI** |
| Ai khai bất biến đó ở phía hai job? | 0 dòng chú ở cả hai job-handler | **KHÔNG AI** |

⇒ Nghiệm thu của WO này là **"bất biến được GHIM + hai job đối xứng"**, KHÔNG phải "sửa một crash".
Ai đo lại rồi báo "đã vá một lỗi đang chảy máu" là đang thổi mức độ.

## §1 — Nợ thật là gì

Hai job dựa vào một bất biến của **module KHÁC** (`realtime/`) mà không có ca nào ghim, không dòng chú nào
khai — cùng họ [[ui-promises-backend-never-reads]]: một bên hứa, bên kia không có gì ép.

Ai chuyển `.parse()` ra ngoài `try` của `emitChatCall`, hay cắm một emitter rethrow, sẽ đổi hành vi của
HAI job cách đó hai thư mục mà **typecheck vẫn xanh**.

**Hậu quả KHI bất biến đó vỡ** (đọc từ code, không suy diễn):

1. Lời gọi phát nằm **SAU commit** ⇒ hàng `chat_calls` đã đổi trạng thái THẬT.
2. `run()` reject ⇒ `JobRunner` finalize run-row **`'Failed'`** (`job-runner.ts:127-142`) — nói dối theo
   chiều ngược: việc nghiệp vụ ĐÃ xong.
3. Cả hai job **idempotent theo thiết kế** (hàng vừa đổi không còn khớp vị từ `status`) ⇒ nhịp kế khớp
   **0 hàng** ⇒ **sự kiện mất VĨNH VIỄN, chạy lại job KHÔNG sửa được**.
4. CALL **không có đường REST bù** — chính docblock `emitChatCall` khai điều đó
   (`chat-calls.controller.ts` chỉ có 4 route `@Post` vòng đời, 0 route ĐỌC để poll).
5. Bán kính có giới hạn: `JobRunner` bọc try/catch **per-tenant** (`job-runner.ts:117-143`) ⇒ một tenant
   một nhịp, tenant kế vẫn chạy.

## §2 — ĐÍNH CHÍNH tên hàm (một nửa giá trị của số hiệu)

Ghi chú bàn giao `S10-CHAT-CALLSWEEP-1` viết _"`emitAutoEnded` ở cả hai job"_ — **SAI**.

| Job | Dòng | Hàm gọi | `action` |
| --- | --- | --- | --- |
| `ChatCallRingingTimeoutJobHandler` | `chat-call-ringing-timeout.job-handler.ts:68` | **`emitExpired`** | `"missed"` |
| `ChatCallStaleActiveSweepJobHandler` | `chat-call-stale-active-sweep.job-handler.ts:72` | **`emitAutoEnded`** | `"ended"` |

Cùng KHUÔN, khác HÀM. Grep đúng một tên rồi tưởng đã phủ cả hai là **đúng lớp bẫy** mà số hiệu này sinh ra
để chống — họ hàng [[identity-projection-census-misses-alias]].

## §3 — Đường vá: guard đặt ở HELPER, không nhân bản trong hai job

Có ba chỗ đặt được `try/catch`. Chọn (B):

| Phương án | Vì sao |
| --- | --- |
| (A) bọc cả lời gọi `emitExpired(...)` trong job | ❌ **mất lô còn lại**: một cuộc gọi ném ⇒ N-1 cuộc gọi sau nó không bao giờ được phát. Vòng lặp nằm TRONG helper, catch ở ngoài không cứu được nó. |
| **(B) per-item `try/catch` TRONG vòng lặp của `emitExpired`/`emitAutoEnded`, trả về SỐ item hỏng** | ✅ lô còn lại vẫn phát; ✅ hai job đối xứng **theo cấu tạo** (cùng khuôn helper) chứ không theo kỷ luật copy-paste; ✅ phủ luôn call site REST `chat-calls.service.ts:202` (`invite` dọn-trước-khi-mời) — cùng khuôn, cùng rủi ro. |
| (C) bọc trong `emitChatCall` | ❌ đã có rồi — chính là bất biến đang không được ghim. Thêm nữa là vá vào đúng chỗ không hỏng. |

⚠️ **KHÔNG gộp hai vòng lặp thành một helper chung.** Ratchet `chat-realtime-after-commit.spec.ts` đếm
`this.realtime.emitChatCall(` phải **đúng 3** (emitLifecycle · emitExpired · emitAutoEnded); gộp làm nó
tụt xuống 2 và buộc phải hạ trần ratchet — hạ trần một ratchet để "cho qua" một refactor là gỡ đúng thứ
nó canh ([[index-ratchet-must-pin-definition-not-name]]). Đối xứng ở đây là **hai vòng lặp cùng khuôn**,
và nó được ghim bằng ca cấu trúc ở §5.3, không bằng việc chia sẻ một thân hàm.

## §4 — `JobRunResult` khi phát hỏng: quyết TƯỜNG MINH

`JobRunner.deriveStatus(failed, success)`: `failed===0` → `Success` · `failed>0 && success>0` → `Partial`
· còn lại → `Failed`.

**Chốt kế toán** (theo quy ước nhà — `attendance-alert-noti.job-handler.ts:130` phân hoạch
`success + failed === total`):

```text
total   = số hàng DB đã đổi trạng thái   (KHÔNG đổi — đây là sự thật nghiệp vụ)
failed  = số cuộc gọi KHÔNG phát được sự kiện
success = total - failed
metadata.callsMissed / callsAutoEnded = total   ← sự thật DB, GIỮ NGUYÊN dù phát hỏng
metadata.emitFailed = failed                    ← CHỈ có mặt khi failed > 0
```

- **Vì sao KHÔNG nuốt thành `success` trọn vẹn:** try/catch đã che run-row khỏi trạng thái `'Failed'`;
  nếu `failed` cũng về 0 thì **không còn tín hiệu nào** — mất chuông trở thành im lặng tuyệt đối. Đó đúng
  địa hạt `silent-failure-hunter`.
- **Vì sao `metadata.emitFailed` KHÔNG có mặt khi = 0:** đường xanh phải giữ **nguyên hình dạng cũ** của
  `JobRunResult` (điều kiện nghiệm thu #5) ⇒ ca ALLOW so sánh `toEqual` được, không phải `toMatchObject`
  lỏng lẻo.
- **Lô 1 hàng phát hỏng toàn bộ ⇒ `Failed`** (`success=0`). Đây KHÔNG phải "lời nói dối chiều ngược" ở
  §1.2: run-row lần này mang `metadata.callsMissed=1` + `emitFailed=1` ⇒ đọc được nguyên vẹn "DB xong,
  chuông mất". Nói dối là khi metadata **biến mất cùng exception**.
- Kèm một dòng `logger.error` mang `jobCode` · `companyId` · số cuộc gọi mất sự kiện — theo done_when.

## §5 — Ca test (RED TRƯỚC)

### 5.1 Biên `realtime/` — ghim bất biến "emitChatCall KHÔNG ném" (file MỚI)

`apps/api/src/realtime/realtime-emitter.call.spec.ts` — hôm nay `emitChatCall` có **0 ca**.

| Ca | Kỳ vọng |
| --- | --- |
| DENY-1 `!server` (chưa `setServer`) | KHÔNG ném · `logger.error` · 0 emit |
| DENY-2 payload sai schema (`startedAt` không phải ISO) | KHÔNG ném · `logger.error` · **0 emit** (parse chặn trước) |
| DENY-3 `server.to().emit()` tự ném | KHÔNG ném ra ngoài · `logger.error` |
| DENY-4 `participantUserIds` rỗng | KHÔNG ném · 0 `to()` (bẫy Socket.IO phát cả namespace) |
| **ALLOW** payload hợp lệ + server sẵn sàng | emit **đúng 1 lần**, đích = `chatUserRoomName` của TỪNG người |

⚠️ Ca ALLOW bắt buộc: thiếu nó thì đột biến "`emitChatCall` trả về ngay ở dòng đầu" vẫn xanh cả 4 ca DENY
([[deny-cases-vacuous-without-allow-case]]).

### 5.2 Mỗi job — emit ném KHÔNG làm mất lô còn lại, run-row KHÔNG nói dối (file MỚI)

`apps/api/src/chat/chat-call-emit-guard.spec.ts` — dựng **`ChatCallsService` THẬT** (không fake helper,
nếu không thì guard không được thực thi) + `RealtimeEmitterService` GIẢ có thể ném theo item.

Cho **CẢ HAI** job (bảng ca chạy song song, cùng danh sách — đối xứng là điều kiện):

| Ca | Kỳ vọng |
| --- | --- |
| Lô 3 cuộc gọi, item **giữa** ném | `emitChatCall` được gọi **3 lần** (lô còn lại KHÔNG mất) · `run()` KHÔNG reject |
| ↑ cùng ca | `{total:3, success:2, failed:1, metadata:{callsMissed\|callsAutoEnded:3, emitFailed:1}}` |
| ↑ cùng ca | đúng 1 `logger.error` mang `jobCode` · `companyId` · số cuộc gọi mất |
| **ALLOW** lô 3, không ai ném | `{total:3, success:3, failed:0}` · metadata **KHÔNG** có khoá `emitFailed` (`toEqual`) |
| ALLOW lô rỗng | `{total:0, success:0, failed:0}` · 0 emit |

### 5.3 Ratchet cấu trúc — đối xứng hai job (nối vào `chat-realtime-after-commit.spec.ts`)

- `this.realtime.emitChatCall(` vẫn **đúng 3** trong service (trần cũ, KHÔNG hạ).
- **CẢ HAI** job phải TIÊU THỤ giá trị trả về: `/const emitFailed = this\.calls\.emitExpired\(/` và
  `/const emitFailed = this\.calls\.emitAutoEnded\(/`. Đây là thứ chống tái diễn đúng lý do
  `S10-CHAT-CALLSWEEP-1` hoãn món này: vá một job, quên job kia.
- Lời gọi phát vẫn nằm NGOÀI `withTenant` ở cả hai (giữ assert cũ của job gặt, thêm vế cho ring-timeout).

## §6 — Ngoài phạm vi (đừng "tiện tay")

3 món hoãn còn lại của `S10-CHAT-CALLSWEEP-1` — audit `closedUserIds` vào `newValues` · ca chéo tenant
int-spec · gom lô N+1 (reviewer DB khuyên ĐỪNG làm sớm) — **chưa có số hiệu, chưa có WO**. Không làm ở đây.

## §7 — Verify

```bash
pnpm --filter @mediaos/api test -- chat-call-emit-guard realtime-emitter.call chat-realtime-after-commit
pnpm typecheck && pnpm lint
```

WO này KHÔNG thêm int-spec (mọi ca đều là unit colocated — [[vitest-unit-specs-must-be-colocated]]) nên
không cần lane DB. KHÔNG `source .env` ([[sourcing-dotenv-poisons-test-run-node-env]]).
