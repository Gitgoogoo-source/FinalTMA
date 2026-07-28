create table battle.rulesets (
  id text primary key check (id ~ '^battle-v[1-9][0-9]*$'),
  checksum text not null unique check (checksum ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'retired')),
  parameters jsonb not null,
  source_version text not null check (source_version = 'v1'),
  activated_at timestamptz not null default now(),
  unique (id, checksum),
  check ((parameters->>'waiting_timeout_seconds')::integer = 1800),
  check ((parameters->>'heartbeat_interval_seconds')::integer = 5),
  check ((parameters->>'presence_online_window_seconds')::integer = 10),
  check ((parameters->>'offline_reconnect_seconds')::integer = 90),
  check ((parameters->>'lobby_timeout_seconds')::integer = 300),
  check ((parameters->>'lobby_countdown_seconds')::integer = 3),
  check ((parameters->>'action_timeout_seconds')::integer = 15),
  check ((parameters->>'forced_switch_timeout_seconds')::integer = 15),
  check ((parameters->>'reveal_seconds')::integer = 3),
  check ((parameters->>'max_normal_turns')::integer = 20),
  check (parameters->'outbox_retry_seconds' = '[1, 2, 5, 10, 30]'::jsonb)
);

create unique index battle_one_active_ruleset_idx on battle.rulesets ((status)) where status = 'active';

create table battle.entry_tiers (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^tier-[0-9]+$'),
  entry_fee bigint not null check (entry_fee in (20, 100, 500)),
  pool bigint not null,
  winner_payout bigint not null,
  fee bigint not null,
  primary key (ruleset_id, id),
  unique (ruleset_id, entry_fee),
  check (pool = entry_fee * 2),
  check (winner_payout = pool * 9 / 10),
  check (fee = pool - winner_payout)
);

create table battle.rarity_factors (
  ruleset_id text not null references battle.rulesets(id),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  factor_bps integer not null check (factor_bps > 0),
  target_budget integer not null check (target_budget > 0),
  primary key (ruleset_id, rarity),
  check (factor_bps = target_budget * 25)
);

create table battle.type_matchups (
  ruleset_id text not null references battle.rulesets(id),
  attacker text not null check (attacker in ('fire', 'grass', 'earth', 'lightning', 'water')),
  defender text not null check (defender in ('fire', 'grass', 'earth', 'lightning', 'water')),
  multiplier_bps integer not null check (multiplier_bps in (7500, 10000, 15000)),
  primary key (ruleset_id, attacker, defender)
);

create table battle.skill_slots (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^S(0[1-9]|10)$'),
  power integer not null check (power > 0),
  accuracy_bps integer not null check (accuracy_bps between 1 and 10000),
  priority smallint not null check (priority between -1 and 1),
  trajectory text not null check (btrim(trajectory) <> ''),
  primary key (ruleset_id, id)
);

create table battle.skills (
  ruleset_id text not null references battle.rulesets(id),
  id text not null,
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  slot_id text not null,
  name text not null,
  effect_key text not null,
  primary key (ruleset_id, id),
  unique (ruleset_id, name),
  unique (ruleset_id, effect_key),
  foreign key (ruleset_id, slot_id) references battle.skill_slots(ruleset_id, id),
  check (
    effect_key ~ '^(fire|grass|earth|lightning|water)-(0[1-9]|10)$'
    and effect_key = element || '-' || substr(slot_id, 2)
  )
);

create table battle.role_profiles (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^P(0[1-9]|1[0-4])$'),
  sort_order smallint not null check (sort_order between 1 and 14),
  name text not null,
  base_hp integer not null check (base_hp > 0),
  base_attack integer not null check (base_attack > 0),
  base_defense integer not null check (base_defense > 0),
  base_speed integer not null check (base_speed > 0),
  loadout_id text not null check (loadout_id ~ '^L(0[1-9]|1[0-4])$'),
  primary key (ruleset_id, id),
  unique (ruleset_id, sort_order),
  unique (ruleset_id, loadout_id),
  check (base_hp / 3 + base_attack + base_defense + base_speed = 400)
);

create table battle.profile_loadouts (
  ruleset_id text not null references battle.rulesets(id),
  loadout_id text not null check (loadout_id ~ '^L(0[1-9]|1[0-4])$'),
  position smallint not null check (position between 1 and 4),
  slot_id text not null,
  primary key (ruleset_id, loadout_id, position),
  unique (ruleset_id, loadout_id, slot_id),
  foreign key (ruleset_id, slot_id) references battle.skill_slots(ruleset_id, id)
);

create table battle.chain_configs (
  ruleset_id text not null references battle.rulesets(id),
  chain_id text not null references catalog.chains(id),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  profile_id text not null,
  primary key (ruleset_id, chain_id),
  foreign key (ruleset_id, profile_id) references battle.role_profiles(ruleset_id, id)
);

create table battle.template_configs (
  ruleset_id text not null references battle.rulesets(id),
  template_id text not null references catalog.templates(id),
  chain_id text not null references catalog.chains(id),
  stage smallint not null check (stage between 1 and 3),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  profile_id text not null,
  max_hp integer not null check (max_hp > 0),
  attack integer not null check (attack > 0),
  defense integer not null check (defense > 0),
  speed integer not null check (speed > 0),
  skill_1_id text not null,
  skill_2_id text not null,
  skill_3_id text not null,
  skill_4_id text not null,
  primary key (ruleset_id, template_id),
  foreign key (ruleset_id, chain_id) references battle.chain_configs(ruleset_id, chain_id),
  foreign key (ruleset_id, profile_id) references battle.role_profiles(ruleset_id, id),
  foreign key (ruleset_id, skill_1_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_2_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_3_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_4_id) references battle.skills(ruleset_id, id),
  check (cardinality(array[skill_1_id, skill_2_id, skill_3_id, skill_4_id]) = 4),
  check (
    skill_1_id <> skill_2_id and skill_1_id <> skill_3_id and skill_1_id <> skill_4_id
    and skill_2_id <> skill_3_id and skill_2_id <> skill_4_id and skill_3_id <> skill_4_id
  )
);

create index battle_template_configs_chain_idx on battle.template_configs (ruleset_id, chain_id, stage);

create table battle.rooms (
  id uuid primary key,
  creator_user_id uuid not null references identity.users(id),
  create_operation_id uuid not null unique references operations.operations(id),
  ruleset_id text not null,
  ruleset_checksum text not null,
  entry_tier_id text not null,
  invite_token_hash text not null unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in (
    'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown',
    'active_select', 'reveal', 'forced_switch',
    'finished', 'draw', 'cancelled', 'expired', 'voided'
  )),
  state_version bigint not null default 1 check (state_version > 0),
  current_turn_no smallint not null default 0 check (current_turn_no between 0 and 20),
  next_status text check (next_status in ('active_select', 'forced_switch')),
  private_seed bytea,
  seed_commitment text check (seed_commitment is null or seed_commitment ~ '^[0-9a-f]{64}$'),
  prepare_deadline timestamptz not null,
  waiting_started_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  lobby_expires_at timestamptz,
  lobby_start_deadline timestamptz,
  phase_deadline timestamptz,
  reveal_ends_at timestamptz,
  pending_result text check (pending_result in ('winner', 'draw')),
  pending_winner_participant_id uuid,
  pending_result_reason text,
  resolution_event jsonb,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ruleset_id, ruleset_checksum) references battle.rulesets(id, checksum),
  foreign key (ruleset_id, entry_tier_id) references battle.entry_tiers(ruleset_id, id),
  check (prepare_deadline = created_at + interval '60 seconds'),
  check (private_seed is null or octet_length(private_seed) = 32),
  check (
    (status = 'preparing_share' and waiting_started_at is null and expires_at is null)
    or status <> 'preparing_share'
  ),
  check (
    status <> 'waiting'
    or (waiting_started_at is not null and expires_at is not null)
  ),
  check (
    status not in ('lobby_waiting', 'lobby_countdown')
    or (
      accepted_at is not null
      and lobby_expires_at is not null
      and lobby_expires_at = accepted_at + interval '5 minutes'
      and current_turn_no = 0
      and private_seed is not null
      and seed_commitment is not null
    )
  ),
  check (
    (status = 'lobby_countdown') = (lobby_start_deadline is not null)
  ),
  check (
    status not in ('active_select', 'reveal', 'forced_switch', 'finished', 'draw')
    or (private_seed is not null and seed_commitment is not null and current_turn_no >= 1)
  ),
  check (
    (status in ('finished', 'draw', 'cancelled', 'expired', 'voided'))
    = (finished_at is not null)
  ),
  check (
    (pending_result is null and pending_winner_participant_id is null)
    or (pending_result = 'draw' and pending_winner_participant_id is null)
    or (pending_result = 'winner' and pending_winner_participant_id is not null)
  )
);

create index battle_rooms_prepare_due_idx on battle.rooms (prepare_deadline)
where status = 'preparing_share';
create index battle_rooms_waiting_due_idx on battle.rooms (expires_at)
where status = 'waiting';
create index battle_rooms_lobby_due_idx
on battle.rooms (lobby_expires_at, lobby_start_deadline)
where status in ('lobby_waiting', 'lobby_countdown');
create index battle_rooms_phase_due_idx on battle.rooms (phase_deadline)
where status in ('active_select', 'forced_switch');
create index battle_rooms_reveal_due_idx on battle.rooms (reveal_ends_at)
where status = 'reveal';

create table battle.prepared_shares (
  room_id uuid primary key references battle.rooms(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'failed')),
  prepared_message_id text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  telegram_expires_at timestamptz,
  last_error text,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    prepared_message_id is null
    or (
      prepared_message_id = btrim(prepared_message_id)
      and char_length(prepared_message_id) between 1 and 256
    )
  ),
  check ((status = 'active') = (prepared_message_id is not null and activated_at is not null))
);

create index battle_prepared_shares_due_idx on battle.prepared_shares (next_attempt_at)
where status = 'pending';

create table battle.participants (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  user_id uuid not null references identity.users(id),
  side text not null check (side in ('creator', 'opponent')),
  status text not null check (status in (
    'preparing_share', 'waiting', 'lobby', 'active', 'finished', 'draw',
    'cancelled', 'expired', 'voided'
  )),
  join_operation_id uuid not null unique references operations.operations(id),
  last_heartbeat_at timestamptz,
  offline_since timestamptz,
  presence_deadline timestamptz,
  result_acknowledged_at timestamptz,
  joined_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (room_id, side),
  unique (room_id, user_id),
  unique (room_id, id),
  check (
    (status in ('finished', 'draw', 'cancelled', 'expired', 'voided'))
    = (finished_at is not null)
  ),
  check (
    result_acknowledged_at is null
    or status in ('finished', 'draw', 'voided')
  ),
  check (
    (offline_since is null and presence_deadline is null)
    or (offline_since is not null and presence_deadline is not null)
  ),
  check (status <> 'lobby' or last_heartbeat_at is not null)
);

alter table battle.rooms
add constraint battle_rooms_pending_winner_participant_fkey
foreign key (id, pending_winner_participant_id)
references battle.participants(room_id, id);

create unique index battle_participants_one_active_per_user_idx
on battle.participants (user_id)
where status in ('preparing_share', 'waiting', 'lobby', 'active');

create index battle_participants_room_idx on battle.participants (room_id, side);
create index battle_participants_presence_due_idx
on battle.participants (presence_deadline, room_id)
where status = 'lobby' and presence_deadline is not null;
create index battle_participants_unconfirmed_result_idx on battle.participants (user_id, finished_at desc)
where status in ('finished', 'draw', 'voided') and result_acknowledged_at is null;

create table battle.team_members (
  id uuid primary key default extensions.gen_random_uuid(),
  participant_id uuid not null references battle.participants(id),
  slot smallint not null check (slot between 1 and 3),
  template_id text not null references catalog.templates(id),
  template_name text not null,
  image_thumbnail_path text not null,
  image_detail_path text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  stage smallint not null check (stage between 1 and 3),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  max_hp integer not null check (max_hp > 0),
  current_hp integer not null check (current_hp between 0 and max_hp),
  attack integer not null check (attack > 0),
  defense integer not null check (defense > 0),
  speed integer not null check (speed > 0),
  skill_1_id text not null,
  skill_2_id text not null,
  skill_3_id text not null,
  skill_4_id text not null,
  alive boolean not null default true,
  active boolean not null default false,
  unique (participant_id, slot),
  unique (participant_id, template_id),
  check (alive = (current_hp > 0)),
  check (not active or alive)
);

create unique index battle_team_members_one_active_idx on battle.team_members (participant_id)
where active;

create table battle.stakes (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  participant_id uuid not null unique,
  user_id uuid not null references identity.users(id),
  amount bigint not null check (amount in (20, 100, 500)),
  status text not null default 'locked' check (status in ('locked', 'refunded', 'settled')),
  lock_ledger_id bigint not null unique references economy.ledger(id),
  refund_ledger_id bigint unique references economy.ledger(id),
  payout_ledger_id bigint unique references economy.ledger(id),
  locked_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (room_id, user_id),
  foreign key (room_id, participant_id) references battle.participants(room_id, id),
  check (
    (status = 'locked' and settled_at is null and refund_ledger_id is null and payout_ledger_id is null)
    or (status = 'refunded' and settled_at is not null and refund_ledger_id is not null and payout_ledger_id is null)
    or (status = 'settled' and settled_at is not null and refund_ledger_id is null)
  )
);

create table battle.turns (
  room_id uuid not null references battle.rooms(id),
  turn_no smallint not null check (turn_no between 1 and 20),
  phase text not null check (phase in ('normal', 'forced_switch')),
  deadline timestamptz not null,
  start_snapshot_hash text not null check (start_snapshot_hash ~ '^[0-9a-f]{64}$'),
  resolution_hash text check (resolution_hash is null or resolution_hash ~ '^[0-9a-f]{64}$'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (room_id, turn_no, phase),
  check ((resolution_hash is null) = (resolved_at is null))
);

create table battle.actions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  turn_no smallint not null check (turn_no between 1 and 20),
  phase text not null check (phase in ('normal', 'forced_switch')),
  participant_id uuid not null,
  kind text not null check (kind in ('attack', 'switch', 'forced_switch')),
  source text not null check (source in ('player', 'timeout')),
  skill_position smallint check (skill_position between 1 and 4),
  skill_id text,
  target_slot smallint check (target_slot between 1 and 3),
  action_ordinal smallint not null default 1 check (action_ordinal = 1),
  operation_id uuid references operations.operations(id),
  locked_at timestamptz not null default now(),
  unique (room_id, turn_no, phase, participant_id),
  unique (operation_id),
  foreign key (room_id, turn_no, phase) references battle.turns(room_id, turn_no, phase),
  foreign key (room_id, participant_id) references battle.participants(room_id, id),
  check (
    (phase = 'normal' and kind = 'attack' and skill_position is not null and skill_id is not null and target_slot is null)
    or (phase = 'normal' and kind = 'switch' and skill_position is null and skill_id is null and target_slot is not null)
    or (phase = 'forced_switch' and kind = 'forced_switch' and skill_position is null and skill_id is null and target_slot is not null)
  )
);

create table battle.events (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  sequence bigint not null check (sequence > 0),
  state_version bigint not null check (state_version > 0),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  kind text not null,
  public_payload jsonb not null,
  private_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, sequence)
);

create table battle.audit_heads (
  room_id uuid primary key references battle.rooms(id),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_hash text not null default repeat('0', 64) check (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table battle.audit_entries (
  id bigint generated always as identity primary key,
  room_id uuid not null references battle.rooms(id),
  sequence bigint not null check (sequence > 0),
  kind text not null,
  payload jsonb not null,
  prior_hash text not null check (prior_hash ~ '^[0-9a-f]{64}$'),
  entry_hash text not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (room_id, sequence),
  unique (room_id, entry_hash)
);

create table battle.settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null unique references battle.rooms(id),
  result text not null check (result in ('winner', 'draw', 'void')),
  winner_participant_id uuid,
  pool bigint not null check (pool >= 0),
  winner_payout bigint not null check (winner_payout >= 0),
  fee bigint not null check (fee >= 0),
  ledger_ids jsonb not null,
  reason text not null,
  audit_hash text not null check (audit_hash ~ '^[0-9a-f]{64}$'),
  settled_at timestamptz not null default now(),
  foreign key (room_id, winner_participant_id)
    references battle.participants(room_id, id),
  check (
    (result = 'winner' and winner_participant_id is not null and winner_payout > 0 and fee > 0)
    or (result in ('draw', 'void') and winner_participant_id is null and winner_payout = 0 and fee = 0)
  )
);

create table battle.summaries (
  participant_id uuid primary key,
  room_id uuid not null references battle.rooms(id),
  user_id uuid not null references identity.users(id),
  opponent_display_name text not null,
  result text not null check (result in ('win', 'loss', 'draw', 'void')),
  entry_fee bigint not null,
  payout bigint not null check (payout >= 0),
  net_change bigint not null,
  fee bigint not null check (fee >= 0),
  reason text not null,
  finished_at timestamptz not null,
  unique (room_id, user_id),
  foreign key (room_id, participant_id) references battle.participants(room_id, id)
);

create table battle.outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null unique default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  state_version bigint not null check (state_version > 0),
  event_kind text not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'published')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, state_version, event_kind),
  check (
    (status = 'pending' and lease_owner is null and lease_expires_at is null and published_at is null)
    or (status = 'leased' and lease_owner is not null and lease_expires_at is not null and published_at is null)
    or (status = 'published' and published_at is not null
      and lease_owner is null and lease_expires_at is null)
  )
);

create index battle_outbox_due_idx on battle.outbox (next_attempt_at, created_at)
where status in ('pending', 'leased') and published_at is null;

create table battle.rate_limit_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references identity.users(id),
  action text not null check (action in (
    'create', 'invite_preview', 'accept', 'combat_action', 'heartbeat', 'realtime_token', 'share'
  )),
  invite_hash text,
  attempted_at timestamptz not null default now(),
  check (invite_hash is null or invite_hash ~ '^[0-9a-f]{64}$')
);

create index battle_rate_limit_user_action_time_idx
on battle.rate_limit_attempts (user_id, action, attempted_at desc);

create or replace function battle.reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'immutable Battle data cannot be changed';
end;
$$;

create or replace function battle.reject_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'permanent Battle data cannot be deleted';
end;
$$;

create trigger battle_rulesets_immutable before update or delete on battle.rulesets
for each row execute function battle.reject_mutation();
create trigger battle_entry_tiers_immutable before update or delete on battle.entry_tiers
for each row execute function battle.reject_mutation();
create trigger battle_rarity_factors_immutable before update or delete on battle.rarity_factors
for each row execute function battle.reject_mutation();
create trigger battle_type_matchups_immutable before update or delete on battle.type_matchups
for each row execute function battle.reject_mutation();
create trigger battle_skill_slots_immutable before update or delete on battle.skill_slots
for each row execute function battle.reject_mutation();
create trigger battle_skills_immutable before update or delete on battle.skills
for each row execute function battle.reject_mutation();
create trigger battle_role_profiles_immutable before update or delete on battle.role_profiles
for each row execute function battle.reject_mutation();
create trigger battle_profile_loadouts_immutable before update or delete on battle.profile_loadouts
for each row execute function battle.reject_mutation();
create trigger battle_chain_configs_immutable before update or delete on battle.chain_configs
for each row execute function battle.reject_mutation();
create trigger battle_template_configs_immutable before update or delete on battle.template_configs
for each row execute function battle.reject_mutation();
create trigger battle_events_immutable before update or delete on battle.events
for each row execute function battle.reject_mutation();
create trigger battle_audit_entries_immutable before update or delete on battle.audit_entries
for each row execute function battle.reject_mutation();
create trigger battle_settlements_immutable before update or delete on battle.settlements
for each row execute function battle.reject_mutation();
create trigger battle_summaries_immutable before update or delete on battle.summaries
for each row execute function battle.reject_mutation();
create trigger battle_rooms_no_delete before delete on battle.rooms
for each row execute function battle.reject_delete();
create trigger battle_participants_no_delete before delete on battle.participants
for each row execute function battle.reject_delete();
create trigger battle_team_members_no_delete before delete on battle.team_members
for each row execute function battle.reject_delete();
create trigger battle_stakes_no_delete before delete on battle.stakes
for each row execute function battle.reject_delete();
create trigger battle_turns_no_delete before delete on battle.turns
for each row execute function battle.reject_delete();
create trigger battle_actions_no_delete before delete on battle.actions
for each row execute function battle.reject_delete();
create trigger battle_audit_heads_no_delete before delete on battle.audit_heads
for each row execute function battle.reject_delete();

create or replace function battle.rules_complete(p_ruleset_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1 from battle.rulesets r
      where r.id = p_ruleset_id and r.status = 'active'
    )
    and (select count(*) = 3 from battle.entry_tiers where ruleset_id = p_ruleset_id)
    and (select count(*) = 5 from battle.rarity_factors where ruleset_id = p_ruleset_id)
    and (select count(*) = 25 from battle.type_matchups where ruleset_id = p_ruleset_id)
    and (select count(*) = 10 from battle.skill_slots where ruleset_id = p_ruleset_id)
    and (select count(*) = 50 from battle.skills where ruleset_id = p_ruleset_id)
    and (select count(*) = 14 from battle.role_profiles where ruleset_id = p_ruleset_id)
    and (select count(*) = 56 from battle.profile_loadouts where ruleset_id = p_ruleset_id)
    and (select count(*) = 70 from battle.chain_configs where ruleset_id = p_ruleset_id)
    and (select count(*) = 210 from battle.template_configs where ruleset_id = p_ruleset_id)
    and not exists (
      select 1
      from battle.template_configs bc
      join catalog.templates ct on ct.id = bc.template_id
      where bc.ruleset_id = p_ruleset_id
        and (
          bc.chain_id <> ct.chain_id
          or bc.stage <> ct.stage
          or bc.rarity <> ct.rarity
        )
    )
    and not exists (
      select 1
      from battle.role_profiles rp
      where rp.ruleset_id = p_ruleset_id
        and (
          select count(*) <> 4
          from battle.profile_loadouts pl
          where pl.ruleset_id = rp.ruleset_id and pl.loadout_id = rp.loadout_id
        )
    )
$$;

create or replace function battle.rule_int(p_ruleset_id text, p_key text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_value integer;
begin
  select (r.parameters->>p_key)::integer into v_value
  from battle.rulesets r
  where r.id = p_ruleset_id;
  if v_value is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'ruleset_parameter_missing',
        'ruleset_id', p_ruleset_id,
        'parameter', p_key
      )::text;
  end if;
  return v_value;
end;
$$;

create or replace function battle.retry_interval(p_room_id uuid, p_attempt integer)
returns interval
language plpgsql
stable
set search_path = ''
as $$
declare
  v_seconds integer;
begin
  select coalesce(
    (
      r.parameters->'outbox_retry_seconds'
        ->> (least(greatest(p_attempt, 1), 5) - 1)
    )::integer,
    30
  ) into v_seconds
  from battle.rooms room
  join battle.rulesets r on r.id = room.ruleset_id
  where room.id = p_room_id;
  if v_seconds is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT';
  end if;
  return make_interval(secs => v_seconds);
end;
$$;

create or replace function battle.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_invite_hash text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
  v_ruleset_id text;
  v_window integer;
  v_retention integer;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  v_window := battle.rule_int(v_ruleset_id, 'rate_limit_window_seconds');
  v_retention := battle.rule_int(v_ruleset_id, 'rate_limit_retention_seconds');
  v_limit := case p_action
    when 'create' then 3
    when 'invite_preview' then 60
    when 'accept' then 10
    when 'combat_action' then 30
    when 'heartbeat' then 30
    when 'realtime_token' then 10
    when 'share' then 10
    else null
  end;
  if v_limit is null or (p_invite_hash is not null and p_invite_hash !~ '^[0-9a-f]{64}$') then
    perform api.raise_business_error('REQUEST_INVALID', 'Battle 限流参数无效');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('battle-rate:' || p_user_id::text || ':' || p_action, 0)
  );
  delete from battle.rate_limit_attempts
  where attempted_at < now() - make_interval(secs => v_retention);
  select count(*) into v_count
  from battle.rate_limit_attempts
  where user_id = p_user_id
    and action = p_action
    and attempted_at >= now() - make_interval(secs => v_window);
  if v_count >= v_limit then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;
  insert into battle.rate_limit_attempts (user_id, action, invite_hash)
  values (p_user_id, p_action, p_invite_hash);
end;
$$;

create or replace function battle.append_audit(
  p_room_id uuid,
  p_kind text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head battle.audit_heads%rowtype;
  v_sequence bigint;
  v_hash text;
  v_created_at timestamptz := clock_timestamp();
begin
  insert into battle.audit_heads (room_id) values (p_room_id)
  on conflict (room_id) do nothing;
  select * into v_head from battle.audit_heads where room_id = p_room_id for update;
  v_sequence := v_head.last_sequence + 1;
  v_hash := encode(
    extensions.digest(
      convert_to(
        v_head.last_hash || jsonb_build_object(
          'room_id', p_room_id,
          'sequence', v_sequence,
          'kind', p_kind,
          'payload', coalesce(p_payload, '{}'::jsonb),
          'created_at', v_created_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  insert into battle.audit_entries (
    room_id, sequence, kind, payload, prior_hash, entry_hash, created_at
  ) values (
    p_room_id, v_sequence, p_kind, coalesce(p_payload, '{}'::jsonb),
    v_head.last_hash, v_hash, v_created_at
  );
  update battle.audit_heads
  set last_sequence = v_sequence, last_hash = v_hash, updated_at = v_created_at
  where room_id = p_room_id;
  return v_hash;
end;
$$;

create or replace function battle.wake_integration(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_kind not in ('outbox', 'share') then return null; end if;
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = case p_kind
    when 'outbox' then 'battle_outbox_callback_url'
    else 'battle_share_callback_url'
  end
  order by created_at desc
  limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'battle_outbox_secret'
  order by created_at desc
  limit 1;
  if v_url is null or v_url !~ '^https://'
     or v_secret is null or length(v_secret) < 32 then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('wake', true, 'kind', p_kind),
    timeout_milliseconds := 2000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function battle.record_event(
  p_room_id uuid,
  p_kind text,
  p_public_payload jsonb,
  p_audit_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state_version bigint;
  v_sequence bigint;
  v_state_hash text;
begin
  update battle.rooms
  set state_version = state_version + 1, updated_at = now()
  where id = p_room_id
  returning state_version into v_state_version;
  if v_state_version is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'room_missing', 'room_id', p_room_id)::text;
  end if;
  v_state_hash := battle.room_snapshot_hash(p_room_id);
  select coalesce(max(sequence), 0) + 1 into v_sequence
  from battle.events
  where room_id = p_room_id;
  insert into battle.events (
    room_id, sequence, state_version, state_hash, kind, public_payload, private_payload
  ) values (
    p_room_id, v_sequence, v_state_version, v_state_hash, p_kind,
    coalesce(p_public_payload, '{}'::jsonb),
    coalesce(p_audit_payload, '{}'::jsonb)
  );
  perform battle.append_audit(
    p_room_id, p_kind,
    coalesce(p_audit_payload, '{}'::jsonb)
      || jsonb_build_object('state_version', v_state_version, 'state_hash', v_state_hash)
  );
  insert into battle.outbox (room_id, state_version, event_kind)
  values (p_room_id, v_state_version, p_kind)
  on conflict (room_id, state_version, event_kind) do nothing;
  perform battle.wake_integration('outbox');
  return v_state_version;
end;
$$;

create or replace function battle.room_snapshot_hash(p_room_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'room_id', r.id,
          'status', r.status,
          'state_version', r.state_version,
          'current_turn_no', r.current_turn_no,
          'next_status', r.next_status,
          'seed_commitment', r.seed_commitment,
          'accepted_at', r.accepted_at,
          'lobby_expires_at', r.lobby_expires_at,
          'lobby_start_deadline', r.lobby_start_deadline,
          'phase_deadline', r.phase_deadline,
          'reveal_ends_at', r.reveal_ends_at,
          'pending_result', r.pending_result,
          'pending_winner_participant_id', r.pending_winner_participant_id,
          'presence', coalesce((
            select jsonb_agg(jsonb_build_object(
              'participant_id', p.id,
              'side', p.side,
              'offline_since', p.offline_since,
              'presence_deadline', p.presence_deadline
            ) order by p.side)
            from battle.participants p
            where p.room_id = r.id
          ), '[]'::jsonb),
          'teams', coalesce((
            select jsonb_agg(jsonb_build_object(
              'participant_id', tm.participant_id,
              'slot', tm.slot,
              'current_hp', tm.current_hp,
              'alive', tm.alive,
              'active', tm.active
            ) order by p.side, tm.slot)
            from battle.participants p
            join battle.team_members tm on tm.participant_id = p.id
            where p.room_id = r.id
          ), '[]'::jsonb),
          'actions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'turn_no', a.turn_no,
              'phase', a.phase,
              'participant_id', a.participant_id,
              'kind', a.kind,
              'source', a.source,
              'skill_id', a.skill_id,
              'target_slot', a.target_slot
            ) order by a.turn_no, a.phase, a.participant_id)
            from battle.actions a
            where a.room_id = r.id
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from battle.rooms r
  where r.id = p_room_id
$$;

create or replace function battle.skill_for_position(
  p_member battle.team_members,
  p_position integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_position
    when 1 then p_member.skill_1_id
    when 2 then p_member.skill_2_id
    when 3 then p_member.skill_3_id
    when 4 then p_member.skill_4_id
  end
$$;

create or replace function battle.hit_roll(
  p_private_seed bytea,
  p_room_id uuid,
  p_turn_no integer,
  p_actor_side text,
  p_action_ordinal integer,
  p_skill_id text,
  p_modulus integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  with digest_value as (
    select extensions.hmac(
      convert_to(
        p_room_id::text || '|' || p_turn_no::text || '|' || p_actor_side || '|'
        || p_action_ordinal::text || '|' || p_skill_id,
        'UTF8'
      ),
      p_private_seed,
      'sha256'
    ) value
  )
  select (
    (
      (get_byte(value, 0)::bigint << 24)
      + (get_byte(value, 1)::bigint << 16)
      + (get_byte(value, 2)::bigint << 8)
      + get_byte(value, 3)::bigint
    ) % p_modulus
  )::integer
  from digest_value
$$;

create or replace function battle.attack_result(
  p_room battle.rooms,
  p_turn_no integer,
  p_side text,
  p_action battle.actions,
  p_attacker battle.team_members,
  p_defender battle.team_members
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slot battle.skill_slots%rowtype;
  v_skill battle.skills%rowtype;
  v_multiplier integer;
  v_roll integer;
  v_raw bigint;
  v_cap bigint;
  v_damage bigint;
  v_applied bigint;
begin
  select s.* into v_skill
  from battle.skills s
  where s.ruleset_id = p_room.ruleset_id and s.id = p_action.skill_id;
  select ss.* into v_slot
  from battle.skill_slots ss
  where ss.ruleset_id = p_room.ruleset_id and ss.id = v_skill.slot_id;
  select multiplier_bps into v_multiplier
  from battle.type_matchups
  where ruleset_id = p_room.ruleset_id
    and attacker = p_attacker.element
    and defender = p_defender.element;
  if v_slot.id is null or v_multiplier is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'attack_config_missing', 'action_id', p_action.id)::text;
  end if;
  v_roll := battle.hit_roll(
    p_room.private_seed, p_room.id, p_turn_no, p_side,
    p_action.action_ordinal, p_action.skill_id,
    battle.rule_int(p_room.ruleset_id, 'random_modulus')
  );
  if v_roll < v_slot.accuracy_bps then
    v_raw := (
      2::bigint * v_slot.power::bigint * p_attacker.attack::bigint
      * p_attacker.attack::bigint * v_multiplier::bigint
    ) / (
      (p_attacker.attack::bigint + p_defender.defense::bigint) * 100::bigint * 10000::bigint
    );
    v_cap := greatest(
      1,
      p_defender.max_hp::bigint
        * battle.rule_int(p_room.ruleset_id, 'single_hit_cap_bps')
        / 10000
    );
    v_damage := least(v_cap, greatest(1, v_raw));
    v_applied := least(p_defender.current_hp::bigint, v_damage);
  else
    v_raw := 0;
    v_cap := greatest(
      1,
      p_defender.max_hp::bigint
        * battle.rule_int(p_room.ruleset_id, 'single_hit_cap_bps')
        / 10000
    );
    v_damage := 0;
    v_applied := 0;
  end if;
  return jsonb_build_object(
    'actor_side', p_side,
    'attacker_member_id', p_attacker.id,
    'defender_member_id', p_defender.id,
    'skill_id', v_skill.id,
    'skill_name', v_skill.name,
    'effect_key', v_skill.effect_key,
    'priority', v_slot.priority,
    'accuracy_bps', v_slot.accuracy_bps,
    'roll', v_roll,
    'hit', v_roll < v_slot.accuracy_bps,
    'multiplier_bps', v_multiplier,
    'raw_damage', v_raw,
    'damage', v_damage,
    'applied_damage', v_applied,
    'defender_current_hp', p_defender.current_hp
  );
end;
$$;

create or replace function battle.rarity_summary(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rarity', rarity,
    'count', quantity
  ) order by rarity_order), '[]'::jsonb)
  from (
    select
      tm.rarity,
      count(*)::integer quantity,
      catalog.rarity_rank(tm.rarity) rarity_order
    from battle.participants p
    join battle.team_members tm on tm.participant_id = p.id
    where p.room_id = p_room_id and p.side = 'creator'
    group by tm.rarity
  ) values_by_rarity
$$;

create or replace function battle.challenge_card_json(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'creator_display_name', btrim(concat_ws(' ', u.first_name, u.last_name)),
    'creator_avatar_url', u.photo_url,
    'entry_fee', tier.entry_fee,
    'rarity_summary', battle.rarity_summary(r.id),
    'expires_at', r.expires_at,
    'server_time', now(),
    'creator_online', r.status = 'waiting'
      and p.offline_since is null
      and p.last_heartbeat_at > now() - make_interval(
        secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
      )
  )
  from battle.rooms r
  join identity.users u on u.id = r.creator_user_id
  join battle.participants p on p.room_id = r.id and p.side = 'creator'
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id
  where r.id = p_room_id
$$;

create or replace function battle.lobby_json(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when r.status not in ('lobby_waiting', 'lobby_countdown') then null
    else jsonb_build_object(
      'phase', r.status,
      'expires_at', r.lobby_expires_at,
      'start_deadline', r.lobby_start_deadline,
      'presence', jsonb_build_object(
        'creator', jsonb_build_object(
          'online',
            creator.offline_since is null
            and creator.last_heartbeat_at > now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ),
          'reconnect_deadline', case
            when creator.offline_since is not null then creator.presence_deadline
            when creator.last_heartbeat_at <= now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ) then creator.last_heartbeat_at + make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
                    + battle.rule_int(r.ruleset_id, 'offline_reconnect_seconds')
            )
            else null
          end
        ),
        'opponent', jsonb_build_object(
          'online',
            opponent.offline_since is null
            and opponent.last_heartbeat_at > now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ),
          'reconnect_deadline', case
            when opponent.offline_since is not null then opponent.presence_deadline
            when opponent.last_heartbeat_at <= now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ) then opponent.last_heartbeat_at + make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
                    + battle.rule_int(r.ruleset_id, 'offline_reconnect_seconds')
            )
            else null
          end
        )
      )
    )
  end
  from battle.rooms r
  join battle.participants creator
    on creator.room_id = r.id and creator.side = 'creator'
  join battle.participants opponent
    on opponent.room_id = r.id and opponent.side = 'opponent'
  where r.id = p_room_id
$$;

create or replace function battle.skill_json(
  p_ruleset_id text,
  p_skill_id text,
  p_position integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'position', p_position,
    'skill_id', s.id,
    'name', s.name,
    'power', ss.power,
    'accuracy_bps', ss.accuracy_bps,
    'priority', ss.priority,
    'effect_key', s.effect_key
  )
  from battle.skills s
  join battle.skill_slots ss
    on ss.ruleset_id = s.ruleset_id and ss.id = s.slot_id
  where s.ruleset_id = p_ruleset_id and s.id = p_skill_id
$$;

create or replace function battle.self_team_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'template_id', tm.template_id,
    'name', tm.template_name,
    'image_thumbnail_path', tm.image_thumbnail_path,
    'image_detail_path', tm.image_detail_path,
    'rarity', tm.rarity,
    'stage', tm.stage,
    'element', tm.element,
    'current_hp', tm.current_hp,
    'max_hp', tm.max_hp,
    'attack', tm.attack,
    'defense', tm.defense,
    'speed', tm.speed,
    'alive', tm.alive,
    'active', tm.active,
    'skills', jsonb_build_array(
      battle.skill_json(r.ruleset_id, tm.skill_1_id, 1),
      battle.skill_json(r.ruleset_id, tm.skill_2_id, 2),
      battle.skill_json(r.ruleset_id, tm.skill_3_id, 3),
      battle.skill_json(r.ruleset_id, tm.skill_4_id, 4)
    )
  ) order by tm.slot), '[]'::jsonb)
  from battle.team_members tm
  join battle.participants p on p.id = tm.participant_id
  join battle.rooms r on r.id = p.room_id
  where p.room_id = p_room_id and p.id = p_participant_id
$$;

create or replace function battle.opponent_team_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'name', tm.template_name,
    'image_thumbnail_path', tm.image_thumbnail_path,
    'image_detail_path', tm.image_detail_path,
    'rarity', tm.rarity,
    'stage', tm.stage,
    'hp_percent', round(tm.current_hp::numeric * 100 / tm.max_hp::numeric, 2),
    'alive', tm.alive,
    'active', tm.active
  ) order by tm.slot), '[]'::jsonb)
  from battle.team_members tm
  join battle.participants p on p.id = tm.participant_id
  where p.room_id = p_room_id and p.id <> p_participant_id
$$;

create or replace function battle.resolution_event_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_self_side text;
  v_actions jsonb;
  v_self_hp jsonb;
  v_opponent_hp jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.status <> 'reveal' or v_room.resolution_event is null then return null; end if;
  select side into v_self_side
  from battle.participants
  where id = p_participant_id and room_id = p_room_id;
  select coalesce(jsonb_agg(
    case
      when action->>'kind' = 'attack'
           and action->>'actor_side' = v_self_side
      then jsonb_build_object(
        'actor', 'self',
        'kind', 'attack',
        'skill_name', action->>'skill_name',
        'effect_key', action->>'effect_key',
        'hit', (action->>'hit')::boolean,
        'effectiveness', case (action->>'multiplier_bps')::integer
          when 15000 then 'super_effective'
          when 7500 then 'not_effective'
          else 'normal'
        end,
        'target_hp_percent_before', round(
          (
            target.current_hp + (action->>'applied_damage')::integer
          )::numeric * 100 / target.max_hp::numeric,
          2
        ),
        'target_hp_percent_after', round(
          target.current_hp::numeric * 100 / target.max_hp::numeric,
          2
        ),
        'knockout', (action->>'knockout')::boolean
      )
      when action->>'kind' = 'attack'
      then jsonb_build_object(
        'actor', 'opponent',
        'kind', 'attack',
        'skill_name', action->>'skill_name',
        'effect_key', action->>'effect_key',
        'hit', (action->>'hit')::boolean,
        'effectiveness', case (action->>'multiplier_bps')::integer
          when 15000 then 'super_effective'
          when 7500 then 'not_effective'
          else 'normal'
        end,
        'target_current_hp_before',
          target.current_hp + (action->>'applied_damage')::integer,
        'target_current_hp_after', target.current_hp,
        'knockout', (action->>'knockout')::boolean
      )
      else jsonb_build_object(
        'actor', case
          when action->>'actor_side' = v_self_side then 'self'
          else 'opponent'
        end,
        'kind', action->>'kind',
        'switch_to', action->'switch_to'
      )
    end
    order by action_ordinal
  ), '[]'::jsonb) into v_actions
  from jsonb_array_elements(v_room.resolution_event->'actions')
    with ordinality as resolution_actions(action, action_ordinal)
  left join battle.team_members target
    on target.id = (action->>'defender_member_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'current_hp', tm.current_hp,
    'max_hp', tm.max_hp,
    'alive', tm.alive
  ) order by tm.slot), '[]'::jsonb) into v_self_hp
  from battle.team_members tm
  where tm.participant_id = p_participant_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'hp_percent', round(tm.current_hp::numeric * 100 / tm.max_hp::numeric, 2),
    'alive', tm.alive
  ) order by tm.slot), '[]'::jsonb) into v_opponent_hp
  from battle.team_members tm
  join battle.participants p on p.id = tm.participant_id
  where p.room_id = p_room_id and p.id <> p_participant_id;
  return jsonb_build_object(
    'event_id', v_room.resolution_event->'event_id',
    'state_version', v_room.state_version,
    'turn_no', v_room.current_turn_no,
    'actions', v_actions,
    'self_hp', v_self_hp,
    'opponent_hp', v_opponent_hp,
    'reveal_ends_at', v_room.reveal_ends_at
  );
end;
$$;

create or replace function battle.participation_json(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room_id', p.room_id,
    'participant_id', p.id,
    'side', p.side,
    'status', r.status,
    'state_version', r.state_version,
    'entry_fee', tier.entry_fee,
    'expires_at', coalesce(r.lobby_expires_at, r.expires_at),
    'phase_deadline', r.phase_deadline,
    'reveal_ends_at', r.reveal_ends_at
  )
  from battle.participants p
  join battle.rooms r on r.id = p.room_id
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id
  where p.user_id = p_user_id
    and p.status in ('preparing_share', 'waiting', 'lobby', 'active')
  order by p.joined_at desc
  limit 1
$$;

create or replace function battle.current_result_json(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room_id', s.room_id,
    'result', s.result,
    'opponent_display_name', s.opponent_display_name,
    'entry_fee', s.entry_fee,
    'payout', s.payout,
    'net_change', s.net_change,
    'fee', s.fee,
    'reason', s.reason,
    'finished_at', s.finished_at
  )
  from battle.summaries s
  join battle.participants p on p.id = s.participant_id
  where s.user_id = p_user_id and p.result_acknowledged_at is null
  order by s.finished_at desc
  limit 1
$$;

create or replace function battle.viewer_action_state(
  p_room_id uuid,
  p_participant_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.status = 'active'
      and r.status = 'active_select'
      and exists (
        select 1
        from battle.actions a
        where a.room_id = r.id
          and a.turn_no = r.current_turn_no
          and a.phase = 'normal'
          and a.participant_id = p.id
      )
    then 'locked'
    when p.status = 'active'
      and r.status = 'active_select'
      and r.phase_deadline > now()
      and exists (
        select 1
        from battle.team_members tm
        where tm.participant_id = p.id and tm.active
      )
    then 'available'
    when p.status = 'active'
      and r.status = 'forced_switch'
      and exists (
        select 1
        from battle.team_members tm
        where tm.participant_id = p.id and tm.active
      )
    then 'not_applicable'
    when p.status = 'active'
      and r.status = 'forced_switch'
      and exists (
        select 1
        from battle.actions a
        where a.room_id = r.id
          and a.turn_no = r.current_turn_no
          and a.phase = 'forced_switch'
          and a.participant_id = p.id
      )
    then 'locked'
    when p.status = 'active'
      and r.status = 'forced_switch'
      and r.phase_deadline > now()
      and exists (
        select 1
        from battle.team_members tm
        where tm.participant_id = p.id and tm.alive and not tm.active
      )
    then 'available'
    else 'not_applicable'
  end
  from battle.rooms r
  join battle.participants p
    on p.room_id = r.id and p.id = p_participant_id
  where r.id = p_room_id
$$;

create or replace function battle.room_snapshot_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_side text;
  v_opponent_id uuid;
begin
  select * into v_room from battle.rooms where id = p_room_id;
  select side into v_side
  from battle.participants
  where id = p_participant_id and room_id = p_room_id;
  if v_side is null then return null; end if;
  select id into v_opponent_id
  from battle.participants
  where room_id = p_room_id and id <> p_participant_id;
  return jsonb_build_object(
    'room_id', v_room.id,
    'status', v_room.status,
    'state_version', v_room.state_version,
    'side', v_side,
    'turn_no', v_room.current_turn_no,
    'phase_deadline', v_room.phase_deadline,
    'reveal_ends_at', v_room.reveal_ends_at,
    'prepare_deadline', case
      when v_side = 'creator' and v_room.status = 'preparing_share'
      then v_room.prepare_deadline
      else null
    end,
    'prepared_message_id', case
      when v_side = 'creator' and v_room.status = 'waiting'
      then (
        select ps.prepared_message_id
        from battle.prepared_shares ps
        where ps.room_id = v_room.id and ps.status = 'active'
      )
      else null
    end,
    'viewer_action_state',
      battle.viewer_action_state(p_room_id, p_participant_id),
    'server_time', now(),
    'lobby', battle.lobby_json(p_room_id),
    'self_team', battle.self_team_json(p_room_id, p_participant_id),
    'opponent_team', case
      when v_opponent_id is null
        or v_room.status in ('lobby_waiting', 'lobby_countdown')
      then '[]'::jsonb
      else battle.opponent_team_json(p_room_id, p_participant_id)
    end,
    'resolution_event', battle.resolution_event_json(p_room_id, p_participant_id)
  );
end;
$$;

create or replace function api.battle_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_participation jsonb := battle.participation_json(v_user_id);
  v_ruleset_id text;
begin
  select id into v_ruleset_id
  from battle.rulesets
  where status = 'active' and battle.rules_complete(id);
  if v_ruleset_id is null then
    perform api.raise_business_error(
      'BATTLE_RULESET_UNAVAILABLE',
      'Battle 规则暂不可用，请稍后重试'
    );
  end if;
  return jsonb_build_object(
    'ruleset', (
      select jsonb_build_object(
        'id', r.id,
        'checksum', r.checksum,
        'heartbeat_interval_seconds', (r.parameters->>'heartbeat_interval_seconds')::integer,
        'presence_online_window_seconds', (r.parameters->>'presence_online_window_seconds')::integer,
        'offline_reconnect_seconds', (r.parameters->>'offline_reconnect_seconds')::integer,
        'lobby_timeout_seconds', (r.parameters->>'lobby_timeout_seconds')::integer,
        'lobby_countdown_seconds', (r.parameters->>'lobby_countdown_seconds')::integer,
        'action_timeout_seconds', (r.parameters->>'action_timeout_seconds')::integer,
        'forced_switch_timeout_seconds', (r.parameters->>'forced_switch_timeout_seconds')::integer,
        'reveal_seconds', (r.parameters->>'reveal_seconds')::integer,
        'max_normal_turns', (r.parameters->>'max_normal_turns')::integer
      )
      from battle.rulesets r where r.id = v_ruleset_id
    ),
    'entry_tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'entry_fee', t.entry_fee,
        'pool', t.pool,
        'winner_payout', t.winner_payout,
        'fee', t.fee
      ) order by t.entry_fee)
      from battle.entry_tiers t
      where t.ruleset_id = v_ruleset_id
    ), '[]'::jsonb),
    'participation', v_participation,
    'current_result', battle.current_result_json(v_user_id),
    'room', case
      when v_participation is null then null
      else battle.room_snapshot_json(
        (v_participation->>'room_id')::uuid,
        (v_participation->>'participant_id')::uuid
      )
    end,
    'server_time', now()
  );
end;
$$;

create or replace function api.battle_team_options(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_ruleset_id text;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  if v_ruleset_id is null or not battle.rules_complete(v_ruleset_id) then
    perform api.raise_business_error('BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试');
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'image_thumbnail_path', t.image_thumbnail_path,
        'image_detail_path', t.image_detail_path,
        'rarity', t.rarity,
        'stage', t.stage,
        'available_quantity', inventory.available_quantity(v_user_id, t.id),
        'element', bc.element,
        'max_hp', bc.max_hp,
        'attack', bc.attack,
        'defense', bc.defense,
        'speed', bc.speed,
        'skills', jsonb_build_array(
          battle.skill_json(v_ruleset_id, bc.skill_1_id, 1),
          battle.skill_json(v_ruleset_id, bc.skill_2_id, 2),
          battle.skill_json(v_ruleset_id, bc.skill_3_id, 3),
          battle.skill_json(v_ruleset_id, bc.skill_4_id, 4)
        )
      ) order by t.sort_order)
      from inventory.holdings h
      join catalog.templates t on t.id = h.template_id
      join battle.template_configs bc
        on bc.ruleset_id = v_ruleset_id and bc.template_id = t.id
      where h.user_id = v_user_id
        and inventory.available_quantity(v_user_id, t.id) > 0
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.battle_current_invite(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_session identity.sessions%rowtype;
  v_room battle.rooms%rowtype;
  v_card jsonb;
begin
  select * into v_session from identity.sessions where id = p_session_id;
  if v_session.entry_kind <> 'battle' then
    return jsonb_build_object('invite_status', 'none', 'server_time', now());
  end if;
  perform battle.consume_rate_limit(v_user_id, 'invite_preview', v_session.battle_invite_token_hash);
  select * into v_room
  from battle.rooms
  where invite_token_hash = v_session.battle_invite_token_hash;
  if v_room.id is null then
    return jsonb_build_object('invite_status', 'invalid', 'server_time', now());
  end if;
  v_card := battle.challenge_card_json(v_room.id);
  return jsonb_build_object(
    'room_id', v_room.id,
    'invite_status', case
      when v_room.status = 'waiting' and v_room.expires_at <= now() then 'expired'
      when v_room.status = 'waiting' and v_room.creator_user_id = v_user_id then 'self'
      when v_room.status = 'waiting' then 'available'
      when v_room.status in ('cancelled', 'expired', 'voided') then v_room.status
      else 'accepted'
    end,
    'remaining_seconds', greatest(
      0, floor(extract(epoch from (v_room.expires_at - now())))::integer
    )
  ) || v_card;
end;
$$;

create or replace function api.battle_room(
  p_session_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_participant_id uuid;
  v_result jsonb;
begin
  select id into v_participant_id
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id;
  if v_participant_id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  v_result := battle.room_snapshot_json(p_room_id, v_participant_id);
  if v_result is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.battle_realtime_context(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_session identity.sessions%rowtype;
  v_participation jsonb;
  v_invite_hash text;
begin
  perform battle.consume_rate_limit(v_user_id, 'realtime_token');
  select * into v_session from identity.sessions where id = p_session_id;
  v_participation := battle.participation_json(v_user_id);
  select r.invite_token_hash into v_invite_hash
  from battle.rooms r
  where v_session.entry_kind = 'battle'
    and v_session.battle_invite_token_hash is not null
    and r.invite_token_hash = v_session.battle_invite_token_hash
    and r.status = 'waiting'
    and r.expires_at > now();
  return jsonb_build_object(
    'user_id', v_user_id,
    'user_channel', 'battle:user:' || v_user_id::text,
    'room_channel', case when v_participation is null then null else
      'battle:room:' || (v_participation->>'room_id') end,
    'invite_channel', case
      when v_invite_hash is not null
      then 'battle:invite:' || v_invite_hash
      else null
    end
  );
end;
$$;

create or replace function battle.validate_team_selection(
  p_user_id uuid,
  p_ruleset_id text,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct integer;
  v_total integer;
begin
  if p_template_ids is null or jsonb_typeof(p_template_ids) <> 'array' then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if jsonb_array_length(p_template_ids) <> 3
     or exists (
       select 1
       from jsonb_array_elements(p_template_ids) item
       where jsonb_typeof(item) <> 'string'
     ) then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  select count(distinct value), count(*) into v_distinct, v_total
  from jsonb_array_elements_text(p_template_ids);
  if v_total <> 3 then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if v_distinct <> 3 then
    perform api.raise_business_error(
      'BATTLE_TEAM_TEMPLATE_DUPLICATE',
      'Battle 队伍中的藏品模板不能重复'
    );
  end if;
  if (
    select count(*) <> 3
    from jsonb_array_elements_text(p_template_ids) selected(template_id)
    join catalog.templates template on template.id = selected.template_id
    join battle.template_configs config
      on config.ruleset_id = p_ruleset_id
     and config.template_id = selected.template_id
  ) then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_template_ids) selected(template_id)
    where inventory.available_quantity(p_user_id, selected.template_id) < 1
  ) then
    perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品数量不足');
  end if;
  return p_template_ids;
end;
$$;

create or replace function battle.create_team(
  p_participant_id uuid,
  p_user_id uuid,
  p_ruleset_id text,
  p_template_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_template catalog.templates%rowtype;
  v_config battle.template_configs%rowtype;
begin
  perform battle.validate_team_selection(
    p_user_id, p_ruleset_id, p_template_ids
  );
  perform 1
  from inventory.holdings h
  join (
    select value template_id
    from jsonb_array_elements_text(p_template_ids)
  ) selected on selected.template_id = h.template_id
  where h.user_id = p_user_id
  order by h.template_id
  for update of h;
  for v_item in
    select value template_id, ordinality::smallint slot
    from jsonb_array_elements_text(p_template_ids) with ordinality
    order by ordinality
  loop
    select * into v_template from catalog.templates where id = v_item.template_id;
    select * into v_config
    from battle.template_configs
    where ruleset_id = p_ruleset_id and template_id = v_item.template_id;
    if v_template.id is null or v_config.template_id is null then
      perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
    end if;
    if inventory.available_quantity(p_user_id, v_item.template_id) < 1 then
      perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品数量不足');
    end if;
    insert into battle.team_members (
      participant_id, slot, template_id, template_name,
      image_thumbnail_path, image_detail_path, rarity, stage, element,
      max_hp, current_hp, attack, defense, speed,
      skill_1_id, skill_2_id, skill_3_id, skill_4_id, alive, active
    ) values (
      p_participant_id, v_item.slot, v_template.id, v_template.name,
      v_template.image_thumbnail_path, v_template.image_detail_path,
      v_template.rarity, v_template.stage, v_config.element,
      v_config.max_hp, v_config.max_hp, v_config.attack, v_config.defense, v_config.speed,
      v_config.skill_1_id, v_config.skill_2_id, v_config.skill_3_id, v_config.skill_4_id,
      true, v_item.slot = 1
    );
    perform inventory.reserve(
      p_user_id, v_item.template_id, 1, 'battle', p_participant_id
    );
  end loop;
end;
$$;

create or replace function battle.refund_locked_stakes(
  p_room_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stake battle.stakes%rowtype;
  v_balance jsonb;
  v_ledger_ids jsonb := '[]'::jsonb;
begin
  perform 1
  from economy.balances b
  join battle.stakes s
    on s.user_id = b.user_id and s.room_id = p_room_id and s.status = 'locked'
  where b.currency = 'KCOIN'
  order by b.user_id
  for update of b;
  for v_stake in
    select * from battle.stakes
    where room_id = p_room_id and status = 'locked'
    order by user_id
    for update
  loop
    v_balance := economy.refund_battle_kcoin(
      v_stake.user_id,
      v_stake.amount,
      (
        select join_operation_id
        from battle.participants
        where id = v_stake.participant_id
      ),
      p_room_id::text || ':' || v_stake.user_id::text || ':' || p_reason
    );
    update battle.stakes
    set status = 'refunded',
        refund_ledger_id = (v_balance->>'ledger_id')::bigint,
        settled_at = now()
    where id = v_stake.id;
    v_ledger_ids := v_ledger_ids || jsonb_build_array((v_balance->>'ledger_id')::bigint);
  end loop;
  return v_ledger_ids;
end;
$$;

create or replace function battle.release_reservations(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update inventory.reservations r
  set status = 'released', released_at = now()
  where r.kind = 'battle'
    and r.status = 'active'
    and exists (
      select 1
      from battle.participants p
      where p.room_id = p_room_id and p.id = r.reference_id
    )
$$;

create or replace function battle.close_unstarted_room(
  p_room_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_ledgers jsonb;
begin
  if p_status not in ('cancelled', 'expired', 'voided') then
    raise exception 'invalid unstarted Battle terminal status';
  end if;
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status in ('cancelled', 'expired', 'voided') then
    return jsonb_build_object('room_id', v_room.id, 'status', v_room.status);
  end if;
  if v_room.status not in (
    'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown'
  ) then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  v_ledgers := battle.refund_locked_stakes(p_room_id, p_reason);
  perform battle.release_reservations(p_room_id);
  update battle.participants
  set status = p_status, finished_at = now()
  where room_id = p_room_id
    and status in ('preparing_share', 'waiting', 'lobby');
  update battle.rooms
  set status = p_status, finished_at = now(), phase_deadline = null,
      reveal_ends_at = null, lobby_start_deadline = null, updated_at = now()
  where id = p_room_id;
  perform battle.record_event(
    p_room_id,
    p_status,
    jsonb_build_object('reason', p_reason),
    jsonb_build_object('reason', p_reason, 'refund_ledger_ids', v_ledgers)
  );
  return jsonb_build_object('room_id', p_room_id, 'status', p_status, 'reason', p_reason);
end;
$$;

create or replace function battle.lobby_terminal_reason(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.lobby_expires_at <= now() then 'lobby_expired'
    when exists (
      select 1
      from battle.participants p
      join identity.users u on u.id = p.user_id
      where p.room_id = r.id and p.status = 'lobby' and u.status = 'banned'
    ) then 'lobby_participant_banned'
    when exists (
      select 1
      from battle.participants p
      where p.room_id = r.id
        and p.status = 'lobby'
        and p.presence_deadline <= now()
    ) then 'lobby_presence_timeout'
    else null
  end
  from battle.rooms r
  where r.id = p_room_id
    and r.status in ('lobby_waiting', 'lobby_countdown')
$$;

create or replace function battle.reconcile_lobby_presence(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_offline_since timestamptz;
  v_both_online boolean;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  for v_participant in
    select *
    from battle.participants
    where room_id = p_room_id
      and status = 'lobby'
      and offline_since is null
      and last_heartbeat_at <= now() - make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
      )
    order by side
    for update
  loop
    v_offline_since := v_participant.last_heartbeat_at + make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
    );
    update battle.participants
    set offline_since = v_offline_since,
        presence_deadline = v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
    where id = v_participant.id;
    perform battle.record_event(
      p_room_id,
      'participant_offline',
      jsonb_build_object(
        'side', v_participant.side,
        'reconnect_deadline', v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
      ),
      jsonb_build_object(
        'participant_id', v_participant.id,
        'offline_since', v_offline_since
      )
    );
  end loop;

  select count(*) = 2
    and bool_and(
      p.offline_since is null
      and p.last_heartbeat_at > now() - make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
      )
    )
  into v_both_online
  from battle.participants p
  where p.room_id = p_room_id and p.status = 'lobby';

  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.status = 'lobby_countdown' and not v_both_online then
    update battle.rooms
    set status = 'lobby_waiting', lobby_start_deadline = null, updated_at = now()
    where id = p_room_id;
    perform battle.record_event(
      p_room_id,
      'lobby_countdown_stopped',
      jsonb_build_object('reason', 'participant_offline'),
      '{}'::jsonb
    );
  elsif v_room.status = 'lobby_waiting'
    and v_both_online
    and battle.lobby_terminal_reason(p_room_id) is null
  then
    update battle.rooms
    set status = 'lobby_countdown',
        lobby_start_deadline = now() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'lobby_countdown_seconds')
        ),
        updated_at = now()
    where id = p_room_id
    returning * into v_room;
    perform battle.record_event(
      p_room_id,
      'lobby_countdown_started',
      jsonb_build_object('start_deadline', v_room.lobby_start_deadline),
      '{}'::jsonb
    );
  end if;
end;
$$;

create or replace function battle.advance_lobby(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_reason text;
  v_online_count integer;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  v_reason := battle.lobby_terminal_reason(p_room_id);
  if v_reason is not null then
    perform battle.close_unstarted_room(p_room_id, 'cancelled', v_reason);
    return;
  end if;

  perform battle.reconcile_lobby_presence(p_room_id);
  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  v_reason := battle.lobby_terminal_reason(p_room_id);
  if v_reason is not null then
    perform battle.close_unstarted_room(p_room_id, 'cancelled', v_reason);
    return;
  end if;
  if v_room.status <> 'lobby_countdown'
    or v_room.lobby_start_deadline > now()
  then
    return;
  end if;

  select count(*) into v_online_count
  from battle.participants p
  where p.room_id = p_room_id
    and p.status = 'lobby'
    and p.offline_since is null
    and p.last_heartbeat_at > now() - make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
    );
  if v_online_count <> 2 then
    perform battle.reconcile_lobby_presence(p_room_id);
    return;
  end if;

  update battle.participants
  set status = 'active'
  where room_id = p_room_id and status = 'lobby';
  update battle.rooms
  set status = 'active_select',
      current_turn_no = 1,
      lobby_start_deadline = null,
      phase_deadline = now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
      ),
      updated_at = now()
  where id = p_room_id
  returning * into v_room;
  insert into battle.turns (
    room_id, turn_no, phase, deadline, start_snapshot_hash
  ) values (
    p_room_id, 1, 'normal', v_room.phase_deadline,
    battle.room_snapshot_hash(p_room_id)
  );
  perform battle.record_event(
    p_room_id,
    'battle_started',
    jsonb_build_object(
      'turn_no', 1,
      'deadline', v_room.phase_deadline,
      'seed_commitment', v_room.seed_commitment
    ),
    jsonb_build_object('ruleset_checksum', v_room.ruleset_checksum)
  );
end;
$$;

create or replace function api.battle_prepare_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid,
  p_invite_token_hash text,
  p_entry_tier_id text,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_ruleset battle.rulesets%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_participant_id uuid;
  v_balance jsonb;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'battle.create',
    p_operation_id,
    jsonb_build_object('entry_tier_id', p_entry_tier_id, 'template_ids', p_template_ids)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_room_id is null or p_invite_token_hash !~ '^[0-9a-f]{64}$' then
      perform api.raise_business_error('REQUEST_INVALID', 'Battle 创建参数无效');
    end if;
    perform battle.consume_rate_limit(v_user_id, 'create');
    perform pg_advisory_xact_lock(hashtextextended('battle-user:' || v_user_id::text, 0));
    if exists (
      select 1 from battle.participants
      where user_id = v_user_id and status = 'preparing_share'
    ) then
      perform api.raise_business_error(
        'BATTLE_SHARE_PREPARING',
        '挑战卡正在准备，请勿重复创建'
      );
    elsif exists (
      select 1 from battle.participants
      where user_id = v_user_id and status in ('waiting', 'active')
    ) then
      perform api.raise_business_error('BATTLE_ALREADY_PARTICIPATING', '当前已有未结束的 Battle');
    end if;
    select * into v_ruleset from battle.rulesets where status = 'active';
    if v_ruleset.id is null or not battle.rules_complete(v_ruleset.id) then
      perform api.raise_business_error('BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试');
    end if;
    select * into v_tier
    from battle.entry_tiers
    where ruleset_id = v_ruleset.id and id = p_entry_tier_id;
    if v_tier.id is null then
      perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
    end if;
    insert into battle.rooms (
      id, creator_user_id, create_operation_id, ruleset_id, ruleset_checksum,
      entry_tier_id, invite_token_hash, status, prepare_deadline
    ) values (
      p_room_id, v_user_id, p_operation_id, v_ruleset.id, v_ruleset.checksum,
      v_tier.id, p_invite_token_hash, 'preparing_share',
      now() + make_interval(
        secs => battle.rule_int(v_ruleset.id, 'share_prepare_timeout_seconds')
      )
    );
    insert into battle.prepared_shares (room_id) values (p_room_id);
    insert into battle.participants (
      room_id, user_id, side, status, join_operation_id
    ) values (
      p_room_id, v_user_id, 'creator', 'preparing_share', p_operation_id
    ) returning id into v_participant_id;
    perform battle.create_team(
      v_participant_id, v_user_id, v_ruleset.id, p_template_ids
    );
    v_balance := economy.lock_kcoin(
      v_user_id, v_tier.entry_fee, p_operation_id,
      p_room_id::text || ':' || v_user_id::text || ':lock'
    );
    insert into battle.stakes (
      room_id, participant_id, user_id, amount, lock_ledger_id
    ) values (
      p_room_id, v_participant_id, v_user_id, v_tier.entry_fee,
      (v_balance->>'ledger_id')::bigint
    );
    perform battle.record_event(
      p_room_id,
      'room_prepared',
      '{}'::jsonb,
      jsonb_build_object(
        'creator_user_id', v_user_id,
        'participant_id', v_participant_id,
        'ruleset_id', v_ruleset.id,
        'ruleset_checksum', v_ruleset.checksum,
        'entry_tier_id', v_tier.id,
        'template_ids', p_template_ids,
        'stake_lock_ledger_id', (v_balance->>'ledger_id')::bigint
      )
    );
    perform battle.wake_integration('share');
    v_result := jsonb_build_object(
      'room_id', p_room_id,
      'status', 'preparing_share',
      'create_operation_id', p_operation_id,
      'prepare_deadline', (
        select prepare_deadline from battle.rooms where id = p_room_id
      )
    );
    return operations.pending_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ALREADY_PARTICIPATING',
        jsonb_build_object('error_code', 'BATTLE_ALREADY_PARTICIPATING')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function api.battle_activate_share(
  p_room_id uuid,
  p_prepared_message_id text,
  p_telegram_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status = 'waiting' then
    return (select operations.operation_json(o) from operations.operations o where o.id = v_room.create_operation_id);
  end if;
  if v_room.status <> 'preparing_share'
    or p_prepared_message_id is null
    or btrim(p_prepared_message_id) = ''
    or p_prepared_message_id <> btrim(p_prepared_message_id)
    or char_length(p_prepared_message_id) > 256
    or p_telegram_expires_at is null
    or p_telegram_expires_at < now() + make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'waiting_timeout_seconds')
    )
    or now() >= v_room.prepare_deadline
  then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  update battle.prepared_shares
  set status = 'active', prepared_message_id = p_prepared_message_id,
      telegram_expires_at = p_telegram_expires_at, activated_at = now(),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where room_id = p_room_id;
  update battle.rooms
  set status = 'waiting',
      waiting_started_at = now(),
      expires_at = now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'waiting_timeout_seconds')
      ),
      updated_at = now()
  where id = p_room_id
  returning * into v_room;
  update battle.participants
  set status = 'waiting',
      last_heartbeat_at = now(),
      offline_since = null,
      presence_deadline = null
  where room_id = p_room_id and side = 'creator';
  perform battle.record_event(
    p_room_id, 'share_activated',
    jsonb_build_object('expires_at', v_room.expires_at),
    jsonb_build_object(
      'prepared_message_id', p_prepared_message_id,
      'telegram_expires_at', p_telegram_expires_at,
      'expires_at', v_room.expires_at
    )
  );
  v_result := jsonb_build_object(
    'room_id', p_room_id,
    'status', 'waiting',
    'prepared_message_id', p_prepared_message_id,
    'expires_at', v_room.expires_at
  );
  return operations.complete_command(v_room.create_operation_id, v_result);
end;
$$;

create or replace function api.battle_abort_share(
  p_room_id uuid,
  p_error text default 'BATTLE_SHARE_FAILED'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status = 'voided' then
    return (select operations.operation_json(o) from operations.operations o where o.id = v_room.create_operation_id);
  end if;
  if v_room.status <> 'preparing_share' then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  update battle.prepared_shares
  set status = 'failed',
      last_error = case
        when coalesce(p_error, '') ~ '^[A-Z0-9_]{1,100}$' then p_error
        else 'BATTLE_SHARE_FAILED'
      end,
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where room_id = p_room_id;
  v_result := battle.close_unstarted_room(p_room_id, 'voided', 'share_failed');
  return operations.fail_command(
    v_room.create_operation_id,
    'BATTLE_SHARE_FAILED',
    v_result || jsonb_build_object('error_code', 'BATTLE_SHARE_FAILED')
  );
end;
$$;

create or replace function api.battle_cancel_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id, 'battle.cancel', p_operation_id, jsonb_build_object('room_id', p_room_id)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_room from battle.rooms where id = p_room_id for update;
    if v_room.id is null or v_room.creator_user_id <> v_operation.user_id then
      perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
    end if;
    if v_room.status = 'expired' then
      perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
    elsif v_room.status = 'cancelled' then
      perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    elsif v_room.status not in ('preparing_share', 'waiting') then
      perform api.raise_business_error('BATTLE_ROOM_ALREADY_ACCEPTED', '挑战已被其他玩家接受');
    end if;
    v_result := battle.close_unstarted_room(p_room_id, 'cancelled', 'creator_cancelled');
    return operations.complete_command(p_operation_id, v_result);
  exception when sqlstate 'P0001' then
    if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
    return operations.fail_command(
      p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
    );
  end;
end;
$$;

create or replace function api.battle_heartbeat(
  p_session_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_now timestamptz := now();
  v_was_online boolean;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  select * into v_participant
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id
  for update;
  if v_room.id is null or v_participant.id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided') then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status = 'waiting' and v_participant.side <> 'creator' then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  elsif v_room.status not in ('waiting', 'lobby_waiting', 'lobby_countdown') then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  perform battle.consume_rate_limit(v_user_id, 'heartbeat');
  if v_room.status = 'waiting' then
    if v_room.expires_at <= v_now then
      perform battle.close_unstarted_room(p_room_id, 'expired', 'waiting_expired');
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
  else
    perform battle.advance_lobby(p_room_id);
    select * into v_room from battle.rooms where id = p_room_id;
    if v_room.status not in ('lobby_waiting', 'lobby_countdown') then
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
    select * into v_participant
    from battle.participants
    where id = v_participant.id
    for update;
  end if;

  v_was_online := coalesce(
    v_participant.offline_since is null
      and v_participant.last_heartbeat_at > v_now - make_interval(
        secs => battle.rule_int(
          v_room.ruleset_id, 'presence_online_window_seconds'
        )
      ),
    false
  );
  update battle.participants
  set last_heartbeat_at = greatest(
        coalesce(last_heartbeat_at, '-infinity'::timestamptz), v_now
      ),
      offline_since = null,
      presence_deadline = null
  where id = v_participant.id
  returning * into v_participant;
  if not v_was_online then
    perform battle.record_event(
      p_room_id,
      'participant_online',
      jsonb_build_object('side', v_participant.side),
      jsonb_build_object('participant_id', v_participant.id)
    );
  end if;
  if v_room.status in ('lobby_waiting', 'lobby_countdown') then
    perform battle.advance_lobby(p_room_id);
  end if;
  return battle.room_snapshot_json(p_room_id, v_participant.id);
end;
$$;

create or replace function api.battle_mark_offline(
  p_session_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_offline_since timestamptz;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  select * into v_participant
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id
  for update;
  if v_room.id is null or v_participant.id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided') then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status = 'waiting' and v_participant.side <> 'creator' then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  elsif v_room.status not in ('waiting', 'lobby_waiting', 'lobby_countdown') then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  perform battle.consume_rate_limit(v_user_id, 'heartbeat');
  if v_room.status = 'waiting' and v_room.expires_at <= now() then
    perform battle.close_unstarted_room(p_room_id, 'expired', 'waiting_expired');
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status in ('lobby_waiting', 'lobby_countdown') then
    perform battle.advance_lobby(p_room_id);
    select * into v_room from battle.rooms where id = p_room_id;
    if v_room.status not in ('lobby_waiting', 'lobby_countdown') then
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
    select * into v_participant
    from battle.participants
    where id = v_participant.id
    for update;
  end if;
  if v_participant.offline_since is null then
    v_offline_since := now();
    update battle.participants
    set offline_since = v_offline_since,
        presence_deadline = v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
    where id = v_participant.id;
    perform battle.record_event(
      p_room_id, 'participant_offline',
      jsonb_build_object(
        'side', v_participant.side,
        'reconnect_deadline',
        v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
      ),
      jsonb_build_object(
        'participant_id', v_participant.id,
        'offline_since', v_offline_since
      )
    );
  end if;
  if v_room.status in ('lobby_waiting', 'lobby_countdown') then
    perform battle.advance_lobby(p_room_id);
  end if;
  return battle.room_snapshot_json(p_room_id, v_participant.id);
end;
$$;

create or replace function api.battle_accept_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_invite_hash text;
  v_room battle.rooms%rowtype;
  v_creator identity.users%rowtype;
  v_creator_participant battle.participants%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_participant_id uuid := extensions.gen_random_uuid();
  v_seed bytea := extensions.gen_random_bytes(32);
  v_ledger_id bigint;
  v_result jsonb;
  v_terminal jsonb;
  v_creator_online boolean;
  v_now timestamptz := now();
begin
  select s.battle_invite_token_hash into v_invite_hash
  from identity.sessions s
  where s.id = p_session_id;
  v_operation := operations.begin_command(
    p_session_id,
    'battle.accept',
    p_operation_id,
    jsonb_build_object(
      'invite_token_hash', v_invite_hash,
      'template_ids', p_template_ids
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select s.battle_invite_token_hash into v_invite_hash
    from identity.sessions s
    where s.id = p_session_id and s.user_id = v_operation.user_id
      and s.revoked_at is null and s.expires_at > now()
    for update;
    if v_invite_hash is null then
      perform api.raise_business_error('BATTLE_INVITE_INVALID', 'Battle 邀请无效');
    end if;
    select * into v_room
    from battle.rooms r
    where r.invite_token_hash = v_invite_hash
    for update;
    if v_room.id is null then
      perform api.raise_business_error('BATTLE_INVITE_INVALID', 'Battle 邀请无效');
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'accept', v_invite_hash);
    select * into v_creator
    from identity.users
    where id = v_room.creator_user_id
    for update;
    select * into v_creator_participant
    from battle.participants
    where room_id = v_room.id and side = 'creator'
    for update;
    if v_room.status = 'expired' then
      perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
    elsif v_room.status = 'cancelled' then
      perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    elsif v_room.status <> 'waiting' then
      perform api.raise_business_error('BATTLE_ROOM_ALREADY_ACCEPTED', '挑战已被其他玩家接受');
    end if;
    if v_room.expires_at <= now() then
      v_terminal := battle.close_unstarted_room(
        v_room.id, 'expired', 'waiting_expired'
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ROOM_EXPIRED',
        v_terminal || jsonb_build_object('error_code', 'BATTLE_ROOM_EXPIRED')
      );
    elsif v_creator.status = 'banned' then
      v_terminal := battle.close_unstarted_room(
        v_room.id, 'cancelled', 'creator_banned'
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ROOM_CANCELLED',
        v_terminal || jsonb_build_object('error_code', 'BATTLE_ROOM_CANCELLED')
      );
    elsif v_room.creator_user_id = v_operation.user_id then
      perform api.raise_business_error(
        'BATTLE_SELF_ACCEPT_FORBIDDEN',
        '不能接受自己创建的挑战'
      );
    end if;
    perform pg_advisory_xact_lock(hashtextextended('battle-user:' || v_operation.user_id::text, 0));
    if exists (
      select 1 from battle.participants p
      where p.user_id = v_operation.user_id
        and p.status in ('preparing_share', 'waiting', 'lobby', 'active')
    ) then
      perform api.raise_business_error('BATTLE_ALREADY_PARTICIPATING', '当前已有进行中的 Battle');
    end if;
    select * into v_tier
    from battle.entry_tiers
    where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
    insert into battle.participants (
      id, room_id, user_id, side, status, join_operation_id,
      last_heartbeat_at
    ) values (
      v_participant_id, v_room.id, v_operation.user_id, 'opponent', 'lobby',
      p_operation_id, v_now
    );
    perform battle.create_team(
      v_participant_id, v_operation.user_id, v_room.ruleset_id, p_template_ids
    );
    v_ledger_id := (
      economy.lock_kcoin(
        v_operation.user_id, v_tier.entry_fee, p_operation_id,
        v_room.id::text || ':' || v_operation.user_id::text || ':lock'
      )->>'ledger_id'
    )::bigint;
    insert into battle.stakes (
      room_id, participant_id, user_id, amount, lock_ledger_id
    ) values (
      v_room.id, v_participant_id, v_operation.user_id, v_tier.entry_fee, v_ledger_id
    );
    v_creator_online := v_creator_participant.offline_since is null
      and v_creator_participant.last_heartbeat_at > v_now - make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
      );
    update battle.participants
    set status = 'lobby',
        offline_since = case when v_creator_online then null else v_now end,
        presence_deadline = case
          when v_creator_online then null
          else v_now + make_interval(
            secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
          )
        end
    where id = v_creator_participant.id;
    update battle.rooms
    set status = case
          when v_creator_online then 'lobby_countdown'
          else 'lobby_waiting'
        end,
        private_seed = v_seed,
        seed_commitment = encode(extensions.digest(v_seed, 'sha256'), 'hex'),
        accepted_at = v_now,
        lobby_expires_at = v_now + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'lobby_timeout_seconds')
        ),
        lobby_start_deadline = case
          when v_creator_online then v_now + make_interval(
            secs => battle.rule_int(v_room.ruleset_id, 'lobby_countdown_seconds')
          )
          else null
        end,
        current_turn_no = 0,
        phase_deadline = null,
        updated_at = v_now
    where id = v_room.id
    returning * into v_room;
    perform battle.append_audit(
      v_room.id, 'seed_commitment',
      jsonb_build_object('commitment', v_room.seed_commitment)
    );
    perform battle.record_event(
      v_room.id, 'lobby_started',
      jsonb_build_object(
        'phase', v_room.status,
        'expires_at', v_room.lobby_expires_at,
        'start_deadline', v_room.lobby_start_deadline
      ),
      jsonb_build_object(
        'opponent_participant_id', v_participant_id,
        'ruleset_checksum', v_room.ruleset_checksum
      )
    );
    if v_creator_online then
      perform battle.record_event(
        v_room.id,
        'lobby_countdown_started',
        jsonb_build_object('start_deadline', v_room.lobby_start_deadline),
        '{}'::jsonb
      );
    end if;
    v_result := battle.room_snapshot_json(v_room.id, v_participant_id);
    if v_result is null then
      raise exception using
        errcode = 'P0001',
        message = 'BATTLE_INVARIANT',
        detail = jsonb_build_object(
          'kind', 'accept_snapshot_missing',
          'room_id', v_room.id,
          'participant_id', v_participant_id
        )::text;
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function battle.active_member(p_participant_id uuid)
returns battle.team_members
language sql
stable
security definer
set search_path = ''
as $$
  select tm from battle.team_members tm
  where tm.participant_id = p_participant_id and tm.active
$$;

create or replace function battle.choose_timeout_skill(
  p_ruleset_id text,
  p_member battle.team_members
)
returns table (skill_position smallint, skill_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select skill.position, skill.skill_id
  from (
    values
      (1::smallint, p_member.skill_1_id),
      (2::smallint, p_member.skill_2_id),
      (3::smallint, p_member.skill_3_id),
      (4::smallint, p_member.skill_4_id)
  ) skill(position, skill_id)
  join battle.skills s
    on s.ruleset_id = p_ruleset_id and s.id = skill.skill_id
  join battle.skill_slots ss
    on ss.ruleset_id = s.ruleset_id and ss.id = s.slot_id
  order by ss.accuracy_bps desc, skill.position
  limit 1
$$;

create or replace function battle.lock_timeout_action(
  p_room_id uuid,
  p_turn_no smallint,
  p_phase text,
  p_participant_id uuid
)
returns battle.actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_member battle.team_members%rowtype;
  v_choice record;
  v_target_slot smallint;
  v_action battle.actions%rowtype;
begin
  select * into v_action
  from battle.actions
  where room_id = p_room_id and turn_no = p_turn_no
    and phase = p_phase and participant_id = p_participant_id;
  if v_action.id is not null then return v_action; end if;
  select * into v_room from battle.rooms where id = p_room_id;
  if p_phase = 'normal' then
    v_member := battle.active_member(p_participant_id);
    select * into v_choice from battle.choose_timeout_skill(v_room.ruleset_id, v_member);
    insert into battle.actions (
      room_id, turn_no, phase, participant_id, kind, source,
      skill_position, skill_id
    ) values (
      p_room_id, p_turn_no, p_phase, p_participant_id, 'attack', 'timeout',
      v_choice.skill_position, v_choice.skill_id
    ) returning * into v_action;
  else
    select slot into v_target_slot
    from battle.team_members
    where participant_id = p_participant_id and alive and not active
    order by slot
    limit 1;
    if v_target_slot is null then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    insert into battle.actions (
      room_id, turn_no, phase, participant_id, kind, source, target_slot
    ) values (
      p_room_id, p_turn_no, p_phase, p_participant_id,
      'forced_switch', 'timeout', v_target_slot
    ) returning * into v_action;
  end if;
  perform battle.append_audit(
    p_room_id, 'automatic_action',
    jsonb_build_object(
      'turn_no', p_turn_no, 'phase', p_phase,
      'participant_id', p_participant_id, 'action_id', v_action.id
    )
  );
  return v_action;
end;
$$;

create or replace function battle.public_attack_result(p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'attack',
    'actor_side', p_result->'actor_side',
    'attacker_member_id', p_result->'attacker_member_id',
    'defender_member_id', p_result->'defender_member_id',
    'skill_id', p_result->'skill_id',
    'skill_name', p_result->'skill_name',
    'effect_key', p_result->'effect_key',
    'hit', p_result->'hit',
    'multiplier_bps', p_result->'multiplier_bps',
    'applied_damage', p_result->'applied_damage',
    'knockout',
    (p_result->>'applied_damage')::integer > 0
      and (p_result->>'applied_damage')::integer
        = (p_result->>'defender_current_hp')::integer
  )
$$;

create or replace function battle.public_switch_target(
  p_participant_id uuid,
  p_slot smallint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'slot', tm.slot,
    'name', tm.template_name,
    'image_thumbnail_path', tm.image_thumbnail_path,
    'image_detail_path', tm.image_detail_path,
    'rarity', tm.rarity,
    'stage', tm.stage
  )
  from battle.team_members tm
  where tm.participant_id = p_participant_id and tm.slot = p_slot
$$;

create or replace function battle.resolve_normal_turn(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_creator battle.participants%rowtype;
  v_opponent battle.participants%rowtype;
  v_creator_action battle.actions%rowtype;
  v_opponent_action battle.actions%rowtype;
  v_creator_member battle.team_members%rowtype;
  v_opponent_member battle.team_members%rowtype;
  v_creator_result jsonb;
  v_opponent_result jsonb;
  v_creator_priority integer;
  v_opponent_priority integer;
  v_creator_first boolean;
  v_simultaneous boolean;
  v_creator_alive integer;
  v_opponent_alive integer;
  v_creator_hp numeric;
  v_opponent_hp numeric;
  v_pending_result text;
  v_winner uuid;
  v_next_status text;
  v_reason text;
  v_event_id uuid := extensions.gen_random_uuid();
  v_public_actions jsonb := '[]'::jsonb;
  v_audit_actions jsonb := '[]'::jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status <> 'active_select' then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  select * into v_creator
  from battle.participants
  where room_id = p_room_id and side = 'creator' for update;
  select * into v_opponent
  from battle.participants
  where room_id = p_room_id and side = 'opponent' for update;
  select * into v_creator_action
  from battle.actions
  where room_id = p_room_id and turn_no = v_room.current_turn_no
    and phase = 'normal' and participant_id = v_creator.id;
  select * into v_opponent_action
  from battle.actions
  where room_id = p_room_id and turn_no = v_room.current_turn_no
    and phase = 'normal' and participant_id = v_opponent.id;
  if v_creator_action.id is null or v_opponent_action.id is null then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;

  if v_creator_action.kind = 'switch' then
    update battle.team_members
    set active = slot = v_creator_action.target_slot
    where participant_id = v_creator.id and alive;
    v_public_actions := v_public_actions || jsonb_build_array(jsonb_build_object(
      'kind', 'switch', 'actor_side', 'creator',
      'switch_to',
      battle.public_switch_target(v_creator.id, v_creator_action.target_slot)
    ));
    v_audit_actions := v_audit_actions || jsonb_build_array(to_jsonb(v_creator_action));
  end if;
  if v_opponent_action.kind = 'switch' then
    update battle.team_members
    set active = slot = v_opponent_action.target_slot
    where participant_id = v_opponent.id and alive;
    v_public_actions := v_public_actions || jsonb_build_array(jsonb_build_object(
      'kind', 'switch', 'actor_side', 'opponent',
      'switch_to',
      battle.public_switch_target(v_opponent.id, v_opponent_action.target_slot)
    ));
    v_audit_actions := v_audit_actions || jsonb_build_array(to_jsonb(v_opponent_action));
  end if;
  v_creator_member := battle.active_member(v_creator.id);
  v_opponent_member := battle.active_member(v_opponent.id);
  if v_creator_member.id is null or v_opponent_member.id is null then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;

  if v_creator_action.kind = 'attack' and v_opponent_action.kind = 'attack' then
    v_creator_result := battle.attack_result(
      v_room, v_room.current_turn_no, 'creator',
      v_creator_action, v_creator_member, v_opponent_member
    );
    v_opponent_result := battle.attack_result(
      v_room, v_room.current_turn_no, 'opponent',
      v_opponent_action, v_opponent_member, v_creator_member
    );
    v_creator_priority := (v_creator_result->>'priority')::integer;
    v_opponent_priority := (v_opponent_result->>'priority')::integer;
    v_simultaneous := v_creator_priority = v_opponent_priority
      and v_creator_member.speed = v_opponent_member.speed;
    v_creator_first := v_creator_priority > v_opponent_priority
      or (v_creator_priority = v_opponent_priority
          and v_creator_member.speed > v_opponent_member.speed);
    if v_simultaneous then
      update battle.team_members
      set current_hp = current_hp - (v_creator_result->>'applied_damage')::integer,
          alive = current_hp - (v_creator_result->>'applied_damage')::integer > 0,
          active = active and current_hp - (v_creator_result->>'applied_damage')::integer > 0
      where id = v_opponent_member.id;
      update battle.team_members
      set current_hp = current_hp - (v_opponent_result->>'applied_damage')::integer,
          alive = current_hp - (v_opponent_result->>'applied_damage')::integer > 0,
          active = active and current_hp - (v_opponent_result->>'applied_damage')::integer > 0
      where id = v_creator_member.id;
      v_public_actions := v_public_actions
        || jsonb_build_array(battle.public_attack_result(v_creator_result))
        || jsonb_build_array(battle.public_attack_result(v_opponent_result));
      v_audit_actions := v_audit_actions
        || jsonb_build_array(v_creator_result)
        || jsonb_build_array(v_opponent_result);
    elsif v_creator_first then
      update battle.team_members
      set current_hp = current_hp - (v_creator_result->>'applied_damage')::integer,
          alive = current_hp - (v_creator_result->>'applied_damage')::integer > 0,
          active = active and current_hp - (v_creator_result->>'applied_damage')::integer > 0
      where id = v_opponent_member.id;
      v_public_actions := v_public_actions
        || jsonb_build_array(battle.public_attack_result(v_creator_result));
      v_audit_actions := v_audit_actions || jsonb_build_array(v_creator_result);
      if (select current_hp > 0 from battle.team_members where id = v_opponent_member.id) then
        update battle.team_members
        set current_hp = current_hp - (v_opponent_result->>'applied_damage')::integer,
            alive = current_hp - (v_opponent_result->>'applied_damage')::integer > 0,
            active = active and current_hp - (v_opponent_result->>'applied_damage')::integer > 0
        where id = v_creator_member.id;
        v_public_actions := v_public_actions
          || jsonb_build_array(battle.public_attack_result(v_opponent_result));
        v_audit_actions := v_audit_actions || jsonb_build_array(v_opponent_result);
      end if;
    else
      update battle.team_members
      set current_hp = current_hp - (v_opponent_result->>'applied_damage')::integer,
          alive = current_hp - (v_opponent_result->>'applied_damage')::integer > 0,
          active = active and current_hp - (v_opponent_result->>'applied_damage')::integer > 0
      where id = v_creator_member.id;
      v_public_actions := v_public_actions
        || jsonb_build_array(battle.public_attack_result(v_opponent_result));
      v_audit_actions := v_audit_actions || jsonb_build_array(v_opponent_result);
      if (select current_hp > 0 from battle.team_members where id = v_creator_member.id) then
        update battle.team_members
        set current_hp = current_hp - (v_creator_result->>'applied_damage')::integer,
            alive = current_hp - (v_creator_result->>'applied_damage')::integer > 0,
            active = active and current_hp - (v_creator_result->>'applied_damage')::integer > 0
        where id = v_opponent_member.id;
        v_public_actions := v_public_actions
          || jsonb_build_array(battle.public_attack_result(v_creator_result));
        v_audit_actions := v_audit_actions || jsonb_build_array(v_creator_result);
      end if;
    end if;
  elsif v_creator_action.kind = 'attack' then
    v_creator_result := battle.attack_result(
      v_room, v_room.current_turn_no, 'creator',
      v_creator_action, v_creator_member, v_opponent_member
    );
    update battle.team_members
    set current_hp = current_hp - (v_creator_result->>'applied_damage')::integer,
        alive = current_hp - (v_creator_result->>'applied_damage')::integer > 0,
        active = active and current_hp - (v_creator_result->>'applied_damage')::integer > 0
    where id = v_opponent_member.id;
    v_public_actions := v_public_actions
      || jsonb_build_array(battle.public_attack_result(v_creator_result));
    v_audit_actions := v_audit_actions || jsonb_build_array(v_creator_result);
  elsif v_opponent_action.kind = 'attack' then
    v_opponent_result := battle.attack_result(
      v_room, v_room.current_turn_no, 'opponent',
      v_opponent_action, v_opponent_member, v_creator_member
    );
    update battle.team_members
    set current_hp = current_hp - (v_opponent_result->>'applied_damage')::integer,
        alive = current_hp - (v_opponent_result->>'applied_damage')::integer > 0,
        active = active and current_hp - (v_opponent_result->>'applied_damage')::integer > 0
    where id = v_creator_member.id;
    v_public_actions := v_public_actions
      || jsonb_build_array(battle.public_attack_result(v_opponent_result));
    v_audit_actions := v_audit_actions || jsonb_build_array(v_opponent_result);
  end if;

  update battle.team_members
  set alive = current_hp > 0,
      active = active and current_hp > 0
  where participant_id in (v_creator.id, v_opponent.id);
  select count(*) filter (where alive),
         sum(current_hp::numeric / max_hp::numeric)
  into v_creator_alive, v_creator_hp
  from battle.team_members where participant_id = v_creator.id;
  select count(*) filter (where alive),
         sum(current_hp::numeric / max_hp::numeric)
  into v_opponent_alive, v_opponent_hp
  from battle.team_members where participant_id = v_opponent.id;
  if v_creator_alive = 0 and v_opponent_alive = 0 then
    v_pending_result := 'draw'; v_reason := 'simultaneous_knockout';
  elsif v_creator_alive = 0 then
    v_pending_result := 'winner'; v_winner := v_opponent.id; v_reason := 'team_knockout';
  elsif v_opponent_alive = 0 then
    v_pending_result := 'winner'; v_winner := v_creator.id; v_reason := 'team_knockout';
  elsif v_room.current_turn_no = battle.rule_int(
    v_room.ruleset_id, 'max_normal_turns'
  ) then
    if v_creator_alive > v_opponent_alive
       or (v_creator_alive = v_opponent_alive and v_creator_hp > v_opponent_hp) then
      v_pending_result := 'winner'; v_winner := v_creator.id; v_reason := 'turn_limit';
    elsif v_opponent_alive > v_creator_alive
       or (v_opponent_alive = v_creator_alive and v_opponent_hp > v_creator_hp) then
      v_pending_result := 'winner'; v_winner := v_opponent.id; v_reason := 'turn_limit';
    else
      v_pending_result := 'draw'; v_reason := 'turn_limit';
    end if;
  elsif not exists (
    select 1 from battle.team_members where participant_id = v_creator.id and active
  ) or not exists (
    select 1 from battle.team_members where participant_id = v_opponent.id and active
  ) then
    v_next_status := 'forced_switch';
  else
    v_next_status := 'active_select';
  end if;

  update battle.turns
  set resolution_hash = encode(
        extensions.digest(convert_to(v_audit_actions::text, 'UTF8'), 'sha256'), 'hex'
      ),
      resolved_at = now()
  where room_id = p_room_id and turn_no = v_room.current_turn_no and phase = 'normal';
  update battle.rooms
  set status = 'reveal',
      next_status = v_next_status,
      pending_result = v_pending_result,
      pending_winner_participant_id = v_winner,
      pending_result_reason = v_reason,
      phase_deadline = null,
      reveal_ends_at = now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'reveal_seconds')
      ),
      resolution_event = jsonb_build_object(
        'event_id', v_event_id,
        'actions', v_public_actions
      ),
      updated_at = now()
  where id = p_room_id;
  perform battle.record_event(
    p_room_id, 'turn_resolved',
    jsonb_build_object(
      'event_id', v_event_id,
      'turn_no', v_room.current_turn_no,
      'reveal_ends_at', now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'reveal_seconds')
      ),
      'actions', v_public_actions
    ),
    jsonb_build_object(
      'turn_no', v_room.current_turn_no,
      'actions', v_audit_actions,
      'pending_result', v_pending_result,
      'winner_participant_id', v_winner
    )
  );
end;
$$;

create or replace function battle.resolve_forced_switch(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant record;
  v_action battle.actions%rowtype;
  v_actions jsonb := '[]'::jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status <> 'forced_switch' then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  for v_participant in
    select p.*
    from battle.participants p
    where p.room_id = p_room_id and p.status = 'active'
    order by p.side
    for update
  loop
    if not exists (
      select 1 from battle.team_members
      where participant_id = v_participant.id and active
    ) then
      select * into v_action
      from battle.actions
      where room_id = p_room_id and turn_no = v_room.current_turn_no
        and phase = 'forced_switch' and participant_id = v_participant.id;
      if v_action.id is null then
        raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
      end if;
      update battle.team_members
      set active = slot = v_action.target_slot
      where participant_id = v_participant.id and alive;
      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'kind', 'forced_switch',
        'actor_side', v_participant.side,
        'switch_to',
        battle.public_switch_target(v_participant.id, v_action.target_slot),
        'source', v_action.source
      ));
    end if;
  end loop;
  if exists (
    select 1
    from battle.participants p
    where p.room_id = p_room_id and p.status = 'active'
      and not exists (
        select 1 from battle.team_members tm
        where tm.participant_id = p.id and tm.active
      )
  ) then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  update battle.turns
  set resolution_hash = encode(
        extensions.digest(convert_to(v_actions::text, 'UTF8'), 'sha256'), 'hex'
      ),
      resolved_at = now()
  where room_id = p_room_id and turn_no = v_room.current_turn_no
    and phase = 'forced_switch';
  update battle.rooms
  set status = 'active_select',
      current_turn_no = current_turn_no + 1,
      phase_deadline = now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
      ),
      next_status = null,
      resolution_event = null,
      updated_at = now()
  where id = p_room_id
  returning * into v_room;
  insert into battle.turns (
    room_id, turn_no, phase, deadline, start_snapshot_hash
  ) values (
    p_room_id, v_room.current_turn_no, 'normal',
    v_room.phase_deadline, battle.room_snapshot_hash(p_room_id)
  );
  perform battle.record_event(
    p_room_id, 'forced_switch_resolved',
    jsonb_build_object(
      'actions', v_actions,
      'turn_no', v_room.current_turn_no,
      'deadline', v_room.phase_deadline
    ),
    jsonb_build_object('actions', v_actions)
  );
end;
$$;

create or replace function battle.void_room_after_invariant(
  p_room_id uuid,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_participant battle.participants%rowtype;
  v_ledgers jsonb;
  v_audit_hash text;
  v_error_hash text := encode(
    extensions.digest(
      convert_to(coalesce(p_error_detail, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status in ('finished', 'draw', 'voided') then return; end if;
  select * into v_tier
  from battle.entry_tiers
  where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
  v_ledgers := battle.refund_locked_stakes(p_room_id, 'battle_invariant_void');
  perform battle.release_reservations(p_room_id);
  update battle.participants
  set status = 'voided', finished_at = now()
  where room_id = p_room_id;
  for v_participant in
    select * from battle.participants where room_id = p_room_id order by side
  loop
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    select
      v_participant.id, p_room_id, v_participant.user_id,
      coalesce(
        btrim(opponent.first_name || ' ' || coalesce(opponent.last_name, '')),
        'Battle'
      ),
      'void', v_tier.entry_fee, v_tier.entry_fee, 0, 0,
      'system_invariant_void', now()
    from battle.participants other
    join identity.users opponent on opponent.id = other.user_id
    where other.room_id = p_room_id and other.id <> v_participant.id
    limit 1;
  end loop;
  insert into operations.invariant_violations (code, subject, details)
  values (
    'BATTLE_INVARIANT',
    p_room_id::text,
    jsonb_build_object(
      'room_status', v_room.status,
      'error_detail_sha256', v_error_hash
    )
  )
  on conflict do nothing;
  v_audit_hash := battle.append_audit(
    p_room_id, 'invariant_void',
    jsonb_build_object(
      'error_detail_sha256', v_error_hash,
      'refund_ledger_ids', v_ledgers
    )
  );
  insert into battle.settlements (
    room_id, result, pool, winner_payout, fee, ledger_ids, reason, audit_hash
  ) values (
    p_room_id, 'void', v_tier.pool, 0, 0, v_ledgers,
    'system_invariant_void', v_audit_hash
  );
  update battle.rooms
  set status = 'voided', finished_at = now(), phase_deadline = null,
      reveal_ends_at = null, lobby_start_deadline = null, pending_result = null,
      pending_winner_participant_id = null,
      pending_result_reason = 'system_invariant_void',
      updated_at = now()
  where id = p_room_id;
  perform battle.record_event(
    p_room_id, 'battle_voided',
    jsonb_build_object('reason', 'system_invariant_void'),
    jsonb_build_object('audit_hash', v_audit_hash, 'refund_ledger_ids', v_ledgers)
  );
end;
$$;

create or replace function battle.safe_resolve_normal_turn(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text;
  v_message text;
  v_state text;
begin
  begin
    perform battle.resolve_normal_turn(p_room_id);
    return true;
  exception
    when others then
      v_state := sqlstate;
      v_message := sqlerrm;
      get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform battle.void_room_after_invariant(
    p_room_id,
    coalesce(v_state, '')
      || ':'
      || coalesce(v_message, '')
      || ':'
      || coalesce(v_detail, '')
  );
  return false;
end;
$$;

create or replace function battle.safe_resolve_forced_switch(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text;
  v_message text;
  v_state text;
begin
  begin
    perform battle.resolve_forced_switch(p_room_id);
    return true;
  exception
    when others then
      v_state := sqlstate;
      v_message := sqlerrm;
      get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform battle.void_room_after_invariant(
    p_room_id,
    coalesce(v_state, '')
      || ':'
      || coalesce(v_message, '')
      || ':'
      || coalesce(v_detail, '')
  );
  return false;
end;
$$;

create or replace function api.battle_submit_action(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid,
  p_turn_no smallint,
  p_kind text,
  p_skill_position smallint default null,
  p_target_slot smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_member battle.team_members%rowtype;
  v_skill_id text;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id, 'battle.action', p_operation_id,
    jsonb_build_object(
      'room_id', p_room_id, 'turn_no', p_turn_no, 'kind', p_kind,
      'skill_position', p_skill_position, 'target_slot', p_target_slot
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_room from battle.rooms where id = p_room_id for update;
    if v_room.id is null then
      perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    end if;
    select * into v_participant
    from battle.participants
    where room_id = p_room_id and user_id = v_operation.user_id and status = 'active';
    if v_participant.id is null then
      perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'combat_action');
    if v_room.status <> 'active_select' then
      perform api.raise_business_error(
        'BATTLE_ACTION_PHASE_INVALID',
        '当前阶段不能提交该动作'
      );
    elsif v_room.current_turn_no <> p_turn_no
       or now() >= v_room.phase_deadline then
      perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
    end if;
    v_member := battle.active_member(v_participant.id);
    if p_kind = 'attack' and p_skill_position between 1 and 4
       and p_target_slot is null then
      v_skill_id := battle.skill_for_position(v_member, p_skill_position);
      if v_skill_id is null then
        perform api.raise_business_error('BATTLE_ACTION_INVALID', 'Battle 动作无效');
      end if;
      insert into battle.actions (
        room_id, turn_no, phase, participant_id, kind, source,
        skill_position, skill_id, operation_id
      ) values (
        p_room_id, p_turn_no, 'normal', v_participant.id, 'attack', 'player',
        p_skill_position, v_skill_id, p_operation_id
      );
    elsif p_kind = 'switch' and p_skill_position is null
       and p_target_slot between 1 and 3 then
      if not exists (
        select 1 from battle.team_members
        where participant_id = v_participant.id
          and slot = p_target_slot and alive and not active
      ) then
        perform api.raise_business_error('BATTLE_SWITCH_TARGET_INVALID', '换宠目标无效');
      end if;
      insert into battle.actions (
        room_id, turn_no, phase, participant_id, kind, source,
        target_slot, operation_id
      ) values (
        p_room_id, p_turn_no, 'normal', v_participant.id, 'switch', 'player',
        p_target_slot, p_operation_id
      );
    else
      perform api.raise_business_error('BATTLE_ACTION_INVALID', 'Battle 动作无效');
    end if;
    perform battle.append_audit(
      p_room_id, 'player_action_locked',
      jsonb_build_object(
        'turn_no', p_turn_no, 'participant_id', v_participant.id,
        'kind', p_kind, 'skill_id', v_skill_id, 'target_slot', p_target_slot,
        'operation_id', p_operation_id
      )
    );
    if (
      select count(*) = 2
      from battle.actions
      where room_id = p_room_id and turn_no = p_turn_no and phase = 'normal'
    ) then
      if not battle.safe_resolve_normal_turn(p_room_id) then
        v_result := battle.room_snapshot_json(p_room_id, v_participant.id);
        return operations.fail_command(
          p_operation_id,
          'BATTLE_VOIDED',
          coalesce(v_result, '{}'::jsonb)
            || jsonb_build_object('error_code', 'BATTLE_VOIDED')
        );
      end if;
    end if;
    v_result := battle.room_snapshot_json(p_room_id, v_participant.id);
    return operations.complete_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id, 'BATTLE_ACTION_ALREADY_LOCKED',
        jsonb_build_object('error_code', 'BATTLE_ACTION_ALREADY_LOCKED')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function api.battle_submit_forced_switch(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid,
  p_turn_no smallint,
  p_target_slot smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id, 'battle.forced_switch', p_operation_id,
    jsonb_build_object(
      'room_id', p_room_id, 'turn_no', p_turn_no, 'target_slot', p_target_slot
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_room from battle.rooms where id = p_room_id for update;
    if v_room.id is null then
      perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    end if;
    select * into v_participant
    from battle.participants
    where room_id = p_room_id and user_id = v_operation.user_id and status = 'active';
    if v_participant.id is null then
      perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'combat_action');
    if v_room.status <> 'forced_switch' then
      perform api.raise_business_error(
        'BATTLE_ACTION_PHASE_INVALID',
        '当前阶段不能提交该动作'
      );
    elsif v_room.current_turn_no <> p_turn_no
       or now() >= v_room.phase_deadline then
      perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
    elsif exists (
         select 1 from battle.team_members
         where participant_id = v_participant.id and active
       )
       or not exists (
         select 1 from battle.team_members
         where participant_id = v_participant.id
           and slot = p_target_slot and alive and not active
       )
    then
      perform api.raise_business_error('BATTLE_SWITCH_TARGET_INVALID', '换宠目标无效');
    end if;
    insert into battle.actions (
      room_id, turn_no, phase, participant_id, kind, source,
      target_slot, operation_id
    ) values (
      p_room_id, p_turn_no, 'forced_switch', v_participant.id,
      'forced_switch', 'player', p_target_slot, p_operation_id
    );
    perform battle.append_audit(
      p_room_id, 'player_forced_switch_locked',
      jsonb_build_object(
        'turn_no', p_turn_no, 'participant_id', v_participant.id,
        'target_slot', p_target_slot, 'operation_id', p_operation_id
      )
    );
    if not exists (
      select 1
      from battle.participants p
      where p.room_id = p_room_id and p.status = 'active'
        and not exists (
          select 1 from battle.team_members tm
          where tm.participant_id = p.id and tm.active
        )
        and not exists (
          select 1 from battle.actions a
          where a.room_id = p_room_id and a.turn_no = p_turn_no
            and a.phase = 'forced_switch' and a.participant_id = p.id
        )
    ) then
      if not battle.safe_resolve_forced_switch(p_room_id) then
        v_result := battle.room_snapshot_json(p_room_id, v_participant.id);
        return operations.fail_command(
          p_operation_id,
          'BATTLE_VOIDED',
          coalesce(v_result, '{}'::jsonb)
            || jsonb_build_object('error_code', 'BATTLE_VOIDED')
        );
      end if;
    end if;
    v_result := battle.room_snapshot_json(p_room_id, v_participant.id);
    return operations.complete_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id, 'BATTLE_ACTION_ALREADY_LOCKED',
        jsonb_build_object('error_code', 'BATTLE_ACTION_ALREADY_LOCKED')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function battle.finalize_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_stake battle.stakes%rowtype;
  v_participant battle.participants%rowtype;
  v_winner battle.participants%rowtype;
  v_loser battle.participants%rowtype;
  v_balance jsonb;
  v_ledger_ids jsonb := '[]'::jsonb;
  v_audit_hash text;
  v_payout bigint;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status in ('finished', 'draw', 'voided') then return; end if;
  if v_room.status <> 'reveal' or v_room.pending_result is null then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  select * into v_tier
  from battle.entry_tiers
  where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
  if v_tier.id is null
     or (select count(*) from battle.stakes where room_id = p_room_id and status = 'locked') <> 2
  then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  perform 1
  from economy.balances b
  join battle.stakes s
    on s.user_id = b.user_id and s.room_id = p_room_id and s.status = 'locked'
  where b.currency = 'KCOIN'
  order by b.user_id
  for update of b;

  if v_room.pending_result = 'draw' then
    v_ledger_ids := battle.refund_locked_stakes(p_room_id, 'battle_draw');
    update battle.participants
    set status = 'draw', finished_at = now()
    where room_id = p_room_id;
    for v_participant in
      select * from battle.participants where room_id = p_room_id order by side
    loop
      insert into battle.summaries (
        participant_id, room_id, user_id, opponent_display_name,
        result, entry_fee, payout, net_change, fee, reason, finished_at
      )
      select
        v_participant.id, p_room_id, v_participant.user_id,
        btrim(opponent.first_name || ' ' || coalesce(opponent.last_name, '')),
        'draw', v_tier.entry_fee, v_tier.entry_fee, 0, 0,
        coalesce(v_room.pending_result_reason, 'draw'), now()
      from battle.participants other
      join identity.users opponent on opponent.id = other.user_id
      where other.room_id = p_room_id and other.id <> v_participant.id;
    end loop;
    v_audit_hash := battle.append_audit(
      p_room_id, 'settlement_draw',
      jsonb_build_object(
        'pool', v_tier.pool, 'refund_ledger_ids', v_ledger_ids,
        'seed_reveal', encode(v_room.private_seed, 'hex'),
        'seed_commitment', v_room.seed_commitment
      )
    );
    insert into battle.settlements (
      room_id, result, pool, winner_payout, fee, ledger_ids, reason, audit_hash
    ) values (
      p_room_id, 'draw', v_tier.pool, 0, 0, v_ledger_ids,
      coalesce(v_room.pending_result_reason, 'draw'), v_audit_hash
    );
    update battle.rooms
    set status = 'draw', finished_at = now(), reveal_ends_at = null,
        phase_deadline = null, updated_at = now()
    where id = p_room_id;
  else
    select * into v_winner
    from battle.participants
    where id = v_room.pending_winner_participant_id and room_id = p_room_id;
    select * into v_loser
    from battle.participants
    where room_id = p_room_id and id <> v_winner.id;
    if v_winner.id is null or v_loser.id is null then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    for v_stake in
      select * from battle.stakes
      where room_id = p_room_id and status = 'locked'
      order by user_id
      for update
    loop
      v_payout := case
        when v_stake.participant_id = v_winner.id then v_tier.winner_payout
        else 0
      end;
      v_balance := economy.settle_battle_kcoin(
        v_stake.user_id, v_stake.amount, v_payout,
        (select join_operation_id from battle.participants where id = v_stake.participant_id),
        p_room_id::text || ':' || v_stake.user_id::text || ':settlement'
      );
      update battle.stakes
      set status = 'settled',
          payout_ledger_id = (v_balance->>'ledger_id')::bigint,
          settled_at = now()
      where id = v_stake.id;
      if v_balance->>'ledger_id' is not null then
        v_ledger_ids := v_ledger_ids
          || jsonb_build_array((v_balance->>'ledger_id')::bigint);
      end if;
    end loop;
    update battle.participants
    set status = 'finished', finished_at = now()
    where room_id = p_room_id;
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    select
      v_winner.id, p_room_id, v_winner.user_id,
      btrim(loser_user.first_name || ' ' || coalesce(loser_user.last_name, '')),
      'win', v_tier.entry_fee, v_tier.winner_payout,
      v_tier.winner_payout - v_tier.entry_fee, v_tier.fee,
      coalesce(v_room.pending_result_reason, 'winner'), now()
    from identity.users loser_user where loser_user.id = v_loser.user_id;
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    select
      v_loser.id, p_room_id, v_loser.user_id,
      btrim(winner_user.first_name || ' ' || coalesce(winner_user.last_name, '')),
      'loss', v_tier.entry_fee, 0, -v_tier.entry_fee, 0,
      coalesce(v_room.pending_result_reason, 'winner'), now()
    from identity.users winner_user where winner_user.id = v_winner.user_id;
    v_audit_hash := battle.append_audit(
      p_room_id, 'settlement_winner',
      jsonb_build_object(
        'winner_participant_id', v_winner.id,
        'pool', v_tier.pool,
        'winner_payout', v_tier.winner_payout,
        'fee', v_tier.fee,
        'ledger_ids', v_ledger_ids,
        'seed_reveal', encode(v_room.private_seed, 'hex'),
        'seed_commitment', v_room.seed_commitment
      )
    );
    insert into battle.settlements (
      room_id, result, winner_participant_id, pool, winner_payout,
      fee, ledger_ids, reason, audit_hash
    ) values (
      p_room_id, 'winner', v_winner.id, v_tier.pool, v_tier.winner_payout,
      v_tier.fee, v_ledger_ids,
      coalesce(v_room.pending_result_reason, 'winner'), v_audit_hash
    );
    update battle.rooms
    set status = 'finished', finished_at = now(), reveal_ends_at = null,
        phase_deadline = null, updated_at = now()
    where id = p_room_id;
  end if;
  perform battle.release_reservations(p_room_id);
  perform battle.record_event(
    p_room_id, 'battle_finished',
    jsonb_build_object(
      'result', v_room.pending_result,
      'reason', v_room.pending_result_reason
    ),
    jsonb_build_object(
      'settlement_audit_hash', v_audit_hash,
      'ledger_ids', v_ledger_ids
    )
  );
end;
$$;

create or replace function battle.safe_finalize_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text;
  v_message text;
  v_state text;
begin
  begin
    perform battle.finalize_room(p_room_id);
  exception
    when others then
      v_state := sqlstate;
      v_message := sqlerrm;
      get stacked diagnostics v_detail = pg_exception_detail;
  end;
  if v_state is not null then
    perform battle.void_room_after_invariant(
      p_room_id,
      coalesce(v_state, '')
        || ':'
        || coalesce(v_message, '')
        || ':'
        || coalesce(v_detail, '')
    );
  end if;
end;
$$;

create or replace function battle.advance_reveal(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status <> 'reveal' or v_room.reveal_ends_at > now() then return; end if;
  if v_room.pending_result is not null then
    perform battle.safe_finalize_room(p_room_id);
  elsif v_room.next_status = 'forced_switch' then
    update battle.rooms
    set status = 'forced_switch',
        phase_deadline = now() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'forced_switch_timeout_seconds')
        ),
        reveal_ends_at = null,
        resolution_event = null,
        updated_at = now()
    where id = p_room_id
    returning * into v_room;
    insert into battle.turns (
      room_id, turn_no, phase, deadline, start_snapshot_hash
    ) values (
      p_room_id, v_room.current_turn_no, 'forced_switch',
      v_room.phase_deadline, battle.room_snapshot_hash(p_room_id)
    );
    perform battle.record_event(
      p_room_id, 'forced_switch_started',
      jsonb_build_object(
        'turn_no', v_room.current_turn_no,
        'deadline', v_room.phase_deadline
      ),
      '{}'::jsonb
    );
  else
    update battle.rooms
    set status = 'active_select',
        current_turn_no = current_turn_no + 1,
        phase_deadline = now() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
        ),
        reveal_ends_at = null,
        next_status = null,
        resolution_event = null,
        updated_at = now()
    where id = p_room_id
    returning * into v_room;
    insert into battle.turns (
      room_id, turn_no, phase, deadline, start_snapshot_hash
    ) values (
      p_room_id, v_room.current_turn_no, 'normal',
      v_room.phase_deadline, battle.room_snapshot_hash(p_room_id)
    );
    perform battle.record_event(
      p_room_id, 'turn_started',
      jsonb_build_object(
        'turn_no', v_room.current_turn_no,
        'deadline', v_room.phase_deadline
      ),
      '{}'::jsonb
    );
  end if;
end;
$$;

create or replace function battle.process_due(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_processed integer := 0;
  v_ruleset_id text;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
begin
  if not pg_try_advisory_xact_lock(
    hashtextextended('pokepets:battle:process_due:v1', 0)
  ) then
    return 0;
  end if;
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  if p_limit < 1
     or p_limit > battle.rule_int(v_ruleset_id, 'tick_batch_limit') then
    raise exception 'invalid Battle tick batch';
  end if;
  if exists (
    select 1 from battle.prepared_shares
    where status = 'pending' and next_attempt_at <= now()
      and (lease_expires_at is null or lease_expires_at <= now())
  ) then
    perform battle.wake_integration('share');
  end if;
  if exists (
    select 1
    from battle.outbox
    where published_at is null
      and next_attempt_at <= now()
      and (
        status = 'pending'
        or (status = 'leased' and lease_expires_at <= now())
      )
  ) then
    perform battle.wake_integration('outbox');
  end if;
  for v_room in
    select r.*
    from battle.rooms r
    where (
      (r.status = 'preparing_share' and r.prepare_deadline <= now())
      or (
        r.status = 'waiting'
        and (
          r.expires_at <= now()
          or exists (
            select 1
            from battle.participants p
            where p.room_id = r.id
              and p.side = 'creator'
              and p.status = 'waiting'
              and p.offline_since is null
              and p.last_heartbeat_at <= now() - make_interval(
                secs => battle.rule_int(
                  r.ruleset_id, 'presence_online_window_seconds'
                )
              )
          )
          or exists (
            select 1 from identity.users u
            where u.id = r.creator_user_id and u.status = 'banned'
          )
        )
      )
      or (
        r.status in ('lobby_waiting', 'lobby_countdown')
        and (
          r.lobby_expires_at <= now()
          or r.lobby_start_deadline <= now()
          or exists (
            select 1
            from battle.participants p
            where p.room_id = r.id
              and p.status = 'lobby'
              and (
                p.presence_deadline <= now()
                or (
                  p.offline_since is null
                  and p.last_heartbeat_at <= now() - make_interval(
                    secs => battle.rule_int(
                      r.ruleset_id, 'presence_online_window_seconds'
                    )
                  )
                )
              )
          )
          or exists (
            select 1
            from battle.participants p
            join identity.users u on u.id = p.user_id
            where p.room_id = r.id
              and p.status = 'lobby'
              and u.status = 'banned'
          )
        )
      )
      or (r.status in ('active_select', 'forced_switch') and r.phase_deadline <= now())
      or (r.status = 'reveal' and r.reveal_ends_at <= now())
    )
    order by least(
      coalesce(r.prepare_deadline, 'infinity'::timestamptz),
      coalesce(r.expires_at, 'infinity'::timestamptz),
      coalesce(r.lobby_expires_at, 'infinity'::timestamptz),
      coalesce(r.lobby_start_deadline, 'infinity'::timestamptz),
      coalesce((
        select p.last_heartbeat_at + make_interval(
          secs => battle.rule_int(
            r.ruleset_id, 'presence_online_window_seconds'
          )
        )
        from battle.participants p
        where p.room_id = r.id
          and p.side = 'creator'
          and p.status = 'waiting'
          and p.offline_since is null
      ), 'infinity'::timestamptz),
      coalesce((
        select min(coalesce(
          p.presence_deadline,
          p.last_heartbeat_at + make_interval(
            secs => battle.rule_int(
              r.ruleset_id, 'presence_online_window_seconds'
            )
          )
        ))
        from battle.participants p
        where p.room_id = r.id and p.status = 'lobby'
      ), 'infinity'::timestamptz),
      coalesce(r.phase_deadline, 'infinity'::timestamptz),
      coalesce(r.reveal_ends_at, 'infinity'::timestamptz)
    ), r.id
    limit p_limit
    for update skip locked
  loop
    begin
      begin
        if v_room.status = 'preparing_share' then
          perform api.battle_abort_share(v_room.id, 'share_timeout');
        elsif v_room.status = 'waiting' then
          if v_room.expires_at <= now()
            or exists (
              select 1 from identity.users
              where id = v_room.creator_user_id and status = 'banned'
            )
          then
            perform battle.close_unstarted_room(
              v_room.id,
              case when v_room.expires_at <= now() then 'expired' else 'cancelled' end,
              case
                when v_room.expires_at <= now() then 'waiting_expired'
                else 'creator_banned'
              end
            );
          else
            select * into v_participant
            from battle.participants
            where room_id = v_room.id and side = 'creator' and status = 'waiting'
            for update;
            if v_participant.offline_since is null then
              update battle.participants
              set offline_since = v_participant.last_heartbeat_at + make_interval(
                    secs => battle.rule_int(
                      v_room.ruleset_id, 'presence_online_window_seconds'
                    )
                  ),
                  presence_deadline = v_participant.last_heartbeat_at
                    + make_interval(
                      secs => battle.rule_int(
                        v_room.ruleset_id, 'presence_online_window_seconds'
                      ) + battle.rule_int(
                        v_room.ruleset_id, 'offline_reconnect_seconds'
                      )
                    )
              where id = v_participant.id
              returning * into v_participant;
              perform battle.record_event(
                v_room.id,
                'participant_offline',
                jsonb_build_object(
                  'side', 'creator',
                  'reconnect_deadline', v_participant.presence_deadline
                ),
                jsonb_build_object(
                  'participant_id', v_participant.id,
                  'offline_since', v_participant.offline_since,
                  'display_only', true
                )
              );
            end if;
          end if;
        elsif v_room.status in ('lobby_waiting', 'lobby_countdown') then
          perform battle.advance_lobby(v_room.id);
        elsif v_room.status = 'active_select' then
          for v_participant in
            select * from battle.participants
            where room_id = v_room.id and status = 'active'
            order by side
          loop
            perform battle.lock_timeout_action(
              v_room.id, v_room.current_turn_no, 'normal', v_participant.id
            );
          end loop;
          perform battle.safe_resolve_normal_turn(v_room.id);
        elsif v_room.status = 'forced_switch' then
          for v_participant in
            select p.*
            from battle.participants p
            where p.room_id = v_room.id and p.status = 'active'
              and not exists (
                select 1 from battle.team_members tm
                where tm.participant_id = p.id and tm.active
              )
            order by p.side
          loop
            perform battle.lock_timeout_action(
              v_room.id, v_room.current_turn_no, 'forced_switch', v_participant.id
            );
          end loop;
          perform battle.safe_resolve_forced_switch(v_room.id);
        else
          perform battle.advance_reveal(v_room.id);
        end if;
        v_processed := v_processed + 1;
      exception
        when sqlstate 'P0001' then
          if sqlerrm <> 'BATTLE_INVARIANT' then raise; end if;
          v_error_message := sqlerrm;
          get stacked diagnostics v_error_detail = pg_exception_detail;
          perform battle.void_room_after_invariant(
            v_room.id,
            coalesce(v_error_message, '') || ':' || coalesce(v_error_detail, '')
          );
          v_processed := v_processed + 1;
      end;
    exception
      when others then
        v_error_state := sqlstate;
        v_error_message := sqlerrm;
        get stacked diagnostics v_error_detail = pg_exception_detail;
        insert into operations.invariant_violations (code, subject, details)
        values (
          'BATTLE_TICK_ROOM_FAILURE',
          v_room.id::text,
          jsonb_build_object(
            'sqlstate', v_error_state,
            'error_sha256',
            encode(
              extensions.digest(
                convert_to(
                  coalesce(v_error_message, '')
                    || ':'
                    || coalesce(v_error_detail, ''),
                  'UTF8'
                ),
                'sha256'
              ),
              'hex'
            )
          )
        )
        on conflict do nothing;
    end;
  end loop;
  return v_processed;
end;
$$;

create or replace function api.battle_acknowledge_result(
  p_session_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_participant battle.participants%rowtype;
begin
  select * into v_participant
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id
  for update;
  if v_participant.id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if v_participant.status not in ('finished', 'draw', 'voided') then
    perform api.raise_business_error(
      'BATTLE_RESULT_NOT_ACKNOWLEDGEABLE',
      '当前没有可确认的 Battle 结果'
    );
  end if;
  update battle.participants
  set result_acknowledged_at = coalesce(result_acknowledged_at, now())
  where id = v_participant.id;
  return jsonb_build_object(
    'room_id', p_room_id,
    'acknowledged', true,
    'acknowledged_at', (
      select result_acknowledged_at from battle.participants where id = v_participant.id
    )
  );
end;
$$;

create or replace function api.battle_claim_prepared_shares(
  p_lease_owner text,
  p_limit integer default 25,
  p_room_id uuid default null
)
returns table (
  room_id uuid,
  create_operation_id uuid,
  creator_telegram_id bigint,
  creator_display_name text,
  rarity_summary jsonb,
  entry_fee bigint,
  invite_token_hash text,
  attempt_count integer,
  prepare_deadline timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' or length(p_lease_owner) > 128
     or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid prepared-share lease';
  end if;
  return query
  with claimed as (
    select ps.room_id
    from battle.prepared_shares ps
    join battle.rooms r on r.id = ps.room_id
    where ps.status = 'pending'
      and ps.next_attempt_at <= now()
      and r.status = 'preparing_share'
      and r.prepare_deadline > now()
      and (p_room_id is null or ps.room_id = p_room_id)
      and (ps.lease_expires_at is null or ps.lease_expires_at <= now())
    order by ps.next_attempt_at, ps.room_id
    limit p_limit
    for update of ps skip locked
  ), leased as (
    update battle.prepared_shares ps
    set lease_owner = p_lease_owner,
        lease_expires_at = now() + interval '30 seconds',
        attempt_count = ps.attempt_count + 1,
        updated_at = now()
    from claimed c
    where ps.room_id = c.room_id
    returning ps.*
  )
  select
    r.id, r.create_operation_id, u.telegram_id,
    btrim(u.first_name || ' ' || coalesce(u.last_name, '')),
    battle.rarity_summary(r.id), tier.entry_fee, r.invite_token_hash,
    leased.attempt_count, r.prepare_deadline
  from leased
  join battle.rooms r on r.id = leased.room_id
  join identity.users u on u.id = r.creator_user_id
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id;
end;
$$;

create or replace function api.battle_nack_prepared_share(
  p_room_id uuid,
  p_lease_owner text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  update battle.prepared_shares
  set lease_owner = null,
      lease_expires_at = null,
      last_error = case
        when coalesce(p_error_code, '') ~ '^[A-Z0-9_]{1,100}$' then p_error_code
        else 'INTEGRATION_FAILURE'
      end,
      next_attempt_at = now() + battle.retry_interval(p_room_id, attempt_count),
      updated_at = now()
  where room_id = p_room_id and status = 'pending'
    and lease_owner = p_lease_owner
  returning attempt_count into v_attempt;
  return v_attempt is not null;
end;
$$;

create or replace function battle.invalidation_channels(p_room_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(channel order by channel), array[]::text[])
  from (
    select 'battle:room:' || r.id::text channel
    from battle.rooms r
    where r.id = p_room_id
    union
    select 'battle:invite:' || r.invite_token_hash
    from battle.rooms r
    where r.id = p_room_id
    union
    select 'battle:user:' || p.user_id::text
    from battle.participants p
    where p.room_id = p_room_id
  ) permitted_channels
$$;

create or replace function api.battle_claim_outbox(
  p_lease_owner text,
  p_limit integer default 100
)
returns table (
  outbox_id uuid,
  event_id uuid,
  room_id uuid,
  state_version bigint,
  event_kind text,
  attempt_count integer,
  channels text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' or length(p_lease_owner) > 128
     or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid outbox lease';
  end if;
  return query
  with claimed as (
    select o.id
    from battle.outbox o
    where o.published_at is null
      and o.next_attempt_at <= now()
      and (o.status = 'pending' or o.lease_expires_at <= now())
    order by o.next_attempt_at, o.created_at, o.id
    limit p_limit
    for update skip locked
  )
  update battle.outbox o
  set status = 'leased',
      lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '30 seconds',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
  from claimed c
  where o.id = c.id
  returning
    o.id,
    o.event_id,
    o.room_id,
    o.state_version,
    o.event_kind,
    o.attempt_count,
    battle.invalidation_channels(o.room_id);
end;
$$;

create or replace function api.battle_ack_outbox(
  p_outbox_id uuid,
  p_lease_owner text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with acknowledged as (
    update battle.outbox o
    set status = 'published', published_at = coalesce(published_at, now()),
        lease_owner = null, lease_expires_at = null, last_error = null,
        updated_at = now()
    where id = p_outbox_id
      and (status = 'published' or (status = 'leased' and lease_owner = p_lease_owner))
    returning 1
  )
  select exists (select 1 from acknowledged)
$$;

create or replace function api.battle_nack_outbox(
  p_outbox_id uuid,
  p_lease_owner text,
  p_error_code text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with rejected as (
    update battle.outbox o
    set status = 'pending',
        lease_owner = null,
        lease_expires_at = null,
        last_error = case
          when coalesce(p_error_code, '') ~ '^[A-Z0-9_]{1,100}$' then p_error_code
          else 'INTEGRATION_FAILURE'
        end,
        next_attempt_at = now() + battle.retry_interval(o.room_id, o.attempt_count),
        updated_at = now()
    where id = p_outbox_id and status = 'leased' and lease_owner = p_lease_owner
    returning 1
  )
  select exists (select 1 from rejected)
$$;

create or replace function api.battle_complete_outbox(
  p_outbox_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_error_code text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select case
    when p_success then api.battle_ack_outbox(p_outbox_id, p_lease_owner)
    else api.battle_nack_outbox(p_outbox_id, p_lease_owner, p_error_code)
  end
$$;

create or replace function api.battle_process_due(p_limit integer default 100)
returns integer
language sql
security definer
set search_path = ''
as $$
  select battle.process_due(p_limit)
$$;

create or replace function api.battle_validate_recovery_context(
  p_session_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_invite_hash text;
  v_room battle.rooms%rowtype;
begin
  if p_kind = 'create' then
    return jsonb_build_object(
      'kind', 'create',
      'assets', economy.assets(v_user_id),
      'participation', battle.participation_json(v_user_id)
    );
  elsif p_kind <> 'accept' then
    perform api.raise_business_error('REQUEST_INVALID', '充值恢复上下文无效');
  end if;
  select battle_invite_token_hash into v_invite_hash
  from identity.sessions
  where id = p_session_id and user_id = v_user_id
    and entry_kind = 'battle' and revoked_at is null and expires_at > now();
  select * into v_room
  from battle.rooms
  where invite_token_hash = v_invite_hash;
  return jsonb_build_object(
    'kind', 'accept',
    'assets', economy.assets(v_user_id),
    'participation', battle.participation_json(v_user_id),
    'challenge', case
      when v_room.id is null then null
      else battle.challenge_card_json(v_room.id)
    end,
    'acceptable', v_room.id is not null
      and v_room.status = 'waiting'
      and v_room.expires_at > now()
      and v_room.creator_user_id <> v_user_id
  );
end;
$$;

create or replace function battle.monitor_invariants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_added integer;
begin
  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_BALANCE_LOCK_MISMATCH', b.user_id::text,
    jsonb_build_object(
      'balance_locked', b.locked,
      'battle_locked', coalesce(sum(s.amount) filter (where s.status = 'locked'), 0)
    )
  from economy.balances b
  left join battle.stakes s on s.user_id = b.user_id
  where b.currency = 'KCOIN'
  group by b.user_id, b.locked
  having b.locked < coalesce(sum(s.amount) filter (where s.status = 'locked'), 0)
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_STAKE_SETTLEMENT_MISMATCH', r.id::text,
    jsonb_build_object(
      'room_status', r.status,
      'locked_stakes', count(*) filter (where s.status = 'locked'),
      'settlement_count', count(distinct st.id)
    )
  from battle.rooms r
  left join battle.stakes s on s.room_id = r.id
  left join battle.settlements st on st.room_id = r.id
  group by r.id, r.status
  having (
    r.status in ('finished', 'draw', 'voided')
    and (
      count(*) filter (where s.status = 'locked') > 0
      or count(distinct st.id) <> 1
    )
  ) or (
    r.status in (
      'lobby_waiting', 'lobby_countdown',
      'active_select', 'reveal', 'forced_switch'
    )
    and count(*) filter (where s.status = 'locked') <> 2
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_RESERVATION_MISMATCH', p.id::text,
    jsonb_build_object(
      'participant_status', p.status,
      'active_reservations', count(distinct r.id) filter (where r.status = 'active'),
      'team_members', count(distinct tm.id)
    )
  from battle.participants p
  left join battle.team_members tm on tm.participant_id = p.id
  left join inventory.reservations r
    on r.kind = 'battle' and r.reference_id = p.id
  group by p.id, p.status
  having (
    p.status in ('preparing_share', 'waiting', 'lobby', 'active')
    and (
      count(distinct r.id) filter (where r.status = 'active') <> 3
      or count(distinct tm.id) <> 3
    )
  ) or (
    p.status in ('finished', 'draw', 'cancelled', 'expired', 'voided')
    and count(distinct r.id) filter (where r.status = 'active') <> 0
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_ROOM_STATE_MISMATCH', r.id::text,
    jsonb_build_object(
      'status', r.status,
      'participants', count(distinct p.id),
      'current_turn_no', r.current_turn_no,
      'unresolved_turns',
      count(distinct (t.room_id, t.turn_no, t.phase)) filter (where t.resolved_at is null)
    )
  from battle.rooms r
  left join battle.participants p on p.room_id = r.id
  left join battle.turns t on t.room_id = r.id
  group by r.id, r.status, r.current_turn_no
  having (
    r.status in (
      'lobby_waiting', 'lobby_countdown',
      'active_select', 'reveal', 'forced_switch'
    )
    and count(distinct p.id) <> 2
  ) or (
    r.status in ('lobby_waiting', 'lobby_countdown')
    and (
      r.current_turn_no <> 0
      or count(distinct (t.room_id, t.turn_no, t.phase)) <> 0
    )
  ) or (
    r.status = 'active_select'
    and count(distinct (t.room_id, t.turn_no, t.phase)) filter (
      where t.turn_no = r.current_turn_no and t.phase = 'normal' and t.resolved_at is null
    ) <> 1
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_OUTBOX_STUCK', o.id::text,
    jsonb_build_object(
      'room_id', o.room_id,
      'attempt_count', o.attempt_count,
      'next_attempt_at', o.next_attempt_at
    )
  from battle.outbox o
  where o.published_at is null and o.attempt_count >= 5
    and o.next_attempt_at < now() - interval '5 minutes'
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_AUDIT_CHAIN_MISMATCH', h.room_id::text,
    jsonb_build_object(
      'head_sequence', h.last_sequence,
      'actual_sequence', coalesce(max(e.sequence), 0),
      'head_hash', h.last_hash,
      'actual_hash', coalesce(
        (array_agg(e.entry_hash order by e.sequence desc))[1],
        repeat('0', 64)
      )
    )
  from battle.audit_heads h
  left join battle.audit_entries e on e.room_id = h.room_id
  group by h.room_id, h.last_sequence, h.last_hash
  having h.last_sequence <> coalesce(max(e.sequence), 0)
    or h.last_hash <> coalesce(
      (array_agg(e.entry_hash order by e.sequence desc))[1],
      repeat('0', 64)
    )
    or exists (
      select 1
      from battle.audit_entries current_entry
      left join battle.audit_entries previous_entry
        on previous_entry.room_id = current_entry.room_id
       and previous_entry.sequence = current_entry.sequence - 1
      where current_entry.room_id = h.room_id
        and (
          current_entry.prior_hash <> case
            when current_entry.sequence = 1 then repeat('0', 64)
            else previous_entry.entry_hash
          end
          or current_entry.entry_hash <> encode(
            extensions.digest(
              convert_to(
                current_entry.prior_hash || jsonb_build_object(
                  'room_id', current_entry.room_id,
                  'sequence', current_entry.sequence,
                  'kind', current_entry.kind,
                  'payload', current_entry.payload,
                  'created_at', current_entry.created_at
                )::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
        )
    )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_RULESET_CHECKSUM_MISMATCH', r.id,
    jsonb_build_object(
      'checksum', r.checksum,
      'rules_complete', battle.rules_complete(r.id)
    )
  from battle.rulesets r
  where r.status = 'active' and not battle.rules_complete(r.id)
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;
  return v_count;
end;
$$;

create or replace function battle.cleanup_operational_data(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits integer;
  v_outbox integer;
  v_ruleset_id text;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  delete from battle.rate_limit_attempts
  where id in (
    select id from battle.rate_limit_attempts
    where attempted_at < now() - make_interval(
      secs => battle.rule_int(v_ruleset_id, 'rate_limit_retention_seconds')
    )
    order by attempted_at
    limit greatest(1, least(p_limit, 5000))
  );
  get diagnostics v_rate_limits = row_count;
  delete from battle.outbox
  where id in (
    select id from battle.outbox
    where status = 'published' and published_at < now() - interval '30 days'
    order by published_at
    limit greatest(1, least(p_limit, 5000))
  );
  get diagnostics v_outbox = row_count;
  return jsonb_build_object(
    'rate_limit_attempts_deleted', v_rate_limits,
    'published_outbox_deleted', v_outbox
  );
end;
$$;

select cron.schedule(
  'battle-tick-v1',
  '1 second',
  $battle_tick$select battle.process_due(100);$battle_tick$
);
