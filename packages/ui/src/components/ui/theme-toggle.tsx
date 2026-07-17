/**
 * ThemeToggle — nút chuyển sáng/tối, mặc định style cho nền chrome navy
 * (topbar là hằng số navy ở cả hai chế độ nên overlay white/10 là chrome-relative).
 * Đặt ở topbar của app/console và góc màn hình auth.
 *
 * Dùng `resolvedTheme` (light/dark thực áp lên UI) để chọn icon/label — KHÔNG dùng `theme` raw
 * (có thể là 'system'), vì nút này chỉ đảo 2 chiều light<->dark (back-compat), độc lập lựa chọn
 * 'system' ở màn Appearance (ME-SCREEN-014).
 */
import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/use-theme";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const label = resolvedTheme === "dark" ? "Chuyển giao diện sáng" : "Chuyển giao diện tối";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-chrome-foreground/80 transition-colors hover:bg-white/10 hover:text-chrome-foreground",
        className,
      )}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4.5 w-4.5" />
      ) : (
        <Moon className="h-4.5 w-4.5" />
      )}
    </button>
  );
}
