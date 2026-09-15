import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usernameSignIn, usernameSignUp } from '@/api/auth';
import { authStorageKey, supabase } from '@/api/supabase';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextValue {
  initializing: boolean;
  authError: string | null;
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  signInWithPassword: (username: string, password: string) => Promise<void>;
  signUpWithPassword: (username: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return makeRedirectUri({ scheme: 'mirra', path: 'auth' });
}

export async function createSessionFromUrl(url: string | null) {
  if (!url) return;

  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (Platform.OS === 'web' && typeof window !== 'undefined' &&
      (params.access_token || params.refresh_token || params.code || params.error || errorCode)) {
    const cleanUrl = new URL(window.location.href);
    const hash = new URLSearchParams(cleanUrl.hash.slice(1));
    for (const key of ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
      'expires_at', 'expires_in', 'token_type', 'code', 'type', 'error', 'error_code', 'error_description', 'errorCode', 'sb']) {
      cleanUrl.searchParams.delete(key);
      hash.delete(key);
    }
    cleanUrl.hash = hash.toString();
    window.history.replaceState(window.history.state, '', cleanUrl.toString());
  }
  if (errorCode) throw new Error(errorCode);
  if (params.error) throw new Error(params.error_description || params.error);

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  const code = params.code;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;
    let authChanged = false;
    // Let a previously signed-in user record offline even when their access token has expired.
    // Uploads still require a refreshed, server-verified session for this same account.
    AsyncStorage.getItem(authStorageKey).then(raw => {
      if (!mounted || authChanged || !raw) return;
      const cached = JSON.parse(raw) as Session;
      if (cached.user?.id && cached.access_token && cached.refresh_token) setSession(cached);
    }).catch(() => {}).finally(() => {
      if (mounted) setInitializing(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (!error && !authChanged) {
        authChanged = true;
        setSession(data.session);
      }
      setInitializing(false);
    }).catch(() => { if (mounted) setInitializing(false); });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted || (event === 'INITIAL_SESSION' && !nextSession)) return;
      authChanged = true;
      if (nextSession) setAuthError(null);
      setSession(nextSession);
      setInitializing(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onError = (error: unknown) => setAuthError(error instanceof Error ? error.message : 'Could not complete sign-in. Please try again.');
    Linking.getInitialURL().then(createSessionFromUrl).catch(onError);
    const sub = Linking.addEventListener('url', ({ url }) => { void createSessionFromUrl(url).catch(onError); });
    return () => sub.remove();
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) throw error;
  }, []);

  const signInWithPassword = useCallback(async (username: string, password: string) => {
    const session = await usernameSignIn(username, password);
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) throw error;
  }, []);

  const signUpWithPassword = useCallback(async (username: string, password: string) => {
    const session = await usernameSignUp(username, password);
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = authRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: Platform.OS !== 'web',
      },
    });
    if (error) throw error;
    if (Platform.OS !== 'web') {
      const result = await WebBrowser.openAuthSessionAsync(data.url ?? '', redirectTo);
      if (result.type === 'success') {
        await createSessionFromUrl(result.url);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      authError,
      session,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      signInWithPassword,
      signUpWithPassword,
      signInWithGoogle,
      sendMagicLink,
      signOut,
    }),
    [initializing, authError, session, signInWithPassword, signUpWithPassword, signInWithGoogle, sendMagicLink, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
