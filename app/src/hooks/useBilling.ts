import { useCallback, useEffect, useState } from 'react';
import { friendlyErrorMessage } from '@/api/http';
import { createBillingCheckoutSession, createBillingPortalSession, fetchBillingStatus } from '@/api/client';
import { BillingStatus } from '@/models/debrief';

function billingErrorMessage(err: unknown, fallback: string) {
  const message = friendlyErrorMessage(err, fallback);
  if (message.includes('Stripe checkout is not configured') || message.includes('Stripe customer portal is not configured')) {
    return 'Billing setup is not ready yet';
  }
  return message;
}

export function useBilling(token: string | null) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setBilling(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setBilling(await fetchBillingStatus(token));
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, 'Could not load billing'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return { billing, loading, opening, error, refresh, startCheckout, openPortal };
}
