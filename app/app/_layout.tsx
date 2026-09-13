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
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { colors } from '@/theme/tokens';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { AuthScreen } from '@/screens/AuthScreen';
import { RecordingProvider } from '@/hooks/useRecordAudio';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // Keep the dawn background visible while fonts load (returning null looks like a blank screen).
  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <RecordingProvider>
            <AuthenticatedStack />
          </RecordingProvider>
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
