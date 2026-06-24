import { BRAND_SPECTRUM } from "@/lib/brand";

/** Số thanh trong dải tín hiệu. */
const BAR_COUNT = 28;

/**
 * Chữ ký trang đăng nhập "Phòng điều khiển": thanh tín hiệu on-air —
 * equalizer phổ màu Funtime nhịp như đồng hồ mức phát sóng.
 *
 * Nhịp/độ cao tất định theo chỉ số (KHÔNG random → render ổn định, dễ test).
 * Trang trí thuần → `aria-hidden`. Reduced-motion: thanh đứng yên (xem index.css).
 */
export function SignalBar() {
  return (
    <div className="signal-track" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const color = BRAND_SPECTRUM[i % BRAND_SPECTRUM.length];
        const height = 18 + ((i * 7) % 38); // 18..56px — răng cưa tất định
        const delay = ((i * 83) % 1200) / 1000; // 0..1.2s lệch pha
        const duration = 0.9 + ((i * 37) % 70) / 100; // 0.9..1.6s
        return (
          <span
            key={i}
            className="signal-bar"
            style={{
              height: `${height}px`,
              color,
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
