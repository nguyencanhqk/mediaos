import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { requestRevisionSchema } from "@mediaos/contracts";
import { errorMessage } from "../../src/api/client";
import { useRequestRevision } from "../../src/tasks/use-workflow";

/**
 * Request Revision — a reviewer sends an approval request back with a required reason (description)
 * and an optional comment. POST /workflow/approval-requests/:id/request-revision. The server enforces
 * the reviewer identity; a 403 surfaces as the generic permission message (no data leak).
 */
export default function RevisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = String(id);
  const requestRevision = useRequestRevision(requestId);

  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");

  function submit() {
    const parsed = requestRevisionSchema.safeParse({
      description: description.trim(),
      comment: comment.trim() === "" ? null : comment.trim(),
    });
    if (!parsed.success) {
      Alert.alert("Lỗi", parsed.error.errors[0]?.message ?? "Vui lòng nhập lý do trả sửa.");
      return;
    }
    requestRevision.mutate(parsed.data, {
      onSuccess: () => {
        Alert.alert("Đã trả sửa", "Yêu cầu đã được gửi lại để chỉnh sửa.");
        router.back();
      },
      onError: (err) => Alert.alert("Không thể trả sửa", errorMessage(err)),
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: true, title: "Trả sửa" }} />

      <Text style={styles.label}>Lý do cần sửa *</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Mô tả những điểm cần chỉnh sửa…"
        accessibilityLabel="Lý do cần sửa"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Text style={styles.label}>Ghi chú thêm</Text>
      <TextInput
        style={styles.input}
        placeholder="Tuỳ chọn"
        accessibilityLabel="Ghi chú thêm"
        value={comment}
        onChangeText={setComment}
      />

      <TouchableOpacity
        style={[styles.button, requestRevision.isPending && styles.disabled]}
        onPress={submit}
        disabled={requestRevision.isPending}
        accessibilityRole="button"
      >
        {requestRevision.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Gửi yêu cầu trả sửa</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()} style={styles.cancel}>
        <Text style={styles.cancelText}>Huỷ</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 20, gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginTop: 8 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  button: { backgroundColor: "#ea580c", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  cancel: { padding: 12, alignItems: "center" },
  cancelText: { color: "#6b7280", fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
