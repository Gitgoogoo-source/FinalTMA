create or replace function api.mint_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object('mints', coalesce((
    select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
    from onchain.mints m where m.user_id = v_user_id
  ), '[]'::jsonb));
end;
$$;

create or replace function api.mint_get(p_session_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select onchain.mint_json(m) into v_result
  from onchain.mints m where m.id = p_mint_id and m.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.mint_metadata(p_nft_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select snapshot into v_result from onchain.nft_metadata where nft_number = p_nft_id;
  if v_result is null then
    perform api.raise_business_error('NFT_METADATA_NOT_FOUND', 'NFT 元数据不存在');
  end if;
  return v_result;
end;
$$;
