/**
 * S7-CHAT-FE-5 🔒 — CHAT-SCREEN-008: **nhật ký đọc-vượt** (`/system/chat-oversight/audit`).
 *
 * SPEC-15 §9 · §18 ("audit không xem được trên UI thì không phải là kiểm soát"). Backend: CHAT-API-019,
 * đã bó `action = 'chat.oversight.read'` AND `module_code = 'CHAT'` — đây KHÔNG phải cổng đọc
 * `audit_logs` toàn hệ thống.
 *
 * ⚠️ Route này KHÔNG sinh dòng audit `Success` (API-13 §5.3): đọc nhật ký không tiết lộ byte nội dung
 * chat nào. Nhưng nó VẪN đi qua `ChatOversightAuditGuard`, nên gọi khi thiếu quyền vẫn để lại `Denied`
 * — thêm một lý do để cổng FE đóng TRƯỚC khi query chạy thay vì để người dùng ăn 403.
 *
 * ⚠️ **BỘ LỌC LÀ CLIENT-SIDE, TRÊN CÁC DÒNG ĐÃ TẢI.** `chatOversightAuditQuerySchema` chỉ nhận
 * `cursor` + `limit` — không có tham số lọc theo người hay khoảng thời gian ở server (đo 04/08/2026).
 * Giao diện PHẢI nói ra điều đó (nhãn "trong N dòng đã tải"): lọc im lặng trên một tập con làm người
 * đọc kết luận "không có lần truy cập nào" trong khi bằng chứng nằm ở trang chưa tải.
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { ScrollText, ShieldAlert } from "lucide-react";
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";
import { Badge, Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { chatOversightApi } from "@mediaos/web-core";
import { useCanChatOversight } from "@/lib/chat-oversight-gate";
import {
  distinctActors,
  filterAuditEntries,
  formatCriteria,
  formatDateTime,
  roomLabel,
  type AuditFilterInput,
} from "./chat-oversight-format";

/** Trần server là 100 (`chatOversightAuditQuerySchema`). */
const AUDIT_PAGE_SIZE = 50;

/** `Success` xanh, phần còn lại đều là chuyện cần chú ý — KHÔNG gộp `Failure`/`Error` vào `Denied`. */
const RESULT_VARIANT: Record<
  ChatOversightAuditEntryDto["resultStatus"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  Success: "default",
  Denied: "destructive",
  Failure: "destructive",
  Error: "destructive",
  Unknown: "outline",
};

const EMPTY_FILTER: AuditFilterInput = { actorUserId: "", from: "", to: "" };

export function ChatOversightAuditPage() {
  const { t } = useTranslation("chat-oversight");
  const canOversight = useCanChatOversight();

  const [filter, setFilter] = useState<AuditFilterInput>(EMPTY_FILTER);

  const audit = useInfiniteQuery({
    queryKey: ["console:chat-oversight:audit"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      chatOversightApi.listAudit({
        limit: AUDIT_PAGE_SIZE,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    // `nextCursor === null` = trang cuối (keyset của server), KHÔNG suy từ độ dài trang.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canOversight,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const loadedRows = useMemo<ChatOversightAuditEntryDto[]>(
    () => (audit.data?.pages ?? []).flatMap((page) => page.data),
    [audit.data],
  );

  const actors = useMemo(() => distinctActors(loadedRows), [loadedRows]);
  const rows = useMemo(() => filterAuditEntries(loadedRows, filter), [loadedRows, filter]);

  const columns = useMemo<ColumnDef<ChatOversightAuditEntryDto>[]>(
    () => [
      {
        id: "createdAt",
        header: t("audit.table.at"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actor",
        header: t("audit.table.actor"),
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {row.original.actorName ?? row.original.actorUserId ?? "—"}
          </span>
        ),
      },
      {
        id: "endpoint",
        header: t("audit.table.endpoint"),
        cell: ({ row }) => (
          <Badge variant="outline">
            {t(`audit.endpoint.${row.original.endpoint ?? "unknown"}`, {
              defaultValue: t("audit.endpoint.unknown"),
            })}
          </Badge>
        ),
      },
      {
        id: "room",
        header: t("audit.table.room"),
        cell: ({ row }) => {
          const entry = row.original;
          // `roomId`/`roomCode` NULL với `018a` (tra danh sách — không có phòng đích) và với dòng
          // `Denied` không mang `:id` trên URL. Đó là dữ liệu ĐÚNG, không phải thiếu.
          if (entry.roomCode === null)
            return <span className="text-sm text-muted-foreground">—</span>;
          return (
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {roomLabel({ name: entry.roomName, roomCode: entry.roomCode })}
              </p>
              <p className="text-xs text-muted-foreground">{entry.roomCode}</p>
            </div>
          );
        },
      },
      {
        id: "resultStatus",
        header: t("audit.table.result"),
        cell: ({ row }) => (
          <Badge variant={RESULT_VARIANT[row.original.resultStatus]}>
            {t(`audit.result.${row.original.resultStatus}`)}
          </Badge>
        ),
      },
      {
        id: "criteria",
        header: t("audit.table.criteria"),
        cell: ({ row }) => {
          const text = formatCriteria(row.original.criteria);
          return <span className="text-xs text-muted-foreground">{text === "" ? "—" : text}</span>;
        },
      },
    ],
    [t],
  );

  if (!canOversight) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ShieldAlert}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader title={t("audit.title")} description={t("audit.subtitle")} icon={ScrollText} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56 space-y-1">
          <label htmlFor="audit-actor" className="text-sm font-medium text-foreground">
            {t("audit.filter.actor")}
          </label>
          <Select
            id="audit-actor"
            value={filter.actorUserId}
            onChange={(e) => setFilter({ ...filter, actorUserId: e.target.value })}
          >
            <option value="">{t("audit.filter.allActors")}</option>
            {actors.map((actor) => (
              <option key={actor.userId} value={actor.userId}>
                {actor.name ?? actor.userId}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-1">
          <label htmlFor="audit-from" className="text-sm font-medium text-foreground">
            {t("audit.filter.from")}
          </label>
          <Input
            id="audit-from"
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          />
        </div>

        <div className="w-44 space-y-1">
          <label htmlFor="audit-to" className="text-sm font-medium text-foreground">
            {t("audit.filter.to")}
          </label>
          <Input
            id="audit-to"
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          />
        </div>

        <Button variant="outline" onClick={() => setFilter(EMPTY_FILTER)}>
          {t("audit.filter.reset")}
        </Button>
      </div>

      {/* Nói THẲNG phạm vi của bộ lọc. Xem docblock đầu file — đây là phần bắt buộc của UI chừng nào
          CHAT-API-019 chưa nhận tham số lọc ở server. */}
      <p role="status" className="text-sm text-muted-foreground">
        {t("audit.scopeNotice", { shown: rows.length, loaded: loadedRows.length })}
        {audit.hasNextPage ? ` ${t("audit.scopeMore")}` : ""}
      </p>

      {audit.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t("audit.error")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={rows}
        isLoading={audit.isPending}
        pageSize={20}
        emptyState={
          <EmptyState
            icon={ScrollText}
            title={t("audit.emptyTitle")}
            description={t("audit.emptyDescription")}
          />
        }
      />

      {audit.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void audit.fetchNextPage()}
            disabled={audit.isFetchingNextPage}
          >
            {audit.isFetchingNextPage ? t("common.loading") : t("audit.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
