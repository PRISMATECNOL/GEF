-- ==============================================================================
-- GEF | MIGRAÇÃO v6: SUPER EMBAIXADORES + CONTROLO GLOBAL DAS REDES (idempotente)
-- Só ADICIONA. Não apaga dados, não altera RLS de outros módulos.
-- Pré-requisito: v2 e v4 já executadas.
--  1. Hierarquia: ambassadors.is_super / parent_ambassador_id / indirect_commission_rate
--  2. ambassador_commission_payments.kind (DIRECT|INDIRECT) + source_ambassador_id
--  3. Auditoria de taxas e de hierarquia (ambassador_rate_audit)
--  4. fn_record_ambassador_commission: mantém a comissão directa EXACTAMENTE como antes e
--     acrescenta a INDIRECTA ao Super Embaixador (linha separada, sem referred_store_id,
--     para nunca duplicar a receita da loja nem a comissão por loja).
--  5. fn_admin_set_ambassador_rates / fn_admin_set_ambassador_hierarchy (só SUPERADMIN, auditadas)
--  6. fn_admin_network_report: leitura global (só SUPERADMIN)
-- ==============================================================================

ALTER TABLE public.ambassadors ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.ambassadors ADD COLUMN IF NOT EXISTS parent_ambassador_id TEXT REFERENCES public.ambassadors(id) ON DELETE SET NULL;
ALTER TABLE public.ambassadors ADD COLUMN IF NOT EXISTS indirect_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.ambassador_commission_payments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE public.ambassador_commission_payments ADD COLUMN IF NOT EXISTS source_ambassador_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ambassadors_parent ON public.ambassadors(parent_ambassador_id);
CREATE INDEX IF NOT EXISTS idx_amb_comm_pay_paid_at ON public.ambassador_commission_payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_amb_comm_pay_store ON public.ambassador_commission_payments(referred_store_id);

CREATE TABLE IF NOT EXISTS public.ambassador_rate_audit (
    id BIGSERIAL PRIMARY KEY,
    ambassador_id TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by UUID DEFAULT auth.uid(),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.ambassador_rate_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "amb_rate_audit_superadmin_select" ON public.ambassador_rate_audit;
CREATE POLICY "amb_rate_audit_superadmin_select" ON public.ambassador_rate_audit FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'SUPERADMIN'));
-- Sem política de escrita: só as funções SECURITY DEFINER abaixo gravam auditoria.

CREATE OR REPLACE FUNCTION public.fn_is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'SUPERADMIN'); $$;
REVOKE ALL ON FUNCTION public.fn_is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_superadmin() TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Comissão directa (igual à v2) + indirecta
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_record_ambassador_commission(p_store_id TEXT, p_days INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ref public.ambassador_referred_stores%ROWTYPE;
    v_store public.stores%ROWTYPE;
    v_parent public.ambassadors%ROWTYPE;
    v_payment NUMERIC(12, 2);
    v_commission NUMERIC(12, 2);
    v_ind NUMERIC(12, 2);
    v_months INT;
BEGIN
    SELECT * INTO v_ref
      FROM public.ambassador_referred_stores
     WHERE store_id = p_store_id OR id = p_store_id
     ORDER BY created_at
     LIMIT 1;
    IF v_ref.id IS NULL THEN RETURN; END IF;

    SELECT * INTO v_store FROM public.stores WHERE id = p_store_id;
    IF v_store.id IS NULL THEN RETURN; END IF;

    IF COALESCE(v_ref.contract_duration_months, 12) < 999
       AND COALESCE(v_ref.months_active, 0) >= COALESCE(v_ref.contract_duration_months, 12) THEN
        RETURN;
    END IF;

    v_payment := ROUND(COALESCE(v_store.valor_mensalidade, 0) * GREATEST(COALESCE(p_days, 30), 1) / 30.0, 2);
    IF v_payment <= 0 THEN RETURN; END IF;

    v_commission := ROUND(v_payment * COALESCE(v_ref.commission_rate, 0) / 100.0, 2);
    v_months := GREATEST(1, ROUND(COALESCE(p_days, 30) / 30.0)::INT);

    INSERT INTO public.ambassador_commission_payments (
        id, ambassador_id, referred_store_id, store_id, store_name,
        payment_amount, commission_rate, commission_amount, days_added, kind
    ) VALUES (
        'acp-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
        v_ref.ambassador_id, v_ref.id, p_store_id, v_store.name,
        v_payment, COALESCE(v_ref.commission_rate, 0), v_commission, COALESCE(p_days, 30), 'DIRECT'
    );

    UPDATE public.ambassador_referred_stores
       SET payment_status = 'PAGO',
           last_payment_date = CURRENT_DATE,
           next_due_date = v_store.data_fim_teste,
           months_active = COALESCE(months_active, 0) + v_months,
           total_commission_earned = COALESCE(total_commission_earned, 0) + v_commission
     WHERE id = v_ref.id;

    UPDATE public.ambassadors
       SET pending_commissions = COALESCE(pending_commissions, 0) + v_commission,
           total_earned = COALESCE(total_earned, 0) + v_commission
     WHERE id = v_ref.ambassador_id;

    -- Comissão INDIRECTA: só se o embaixador tem um Super Embaixador activo com taxa > 0.
    SELECT p.* INTO v_parent
      FROM public.ambassadors p
      JOIN public.ambassadors a ON a.parent_ambassador_id = p.id
     WHERE a.id = v_ref.ambassador_id;

    IF v_parent.id IS NOT NULL
       AND COALESCE(v_parent.is_super, FALSE)
       AND COALESCE(v_parent.indirect_commission_rate, 0) > 0
       AND COALESCE(v_parent.status, 'ATIVO') = 'ATIVO' THEN
        v_ind := ROUND(v_payment * v_parent.indirect_commission_rate / 100.0, 2);
        IF v_ind > 0 THEN
            INSERT INTO public.ambassador_commission_payments (
                id, ambassador_id, referred_store_id, store_id, store_name,
                payment_amount, commission_rate, commission_amount, days_added, kind, source_ambassador_id
            ) VALUES (
                'acp-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
                v_parent.id, NULL, p_store_id, v_store.name,
                v_payment, v_parent.indirect_commission_rate, v_ind, COALESCE(p_days, 30), 'INDIRECT', v_ref.ambassador_id
            );
            UPDATE public.ambassadors
               SET pending_commissions = COALESCE(pending_commissions, 0) + v_ind,
                   total_earned = COALESCE(total_earned, 0) + v_ind
             WHERE id = v_parent.id;
        END IF;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_ambassador_commission(TEXT, INT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Taxas e hierarquia (só SUPERADMIN; tudo auditado; lojas antigas mantêm a taxa
--    com que foram criadas — o histórico financeiro não é reescrito)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_set_ambassador_rates(p_ambassador_id TEXT, p_direct NUMERIC, p_indirect NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.ambassadors%ROWTYPE;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    IF p_direct IS NULL OR p_direct < 0 OR p_direct > 100 THEN RAISE EXCEPTION 'Comissão directa inválida (0 a 100).'; END IF;
    IF p_indirect IS NULL OR p_indirect < 0 OR p_indirect > 100 THEN RAISE EXCEPTION 'Comissão indirecta inválida (0 a 100).'; END IF;
    SELECT * INTO v FROM public.ambassadors WHERE id = p_ambassador_id FOR UPDATE;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Embaixador não encontrado.'; END IF;
    IF p_indirect > 0 AND NOT COALESCE(v.is_super, FALSE) THEN
        RAISE EXCEPTION 'Só Super Embaixadores podem ter comissão indirecta.';
    END IF;

    IF v.commission_rate IS DISTINCT FROM p_direct THEN
        INSERT INTO public.ambassador_rate_audit(ambassador_id, field, old_value, new_value)
        VALUES (v.id, 'commission_rate', v.commission_rate::TEXT, p_direct::TEXT);
    END IF;
    IF COALESCE(v.indirect_commission_rate, 0) IS DISTINCT FROM p_indirect THEN
        INSERT INTO public.ambassador_rate_audit(ambassador_id, field, old_value, new_value)
        VALUES (v.id, 'indirect_commission_rate', COALESCE(v.indirect_commission_rate, 0)::TEXT, p_indirect::TEXT);
    END IF;

    UPDATE public.ambassadors SET commission_rate = p_direct, indirect_commission_rate = p_indirect WHERE id = v.id;
    RETURN jsonb_build_object('success', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_set_ambassador_rates(TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_ambassador_rates(TEXT, NUMERIC, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_admin_set_ambassador_hierarchy(p_ambassador_id TEXT, p_is_super BOOLEAN, p_parent_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.ambassadors%ROWTYPE; par public.ambassadors%ROWTYPE;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    SELECT * INTO v FROM public.ambassadors WHERE id = p_ambassador_id FOR UPDATE;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Embaixador não encontrado.'; END IF;

    p_parent_id := NULLIF(TRIM(COALESCE(p_parent_id, '')), '');
    IF COALESCE(p_is_super, FALSE) AND p_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'Um Super Embaixador não pode ter Super Embaixador acima.';
    END IF;
    IF p_parent_id IS NOT NULL THEN
        IF p_parent_id = v.id THEN RAISE EXCEPTION 'Um embaixador não pode ser o seu próprio Super Embaixador.'; END IF;
        SELECT * INTO par FROM public.ambassadors WHERE id = p_parent_id;
        IF par.id IS NULL OR NOT COALESCE(par.is_super, FALSE) THEN
            RAISE EXCEPTION 'O responsável escolhido não é um Super Embaixador.';
        END IF;
    END IF;
    IF NOT COALESCE(p_is_super, FALSE) AND COALESCE(v.is_super, FALSE)
       AND EXISTS (SELECT 1 FROM public.ambassadors WHERE parent_ambassador_id = v.id) THEN
        RAISE EXCEPTION 'Este Super Embaixador ainda tem embaixadores na rede. Retire-os primeiro.';
    END IF;

    IF COALESCE(v.is_super, FALSE) IS DISTINCT FROM COALESCE(p_is_super, FALSE) THEN
        INSERT INTO public.ambassador_rate_audit(ambassador_id, field, old_value, new_value)
        VALUES (v.id, 'is_super', COALESCE(v.is_super, FALSE)::TEXT, COALESCE(p_is_super, FALSE)::TEXT);
    END IF;
    IF v.parent_ambassador_id IS DISTINCT FROM p_parent_id THEN
        INSERT INTO public.ambassador_rate_audit(ambassador_id, field, old_value, new_value)
        VALUES (v.id, 'parent_ambassador_id', v.parent_ambassador_id, p_parent_id);
    END IF;

    UPDATE public.ambassadors
       SET is_super = COALESCE(p_is_super, FALSE),
           parent_ambassador_id = p_parent_id,
           indirect_commission_rate = CASE WHEN COALESCE(p_is_super, FALSE) THEN indirect_commission_rate ELSE 0 END
     WHERE id = v.id;
    RETURN jsonb_build_object('success', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_set_ambassador_hierarchy(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_ambassador_hierarchy(TEXT, BOOLEAN, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. Relatório global (leitura). Receita = SÓ linhas kind='DIRECT' (uma por pagamento de loja);
--    as linhas INDIRECT repetem payment_amount e por isso NUNCA entram na receita.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_network_report(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_out JSONB;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;

    WITH st AS (
        SELECT r.id AS ref_id, r.ambassador_id, r.name, r.owner_name, r.phone, r.city, r.created_at,
               r.last_payment_date, s.data_fim_teste,
               COALESCE(s.valor_mensalidade, r.monthly_fee, 0) AS fee,
               CASE WHEN s.id IS NULL THEN 'SEM_LOJA'
                    WHEN s.acesso_ativo = FALSE THEN 'BLOQUEADA'
                    WHEN s.data_fim_teste < CURRENT_DATE THEN 'EXPIRADA'
                    WHEN r.last_payment_date IS NULL THEN 'EM_TESTE'
                    ELSE 'ATIVA' END AS status,
               (s.data_fim_teste - CURRENT_DATE) AS days_remaining
          FROM public.ambassador_referred_stores r
          LEFT JOIN public.stores s ON s.id = COALESCE(r.store_id, r.id)
    ),
    pay AS (
        SELECT * FROM public.ambassador_commission_payments p
         WHERE (p_from IS NULL OR p.paid_at::DATE >= p_from)
           AND (p_to IS NULL OR p.paid_at::DATE <= p_to)
    )
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'period', jsonb_build_object('from', p_from, 'to', p_to),
        'ambassadors', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
            SELECT a.id, a.name, a.phone,
                   COALESCE(a.status, CASE WHEN a.active THEN 'ATIVO' ELSE 'DESATIVADO' END) AS status,
                   COALESCE(a.is_super, FALSE) AS is_super, a.parent_ambassador_id,
                   COALESCE(a.commission_rate, 0) AS commission_rate,
                   COALESCE(a.indirect_commission_rate, 0) AS indirect_commission_rate,
                   a.created_at,
                   COALESCE(a.pending_commissions, 0) AS pending_commissions,
                   (SELECT COALESCE(SUM(po.amount), 0) FROM public.ambassador_payouts po WHERE po.ambassador_id = a.id) AS paid_commissions,
                   (SELECT MAX(p.paid_at) FROM public.ambassador_commission_payments p WHERE p.ambassador_id = a.id AND p.kind = 'DIRECT') AS last_payment_at,
                   (SELECT MAX(r.created_at) FROM public.ambassador_referred_stores r WHERE r.ambassador_id = a.id) AS last_store_at
              FROM public.ambassadors a ORDER BY a.created_at) x), '[]'::JSONB),
        'stores', COALESCE((SELECT jsonb_agg(to_jsonb(y)) FROM (
            SELECT st.ref_id AS id, st.name, st.owner_name, st.phone, st.city, st.created_at, st.ambassador_id,
                   st.status, st.fee AS monthly_fee, st.data_fim_teste AS subscription_end, st.days_remaining,
                   st.last_payment_date,
                   COALESCE((SELECT SUM(p.payment_amount) FROM pay p WHERE p.referred_store_id = st.ref_id AND p.kind = 'DIRECT'), 0) AS received,
                   COALESCE((SELECT SUM(p.commission_amount) FROM pay p WHERE p.referred_store_id = st.ref_id AND p.kind = 'DIRECT'), 0) AS commission,
                   CASE WHEN st.status = 'EXPIRADA'
                        THEN st.fee * GREATEST(1, CEIL((CURRENT_DATE - st.data_fim_teste) / 30.0)) ELSE 0 END AS overdue_amount,
                   CASE WHEN st.status = 'EXPIRADA' THEN CURRENT_DATE - st.data_fim_teste END AS days_overdue
              FROM st ORDER BY st.created_at DESC) y), '[]'::JSONB),
        'monthly', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM (
            SELECT p.ambassador_id, to_char(p.paid_at, 'YYYY-MM') AS month,
                   SUM(p.payment_amount) FILTER (WHERE p.kind = 'DIRECT') AS received,
                   SUM(p.commission_amount) FILTER (WHERE p.kind = 'DIRECT') AS commission_direct,
                   SUM(p.commission_amount) FILTER (WHERE p.kind = 'INDIRECT') AS commission_indirect
              FROM pay p GROUP BY p.ambassador_id, to_char(p.paid_at, 'YYYY-MM') ORDER BY 2) m), '[]'::JSONB),
        'recent_payments', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
            SELECT p.id, p.ambassador_id, p.referred_store_id, p.store_id, p.store_name, p.paid_at,
                   p.payment_amount, p.commission_rate, p.commission_amount, p.kind, p.source_ambassador_id
              FROM pay p ORDER BY p.paid_at DESC LIMIT 500) z), '[]'::JSONB),
        'payouts', COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (
            SELECT po.id, po.ambassador_id, po.amount, po.method, po.receipt, po.status, po.created_at
              FROM public.ambassador_payouts po ORDER BY po.created_at DESC LIMIT 300) q), '[]'::JSONB),
        'rate_audit', COALESCE((SELECT jsonb_agg(to_jsonb(au)) FROM (
            SELECT id, ambassador_id, field, old_value, new_value, changed_by, changed_at
              FROM public.ambassador_rate_audit ORDER BY changed_at DESC LIMIT 300) au), '[]'::JSONB)
    ) INTO v_out;

    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_network_report(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_network_report(DATE, DATE) TO authenticated;
