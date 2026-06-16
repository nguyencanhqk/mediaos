import { Redirect } from "expo-router";
import { useAuth } from "../src/auth/auth-context";
import { ActivityIndicator, View } from "react-native";

/**
 * Root index — redirect to home if authenticated, otherwise to login.
 * Shows a loading indicator while the session is being restored from SecureStore.
 */
export default function RootIndex() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return user ? <Redirect href="/(tabs)/" /> : <Redirect href="/(auth)/login" />;
}
