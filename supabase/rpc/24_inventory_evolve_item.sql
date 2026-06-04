-- Deprecated standalone RPC file.
-- Current inventory evolution is managed by versioned migrations. Keep this
-- file from recreating the removed three-argument public RPC overload.

drop function if exists api.inventory_evolve_item(uuid, uuid[], text);
