import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { tasksApi } from "../../src/api/tasks-api";
import { errorMessage } from "../../src/api/client";
import { useAddComment, useTask, useTaskAttachments, useTaskComments } from "../../src/tasks/use-tasks";
import { TASK_TYPE_LABELS } from "../../src/tasks/task-constants";
import { formatDueDate } from "../../src/tasks/task-date";
import { StatusBadge } from "../../src/components/status-badge";

/**
 * Task Detail — task summary + status, attachments (read-only), and the comment thread (which doubles
 * as the activity trail; the backend has no dedicated status-history endpoint — see report).
 * The task is read from the shared my-tasks cache (no GET /tasks/:id exists).
 */
export default function TaskDetailScreen() {
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
      <Stack.Screen options={{ headerShown: true, title: "Chi tiết công việc" }} />

      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.metaRow}>
        <StatusBadge status={task.status} />
        <Text style={styles.type}>{TASK_TYPE_LABELS[task.taskType]}</Text>
      </View>
      <Text style={styles.meta}>Hạn: {formatDueDate(task.dueDate)}</Text>
      {task.stepName ? <Text style={styles.meta}>Bước: {task.stepName}</Text> : null}
      {task.projectName ? <Text style={styles.meta}>Dự án: {task.projectName}</Text> : null}

      <TouchableOpacity
        style={styles.submitCta}
        onPress={() => router.push(`/submit/${task.id}`)}
        accessibilityRole="button"
      >
        <Text style={styles.submitCtaText}>Nộp kết quả / cập nhật trạng thái</Text>
      </TouchableOpacity>

      <AttachmentsSection taskId={taskId} />
      <CommentsSection taskId={taskId} />
    </ScrollView>
  );
}

function AttachmentsSection({ taskId }: { taskId: string }) {
  const { data: attachments = [], isLoading } = useTaskAttachments(taskId);

  async function openAttachment(attachmentId: string) {
    try {
      const { downloadUrl } = await tasksApi.getAttachmentDownloadUrl(taskId, attachmentId);
      // Defense-in-depth: only hand HTTPS presigned URLs to the OS dispatcher. Reject any other
      // scheme (javascript:/intent:/tel:…) even though the server is expected to return https.
      if (!downloadUrl.startsWith("https://")) {
        Alert.alert("Không mở được tệp", "Đường dẫn tệp không hợp lệ.");
        return;
      }
      await Linking.openURL(downloadUrl);
    } catch (err) {
      Alert.alert("Không mở được tệp", errorMessage(err));
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Tệp đính kèm</Text>
      {isLoading ? (
        <ActivityIndicator />
      ) : attachments.length === 0 ? (
        <Text style={styles.muted}>Chưa có tệp đính kèm.</Text>
      ) : (
        attachments.map((a) => (
          <TouchableOpacity key={a.id} style={styles.attachment} onPress={() => openAttachment(a.id)}>
            <Text style={styles.link} numberOfLines={1}>
              📎 {a.fileName}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function CommentsSection({ taskId }: { taskId: string }) {
  const { data: comments = [], isLoading } = useTaskComments(taskId);
  const addComment = useAddComment(taskId);
  const [body, setBody] = useState("");

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    addComment.mutate(
      { body: trimmed },
      {
        onSuccess: () => setBody(""),
        onError: (err) => Alert.alert("Không gửi được bình luận", errorMessage(err)),
      },
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Hoạt động & bình luận</Text>
      {isLoading ? (
        <ActivityIndicator />
      ) : comments.length === 0 ? (
        <Text style={styles.muted}>Chưa có bình luận.</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            <Text style={styles.commentAuthor}>{c.userFullName ?? "Người dùng"}</Text>
            <Text style={styles.commentBody}>{c.body}</Text>
          </View>
        ))
      )}

      <View style={styles.commentForm}>
        <TextInput
          style={styles.commentInput}
          placeholder="Viết bình luận…"
          accessibilityLabel="Viết bình luận"
          value={body}
          onChangeText={setBody}
          multiline
        />
        <TouchableOpacity
          style={[styles.commentSend, (addComment.isPending || body.trim() === "") && styles.disabled]}
          onPress={submit}
          disabled={addComment.isPending || body.trim() === ""}
        >
          <Text style={styles.commentSendText}>Gửi</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 20, gap: 8 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },
  title: { fontSize: 20, fontWeight: "700", color: "#111827" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  type: { fontSize: 14, color: "#6b7280" },
  meta: { fontSize: 14, color: "#374151" },
  muted: { fontSize: 14, color: "#6b7280" },
  link: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  submitCta: {
    marginTop: 12,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  submitCtaText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  section: { marginTop: 20, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  attachment: { paddingVertical: 6 },
  comment: { backgroundColor: "#fff", borderRadius: 8, padding: 12, gap: 2 },
  commentAuthor: { fontSize: 13, fontWeight: "600", color: "#374151" },
  commentBody: { fontSize: 14, color: "#111827" },
  commentForm: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-end" },
  commentInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 40,
  },
  commentSend: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
  commentSendText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
});
