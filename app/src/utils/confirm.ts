import { Alert, Platform } from 'react-native';

export function confirmAction(title: string, message: string, action: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise(resolve => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function confirmRecordingPermission() {
  return confirmAction('Everyone agrees?',
    'Only record or import a conversation if everyone involved agrees to being recorded and having the audio processed by Mirra and OpenAI. Recording laws vary by location. Stop if anyone withdraws permission.',
    'Everyone agrees');
}
