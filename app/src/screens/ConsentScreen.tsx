import React, { useState } from 'react';
import { Linking, Pressable, View, StyleSheet, Switch } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Serif, Eyebrow } from '@/components/Typography';
import { colors } from '@/theme/tokens';
import { CONSENT_VERSION, PRIVACY_URL, TERMS_URL } from '@/config/legal';
import { updateUserSettings } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { friendlyErrorMessage } from '@/api/http';

export function ConsentScreen({ onAccepted, onDismiss }: { onAccepted: () => void; onDismiss: () => void }) {
  const { accessToken } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    if (!agreed || busy || !accessToken) return;
    setBusy(true);
    try {
      await updateUserSettings(accessToken, { aiConsentVersion: CONSENT_VERSION });
      onAccepted();
    } catch (err) { setError(friendlyErrorMessage(err, 'Could not save your choice.')); }
    finally { setBusy(false); }
  }
  return <Screen error={error} topOffset={64}>
    <View style={styles.content}>
      <Eyebrow>Before your first conversation</Eyebrow>
      <Serif style={styles.title}>A little care, before you record.</Serif>
      <Body style={styles.copy}>Ask everyone before recording. You must have permission from every participant to record and share the conversation for AI processing.</Body>
      <Body style={styles.copy}>Mirra sends recordings to our server and OpenAI for transcription. Transcripts and conversation statistics are sent to OpenAI for coaching; Reflect sends your messages and debrief context. Supabase stores your account and saved debriefs.</Body>
      <Body style={styles.copy}>Stopped recordings stay on this device until uploaded or discarded. Our backend removes temporary audio after processing. OpenAI may retain text requests for abuse monitoring under its data policy. Transcripts are not saved in your history unless you turn that on.</Body>
      <Body style={styles.copy}>Insights are estimates, not facts about a person or medical advice. Mirra assumes the loudest speaker is you. Keep the microphone near you and check the result; speaker identity, emotions, interruptions, and other metrics may be wrong.</Body>
      <View style={styles.choice}><Switch value={agreed} onValueChange={setAgreed} accessibilityLabel="I am 18 or older, accept the Terms and Privacy Policy, and consent to OpenAI processing" />
        <Body style={[styles.copy, { flex: 1 }]}>I am 18 or older, accept the Terms and Privacy Policy, and agree to this AI processing. I can withdraw consent in Profile.</Body></View>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(PRIVACY_URL); }} style={styles.link}><Body>Read the Privacy Policy</Body></Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(TERMS_URL); }} style={styles.link}><Body>Read the Terms</Body></Pressable>
      <Pressable accessibilityRole="button" disabled={!agreed || busy} onPress={accept} style={[styles.button, (!agreed || busy) && { opacity: 0.5 }]}><Body style={{ color: '#fff' }}>{busy ? 'Saving…' : 'Agree and continue'}</Body></Pressable>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.link}><Body>Continue without AI processing</Body></Pressable>
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, gap: 18 }, title: { fontSize: 34, lineHeight: 38 },
  copy: { fontSize: 14, lineHeight: 22, color: colors.ink2 }, choice: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  link: { minHeight: 44, justifyContent: 'center' },
  button: { backgroundColor: colors.terracotta, borderRadius: 16, padding: 18, alignItems: 'center' },
});
