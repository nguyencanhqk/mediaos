/**
 * S2-AUTH-ROLEMEM-1 — tab "Thành viên" trong RoleDetailPage.
 *
 * Đọc: GET /auth/roles/:id/members (gate BE view:user — tab ẩn banner forbidden khi thiếu).
 * Gỡ / thêm member: TÁI DÙNG POST/DELETE /permissions/users/:userId/roles (assign-role:user
 * isSensitive — audit + SoD ở server, KHÔNG mở mutation surface mới). Nút mutation bọc
 * PermissionGate assign-role:user; server vẫn là cổng cuối (403 từng dòng khi bị chặn, vd tự gán).
 *
 * "Thêm người": EmployeeMultiPickerDialog dùng chung (benchmark Base/AMIS — search server + lọc
 * phòng ban + phân trang + multi-select như Task/HR). Chỉ gán được nhân viên ĐÃ link tài khoản;
 * hàng đã giữ vai trò / chưa có tài khoản bị khóa với badge riêng.
 *
 * "Thêm theo phòng ban": org tree → GET /hr/employees?orgUnitId → chỉ gán nhân viên ĐÃ link tài
 * khoản (userId ≠ null) và CHƯA là member; gọi TUẦN TỰ từng người, báo kết quả từng dòng.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UserPlus, Building2, Briefcase } from "lucide-react";
import {
  authKeys,
  authUsersApi,
  hrApi,
  orgApi,
  roleAdminApi,
  useAuthStore,
  useCan,
  ApiError,
  PermissionGate,
  type OrgTreeNode,
} from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, Dialog, EmptyState } from "@mediaos/ui";
import { EmployeeMultiPickerDialog } from "../../../components/EmployeeMultiPickerDialog";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

/** Kết quả 1 dòng trong batch gán (dialog thêm người / thêm phòng ban). */
interface BatchResult {
  id: string;
  label: string;
  kind: "ok" | "error";
  detail?: string;
}

function assignErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("roleMembers.errors.forbiddenRow");
    if (err.status === 404) return t("roleMembers.errors.notFound");
    if (err.status === 409) return t("roleMembers.errors.conflict");
    if (err.status >= 500) return t("users.form.errors.server");
  }
  return t("users.form.errors.generic");
}

/** Flatten cây org thành option list thụt lề theo depth (select đơn giản, không thêm dependency). */
function flattenOrgTree(nodes: OrgTreeNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${"— ".repeat(depth)}${n.name}` },
    ...flattenOrgTree(n.children, depth + 1),
  ]);
}

interface RoleMembersTabProps {
  roleId: string;
}

export function RoleMembersTab({ roleId }: RoleMembersTabProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const canViewUser = useCan(
    SYSTEM_ENGINE_PAIRS.READ_USER.action,
    SYSTEM_ENGINE_PAIRS.READ_USER.resourceType,
  );

  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [addOrgOpen, setAddOrgOpen] = useState(false);
  const [addPositionOpen, setAddPositionOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; email: string } | null>(
    null,
  );

  const membersQuery = useQuery({
    queryKey: authKeys.roles.members(roleId),
    queryFn: () => roleAdminApi.getMembers(roleId),
    enabled: canViewUser,
    staleTime: 15_000,
  });
  const members = membersQuery.data?.members ?? [];
  /**
   * S10-SEC-ROLEMEMBERFE-1 (KI-073, D4/D5): `complete` do SERVER phát — "danh sách trên là TOÀN BỘ
   * thành viên hay chỉ phần trong scope của tôi". `complete === false` ⇒ `memberIds` là TẬP CON
   * không biết thiếu bao nhiêu ⇒ mọi khẳng định dựng trên nó (bộ đếm · badge "đã là thành viên" ·
   * dedup preview · empty-state) phải đổi sang câu KHÔNG nói dối. Đọc qua ĐÚNG MỘT chỗ này; khi chưa
   * có data (loading) giữ true để không nháy nhãn partial oan.
   */
  const complete = membersQuery.data ? membersQuery.data.complete : true;
  const myUserId = useAuthStore((s) => s.user?.id);
  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: authKeys.roles.members(roleId) });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => authUsersApi.revokeRole(userId, roleId),
    onSuccess: () => {
      setConfirmRemove(null);
      void invalidateMembers();
    },
  });

  if (!canViewUser) {
    return (
      <EmptyState
        title={t("roleMembers.forbidden.title")}
        description={t("roleMembers.forbidden.description")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {/* KI-073 D5: ngoài scope Company thì "N thành viên đang giữ vai trò này" là lời nói dối
              theo chiều thiếu — nhãn partial nói đúng điều FE biết. */}
          {complete
            ? t("roleMembers.count", { count: members.length })
            : t("roleMembers.countPartial", { count: members.length })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void membersQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {tc("actions.retry")}
          </Button>
          <PermissionGate
            action={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.action}
            resourceType={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.resourceType}
          >
            <Button variant="outline" size="sm" onClick={() => setAddPersonOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              {t("roleMembers.actions.addPerson")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddOrgOpen(true)}>
              <Building2 className="mr-2 h-4 w-4" />
              {t("roleMembers.actions.addOrgUnit")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddPositionOpen(true)}>
              <Briefcase className="mr-2 h-4 w-4" />
              {t("roleMembers.actions.addPosition")}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {membersQuery.isLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      ) : membersQuery.isError ? (
        <EmptyState
          title={t("roleMembers.error.title")}
          description={t("roleMembers.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void membersQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      ) : members.length === 0 ? (
        // KI-073 D5 (hàng 5): với `view:user@Own` không có chân trong role, 0 hàng là trạng thái
        // MẶC ĐỊNH (ngữ nghĩa KI-071) — "Chưa có thành viên" ở đó là khẳng định sai về CẢ role.
        complete ? (
          <EmptyState
            title={t("roleMembers.empty.title")}
            description={t("roleMembers.empty.description")}
          />
        ) : (
          <EmptyState
            title={t("roleMembers.emptyPartial.title")}
            description={t("roleMembers.emptyPartial.description")}
          />
        )
      ) : (
        <Card>
          <CardContent className="divide-y divide-border pt-4">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  {/*
                    S6-SEC-IDENTITY-PROJ-1 (KI-053): `email`/`fullName` nay `.optional()` — server BỎ
                    HẲN KHOÁ khi actor ngoài `data_scope` của cặp danh bạ `view:user`.

                    Fallback phải NÓI RA LÝ DO, không phải rơi về `userId`: một UUID đứng ở ô "tên
                    nhân viên" đọc thành lỗi join/hiển thị chứ không thành "phân quyền đang làm đúng
                    việc" — trống và-khó-hiểu cũng tệ ngang nhau khi đi chẩn.
                  */}
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.fullName ?? m.email ?? (
                      <span className="italic text-muted-foreground">
                        {t("roleMembers.identityHidden")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email ?? "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={m.status === "active" ? "success" : "warning"}>{m.status}</Badge>
                  {m.expiresAt && (
                    <span className="text-xs text-muted-foreground">
                      {t("roleMembers.expiresAt", {
                        date: new Date(m.expiresAt).toLocaleDateString("vi-VN"),
                      })}
                    </span>
                  )}
                  <PermissionGate
                    action={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.action}
                    resourceType={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.resourceType}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setConfirmRemove({ userId: m.userId, email: m.email ?? m.userId })
                      }
                    >
                      {t("roleMembers.actions.remove")}
                    </Button>
                  </PermissionGate>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Confirm gỡ member ── */}
      <Dialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title={t("roleMembers.removeConfirm.title")}
        description={t("roleMembers.removeConfirm.description", {
          email: confirmRemove?.email ?? "",
        })}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={removeMutation.isPending}
              onClick={() => confirmRemove && removeMutation.mutate(confirmRemove.userId)}
            >
              {t("roleMembers.actions.remove")}
            </Button>
          </>
        }
      >
        {removeMutation.isError && (
          <p className="text-sm text-destructive">{assignErrorMessage(removeMutation.error, t)}</p>
        )}
      </Dialog>

      {addPersonOpen && (
        <AddPersonDialog
          onClose={() => setAddPersonOpen(false)}
          roleId={roleId}
          memberIds={memberIds}
          complete={complete}
          myUserId={myUserId}
          onDone={() => void invalidateMembers()}
        />
      )}
      <AddOrgUnitDialog
        open={addOrgOpen}
        onClose={() => setAddOrgOpen(false)}
        roleId={roleId}
        memberIds={memberIds}
        complete={complete}
        myUserId={myUserId}
        onDone={() => void invalidateMembers()}
      />
      <AddPositionDialog
        open={addPositionOpen}
        onClose={() => setAddPositionOpen(false)}
        roleId={roleId}
        memberIds={memberIds}
        complete={complete}
        myUserId={myUserId}
        onDone={() => void invalidateMembers()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch runner dùng chung: gán TUẦN TỰ từng user (server audit/SoD per-request).
// ---------------------------------------------------------------------------
function useAssignBatch(roleId: string, t: TF, onDone: () => void) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);

  const run = async (targets: Array<{ userId: string; label: string }>) => {
    setRunning(true);
    setResults([]);
    const out: BatchResult[] = [];
    for (const target of targets) {
      try {
        await authUsersApi.assignRole(target.userId, { roleId });
        out.push({ id: target.userId, label: target.label, kind: "ok" });
      } catch (err) {
        out.push({
          id: target.userId,
          label: target.label,
          kind: "error",
          detail: assignErrorMessage(err, t),
        });
      }
      setResults([...out]);
    }
    setRunning(false);
    onDone();
  };

  const reset = () => setResults([]);
  return { running, results, run, reset };
}

function BatchResultList({ results }: { results: BatchResult[] }) {
  const { t } = useTranslation("system");
  if (results.length === 0) return null;
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
      {results.map((r) => (
        <li
          key={r.id}
          className={r.kind === "error" ? "text-destructive" : "text-muted-foreground"}
        >
          {r.kind === "ok"
            ? t("roleMembers.batch.ok", { label: r.label })
            : t("roleMembers.batch.error", { label: r.label, detail: r.detail })}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Dialog "Thêm người" — wrapper mỏng của EmployeeMultiPickerDialog (components/), cùng bảng chọn
// với Task/HR. Phần riêng của vai trò: chỉ gán được nhân viên ĐÃ link tài khoản (userId ≠ null);
// hàng đã giữ vai trò hoặc chưa có tài khoản bị khóa với badge phân biệt.
// ---------------------------------------------------------------------------
interface AddDialogProps {
  open: boolean;
  onClose: () => void;
  roleId: string;
  memberIds: ReadonlySet<string>;
  /** KI-073 D4: `memberIds` có phải TOÀN BỘ thành viên không — false ⇒ tắt mọi dedup dựa trên nó. */
  complete: boolean;
  /** KI-073 D5: dedup CHÍNH MÌNH không cần scope (SoD — server chặn self-assign 403 từng dòng). */
  myUserId: string | undefined;
  onDone: () => void;
}

function AddPersonDialog({
  onClose,
  roleId,
  memberIds,
  complete,
  onDone,
}: Omit<AddDialogProps, "open">) {
  const { t } = useTranslation("system");

  return (
    <EmployeeMultiPickerDialog
      title={t("roleMembers.addPerson.title")}
      description={t("roleMembers.addPerson.description")}
      // KI-073 D5: `complete === false` ⇒ CHỈ tắt vế dedup theo `memberIds` (tập con — khoá theo nó
      // là khoá NHẦM hướng), GIỮ NGUYÊN vế `userId === null` + badge noAccount: gỡ cả cụm thì
      // onAddOne reject "employee-not-linked" từng dòng, lỗi không giải thích được. Server no-op
      // xử lý đúng người đã là thành viên (D2 — thân không phân biệt).
      isRowDisabled={(e) => e.userId === null || (complete && memberIds.has(e.userId))}
      disabledBadge={(e) =>
        e.userId === null
          ? t("roleMembers.addPerson.noAccount")
          : t("roleMembers.addPerson.alreadyMember")
      }
      disabledRowChecked={(e) => complete && e.userId !== null && memberIds.has(e.userId)}
      onAddOne={(e) => {
        // Hàng chưa link tài khoản đã bị khóa chọn — guard giữ type an toàn.
        if (e.userId === null) return Promise.reject(new Error("employee-not-linked"));
        return authUsersApi.assignRole(e.userId, { roleId });
      }}
      onBatchSettled={onDone}
      onClose={onClose}
      testIdPrefix="role-member-picker"
    />
  );
}

// ---------------------------------------------------------------------------
// Dialog "Thêm theo phòng ban" — org tree → nhân viên có tài khoản, chưa là member.
// ---------------------------------------------------------------------------
function AddOrgUnitDialog({
  open,
  onClose,
  roleId,
  memberIds,
  complete,
  myUserId,
  onDone,
}: AddDialogProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const [orgUnitId, setOrgUnitId] = useState("");
  const batch = useAssignBatch(roleId, t, onDone);

  const treeQuery = useQuery({
    queryKey: ["org", "units", "tree", "role-member-picker"],
    queryFn: () => orgApi.getTree(),
    enabled: open,
    staleTime: 60_000,
  });
  const options = useMemo(() => flattenOrgTree(treeQuery.data ?? []), [treeQuery.data]);

  const employeesQuery = useQuery({
    queryKey: ["hr", "employees", "role-member-picker", orgUnitId],
    queryFn: () => hrApi.listEmployees({ orgUnitId, pageSize: 100 }),
    enabled: open && orgUnitId !== "",
    staleTime: 10_000,
  });
  const employees = employeesQuery.data?.items ?? [];
  const linked = employees.filter((e) => e.userId !== null);
  // KI-073 D5: `complete === false` ⇒ dedup theo `memberIds` TẮT (nó là tập con — lọc theo nó là
  // POST THIẾU người), server no-op xử lý đúng người đã là thành viên (D2). Vẫn TRỪ CHÍNH MÌNH:
  // self-assign nổ SoD 403 từng dòng thành dòng đỏ khó hiểu, và `myUserId` là bit FE luôn biết.
  const toAssign = complete
    ? linked.filter((e) => !memberIds.has(e.userId as string))
    : linked.filter((e) => e.userId !== myUserId);
  const alreadyMembers = complete ? linked.length - toAssign.length : 0;
  const unlinked = employees.length - linked.length;

  const close = () => {
    setOrgUnitId("");
    batch.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("roleMembers.addOrgUnit.title")}
      description={t("roleMembers.addOrgUnit.description")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close}>
            {tc("actions.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={toAssign.length === 0 || batch.running}
            onClick={() =>
              void batch.run(
                toAssign.map((e) => ({
                  userId: e.userId as string,
                  label: e.fullName ?? e.email ?? e.id,
                })),
              )
            }
          >
            {batch.running
              ? t("roleMembers.batch.running")
              : t("roleMembers.addOrgUnit.submit", { count: toAssign.length })}
          </Button>
        </>
      }
    >
      {treeQuery.isLoading ? (
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      ) : (
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={orgUnitId}
          onChange={(e) => setOrgUnitId(e.target.value)}
          aria-label={t("roleMembers.addOrgUnit.selectLabel")}
        >
          <option value="">{t("roleMembers.addOrgUnit.selectPlaceholder")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {orgUnitId !== "" &&
        (employeesQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("roleMembers.addOrgUnit.preview.toAssign", { count: toAssign.length })}</p>
            {/* KI-073 D5: dòng "Bỏ qua (đã là thành viên)" là khẳng định FE không đủ dữ liệu để đưa
                ra khi complete=false — thay bằng dòng nói rõ giới hạn phạm vi (khoá dùng chung cho
                CẢ dialog phòng ban lẫn chức vụ). */}
            {complete ? (
              alreadyMembers > 0 && (
                <p>
                  {t("roleMembers.addOrgUnit.preview.alreadyMembers", { count: alreadyMembers })}
                </p>
              )
            ) : (
              <p>{t("roleMembers.addOrgUnit.preview.dedupUnavailable")}</p>
            )}
            {unlinked > 0 && (
              <p>{t("roleMembers.addOrgUnit.preview.unlinked", { count: unlinked })}</p>
            )}
            {employees.length >= 100 && (
              <p className="text-warning">{t("roleMembers.addOrgUnit.preview.pageCap")}</p>
            )}
          </div>
        ))}
      <BatchResultList results={batch.results} />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog "Thêm theo chức vụ" — chọn position → nhân viên giữ chức vụ, có tài khoản, chưa là member.
// BE lọc GET /hr/employees?positionId (employees.repository conditions). Mirror AddOrgUnitDialog.
// ---------------------------------------------------------------------------
function AddPositionDialog({
  open,
  onClose,
  roleId,
  memberIds,
  complete,
  myUserId,
  onDone,
}: AddDialogProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const [positionId, setPositionId] = useState("");
  const batch = useAssignBatch(roleId, t, onDone);

  const positionsQuery = useQuery({
    queryKey: ["hr", "positions", "role-member-picker"],
    queryFn: () => hrApi.listPositions(),
    enabled: open,
    staleTime: 60_000,
  });
  const positions = positionsQuery.data ?? [];

  const employeesQuery = useQuery({
    queryKey: ["hr", "employees", "role-member-picker-position", positionId],
    queryFn: () => hrApi.listEmployees({ positionId, pageSize: 100 }),
    enabled: open && positionId !== "",
    staleTime: 10_000,
  });
  const employees = employeesQuery.data?.items ?? [];
  const linked = employees.filter((e) => e.userId !== null);
  // KI-073 D5: `complete === false` ⇒ dedup theo `memberIds` TẮT (nó là tập con — lọc theo nó là
  // POST THIẾU người), server no-op xử lý đúng người đã là thành viên (D2). Vẫn TRỪ CHÍNH MÌNH:
  // self-assign nổ SoD 403 từng dòng thành dòng đỏ khó hiểu, và `myUserId` là bit FE luôn biết.
  const toAssign = complete
    ? linked.filter((e) => !memberIds.has(e.userId as string))
    : linked.filter((e) => e.userId !== myUserId);
  const alreadyMembers = complete ? linked.length - toAssign.length : 0;
  const unlinked = employees.length - linked.length;

  const close = () => {
    setPositionId("");
    batch.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("roleMembers.addPosition.title")}
      description={t("roleMembers.addPosition.description")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close}>
            {tc("actions.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={toAssign.length === 0 || batch.running}
            onClick={() =>
              void batch.run(
                toAssign.map((e) => ({
                  userId: e.userId as string,
                  label: e.fullName ?? e.email ?? e.id,
                })),
              )
            }
          >
            {batch.running
              ? t("roleMembers.batch.running")
              : t("roleMembers.addPosition.submit", { count: toAssign.length })}
          </Button>
        </>
      }
    >
      {positionsQuery.isLoading ? (
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      ) : (
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={positionId}
          onChange={(e) => setPositionId(e.target.value)}
          aria-label={t("roleMembers.addPosition.selectLabel")}
        >
          <option value="">{t("roleMembers.addPosition.selectPlaceholder")}</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {positionId !== "" &&
        (employeesQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("roleMembers.addOrgUnit.preview.toAssign", { count: toAssign.length })}</p>
            {/* KI-073 D5: dòng "Bỏ qua (đã là thành viên)" là khẳng định FE không đủ dữ liệu để đưa
                ra khi complete=false — thay bằng dòng nói rõ giới hạn phạm vi (khoá dùng chung cho
                CẢ dialog phòng ban lẫn chức vụ). */}
            {complete ? (
              alreadyMembers > 0 && (
                <p>
                  {t("roleMembers.addOrgUnit.preview.alreadyMembers", { count: alreadyMembers })}
                </p>
              )
            ) : (
              <p>{t("roleMembers.addOrgUnit.preview.dedupUnavailable")}</p>
            )}
            {unlinked > 0 && (
              <p>{t("roleMembers.addOrgUnit.preview.unlinked", { count: unlinked })}</p>
            )}
            {employees.length >= 100 && (
              <p className="text-warning">{t("roleMembers.addOrgUnit.preview.pageCap")}</p>
            )}
          </div>
        ))}
      <BatchResultList results={batch.results} />
    </Dialog>
  );
}
