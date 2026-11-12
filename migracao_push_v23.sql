-- v23 — marca as notificações já enviadas pela função send-push (Web Push). Idempotente.
ALTER TABLE public.customer_notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cust_notif_pending ON public.customer_notifications(id) WHERE pushed_at IS NULL;
