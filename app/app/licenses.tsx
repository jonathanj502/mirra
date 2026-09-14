import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Serif } from '@/components/Typography';
import notices from '@/data/notices.json';

export default function Licenses() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  return <Screen><View style={{ paddingHorizontal: 24, gap: 16 }}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center' }}><Body>Back</Body></Pressable>
    <Serif style={{ fontSize: 30 }}>Open-source notices</Serif>
    <TextInput accessibilityLabel="Find a dependency" placeholder="Find a dependency" value={query} onChangeText={setQuery} style={{ padding: 12, borderWidth: 1, borderRadius: 12 }} />
    {notices.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).map(item => <View key={`${item.name}@${item.version}`}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.name }} onPress={() => setExpanded(expanded === item.name ? null : item.name)} style={{ minHeight: 44, justifyContent: 'center' }}><Body>{item.name} · {item.version} · {item.license}</Body></Pressable>
      {expanded === item.name ? <Body selectable style={{ fontSize: 12, lineHeight: 18 }}>{item.text || 'This package declares the license shown above. Full source and notices are available from its package registry entry.'}</Body> : null}
    </View>)}
  </View></Screen>;
}
