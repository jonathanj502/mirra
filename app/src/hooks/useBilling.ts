import { useCallback, useState } from 'react';
import { friendlyErrorMessage } from '@/api/http';
import { createBillingCheckoutSession, createBillingPortalSession, fetchBillingStatus } from '@/api/client';
import { BillingStatus } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';

function billingErrorMessage(err: unknown, fallback: string) {
  const message = friendlyErrorMessage(err, fallback);
  if (message.includes('Stripe checkout is not configured') || message.includes('Stripe customer portal is not configured')) {
    return 'Billing setup is not ready yet';
  }
  return message;
}

export function useBilling(token: string | null) {
  const { data: billing, loading, error: loadError, refresh } = useAuthedFetch<BillingStatus | null>(fetchBillingStatus, null, 'Could not load billing');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(async () => {
    if (!token) return null;
    setOpening(true);
    try {
      const url = await createBillingCheckoutSession(token);
      setError(null);
      return url;
    } catch (err) {
      setError(billingErrorMessage(err, 'Could not open checkout'));
      return null;
    } finally {
      setOpening(false);
    }
  }, [token]);

  const openPortal = useCallback(async () => {
    if (!token) return null;
    setOpening(true);
    try {
      const url = await createBillingPortalSession(token);
      setError(null);
      return url;
    } catch (err) {
      setError(billingErrorMessage(err, 'Could not open billing'));
      return null;
    } finally {
      setOpening(false);
    }
  }, [token]);

  return { billing, loading, opening, error: error ?? loadError, loadError, refresh, startCheckout, openPortal };
}
