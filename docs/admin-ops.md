# Admin Ops

## Bootstrap Super Admin

Use the existing root script:

```bash
pnpm ops:create-admin -- --dry-run
pnpm ops:create-admin
```

`ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS` is a comma-separated list of Telegram user
ids used only by `scripts/create-admin.ts` to create or refresh bootstrap
admins. It is not a runtime permission source.

Bootstrap behavior:

- The script reads `ops.admin_roles.code = 'SUPER_ADMIN'`; it fails if the role
  does not already exist.
- The script upserts `ops.admin_users` by `telegram_user_id`, sets
  `status = 'active'`, and grants `ops.admin_user_roles`.
- The script writes `ops.admin_audit_logs` with
  `action = 'admin.bootstrap_super_admin'`.
- After bootstrap, Admin permission checks are handled by `requireAdmin`, which
  reads `ops.admin_users`, `ops.admin_user_roles`, and `ops.admin_roles`.

Do not commit real Telegram user ids. Configure real values in Vercel
Environment Variables for Preview and Production before running the script
there. After the needed admin rows exist in `ops.admin_users`, clear
`ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS` from long-lived environments unless another
controlled bootstrap run is planned.

For staging-only one-person checks:

```bash
pnpm ops:create-admin -- --dry-run --telegram-user-id=123456789
```

Production bootstrap requires `ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS` to be present
in the environment, even when a CLI `--telegram-user-id` is provided.
