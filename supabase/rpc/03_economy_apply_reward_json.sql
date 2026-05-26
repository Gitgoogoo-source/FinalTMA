-- economy_apply_reward_json.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Applies a JSON reward array to a user.
-- Supported reward element format: {"currency":"KCOIN","amount":500} or {"currency":"FGEMS","amount":50}.
-- Item rewards should be implemented through inventory-specific RPCs, not this currency-only helper.

create or replace function api._apply_reward_json(
  p_user_id uuid,
  p_reward jsonb,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_currency text;
  v_amount numeric(38,0);
  v_results jsonb := '[]'::jsonb;
  v_credit jsonb;
  v_idx integer := 0;
begin
  if p_reward is null or jsonb_typeof(p_reward) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select * from jsonb_array_elements(p_reward)
  loop
    v_idx := v_idx + 1;
    v_currency := v_item ->> 'currency';
    v_amount := coalesce((v_item ->> 'amount')::numeric, 0);
    if v_currency is not null and v_amount > 0 then
      v_credit := api._credit_balance(
        p_user_id,
        v_currency,
        v_amount,
        p_source_type,
        p_source_id,
        null,
        p_idempotency_prefix || ':' || v_idx::text || ':' || v_currency,
        'reward_json',
        v_item
      );
      v_results := v_results || jsonb_build_array(v_credit);
    end if;
  end loop;

  return v_results;
end;
$$;


create or replace function api.economy_apply_reward_json(
  p_user_id uuid,
  p_reward jsonb,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return api._apply_reward_json(
    p_user_id,
    coalesce(p_reward, '[]'::jsonb),
    p_source_type,
    p_source_id,
    p_idempotency_prefix
  );
end;
$$;


-- ============================================================
