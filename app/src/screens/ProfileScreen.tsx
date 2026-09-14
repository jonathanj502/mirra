// You · profile — identity, stats, settings.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, Switch, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/theme/tokens';
import { deleteAccount, exportAccountData, updateUserSettings } from '@/api/client';
import { saveJsonDownload } from '@/utils/exportData';
import { confirmAction } from '@/utils/confirm';
import { clearPendingRecordings } from '@/storage/pendingRecordings';
import { PRIVACY_URL, TERMS_URL, SUPPORT_URL } from '@/config/legal';
import { usePrivacy } from '@/auth/PrivacyContext';
import { useRecordAudio } from '@/hooks/useRecordAudio';
import { useAuth } from '@/auth/AuthContext';
import { useProfileSummary } from '@/hooks/useProfileSummary';
import { useUserSettings } from '@/hooks/useUserSettings';
import { CoachingDepth, CoachingTone, UserSettings } from '@/models/debrief';

type SettingsPanelId = 'privacy' | 'coaching' | 'help';
type AccountActionId = 'export' | 'signOut' | 'delete';
const TONE_OPTIONS: { value: CoachingTone; label: string; hint: string }[] = [
  { value: 'warm_reflective', label: 'Warm', hint: 'Soft, validating, spacious.' },
  { value: 'direct_practical', label: 'Direct', hint: 'Clear next steps.' },
  { value: 'curious_gentle', label: 'Curious', hint: 'Question-led reflection.' },
];

const DEPTH_OPTIONS: { value: CoachingDepth; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'deep', label: 'Deep' },
];

const toneLabel: Record<CoachingTone, string> = {
  warm_reflective: 'Warm reflective',
  direct_practical: 'Direct practical',
  curious_gentle: 'Curious gentle',
};

function Avatar({ initials = 'MC', size = 84 }: { initials?: string; size?: number }) {
  return (
    <LinearGradient
      colors={['#E8B79E', '#D08866', '#BA7253'] as const}
      locations={[0, 0.7, 1] as const}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Serif style={{ fontSize: size * 0.46, color: '#FBF6EA' }}>{initials}</Serif>
    </LinearGradient>
  );
}

function StatPill({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <View style={styles.statPill}>
      <Serif style={{ fontSize: 24, lineHeight: 24, color: accent }}>{value}</Serif>
      <Body style={styles.statLabel}>{label}</Body>
    </View>
  );
}

function SettingRow({ label, hint, isLast, onPress, disabled }: { label: string; hint?: string; isLast?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.settingRow, !isLast && styles.settingBorder, pressed && styles.settingPressed]}
    >
      <View style={{ flex: 1 }}>
        <Body style={styles.settingLabel}>{label}</Body>
        {hint ? <Body style={styles.settingHint}>{hint}</Body> : null}
      </View>
      <Icon.chevron color="rgba(42,37,32,0.35)" />
    </Pressable>
  );
}

function Check({ color }: { color: string }) {
  return (
    <Svg viewBox="0 0 16 16" width={14} height={14}>
      <Path d="M3 8.5L6.5 12 13 4.5" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segmentOption, selected && styles.segmentOptionSelected]}
          >
            <Body style={[styles.segmentText, selected && styles.segmentTextSelected]}>{option.label}</Body>
          </Pressable>
        );
      })}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={styles.optionLabel}>{label}</Body>
        {hint ? <Body style={styles.optionHint}>{hint}</Body> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(42,37,32,0.14)', true: 'rgba(208,136,102,0.45)' }}
        thumbColor={value ? colors.terracotta : '#F6EFE0'}
      />
    </View>
  );
}

function ChoiceRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress} style={[styles.choiceRow, selected && styles.choiceRowSelected]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={[styles.optionLabel, selected && styles.choiceLabelSelected]}>{label}</Body>
        {hint ? <Body style={styles.optionHint}>{hint}</Body> : null}
      </View>
      {selected ? <Check color={colors.terracotta} /> : null}
    </Pressable>
  );
}

function HelpAction({ label, hint, subject }: { label: string; hint: string; subject: string }) {
  const open = () => {
    void Linking.openURL(SUPPORT_URL);
  };
  return (
    <Pressable onPress={open} style={styles.helpAction}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={styles.optionLabel}>{label}</Body>
        <Body style={styles.optionHint}>{hint}</Body>
      </View>
      <Icon.chevron color="rgba(42,37,32,0.35)" />
    </Pressable>
  );
}

const SETTINGS_TITLES: Record<SettingsPanelId, string> = {
  privacy: 'Voice & Privacy',
  coaching: 'Coaching Tone',
  help: 'Help & Feedback',
};

function settingsTitle(panel: SettingsPanelId | null) {
  return panel ? SETTINGS_TITLES[panel] : '';
}

function privacyHint(settings: UserSettings) {
  if (!settings.saveTranscripts) return 'Transcripts off · audio discarded';
  return settings.includeTranscriptInReflect ? 'Transcripts saved · Reflect can use excerpts' : 'Transcripts saved · Reflect uses summaries';
}

function SettingsSheet({
  panel,
  settings,
  loading,
  saving,
  error,
  onClose,
  onChange,
}: {
  panel: SettingsPanelId | null;
  settings: UserSettings;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (patch: Partial<UserSettings>) => void;
}) {
  const visible = panel !== null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetScrim}>
        <View style={styles.sheet}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleCluster}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Eyebrow>Settings</Eyebrow>
                <Serif style={styles.sheetTitle}>{settingsTitle(panel)}</Serif>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Body style={styles.closeText}>Done</Body>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.sheetLoading}>
              <ActivityIndicator color={colors.terracotta} />
            </View>
          ) : null}

          {!loading && panel === 'privacy' ? (
            <View style={styles.sheetBody}>
              <SwitchRow
                label="Save transcripts"
                hint="Keep transcript text with each debrief."
                value={settings.saveTranscripts}
                onChange={(value) => onChange({ saveTranscripts: value })}
              />
              <SwitchRow
                label="Use transcript in Reflect"
                hint="Send saved transcript excerpts to OpenAI with your Reflect messages."
                value={settings.includeTranscriptInReflect}
                onChange={(value) => onChange({ includeTranscriptInReflect: value })}
              />
              <View style={styles.factBox}>
                <Body style={styles.factTitle}>Audio handling</Body>
                <Body style={styles.factText}>Audio goes to Mirra and OpenAI for transcription. Our backend deletes temporary audio after processing. OpenAI may retain text requests for abuse monitoring. AI estimates may be wrong; the loudest speaker is assumed to be you.</Body>
              </View>
            </View>
          ) : null}

          {!loading && panel === 'coaching' ? (
            <View style={styles.sheetBody}>
              <View style={styles.optionBlock}>
                <Body style={styles.optionCaption}>Tone</Body>
                <View style={{ gap: 8 }}>
                  {TONE_OPTIONS.map((option) => (
                    <ChoiceRow
                      key={option.value}
                      label={option.label}
                      hint={option.hint}
                      selected={settings.coachingTone === option.value}
                      onPress={() => onChange({ coachingTone: option.value })}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.optionBlock}>
                <Body style={styles.optionCaption}>Depth</Body>
                <Segment options={DEPTH_OPTIONS} value={settings.coachingDepth} onChange={(value) => onChange({ coachingDepth: value })} />
              </View>
            </View>
          ) : null}

          {!loading && panel === 'help' ? (
            <View style={styles.sheetBody}>
              <HelpAction label="Send feedback" hint="Tell us what felt useful or odd." subject="Mirra feedback" />
              <HelpAction label="Report an issue" hint="Share what broke and where." subject="Mirra issue report" />
              <HelpAction label="Privacy question" hint="Ask about data, audio, or transcripts." subject="Mirra privacy question" />
            </View>
          ) : null}

          <View style={styles.sheetFooter}>
            {saving ? <Body style={styles.saveState}>Saving…</Body> : null}
            {error ? <Body style={styles.errorText}>{error}</Body> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AccountActionRow({
  label,
  hint,
  loading,
  destructive,
  isLast,
  onPress,
}: {
  label: string;
  hint: string;
  loading?: boolean;
  destructive?: boolean;
  isLast?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.accountAction, !isLast && styles.accountActionBorder, pressed && styles.settingPressed]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={[styles.accountActionLabel, destructive && styles.accountActionDanger]}>{label}</Body>
        <Body style={styles.accountActionHint}>{hint}</Body>
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.terracotta} /> : <Icon.chevron color="rgba(42,37,32,0.35)" />}
    </Pressable>
  );
}

function AccountMenu({
  visible,
  label,
  busy,
  note,
  error,
  onClose,
  onExport,
  onHelp,
  onSignOut,
  onDelete,
}: {
  visible: boolean;
  label: string;
  busy: AccountActionId | null;
  note: string | null;
  error: string | null;
  onClose: () => void;
  onExport: () => void;
  onHelp: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.menuScrim}>
        <View style={styles.accountMenu}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow>Account</Eyebrow>
              <Serif style={styles.sheetTitle}>Mirra Member</Serif>
              <Body style={styles.accountMenuSubtext}>{label}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Body style={styles.closeText}>Done</Body>
            </Pressable>
          </View>

          <View style={styles.accountActionList}>
            <AccountActionRow
              label="Download my data"
              hint="Conversations and settings."
              loading={busy === 'export'}
              onPress={onExport}
            />
            <AccountActionRow
              label="Help & feedback"
              hint="Contact, issue reports, and privacy questions."
              onPress={onHelp}
            />
            <AccountActionRow
              label="Sign out"
              hint="Leave this device signed out."
              loading={busy === 'signOut'}
              destructive
              onPress={onSignOut}
            />
            <AccountActionRow label="Delete account" hint="Permanently remove your account and all saved conversations." destructive isLast loading={busy === 'delete'} onPress={onDelete} />
          </View>

          <View style={styles.sheetFooter}>
            {note ? <Body style={styles.saveState}>{note}</Body> : null}
            {error ? <Body style={styles.errorText}>{error}</Body> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ProfileScreen() {
  const { user, accessToken, signOut } = useAuth();
  const { canProcess, reviewConsent, withdrawLocally } = usePrivacy();
  const { isRecording, hasUnsavedRecording, isSavingRecording, pauseUploads, resumeUploads } = useRecordAudio();
  const { summary, loading: summaryLoading, error: summaryError, refresh: refreshSummary } = useProfileSummary();
  const { settings, loading: settingsLoading, saving: settingsSaving, error: settingsError, loadError: settingsLoadError,
    refresh: refreshSettings, updateSettings } = useUserSettings(accessToken);
  const [activePanel, setActivePanel] = useState<SettingsPanelId | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState<AccountActionId | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const username = typeof user?.user_metadata?.username === 'string' ? user.user_metadata.username : null;
  const label = username ? `@${username}` : user?.email ?? 'signed in';
  const initials = (username ?? user?.email ?? 'MI').slice(0, 2).toUpperCase();
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    : 'Now';
  const summaryReady = summary !== null && !summaryError;
  const settingsReady = !settingsLoading && !settingsLoadError;
  const settingsHint = settingsLoading ? 'Loading settings…' : 'Settings unavailable';
  const used = summaryReady ? String(summary.usedThisMonth) : '—';
  const handleAccountExport = async () => {
    if (!accessToken) return;
    setAccountBusy('export');
    setAccountError(null);
    setAccountNote(null);
    try {
      const data = await exportAccountData(accessToken);
      const day = new Date().toISOString().slice(0, 10);
      await saveJsonDownload(`mirra-account-${day}.json`, data);
      setAccountNote('Data export ready');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not export data');
    } finally {
      setAccountBusy(null);
    }
  };
  const handleAccountHelp = () => {
    setAccountMenuOpen(false);
    setActivePanel('help');
  };
  const handleAccountSignOut = async () => {
    setAccountBusy('signOut');
    setAccountError(null);
    try {
      await signOut();
      setAccountMenuOpen(false);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not sign out');
    } finally {
      setAccountBusy(null);
    }
  };

  async function handleDeleteAccount() {
    if (!user || !accessToken || accountBusy) return;
    if (isRecording || hasUnsavedRecording || isSavingRecording) {
      setAccountError('Stop and save your recording before deleting your account.'); return;
    }
    if (!await confirmAction('Delete your account?', 'This permanently deletes your account, conversations, transcripts, settings and recordings saved on this device. It cannot be undone.', 'Delete account', true)) return;
    setAccountBusy('delete'); setAccountError(null); pauseUploads();
    try {
      await deleteAccount(accessToken);
      await clearPendingRecordings(user.id);
      await withdrawLocally();
      await signOut();
      setAccountMenuOpen(false);
    } catch (err) { setAccountError(err instanceof Error ? err.message : 'Could not finish account deletion. Please try again.'); }
    finally { resumeUploads(); setAccountBusy(null); }
  }

  async function withdrawConsent() {
    if (!accessToken) return;
    try {
      await updateUserSettings(accessToken, { aiConsentVersion: '' });
      await withdrawLocally();
    } catch (err) { setAccountError(err instanceof Error ? err.message : 'Could not save your privacy choice.'); }
  }

  return (
    <Screen topOffset={50} error={summaryError || settingsLoadError}
      onRefresh={() => { void refreshSummary(); void refreshSettings(); }} refreshing={summaryLoading || settingsLoading}>
      {/* Header */}
      <View style={styles.header}>
        <Eyebrow>You</Eyebrow>
        <Pressable
          onPress={() => {
            setAccountError(null);
            setAccountNote(null);
            setAccountMenuOpen(true);
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Account actions"
          style={({ pressed }) => [styles.headerIconButton, pressed && styles.settingPressed]}
        >
          <Icon.dots color={colors.muted} />
        </Pressable>
      </View>

      {/* Identity */}
      <View style={styles.identity}>
        <Avatar initials={initials} size={84} />
        <View style={{ alignItems: 'center' }}>
          <Serif style={styles.name}>
            Mirra <SerifItalic style={styles.name}>Member</SerifItalic>
          </Serif>
          <Body style={styles.email}>{label}</Body>
        </View>
        <SerifItalic style={styles.tagline}>"Listening more, talking with care."</SerifItalic>
      </View>

      {/* Stats */}
      <View style={styles.stats}>
        <StatPill value={summaryReady ? String(summary.totalConversations) : '—'} label="Conversations" accent={colors.terracotta} />
        <StatPill value={used} label="Used this month" accent={colors.sage} />
        <StatPill value={memberSince} label="Member since" accent={colors.lavender} />
      </View>

      {/* Settings */}
      <View style={styles.settingsWrap}>
        <Eyebrow style={{ marginBottom: 6 }}>Settings</Eyebrow>
        <Card style={styles.settingsCard}>
          <SettingRow label="Voice & privacy" disabled={!settingsReady} hint={settingsReady ? privacyHint(settings) : settingsHint} onPress={() => setActivePanel('privacy')} />
          <SettingRow label="Coaching tone" disabled={!settingsReady} hint={settingsReady ? toneLabel[settings.coachingTone] : settingsHint} onPress={() => setActivePanel('coaching')} />
          <SettingRow label="Help & feedback" hint="Contact, issues, privacy" onPress={() => setActivePanel('help')} isLast />
        </Card>
      </View>

      <SettingsSheet
        panel={activePanel}
        settings={settings}
        loading={settingsLoading}
        saving={settingsSaving}
        error={settingsError}
        onClose={() => setActivePanel(null)}
        onChange={(patch) => {
          void updateSettings(patch);
        }}
      />

      <View style={{ paddingHorizontal: 24, gap: 8 }}>
        <SettingRow label={canProcess ? 'Withdraw AI processing consent' : 'Review AI processing'} hint={canProcess ? 'Stop future uploads and Reflect requests. Saved data stays available.' : 'Required before recording, importing, or using Reflect.'} onPress={() => { if (canProcess) void withdrawConsent(); else reviewConsent(); }} />
        {accountError && !accountMenuOpen ? <Body accessibilityRole="alert">{accountError}</Body> : null}
        {[['Privacy Policy', PRIVACY_URL], ['Terms of Use', TERMS_URL]].map(([label, url]) => <SettingRow key={label} label={label} onPress={() => { void Linking.openURL(url); }} />)}
      </View>

      <AccountMenu
        visible={accountMenuOpen}
        label={label}
        busy={accountBusy}
        note={accountNote}
        error={accountError}
        onClose={() => setAccountMenuOpen(false)}
        onExport={() => {
          void handleAccountExport();
        }}
        onHelp={handleAccountHelp}
        onSignOut={() => {
          void handleAccountSignOut();
        }}
        onDelete={() => { void handleDeleteAccount(); }}
      />

      <View style={styles.footer}>
        <Pressable onPress={signOut} hitSlop={8}>
          <Body style={styles.signOut}>Sign out</Body>
        </Pressable>
        <Body style={styles.version}>Mirra v1.0.0</Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerIconButton: { width: 36, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  identity: { paddingHorizontal: 22, paddingTop: 14, alignItems: 'center', gap: 12 },
  avatar: {
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#BA7253', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 22, elevation: 8,
  },
  name: { fontSize: 28, lineHeight: 31, color: colors.ink },
  email: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  tagline: { fontSize: 13.5, color: colors.ink2, lineHeight: 20, maxWidth: 280, marginTop: 2, textAlign: 'center' },
  stats: { paddingHorizontal: 22, paddingTop: 18, flexDirection: 'row', gap: 10 },
  statPill: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: colors.card, borderRadius: 16, alignItems: 'center' },
  statLabel: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6 },

  settingsWrap: { paddingHorizontal: 22, paddingTop: 20 },
  settingsCard: { paddingVertical: 4, paddingHorizontal: 16 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  settingPressed: { opacity: 0.7 },
  settingBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline2 },
  settingLabel: { fontSize: 14.5, color: colors.ink },
  settingHint: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  sheetScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(42,37,32,0.24)' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  sheetGrabber: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(42,37,32,0.16)', marginBottom: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  sheetTitleCluster: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetBackButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(42,37,32,0.06)' },
  sheetTitle: { fontSize: 24, lineHeight: 28, color: colors.ink, marginTop: 4 },
  closeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card },
  closeText: { fontSize: 12.5, color: colors.ink2, fontFamily: fonts.bodyMedium },
  sheetLoading: { paddingVertical: 36, alignItems: 'center' },
  sheetBody: { paddingTop: 16, gap: 12 },
  sheetFooter: { minHeight: 22, paddingTop: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  optionBlock: { gap: 8, paddingTop: 4 },
  optionCaption: { fontSize: 11, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fonts.bodyMedium },
  optionLabel: { fontSize: 14.5, color: colors.ink, lineHeight: 19 },
  optionHint: { fontSize: 11.5, color: colors.muted, marginTop: 2, lineHeight: 16 },
  scheduleSettingList: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline2 },
  scheduleSettingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  scheduleSettingBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline2 },
  scheduleSettingValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, flexShrink: 0 },
  scheduleSettingValue: { maxWidth: 160, fontSize: 12.5, color: colors.terracotta, fontFamily: fonts.bodyMedium, lineHeight: 17, textAlign: 'right' },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 16, backgroundColor: 'rgba(42,37,32,0.07)' },
  segmentOption: { flex: 1, minHeight: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOptionSelected: { backgroundColor: colors.card },
  segmentText: { fontSize: 12.5, color: colors.muted, fontFamily: fonts.bodyMedium },
  segmentTextSelected: { color: colors.ink },
  choiceList: { gap: 8 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.hairline2, backgroundColor: 'rgba(255,255,255,0.22)' },
  choiceRowSelected: { borderColor: 'rgba(208,136,102,0.55)', backgroundColor: 'rgba(208,136,102,0.10)' },
  choiceLabelSelected: { color: colors.terracotta },
  factBox: { padding: 14, borderRadius: 14, backgroundColor: 'rgba(151,168,135,0.14)', marginTop: 4 },
  factTitle: { fontSize: 13, color: colors.ink, fontFamily: fonts.bodyMedium },
  factText: { fontSize: 12, color: colors.ink2, lineHeight: 18, marginTop: 3 },
  helpAction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.hairline2 },
  menuScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(42,37,32,0.22)' },
  accountMenu: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  accountMenuSubtext: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  accountActionList: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.hairline2 },
  accountAction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  accountActionBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline2 },
  accountActionLabel: { fontSize: 14.5, color: colors.ink, fontFamily: fonts.bodyMedium, lineHeight: 19 },
  accountActionDanger: { color: colors.terracotta },
  accountActionHint: { fontSize: 11.5, color: colors.muted, marginTop: 2, lineHeight: 16 },
  saveState: { fontSize: 11.5, color: colors.muted },
  errorText: { fontSize: 11.5, color: colors.terracotta, lineHeight: 16 },
  footer: { paddingHorizontal: 22, paddingTop: 14, alignItems: 'center' },
  signOut: { fontSize: 12.5, color: colors.muted },
  version: { fontSize: 10.5, color: colors.muted, marginTop: 14, letterSpacing: 0.3, opacity: 0.7 },
});
