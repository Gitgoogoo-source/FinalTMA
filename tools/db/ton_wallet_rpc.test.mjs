import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
// Run only against a disposable local database; identity/operation helpers are test doubles.
const { default: pg } = await import(process.env.WALLET_TEST_PG_MODULE ?? "pg");
const config = {
  host: "127.0.0.1",
  port: Number(process.env.WALLET_TEST_PORT ?? 55439),
  user: "postgres",
  database: "wallet_rpc_test",
};
const db = new pg.Client(config);
await db.connect();
await db.query(`create schema extensions; create schema identity; create schema api; create schema onchain; create schema operations; create schema tasks;
create table identity.users(id uuid primary key);
create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
create function api.session_user(uuid) returns uuid language sql as 'select $1';
create function api.raise_business_error(text,text) returns void language plpgsql as $$begin raise exception '%', $1; end;$$;
create table operations.operations(id uuid primary key, user_id uuid,use_case text, request jsonb, status text,result jsonb,error_code text);
create function operations.begin_command(uuid,text,uuid,jsonb) returns operations.operations language plpgsql as $$declare o operations.operations;begin
perform pg_advisory_xact_lock(hashtextextended($3::text,0));
select * into o from operations.operations where id=$3;
if o.id is not null then if o.user_id<>$1 or o.use_case<>$2 or o.request<>$4 then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return o; end if;
insert into operations.operations values($3,$1,$2,$4,'pending',null,null) returning * into o;return o;end;$$;
create function operations.replay_if_finished(operations.operations) returns jsonb language sql as $$select case when $1.status in ('succeeded','failed') then to_jsonb($1) else null end$$;
create function operations.complete_command(uuid,jsonb) returns jsonb language plpgsql as $$declare o operations.operations;begin update operations.operations set status='succeeded',result=$2 where id=$1 returning * into o;return to_jsonb(o);end;$$;
create function operations.fail_command(uuid,text,jsonb) returns jsonb language plpgsql as $$declare o operations.operations;begin update operations.operations set status='failed',error_code=$2 where id=$1 returning * into o;return to_jsonb(o);end;$$;
create table tasks.progress_log(user_id uuid, event text);
create function tasks.progress(uuid,text) returns void language sql as $$insert into tasks.progress_log values($1,$2)$$;
create table onchain.mints(user_id uuid,status text);`);
const root = new URL("../../", import.meta.url).pathname;
await db.query(readFileSync(root + "/supabase/schemas/70_wallet.sql", "utf8"));
// Apply forward migration too, proving it runs over existing definitions.
await db.query(
  readFileSync(
    root + "/supabase/migrations/20260910125845_enable_verified_ton_wallet.sql",
    "utf8",
  ),
);
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID();
await db.query("insert into identity.users values($1),($2),($3)", [a, b, c]);
async function nonce(user, client = db, expiry = "5 minutes") {
  const payload = randomUUID();
  await client.query(
    `select api.wallet_create_challenge($1,$2,now()+$3::interval)`,
    [user, payload, expiry],
  );
  return payload;
}
async function verify(
  user,
  address,
  challenge,
  client = db,
  operation = randomUUID(),
) {
  const r = await client.query(
    `select api.wallet_save_verified($1,$2,$3,$4,'mainnet','Test Wallet','public-key') as result`,
    [user, operation, challenge, address],
  );
  return r.rows[0].result;
}
const address = "0:" + "a".repeat(64),
  challenge = await nonce(a),
  op = randomUUID();
const first = await verify(a, address, challenge, db, op);
assert.equal(first.status, "succeeded");
assert.deepEqual(await verify(a, address, challenge, db, op), first);
assert.equal(
  (await db.query("select count(*)::int n from tasks.progress_log")).rows[0].n,
  1,
);
assert.equal(
  (await verify(a, address, challenge)).error_code,
  "WALLET_CHALLENGE_INVALID",
);
assert.equal(
  (await verify(b, address, await nonce(b))).error_code,
  "WALLET_ADDRESS_IN_USE",
);
await db.query("select api.wallet_disconnect($1,$2)", [a, randomUUID()]);
assert.equal(
  (await verify(b, address, await nonce(b))).error_code,
  "WALLET_ADDRESS_IN_USE",
);
assert.equal(
  (
    await db.query(
      "select status,user_id from onchain.wallets where address=$1",
      [address],
    )
  ).rows[0].user_id,
  a,
);
assert.equal((await verify(a, address, await nonce(a))).status, "succeeded");
assert.equal(
  (await verify(b, "0:" + "b".repeat(64), await nonce(b, db, "-1 second")))
    .error_code,
  "WALLET_CHALLENGE_INVALID",
);
const db2 = new pg.Client(config);
await db2.connect();
const shared = "0:" + "c".repeat(64),
  nb = await nonce(b),
  nc = await nonce(c);
const race = await Promise.all([
  verify(b, shared, nb, db),
  verify(c, shared, nc, db2),
]);
assert.equal(race.filter((x) => x.status === "succeeded").length, 1);
assert.equal(
  race.filter((x) => x.error_code === "WALLET_ADDRESS_IN_USE").length,
  1,
);
const n1 = await nonce(a),
  n2 = await nonce(a);
const sameUser = await Promise.all([
  verify(a, "0:" + "d".repeat(64), n1, db),
  verify(a, "0:" + "e".repeat(64), n2, db2),
]);
assert.ok(sameUser.every((x) => x.status === "succeeded"));
assert.equal(
  (
    await db.query(
      "select count(*)::int n from onchain.wallets where user_id=$1 and status='verified'",
      [a],
    )
  ).rows[0].n,
  1,
);
await db2.end();
await db.end();
console.log(
  "PASS: wallet RPC migration, binding, idempotent replay, nonce replay/expiry, foreign active/disconnected address rejection, cross-account race, same-account race. Dependencies are isolated test doubles.",
);
