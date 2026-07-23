// You · profile — identity, stats, subscription, settings.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, Switch, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/theme/tokens';
import { exportAccountData } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useBilling } from '@/hooks/useBilling';
import { useProfileSummary } from '@/hooks/useProfileSummary';
import { useUserSettings } from '@/hooks/useUserSettings';
import { CoachingDepth, CoachingTone, UserSettings, WeeklySummaryDay, WeeklySummaryTime } from '@/models/debrief';

type SettingsPanelId = 'notifications' | 'privacy' | 'coaching' | 'help';
type AccountActionId = 'export' | 'billing' | 'signOut';
type SchedulePickerId = 'day' | 'time';

const DAY_OPTIONS: { value: WeeklySummaryDay; label: string }[] = [
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
];

const TIME_OPTIONS: { value: WeeklySummaryTime; label: string; hint: string }[] = [
  { value: 'early_morning', label: 'Early morning', hint: '7 AM' },
  { value: 'morning', label: 'Morning', hint: '9 AM' },
  { value: 'midday', label: 'Midday', hint: '12 PM' },
  { value: 'afternoon', label: 'Afternoon', hint: '3 PM' },
  { value: 'evening', label: 'Evening', hint: '6 PM' },
  { value: 'night', label: 'Night', hint: '9 PM' },
];

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

const dayLabel = Object.fromEntries(DAY_OPTIONS.map((option) => [option.value, option.label])) as Record<WeeklySummaryDay, string>;
const timeLabel: Record<WeeklySummaryTime, string> = {
  early_morning: 'early morning',
  morning: 'morning',
  midday: 'midday',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
};
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

function SettingRow({ label, hint, isLast, onPress }: { label: string; hint?: string; isLast?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
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
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(42,37,32,0.14)', true: 'rgba(208,136,102,0.45)' }}
        thumbColor={value ? colors.terracotta : '#F6EFE0'}
      />
    </View>
  );
}

function ScheduleSettingRow({
  label,
  value,
  isLast,
  onPress,
}: {
  label: string;
  value: string;
  isLast?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.scheduleSettingRow, !isLast && styles.scheduleSettingBorder, pressed && styles.settingPressed]}
    >
      <Body style={styles.optionLabel}>{label}</Body>
      <View style={styles.scheduleSettingValueRow}>
        <Body style={styles.scheduleSettingValue}>{value}</Body>
        <Icon.chevron color="rgba(42,37,32,0.35)" />
      </View>
    </Pressable>
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
    <Pressable onPress={onPress} style={[styles.choiceRow, selected && styles.choiceRowSelected]}>
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
    const encoded = encodeURIComponent(subject);
    void Linking.openURL(`mailto:hello@mirra.app?subject=${encoded}`);
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
  notifications: 'Notifications',
  privacy: 'Voice & Privacy',
  coaching: 'Coaching Tone',
  help: 'Help & Feedback',
};

function settingsTitle(panel: SettingsPanelId | null) {
  return panel ? SETTINGS_TITLES[panel] : '';
}

function notificationsHint(settings: UserSettings) {
  if (!settings.notificationsEnabled) return 'Off';
  return `Weekly summary ${dayLabel[settings.weeklySummaryDay]} · ${timeLabel[settings.weeklySummaryTime]}`;
}

function summaryTimeValue(value: WeeklySummaryTime) {
  const option = TIME_OPTIONS.find((item) => item.value === value);
  return option ? `${option.label} · ${option.hint}` : timeLabel[value];
}

function privacyHint(settings: UserSettings) {
  if (!settings.saveTranscripts) return 'Transcripts off · audio discarded';
  return settings.includeTranscriptInReflect ? 'Transcripts saved · Reflect can use excerpts' : 'Transcripts saved · Reflect uses summaries';
}

function shortBillingDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function saveJsonDownload(filename: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(href);
    return;
  }
  void Linking.openURL(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`);
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
  const [schedulePicker, setSchedulePicker] = useState<SchedulePickerId | null>(null);
  const pickingSchedule = panel === 'notifications' && schedulePicker !== null;
  const sheetTitle = pickingSchedule ? (schedulePicker === 'day' ? 'Summary Day' : 'Summary Time') : settingsTitle(panel);

  useEffect(() => {
    if (panel !== 'notifications') {
      setSchedulePicker(null);
    }
  }, [panel]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetScrim}>
        <View style={styles.sheet}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleCluster}>
              {pickingSchedule ? (
                <Pressable onPress={() => setSchedulePicker(null)} hitSlop={8} style={styles.sheetBackButton}>
                  <Icon.back color={colors.ink2} />
                </Pressable>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Eyebrow>{pickingSchedule ? 'Notifications' : 'Settings'}</Eyebrow>
                <Serif style={styles.sheetTitle}>{sheetTitle}</Serif>
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

          {!loading && panel === 'notifications' && schedulePicker === null ? (
            <View style={styles.sheetBody}>
              <SwitchRow
                label="Weekly summary"
                hint="A short review of recent conversation patterns."
                value={settings.notificationsEnabled}
                onChange={(value) => onChange({ notificationsEnabled: value })}
              />
              <View style={styles.scheduleSettingList}>
                <ScheduleSettingRow
                  label="Summary day"
                  value={dayLabel[settings.weeklySummaryDay]}
                  onPress={() => setSchedulePicker('day')}
                />
                <ScheduleSettingRow
                  label="Summary time"
                  value={summaryTimeValue(settings.weeklySummaryTime)}
                  isLast
                  onPress={() => setSchedulePicker('time')}
                />
              </View>
              <SwitchRow
                label="Reflection nudges"
                hint="Light reminders to revisit a saved debrief."
                value={settings.reflectionReminders}
                onChange={(value) => onChange({ reflectionReminders: value })}
              />
              <SwitchRow
                label="Product updates"
                hint="Occasional notes about new Mirra features."
                value={settings.productUpdates}
                onChange={(value) => onChange({ productUpdates: value })}
              />
            </View>
          ) : null}

          {!loading && panel === 'notifications' && schedulePicker === 'day' ? (
            <View style={styles.sheetBody}>
              <View style={styles.choiceList}>
                {DAY_OPTIONS.map((option) => (
                  <ChoiceRow
                    key={option.value}
                    label={option.label}
                    selected={settings.weeklySummaryDay === option.value}
                    onPress={() => {
                      onChange({ weeklySummaryDay: option.value });
                      setSchedulePicker(null);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {!loading && panel === 'notifications' && schedulePicker === 'time' ? (
            <View style={styles.sheetBody}>
              <View style={styles.choiceList}>
                {TIME_OPTIONS.map((option) => (
                  <ChoiceRow
                    key={option.value}
                    label={option.label}
                    hint={option.hint}
                    selected={settings.weeklySummaryTime === option.value}
                    onPress={() => {
                      onChange({ weeklySummaryTime: option.value });
                      setSchedulePicker(null);
                    }}
                  />
                ))}
              </View>
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
                hint="Let Mirra use short excerpts for context."
                value={settings.includeTranscriptInReflect}
                onChange={(value) => onChange({ includeTranscriptInReflect: value })}
              />
              <View style={styles.factBox}>
                <Body style={styles.factTitle}>Audio handling</Body>
                <Body style={styles.factText}>Audio is uploaded for debrief processing, then discarded by the backend.</Body>
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
  planLabel,
  busy,
  note,
  error,
  onClose,
  onExport,
  onBilling,
  onHelp,
  onSignOut,
}: {
  visible: boolean;
  label: string;
  planLabel: string;
  busy: AccountActionId | null;
  note: string | null;
  error: string | null;
  onClose: () => void;
  onExport: () => void;
  onBilling: () => void;
  onHelp: () => void;
  onSignOut: () => void;
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
              <Body style={styles.accountMenuSubtext}>{label} · {planLabel}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Body style={styles.closeText}>Done</Body>
            </Pressable>
          </View>

          <View style={styles.accountActionList}>
            <AccountActionRow
              label="Download my data"
              hint="Conversations, settings, and plan details."
              loading={busy === 'export'}
              onPress={onExport}
            />
            <AccountActionRow
              label="Manage plan"
              hint="Open billing or start Mirra Pro."
              loading={busy === 'billing'}
              onPress={onBilling}
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
              isLast
              onPress={onSignOut}
            />
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
  const { summary } = useProfileSummary();
  const { settings, loading: settingsLoading, saving: settingsSaving, error: settingsError, updateSettings } = useUserSettings(accessToken);
  const { billing, loading: billingLoading, opening: billingOpening, error: billingError, startCheckout, openPortal } = useBilling(accessToken);
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
  const used = summary?.usedThisMonth ?? 0;
  const remaining = summary?.remaining ?? 5;
  const isPro = billing?.isPro ?? false;
  const freeRemaining = billing?.freeConversationsRemaining ?? remaining;
  const trialEnd = shortBillingDate(billing?.trialEnd);
  const periodEnd = shortBillingDate(billing?.currentPeriodEnd);
  const planDescription = isPro
    ? billing?.status === 'trialing' && trialEnd
      ? `Trial ends ${trialEnd} · unlimited conversations`
      : billing?.cancelAtPeriodEnd && periodEnd
        ? `Active until ${periodEnd} · unlimited conversations`
        : 'Unlimited conversations · full history · Pro metrics'
    : `${freeRemaining} conversations remaining this month · 7-day history · core metrics`;
  const billingNote = billingError ?? (isPro ? 'Manage billing, invoices, and cancellation in Stripe' : 'Cancel anytime · No charge until day 15');
  const billingCta = billingOpening ? 'Opening…' : isPro ? 'Manage plan' : 'Try Pro free for 14 days';
  const planLabel = isPro ? 'Mirra Pro' : 'Mirra Free';
  const handleBillingPress = async () => {
    const url = isPro ? await openPortal() : await startCheckout();
    if (url) {
      void Linking.openURL(url);
    }
  };
  const handleAccountExport = async () => {
    if (!accessToken) return;
    setAccountBusy('export');
    setAccountError(null);
    setAccountNote(null);
    try {
      const data = await exportAccountData(accessToken);
      const day = new Date().toISOString().slice(0, 10);
      saveJsonDownload(`mirra-account-${day}.json`, data);
      setAccountNote('Data export ready');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not export data');
    } finally {
      setAccountBusy(null);
    }
  };
  const handleAccountBilling = async () => {
    setAccountBusy('billing');
    setAccountError(null);
    setAccountNote(null);
    const url = isPro ? await openPortal() : await startCheckout();
    setAccountBusy(null);
    if (url) {
      void Linking.openURL(url);
    } else {
      setAccountError('Could not open billing');
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

  return (
    <Screen topOffset={50}>
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
        <StatPill value={String(summary?.totalConversations ?? 0)} label="Conversations" accent={colors.terracotta} />
        <StatPill value={String(used)} label="Used this month" accent={colors.sage} />
        <StatPill value={memberSince} label="Member since" accent={colors.lavender} />
      </View>

      {/* Subscription */}
      <View style={styles.subWrap}>
        <LinearGradient colors={['#2E2A26', '#3D332B'] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.subCard}>
          <Svg viewBox="0 0 200 200" width={180} height={180} style={styles.blob}>
            <Path d="M100,20 C140,20 180,60 180,100 C180,150 130,180 90,170 C50,160 20,130 25,90 C30,50 60,20 100,20Z" fill="#D08866" opacity={0.18} />
          </Svg>

          <Body style={styles.subEyebrow}>Current plan</Body>
          <Serif style={styles.subPlan}>
            Mirra <SerifItalic style={styles.subPlan}>{isPro ? 'Pro' : 'Free'}</SerifItalic>
          </Serif>
          <Body style={styles.subDesc}>{billingLoading ? 'Checking plan…' : planDescription}</Body>

          {!isPro && (
            <>
              <View style={styles.subDivider} />

              <View style={styles.subUpgradeRow}>
                <View style={{ flex: 1 }}>
                  <Body style={styles.subEyebrow}>Upgrade to</Body>
                  <Serif style={styles.subPlan}>Mirra <SerifItalic style={[styles.subPlan, { color: colors.terracottaSoft }]}>Pro</SerifItalic></Serif>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Serif style={{ fontSize: 24, lineHeight: 24, color: '#F6EFE0' }}>$8</Serif>
                  <Body style={styles.subPerMonth}>per month</Body>
                </View>
              </View>

              <View style={{ gap: 8, marginTop: 14 }}>
                {['Unlimited conversations', 'Full history & weekly themes', 'Energy & vocabulary deep-dives', 'Custom goals + gentle nudges'].map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Check color={colors.terracottaSoft} />
                    <Body style={styles.featureText}>{f}</Body>
                  </View>
                ))}
              </View>
            </>
          )}

          <Pressable
            onPress={handleBillingPress}
            disabled={billingOpening}
            style={({ pressed }) => [styles.tryBtn, pressed && styles.tryBtnPressed, billingOpening && styles.tryBtnDisabled]}
          >
            {billingOpening ? <ActivityIndicator size="small" color="#2A2520" /> : <Body style={styles.tryBtnText}>{billingCta}</Body>}
          </Pressable>
          <Body style={[styles.tryNote, billingError && styles.tryNoteError]}>{billingNote}</Body>
        </LinearGradient>
      </View>

      {/* Settings */}
      <View style={styles.settingsWrap}>
        <Eyebrow style={{ marginBottom: 6 }}>Settings</Eyebrow>
        <Card style={styles.settingsCard}>
          <SettingRow label="Notifications" hint={notificationsHint(settings)} onPress={() => setActivePanel('notifications')} />
          <SettingRow label="Voice & privacy" hint={privacyHint(settings)} onPress={() => setActivePanel('privacy')} />
          <SettingRow label="Coaching tone" hint={toneLabel[settings.coachingTone]} onPress={() => setActivePanel('coaching')} />
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

      <AccountMenu
        visible={accountMenuOpen}
        label={label}
        planLabel={planLabel}
        busy={accountBusy}
        note={accountNote}
        error={accountError}
        onClose={() => setAccountMenuOpen(false)}
        onExport={() => {
          void handleAccountExport();
        }}
        onBilling={() => {
          void handleAccountBilling();
        }}
        onHelp={handleAccountHelp}
        onSignOut={() => {
          void handleAccountSignOut();
        }}
      />

      <View style={styles.footer}>
        <Pressable onPress={signOut} hitSlop={8}>
          <Body style={styles.signOut}>Sign out</Body>
        </Pressable>
        <Body style={styles.version}>Mirra v1.4.2 · made with care</Body>
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

  subWrap: { paddingHorizontal: 22, paddingTop: 18 },
  subCard: { borderRadius: 22, padding: 20, overflow: 'hidden' },
  blob: { position: 'absolute', right: -40, top: -30 },
  subEyebrow: { fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: 'rgba(246,239,224,0.55)', fontFamily: fonts.bodyMedium },
  subPlan: { fontSize: 26, lineHeight: 28, marginTop: 6, color: '#F6EFE0' },
  subDesc: { fontSize: 12.5, color: 'rgba(246,239,224,0.7)', marginTop: 6, lineHeight: 19, maxWidth: 240 },
  subDivider: { height: 1, backgroundColor: 'rgba(246,239,224,0.15)', marginVertical: 18 },
  subUpgradeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  subPerMonth: { fontSize: 10.5, color: 'rgba(246,239,224,0.55)', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 13, color: 'rgba(246,239,224,0.92)' },
  tryBtn: { marginTop: 18, paddingVertical: 14, borderRadius: 14, backgroundColor: '#F6EFE0', alignItems: 'center' },
  tryBtnPressed: { opacity: 0.82 },
  tryBtnDisabled: { opacity: 0.72 },
  tryBtnText: { color: '#2A2520', fontFamily: fonts.bodySemibold, fontSize: 14, letterSpacing: 0.3 },
  tryNote: { fontSize: 10.5, color: 'rgba(246,239,224,0.5)', marginTop: 10, textAlign: 'center', letterSpacing: 0.4 },
  tryNoteError: { color: colors.terracottaSoft, opacity: 1 },

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
