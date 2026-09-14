import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Body, Eyebrow, Serif, SerifItalic } from '@/components/Typography';
import { useAuth } from '@/auth/AuthContext';
import { isSupabaseConfigured } from '@/config/env';
import { PRIVACY_URL, TERMS_URL, SUPPORT_URL } from '@/config/legal';
import { fetchAuthStatus } from '@/api/status';
import { colors, fonts } from '@/theme/tokens';

export function AuthScreen() {
  const { sendMagicLink, signInWithPassword, signInWithGoogle, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    // iOS uses our email authentication; social login there needs an equivalent private login option.
    if (Platform.OS !== 'ios') void fetchAuthStatus().then(status => setGoogle(status.googleEnabled)).catch(() => {});
  }, []);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = isSupabaseConfigured && (legacy ? username.trim().length >= 3 && !!password : agreed && emailValid);
  async function submit() {
    if (!canSubmit || sending) return;
    setSending(true); setMessage('');
    try {
      if (legacy) await signInWithPassword(username.trim(), password);
      else {
        await sendMagicLink(email.trim().toLowerCase());
        setMessage('Check your email for a secure sign-in link. It works for both new and existing accounts. Check spam too; use the newest link.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); }
    finally { setSending(false); }
  }
  async function socialLogin() {
    if (!agreed || sending) return;
    setSending(true);
    try { await signInWithGoogle(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setSending(false); }
  }
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Eyebrow>Mirra</Eyebrow>
      <Serif style={styles.title}>More listening.{'\n'}<SerifItalic style={styles.title}>More connection.</SerifItalic></Serif>
      <Body style={styles.copy}>{legacy ? 'Sign in to your existing username account.' : 'A quiet space to reflect on how you connect. Sign in by email — no password to remember.'}</Body>
      {!isSupabaseConfigured && <Body accessibilityRole="alert" style={styles.message}>Sign-in is temporarily unavailable. Please try again later.</Body>}
      {legacy ? <>
        <TextInput accessibilityLabel="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder="Username" style={styles.input} />
        <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" placeholder="Password" style={styles.input} onSubmitEditing={submit} />
      </> : <>
        <TextInput accessibilityLabel="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="Your email address" placeholderTextColor={colors.muted} style={styles.input} onSubmitEditing={submit} />
        <View style={styles.agreement}><Switch value={agreed} onValueChange={setAgreed} accessibilityLabel="I am 18 or older and accept the Terms and Privacy Policy" /><Body style={[styles.copy, { flex: 1 }]}>I am 18 or older and accept the Terms and Privacy Policy.</Body></View>
      </>}
      <Pressable accessibilityRole="button" onPress={submit} disabled={sending || !canSubmit} style={[styles.button, (!canSubmit || sending) && { opacity: 0.5 }]}>
        {sending ? <ActivityIndicator color="#fff" /> : <Body style={styles.buttonText}>{legacy ? 'Sign in' : 'Email me a sign-in link'}</Body>}
      </Pressable>
      {google && !legacy && <Pressable accessibilityRole="button" onPress={socialLogin} disabled={!agreed || sending} style={styles.link}><Body>Continue with Google</Body></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => { setLegacy(!legacy); setMessage(''); }} style={styles.link}><Body>{legacy ? 'Use email instead' : 'Already have a username account?'}</Body></Pressable>
      {message || authError ? <Body accessibilityRole="alert" style={styles.message}>{message || authError}</Body> : null}
      <View style={styles.links}>{[['Privacy', PRIVACY_URL], ['Terms', TERMS_URL], ['Support', SUPPORT_URL]].map(([label, url]) =>
        <Pressable key={label} accessibilityRole="link" onPress={() => { void Linking.openURL(url); }} style={styles.link}><Body style={styles.copy}>{label}</Body></Pressable>)}</View>
      <Body style={styles.copy}>Conversation coaching, not medical or mental-health care. Record only with everyone's permission.</Body>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper }, content: { padding: 24, paddingTop: 70, paddingBottom: 50, gap: 18, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 38, lineHeight: 42, color: colors.ink }, copy: { fontSize: 13, lineHeight: 20, color: colors.ink2 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, padding: 16, color: colors.ink, fontFamily: fonts.body, fontSize: 16 },
  agreement: { flexDirection: 'row', gap: 12, alignItems: 'center' }, button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.terracotta, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15 }, link: { minHeight: 44, justifyContent: 'center' }, links: { flexDirection: 'row', gap: 24 },
  message: { color: colors.ink, fontSize: 14, lineHeight: 21 },
});
