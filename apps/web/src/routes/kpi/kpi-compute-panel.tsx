import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calculator, CheckCircle2, Lock } from "lucide-react";
import type { ComputeKpiRequest, KpiDefinitionDto, KpiResultDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { kpiApi } from "@/lib/kpi-api";
import { orgApi } from "@/lib/org-api";
import { isConfirmed } from "@/lib/kpi-format";
import { KpiGoalTree } from "./kpi-goal-tree";

interface KpiComputePanelProps {
  definitions: KpiDefinitionDto[];
}

type SubjectKind = "user" | "team";

/**
 * Bảng "Tính & xác nhận KPI". TOÀN BỘ hành động ghi phía server fail-closed; FE chỉ ẩn UI bằng
 * read:kpi / confirm:kpi (KHÔNG thay quyền). Không có read:kpi → hiện trạng thái khoá, không gọi API.
 */
export function KpiComputePanel({ definitions }: KpiComputePanelProps) {
  const { t } = useTranslation("kpi");
  const canRead = useCan("read", "kpi");

  const [definitionId, setDefinitionId] = useState("");
  const [subjectKind, setSubjectKind] = useState<SubjectKind>("user");
  const [subjectId, setSubjectId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [result, setResult] = useState<KpiResultDto | null>(null);

  const { data: employees = [] } = useQuery({
    queryKey: ["org", "employees"],
    queryFn: orgApi.listEmployees,
    enabled: canRead && subjectKind === "user",
  });
  const { data: teams = [] } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: orgApi.listTeams,
    enabled: canRead && subjectKind === "team",
  });

  const compute = useMutation({
    mutationFn: (body: ComputeKpiRequest) => kpiApi.compute(body),
    onSuccess: setResult,
  });

  const confirm = useMutation({
    mutationFn: (kpiResultId: string) => kpiApi.confirm({ kpiResultId }),
    onSuccess: setResult,
  });

  const definition = definitions.find((d) => d.id === definitionId);
  const canSubmit =
    Boolean(definitionId) &&
    Boolean(subjectId) &&
    Boolean(periodStart) &&
    Boolean(periodEnd) &&
    new Date(periodEnd) > new Date(periodStart);

  const onSubmit = () => {
    if (!canSubmit) return;
    const base = {
      definitionId,
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
    };
    compute.mutate(
      subjectKind === "user"
        ? { ...base, subjectUserId: subjectId }
        : { ...base, subjectTeamId: subjectId },
    );
  };

  if (!canRead) {
    return (
      <EmptyState
        icon={Lock}
        title={t("compute.noPermissionTitle")}
        description={t("compute.noPermissionHint")}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">{t("compute.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("compute.hint")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("compute.definition")}>
            <Select
              value={definitionId}
              onChange={(e) => setDefinitionId(e.target.value)}
              aria-label={t("compute.definition")}
            >
              <option value="">{t("compute.selectDefinition")}</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("compute.subjectKind")}>
            <Select
              value={subjectKind}
              onChange={(e) => {
                setSubjectKind(e.target.value as SubjectKind);
                setSubjectId("");
              }}
              aria-label={t("compute.subjectKind")}
            >
              <option value="user">{t("compute.subjectUser")}</option>
              <option value="team">{t("compute.subjectTeam")}</option>
            </Select>
          </Field>

          <Field label={t("compute.subject")}>
            <Select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              aria-label={t("compute.subject")}
            >
              <option value="">{t("compute.selectSubject")}</option>
              {subjectKind === "user"
                ? employees.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName ?? u.email}
                    </option>
                  ))
                : teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("compute.periodStart")}>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                aria-label={t("compute.periodStart")}
              />
            </Field>
            <Field label={t("compute.periodEnd")}>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                aria-label={t("compute.periodEnd")}
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onSubmit} disabled={!canSubmit || compute.isPending}>
            <Calculator className="h-4 w-4" />
            {compute.isPending ? t("compute.computing") : t("compute.submit")}
          </Button>
          {compute.isError && (
            <span className="text-sm text-destructive">{t("compute.failed")}</span>
          )}
        </div>
      </div>

      {result && definition && (
        <div className="space-y-3">
          <KpiGoalTree result={result} definitionName={definition.name} />
          <PermissionGate action="confirm" resourceType="kpi">
            {!isConfirmed(result.confirmedAt) && (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => confirm.mutate(result.id)}
                  disabled={confirm.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {confirm.isPending ? t("confirm.confirming") : t("confirm.action")}
                </Button>
                {confirm.isError && (
                  <span className="text-sm text-destructive">{t("confirm.failed")}</span>
                )}
              </div>
            )}
          </PermissionGate>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
