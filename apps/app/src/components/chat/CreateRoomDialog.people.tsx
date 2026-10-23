/**
 * S20-CHAT-NEWROOM-1 — ba khối chọn người của `CreateRoomDialog` (US-CHAT-NV-12 · NV-91):
 * dải chip «Gần đây», ô tìm NHÚNG (thay dialog chọn người thứ hai), và danh sách «Đã chọn».
 *
 * ⚠️ Ô tìm gọi ĐÚNG `GET /hr/employees` — endpoint danh bạ sẵn có, SERVER lọc theo data-scope của
 * `read:employee`. Client KHÔNG tự lọc phạm vi và KHÔNG gọi thêm endpoint nào để «tìm hộ» người ngoài
 * phạm vi: NV chỉ có `@Own` gõ tên đồng nghiệp sẽ thấy «Không tìm thấy…» — ngõ cụt có chủ ý tới khi có
 * danh bạ nhẹ (US-CHAT-NV-03). Thứ DUY NHẤT client bỏ khỏi kết quả là chính mình: không ai nhắn riêng
 * với chính mình được (CHAT-ERR-003), và người tạo nhóm đã tự là quản trị phòng.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { hrApi, hrKeys } from "@mediaos/web-core";
import { Avatar, Input, cn } from "@mediaos/ui";
import type { HrEmployeeListItem } from "@mediaos/contracts";
import type { PersonPick, RecentPeer } from "./create-room-people";

const SEARCH_PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 300;

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function RecentPeerChips({
  peers,
  selectedIds,
  disabled,
  onToggle,
}: {
  peers: readonly RecentPeer[];
  selectedIds: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (person: PersonPick) => void;
}): React.ReactElement | null {
  const { t } = useTranslation("chat");
  // Chưa có DM nào ⇒ ẩn hẳn dải, không để một nhãn «Gần đây» treo trên khoảng trống.
  if (peers.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium" id="chat-create-recent-label">
        {t("create.recent.label")}
      </p>
      <div
        role="group"
        aria-labelledby="chat-create-recent-label"
        className="flex flex-wrap gap-1.5"
      >
        {peers.map((peer) => {
          const isPressed = selectedIds.has(peer.userId);
          return (
            <button
              key={peer.userId}
              type="button"
              aria-pressed={isPressed}
              disabled={disabled || !peer.isActive}
              title={
                peer.isActive
                  ? undefined
                  : t("create.recent.inactiveReason", { name: peer.fullName })
              }
              onClick={() => onToggle({ userId: peer.userId, fullName: peer.fullName })}
              data-testid={`chat-create-recent-${peer.userId}`}
              className={cn(
                CHIP_CLASS,
                isPressed
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span>{peer.fullName}</span>
              {!peer.isActive && <span>· {t("create.recent.inactive")}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SelectedPeople({
  people,
  disabled,
  onRemove,
}: {
  people: readonly PersonPick[];
  disabled: boolean;
  onRemove: (person: PersonPick) => void;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">
        {t("create.group.selectedCount", { count: people.length })}
      </p>
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <li
              key={person.userId}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              <span>{person.fullName}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("create.group.removeMember", { name: person.fullName })}
                onClick={() => onRemove(person)}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PeopleSearchProps {
  /** `direct` ⇒ bấm một người là MỞ DM ngay; `group` ⇒ bấm để thêm/bỏ khỏi nhóm. */
  mode: "direct" | "group";
  selectedIds: ReadonlySet<string>;
  myUserId: string | null;
  disabled: boolean;
  /** Drawer: kèm gợi ý «Nhắn riêng từ một phòng chung» khi không có kết quả. */
  showSharedRoomHint: boolean;
  onPick: (person: PersonPick) => void;
}

export function PeopleSearch({
  mode,
  selectedIds,
  myUserId,
  disabled,
  showSharedRoomHint,
  onPick,
}: PeopleSearchProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce — mỗi phím không phải một vòng `GET /hr/employees`.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const params = { page: 1, pageSize: SEARCH_PAGE_SIZE, status: "active" as const, search };
  // Chưa gõ ⇒ KHÔNG gọi: «Gần đây» đã là lối nhanh, nạp sẵn một trang danh bạ chỉ để cuộn là thừa.
  const query = useQuery({
    queryKey: hrKeys.employees.list(params),
    queryFn: () => hrApi.listEmployees(params),
    enabled: search.length > 0,
    staleTime: 30_000,
  });
  const results = (query.data?.items ?? []).filter(
    (e) => e.userId === null || e.userId !== myUserId,
  );

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium" htmlFor={`chat-create-search-${mode}`}>
        {t("create.search.label")}
      </label>
      <Input
        id={`chat-create-search-${mode}`}
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t("create.search.placeholder")}
        className="h-9"
        autoComplete="off"
      />
      {search.length > 0 && (
        <SearchResults
          isLoading={query.isLoading}
          isError={query.isError}
          results={results}
          mode={mode}
          selectedIds={selectedIds}
          disabled={disabled}
          showSharedRoomHint={showSharedRoomHint}
          onPick={onPick}
        />
      )}
    </div>
  );
}

function SearchResults({
  isLoading,
  isError,
  results,
  mode,
  selectedIds,
  disabled,
  showSharedRoomHint,
  onPick,
}: Omit<PeopleSearchProps, "myUserId"> & {
  isLoading: boolean;
  isError: boolean;
  results: readonly HrEmployeeListItem[];
}): React.ReactElement {
  const { t } = useTranslation("chat");
  if (isLoading)
    return <p className="text-xs text-muted-foreground">{t("create.search.loading")}</p>;
  if (isError) return <p className="text-xs text-destructive">{t("create.search.loadError")}</p>;
  if (results.length === 0) {
    return (
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>{t("create.search.notFound")}</p>
        {showSharedRoomHint && <p>{t("create.search.sharedRoomHint")}</p>}
      </div>
    );
  }
  return (
    <ul
      aria-label={t("create.search.resultsLabel")}
      className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1"
    >
      {results.map((e) => {
        const userId = e.userId;
        const fullName = e.fullName ?? e.employeeCode ?? "—";
        const isPressed = userId !== null && selectedIds.has(userId);
        return (
          <li key={e.id}>
            <button
              type="button"
              // Chưa liên kết tài khoản ⇒ không có ai để nhắn: KHOÁ kèm lý do, không gửi `null` xuống server.
              disabled={disabled || userId === null}
              aria-pressed={mode === "group" ? isPressed : undefined}
              onClick={() => {
                if (userId !== null) onPick({ userId, fullName });
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                isPressed && "bg-primary/10",
              )}
            >
              <Avatar name={e.fullName} src={e.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{fullName}</span>
                {e.orgUnitName !== null && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {e.orgUnitName}
                  </span>
                )}
              </span>
              {userId === null && (
                <span className="text-xs text-muted-foreground">
                  {t("create.direct.noAccount")}
                </span>
              )}
              {isPressed && (
                <span className="text-xs text-muted-foreground">{t("create.search.picked")}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
