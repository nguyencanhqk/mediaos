/**
 * money.ts — số học tiền tệ AN TOÀN cho G13 Finance (BẤT BIẾN tài chính = crown-jewel).
 *
 * Quy ước: nội bộ tính bằng **cents (BigInt)** — KHÔNG dùng float cho phép cộng/chia/làm tròn
 * (IEEE-754 làm `0.1 + 0.2 != 0.3`, dồn sai số khi phân bổ nhiều target). Float CHỈ xuất hiện ở
 * biên DTO (JSON `number`) và được guard `Number.isSafeInteger`.
 *
 * - DB: cột tiền là `numeric(18,2)`; Drizzle trả về **chuỗi** ("1500000.50") → parse thẳng chuỗi → cents
 *   (không qua float). Ghi xuống: cents → chuỗi "1500000.50".
 * - DTO: `amount: z.number()` (client gửi number) → `amountToCents` qua `toFixed(2)` (an toàn trong
 *   khoảng số nguyên JS) → cents.
 */

/** Số chữ số thập phân của tiền (numeric(18,2)). */
const MONEY_SCALE = 2;
const CENTS_PER_UNIT = 100n;

/** Thang nhân trọng số phân bổ → BigInt (giữ tới 6 chữ số thập phân của weight: %/giờ/đếm). */
const WEIGHT_SCALE = 1_000_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Parse một chuỗi numeric ("1500000.50", "-12.3", "42") → cents (BigInt) CHÍNH XÁC, không qua float.
 * Cắt/đệm phần thập phân về đúng 2 chữ số. Ném `MoneyError` nếu định dạng sai.
 */
export function decimalStringToCents(value: string): bigint {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Giá trị tiền không hợp lệ: "${value}"`);
  }
  const [, sign, intPart, fracRaw = ""] = match;
  // Đệm/cắt phần thập phân về đúng MONEY_SCALE chữ số (DB numeric(18,2) đảm bảo ≤2 khi đọc ra).
  const frac = (fracRaw + "0".repeat(MONEY_SCALE)).slice(0, MONEY_SCALE);
  const cents = BigInt(intPart) * CENTS_PER_UNIT + BigInt(frac);
  return sign === "-" ? -cents : cents;
}

/**
 * Đổi `number` (DTO) → cents (BigInt). Dùng `toFixed(2)` để chốt 2dp TRƯỚC khi parse chuỗi →
 * tránh `0.1*100` lỗi nhị phân. Guard số hữu hạn + an toàn số nguyên JS.
 */
export function amountToCents(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Số tiền không hữu hạn: ${value}`);
  }
  if (!Number.isSafeInteger(Math.round(value * 100))) {
    throw new MoneyError(`Số tiền vượt khoảng an toàn: ${value}`);
  }
  return decimalStringToCents(value.toFixed(MONEY_SCALE));
}

/** cents (BigInt) → chuỗi numeric "1500000.50" để INSERT vào cột `numeric(18,2)`. */
export function centsToDbString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const unit = abs / CENTS_PER_UNIT;
  const frac = abs % CENTS_PER_UNIT;
  const fracStr = frac.toString().padStart(MONEY_SCALE, "0");
  return `${neg ? "-" : ""}${unit.toString()}.${fracStr}`;
}

/** cents (BigInt) → `number` cho DTO (biên JSON). Guard an toàn số nguyên JS. */
export function centsToNumber(cents: bigint): number {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError(`cents vượt khoảng an toàn JS number: ${cents.toString()}`);
  }
  return n / 100;
}

/**
 * Phân bổ `total` (cents) theo `weights` (≥0, có thể là số đếm/%/giờ/cents) sao cho
 * SUM(kết quả) === total **đúng tuyệt đối** (BẤT BIẾN phân bổ — không thất thoát/thừa cent).
 *
 * Cơ chế: scale weight → BigInt, mỗi phần = floor(total * w_i / W) (chia nguyên BigInt = làm tròn
 * xuống), **phần dư dồn vào target hiệu lực CUỐI** (weight > 0 cuối cùng — tránh trao cent cho target
 * trọng số 0). Lệch nhẹ so với "đúng phần tử cuối" của plan để KHÔNG vi phạm "0 weight ⇒ 0 tiền".
 *
 * @throws MoneyError nếu tổng trọng số = 0 (caller map → 400).
 */
export function splitCentsByWeights(total: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0) {
    throw new MoneyError("Không có target để phân bổ");
  }
  const scaled = weights.map((w) => {
    if (!Number.isFinite(w) || w < 0) {
      throw new MoneyError(`Trọng số không hợp lệ: ${w}`);
    }
    return BigInt(Math.round(w * WEIGHT_SCALE));
  });
  const totalWeight = scaled.reduce((s, w) => s + w, 0n);
  if (totalWeight <= 0n) {
    throw new MoneyError("Tổng trọng số phân bổ = 0");
  }

  const neg = total < 0n;
  const absTotal = neg ? -total : total;

  const out = scaled.map((w) => (absTotal * w) / totalWeight); // floor từng phần
  const distributed = out.reduce((s, c) => s + c, 0n);
  const remainder = absTotal - distributed; // ≥ 0 (mỗi phần đã floor)

  // Dồn dư vào target hiệu lực CUỐI (weight > 0). Luôn tồn tại vì totalWeight > 0.
  let lastEffective = scaled.length - 1;
  while (lastEffective > 0 && scaled[lastEffective] === 0n) {
    lastEffective -= 1;
  }
  out[lastEffective] += remainder;

  return neg ? out.map((c) => -c) : out;
}

/** Tổng nhiều mảng cents. */
export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((s, c) => s + c, 0n);
}
