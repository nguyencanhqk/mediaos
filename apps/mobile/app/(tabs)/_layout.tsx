import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../src/auth/auth-context";
import { notificationApi } from "../../src/api/notification-api";

/**
 * Authenticated tabs layout + NAV GUARD (pays down the M0 "no route guard" debt):
 * any unauthenticated entry into the (tabs) group is redirected to the login screen, so a stale
 * deep link or a logout mid-session can never render an authenticated screen.
 */
export default function TabsLayout() {
  const { user, isLoading } = useAuth();

  // Unread count for notification badge — only when authenticated.
  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => notificationApi.unreadCount(),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const unreadCount = unreadData?.count ?? 0;

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Trang chủ" }} />
      <Tabs.Screen name="tasks" options={{ title: "Việc của tôi" }} />
      <Tabs.Screen name="approvals" options={{ title: "Chờ duyệt" }} />
      {/* G15-2 comms tabs */}
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Thông báo",
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
        }}
      />
      {/* G15-3 HR self-service tabs */}
      <Tabs.Screen name="attendance" options={{ title: "Chấm công" }} />
      <Tabs.Screen name="leave" options={{ title: "Nghỉ phép" }} />
      <Tabs.Screen name="payslips" options={{ title: "Phiếu lương" }} />
      <Tabs.Screen name="kpi" options={{ title: "KPI" }} />
    </Tabs>
  );
}
