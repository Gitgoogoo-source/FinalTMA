-- Fourth stage 2.2: ensure task/reward anti-duplication constraints exist.
-- The other required constraints are already declared in the original schema.

do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'tasks'
      and rel.relname = 'referral_commissions'
      and con.conname = 'referral_commissions_referral_id_source_type_source_id_key'
      and con.contype = 'u'
  ) then
    alter table tasks.referral_commissions
      add constraint referral_commissions_referral_id_source_type_source_id_key
      unique (referral_id, source_type, source_id);
  end if;
end $$;

comment on constraint referral_commissions_referral_id_source_type_source_id_key
  on tasks.referral_commissions
  is 'Prevents duplicate referral commission records for the same referral and source event.';
