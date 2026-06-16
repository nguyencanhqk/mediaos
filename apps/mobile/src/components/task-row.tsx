import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { TaskDto } from "@mediaos/contracts";
import { TASK_TYPE_LABELS } from "../tasks/task-constants";
import { formatDueDate, isOverdue } from "../tasks/task-date";
import { StatusBadge } from "./status-badge";

interface TaskRowProps {
  task: TaskDto;
  onPress: (taskId: string) => void;
}

/** One row in the My Tasks list — title, type, status badge, due date (red when overdue). */
export function TaskRow({ task, onPress }: TaskRowProps) {
  const overdue = isOverdue(task.dueDate);
  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress(task.id)} accessibilityRole="button">
      <View style={styles.headerLine}>
        <Text style={styles.title} numberOfLines={2}>
          {task.title}
        </Text>
        <StatusBadge status={task.status} />
      </View>
      <View style={styles.metaLine}>
        <Text style={styles.type}>{TASK_TYPE_LABELS[task.taskType]}</Text>
        <Text style={[styles.due, overdue && styles.dueOverdue]}>
          {overdue ? "Quá hạn · " : ""}
          {formatDueDate(task.dueDate)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: "#fff", borderRadius: 10, padding: 14, gap: 8 },
  headerLine: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: "#111827" },
  metaLine: { flexDirection: "row", justifyContent: "space-between" },
  type: { fontSize: 13, color: "#6b7280" },
  due: { fontSize: 13, color: "#6b7280" },
  dueOverdue: { color: "#dc2626", fontWeight: "600" },
});
