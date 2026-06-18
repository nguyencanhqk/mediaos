import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/** Bảng màu logo Funtime Media (lấy từ logo gốc). */
const C = {
  blue: "#1FA9E0",
  green: "#36A94E",
  yellow: "#F5B50C",
  red: "#E8482E",
} as const;

/**
 * Logo-mark "quả cầu 4 màu" — tái tạo bằng SVG (xấp xỉ logo Funtime Media):
 * lá xanh-lá bên trái + 3 dải (xanh dương / vàng / đỏ) bên phải, ngăn bởi khe trắng.
 * Nếu BRAND.markSrc được điền (file thật), dùng ảnh thay SVG.
 */
export function BrandMark({ className }: { className?: string }) {
  if (BRAND.markSrc) {
    return <img src={BRAND.markSrc} alt={BRAND.name} className={cn("object-contain", className)} />;
  }
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={BRAND.name}>
      <defs>
        <clipPath id="fmc-ball">
          <circle cx="50" cy="50" r="47" />
        </clipPath>
      </defs>
      <g clipPath="url(#fmc-ball)">
        {/* 3 dải ngang bên phải (sẽ bị clip tròn) */}
        <rect x="0" y="3" width="100" height="29" fill={C.blue} />
        <rect x="0" y="34.5" width="100" height="28" fill={C.yellow} />
        <rect x="0" y="65" width="100" height="32" fill={C.red} />
        {/* Khe trắng giữa các dải */}
        <rect x="0" y="31" width="100" height="3.5" fill="#fff" />
        <rect x="0" y="62" width="100" height="3" fill="#fff" />
        {/* Lá xanh-lá bên trái + viền trắng tạo khe */}
        <path
          d="M58 5 C 16 27, 16 73, 58 95 C 31 70, 31 30, 58 5 Z"
          fill={C.green}
          stroke="#fff"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** Wordmark chữ với gradient cầu vồng (dùng class .brand-gradient-text từ index.css). */
export function BrandWordmark({
  text = BRAND.name,
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <span className={cn("brand-gradient-text font-semibold tracking-tight", className)}>{text}</span>
  );
}

/**
 * Logo đầy đủ: mark + wordmark. Dùng ở app-shell, launcher.
 * `mode="full"` cho ảnh logo thật nếu BRAND.logoSrc được điền.
 */
export function BrandLogo({
  size = "md",
  showWordmark = true,
  wordmarkText,
  wordmarkClassName,
  className,
}: {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  wordmarkText?: string;
  wordmarkClassName?: string;
  className?: string;
}) {
  if (BRAND.logoSrc) {
    return <img src={BRAND.logoSrc} alt={BRAND.name} className={cn("object-contain", className)} />;
  }

  const markSize = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-8 w-8";
  const textSize = size === "sm" ? "text-sm" : size === "lg" ? "text-2xl" : "text-[15px]";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={cn("shrink-0 drop-shadow-sm", markSize)} />
      {showWordmark && (
        <BrandWordmark text={wordmarkText} className={cn(textSize, wordmarkClassName)} />
      )}
    </span>
  );
}
