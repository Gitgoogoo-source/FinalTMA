-- Fulfill album milestone reward JSON for every reward type accepted by the
-- album API contract. Currency rewards go through the immutable ledger; item
-- and decoration rewards create inventory instances with per-reward idempotency.

alter table inventory.item_instances
  drop constraint if exists item_instances_source_type_check;

alter table inventory.item_instances
  add constraint item_instances_source_type_check
  check (
    source_type = any (
      array[
        'gacha'::text,
        'market'::text,
        'evolution'::text,
        'admin'::text,
        'admin_compensation'::text,
        'album_milestone'::text,
        'task_claim'::text,
        'daily_check_in'::text,
        'onchain_sync'::text,
        'airdrop'::text,
        'unknown'::text
      ]
    )
  );

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
  v_reward_type text;
  v_currency text;
  v_amount numeric(38,0);
  v_quantity integer;
  v_quantity_index integer;
  v_template_id uuid;
  v_form_id uuid;
  v_grant_form_id uuid;
  v_power integer;
  v_template catalog.collectible_templates%rowtype;
  v_existing_item inventory.item_instances%rowtype;
  v_granted_item inventory.item_instances%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_credit jsonb;
  v_idx integer := 0;
  v_source_type text := nullif(btrim(coalesce(p_source_type, '')), '');
  v_item_idempotency_key text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if v_source_type is null then
    raise exception 'source_type is required';
  end if;

  if p_reward is null then
    return '[]'::jsonb;
  end if;

  if jsonb_typeof(p_reward) <> 'array' then
    raise exception 'invalid reward config: reward must be an array';
  end if;

  for v_item in select * from jsonb_array_elements(p_reward)
  loop
    v_idx := v_idx + 1;

    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid reward config: reward item must be an object';
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
        raise exception 'invalid reward config: currency not found';
      end if;

      v_amount := nullif(v_item ->> 'amount', '')::numeric(38,0);
      if v_amount is null or v_amount <= 0 then
        raise exception 'invalid reward config: reward amount must be positive';
      end if;

      v_credit := api._credit_balance(
        p_user_id,
        v_currency,
        v_amount,
        v_source_type,
        p_source_id,
        null,
        p_idempotency_prefix || ':' || v_idx::text || ':' || v_currency,
        'reward_json',
        v_item
      );

      v_results := v_results || jsonb_build_array(
        v_credit || jsonb_build_object(
          'reward_type', v_currency,
          'amount', v_amount,
          'reward_index', v_idx
        )
      );
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
        raise exception 'invalid reward config: item template_id is required';
      end if;

      v_form_id := nullif(btrim(coalesce(
        v_item ->> 'form_id',
        v_item ->> 'formId',
        v_item ->> 'item_form_id',
        v_item ->> 'itemFormId'
      )), '')::uuid;

      v_quantity := coalesce(nullif(v_item ->> 'quantity', '')::integer, 1);
      if v_quantity < 1 or v_quantity > 100 then
        raise exception 'invalid reward config: item quantity out of range';
      end if;

      select *
        into v_template
      from catalog.collectible_templates
      where id = v_template_id
        and release_status in ('active', 'hidden');

      if not found then
        raise exception 'invalid reward config: item template not found';
      end if;

      if v_reward_type = 'DECORATION' and upper(v_template.type_code) <> 'DECORATION' then
        raise exception 'invalid reward config: decoration template type mismatch';
      end if;

      if v_form_id is not null then
        select cf.id, v_template.base_power + coalesce(cf.base_power_bonus, 0)
          into v_grant_form_id, v_power
        from catalog.collectible_forms cf
        where cf.id = v_form_id
          and cf.template_id = v_template_id;

        if not found then
          raise exception 'invalid reward config: item form not found';
        end if;
      else
        select cf.id, v_template.base_power + coalesce(cf.base_power_bonus, 0)
          into v_grant_form_id, v_power
        from catalog.collectible_forms cf
        where cf.template_id = v_template_id
        order by cf.is_default desc, cf.form_index asc, cf.id asc
        limit 1;

        if not found then
          v_grant_form_id := null;
          v_power := v_template.base_power;
        end if;
      end if;

      for v_quantity_index in 1..v_quantity
      loop
        v_item_idempotency_key :=
          p_idempotency_prefix
          || ':' || v_idx::text
          || ':item:' || v_quantity_index::text
          || ':' || v_template_id::text
          || coalesce(':' || v_grant_form_id::text, '');

        select *
          into v_existing_item
        from inventory.item_instances
        where owner_user_id = p_user_id
          and metadata ->> 'reward_idempotency_key' = v_item_idempotency_key
        for update;

        if found then
          v_results := v_results || jsonb_build_array(
            jsonb_build_object(
              'reward_type', v_reward_type,
              'item_instance_id', v_existing_item.id,
              'template_id', v_template_id,
              'form_id', v_existing_item.form_id,
              'quantity_index', v_quantity_index,
              'reward_index', v_idx,
              'idempotent', true
            )
          );
          continue;
        end if;

        insert into inventory.item_instances (
          owner_user_id,
          template_id,
          form_id,
          level,
          power,
          status,
          source_type,
          source_id,
          metadata
        )
        values (
          p_user_id,
          v_template_id,
          v_grant_form_id,
          1,
          coalesce(v_power, 0),
          'available',
          v_source_type,
          p_source_id,
          jsonb_build_object(
            'reward_source', 'reward_json',
            'reward_source_type', v_source_type,
            'reward_source_id', p_source_id,
            'reward_index', v_idx,
            'reward_quantity_index', v_quantity_index,
            'reward_idempotency_key', v_item_idempotency_key,
            'reward', v_item
          )
        )
        returning * into v_granted_item;

        insert into inventory.item_instance_events (
          item_instance_id,
          user_id,
          event_type,
          source_type,
          source_id,
          after_state,
          metadata
        )
        values (
          v_granted_item.id,
          p_user_id,
          'acquired',
          v_source_type,
          p_source_id,
          to_jsonb(v_granted_item),
          jsonb_build_object(
            'reward_source', 'reward_json',
            'reward_index', v_idx,
            'reward_quantity_index', v_quantity_index,
            'reward_idempotency_key', v_item_idempotency_key
          )
        );

        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'reward_type', v_reward_type,
            'item_instance_id', v_granted_item.id,
            'template_id', v_template_id,
            'form_id', v_grant_form_id,
            'quantity_index', v_quantity_index,
            'reward_index', v_idx,
            'idempotent', false
          )
        );
      end loop;

      continue;
    end if;

    raise exception 'invalid reward config: unsupported reward type';
  end loop;

  return v_results;
end;
$$;
