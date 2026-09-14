import React, { createContext, useContext, useEffect, useState } from 'react';
import { Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { fetchUserSettings } from '@/api/client';
import { CONSENT_VERSION } from '@/config/legal';
import { ConsentScreen } from '@/screens/ConsentScreen';

const PrivacyContext = createContext({ canProcess: false, reviewConsent: () => {}, withdrawLocally: async () => {} });
export const consentKey = (userId: string) => `mirra:consent:${userId}`;

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const { user, accessToken } = useAuth();
  const [approvedUser, setApprovedUser] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    let active = true;
    setApprovedUser(null);
    setReview(false);
    if (!userId) return;
    void (async () => {
      const cached = await AsyncStorage.getItem(consentKey(userId)).catch(() => null);
      if (!active) return;
      if (cached === CONSENT_VERSION) setApprovedUser(userId);
      if (!accessToken) return;
      try {
        const settings = await fetchUserSettings(accessToken);
        if (!active) return;
        const approved = settings.aiConsentVersion === CONSENT_VERSION;
        setApprovedUser(approved ? userId : null);
        setReview(!approved);
        if (approved) await AsyncStorage.setItem(consentKey(userId), CONSENT_VERSION);
        else await AsyncStorage.removeItem(consentKey(userId));
      } catch { /* Cached permission allows offline recording; the server checks again before AI processing. */ }
    })();
    return () => { active = false; };
  }, [userId, accessToken]);
  async function withdrawLocally() {
    setApprovedUser(null);
    if (userId) await AsyncStorage.removeItem(consentKey(userId));
  }
  function accepted() {
    if (!userId) return;
    setApprovedUser(userId);
    setReview(false);
    void AsyncStorage.setItem(consentKey(userId), CONSENT_VERSION).catch(() => {});
  }
  return <PrivacyContext.Provider value={{ canProcess: !!userId && approvedUser === userId, reviewConsent: () => setReview(true), withdrawLocally }}>
    {children}
    <Modal visible={review && !!user} animationType="slide" onRequestClose={() => setReview(false)}>
      <ConsentScreen onAccepted={accepted} onDismiss={() => setReview(false)} />
    </Modal>
  </PrivacyContext.Provider>;
}

export const usePrivacy = () => useContext(PrivacyContext);
