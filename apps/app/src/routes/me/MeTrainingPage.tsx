/**
 * MeTrainingPage — "Tiến độ đào tạo" (route "/me/training", S5-LMS-FE-1, SPEC-09 §18 fail-soft).
 *
 * Đọc DUY NHẤT `GET /me/training` (meApi.getTraining) — proxy tiến độ LMS, envelope `{status,progress}`.
 * Email resolve 100% từ token ở BE (KHÔNG gửi param — chống IDOR §14.4). ME KHÔNG tự tính lại: chỉ hiển
 * thị field server trả (BẤT BIẾN masking §2/§5). Gate route-level `access:lms` (ROUTE_REGISTRY me.training);
 * page tự gate lại bằng useCan (defense-in-depth, mirror MeAttendancePage). Nút "Mở LMS" deep-link /lms —
 * route đích (LmsRedirectPage) TỰ phát token SSO, ME KHÔNG bypass.
 *
 * 3 trạng thái (done_when): loading skeleton · error transport/502 (+ thử lại) · empty (no_account | 0 khoá).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  GraduationCap,
  ExternalLink,
  RefreshCw,
  BookOpen,
  CheckCircle2,
  Clock,
  CalendarClock,
  AlertTriangle,
  Lock,
} from "lucide-react";
import type { TFunction } from "i18next";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import type {
  MeTrainingCourse,
  MeTrainingProgress,
  MeTrainingSummary,
  MeTrainingExams,
  MeTrainingQuizzes,
} from "@mediaos/contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Button,
  Skeleton,
  StatCard,
  PageHeader,
} from "@mediaos/ui";
import { LMS_ACCESS_PAIR, ME_LMS_OPEN_PATH } from "./constants";
import { clampPercent, learningTimeParts } from "./components/training-format";
import { TrainingProgressBar } from "./components/TrainingProgressBar";

/** Thời lượng học sang chuỗi vi ("2 giờ 30 phút" / "45 phút" / "—"). */
function formatLearningTime(totalSeconds: number, t: TFunction<"me">): string {
  const { hours, minutes } = learningTimeParts(totalSeconds);
  if (hours === 0 && minutes === 0) return t("trainingPage.time.none");
  if (hours === 0) return t("trainingPage.time.minutes", { minutes });
  return t("trainingPage.time.hoursMinutes", { hours, minutes });
}

/** Ngày hoạt động gần nhất (ISO) → dd/MM/yyyy vi; null → "Chưa hoạt động". */
function formatLastActivity(iso: string | null, t: TFunction<"me">): string {
  if (!iso) return t("trainingPage.neverActive");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? t("trainingPage.neverActive") : d.toLocaleDateString("vi-VN");
}

function CourseRow({ course, t }: { course: MeTrainingCourse; t: TFunction<"me"> }) {
  const percent = clampPercent(course.percent);
  return (
    <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-sm font-medium text-foreground" title={course.title}>
          {course.title}
        </p>
        <div className="flex items-center gap-2">
          <TrainingProgressBar percent={percent} className="max-w-xs" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{percent}%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("trainingPage.progressLabel", {
            completed: course.completed,
            total: course.total,
          })}
        </p>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-1">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatLearningTime(course.learningTimeSec, t)}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          {formatLastActivity(course.lastActivityAt, t)}
        </span>
      </div>
    </div>
  );
}

function MeTrainingPageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.training(),
    queryFn: meApi.getTraining,
    staleTime: 60_000,
  });

  const openLmsButton = (
    <Button size="sm" onClick={() => void navigate({ to: ME_LMS_OPEN_PATH })}>
      <ExternalLink className="mr-2 h-4 w-4" />
      {t("trainingPage.openLms")}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Lỗi TRANSPORT/502 (LMS chết) — khác no_account (trạng thái hợp lệ). Fail-soft + thử lại.
  if (isError || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("trainingPage.title")}
          description={t("trainingPage.description")}
          icon={GraduationCap}
          actions={openLmsButton}
        />
        <EmptyState
          icon={AlertTriangle}
          title={t("trainingPage.error.title")}
          description={t("trainingPage.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const isEmpty = data.status === "no_account" || data.progress === null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("trainingPage.title")}
        description={t("trainingPage.description")}
        icon={GraduationCap}
        actions={openLmsButton}
      />

      {isEmpty ? (
        <EmptyState
          icon={GraduationCap}
          title={t("trainingPage.empty.title")}
          description={t("trainingPage.empty.description")}
        />
      ) : (
        <TrainingContent progress={data.progress!} t={t} />
      )}
    </div>
  );
}

/** Dải KPI tổng hợp (4 thẻ). lastActivity qua formatLastActivity (đã tự trả "Chưa hoạt động" khi null). */
function TrainingSummaryStrip({ summary, t }: { summary: MeTrainingSummary; t: TFunction<"me"> }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label={t("trainingPage.summary.courses")} value={summary.courseCount} tone="blue" />
      <StatCard
        label={t("trainingPage.summary.completed")}
        value={summary.completedCourses}
        tone="emerald"
      />
      <StatCard
        label={t("trainingPage.summary.learningTime")}
        value={formatLearningTime(summary.learningTimeSec, t)}
        tone="cyan"
      />
      <StatCard
        label={t("trainingPage.summary.lastActivity")}
        value={formatLastActivity(summary.lastActivityAt, t)}
        tone="neutral"
      />
    </div>
  );
}

function ExamsCard({ exams, t }: { exams: MeTrainingExams; t: TFunction<"me"> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-brand" />
          {t("trainingPage.exams.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        <p>{t("trainingPage.exams.submitted", { count: exams.submitted })}</p>
        <p>
          {t("trainingPage.exams.passed", { count: exams.passed })} ·{" "}
          {t("trainingPage.exams.failed", { count: exams.failed })}
          {exams.pendingGrading > 0
            ? ` · ${t("trainingPage.exams.pending", { count: exams.pendingGrading })}`
            : ""}
        </p>
        {exams.bestScore10 !== null ? (
          <p className="font-medium text-foreground">
            {t("trainingPage.exams.bestScore", { score: exams.bestScore10 })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuizzesCard({ quizzes, t }: { quizzes: MeTrainingQuizzes; t: TFunction<"me"> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-brand" />
          {t("trainingPage.quizzes.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        <p>{t("trainingPage.quizzes.submitted", { count: quizzes.submitted })}</p>
        {quizzes.averagePercent !== null ? (
          <p className="font-medium text-foreground">
            {t("trainingPage.quizzes.average", { percent: clampPercent(quizzes.averagePercent) })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Khối bài thi + quiz — chỉ hiện khi CÓ lượt nộp (0/0 ⇒ null, tránh thẻ rỗng). */
function TrainingAssessments({
  exams,
  quizzes,
  t,
}: {
  exams: MeTrainingExams;
  quizzes: MeTrainingQuizzes;
  t: TFunction<"me">;
}) {
  if (exams.submitted === 0 && quizzes.submitted === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {exams.submitted > 0 ? <ExamsCard exams={exams} t={t} /> : null}
      {quizzes.submitted > 0 ? <QuizzesCard quizzes={quizzes} t={t} /> : null}
    </div>
  );
}

/** Danh sách khoá — sắp xếp theo hoạt động gần nhất (khoá null xếp cuối, sort ổn định trên chuỗi ISO). */
function TrainingCourseList({
  courses,
  coursesTruncated,
  t,
}: {
  courses: readonly MeTrainingCourse[];
  coursesTruncated: boolean;
  t: TFunction<"me">;
}) {
  const sortedCourses = [...courses].sort((a, b) =>
    (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-brand" />
          {t("trainingPage.columns.course")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedCourses.length === 0 ? (
          <EmptyState title={t("trainingPage.empty.title")} className="py-6" />
        ) : (
          <div className="divide-y divide-border">
            {sortedCourses.map((course) => (
              <CourseRow key={course.slug} course={course} t={t} />
            ))}
          </div>
        )}
        {coursesTruncated ? (
          <p className="pt-3 text-xs text-muted-foreground">{t("trainingPage.coursesTruncated")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrainingContent({ progress, t }: { progress: MeTrainingProgress; t: TFunction<"me"> }) {
  const { summary, courses, user, exams, quizzes, coursesTruncated } = progress;
  return (
    <div className="space-y-6">
      {!user.active ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <Lock className="h-4 w-4 shrink-0" />
          {t("trainingPage.accountLocked")}
        </div>
      ) : null}
      <TrainingSummaryStrip summary={summary} t={t} />
      <TrainingAssessments exams={exams} quizzes={quizzes} t={t} />
      <TrainingCourseList courses={courses} coursesTruncated={coursesTruncated} t={t} />
    </div>
  );
}

export function MeTrainingPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(LMS_ACCESS_PAIR.action, LMS_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeTrainingPageInner />;
}
