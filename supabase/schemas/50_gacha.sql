create table gacha.pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  tier text not null references catalog.boxes(tier),
  progress smallint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

create table gacha.evolution_pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  from_template_id text not null references catalog.templates(id),
  failures smallint not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_template_id)
);
