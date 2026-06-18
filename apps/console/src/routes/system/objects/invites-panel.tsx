import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Inbox, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInviteDto, UserInviteStatus } from "@mediaos/contracts";
import { Avatar, Badge, Button, DataTable, Dialog, EmptyState, Input } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import { consoleInvitesApi } from "@/lib/invites-api";

/**
 * CS-10 — hàng đợi Mời/Duyệt/Kích hoạt user trong trang Đối tượng.
 *
 * `kind`:
 *   - "activation" → tab "Yêu cầu kích hoạt": lời mời status `pending` (đã gửi email, chờ người dùng accept).
 *   - "approval"   → tab "Chờ duyệt":         lời mời status `accepted` (đã đặt mật khẩu, chờ admin duyệt).
 *
 * Gate (server ép, client mirror): invite:user (nút Mời), approve:user (xem + duyệt/từ chối).
 */

type InviteKind = "activation" | "approval";

const STATUS_VARIANT: Record<UserInviteStatus, "warning" | "brand" | "success" | "danger"> = {
  pending: "warning",
  accepted: "brand",
  approved: "success",
  rejected: "danger",
};

const QUEUE_KEY = ["console:invites"] as const;

interface InvitesPanelProps {
  kind: InviteKind;
}

export function InvitesPanel({ kind }: InvitesPanelProps) {
  const { t } = useTranslation("invites");
  const qc = useQueryClient();

  const canApprove = useCan("approve", "user");
  const canInvite = useCan("invite", "user");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => consoleInvitesApi.listPending(),
    enabled: canApprove,
  });

  const wantStatus: UserInviteStatus = kind === "activation" ? "pending" : "accepted";
  const rows = useMemo(
    () => (data?.invites ?? []).filter((inv) => inv.status === wantStatus),
    [data, wantStatus],
  );

  const approveMutation = useMutation({
    mutationFn: (id: string) => consoleInvitesApi.approve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => consoleInvitesApi.reject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const inviteMutation = useMutation({
    mutationFn: () => consoleInvitesApi.invite({ email: email.trim(), fullName: fullName.trim() }),
    onSuccess: (res) => {
      setInviteOpen(false);
      setFullName("");
      setEmail("");
      setInviteError(null);
      setInviteNotice(
        res.emailSent ? t("inviteDialog.emailSentOk") : t("inviteDialog.emailSentFail"),
      );
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
    onError: (err: unknown) => {
      setInviteError(err instanceof Error ? err.message : "Unknown error");
    },
  });

  const columns = useMemo<ColumnDef<UserInviteDto>[]>(
    () => [
      {
        id: "name",
        header: t("table.name"),
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={inv.fullName || inv.email} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{inv.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{inv.email}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: t("table.status"),
        cell: ({ getValue }) => {
          const status = getValue() as UserInviteStatus;
          return <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
        },
      },
      {
        accessorKey: "expiresAt",
        header: t("table.expiresAt"),
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(getValue() as string).toLocaleDateString("vi-VN")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {kind === "approval" && (
              <Button
                size="sm"
                onClick={() => approveMutation.mutate(row.original.id)}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? t("actions.approving") : t("actions.approve")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => rejectMutation.mutate(row.original.id)}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? t("actions.rejecting") : t("actions.reject")}
            </Button>
          </div>
        ),
      },
    ],
    [t, kind, approveMutation, rejectMutation],
  );

  if (!canApprove) {
    return (
      <EmptyState
        icon={Inbox}
        title={t("noPermission.title")}
        description={t("noPermission.description")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — nút Mời (gate invite:user) */}
      <div className="flex items-center justify-between gap-3">
        {inviteNotice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {inviteNotice}
          </p>
        ) : (
          <span />
        )}
        {canInvite && (
          <Button
            onClick={() => {
              setInviteOpen(true);
              setInviteError(null);
              setInviteNotice(null);
            }}
          >
            <UserPlus className="h-4 w-4" />
            {t("actions.invite")}
          </Button>
        )}
      </div>

      {isError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive"
        >
          {t("error.loadFailed")}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={Inbox}
              title={t(`empty.${kind}.title`)}
              description={t(`empty.${kind}.description`)}
            />
          }
        />
      )}

      {/* Mời dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteError(null);
        }}
        title={t("inviteDialog.title")}
        description={t("inviteDialog.description")}
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {t("inviteDialog.cancel")}
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !fullName.trim() || !email.trim()}
            >
              {inviteMutation.isPending ? t("inviteDialog.submitting") : t("inviteDialog.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("inviteDialog.fieldFullName")}
            </label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nguyễn Văn A"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("inviteDialog.fieldEmail")}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nva@company.com"
            />
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">
              {t("inviteDialog.errorPrefix")} {inviteError}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
