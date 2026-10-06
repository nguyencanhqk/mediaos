/**
 * S16-SOCIAL-FE-2C — icon của một huy hiệu vinh danh (plan D9).
 *
 * `icon` là chuỗi QUẢN TRỊ VIÊN nhập (`049/050`, ≤64 ký tự): contract nói tên icon lucide, DB-17 nói
 * «tên icon hoặc emoji» ⇒ nhận cả hai. Map CỐ ĐỊNH tên→component — KHÔNG tra cứu cả namespace
 * `lucide-react` bằng chuỗi tự do (kéo cả bộ icon vào bundle và biến dữ liệu thành đường chọn code).
 * Không khớp / `null` ⇒ `Award`. Emoji vẽ như CHỮ trong `<bdi>` (cô lập hướng chữ — ký tự bidi lẫn
 * trong chuỗi không được đảo tên huy hiệu đứng cạnh).
 *
 * 🔴 Tra bằng `Object.hasOwn`, KHÔNG `BADGE_ICONS[key]` trần (gate LIGHT H1): icon `constructor` trả hàm
 * `Object`, `__proto__` trả `Object.prototype` — cả hai truthy, React render là NÉM, và widget nằm trên
 * rail của MỌI màn `/feed*` ⇒ một huy hiệu quản trị đặt tên như thế làm sập cả cổng cho mọi người.
 */
import type * as React from "react";
import {
  Award,
  GraduationCap,
  Heart,
  HeartHandshake,
  Lightbulb,
  Medal,
  Rocket,
  Sparkles,
  Star,
  Trophy,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@mediaos/ui";

/** Tên seed `0582` (`users-round` · `lightbulb` · `heart-handshake` · `graduation-cap` · `rocket`) + vài tên thông dụng. */
const BADGE_ICONS: Readonly<Record<string, LucideIcon>> = {
  award: Award,
  trophy: Trophy,
  medal: Medal,
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
  "users-round": UsersRound,
  lightbulb: Lightbulb,
  "heart-handshake": HeartHandshake,
  "graduation-cap": GraduationCap,
  rocket: Rocket,
};

/** S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): tên icon mà form huy hiệu cho chọn. Thân thật ở commit GREEN. */
export const KUDOS_BADGE_ICON_NAMES: readonly string[] = [];

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** Trần code point của một «emoji» (gồm ZWJ / biến thể) — dài hơn là chữ, không phải icon. */
const EMOJI_MAX_CODEPOINTS = 8;

interface KudosBadgeIconProps {
  icon: string | null;
  className?: string;
}

export function KudosBadgeIcon({ icon, className }: KudosBadgeIconProps): React.ReactElement {
  const key = icon?.trim() ?? "";
  const lookup = key.toLowerCase();
  const Icon = Object.hasOwn(BADGE_ICONS, lookup) ? BADGE_ICONS[lookup] : undefined;
  if (Icon) {
    return (
      <Icon
        data-testid="kudos-badge-icon"
        className={cn("h-4 w-4", className)}
        aria-hidden="true"
      />
    );
  }
  if (PICTOGRAPHIC.test(key) && [...key].length <= EMOJI_MAX_CODEPOINTS) {
    return (
      <bdi
        data-testid="kudos-badge-emoji"
        aria-hidden="true"
        className={cn("leading-none", className)}
      >
        {key}
      </bdi>
    );
  }
  return (
    <Award
      data-testid="kudos-badge-icon-default"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    />
  );
}
