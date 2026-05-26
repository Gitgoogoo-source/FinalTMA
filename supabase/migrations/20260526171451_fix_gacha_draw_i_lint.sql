-- Fix plpgsql lint warnings left in the gacha paid-order helper.
-- The helper body is intentionally preserved; only the redundant outer
-- v_draw_i declaration is removed because integer FOR loops create their own
-- loop variable.

begin;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    E'\n  v_draw_i integer;\n',
    E'\n'
  );

  if v_updated_function_def = v_function_def then
    raise notice 'api.gacha_process_paid_order_without_task_progress has no redundant v_draw_i declaration';
  else
    execute v_updated_function_def;
  end if;

  if position(
    E'\n  v_draw_i integer;\n'
    in pg_get_functiondef(
      'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
    )
  ) > 0 then
    raise exception 'failed to remove redundant v_draw_i declaration from api.gacha_process_paid_order_without_task_progress';
  end if;
end;
$$;

revoke execute on function api.gacha_process_paid_order_without_task_progress(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

commit;
