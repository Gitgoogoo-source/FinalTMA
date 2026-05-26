-- Phase 4 referral first-open hardening.
-- Scope: 第四阶段规划.md / 3.4 D referral_process_first_open.

begin;

revoke execute on function api.referral_process_first_open(uuid, uuid)
  from public, anon, authenticated;

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
  v_order gacha.draw_orders%rowtype;
  v_result_count integer := 0;
  v_required_result_count integer := 0;
  v_has_prior_successful_open boolean := false;
  v_inviter_reward numeric(38,0);
  v_invitee_reward numeric(38,0);
  v_credit_inviter jsonb;
  v_credit_invitee jsonb;
begin
  if p_invitee_user_id is null then
    raise exception 'invitee_user_id is required';
  end if;

  if p_draw_order_id is null then
    return jsonb_build_object(
      'processed', false,
      'reason', 'draw_order_required'
    );
  end if;

  select *
  into v_order
  from gacha.draw_orders
  where id = p_draw_order_id
  for update;

  if v_order.id is null or v_order.user_id <> p_invitee_user_id then
    return jsonb_build_object(
      'processed', false,
      'reason', 'draw_order_not_found'
    );
  end if;

  select count(*)::integer
  into v_result_count
  from gacha.draw_results
  where draw_order_id = p_draw_order_id
    and user_id = p_invitee_user_id;

  v_required_result_count := greatest(coalesce(v_order.draw_count, v_order.quantity, 1), 1);

  if v_order.status not in ('opening', 'opened', 'completed')
     or v_result_count < v_required_result_count then
    return jsonb_build_object(
      'processed', false,
      'reason', 'draw_order_not_successful',
      'draw_order_id', p_draw_order_id,
      'status', v_order.status,
      'result_count', v_result_count,
      'required_result_count', v_required_result_count
    );
  end if;

  select exists (
    select 1
    from gacha.draw_orders prior_order
    where prior_order.user_id = p_invitee_user_id
      and prior_order.id <> p_draw_order_id
      and prior_order.status in ('opened', 'completed')
      and coalesce(prior_order.opened_at, prior_order.updated_at, prior_order.created_at)
          < coalesce(v_order.opened_at, now())
      and exists (
        select 1
        from gacha.draw_results prior_result
        where prior_result.draw_order_id = prior_order.id
          and prior_result.user_id = p_invitee_user_id
      )
  )
  into v_has_prior_successful_open;

  if v_has_prior_successful_open then
    return jsonb_build_object(
      'processed', false,
      'reason', 'not_first_successful_open',
      'draw_order_id', p_draw_order_id
    );
  end if;

  select *
  into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id
  for update;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_referral');
  end if;

  if v_ref.status = 'rewarded' then
    return jsonb_build_object(
      'processed', v_ref.first_open_order_id = p_draw_order_id,
      'reason', case
        when v_ref.first_open_order_id = p_draw_order_id then 'already_processed'
        else 'already_rewarded'
      end,
      'referral_id', v_ref.id,
      'draw_order_id', v_ref.first_open_order_id,
      'idempotent', v_ref.first_open_order_id = p_draw_order_id
    );
  end if;

  if v_ref.status not in ('pending', 'qualified') then
    return jsonb_build_object(
      'processed', false,
      'reason', 'referral_not_active',
      'referral_id', v_ref.id,
      'status', v_ref.status
    );
  end if;

  select amount
  into v_inviter_reward
  from economy.reward_rules
  where code = 'REFERRAL_FIRST_OPEN_INVITER'
    and active = true;

  select amount
  into v_invitee_reward
  from economy.reward_rules
  where code = 'REFERRAL_FIRST_OPEN_INVITEE'
    and active = true;

  v_inviter_reward := coalesce(v_inviter_reward, 500);
  v_invitee_reward := coalesce(v_invitee_reward, 500);

  v_credit_inviter := api._credit_balance(
    v_ref.inviter_user_id,
    'KCOIN',
    v_inviter_reward,
    'referral_first_open',
    v_ref.id,
    p_draw_order_id::text,
    'referral_first_open:inviter:' || v_ref.id::text,
    'Referral first open inviter reward',
    jsonb_build_object(
      'invitee_user_id', p_invitee_user_id,
      'draw_order_id', p_draw_order_id
    )
  );

  v_credit_invitee := api._credit_balance(
    v_ref.invitee_user_id,
    'KCOIN',
    v_invitee_reward,
    'referral_first_open',
    v_ref.id,
    p_draw_order_id::text,
    'referral_first_open:invitee:' || v_ref.id::text,
    'Referral first open invitee reward',
    jsonb_build_object(
      'inviter_user_id', v_ref.inviter_user_id,
      'draw_order_id', p_draw_order_id
    )
  );

  insert into tasks.referral_rewards (
    referral_id,
    user_id,
    reward_role,
    currency_code,
    amount,
    ledger_id,
    status
  ) values
    (
      v_ref.id,
      v_ref.inviter_user_id,
      'inviter',
      'KCOIN',
      v_inviter_reward,
      (v_credit_inviter ->> 'ledger_id')::uuid,
      'granted'
    ),
    (
      v_ref.id,
      v_ref.invitee_user_id,
      'invitee',
      'KCOIN',
      v_invitee_reward,
      (v_credit_invitee ->> 'ledger_id')::uuid,
      'granted'
    )
  on conflict (referral_id, reward_role) do update
  set ledger_id = coalesce(tasks.referral_rewards.ledger_id, excluded.ledger_id),
      status = 'granted';

  update tasks.referrals
  set status = 'rewarded',
      first_open_order_id = p_draw_order_id,
      qualified_at = coalesce(qualified_at, now()),
      rewarded_at = now(),
      updated_at = now()
  where id = v_ref.id;

  return jsonb_build_object(
    'processed', true,
    'referral_id', v_ref.id,
    'draw_order_id', p_draw_order_id,
    'inviter_reward', v_inviter_reward,
    'invitee_reward', v_invitee_reward,
    'inviter_ledger_id', (v_credit_inviter ->> 'ledger_id')::uuid,
    'invitee_ledger_id', (v_credit_invitee ->> 'ledger_id')::uuid,
    'idempotent', false
  );
end;
$$;

grant execute on function api.referral_process_first_open(uuid, uuid)
  to service_role;

commit;
