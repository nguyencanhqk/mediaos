/**
 * SYSTEM-SCREEN-ROLE-PERMISSIONS v2 (S2-AUTH-PERMUX-1) — gán/thu hồi quyền cho 1 role,
 * CÓ TRẠNG THÁI THẬT.
 *
 * API: GET /auth/roles/:id/permissions (grants đã gán — endpoint mới #1) + catalog GET
 * /auth/permissions + mutation POST/DELETE /auth/roles/:id/permissions sẵn có (assign:permission
 * is_sensitive=true — ANTI-ESCALATION; server idempotent cùng scope, đổi scope = DELETE+INSERT,
 * scope-ceiling chặn System). Gate = useCanExact (sensitive pair KHÔNG kế thừa wildcard).
 *
 * v2 thay bảng phẳng mù-trạng-thái bằng: nhóm theo resourceType (thu gọn/mở rộng, đếm đã-gán/tổng)
 * · mỗi dòng hiện badge Đã gán + scope hiện tại · đổi scope ngay trên dropdown · bulk tick nhiều
 * dòng → gán 1 lượt cùng scope (tuần tự, kết quả từng dòng) · nhãn tiếng Việt kèm mã thô.
 *
 * States: forbidden · loading · error · grouped list.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { roleAdminApi, authKeys, useCanExact, ApiError } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Input,
  Select,
  Badge,
  Card,
  CardContent,
} from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import { labelAction, labelResource, labelScope } from "./permission-labels";

const ASSIGNABLE_DATA_SCOPES = ["Own", "Team", "Department", "Company"] as const;
type AssignableDataScope = (typeof ASSIGNABLE_DATA_SCOPES)[number];

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function pairKey(p: { action: string; resourceType: string }): string {
  return `${p.action}:${p.resourceType}`;
}

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("rolePermissions.errors.badPair");
    if (err.status === 403) return t("rolePermissions.errors.forbidden");
    if (err.status === 404) return t("rolePermissions.errors.notFound");
    if (err.status >= 500) return t("rolePermissions.errors.server");
  }
  return t("rolePermissions.errors.generic");
}

interface RowVm {
  action: string;
  resourceType: string;
  isSensitive: boolean;
  /** Grant hiện tại (ALLOW) — undefined = chưa gán. */
  allowScope?: string;
  /** Có row DENY (hiển thị read-only — mutation UI này chỉ ALLOW). */
  denied: boolean;
}

interface BulkLine {
  key: string;
  label: string;
  kind: "ok" | "error";
  detail?: string;
}

interface RolePermissionsPageProps {
  roleId: string;
  onBack?: () => void;
}

export function RolePermissionsPage({ roleId, onBack }: RolePermissionsPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const canAssign = useCanExact(
    SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.action,
    SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.resourceType,
  );

  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [scopeByKey, setScopeByKey] = useState<Record<string, AssignableDataScope>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkScope, setBulkScope] = useState<AssignableDataScope>("Company");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkLines, setBulkLines] = useState<BulkLine[]>([]);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );

  const rolesQuery = useQuery({
    queryKey: authKeys.roles.list(),
    queryFn: () => roleAdminApi.listRoles(),
    enabled: canAssign,
    staleTime: 30_000,
  });
  const role = rolesQuery.data?.find((r) => r.id === roleId);

  const permissionsQuery = useQuery({
    queryKey: authKeys.permissionCatalog.list(),
    queryFn: () => roleAdminApi.listPermissions(),
    enabled: canAssign,
    staleTime: 60_000,
  });

  // S2-AUTH-PERMUX-1 — trạng thái ĐÃ GÁN thật (hết banner mù-trạng-thái).
  const grantsQuery = useQuery({
    queryKey: authKeys.roles.grants(roleId),
    queryFn: () => roleAdminApi.getRolePermissions(roleId),
    enabled: canAssign,
    staleTime: 15_000,
  });

  const invalidateGrants = () =>
    queryClient.invalidateQueries({ queryKey: authKeys.roles.grants(roleId) });

  const assignMutation = useMutation({
    mutationFn: (input: { action: string; resourceType: string; dataScope: AssignableDataScope }) =>
      roleAdminApi.assignPermission(roleId, input),
    onSuccess: (grant) => {
      setFeedback({
        kind: "success",
        message: t("rolePermissions.assignSuccess", {
          pair: `${grant.action}:${grant.resourceType}`,
          scope: labelScope(grant.dataScope),
        }),
      });
      void invalidateGrants();
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { action: string; resourceType: string }) =>
      roleAdminApi.revokePermission(roleId, input),
    onSuccess: (_result, vars) => {
      setFeedback({
        kind: "success",
        message: t("rolePermissions.revokeSuccess", {
          pair: `${vars.action}:${vars.resourceType}`,
        }),
      });
      void invalidateGrants();
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const busy = assignMutation.isPending || revokeMutation.isPending || bulkRunning;

  // ── Ghép catalog + grants → row VM, nhóm theo resourceType ────────────────
  const groups = useMemo(() => {
    const catalog = permissionsQuery.data ?? [];
    const grants = grantsQuery.data?.grants ?? [];
    const allowByKey = new Map<string, string>();
    const denyKeys = new Set<string>();
    for (const g of grants) {
      if (g.effect === "ALLOW") allowByKey.set(pairKey(g), g.dataScope);
      else denyKeys.add(pairKey(g));
    }
    const rows: RowVm[] = catalog.map((p) => ({
      action: p.action,
      resourceType: p.resourceType,
      isSensitive: p.isSensitive,
      allowScope: allowByKey.get(pairKey(p)),
      denied: denyKeys.has(pairKey(p)),
    }));

    const q = filter.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.action.toLowerCase().includes(q) ||
            r.resourceType.toLowerCase().includes(q) ||
            labelAction(r.action).toLowerCase().includes(q) ||
            labelResource(r.resourceType).toLowerCase().includes(q),
        )
      : rows;

    const byResource = new Map<string, RowVm[]>();
    for (const r of filtered) {
      const list = byResource.get(r.resourceType) ?? [];
      list.push(r);
      byResource.set(r.resourceType, list);
    }
    return [...byResource.entries()]
      .map(([resourceType, list]) => ({
        resourceType,
        rows: list.sort((a, b) => a.action.localeCompare(b.action)),
        assigned: list.filter((r) => r.allowScope !== undefined).length,
      }))
      .sort((a, b) => {
        // Nhóm có quyền đã gán nổi lên trước; cùng hạng thì theo alphabet.
        if (a.assigned > 0 !== b.assigned > 0) return a.assigned > 0 ? -1 : 1;
        return a.resourceType.localeCompare(b.resourceType);
      });
  }, [permissionsQuery.data, grantsQuery.data, filter]);

  const toggleChecked = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const runBulk = async () => {
    const targets: Array<{ action: string; resourceType: string }> = [];
    for (const g of groups) {
      for (const r of g.rows) {
        if (checked.has(pairKey(r)))
          targets.push({ action: r.action, resourceType: r.resourceType });
      }
    }
    setBulkRunning(true);
    setBulkLines([]);
    const out: BulkLine[] = [];
    for (const target of targets) {
      const label = `${labelAction(target.action)} · ${labelResource(target.resourceType)}`;
      try {
        await roleAdminApi.assignPermission(roleId, { ...target, dataScope: bulkScope });
        out.push({ key: pairKey(target), label, kind: "ok" });
      } catch (err) {
        out.push({
          key: pairKey(target),
          label,
          kind: "error",
          detail: submitErrorMessage(err, t),
        });
      }
      setBulkLines([...out]);
    }
    setBulkRunning(false);
    setChecked(new Set());
    void invalidateGrants();
  };

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canAssign) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rolePermissions.forbidden.title")}
          description={t("rolePermissions.forbidden.description")}
        />
      </div>
    );
  }

  const isLoading = rolesQuery.isLoading || permissionsQuery.isLoading || grantsQuery.isLoading;
  const isError = rolesQuery.isError || permissionsQuery.isError || grantsQuery.isError;

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={KeyRound} />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (isError || !role) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rolePermissions.error.title")}
          description={t("rolePermissions.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("roleDetail.backToList")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void rolesQuery.refetch();
                  void permissionsQuery.refetch();
                  void grantsQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const totalAssigned = groups.reduce((n, g) => n + g.assigned, 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("rolePermissions.title", { role: role.name })}
        description={t("rolePermissions.summaryAssigned", { count: totalAssigned })}
        icon={KeyRound}
        actions={
          onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("roleDetail.backToList")}
            </Button>
          )
        }
      />

      {feedback && (
        <p
          role="alert"
          aria-live="assertive"
          className={
            feedback.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {feedback.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t("rolePermissions.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-72"
        />
        {checked.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
            <span className="text-sm text-foreground">
              {t("rolePermissions.bulk.selected", { count: checked.size })}
            </span>
            <Select
              aria-label={t("rolePermissions.dataScope")}
              className="w-32"
              value={bulkScope}
              disabled={busy}
              onChange={(e) => setBulkScope(e.target.value as AssignableDataScope)}
            >
              {ASSIGNABLE_DATA_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {labelScope(s)}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={busy} onClick={() => void runBulk()}>
              {bulkRunning
                ? t("roleMembers.batch.running")
                : t("rolePermissions.bulk.assign", { count: checked.size })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setChecked(new Set())}
            >
              {tc("actions.cancel")}
            </Button>
          </div>
        )}
      </div>

      {bulkLines.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
          {bulkLines.map((l) => (
            <li
              key={l.key}
              className={l.kind === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {l.kind === "ok"
                ? t("roleMembers.batch.ok", { label: l.label })
                : t("roleMembers.batch.error", { label: l.label, detail: l.detail })}
            </li>
          ))}
        </ul>
      )}

      {groups.length === 0 ? (
        <EmptyState
          title={t("permissions.empty.title")}
          description={t("permissions.empty.description")}
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            // Search đang lọc → mở hết nhóm khớp; không search → theo state (mặc định đóng trừ nhóm có gán).
            const open = filter.trim() ? true : (openGroups[g.resourceType] ?? g.assigned > 0);
            return (
              <Card key={g.resourceType}>
                <CardContent className="pt-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 py-1 text-left"
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [g.resourceType]: !open }))}
                    aria-expanded={open}
                  >
                    <span className="flex items-center gap-2">
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-semibold text-foreground">
                        {labelResource(g.resourceType)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {g.resourceType}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("rolePermissions.groupAssigned", {
                        assigned: g.assigned,
                        total: g.rows.length,
                      })}
                    </span>
                  </button>

                  {open && (
                    <div className="mt-2 divide-y divide-border">
                      {g.rows.map((r) => {
                        const key = pairKey(r);
                        const assigned = r.allowScope !== undefined;
                        const rowScope =
                          scopeByKey[key] ??
                          ((assigned && r.allowScope !== "System"
                            ? (r.allowScope as AssignableDataScope)
                            : "Company") as AssignableDataScope);
                        return (
                          <div key={key} className="flex items-center justify-between gap-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {!assigned && !r.denied && (
                                <input
                                  type="checkbox"
                                  aria-label={t("rolePermissions.bulk.checkboxLabel", {
                                    pair: key,
                                  })}
                                  checked={checked.has(key)}
                                  disabled={busy}
                                  onChange={() => toggleChecked(key)}
                                />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm text-foreground">
                                  {labelAction(r.action)}
                                  {r.isSensitive && (
                                    <Badge variant="warning" className="ml-2">
                                      {t("permissions.sensitive")}
                                    </Badge>
                                  )}
                                  {r.denied && (
                                    <Badge variant="danger" className="ml-2">
                                      DENY
                                    </Badge>
                                  )}
                                </p>
                                <p className="truncate font-mono text-xs text-muted-foreground">
                                  {key}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {assigned && (
                                <Badge variant="success">
                                  {t("rolePermissions.assignedBadge", {
                                    scope: labelScope(r.allowScope as string),
                                  })}
                                </Badge>
                              )}
                              <Select
                                aria-label={t("rolePermissions.dataScope")}
                                className="w-32"
                                value={rowScope}
                                disabled={busy}
                                onChange={(e) => {
                                  const next = e.target.value as AssignableDataScope;
                                  setScopeByKey((prev) => ({ ...prev, [key]: next }));
                                  // Đã gán → đổi scope là ÁP DỤNG ngay (server DELETE+INSERT).
                                  if (assigned && next !== r.allowScope) {
                                    assignMutation.mutate({
                                      action: r.action,
                                      resourceType: r.resourceType,
                                      dataScope: next,
                                    });
                                  }
                                }}
                              >
                                {ASSIGNABLE_DATA_SCOPES.map((s) => (
                                  <option key={s} value={s}>
                                    {labelScope(s)}
                                  </option>
                                ))}
                              </Select>
                              {assigned ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    revokeMutation.mutate({
                                      action: r.action,
                                      resourceType: r.resourceType,
                                    })
                                  }
                                >
                                  {t("rolePermissions.revoke")}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled={busy || r.denied}
                                  onClick={() =>
                                    assignMutation.mutate({
                                      action: r.action,
                                      resourceType: r.resourceType,
                                      dataScope: rowScope,
                                    })
                                  }
                                >
                                  {t("rolePermissions.assign")}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
