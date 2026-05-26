-- album_claim_milestone.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.album_claim_milestone

create or replace function api.album_claim_milestone(
  p_user_id uuid,
  p_milestone_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone album.milestones%rowtype;
  v_collected_count integer;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_milestone_id is null then
    raise exception 'user_id and milestone_id are required';
  end if;

  select * into v_milestone
  from album.milestones
  where id = p_milestone_id and active = true;

  if v_milestone.id is null then
    raise exception 'milestone not found';
  end if;

  select id into v_claim_id
  from album.milestone_claims
  where user_id = p_user_id and milestone_id = p_milestone_id;

  if v_claim_id is not null then
    return jsonb_build_object('claim_id', v_claim_id, 'idempotent', true);
  end if;

  select count(*)::integer into v_collected_count
  from album.book_items bi
  join album.user_discoveries ud on ud.template_id = bi.template_id and ud.user_id = p_user_id
  where bi.book_id = v_milestone.book_id;

  if v_collected_count < v_milestone.required_count then
    raise exception 'milestone not reached: collected %, required %', v_collected_count, v_milestone.required_count;
  end if;

  insert into album.milestone_claims (user_id, milestone_id, reward)
  values (p_user_id, p_milestone_id, v_milestone.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_milestone.reward, 'album_milestone', v_claim_id, 'album_milestone:' || v_claim_id::text
  );

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'collected_count', v_collected_count,
    'required_count', v_milestone.required_count,
    'reward', v_milestone.reward,
    'ledger_results', v_rewards_result
  );
end;
$$;


-- ============================================================
