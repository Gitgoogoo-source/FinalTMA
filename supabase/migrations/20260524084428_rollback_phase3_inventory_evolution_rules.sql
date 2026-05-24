begin;

do $$
declare
  v_item_instances_using_generated_forms integer;
  v_attempts_using_generated_rules integer;
  v_attempts_result_using_generated_forms integer;
  v_media_using_generated_forms integer;
begin
  with generated_forms as (
    select id
    from catalog.collectible_forms
    where form_index in (2, 3)
      and metadata ->> 'guide_section' = '4.2_evolution_rules'
  ),
  generated_rules as (
    select id
    from inventory.evolution_rules
    where metadata ->> 'guide_section' = '4.2_evolution_rules'
  )
  select
    (select count(*) from inventory.item_instances ii join generated_forms gf on gf.id = ii.form_id),
    (select count(*) from inventory.evolution_attempts ea join generated_rules gr on gr.id = ea.rule_id),
    (select count(*) from inventory.evolution_attempts ea join generated_forms gf on gf.id = ea.result_item_instance_id),
    (select count(*) from catalog.collectible_media cm join generated_forms gf on gf.id = cm.form_id)
  into
    v_item_instances_using_generated_forms,
    v_attempts_using_generated_rules,
    v_attempts_result_using_generated_forms,
    v_media_using_generated_forms;

  if v_item_instances_using_generated_forms > 0
     or v_attempts_using_generated_rules > 0
     or v_attempts_result_using_generated_forms > 0
     or v_media_using_generated_forms > 0 then
    raise exception
      'cannot rollback phase 3 evolution rules because generated forms/rules are already referenced: item_instances=%, attempts_rules=%, attempts_results=%, media=%',
      v_item_instances_using_generated_forms,
      v_attempts_using_generated_rules,
      v_attempts_result_using_generated_forms,
      v_media_using_generated_forms;
  end if;
end $$;

delete from inventory.evolution_rules
where metadata ->> 'guide_section' = '4.2_evolution_rules';

with generated_forms as (
  select id
  from catalog.collectible_forms
  where form_index in (2, 3)
    and metadata ->> 'guide_section' = '4.2_evolution_rules'
)
update catalog.collectible_forms source_form
set next_form_id = null,
    updated_at = now(),
    metadata = source_form.metadata || jsonb_build_object(
      'rollback', 'phase3_inventory_evolution_rules',
      'rollback_reason', 'revert_4.2_evolution_rules'
    )
where source_form.next_form_id in (select id from generated_forms);

delete from catalog.collectible_forms
where form_index in (2, 3)
  and metadata ->> 'guide_section' = '4.2_evolution_rules';

commit;
