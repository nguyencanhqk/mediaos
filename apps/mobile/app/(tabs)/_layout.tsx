import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../src/auth/auth-context";

/**
 * Authenticated tabs layout + NAV GUARD (pays down the M0 "no route guard" debt):
 * any unauthenticated entry into the (tabs) group is redirected to the login screen, so a stale
 * deep link or a logout mid-session can never render an authenticated screen.
 */
export default function TabsLayout() {
  const { user, isLoading } = useAuth();

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
      {/* G15-3 HR self-service tabs */}
      <Tabs.Screen name="attendance" options={{ title: "Chấm công" }} />
      <Tabs.Screen name="leave" options={{ title: "Nghỉ phép" }} />
      <Tabs.Screen name="payslips" options={{ title: "Phiếu lương" }} />
      <Tabs.Screen name="kpi" options={{ title: "KPI" }} />
    </Tabs>
  );
}
