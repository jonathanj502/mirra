import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { reportContent } from '@/api/client';
import { friendlyErrorMessage } from '@/api/http';
import { ContentReport } from '@/models/debrief';
import { colors } from '@/theme/tokens';
import { Screen } from './Screen';
import { Body, Serif } from './Typography';

export function ReportContent({ content, source, debriefId }: { content: string; source: ContentReport['source']; debriefId?: string }) {
  const { accessToken } = useAuth();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<ContentReport['reason']>('harmful');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit() {
    if (!accessToken || submitting.current || sent) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      await reportContent(accessToken, { source, content, debriefId, reason, comment: comment.trim() });
      setSent(true);
    } catch (err) { setError(friendlyErrorMessage(err, 'Your report was not sent. Please try again.')); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Report response" onPress={() => setVisible(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Body style={{ color: colors.ink2, fontSize: 12 }}>{sent ? 'Response reported' : 'Report response'}</Body></Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) setVisible(false); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen error={error} topOffset={64}><View style={{ paddingHorizontal: 24, gap: 16 }}>
        <Serif style={{ fontSize: 32 }}>{sent ? 'Report received.' : 'Report this response'}</Serif>
        {sent ? <Body>Thank you. Your report is saved for Mirra to review. Reporting is not an emergency support service.</Body> : <>
          <Body>Send the response below, your reason and optional note to Mirra for private review. Your full recording or transcript is not attached. Reports are linked to your account and removed when you delete the linked conversation or your account.</Body>
          <Body selectable style={{ padding: 16, borderRadius: 12, backgroundColor: colors.card, fontSize: 14 }}>{content}</Body>
          {([['harmful', 'Harmful or offensive'], ['inaccurate', 'Incorrect or misleading'], ['other', 'Something else']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" aria-checked={reason === value} disabled={busy} onPress={() => setReason(value)} style={{ minHeight: 44, justifyContent: 'center' }}><Body>{reason === value ? '● ' : '○ '}{label}</Body></Pressable>)}
          <TextInput accessibilityLabel="Optional report details" placeholder="Add a note (optional)" placeholderTextColor={colors.muted} value={comment} onChangeText={setComment} maxLength={1000} multiline editable={!busy} style={{ minHeight: 96, borderWidth: 1, borderColor: colors.hairline, color: colors.ink, borderRadius: 12, padding: 12 }} />
          <Pressable accessibilityRole="button" disabled={busy || !accessToken} onPress={submit} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: colors.terracotta }}><Body style={{ color: '#fff' }}>{busy ? 'Sending…' : 'Send report'}</Body></Pressable>
        </>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setVisible(false)} style={{ minHeight: 44, justifyContent: 'center' }}><Body>{sent ? 'Done' : 'Cancel'}</Body></Pressable>
      </View></Screen>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
