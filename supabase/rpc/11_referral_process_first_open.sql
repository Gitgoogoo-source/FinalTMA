-- referral_process_first_open.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.referral_process_first_open

create or replace function api.referral_process_first_open(
  p_invitee_user_id uuid,
  p_draw_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_inviter_reward numeric(38,0);
  v_invitee_reward numeric(38,0);
  v_credit_inviter jsonb;
  v_credit_invitee jsonb;
begin
  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status in ('pending', 'qualified')
  for update;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_referral');
  end if;

  select amount into v_inviter_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITER' and active = true;
  select amount into v_invitee_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITEE' and active = true;
  v_inviter_reward := coalesce(v_inviter_reward, 500);
  v_invitee_reward := coalesce(v_invitee_reward, 500);

  update tasks.referrals
  set status = 'rewarded', first_open_order_id = p_draw_order_id, qualified_at = coalesce(qualified_at, now()), rewarded_at = now(), updated_at = now()
  where id = v_ref.id;

  v_credit_inviter := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_inviter_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:inviter:' || v_ref.id::text,
    'Referral first open inviter reward', jsonb_build_object('invitee_user_id', p_invitee_user_id)
  );

  v_credit_invitee := api._credit_balance(
    v_ref.invitee_user_id, 'KCOIN', v_invitee_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:invitee:' || v_ref.id::text,
    'Referral first open invitee reward', jsonb_build_object('inviter_user_id', v_ref.inviter_user_id)
  );

  insert into tasks.referral_rewards (referral_id, user_id, reward_role, currency_code, amount, ledger_id, status)
  values
    (v_ref.id, v_ref.inviter_user_id, 'inviter', 'KCOIN', v_inviter_reward, (v_credit_inviter ->> 'ledger_id')::uuid, 'granted'),
    (v_ref.id, v_ref.invitee_user_id, 'invitee', 'KCOIN', v_invitee_reward, (v_credit_invitee ->> 'ledger_id')::uuid, 'granted')
  on conflict (referral_id, reward_role) do nothing;

  return jsonb_build_object(
    'processed', true,
    'referral_id', v_ref.id,
    'inviter_reward', v_inviter_reward,
    'invitee_reward', v_invitee_reward
  );
end;
$$;


-- ============================================================
