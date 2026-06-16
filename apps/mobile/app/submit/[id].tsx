import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { submitStepSchema, type OfficeTaskStatusDto, type TaskDto } from "@mediaos/contracts";
import { errorMessage } from "../../src/api/client";
import { useTask, useUpdateOfficeStatus } from "../../src/tasks/use-tasks";
import { useStartStep, useSubmitStep } from "../../src/tasks/use-workflow";
import { PermissionGate } from "../../src/auth/permission-gate";
import {
  SHORTENED_FLOW_STATUSES,
  TASK_STATUS_LABELS,
  isShortenedFlowTask,
} from "../../src/tasks/task-constants";

/**
 * Submit Work — two paths driven by the task shape:
 *  • Workflow task (stepId set): start the step, then submit a result link + note → waiting_review.
 *    The FSM enforces the actor = assignee server-side.
 *  • Office task (shortened flow): move status not_started → in_progress → completed. The status
 *    controls are wrapped in <PermissionGate update:task> — a user without that capability sees a
 *    read-only message and no buttons (deny-path); the server still gates PATCH /tasks/:id/status.
 */
export default function SubmitWorkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = String(id);
  const { data: task, isLoading } = useTask(taskId);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Không tìm thấy công việc.</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.link}>← Quay lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: true, title: "Nộp kết quả" }} />
      <Text style={styles.title}>{task.title}</Text>

      {task.stepId ? (
        <WorkflowSubmit task={task} />
      ) : isShortenedFlowTask(task) ? (
        <OfficeStatusControls taskId={taskId} current={task.status} />
      ) : (
        <Text style={styles.muted}>Công việc này do quy trình quản lý, không thể cập nhật tại đây.</Text>
      )}
    </ScrollView>
  );
}

function WorkflowSubmit({ task }: { task: TaskDto }) {
  const start = useStartStep();
  const submit = useSubmitStep();
  const stepId = task.stepId; // string | null; the parent only renders this when it is set
  const [url, setUrl] = useState(task.submissionUrl ?? "");
  const [note, setNote] = useState(task.submissionNote ?? "");

  function handleSubmit() {
    if (!stepId) return;
    const parsed = submitStepSchema.safeParse({
      submissionUrl: url.trim() === "" ? null : url.trim(),
      submissionNote: note.trim() === "" ? null : note.trim(),
    });
    if (!parsed.success) {
      Alert.alert("Lỗi", parsed.error.errors[0]?.message ?? "Đường dẫn không hợp lệ.");
      return;
    }
    submit.mutate(
      { stepId, data: parsed.data },
      {
        onSuccess: () => {
          Alert.alert("Đã nộp", "Kết quả đã được gửi để duyệt.");
          router.back();
        },
        onError: (err) => Alert.alert("Không nộp được", errorMessage(err)),
      },
    );
  }

  return (
    <View style={styles.section}>
      {task.status === "not_started" ? (
        <TouchableOpacity
          style={[styles.secondaryButton, start.isPending && styles.disabled]}
          onPress={() => {
            if (!stepId) return;
            start.mutate(stepId, { onError: (err) => Alert.alert("Lỗi", errorMessage(err)) });
          }}
          disabled={start.isPending}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{start.isPending ? "Đang bắt đầu…" : "Bắt đầu làm"}</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.label}>Đường dẫn kết quả (URL)</Text>
      <TextInput
        style={styles.input}
        placeholder="https://…"
        autoCapitalize="none"
        keyboardType="url"
        accessibilityLabel="Đường dẫn kết quả"
        value={url}
        onChangeText={setUrl}
      />

      <Text style={styles.label}>Ghi chú</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Mô tả ngắn về kết quả…"
        accessibilityLabel="Ghi chú kết quả"
        value={note}
        onChangeText={setNote}
        multiline
      />

      <TouchableOpacity
        style={[styles.primaryButton, submit.isPending && styles.disabled]}
        onPress={handleSubmit}
        disabled={submit.isPending}
        accessibilityRole="button"
      >
        {submit.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>Nộp để duyệt</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        M1 nộp kết quả bằng đường dẫn. Tải tệp đính kèm trực tiếp sẽ bổ sung ở bản sau.
      </Text>
    </View>
  );
}

function OfficeStatusControls({
  taskId,
  current,
}: {
  taskId: string;
  current: TaskDto["status"];
}) {
  const update = useUpdateOfficeStatus(taskId);

  function setStatus(status: OfficeTaskStatusDto) {
    if (status === current) return;
    update.mutate(status, {
      onSuccess: () => Alert.alert("Đã cập nhật", "Trạng thái công việc đã đổi."),
      onError: (err) => Alert.alert("Không cập nhật được", errorMessage(err)),
    });
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Cập nhật trạng thái</Text>
      <PermissionGate
        action="update"
        resourceType="task"
        fallback={<Text style={styles.muted}>Bạn không có quyền cập nhật công việc này.</Text>}
      >
        <View style={styles.statusRow}>
          {SHORTENED_FLOW_STATUSES.map((status) => {
            const isCurrent = status === current;
            return (
              <TouchableOpacity
                key={status}
                style={[styles.statusButton, isCurrent && styles.statusButtonActive]}
                onPress={() => setStatus(status)}
                disabled={isCurrent || update.isPending}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
              >
                <Text style={[styles.statusText, isCurrent && styles.statusTextActive]}>
                  {TASK_STATUS_LABELS[status]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </PermissionGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 20, gap: 10 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#111827" },
  section: { gap: 8, marginTop: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginTop: 6 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#2563eb", fontWeight: "600" },
  statusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statusButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
  },
  statusButtonActive: { backgroundColor: "#2563eb" },
  statusText: { fontSize: 14, color: "#374151" },
  statusTextActive: { color: "#fff", fontWeight: "600" },
  muted: { fontSize: 14, color: "#6b7280" },
  link: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  hint: { fontSize: 12, color: "#9ca3af", marginTop: 8, fontStyle: "italic" },
  disabled: { opacity: 0.6 },
});
