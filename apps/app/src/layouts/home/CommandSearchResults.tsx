/**
 * S20-FE-CMDKSEARCH-1 — phần kết quả của bảng lệnh Ctrl+K. Thuần trình bày: nhóm nào có mặt trong
 * `groups` là nhóm người dùng được phép đọc (quyết định ở `use-command-search.ts`).
 */
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { CommandGroupKey, CommandSearchGroup, CommandSearchItem } from "./use-command-search";

interface CommandSearchResultsProps {
  term: string;
  groups: CommandSearchGroup[];
  isEmpty: boolean;
  activeId: string | null;
  onSelect: (item: CommandSearchItem) => void;
  onSuggest: (group: CommandGroupKey) => void;
  onHover: (itemId: string) => void;
}

/** Id DOM ổn định cho `aria-activedescendant`. */
export const commandOptionDomId = (item: CommandSearchItem) => `cmdk-${item.group}-${item.id}`;

function ResultRow({
  item,
  active,
  onSelect,
  onHover,
}: {
  item: CommandSearchItem;
  active: boolean;
  onSelect: (item: CommandSearchItem) => void;
  onHover: (itemId: string) => void;
}) {
  const { t } = useTranslation("nav");
  const fallback =
    item.group === "tasks" ? t("commandSearch.untitledTask") : t("commandSearch.unnamedPerson");
  const label = item.label || fallback;
  return (
    <li
      id={commandOptionDomId(item)}
      role="option"
      aria-selected={active}
      onMouseEnter={() => onHover(`${item.group}:${item.id}`)}
      onClick={() => onSelect(item)}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      {item.group === "people" ? (
        <Avatar name={label} src={item.avatarUrl ?? undefined} size="sm" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.sublabel ? (
        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
          {item.sublabel}
        </span>
      ) : null}
    </li>
  );
}

function GroupSection({
  group,
  activeId,
  onSelect,
  onHover,
}: { group: CommandSearchGroup } & Pick<
  CommandSearchResultsProps,
  "activeId" | "onSelect" | "onHover"
>) {
  const { t } = useTranslation("nav");
  return (
    <section aria-label={t(`commandSearch.groups.${group.key}`)} className="mb-3">
      <h3 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t(`commandSearch.groups.${group.key}`)}
      </h3>
      {group.status === "loading" ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("commandSearch.loading")}</p>
      ) : null}
      {group.status === "error" ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {t("commandSearch.error")}
        </p>
      ) : null}
      {group.status === "success" ? (
        <ul role="group">
          {group.items.map((item) => (
            <ResultRow
              key={item.id}
              item={item}
              active={activeId === `${item.group}:${item.id}`}
              onSelect={onSelect}
              onHover={onHover}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CommandSearchResults({
  term,
  groups,
  isEmpty,
  activeId,
  onSelect,
  onSuggest,
  onHover,
}: CommandSearchResultsProps) {
  const { t } = useTranslation("nav");
  return (
    <div role="listbox" aria-label={t("commandSearch.resultsAria")}>
      {isEmpty ? (
        <div className="py-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("commandSearch.noResults", { query: term })}
          </p>
          <div className="mt-2 flex flex-col items-center gap-1">
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => onSuggest(g.key)}
                className="text-xs text-primary hover:underline"
              >
                {t(`commandSearch.suggest.${g.key}`)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            activeId={activeId}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))
      )}
    </div>
  );
}
