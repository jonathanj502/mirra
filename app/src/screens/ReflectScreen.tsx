// Reflect · AI chat — reflect on a conversation with Mirra.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Body, Serif, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/theme/tokens';
import { SEED_MESSAGES, STARTER_PROMPTS, CANNED_REPLIES, ChatMessage } from '@/data/reflect';
import { fetchDebrief, sendReflection } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { titleForDebrief } from '@/hooks/useDebriefs';
import { requestAIConsent } from '@/privacy/aiConsent';

function ChatBubble({ from, text }: ChatMessage) {
  const isYou = from === 'you';
  return (
    <View style={[styles.bubbleRow, { justifyContent: isYou ? 'flex-end' : 'flex-start' }]}>
      <View style={[isYou ? styles.bubbleYou : styles.bubbleAi]}>
        <Body style={[styles.bubbleText, { color: isYou ? '#FBF6EA' : colors.ink }]}>{text}</Body>
      </View>
    </View>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 360, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return <Animated.View style={[styles.typingDot, { transform: [{ translateY }], opacity }]} />;
}

function TypingIndicator() {
  return (
    <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
      <View style={styles.typingBubble}>
        <TypingDot delay={0} />
        <TypingDot delay={150} />
        <TypingDot delay={300} />
      </View>
    </View>
  );
}

function ContextPill({ subject }: { subject: string }) {
  return (
    <View style={styles.contextPill}>
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Circle cx={11} cy={11} r={9} fill={colors.terracotta} opacity={0.18} />
        <Path d="M11 6.5 L11 11 L13.5 12.5" stroke={colors.terracotta} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      </Svg>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={styles.contextLabel}>Reflecting on</Body>
        <Serif style={styles.contextSubject}>{subject}</Serif>
      </View>
      <Icon.chevron color={colors.muted} />
    </View>
  );
}

export function ReflectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { accessToken, user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [input, setInput] = useState('');
  const [subject, setSubject] = useState('recent conversation');
  const [thinking, setThinking] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const sending = useRef(false);
  const replyIdx = useRef(0);
  const scrollerRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollerRef.current?.scrollToEnd({ animated: true });
  }, [messages, thinking]);

  useEffect(() => {
    let mounted = true;
    if (!id || !accessToken) {
      setSubject('recent conversation');
      return;
    }

    fetchDebrief(accessToken, id)
      .then((debrief) => {
        if (mounted) setSubject(titleForDebrief(debrief));
      })
      .catch(() => {
        if (mounted) setSubject('recent conversation');
      });

    return () => {
      mounted = false;
    };
  }, [accessToken, id]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || thinking || sending.current || !accessToken) return;
    sending.current = true;
    setConsentError(null);
    try {
      if (!await requestAIConsent(user?.id)) {
        sending.current = false;
        return;
      }
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : 'Could not save your privacy choice. Please try again.');
      sending.current = false;
      return;
    }
    setInput('');
    const nextMessages = [...messages, { from: 'you' as const, text: msg }];
    setMessages(nextMessages);
    setThinking(true);
    try {
      const reply = await sendReflection(accessToken, {
        conversationId: id,
        prompt: msg,
        messages: messages.map((message) => ({
          role: message.from === 'ai' ? 'assistant' : 'user',
          content: message.text,
        })),
      });
      setMessages((m) => [...m, { from: 'ai', text: reply }]);
    } catch {
      const reply = CANNED_REPLIES[replyIdx.current % CANNED_REPLIES.length];
      replyIdx.current += 1;
      setMessages((m) => [...m, { from: 'ai', text: reply }]);
    } finally {
      setThinking(false);
      sending.current = false;
    }
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const canSend = !!input.trim() && !thinking;
  const bottomPad = (Platform.OS === 'ios' ? 22 : 18) + insets.bottom;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={goBack} hitSlop={8}><Icon.back color={colors.muted} /></Pressable>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Eyebrow>Reflect with</Eyebrow>
          <Serif style={styles.headerName}>Mirra</Serif>
        </View>
        <Icon.dots color={colors.muted} />
      </View>

      {/* Messages */}
      <ScrollView ref={scrollerRef} style={{ flex: 1 }} contentContainerStyle={styles.messages} showsVerticalScrollIndicator={false}>
        <ContextPill subject={subject} />
        {messages.map((m, i) => <ChatBubble key={i} from={m.from} text={m.text} />)}
        {thinking && <TypingIndicator />}
      </ScrollView>

      {/* Starter prompts */}
      {messages.length <= 3 && !thinking && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.startersWrap} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
          {STARTER_PROMPTS.map((p, i) => (
            <Pressable key={i} onPress={() => send(p)} style={styles.starter}>
              <Body style={styles.starterText}>{p}</Body>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: bottomPad }]}>
        {consentError ? <Body accessibilityRole="alert" style={styles.consentError}>{consentError}</Body> : null}
        <View style={styles.inputWrap}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            placeholder="Ask anything…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="send"
          />
          <Pressable onPress={() => send()} disabled={!canSend} style={[styles.sendBtn, { backgroundColor: canSend ? colors.terracotta : 'rgba(42,37,32,0.10)' }]}>
            <Svg viewBox="0 0 20 20" width={16} height={16}>
              <Path d="M3 17L17 10 3 3 4.5 10 3 17z" fill={canSend ? '#FBF6EA' : 'rgba(42,37,32,0.30)'} />
            </Svg>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 18, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerName: { fontSize: 22, lineHeight: 30, color: colors.ink },
  messages: { padding: 16, paddingTop: 14 },
  bubbleRow: { flexDirection: 'row', marginBottom: 10 },
  bubbleYou: { maxWidth: '78%', backgroundColor: colors.terracotta, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 18, borderBottomRightRadius: 4 },
  bubbleAi: { maxWidth: '78%', backgroundColor: colors.card, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 18, borderBottomLeftRadius: 4, ...{ shadowColor: '#2A2520', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 } },
  bubbleText: { fontSize: 14, lineHeight: 21 },
  typingBubble: { backgroundColor: colors.card, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderBottomLeftRadius: 4, flexDirection: 'row', gap: 4, alignItems: 'center' },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.terracotta, opacity: 0.55 },
  contextPill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(208,136,102,0.10)', borderRadius: 14, marginBottom: 14 },
  contextLabel: { fontSize: 10, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  contextSubject: { fontSize: 20, color: colors.ink, marginTop: 4, lineHeight: 28 },
  startersWrap: { flexGrow: 0, paddingBottom: 8 },
  starter: { borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  starterText: { fontSize: 12, color: colors.ink2 },
  inputBar: { paddingHorizontal: 14, paddingTop: 10 },
  consentError: { fontSize: 12, lineHeight: 18, color: colors.ink2, marginBottom: 8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 22, paddingLeft: 16, paddingRight: 6, ...{ shadowColor: '#2A2520', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 } },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 14, paddingVertical: 12, color: colors.ink },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
