// Root layout — loads fonts, sets up the stack. Tabs live in (tabs);
// the single-conversation and reflect screens are pushed on top full-screen.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif/400Regular_Italic';
import { Inter_300Light } from '@expo-google-fonts/inter/300Light';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { colors } from '@/theme/tokens';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { AuthScreen } from '@/screens/AuthScreen';
import { RecordingProvider } from '@/hooks/useRecordAudio';
import { PrivacyProvider } from '@/auth/PrivacyContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded || fontError) void SplashScreen.hideAsync();
  }, [loaded, fontError]);

  // Keep the dawn background visible while fonts load (returning null looks like a blank screen).
  if (!loaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <PrivacyProvider><RecordingProvider>
            <AuthenticatedStack />
          </RecordingProvider></PrivacyProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AuthenticatedStack() {
  const { initializing, session } = useAuth();

  if (initializing) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <Stack
      key={session.user.id}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="conversation" />
      <Stack.Screen name="reflect" />
    </Stack>
  );
}

export { ErrorBoundary } from 'expo-router';
