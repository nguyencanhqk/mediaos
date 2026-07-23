/**
 * MeTrainingCard — card "Đào tạo" trong Tổng quan ME (ME-SCREEN-001, S5-LMS-FE-1).
 *
 * KHÁC 5 section-card khác: KHÔNG đọc từ `GET /me/overview` mà có QUERY RIÊNG `GET /me/training`
 * (meApi.getTraining) — endpoint riêng, gate riêng (`access:lms`), envelope riêng `{status,progress}`.
 * Vì vậy 1 nguồn lỗi (LMS chết → 502, hoặc no_account) tự khoanh vùng TRONG card, KHÔNG kéo sập overview
 * (SPEC-09 §18.2 fail-soft — mirror MeSectionCard nhưng cho envelope training).
 *
 * SELF-GATE `access:lms`: card tự ẩn (render null) + KHÔNG fetch khi thiếu quyền (useQuery enabled) — nguồn
 * gating DUY NHẤT, MeOverviewPage chỉ cần mount <MeTrainingCard/> vô điều kiện (không hard-code role, §5).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GraduationCap, AlertTriangle, RefreshCw, ChevronRight } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  EmptyState,
  Button,
} from "@mediaos/ui";
import { LMS_ACCESS_PAIR } from "../constants";
import { clampPercent, pickRecentCourse } from "./training-format";
import { TrainingProgressBar } from "./TrainingProgressBar";

const ME_TRAINING_PATH = "/me/training";

export function MeTrainingCard() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canAccess = useCan(LMS_ACCESS_PAIR.action, LMS_ACCESS_PAIR.resourceType);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.training(),
    queryFn: meApi.getTraining,
    enabled: canAccess,
    staleTime: 60_000,
  });

  // Thiếu access:lms → ẩn hoàn toàn (không chiếm ô lưới, không lộ sự tồn tại của LMS).
  if (!canAccess) return null;

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2 w-full" />
        </div>
      );
    }

    // Lỗi hạ tầng (transport/502 LMS chết) — fail-soft, có nút thử lại (khác no_account = trạng thái hợp lệ).
    if (isError || !data) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title={t("training.error.title")}
          className="py-4"
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      );
    }

    // no_account = email chưa từng có tài khoản LMS (KHÔNG lỗi) → empty fail-soft.
    if (data.status === "no_account" || data.progress === null) {
      return <EmptyState title={t("training.empty")} className="py-4" />;
    }

    const { summary, courses } = data.progress;
    const inProgress = Math.max(0, summary.courseCount - summary.completedCourses);
    const recent = pickRecentCourse(courses);

    return (
      <div className="space-y-3">
        <div>
          <p className="text-2xl font-semibold leading-none text-foreground">
            {summary.courseCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("training.inProgressCount", { count: inProgress })} ·{" "}
            {t("training.completedCount", { count: summary.completedCourses })}
          </p>
        </div>
        {recent ? (
          <div className="space-y-1">
            <p className="truncate text-xs text-muted-foreground" title={recent.title}>
              {t("training.recent", { title: recent.title })}
            </p>
            <TrainingProgressBar percent={clampPercent(recent.percent)} />
          </div>
        ) : null}
      </div>
    );
  };

  const showDetailLink = !isLoading && !isError && !!data;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap className="h-4 w-4 text-brand" />
          {t("training.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{renderBody()}</CardContent>
      {showDetailLink ? (
        <div className="px-6 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-brand hover:bg-transparent"
            // `as "/"`: route /me/training tạo qua makeModuleRoute (path widen thành string) nên KHÔNG
            // vào union `to` — cast literal như MeQuickActions/MeDeepLinkButtons (runtime giữ nguyên path).
            onClick={() => void navigate({ to: ME_TRAINING_PATH as "/" })}
          >
            {t("training.viewDetail")}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
