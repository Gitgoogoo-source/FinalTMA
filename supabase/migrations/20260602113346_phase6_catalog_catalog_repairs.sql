begin;

drop policy if exists catalog_series_read_active on catalog.series;
drop policy if exists catalog_series_read_public on catalog.series;
drop policy if exists catalog_templates_read_active on catalog.collectible_templates;
drop policy if exists catalog_templates_read_public on catalog.collectible_templates;
drop policy if exists catalog_forms_read on catalog.collectible_forms;
drop policy if exists catalog_forms_read_public on catalog.collectible_forms;
drop policy if exists catalog_media_read on catalog.collectible_media;
drop policy if exists catalog_media_read_public on catalog.collectible_media;

create policy catalog_series_read_public
on catalog.series
for select
to anon, authenticated
using (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

create policy catalog_templates_read_public
on catalog.collectible_templates
for select
to anon, authenticated
using (release_status = 'active');

create policy catalog_forms_read_public
on catalog.collectible_forms
for select
to anon, authenticated
using (
  exists (
    select 1
    from catalog.collectible_templates t
    where t.id = collectible_forms.template_id
      and t.release_status = 'active'
  )
);

create policy catalog_media_read_public
on catalog.collectible_media
for select
to anon, authenticated
using (
  exists (
    select 1
    from catalog.collectible_templates t
    where t.id = collectible_media.template_id
      and t.release_status = 'active'
  )
);

create or replace view public.v_collectible_catalog
with (security_invoker = true) as
select
  t.id as template_id,
  t.slug,
  t.display_name,
  t.subtitle,
  t.description,
  t.rarity_code,
  r.display_name as rarity_name,
  r.sort_order as rarity_sort_order,
  t.type_code,
  it.display_name as type_name,
  t.series_id,
  s.display_name as series_name,
  t.faction_id,
  f.display_name as faction_name,
  t.base_power,
  t.max_level,
  t.tradeable,
  t.upgradeable,
  t.evolvable,
  t.decomposable,
  t.nft_mintable,
  t.release_status,
  coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'form_id', cf.id,
        'form_index', cf.form_index,
        'form_slug', cf.form_slug,
        'display_name', cf.display_name,
        'image_url', cf.image_url,
        'thumbnail_url', cf.thumbnail_url,
        'avatar_url', cf.avatar_url,
        'is_default', cf.is_default
      )
    ) filter (where cf.id is not null),
    '[]'::jsonb
  ) as forms
from catalog.collectible_templates t
join catalog.rarities r on r.code = t.rarity_code
join catalog.item_types it on it.code = t.type_code
left join catalog.series s on s.id = t.series_id
left join catalog.factions f on f.id = t.faction_id
left join catalog.collectible_forms cf on cf.template_id = t.id
where t.release_status = 'active'
group by t.id, r.code, r.display_name, r.sort_order, it.code, it.display_name, s.id, s.display_name, f.id, f.display_name;

revoke all on public.v_collectible_catalog from public, anon, authenticated;
grant select on public.v_collectible_catalog to anon, authenticated;

create or replace function catalog.enforce_collectible_supply_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_issued_count integer;
begin
  select supply_limit
  into v_limit
  from catalog.collectible_templates
  where id = new.template_id
  for update;

  if v_limit is null then
    return new;
  end if;

  select count(*)::integer
  into v_issued_count
  from inventory.item_instances
  where template_id = new.template_id;

  if v_issued_count >= v_limit then
    raise exception 'CATALOG_SUPPLY_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists item_instances_enforce_collectible_supply_limit on inventory.item_instances;
create trigger item_instances_enforce_collectible_supply_limit
before insert on inventory.item_instances
for each row
execute function catalog.enforce_collectible_supply_limit();

create or replace function api._catalog_collectible_snapshot(p_template_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'template', to_jsonb(t),
    'forms', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.form_index asc, f.id asc)
      from catalog.collectible_forms f
      where f.template_id = t.id
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order asc, m.media_type asc, m.id asc)
      from catalog.collectible_media m
      where m.template_id = t.id
    ), '[]'::jsonb)
  )
  from catalog.collectible_templates t
  where t.id = p_template_id;
$$;

create or replace function api._admin_validate_album_reward_config(p_reward jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_reward_type text;
  v_currency text;
  v_amount_text text;
  v_template_id uuid;
  v_form_id uuid;
  v_quantity integer;
  v_template catalog.collectible_templates%rowtype;
begin
  if p_reward is null or jsonb_typeof(p_reward) <> 'array' then
    raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_reward) as reward_row(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
    end if;

    v_reward_type := upper(nullif(btrim(coalesce(
      v_item ->> 'reward_type',
      v_item ->> 'type',
      v_item ->> 'currency'
    )), ''));

    v_currency := upper(nullif(btrim(coalesce(
      v_item ->> 'currency',
      case
        when v_reward_type in ('KCOIN', 'FGEMS', 'STAR_DISPLAY') then v_reward_type
        else null
      end
    )), ''));

    if v_currency is not null then
      if not exists (
        select 1
        from economy.currencies
        where code = v_currency
      ) then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      v_amount_text := nullif(btrim(coalesce(v_item ->> 'amount', '')), '');
      if v_amount_text is null
         or v_amount_text !~ '^[0-9]+$'
         or v_amount_text::numeric(38,0) <= 0 then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      continue;
    end if;

    if v_reward_type in ('ITEM', 'DECORATION', 'COLLECTIBLE') then
      v_template_id := nullif(btrim(coalesce(
        v_item ->> 'template_id',
        v_item ->> 'templateId',
        v_item ->> 'item_template_id',
        v_item ->> 'itemTemplateId',
        v_item ->> 'item_id',
        v_item ->> 'itemId',
        v_item ->> 'decoration_id',
        v_item ->> 'decorationId'
      )), '')::uuid;

      if v_template_id is null then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      select *
      into v_template
      from catalog.collectible_templates
      where id = v_template_id
        and release_status in ('active', 'hidden');

      if not found then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      if v_reward_type = 'DECORATION' and upper(v_template.type_code) <> 'DECORATION' then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      v_form_id := nullif(btrim(coalesce(
        v_item ->> 'form_id',
        v_item ->> 'formId',
        v_item ->> 'item_form_id',
        v_item ->> 'itemFormId'
      )), '')::uuid;

      if v_form_id is not null
         and not exists (
           select 1
           from catalog.collectible_forms
           where id = v_form_id
             and template_id = v_template_id
         ) then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      v_quantity := coalesce(nullif(v_item ->> 'quantity', '')::integer, 1);
      if v_quantity < 1 or v_quantity > 100 then
        raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
      end if;

      continue;
    end if;

    raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
  end loop;
end;
$$;

create or replace function api.admin_upsert_collectible_template(
  p_admin_user_id uuid,
  p_template_id uuid default null,
  p_template jsonb default '{}'::jsonb,
  p_forms jsonb default null,
  p_media jsonb default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'catalog.collectible_template.upsert';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_is_create boolean := false;
  v_body jsonb := coalesce(p_template, '{}'::jsonb);
  v_template_id uuid;
  v_slug text;
  v_display_name text;
  v_subtitle text;
  v_description text;
  v_rarity_code text;
  v_type_code text;
  v_series_id uuid;
  v_faction_id uuid;
  v_base_power integer;
  v_max_level integer;
  v_supply_limit integer;
  v_release_status text;
  v_tradeable boolean;
  v_upgradeable boolean;
  v_evolvable boolean;
  v_decomposable boolean;
  v_nft_mintable boolean;
  v_sort_order integer;
  v_metadata jsonb;
  v_request_hash text;
  v_issued_count integer;
  v_form jsonb;
  v_form_id uuid;
  v_current_form_id uuid;
  v_form_slug text;
  v_form_index integer;
  v_form_display_name text;
  v_next_form_id uuid;
  v_next_form_slug text;
  v_kept_form_ids uuid[] := array[]::uuid[];
  v_media jsonb;
  v_media_type text;
  v_media_url text;
  v_media_form_id uuid;
  v_media_form_slug text;
  v_width integer;
  v_height integer;
  v_media_sort_order integer;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_body) <> 'object' then
    raise exception 'ADMIN_CATALOG_TEMPLATE_INVALID' using errcode = 'P0001';
  end if;

  if p_forms is not null and jsonb_typeof(p_forms) <> 'array' then
    raise exception 'ADMIN_CATALOG_FORMS_INVALID' using errcode = 'P0001';
  end if;

  if p_media is not null and jsonb_typeof(p_media) <> 'array' then
    raise exception 'ADMIN_CATALOG_MEDIA_INVALID' using errcode = 'P0001';
  end if;

  v_template_id := coalesce(p_template_id, nullif(v_body ->> 'id', '')::uuid);
  v_slug := lower(nullif(btrim(coalesce(v_body ->> 'slug', '')), ''));

  if v_template_id is not null then
    select *
    into v_template
    from catalog.collectible_templates
    where id = v_template_id
    for update;
  elsif v_slug is not null then
    select *
    into v_template
    from catalog.collectible_templates
    where slug = v_slug
    for update;
  end if;

  v_is_create := not found;

  if v_is_create then
    v_template_id := coalesce(v_template_id, gen_random_uuid());
    v_display_name := nullif(btrim(coalesce(v_body ->> 'display_name', '')), '');
    v_rarity_code := upper(nullif(btrim(coalesce(v_body ->> 'rarity_code', '')), ''));
    v_type_code := upper(nullif(btrim(coalesce(v_body ->> 'type_code', '')), ''));
    v_subtitle := nullif(btrim(coalesce(v_body ->> 'subtitle', '')), '');
    v_description := nullif(btrim(coalesce(v_body ->> 'description', '')), '');
    v_series_id := nullif(v_body ->> 'series_id', '')::uuid;
    v_faction_id := nullif(v_body ->> 'faction_id', '')::uuid;
    v_base_power := coalesce(nullif(v_body ->> 'base_power', '')::integer, 0);
    v_max_level := coalesce(nullif(v_body ->> 'max_level', '')::integer, 100);
    v_supply_limit := nullif(v_body ->> 'supply_limit', '')::integer;
    v_release_status := coalesce(lower(nullif(btrim(coalesce(v_body ->> 'release_status', '')), '')), 'draft');
    v_tradeable := coalesce((v_body ->> 'tradeable')::boolean, true);
    v_upgradeable := coalesce((v_body ->> 'upgradeable')::boolean, true);
    v_evolvable := coalesce((v_body ->> 'evolvable')::boolean, true);
    v_decomposable := coalesce((v_body ->> 'decomposable')::boolean, true);
    v_nft_mintable := coalesce((v_body ->> 'nft_mintable')::boolean, true);
    v_sort_order := coalesce(nullif(v_body ->> 'sort_order', '')::integer, 100);
    v_metadata := coalesce(v_body -> 'metadata', '{}'::jsonb);

    if v_slug is null or v_display_name is null or v_rarity_code is null or v_type_code is null then
      raise exception 'ADMIN_CATALOG_TEMPLATE_REQUIRED' using errcode = 'P0001';
    end if;
  else
    v_template_id := v_template.id;
    v_slug := case when v_body ? 'slug' then lower(nullif(btrim(coalesce(v_body ->> 'slug', '')), '')) else v_template.slug end;
    v_display_name := case when v_body ? 'display_name' then nullif(btrim(coalesce(v_body ->> 'display_name', '')), '') else v_template.display_name end;
    v_subtitle := case when v_body ? 'subtitle' then nullif(btrim(coalesce(v_body ->> 'subtitle', '')), '') else v_template.subtitle end;
    v_description := case when v_body ? 'description' then nullif(btrim(coalesce(v_body ->> 'description', '')), '') else v_template.description end;
    v_rarity_code := case when v_body ? 'rarity_code' then upper(nullif(btrim(coalesce(v_body ->> 'rarity_code', '')), '')) else v_template.rarity_code end;
    v_type_code := case when v_body ? 'type_code' then upper(nullif(btrim(coalesce(v_body ->> 'type_code', '')), '')) else v_template.type_code end;
    v_series_id := case when v_body ? 'series_id' then nullif(v_body ->> 'series_id', '')::uuid else v_template.series_id end;
    v_faction_id := case when v_body ? 'faction_id' then nullif(v_body ->> 'faction_id', '')::uuid else v_template.faction_id end;
    v_base_power := case when v_body ? 'base_power' then nullif(v_body ->> 'base_power', '')::integer else v_template.base_power end;
    v_max_level := case when v_body ? 'max_level' then nullif(v_body ->> 'max_level', '')::integer else v_template.max_level end;
    v_supply_limit := case when v_body ? 'supply_limit' then nullif(v_body ->> 'supply_limit', '')::integer else v_template.supply_limit end;
    v_release_status := case when v_body ? 'release_status' then lower(nullif(btrim(coalesce(v_body ->> 'release_status', '')), '')) else v_template.release_status end;
    v_tradeable := case when v_body ? 'tradeable' then (v_body ->> 'tradeable')::boolean else v_template.tradeable end;
    v_upgradeable := case when v_body ? 'upgradeable' then (v_body ->> 'upgradeable')::boolean else v_template.upgradeable end;
    v_evolvable := case when v_body ? 'evolvable' then (v_body ->> 'evolvable')::boolean else v_template.evolvable end;
    v_decomposable := case when v_body ? 'decomposable' then (v_body ->> 'decomposable')::boolean else v_template.decomposable end;
    v_nft_mintable := case when v_body ? 'nft_mintable' then (v_body ->> 'nft_mintable')::boolean else v_template.nft_mintable end;
    v_sort_order := case when v_body ? 'sort_order' then nullif(v_body ->> 'sort_order', '')::integer else v_template.sort_order end;
    v_metadata := case when v_body ? 'metadata' then v_body -> 'metadata' else v_template.metadata end;
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
    raise exception 'ADMIN_CATALOG_TEMPLATE_SLUG_INVALID' using errcode = 'P0001';
  end if;

  if v_display_name is null then
    raise exception 'ADMIN_CATALOG_TEMPLATE_NAME_REQUIRED' using errcode = 'P0001';
  end if;

  if v_rarity_code is null or not exists (select 1 from catalog.rarities where code = v_rarity_code) then
    raise exception 'ADMIN_CATALOG_TEMPLATE_RARITY_INVALID' using errcode = 'P0001';
  end if;

  if v_type_code is null or not exists (select 1 from catalog.item_types where code = v_type_code) then
    raise exception 'ADMIN_CATALOG_TEMPLATE_TYPE_INVALID' using errcode = 'P0001';
  end if;

  if v_series_id is not null and not exists (select 1 from catalog.series where id = v_series_id) then
    raise exception 'ADMIN_CATALOG_TEMPLATE_SERIES_INVALID' using errcode = 'P0001';
  end if;

  if v_faction_id is not null and not exists (select 1 from catalog.factions where id = v_faction_id) then
    raise exception 'ADMIN_CATALOG_TEMPLATE_FACTION_INVALID' using errcode = 'P0001';
  end if;

  if v_base_power is null or v_base_power < 0 then
    raise exception 'ADMIN_CATALOG_TEMPLATE_BASE_POWER_INVALID' using errcode = 'P0001';
  end if;

  if v_max_level is null or v_max_level <= 0 then
    raise exception 'ADMIN_CATALOG_TEMPLATE_MAX_LEVEL_INVALID' using errcode = 'P0001';
  end if;

  if v_supply_limit is not null and v_supply_limit < 0 then
    raise exception 'ADMIN_CATALOG_TEMPLATE_SUPPLY_LIMIT_INVALID' using errcode = 'P0001';
  end if;

  if v_release_status is null or v_release_status not in ('draft', 'active', 'hidden', 'retired') then
    raise exception 'ADMIN_CATALOG_TEMPLATE_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_sort_order is null or v_sort_order < 0 then
    raise exception 'ADMIN_CATALOG_TEMPLATE_SORT_INVALID' using errcode = 'P0001';
  end if;

  if v_metadata is null or jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_CATALOG_TEMPLATE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if not v_is_create and v_supply_limit is not null then
    select count(*)::integer
    into v_issued_count
    from inventory.item_instances
    where template_id = v_template_id;

    if v_issued_count > v_supply_limit then
      raise exception 'ADMIN_CATALOG_TEMPLATE_SUPPLY_LIMIT_BELOW_ISSUED' using errcode = 'P0001';
    end if;
  end if;

  v_before := case
    when v_is_create then null
    else api._catalog_collectible_snapshot(v_template_id)
  end;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'template_id', v_template_id,
    'template', v_body,
    'forms', p_forms,
    'media', p_media,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_is_create then
    insert into catalog.collectible_templates (
      id,
      slug,
      display_name,
      subtitle,
      description,
      rarity_code,
      type_code,
      series_id,
      faction_id,
      base_power,
      max_level,
      supply_limit,
      release_status,
      tradeable,
      upgradeable,
      evolvable,
      decomposable,
      nft_mintable,
      sort_order,
      metadata
    )
    values (
      v_template_id,
      v_slug,
      v_display_name,
      v_subtitle,
      v_description,
      v_rarity_code,
      v_type_code,
      v_series_id,
      v_faction_id,
      v_base_power,
      v_max_level,
      v_supply_limit,
      v_release_status,
      v_tradeable,
      v_upgradeable,
      v_evolvable,
      v_decomposable,
      v_nft_mintable,
      v_sort_order,
      v_metadata
    )
    returning * into v_template;
  else
    update catalog.collectible_templates
    set slug = v_slug,
        display_name = v_display_name,
        subtitle = v_subtitle,
        description = v_description,
        rarity_code = v_rarity_code,
        type_code = v_type_code,
        series_id = v_series_id,
        faction_id = v_faction_id,
        base_power = v_base_power,
        max_level = v_max_level,
        supply_limit = v_supply_limit,
        release_status = v_release_status,
        tradeable = v_tradeable,
        upgradeable = v_upgradeable,
        evolvable = v_evolvable,
        decomposable = v_decomposable,
        nft_mintable = v_nft_mintable,
        sort_order = v_sort_order,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_template_id
    returning * into v_template;
  end if;

  if p_forms is not null then
    if (
      select count(*)::integer
      from jsonb_array_elements(p_forms) as form_row(value)
      where coalesce((form_row.value ->> 'is_default')::boolean, false)
    ) > 1 then
      raise exception 'ADMIN_CATALOG_FORMS_DEFAULT_CONFLICT' using errcode = 'P0001';
    end if;

    update catalog.collectible_forms
    set is_default = false,
        updated_at = v_now
    where template_id = v_template.id;

    for v_form in select value from jsonb_array_elements(p_forms) as form_row(value)
    loop
      if jsonb_typeof(v_form) <> 'object' then
        raise exception 'ADMIN_CATALOG_FORMS_INVALID' using errcode = 'P0001';
      end if;

      v_form_id := nullif(v_form ->> 'id', '')::uuid;
      v_form_slug := lower(nullif(btrim(coalesce(v_form ->> 'form_slug', v_form ->> 'slug', '')), ''));
      v_form_index := nullif(v_form ->> 'form_index', '')::integer;
      v_form_display_name := nullif(btrim(coalesce(v_form ->> 'display_name', '')), '');

      if v_form_slug is null or v_form_slug !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        raise exception 'ADMIN_CATALOG_FORM_SLUG_INVALID' using errcode = 'P0001';
      end if;

      if v_form_index is null or v_form_index < 1 then
        raise exception 'ADMIN_CATALOG_FORM_INDEX_INVALID' using errcode = 'P0001';
      end if;

      if v_form_display_name is null then
        raise exception 'ADMIN_CATALOG_FORM_NAME_REQUIRED' using errcode = 'P0001';
      end if;

      if coalesce(v_form -> 'metadata', '{}'::jsonb) is null
         or jsonb_typeof(coalesce(v_form -> 'metadata', '{}'::jsonb)) <> 'object' then
        raise exception 'ADMIN_CATALOG_FORM_METADATA_INVALID' using errcode = 'P0001';
      end if;

      if v_form_id is not null then
        update catalog.collectible_forms
        set form_index = v_form_index,
            form_slug = v_form_slug,
            display_name = v_form_display_name,
            description = nullif(btrim(coalesce(v_form ->> 'description', '')), ''),
            image_url = nullif(btrim(coalesce(v_form ->> 'image_url', '')), ''),
            thumbnail_url = nullif(btrim(coalesce(v_form ->> 'thumbnail_url', '')), ''),
            avatar_url = nullif(btrim(coalesce(v_form ->> 'avatar_url', '')), ''),
            base_power_bonus = coalesce(nullif(v_form ->> 'base_power_bonus', '')::integer, 0),
            is_default = coalesce((v_form ->> 'is_default')::boolean, false),
            next_form_id = null,
            metadata = coalesce(v_form -> 'metadata', '{}'::jsonb),
            updated_at = v_now
        where id = v_form_id
          and template_id = v_template.id
        returning id into v_form_id;

        if not found then
          raise exception 'ADMIN_CATALOG_FORM_NOT_FOUND' using errcode = 'P0001';
        end if;
      else
        insert into catalog.collectible_forms (
          template_id,
          form_index,
          form_slug,
          display_name,
          description,
          image_url,
          thumbnail_url,
          avatar_url,
          base_power_bonus,
          is_default,
          next_form_id,
          metadata
        )
        values (
          v_template.id,
          v_form_index,
          v_form_slug,
          v_form_display_name,
          nullif(btrim(coalesce(v_form ->> 'description', '')), ''),
          nullif(btrim(coalesce(v_form ->> 'image_url', '')), ''),
          nullif(btrim(coalesce(v_form ->> 'thumbnail_url', '')), ''),
          nullif(btrim(coalesce(v_form ->> 'avatar_url', '')), ''),
          coalesce(nullif(v_form ->> 'base_power_bonus', '')::integer, 0),
          coalesce((v_form ->> 'is_default')::boolean, false),
          null,
          coalesce(v_form -> 'metadata', '{}'::jsonb)
        )
        on conflict (template_id, form_slug) do update
        set form_index = excluded.form_index,
            display_name = excluded.display_name,
            description = excluded.description,
            image_url = excluded.image_url,
            thumbnail_url = excluded.thumbnail_url,
            avatar_url = excluded.avatar_url,
            base_power_bonus = excluded.base_power_bonus,
            is_default = excluded.is_default,
            next_form_id = null,
            metadata = excluded.metadata,
            updated_at = v_now
        returning id into v_form_id;
      end if;

      v_kept_form_ids := array_append(v_kept_form_ids, v_form_id);
    end loop;

    if exists (
      select 1
      from catalog.collectible_forms cf
      where cf.template_id = v_template.id
        and not (cf.id = any(v_kept_form_ids))
        and exists (
          select 1
          from inventory.item_instances ii
          where ii.form_id = cf.id
        )
    ) then
      raise exception 'ADMIN_CATALOG_FORM_IN_USE' using errcode = 'P0001';
    end if;

    delete from catalog.collectible_forms
    where template_id = v_template.id
      and not (id = any(v_kept_form_ids));

    for v_form in select value from jsonb_array_elements(p_forms) as form_row(value)
    loop
      v_form_slug := lower(nullif(btrim(coalesce(v_form ->> 'form_slug', v_form ->> 'slug', '')), ''));
      v_next_form_slug := lower(nullif(btrim(coalesce(v_form ->> 'next_form_slug', '')), ''));
      v_next_form_id := nullif(v_form ->> 'next_form_id', '')::uuid;

      if v_next_form_slug is not null then
        select id
        into v_next_form_id
        from catalog.collectible_forms
        where template_id = v_template.id
          and form_slug = v_next_form_slug;

        if not found then
          raise exception 'ADMIN_CATALOG_NEXT_FORM_NOT_FOUND' using errcode = 'P0001';
        end if;
      elsif v_next_form_id is not null
            and not exists (
              select 1
              from catalog.collectible_forms
              where id = v_next_form_id
                and template_id = v_template.id
            ) then
        raise exception 'ADMIN_CATALOG_NEXT_FORM_NOT_FOUND' using errcode = 'P0001';
      end if;

      select id
      into v_current_form_id
      from catalog.collectible_forms
      where template_id = v_template.id
        and form_slug = v_form_slug;

      update catalog.collectible_forms
      set next_form_id = v_next_form_id,
          updated_at = v_now
      where id = v_current_form_id;
    end loop;
  end if;

  if p_media is not null then
    delete from catalog.collectible_media
    where template_id = v_template.id;

    for v_media in select value from jsonb_array_elements(p_media) as media_row(value)
    loop
      if jsonb_typeof(v_media) <> 'object' then
        raise exception 'ADMIN_CATALOG_MEDIA_INVALID' using errcode = 'P0001';
      end if;

      v_media_type := lower(nullif(btrim(coalesce(v_media ->> 'media_type', '')), ''));
      v_media_url := nullif(btrim(coalesce(v_media ->> 'url', '')), '');
      v_media_form_id := nullif(v_media ->> 'form_id', '')::uuid;
      v_media_form_slug := lower(nullif(btrim(coalesce(v_media ->> 'form_slug', '')), ''));
      v_width := nullif(v_media ->> 'width', '')::integer;
      v_height := nullif(v_media ->> 'height', '')::integer;
      v_media_sort_order := coalesce(nullif(v_media ->> 'sort_order', '')::integer, 100);

      if v_media_type not in ('avatar', 'thumb', 'card', 'hero', 'animation', 'nft_image', 'metadata') then
        raise exception 'ADMIN_CATALOG_MEDIA_TYPE_INVALID' using errcode = 'P0001';
      end if;

      if v_media_url is null then
        raise exception 'ADMIN_CATALOG_MEDIA_URL_REQUIRED' using errcode = 'P0001';
      end if;

      if v_media_form_slug is not null then
        select id
        into v_media_form_id
        from catalog.collectible_forms
        where template_id = v_template.id
          and form_slug = v_media_form_slug;

        if not found then
          raise exception 'ADMIN_CATALOG_MEDIA_FORM_NOT_FOUND' using errcode = 'P0001';
        end if;
      elsif v_media_form_id is not null
            and not exists (
              select 1
              from catalog.collectible_forms
              where id = v_media_form_id
                and template_id = v_template.id
            ) then
        raise exception 'ADMIN_CATALOG_MEDIA_FORM_NOT_FOUND' using errcode = 'P0001';
      end if;

      if (v_width is not null and v_width <= 0)
         or (v_height is not null and v_height <= 0)
         or v_media_sort_order < 0
         or jsonb_typeof(coalesce(v_media -> 'metadata', '{}'::jsonb)) <> 'object' then
        raise exception 'ADMIN_CATALOG_MEDIA_INVALID' using errcode = 'P0001';
      end if;

      insert into catalog.collectible_media (
        template_id,
        form_id,
        media_type,
        url,
        storage_bucket,
        storage_path,
        mime_type,
        width,
        height,
        sort_order,
        metadata
      )
      values (
        v_template.id,
        v_media_form_id,
        v_media_type,
        v_media_url,
        nullif(btrim(coalesce(v_media ->> 'storage_bucket', '')), ''),
        nullif(btrim(coalesce(v_media ->> 'storage_path', '')), ''),
        nullif(btrim(coalesce(v_media ->> 'mime_type', '')), ''),
        v_width,
        v_height,
        v_media_sort_order,
        coalesce(v_media -> 'metadata', '{}'::jsonb)
      );
    end loop;
  end if;

  v_after := api._catalog_collectible_snapshot(v_template.id);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'catalog.collectible_template.upsert',
    'catalog',
    'collectible_templates',
    v_template.id,
    coalesce(v_before, '{}'::jsonb),
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'template_id', v_template.id,
    'slug', v_template.slug,
    'release_status', v_template.release_status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_update_album_milestone(
  p_admin_user_id uuid,
  p_milestone_id uuid,
  p_title text default null,
  p_required_count integer default null,
  p_reward jsonb default null,
  p_active boolean default null,
  p_sort_order integer default null,
  p_metadata jsonb default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_milestone album.milestones%rowtype;
  v_book album.books%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'album.milestone.update';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_reward jsonb;
  v_metadata jsonb;
  v_request_hash text;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if p_milestone_id is null then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_required_count is not null and p_required_count <= 0 then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED_COUNT_INVALID' using errcode = 'P0001';
  end if;

  if p_sort_order is not null and p_sort_order < 0 then
    raise exception 'ADMIN_ALBUM_MILESTONE_SORT_INVALID' using errcode = 'P0001';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'ADMIN_ALBUM_MILESTONE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_milestone
  from album.milestones
  where id = p_milestone_id
  for update;

  if not found then
    raise exception 'ADMIN_ALBUM_MILESTONE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_book
  from album.books
  where id = v_milestone.book_id
  for update;

  v_reward := case
    when p_reward is null then v_milestone.reward
    else p_reward
  end;

  perform api._admin_validate_album_reward_config(v_reward);

  if p_required_count is not null
     and exists (
       select 1
       from album.milestones other
       where other.book_id = v_milestone.book_id
         and other.required_count = p_required_count
         and other.id <> v_milestone.id
     ) then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED_COUNT_CONFLICT' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_milestone);
  v_metadata := case
    when p_metadata is null then v_milestone.metadata
    else p_metadata
  end;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'milestone_id', p_milestone_id,
    'title', coalesce(v_title, v_milestone.title),
    'required_count', coalesce(p_required_count, v_milestone.required_count),
    'reward', v_reward,
    'active', coalesce(p_active, v_milestone.active),
    'sort_order', coalesce(p_sort_order, v_milestone.sort_order),
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  update album.milestones
  set title = coalesce(v_title, title),
      required_count = coalesce(p_required_count, required_count),
      reward = v_reward,
      active = coalesce(p_active, active),
      sort_order = coalesce(p_sort_order, sort_order),
      metadata = v_metadata,
      updated_at = v_now
  where id = p_milestone_id
  returning * into v_milestone;

  v_after := to_jsonb(v_milestone);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'album.milestone.update',
    'album',
    'milestones',
    v_milestone.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'book_id', v_book.id,
    'milestone_id', v_milestone.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function catalog.enforce_collectible_supply_limit() from public, anon, authenticated;
revoke all on function api._catalog_collectible_snapshot(uuid) from public, anon, authenticated;
revoke all on function api._admin_validate_album_reward_config(jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_collectible_template(uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_upsert_collectible_template(uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb) to service_role;

comment on function api.admin_upsert_collectible_template(uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb) is
  'Admin-only audited upsert for collectible templates, forms and media. Physical template delete is intentionally replaced by release_status=retired to preserve historical inventory references.';

comment on trigger item_instances_enforce_collectible_supply_limit on inventory.item_instances is
  'Enforces catalog.collectible_templates.supply_limit across every inventory.item_instances insertion path.';

commit;
