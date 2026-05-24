begin;

alter table album.milestone_claims
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column album.milestone_claims.idempotency_key is 'Client supplied idempotency key for album milestone reward claims.';
comment on column album.milestone_claims.request_fingerprint is 'Stable fingerprint of the album milestone claim request guarded by the idempotency key.';

create unique index if not exists milestone_claims_idempotency_key_uidx
  on album.milestone_claims (idempotency_key)
  where idempotency_key is not null;

revoke execute on function api.album_claim_milestone(uuid, uuid) from public, anon, authenticated, service_role;
drop function if exists api.album_claim_milestone(uuid, uuid);
drop function if exists api.album_claim_milestone(uuid, uuid, text);

create or replace function api.album_claim_milestone(
  p_user_id uuid,
  p_milestone_id uuid,
  p_idempotency_key text,
  p_expected_milestone_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone album.milestones%rowtype;
  v_claim album.milestone_claims%rowtype;
  v_collected_count integer;
  v_milestone_version integer;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_request_fingerprint text;
  v_rewards_result jsonb := '[]'::jsonb;
begin
  if p_user_id is null or p_milestone_id is null then
    raise exception 'user_id and milestone_id are required';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  v_request_fingerprint := p_user_id::text || ':' || p_milestone_id::text;

  select * into v_claim
  from album.milestone_claims
  where idempotency_key = v_idempotency_key
  for update;

  if v_claim.id is not null then
    if v_claim.user_id <> p_user_id or v_claim.milestone_id <> p_milestone_id then
      raise exception 'idempotency conflict';
    end if;

    select * into v_milestone
    from album.milestones
    where id = v_claim.milestone_id;

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'milestone_id', v_claim.milestone_id,
      'book_id', v_milestone.book_id,
      'status', 'claimed',
      'required_count', v_milestone.required_count,
      'reward', v_claim.reward,
      'rewards', api._album_normalize_rewards(v_claim.reward),
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true
    );
  end if;

  select * into v_milestone
  from album.milestones
  where id = p_milestone_id and active = true;

  if v_milestone.id is null then
    raise exception 'milestone not found';
  end if;

  v_milestone_version := case
    when (v_milestone.metadata ->> 'version') ~ '^[0-9]+$'
      then (v_milestone.metadata ->> 'version')::integer
    else 0
  end;

  select * into v_claim
  from album.milestone_claims
  where user_id = p_user_id and milestone_id = p_milestone_id
  for update;

  if v_claim.id is not null then
    if v_claim.idempotency_key is null then
      update album.milestone_claims
      set idempotency_key = v_idempotency_key,
          request_fingerprint = v_request_fingerprint,
          metadata = metadata || jsonb_build_object('idempotency_key_backfilled_at', now())
      where id = v_claim.id
      returning * into v_claim;
    end if;

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'milestone_id', v_claim.milestone_id,
      'book_id', v_milestone.book_id,
      'status', 'claimed',
      'required_count', v_milestone.required_count,
      'reward', v_claim.reward,
      'rewards', api._album_normalize_rewards(v_claim.reward),
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true
    );
  end if;

  if p_expected_milestone_version is not null
     and p_expected_milestone_version <> v_milestone_version then
    raise exception 'milestone version mismatch: expected %, current %',
      p_expected_milestone_version,
      v_milestone_version;
  end if;

  select count(*)::integer into v_collected_count
  from album.book_items bi
  join album.user_discoveries ud
    on ud.template_id = bi.template_id
   and ud.user_id = p_user_id
  where bi.book_id = v_milestone.book_id;

  if v_collected_count < v_milestone.required_count then
    raise exception 'milestone not reached: collected %, required %', v_collected_count, v_milestone.required_count;
  end if;

  insert into album.milestone_claims (
    user_id,
    milestone_id,
    reward,
    idempotency_key,
    request_fingerprint,
    metadata
  )
  values (
    p_user_id,
    p_milestone_id,
    v_milestone.reward,
    v_idempotency_key,
    v_request_fingerprint,
    jsonb_build_object(
      'idempotency_key_source', 'api',
      'expected_milestone_version', p_expected_milestone_version,
      'milestone_version', v_milestone_version
    )
  )
  returning * into v_claim;

  v_rewards_result := api._apply_reward_json(
    p_user_id,
    v_milestone.reward,
    'album_milestone',
    v_claim.id,
    'album_milestone:' || v_idempotency_key
  );

  return jsonb_build_object(
    'claim_id', v_claim.id,
    'milestone_id', v_claim.milestone_id,
    'book_id', v_milestone.book_id,
    'status', 'claimed',
    'collected_count', v_collected_count,
    'required_count', v_milestone.required_count,
    'reward', v_milestone.reward,
    'rewards', api._album_normalize_rewards(v_milestone.reward),
    'ledger_results', v_rewards_result,
    'claimed_at', v_claim.claimed_at,
    'idempotent', false,
    'milestone_version', v_milestone_version
  );
end;
$$;

revoke execute on function api.album_claim_milestone(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function api.album_claim_milestone(uuid, uuid, text, integer) to service_role;

commit;
