-- Cover growth log foreign keys flagged by Supabase's unindexed FK advisor.
-- Existing user_id FKs are covered by (user_id, created_at desc) indexes.
-- evolution_consumed_items.attempt_id is covered by its primary key.

create index if not exists upgrade_logs_item_instance_id_idx
  on inventory.upgrade_logs (item_instance_id);

create index if not exists upgrade_logs_rule_id_idx
  on inventory.upgrade_logs (rule_id);

create index if not exists upgrade_logs_ledger_id_idx
  on inventory.upgrade_logs (ledger_id);

create index if not exists decompose_logs_item_instance_id_idx
  on inventory.decompose_logs (item_instance_id);

create index if not exists decompose_logs_rule_id_idx
  on inventory.decompose_logs (rule_id);

create index if not exists decompose_logs_ledger_id_idx
  on inventory.decompose_logs (ledger_id);

create index if not exists evolution_attempts_rule_id_idx
  on inventory.evolution_attempts (rule_id);

create index if not exists evolution_attempts_main_item_instance_id_idx
  on inventory.evolution_attempts (main_item_instance_id);

create index if not exists evolution_attempts_result_item_instance_id_idx
  on inventory.evolution_attempts (result_item_instance_id);

create index if not exists evolution_attempts_ledger_id_idx
  on inventory.evolution_attempts (ledger_id);

create index if not exists evolution_consumed_items_item_instance_id_idx
  on inventory.evolution_consumed_items (item_instance_id);
