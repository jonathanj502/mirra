-- Remove the retired payment integration table and its policies.
-- This deletes its stored customer/subscription references, not conversation data.
drop table if exists public.billing_subscriptions;
