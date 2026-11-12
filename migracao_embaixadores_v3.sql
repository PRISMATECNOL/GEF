-- ==============================================================================
-- GEF | MIGRAÇÃO EMBAIXADORES v3  (executar DEPOIS da v2; idempotente)
--
-- O que faz (e só isto):
--  1. Reforça o vínculo "loja indicada" -> "loja real" (para o embaixador ver todas
--     as lojas que cadastrou, incluindo registos antigos sem store_id).
--  2. Cria fn_admin_pay_ambassador_commission SE AINDA NÃO EXISTIR. O front-end chamava
--     esta função mas nenhum .sql do pacote a definia (liquidação falhava).
--     Se já existir na sua base, NÃO é substituída.
--  3. Enriquece fn_ambassador_tracking (mesmas chaves de antes + localização, contacto
--     do administrador da loja e resumo de comissões). Continua a devolver só dados de
--     subscrição/comissão: nada de vendas, stock, compras ou operações internas.
--  4. Liga o Realtime às tabelas do programa para o painel actualizar após cada pagamento.
--
-- NÃO altera vendas, stock, caixa, PDV, RLS de outras tabelas nem permissões existentes.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. VÍNCULO LOJA INDICADA -> LOJA REAL
-- ------------------------------------------------------------------------------
UPDATE public.ambassador_referred_stores r
   SET store_id = r.id
 WHERE r.store_id IS NULL
   AND EXISTS (SELECT 1 FROM public.stores s WHERE s.id = r.id);

CREATE INDEX IF NOT EXISTS idx_amb_ref_stores_amb ON public.ambassador_referred_stores(ambassador_id);
CREATE INDEX IF NOT EXISTS idx_amb_ref_stores_store ON public.ambassador_referred_stores(store_id);

-- ------------------------------------------------------------------------------
-- 2. LIQUIDAÇÃO DE COMISSÃO (só se ainda não existir)
-- ------------------------------------------------------------------------------
DO $outer$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_admin_pay_ambassador_commission'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.fn_admin_pay_ambassador_commission(
          p_ambassador_id TEXT,
          p_amount NUMERIC,
          p_method TEXT,
          p_receipt TEXT DEFAULT ''
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
      DECLARE
          v_amb public.ambassadors%ROWTYPE;
          v_payout_id TEXT;
      BEGIN
          IF public.get_auth_user_role() <> 'SUPERADMIN' THEN
              RAISE EXCEPTION 'Apenas o Superadmin pode liquidar comissões.';
          END IF;
          IF COALESCE(p_amount, 0) <= 0 THEN
              RAISE EXCEPTION 'Valor da comissão inválido.';
          END IF;
          IF NULLIF(TRIM(COALESCE(p_method, '')), '') IS NULL THEN
              RAISE EXCEPTION 'Método de pagamento é obrigatório.';
          END IF;

          SELECT * INTO v_amb FROM public.ambassadors WHERE id = p_ambassador_id FOR UPDATE;
          IF v_amb.id IS NULL THEN
              RAISE EXCEPTION 'Embaixador não encontrado.';
          END IF;
          IF p_amount > COALESCE(v_amb.pending_commissions, 0) THEN
              RAISE EXCEPTION 'O valor excede a comissão disponível (%).', COALESCE(v_amb.pending_commissions, 0);
          END IF;

          v_payout_id := 'pay-' || REPLACE(gen_random_uuid()::TEXT, '-', '');

          INSERT INTO public.ambassador_payouts (id, ambassador_id, amount, method, receipt, status)
          VALUES (v_payout_id, v_amb.id, p_amount, TRIM(p_method), NULLIF(TRIM(COALESCE(p_receipt, '')), ''), 'LIQUIDADO');

          UPDATE public.ambassadors
             SET pending_commissions = COALESCE(pending_commissions, 0) - p_amount
           WHERE id = v_amb.id;

          RETURN jsonb_build_object(
              'success', TRUE,
              'payout_id', v_payout_id,
              'pending_commissions', COALESCE(v_amb.pending_commissions, 0) - p_amount
          );
      END;
      $body$
    $fn$;
    REVOKE ALL ON FUNCTION public.fn_admin_pay_ambassador_commission(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.fn_admin_pay_ambassador_commission(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
  END IF;
END
$outer$;

-- ------------------------------------------------------------------------------
-- 3. PAINEL DE ACOMPANHAMENTO (v3): mesmas chaves da v2 + localização/contacto/resumo
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_ambassador_tracking(TEXT);
CREATE OR REPLACE FUNCTION public.fn_ambassador_tracking(p_ambassador_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_amb public.ambassadors%ROWTYPE;
    v_stores JSONB;
    v_payments JSONB;
    v_paid NUMERIC(12, 2);
BEGIN
    v_amb := public.fn_ambassador_resolve(p_ambassador_id, FALSE);

    SELECT COALESCE(JSONB_AGG(x ORDER BY x->>'created_at' DESC), '[]'::JSONB) INTO v_stores
    FROM (
        SELECT JSONB_BUILD_OBJECT(
            'id', r.id,
            'name', r.name,
            'owner_name', r.owner_name,
            'phone', r.phone,
            'city', r.city,
            'address', s.address,
            'province', s.province,
            'admin_email', (SELECT pf.email FROM public.profiles pf
                             WHERE pf.store_id = s.id AND pf.role = 'ADMIN'
                             ORDER BY pf.email LIMIT 1),
            'created_at', r.created_at,
            'monthly_fee', COALESCE(s.valor_mensalidade, r.monthly_fee, 0),
            'commission_rate', COALESCE(r.commission_rate, v_amb.commission_rate, 0),
            'contract_duration_months', r.contract_duration_months,
            'months_active', COALESCE(r.months_active, 0),
            'has_store', (s.id IS NOT NULL),
            'subscription_status', CASE
                WHEN s.id IS NULL THEN 'SEM_LOJA'
                WHEN s.acesso_ativo = FALSE THEN 'BLOQUEADA'
                WHEN s.data_fim_teste < CURRENT_DATE THEN 'EXPIRADA'
                WHEN r.last_payment_date IS NULL THEN 'EM_TESTE'
                ELSE 'ATIVA' END,
            'subscription_end', s.data_fim_teste,
            'days_remaining', CASE WHEN s.id IS NULL THEN NULL ELSE (s.data_fim_teste - CURRENT_DATE) END,
            'last_payment_date', r.last_payment_date,
            'payments_count', (SELECT COUNT(*) FROM public.ambassador_commission_payments p WHERE p.referred_store_id = r.id),
            'total_paid_by_store', (SELECT COALESCE(SUM(p.payment_amount), 0) FROM public.ambassador_commission_payments p WHERE p.referred_store_id = r.id),
            'total_commission', (SELECT COALESCE(SUM(p.commission_amount), 0) FROM public.ambassador_commission_payments p WHERE p.referred_store_id = r.id)
        ) AS x
        FROM public.ambassador_referred_stores r
        LEFT JOIN public.stores s ON s.id = COALESCE(r.store_id, r.id)
        WHERE r.ambassador_id = v_amb.id
    ) t;

    SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', p.id,
        'referred_store_id', p.referred_store_id,
        'store_name', p.store_name,
        'paid_at', p.paid_at,
        'payment_amount', p.payment_amount,
        'commission_rate', p.commission_rate,
        'commission_amount', p.commission_amount,
        'days_added', p.days_added
    ) ORDER BY p.paid_at DESC), '[]'::JSONB) INTO v_payments
    FROM public.ambassador_commission_payments p
    WHERE p.ambassador_id = v_amb.id;

    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.ambassador_payouts WHERE ambassador_id = v_amb.id;

    RETURN JSONB_BUILD_OBJECT(
        'ambassador_id', v_amb.id,
        'stores', v_stores,
        'payments', v_payments,
        'total_commission_generated', (SELECT COALESCE(SUM(commission_amount), 0) FROM public.ambassador_commission_payments WHERE ambassador_id = v_amb.id),
        'available_commission', COALESCE(v_amb.pending_commissions, 0),
        'paid_commission', v_paid
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_ambassador_tracking(TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. REALTIME (o painel actualiza sozinho após cada pagamento/liquidação)
--    O Realtime respeita o RLS: cada embaixador só recebe eventos das suas linhas.
-- ------------------------------------------------------------------------------
DO $rt$
DECLARE
    t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH t IN ARRAY ARRAY[
            'ambassadors',
            'ambassador_referred_stores',
            'ambassador_commission_payments',
            'ambassador_payouts'
        ] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
            END IF;
        END LOOP;
    END IF;
END
$rt$;
