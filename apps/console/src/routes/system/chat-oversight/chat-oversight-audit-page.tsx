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
 * ⚠️ **BỘ LỌC CHẠY Ở SERVER** (`S7-CHAT-BE-9`): `actorUserId` + `from`/`to` đi thẳng vào CHAT-API-019 và
 * áp trên TOÀN BỘ nhật ký, không phải trên các dòng đã tải. `from`/`to` gửi dạng NGÀY `YYYY-MM-DD` và
 * server quy đổi theo cột `companies.timezone` — client KHÔNG được tự đổi sang mốc UTC, nếu không thì hai
 * người ở hai múi giờ lọc ra hai kết quả khác nhau trên cùng một câu hỏi.
 *
 * ⚠️ Bộ lọc nằm trong `queryKey` ⇒ đổi bộ lọc là một truy vấn MỚI, con trỏ trang cũ không bao giờ bị mang
 * sang. Server còn kiểm lần nữa (con trỏ mang dấu vân bộ lọc; lệch → 400 `CHAT-ERR-016`).
 */
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { ScrollText, ShieldAlert } from "lucide-react";
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";
import { Badge, Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { chatOversightApi } from "@mediaos/web-core";
import { useCanChatOversight } from "@/lib/chat-oversight-gate";
import {
  auditFilterParams,
  distinctActors,
  formatCriteria,
  formatDateTime,
  mergeActorOptions,
  roomLabel,
  type ActorOption,
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
  const params = useMemo(() => auditFilterParams(filter), [filter]);

  /**
   * Khoảng ngày NGƯỢC — chặn ở FE, KHÔNG để nó thành 400.
   *
   * ⚠️ Đây là hồi quy do chính việc chuyển lọc sang server sinh ra: chọn "Đến ngày" trước "Từ ngày" là
   * thao tác rất thường, trước đây chỉ ra bảng rỗng, giờ thành `400` ⇒ banner đỏ "Không tải được nhật ký"
   * — đọc như hệ thống hỏng chứ không phải "bạn chọn ngược hai ô". Server VẪN validate (`.refine` ở
   * `chatOversightAuditQuerySchema`); vế này chỉ để người dùng thấy đúng nguyên nhân, không thay thế nó.
   */
  const isRangeInverted = filter.from !== "" && filter.to !== "" && filter.from > filter.to;

  const audit = useInfiniteQuery({
    // Bộ lọc NẰM TRONG khoá: đổi bộ lọc = truy vấn mới, các trang cũ (và con trỏ của chúng) bị bỏ đi.
    queryKey: ["console:chat-oversight:audit", params],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      chatOversightApi.listAudit({
        limit: AUDIT_PAGE_SIZE,
        ...params,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    // `nextCursor === null` = trang cuối (keyset của server), KHÔNG suy từ độ dài trang.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canOversight && !isRangeInverted,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const rows = useMemo<ChatOversightAuditEntryDto[]>(
    () => (audit.data?.pages ?? []).flatMap((page) => page.data),
    [audit.data],
  );

  /**
   * Option của ô "Người thực hiện" TÍCH LUỸ qua mọi lần tải — xem `mergeActorOptions`. Dựng lại từ
   * `rows` sẽ làm mọi người khác biến mất ngay khi lọc theo một người (server chỉ trả người đó).
   */
  const [actors, setActors] = useState<ActorOption[]>([]);
  useEffect(() => {
    setActors((prev) => mergeActorOptions(prev, distinctActors(rows)));
  }, [rows]);

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
            onChange={(e) => setFilter((prev) => ({ ...prev, actorUserId: e.target.value }))}
          >
            <option value="">{t("audit.filter.allActors")}</option>
            {actors.map((actor) => (
              <option key={actor.userId} value={actor.userId}>
                {actor.name ?? actor.userId}
              </option>
            ))}
          </Select>
          {/* Danh sách GỢI Ý rút từ các dòng đã tải — khác với PHẠM VI LỌC (toàn bộ nhật ký, ở server).
              Hai câu đó không mâu thuẫn, và nói cả hai là cách duy nhất để người dùng không suy ra
              "người này chưa từng đọc-vượt" chỉ vì chưa thấy tên trong ô chọn. */}
          <p className="text-xs text-muted-foreground">{t("audit.filter.actorHint")}</p>
        </div>

        <div className="w-44 space-y-1">
          <label htmlFor="audit-from" className="text-sm font-medium text-foreground">
            {t("audit.filter.from")}
          </label>
          <Input
            id="audit-from"
            type="date"
            value={filter.from}
            onChange={(e) => setFilter((prev) => ({ ...prev, from: e.target.value }))}
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
            onChange={(e) => setFilter((prev) => ({ ...prev, to: e.target.value }))}
          />
        </div>

        <Button variant="outline" onClick={() => setFilter(EMPTY_FILTER)}>
          {t("audit.filter.reset")}
        </Button>
      </div>

      {/* Nói THẲNG phạm vi của bộ lọc — giờ là TOÀN BỘ nhật ký ở server (S7-CHAT-BE-9).
          ⚠️ Giữ lại nhãn "chỉ áp trên các dòng đã tải" sau khi server đã lọc thật là nói SAI theo chiều
          ngược lại: người dùng sẽ tưởng còn bằng chứng chưa được xét và đi tải thêm vô ích. */}
      <p role="status" className="text-sm text-muted-foreground">
        {t("audit.scopeNotice", { loaded: rows.length })}
        {audit.hasNextPage ? ` ${t("audit.scopeMore")}` : ""}
      </p>

      {isRangeInverted && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t("audit.filter.rangeInverted")}
        </p>
      )}

      {audit.isError && !isRangeInverted && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t("audit.error")}
        </p>
      )}

      {/*
        ⚠️ Bộ lọc KHÔNG hợp lệ ⇒ **không render bảng**, chỉ còn banner ở trên. Hai lối kia đều nói dối:
          · `isLoading={audit.isPending}` ⇒ query `enabled:false` chưa có data thì `isPending` TRUE còn
            `isFetching` FALSE (React Query v5: `isLoading = isPending && isFetching`) ⇒ bảng quay 5 hàng
            skeleton VĨNH VIỄN — vẫn là tín hiệu "hệ thống treo", chỉ đổi hình dạng;
          · render bảng rỗng ⇒ empty-state đọc thành "Chưa có lần đọc-vượt nào", tức trả lời một câu hỏi
            mà server CHƯA HỀ được hỏi — đúng loại nói dối mà cả WO này tồn tại để diệt.
        Không có kết quả để hiện thì không hiện chỗ chứa kết quả.
      */}
      {!isRangeInverted && (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={audit.isLoading}
          pageSize={20}
          emptyState={
            <EmptyState
              icon={ScrollText}
              title={t("audit.emptyTitle")}
              description={t("audit.emptyDescription")}
            />
          }
        />
      )}

      {audit.hasNextPage && !isRangeInverted && (
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
