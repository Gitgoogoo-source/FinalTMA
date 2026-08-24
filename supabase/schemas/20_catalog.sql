create table catalog.chains (
  id text primary key check (id ~ '^CHAIN-[NAT]-[0-9]{3}$'),
  global_order smallint not null unique check (global_order between 1 and 70),
  chain_type text not null check (chain_type in ('normal', 'advanced', 'top')),
  theme text not null,
  continuity text not null,
  catalog_version text not null check (catalog_version = 'v1')
);

create table catalog.templates (
  id text primary key check (id ~ '^PET-[NAT]-[0-9]{3}-[123]$'),
  chain_id text not null references catalog.chains(id),
  stage smallint not null check (stage between 1 and 3),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  name text not null unique,
  sort_order smallint not null unique check (sort_order between 1 and 210),
  combat_power integer not null check (combat_power > 0),
  market_price bigint not null check (market_price > 0),
  decompose_fgems bigint not null check (decompose_fgems > 0),
  expedition_fgems bigint not null check (expedition_fgems > 0),
  draw_weight integer not null default 1 check (draw_weight > 0),
  catalog_version text not null check (catalog_version = 'v1'),
  unique (chain_id, stage)
);

create index templates_chain_id_idx on catalog.templates (chain_id, stage);
create index templates_rarity_draw_idx on catalog.templates (rarity, sort_order);

create table catalog.versions (
  id text primary key check (id = 'v1'),
  product_checksum text not null check (product_checksum ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz not null default now()
);

create table catalog.asset_delivery_config (
  singleton boolean primary key default true check (singleton),
  public_origin text not null check (public_origin ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public$'),
  public_bucket text not null check (public_bucket = 'pet-runtime'),
  updated_at timestamptz not null default now()
);

create table catalog.asset_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  object_class text not null check (object_class in ('master', 'runtime')),
  bucket text not null check (
    (object_class = 'master' and bucket = 'art-masters')
    or (object_class = 'runtime' and bucket = 'pet-runtime')
  ),
  object_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  width integer not null check (width in (256, 768)),
  height integer not null check (height = width),
  mime_type text not null check (mime_type = 'image/webp'),
  status text not null default 'active' check (status in ('active', 'deleting', 'deleted', 'delete_failed')),
  cleanup_claim_id uuid,
  cleanup_claimed_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, object_key),
  check (
    (object_class = 'master' and object_key ~ '^catalog/pet-[nat]-[0-9]{3}-[123]/[0-9a-f]{64}\.webp$' and width = 768)
    or (object_class = 'runtime' and object_key ~ '^catalog/v[12]/(thumb|detail)/pet-[nat]-[0-9]{3}-[123]\.[0-9a-f]{64}\.webp$')
  ),
  check (
    (status = 'deleting' and cleanup_claim_id is not null and cleanup_claimed_at is not null and deleted_at is null)
    or (status = 'deleted' and cleanup_claim_id is null and cleanup_claimed_at is null and deleted_at is not null)
    or (status in ('active', 'delete_failed') and cleanup_claim_id is null and cleanup_claimed_at is null and deleted_at is null)
  )
);

create index asset_objects_cleanup_idx on catalog.asset_objects (status, cleanup_claimed_at, id)
where object_class = 'runtime' and status in ('active', 'deleting', 'delete_failed');

create table catalog.asset_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  release_key text not null unique check (release_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  git_commit text not null check (git_commit ~ '^[0-9a-f]{40}$'),
  status text not null check (status in ('staging', 'active', 'retired')),
  published_at timestamptz not null default now(),
  retired_at timestamptz,
  delete_after timestamptz,
  rollback_locked_until timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status in ('staging', 'active') and retired_at is null and delete_after is null)
    or (status = 'retired' and retired_at is not null and delete_after = retired_at + interval '90 days')
  )
);

create unique index asset_releases_one_active_idx on catalog.asset_releases (status)
where status = 'active';
create index asset_releases_cleanup_idx on catalog.asset_releases (delete_after, rollback_locked_until)
where status = 'retired';

create table catalog.asset_release_templates (
  release_id uuid not null references catalog.asset_releases(id) on delete restrict,
  template_id text not null references catalog.templates(id) on delete restrict,
  master_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  thumbnail_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  detail_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  primary key (release_id, template_id),
  unique (release_id, master_object_id),
  unique (release_id, thumbnail_object_id),
  unique (release_id, detail_object_id)
);

create index asset_release_templates_master_idx on catalog.asset_release_templates (master_object_id);
create index asset_release_templates_thumbnail_idx on catalog.asset_release_templates (thumbnail_object_id);
create index asset_release_templates_detail_idx on catalog.asset_release_templates (detail_object_id);

create table catalog.current_asset_release (
  singleton boolean primary key default true check (singleton),
  release_id uuid not null unique references catalog.asset_releases(id) on delete restrict,
  revision bigint not null check (revision > 0),
  switched_at timestamptz not null default now()
);

create table catalog.asset_rollback_commands (
  idempotency_key uuid primary key,
  release_id uuid not null references catalog.asset_releases(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table catalog.asset_mutation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  fence bigint generated always as identity unique,
  kind text not null check (kind in ('publish', 'rollback', 'cleanup')),
  release_key text check (release_key is null or release_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'committed', 'aborted', 'expired')),
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  finished_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  check (
    (kind = 'cleanup' and release_key is null and manifest_sha256 is null)
    or (kind in ('publish', 'rollback') and release_key is not null and manifest_sha256 is not null)
  ),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create unique index asset_mutation_runs_one_running_idx
on catalog.asset_mutation_runs (status)
where status = 'running';

create index asset_mutation_runs_acquired_idx
on catalog.asset_mutation_runs (acquired_at desc);

create or replace function catalog.acquire_asset_mutation(
  p_kind text,
  p_release_key text,
  p_manifest_sha256 text
)
returns catalog.asset_mutation_runs
language plpgsql
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  if p_kind not in ('publish', 'rollback', 'cleanup')
    or (p_kind = 'cleanup' and (p_release_key is not null or p_manifest_sha256 is not null))
    or (p_kind in ('publish', 'rollback') and (
      p_release_key is null
      or p_manifest_sha256 is null
      or p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
      or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    ))
  then
    raise exception using errcode = '22023', message = 'asset mutation metadata is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evomypet:catalog-asset-mutation', 0));
  update catalog.asset_mutation_runs
  set status = 'expired', finished_at = now(),
      details = details || jsonb_build_object('reason', 'lease_expired')
  where status = 'running' and expires_at <= now();
  if exists (select 1 from catalog.asset_mutation_runs where status = 'running') then
    return null;
  end if;
  insert into catalog.asset_mutation_runs (kind, release_key, manifest_sha256)
  values (p_kind, p_release_key, p_manifest_sha256)
  returning * into v_run;
  return v_run;
end
$$;

create or replace function catalog.require_asset_mutation(
  p_run_id uuid,
  p_fence bigint,
  p_kind text,
  p_release_key text,
  p_manifest_sha256 text
)
returns catalog.asset_mutation_runs
language plpgsql
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  select * into v_run
  from catalog.asset_mutation_runs
  where id = p_run_id
  for update;
  if v_run.id is null
    or v_run.fence <> p_fence
    or v_run.kind <> p_kind
    or v_run.release_key is distinct from p_release_key
    or v_run.manifest_sha256 is distinct from p_manifest_sha256
    or v_run.status <> 'running'
    or v_run.expires_at <= now()
  then
    raise exception using errcode = '55000', message = 'asset mutation lease is missing, expired, or fenced';
  end if;
  return v_run;
end
$$;

create or replace function api.catalog_asset_mutation_acquire(
  p_kind text,
  p_release_key text default null,
  p_manifest_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
  v_active catalog.asset_mutation_runs%rowtype;
begin
  v_run := catalog.acquire_asset_mutation(p_kind, p_release_key, p_manifest_sha256);
  if v_run.id is null then
    select * into v_active
    from catalog.asset_mutation_runs
    where status = 'running';
    return jsonb_build_object(
      'status', 'busy',
      'active_kind', v_active.kind,
      'retry_after', v_active.expires_at
    );
  end if;
  return jsonb_build_object(
    'status', 'running',
    'run_id', v_run.id,
    'fence', v_run.fence,
    'expires_at', v_run.expires_at
  );
end
$$;

create or replace function api.catalog_asset_mutation_renew(
  p_run_id uuid,
  p_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  update catalog.asset_mutation_runs
  set heartbeat_at = now(), expires_at = now() + interval '5 minutes'
  where id = p_run_id and fence = p_fence and status = 'running' and expires_at > now()
  returning * into v_run;
  if v_run.id is null then
    raise exception using errcode = '55000', message = 'asset mutation lease cannot be renewed';
  end if;
  return jsonb_build_object('status', 'running', 'run_id', v_run.id, 'fence', v_run.fence, 'expires_at', v_run.expires_at);
end
$$;

create or replace function api.catalog_asset_mutation_abort(
  p_run_id uuid,
  p_fence bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  update catalog.asset_mutation_runs
  set status = 'aborted', finished_at = now(),
      details = details || jsonb_build_object('reason', left(coalesce(p_reason, 'operator_aborted'), 500))
  where id = p_run_id and fence = p_fence and status = 'running'
  returning * into v_run;
  return jsonb_build_object(
    'status', coalesce(v_run.status, 'unchanged'),
    'run_id', p_run_id,
    'fence', p_fence
  );
end
$$;

create or replace function catalog.rarity_rank(p_rarity text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_rarity when 'common' then 1 when 'rare' then 2 when 'epic' then 3 when 'legendary' then 4 when 'mythic' then 5 else 0 end::smallint
$$;

create or replace function catalog.asset_public_url(p_object_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select config.public_origin || '/' || config.public_bucket || '/' || object.object_key
  from catalog.asset_objects object
  cross join catalog.asset_delivery_config config
  where config.singleton
    and object.id = p_object_id
    and object.object_class = 'runtime'
    and object.bucket = config.public_bucket
    and object.status = 'active'
$$;

create or replace function catalog.template_thumbnail_url(p_template_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select catalog.asset_public_url(item.thumbnail_object_id)
  from catalog.current_asset_release current_release
  join catalog.asset_release_templates item on item.release_id = current_release.release_id
  where current_release.singleton and item.template_id = p_template_id
$$;

create or replace function catalog.template_detail_url(p_template_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select catalog.asset_public_url(item.detail_object_id)
  from catalog.current_asset_release current_release
  join catalog.asset_release_templates item on item.release_id = current_release.release_id
  where current_release.singleton and item.template_id = p_template_id
$$;

create or replace function catalog.register_asset_object(
  p_object_class text,
  p_bucket text,
  p_object jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing catalog.asset_objects%rowtype;
begin
  select * into v_existing
  from catalog.asset_objects
  where bucket = p_bucket and object_key = p_object->>'key'
  for update;
  if v_existing.id is not null then
    if v_existing.object_class is distinct from p_object_class
      or v_existing.sha256 is distinct from p_object->>'sha256'
      or v_existing.byte_size is distinct from (p_object->>'bytes')::integer
      or v_existing.width is distinct from (p_object->>'width')::integer
      or v_existing.height is distinct from (p_object->>'height')::integer
      or v_existing.mime_type is distinct from p_object->>'mime_type'
    then
      raise exception using errcode = '22023', message = 'immutable asset object metadata mismatch';
    end if;
    if v_existing.status <> 'active' then
      raise exception using errcode = '55000', message = 'asset object is not publishable while deletion is pending or complete';
    end if;
    return v_existing.id;
  end if;
  insert into catalog.asset_objects (
    object_class, bucket, object_key, sha256, byte_size, width, height, mime_type
  ) values (
    p_object_class, p_bucket, p_object->>'key', p_object->>'sha256',
    (p_object->>'bytes')::integer, (p_object->>'width')::integer,
    (p_object->>'height')::integer, p_object->>'mime_type'
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function api.catalog_asset_publish(
  p_release_key text,
  p_manifest_sha256 text,
  p_git_commit text,
  p_public_origin text,
  p_assets jsonb,
  p_mutation_run_id uuid,
  p_mutation_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release catalog.asset_releases%rowtype;
  v_current catalog.current_asset_release%rowtype;
  v_asset jsonb;
  v_master uuid;
  v_thumbnail uuid;
  v_detail uuid;
  v_revision bigint;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_result jsonb;
begin
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'publish', p_release_key, p_manifest_sha256
  );
  if p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_git_commit !~ '^[0-9a-f]{40}$'
    or p_public_origin !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public$'
    or jsonb_typeof(p_assets) <> 'array'
    or jsonb_array_length(p_assets) <> 210
  then
    raise exception using errcode = '22023', message = 'asset release metadata is invalid';
  end if;
  if (
    select count(*) <> 210
      or count(distinct asset->>'template_id') <> 210
      or count(*) filter (where template.id is null) <> 0
    from jsonb_array_elements(p_assets) asset
    left join catalog.templates template on template.id = asset->>'template_id'
  ) then
    raise exception using errcode = '22023', message = 'asset release must cover every catalog template exactly once';
  end if;

  insert into catalog.asset_delivery_config (singleton, public_origin, public_bucket)
  values (true, p_public_origin, 'pet-runtime')
  on conflict (singleton) do nothing;
  if exists (
    select 1
    from catalog.asset_delivery_config
    where singleton and (public_origin <> p_public_origin or public_bucket <> 'pet-runtime')
  ) then
    raise exception using errcode = '22023', message = 'asset delivery origin is immutable within one environment';
  end if;

  select * into v_release from catalog.asset_releases where release_key = p_release_key for update;
  if v_release.id is not null then
    if v_release.manifest_sha256 is distinct from p_manifest_sha256
      or v_release.git_commit is distinct from p_git_commit
    then
      raise exception using errcode = '22023', message = 'release key already belongs to different content';
    end if;
    select * into v_current from catalog.current_asset_release where singleton for update;
    if v_current.release_id = v_release.id then
      v_result := jsonb_build_object(
        'release_key', v_release.release_key,
        'manifest_sha256', v_release.manifest_sha256,
        'revision', v_current.revision,
        'status', 'active',
        'idempotent_replay', true
      );
      update catalog.asset_mutation_runs
      set status = 'committed', finished_at = now(), details = v_result
      where id = v_mutation.id;
      return v_result;
    end if;
    raise exception using errcode = '22023', message = 'retired release keys can only be selected by rollback';
  end if;

  insert into catalog.asset_releases (release_key, manifest_sha256, git_commit, status)
  values (p_release_key, p_manifest_sha256, p_git_commit, 'staging')
  returning * into v_release;

  for v_asset in select value from jsonb_array_elements(p_assets)
  loop
    v_master := catalog.register_asset_object('master', 'art-masters', v_asset->'master');
    v_thumbnail := catalog.register_asset_object('runtime', 'pet-runtime', v_asset->'thumbnail');
    v_detail := catalog.register_asset_object('runtime', 'pet-runtime', v_asset->'detail');
    insert into catalog.asset_release_templates (
      release_id, template_id, master_object_id, thumbnail_object_id, detail_object_id
    ) values (
      v_release.id, v_asset->>'template_id', v_master, v_thumbnail, v_detail
    );
  end loop;

  select * into v_current from catalog.current_asset_release where singleton for update;
  if v_current.release_id is not null then
    update catalog.asset_releases
    set status = 'retired', retired_at = now(), delete_after = now() + interval '90 days'
    where id = v_current.release_id;
    v_revision := v_current.revision + 1;
    update catalog.current_asset_release
    set release_id = v_release.id, revision = v_revision, switched_at = now()
    where singleton;
  else
    v_revision := 1;
    insert into catalog.current_asset_release (singleton, release_id, revision)
    values (true, v_release.id, v_revision);
  end if;

  update catalog.asset_releases set status = 'active' where id = v_release.id;

  v_result := jsonb_build_object(
    'release_key', v_release.release_key,
    'manifest_sha256', v_release.manifest_sha256,
    'revision', v_revision,
    'status', 'active',
    'idempotent_replay', false
  );
  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(), details = v_result
  where id = v_mutation.id;
  return v_result;
end
$$;

create or replace function api.catalog_asset_current()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'release_key', release.release_key,
    'manifest_sha256', release.manifest_sha256,
    'git_commit', release.git_commit,
    'revision', current_release.revision,
    'published_at', release.published_at,
    'template_count', (select count(*) from catalog.asset_release_templates item where item.release_id = release.id),
    'public_origin', config.public_origin,
    'public_bucket', config.public_bucket
  )
  from catalog.current_asset_release current_release
  join catalog.asset_releases release on release.id = current_release.release_id
  cross join catalog.asset_delivery_config config
  where current_release.singleton and config.singleton
$$;

create or replace function api.catalog_asset_release_get(p_release_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'private_bucket', 'art-masters',
    'public_bucket', 'pet-runtime',
    'manifest_sha256', release.manifest_sha256,
    'release', jsonb_build_object('key', release.release_key, 'git_commit', release.git_commit),
    'templates', coalesce(jsonb_agg(jsonb_build_object(
      'template_id', item.template_id,
      'master', jsonb_build_object('key', master.object_key, 'sha256', master.sha256, 'bytes', master.byte_size, 'width', master.width, 'height', master.height, 'mime_type', master.mime_type),
      'thumbnail', jsonb_build_object('key', thumbnail.object_key, 'sha256', thumbnail.sha256, 'bytes', thumbnail.byte_size, 'width', thumbnail.width, 'height', thumbnail.height, 'mime_type', thumbnail.mime_type),
      'detail', jsonb_build_object('key', detail.object_key, 'sha256', detail.sha256, 'bytes', detail.byte_size, 'width', detail.width, 'height', detail.height, 'mime_type', detail.mime_type)
    ) order by template.sort_order), '[]'::jsonb)
  )
  from catalog.asset_releases release
  join catalog.asset_release_templates item on item.release_id = release.id
  join catalog.templates template on template.id = item.template_id
  join catalog.asset_objects master on master.id = item.master_object_id
  join catalog.asset_objects thumbnail on thumbnail.id = item.thumbnail_object_id
  join catalog.asset_objects detail on detail.id = item.detail_object_id
  where release.release_key = p_release_key
  group by release.id
$$;

create or replace function api.catalog_asset_lock(p_release_key text, p_locked_until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release catalog.asset_releases%rowtype;
begin
  if p_locked_until <= now() or p_locked_until > now() + interval '10 years' then
    raise exception using errcode = '22023', message = 'rollback lock expiry is invalid';
  end if;
  update catalog.asset_releases
  set rollback_locked_until = greatest(coalesce(rollback_locked_until, p_locked_until), p_locked_until)
  where release_key = p_release_key
  returning * into v_release;
  if v_release.id is null then
    raise exception using errcode = '22023', message = 'asset release was not found';
  end if;
  return jsonb_build_object('release_key', v_release.release_key, 'rollback_locked_until', v_release.rollback_locked_until);
end
$$;

create or replace function api.catalog_asset_rollback(
  p_release_key text,
  p_idempotency_key uuid,
  p_mutation_run_id uuid,
  p_mutation_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target catalog.asset_releases%rowtype;
  v_current catalog.current_asset_release%rowtype;
  v_existing catalog.asset_rollback_commands%rowtype;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_result jsonb;
begin
  select * into v_target from catalog.asset_releases where release_key = p_release_key;
  if v_target.id is null then raise exception using errcode = '22023', message = 'asset release was not found'; end if;
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'rollback', p_release_key, v_target.manifest_sha256
  );
  select * into v_existing from catalog.asset_rollback_commands where idempotency_key = p_idempotency_key for update;
  if v_existing.idempotency_key is not null then
    if v_target.id is distinct from v_existing.release_id then
      raise exception using errcode = '22023', message = 'rollback idempotency key was reused';
    end if;
    update catalog.asset_mutation_runs
    set status = 'committed', finished_at = now(), details = v_existing.result
    where id = v_mutation.id;
    return v_existing.result;
  end if;
  select * into v_target from catalog.asset_releases where release_key = p_release_key for update;
  if (select count(*) from catalog.asset_release_templates where release_id = v_target.id) <> 210
    or exists (
      select 1 from catalog.asset_release_templates item
      join catalog.asset_objects thumbnail on thumbnail.id = item.thumbnail_object_id
      join catalog.asset_objects detail on detail.id = item.detail_object_id
      where item.release_id = v_target.id and (thumbnail.status <> 'active' or detail.status <> 'active')
    )
  then
    raise exception using errcode = '22023', message = 'asset release is incomplete or no longer rollback-safe';
  end if;
  select * into v_current from catalog.current_asset_release where singleton for update;
  if v_current.release_id <> v_target.id then
    update catalog.asset_releases
    set status = 'retired', retired_at = now(), delete_after = now() + interval '90 days'
    where id = v_current.release_id;
    update catalog.asset_releases
    set status = 'active', retired_at = null, delete_after = null
    where id = v_target.id;
    update catalog.current_asset_release
    set release_id = v_target.id, revision = revision + 1, switched_at = now()
    where singleton
    returning revision into v_current.revision;
  end if;
  v_result := jsonb_build_object(
    'release_key', v_target.release_key,
    'manifest_sha256', v_target.manifest_sha256,
    'revision', v_current.revision,
    'status', 'active'
  );
  insert into catalog.asset_rollback_commands (idempotency_key, release_id, result)
  values (p_idempotency_key, v_target.id, v_result);
  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(), details = v_result
  where id = v_mutation.id;
  return v_result;
end
$$;
