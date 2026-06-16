import { Tabs } from "expo-router";

/** Authenticated tabs layout — placeholder for M1 screens. */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Trang chủ" }} />
    </Tabs>
  );
}
