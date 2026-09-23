/**
 * S16-SOCIAL-FE-1 — ô tìm kiếm của cổng thông tin (SOCIAL-API-023).
 *
 * ⚠️ **Đặt trong header của `PortalLayout`, KHÔNG phải `GlobalTopbar`** (plan finding #8). Nhét vào
 * topbar toàn cục là thêm một thay đổi cho 13 module không liên quan, đổi lấy đúng một tính năng của
 * SOCIAL — hồi quy tiềm năng ở mọi màn, lợi ích ở một màn.
 *
 * Gate `view:feed`: không có ⇒ **ô không render** (ca **C24** vế deny). Người không xem được bảng tin
 * thì một ô tìm kiếm bảng tin chỉ là một cái bẫy 403.
 *
 * ⚠️ Kết quả sắp theo «Hoạt động mới», **không** theo điểm liên quan — contracts nói rõ vì sao
 * (`searchFeedQuerySchema`: trộn `ts_rank` vào keyset cần một cột mốc ổn định mà điểm số không có).
 * Vì vậy UI **không được** hứa "kết quả liên quan nhất".
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { cn } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";

interface FeedSearchBoxProps {
  /** Từ khoá hiện tại (đến từ URL search — nguồn sự thật, không phải state nội bộ). */
  value: string;
  onSubmit: (q: string) => void;
  onClear: () => void;
  className?: string;
}

export function FeedSearchBox({
  value,
  onSubmit,
  onClear,
  className,
}: FeedSearchBoxProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const canViewFeed = useCan("view", "feed");
  const [draft, setDraft] = React.useState(value);

  // URL đổi từ ngoài (back/forward, bấm một thẻ) ⇒ ô phải theo. Nguồn sự thật là URL, không phải ô.
  React.useEffect(() => setDraft(value), [value]);

  if (!canViewFeed) return null;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const q = draft.trim();
    // Rỗng ⇒ coi như xoá bộ lọc, KHÔNG gọi `023` với `q=""` (schema đòi `min(1)` ⇒ 400 vô danh).
    if (q.length === 0) {
      onClear();
      return;
    }
    onSubmit(q);
  };

  return (
    <form
      role="search"
      onSubmit={submit}
      aria-label={t("search.aria")}
      data-testid="feed-search-box"
      className={cn("flex items-center gap-2", className)}
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.aria")}
          className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onClear();
            }}
            aria-label={t("search.clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
