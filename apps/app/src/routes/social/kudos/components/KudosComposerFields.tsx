/**
 * S16-SOCIAL-FE-2C — trường riêng của lời vinh danh trong composer (plan D5 + §8 M-d/L): ô chọn người
 * nhận qua `059` · huy hiệu qua `048` · cờ «chính thức» (`manage:feed-kudos`).
 *
 * Controlled (khuôn `PollComposerFields`): NHÁP (người nhận · huy hiệu · cờ) sống ở `FeedComposer` để luật
 * «không dọn khi chưa resolve» áp cho cả chúng, và để query tìm người đang PENDING (khoá `q` mới chưa có
 * data) không làm mất lựa chọn đã có. Chỉ từ khoá đang gõ là state cục bộ.
 *
 * ┌─ 🔴 CỔNG `059` LÀ SCHEMA, KHÔNG PHẢI `q.length >= 2` ─────────────────────────────────────────────┐
 * │ Server đòi ≥2 CHỮ/SỐ sau chuẩn hoá NFC (`kudosRecipientSearchQuerySchema`). Đếm độ dài chuỗi thì    │
 * │ `"a."` hay dấu tổ hợp lọt đi và ăn 400. Khoá cache dùng `q` ĐÃ chuẩn hoá (đầu ra schema) ⇒ «An» và  │
 * │ «  An » là một khoá. Route gác `create:feed-kudos` (KHÔNG `view:feed`) ⇒ `enabled` gác đúng cặp đó.  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Avatar: CHỈ chữ cái đầu (không `src`) — `avatarUrl` của `059` là cột THÔ, xem `KudosBlock`.
 * Tự vinh danh: server đã loại chính người gọi khỏi `059`; FE không lọc được (auth store không có
 * `employeeId`) — nhánh 422 `KUDOS-SELF-RECIPIENT` hiện qua `ActionErrorBanner` nếu lọt.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Avatar, cn } from "@mediaos/ui";
import { PermissionGate, socialKeys, socialKudosApi, useCan } from "@mediaos/web-core";
import {
  KUDOS_RECIPIENT_MAX,
  kudosRecipientSearchQuerySchema,
  type KudosRecipientCandidateDto,
} from "@mediaos/contracts";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  addKudosRecipient,
  removeKudosRecipient,
  type KudosDraft,
} from "../lib/kudos-draft";

/** Nhịp gõ → gọi `059` (khuôn `LinkUserDialog`). */
export const KUDOS_SEARCH_DEBOUNCE_MS = 300;

interface KudosComposerFieldsProps {
  draft: KudosDraft;
  onChange: (next: KudosDraft) => void;
  disabled?: boolean;
}

export function KudosComposerFields({
  draft,
  onChange,
  disabled = false,
}: KudosComposerFieldsProps): React.ReactElement {
  const { t } = useTranslation("social");
  const canSearch = useCan("create", "feed-kudos");
  const [q, setQ] = React.useState("");
  const debouncedQ = useDebouncedValue(q, KUDOS_SEARCH_DEBOUNCE_MS);

  const parsed = kudosRecipientSearchQuerySchema.safeParse({ q: debouncedQ });
  const searchQ = parsed.success ? parsed.data.q : null;
  const searchQuery = useQuery({
    queryKey: socialKeys.kudos.recipients(searchQ ?? ""),
    queryFn: () => socialKudosApi.searchRecipients(searchQ ?? ""),
    enabled: canSearch && searchQ !== null,
  });

  const badgesQuery = useQuery({
    queryKey: socialKeys.kudos.badges(),
    queryFn: () => socialKudosApi.listBadges(),
  });
  const badges = badgesQuery.data?.data;

  /**
   * §8 M-d — huy hiệu đã chọn KHÔNG còn trong catalog mới (bị tắt; sau lỗi 022 catalog được invalidate)
   * ⇒ bỏ chọn. Không bỏ thì `<select>` hiện «Không gắn» mà nháp vẫn giữ id cũ ⇒ gửi lại ăn 422 lần nữa.
   */
  React.useEffect(() => {
    if (draft.badgeId && badges && !badges.some((b) => b.id === draft.badgeId)) {
      onChange({ ...draft, badgeId: null });
    }
  }, [badges, draft, onChange]);

  const full = draft.recipients.length >= KUDOS_RECIPIENT_MAX;
  const isSelected = (c: KudosRecipientCandidateDto): boolean =>
    draft.recipients.some((r) => r.employeeId.toLowerCase() === c.employeeId.toLowerCase());
  const showHint = q.trim().length > 0 && !kudosRecipientSearchQuerySchema.safeParse({ q }).success;

  return (
    <div data-testid="kudos-composer-fields" className="mb-3 flex flex-col gap-3">
      <div>
        <label htmlFor="kudos-recipient-search" className="text-sm font-medium text-foreground">
          {t("composer.kudos.searchLabel")}
        </label>

        {draft.recipients.length > 0 && (
          <ul aria-label={t("composer.kudos.selectedAria")} className="mt-2 flex flex-wrap gap-2">
            {draft.recipients.map((r) => (
              <li
                key={r.employeeId}
                data-testid="kudos-selected"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-1 text-sm"
              >
                <Avatar name={r.fullName} size="sm" />
                <span>{r.fullName}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(removeKudosRecipient(draft, r.employeeId))}
                  aria-label={t("composer.kudos.remove", { name: r.fullName })}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p data-testid="kudos-selected-count" className="mt-1 text-xs text-muted-foreground">
          {full
            ? t("composer.kudos.full", { max: KUDOS_RECIPIENT_MAX })
            : t("composer.kudos.selectedCount", {
                count: draft.recipients.length,
                max: KUDOS_RECIPIENT_MAX,
              })}
        </p>

        <input
          id="kudos-recipient-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={disabled}
          placeholder={t("composer.kudos.searchPlaceholder")}
          autoComplete="off"
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {showHint && (
          <p data-testid="kudos-search-hint" className="mt-1 text-xs text-muted-foreground">
            {t("composer.kudos.searchHint")}
          </p>
        )}

        {searchQ !== null && canSearch && (
          <RecipientResults
            isLoading={searchQuery.isPending}
            isError={searchQuery.isError}
            candidates={searchQuery.data?.data ?? []}
            truncated={searchQuery.data?.truncated ?? false}
            isSelected={isSelected}
            full={full}
            disabled={disabled}
            onPick={(c) => onChange(addKudosRecipient(draft, c))}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="kudos-badge" className="text-sm text-foreground">
          {t("composer.kudos.badge")}
        </label>
        <select
          id="kudos-badge"
          data-testid="kudos-badge-select"
          value={draft.badgeId ?? ""}
          disabled={disabled || badgesQuery.isPending}
          onChange={(e) => onChange({ ...draft, badgeId: e.target.value || null })}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">
            {badgesQuery.isPending ? t("composer.kudos.badgeLoading") : t("composer.kudos.noBadge")}
          </option>
          {(badges ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {badgesQuery.isError && (
          <p data-testid="kudos-badge-error" className="w-full text-xs text-muted-foreground">
            {t("composer.kudos.badgeError")}
          </p>
        )}
      </div>

      <PermissionGate action="manage" resourceType="feed-kudos">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            data-testid="kudos-official-toggle"
            checked={draft.isOfficial}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, isOfficial: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          {t("composer.kudos.official")}
        </label>
      </PermissionGate>
    </div>
  );
}

interface RecipientResultsProps {
  isLoading: boolean;
  isError: boolean;
  candidates: readonly KudosRecipientCandidateDto[];
  truncated: boolean;
  isSelected: (c: KudosRecipientCandidateDto) => boolean;
  full: boolean;
  disabled: boolean;
  onPick: (c: KudosRecipientCandidateDto) => void;
}

/** Danh sách NÚT thường (không `role=listbox` — listbox với con là button là anti-pattern ARIA). */
function RecipientResults({
  isLoading,
  isError,
  candidates,
  truncated,
  isSelected,
  full,
  disabled,
  onPick,
}: RecipientResultsProps): React.ReactElement {
  const { t } = useTranslation("social");
  if (isLoading) {
    return (
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {t("composer.kudos.searchLoading")}
      </p>
    );
  }
  // Lỗi danh bạ KHÔNG chặn soạn (lời nhắn/huy hiệu vẫn giữ) — chỉ báo và để người dùng gõ lại.
  if (isError) {
    return (
      <p data-testid="kudos-search-error" className="mt-2 text-xs text-destructive">
        {t("composer.kudos.searchError")}
      </p>
    );
  }
  if (candidates.length === 0) {
    return (
      <p data-testid="kudos-search-empty" className="mt-2 text-xs text-muted-foreground">
        {t("composer.kudos.searchEmpty")}
      </p>
    );
  }
  return (
    <div className="mt-2">
      <ul
        aria-label={t("composer.kudos.resultsAria")}
        className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-1"
      >
        {candidates.map((c) => {
          const selected = isSelected(c);
          return (
            <li key={c.employeeId}>
              <button
                type="button"
                data-testid="kudos-candidate"
                aria-pressed={selected}
                disabled={disabled || selected || full}
                onClick={() => onPick(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <Avatar name={c.fullName} size="sm" />
                <span className="min-w-0 flex-1 truncate">{c.fullName}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {truncated && (
        <p data-testid="kudos-search-truncated" className="mt-1 text-xs text-muted-foreground">
          {t("composer.kudos.searchTruncated")}
        </p>
      )}
    </div>
  );
}
