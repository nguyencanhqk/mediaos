# S7-CALL-QA-1 — bằng chứng coverage vùng CALL (API)

Đo 11/08/2026 trên DB cô lập `mediaos_s7callqa1` (214 migration; `chat_calls` +
`chat_call_participants` xác nhận có mặt). Lệnh tái lập:

```bash
bash scripts/lane-db-setup.sh s7callqa1 --reset
source scripts/lib/db-secrets.sh && db_secrets_load     # BẮT BUỘC — thiếu ⇒ "Startup Error: THIẾU APP_DB_PASSWORD"
export LANE_DB=mediaos_s7callqa1
pnpm --filter @mediaos/api test:cov:call
```

**Kết quả: 131/131 pass · 7 tệp.**

## 1. Trước ⇄ sau

| File | % Stmts | % Branch | % Funcs |
| --- | --- | --- | --- |
| `src/realtime/call-signalling.filter.ts` | 21.73 → **100** | — → **100** | 50 → **100** |
| `src/realtime/call-signalling.gateway.ts` | 82.34 → **100** | **68.67 → 92.74** | 100 → **100** |
| `src/realtime/call-signalling-violation.writer.ts` | 100 → 100 | 100 → 100 | 100 → 100 |
| **`realtime/` (3 tệp)** | 80.49 → **100** | 70.11 → **93.47** | 96.15 → **100** |
| **`chat/` (9 tệp)** | 98.66 → 98.66 | 94.85 → 94.85 | 100 → 100 |
| **Toàn cụm CALL/API** | 92.3 → **99.13** | 87.7 → **94.31** | 98.85 → **100** |

`done_when` #3 ("≥80% vùng CALL, **gateway signalling cao hơn**") — ĐẠT:

- gateway branch **92.74** ≥ 80 (ngưỡng riêng), lines/stmts/funcs **100**;
- filter **100** cả bốn trục;
- cụm CALL/API **99.13 / 94.31** ≥ 90.

⚠️ `% Funcs` **không** phải thước đo của WO này. Trước WO nó đã là 98.85 trong khi branch chỉ 68.67 —
mọi hàm đều được gọi ít nhất một lần, nhưng nhánh TỪ CHỐI bên trong chúng thì không
(memory `deny-cases-vacuous-without-allow-case`). Con số phải đọc là **% Branch**.

## 2. Cưỡng chế (§3.3 của plan)

- Script: `apps/api/package.json` → `test:cov:call`.
- Ngưỡng per-file: `apps/api/vitest.config.ts` → `call-signalling.gateway.ts` (lines/stmts/funcs 90,
  **branches 80**) · `call-signalling.filter.ts` (**100** cả bốn).
- **Đã kiểm gate CẮN THẬT** (không chỉ "chạy xong exit 0"): tạm nâng `branches` của gateway lên 99 ⇒
  `pnpm run test:cov:call` **exit 1**; trả về 80 ⇒ exit 0.
- 🔴 **Đây là ratchet chạy TAY, KHÔNG phải cổng CI.** `grep -rn coverage .github/workflows/` = **0 hit**;
  không job nào gọi `test:cov*`. Nó chặn được người cố ý đo, không chặn được PR của người không đo.
- 🔴 Điều kiện để threshold không cắn NHẦM: **không job nào được chạy `--coverage` thiếu
  `--coverage.include`** — đó là kịch bản duy nhất kéo gateway vào report ở một lần chạy không có
  `LANE_DB` (int-spec skip) ⇒ branch tụt dưới 80 ⇒ ĐỎ OAN.

## 3. Ca đã thêm — 25

**int** — `apps/api/test/integration/chat-s7-call-rt1-signalling.int-spec.ts` (18 → 31 ca):
A1 · B1 · B2 · B2b · B3 · B6 · C1 · C3 · C4 · C4b · C5 · C6 · D5 · D6.

**unit colocated** — `src/realtime/call-signalling.filter.spec.ts` (MỚI, 6 ca) ·
`src/realtime/call-signalling.gateway.spec.ts` (3 → 22 ca): B4 · B4b · B5 · B6-unit · C2 · D1×3 · D2 ·
D3 · D4 · D4b · D4c · D4d · D6-unit.

6 ca bắt buộc phải là unit vì int **không dựng được**: `permissions.can` không bao giờ ném
(`permission.service.ts:272-284` bọc try/catch) · `state` luôn có trước `next()` · cần 31 handshake /
361 khung để chạm trần · `violations.record` là singleton dùng chung · cần `this.server.emit` ném.

## 4. Hai tripwire đang canh lỗ CÒN MỞ trên master

| Ca | Lỗ | WO vá |
| --- | --- | --- |
| C2 (unit, gateway spec) | fail-OPEN: `disconnect()` trong middleware handshake là no-op ⇒ token hết hạn vẫn được NHẬN | `S7-CALL-RT-FIX-1` |
| C5 (int) | gỡ thành viên giữa cuộc gọi: vẫn relay TỚI họ, đồng thời ghi sự kiện an ninh + NGẮT họ | `S7-CALL-RT-FIX-2` |

Cả hai là **characterization test** (KHÔNG dùng `it.fails` — `it.fails` xanh khi thân bài ném vì bất kỳ
lý do gì, kể cả sau khi bản vá land ⇒ tripwire không bao giờ nổ). Khi bản vá land, chúng ĐỎ ⇒ lật thành
hành vi đúng trong CÙNG PR.
