import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TaskDto } from "@mediaos/contracts";
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from "../tasks/task-constants";

interface StatusBadgeProps {
  status: TaskDto["status"];
}

/** Small colored pill rendering the Vietnamese label for a task status. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const color = TASK_STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{TASK_STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});
