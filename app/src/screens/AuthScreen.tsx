import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Body, Eyebrow, Serif, SerifItalic } from '@/components/Typography';
import { colors, fonts } from '@/theme/tokens';
import { isSupabaseConfigured } from '@/config/env';
import { useAuth } from '@/auth/AuthContext';
import { AuthStatus, fetchAuthStatus } from '@/api/status';

type Mode = 'sign-in' | 'sign-up';

export function AuthScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const isSignUp = mode === 'sign-up';
  const usernameReady = status?.usernamePasswordReady ?? true;
  const googleReady = status?.googleEnabled ?? true;
  const canSubmit = isSupabaseConfigured && usernameReady && username.trim().length >= 3 && password.length >= 6;

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchAuthStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function submit() {
    const name = username.trim();
    if (!canSubmit || sending) return;
    setSending(true);
    setMessage('');
    try {
      if (isSignUp) {
        await signUpWithPassword(name, password);
        setMessage('Account created.');
      } else {
        await signInWithPassword(name, password);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Try again in a moment.';
      setMessage(`${isSignUp ? 'Could not create your account.' : 'Could not sign you in.'} ${reason}`);
    } finally {
      setSending(false);
    }
  }

  async function continueWithGoogle() {
    if (sending || !isSupabaseConfigured || !googleReady) {
      if (!googleReady) setMessage('Google sign-in is not enabled in Supabase yet.');
      return;
    }
    setSending(true);
    setMessage('');
    try {
      await signInWithGoogle();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Try again in a moment.';
      setMessage(`Could not start Google sign-in. ${reason}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Eyebrow>Mirra</Eyebrow>
        <Serif style={styles.title}>
          {isSignUp ? 'Create your' : 'Sign in to'}{'\n'}
          <SerifItalic style={styles.title}>your conversations.</SerifItalic>
        </Serif>
        <Body style={styles.copy}>
          Use a username and password, or continue with Google. Your debriefs and monthly usage stay attached to your account.
        </Body>

        {!isSupabaseConfigured ? (
          <View style={styles.notice}>
            <Body style={styles.noticeText}>
              Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.
            </Body>
          </View>
        ) : (
          <>
            {!usernameReady ? (
              <View style={styles.notice}>
                <Body style={styles.noticeText}>
                  Username sign-up needs the backend Supabase service-role key.
                </Body>
              </View>
            ) : null}

            <View style={styles.modeSwitch}>
              <Pressable onPress={() => setMode('sign-in')} style={[styles.modeButton, mode === 'sign-in' && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === 'sign-in' && styles.modeTextActive]}>Sign in</Body>
              </Pressable>
              <Pressable onPress={() => setMode('sign-up')} style={[styles.modeButton, mode === 'sign-up' && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === 'sign-up' && styles.modeTextActive]}>Sign up</Body>
              </Pressable>
            </View>

            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username"
              placeholder="username"
              placeholderTextColor={colors.muted}
              style={styles.input}
              returnKeyType="next"
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType={isSignUp ? 'newPassword' : 'password'}
              autoComplete={isSignUp ? 'new-password' : 'password'}
              placeholder="password"
              placeholderTextColor={colors.muted}
              style={styles.input}
              onSubmitEditing={submit}
            />

            <Pressable onPress={submit} disabled={sending || !canSubmit} style={[styles.button, (!canSubmit || sending) && styles.buttonDisabled]}>
              {sending ? <ActivityIndicator size="small" color="#FBF6EA" /> : <Body style={styles.buttonText}>{isSignUp ? 'Create account' : 'Sign in'}</Body>}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Body style={styles.dividerText}>or</Body>
              <View style={styles.divider} />
            </View>

            <Pressable onPress={continueWithGoogle} disabled={sending || !googleReady} style={[styles.googleButton, (sending || !googleReady) && styles.buttonDisabled]}>
              <Body style={styles.googleText}>{googleReady ? 'Continue with Google' : 'Google sign-in not enabled'}</Body>
            </Pressable>
          </>
        )}

        {message ? <Body style={styles.message}>{message}</Body> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, justifyContent: 'center', padding: 24 },
  content: { gap: 16 },
  title: { fontSize: 36, lineHeight: 39, color: colors.ink },
  copy: { fontSize: 14, lineHeight: 21, color: colors.ink2, maxWidth: 330 },
  modeSwitch: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(42,37,32,0.06)',
    gap: 4,
  },
  modeButton: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { backgroundColor: colors.card },
  modeText: { fontSize: 13, color: colors.muted, fontFamily: fonts.bodyMedium },
  modeTextActive: { color: colors.ink },
  input: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  button: { height: 50, borderRadius: 14, backgroundColor: colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#FBF6EA', fontFamily: fonts.bodySemibold, fontSize: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  googleButton: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleText: { color: colors.ink, fontFamily: fonts.bodySemibold, fontSize: 14 },
  message: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  notice: { borderRadius: 14, backgroundColor: 'rgba(208,136,102,0.12)', padding: 14 },
  noticeText: { color: colors.ink2, fontSize: 12.5, lineHeight: 18 },
});
