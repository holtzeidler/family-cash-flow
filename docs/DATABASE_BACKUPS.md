# Database backups

Neon stays the primary database. Every night a Render cron job copies production Neon into a separate Render Postgres database. Everything runs on Render; nothing depends on a laptop.

| | |
|---|---|
| **Cron job** | `family-cash-flow-db-backup`, daily at 08:30 UTC (3:30 AM Central) |
| **Backup database** | Render Postgres `family-cash-flow-db-backup` (paid `0.1c-256mb`, 5 GB disk, internal connections only) |
| **Code** | `backend/db_backup/backup.py`, image `backend/db_backup/Dockerfile` |

## What you get

1. **A live mirror.** The `public` schema of the backup database holds a full copy of production as of the last run. Every night the job restores the dump into it, so the restore path is exercised daily.
2. **30 days of dated dumps.** `backup_archive.dumps` keeps every nightly dump from the last 30 days, plus the oldest dump of each of the last 12 months.
3. **Render point-in-time recovery** on the backup database itself (3 days on the Hobby workspace plan, 7 on Pro).
4. **Neon's own restore window** on the primary, unchanged.

The job only reads Neon. If `users`, `families`, or `transactions` drop below half of what the mirror holds, it archives the dump but does not overwrite the mirror, and the run fails so Render alerts you.

## One-time setup (Render dashboard)

1. Sync the Blueprint. It creates the `family-cash-flow-db-backup` database and cron job.
2. On the cron job → **Environment**, set `SOURCE_DATABASE_URL` to the production Neon URL. It is the same value as `DATABASE_URL` on `family-cash-flow-api` (host `ep-ancient-union-…`). The job switches to Neon's direct endpoint for `pg_dump` on its own.
3. Workspace **Settings → Notifications**: make sure failed cron runs email you.
4. Click **Trigger Run** on the cron job. The log should end with `Mirror refreshed; counts now {...}`, and the counts should match production.

## Checking backups

Open the cron job's **Logs**. Each run logs Neon's row counts, the dump size, the archive id, and the mirror's row counts after the restore.

To list archived dumps, connect with the **PSQL Command** from the backup database's Info page (needs `psql` and an allow-list entry for your IP) and run:

```sql
SELECT id, created_at, size_bytes, source_counts, mirror_restored_at
FROM backup_archive.dumps ORDER BY created_at DESC;
```

## Recovery

### Neon is down

1. **Suspend** the `family-cash-flow-db-backup` cron. Otherwise, once Neon returns, the next run overwrites the mirror and you lose writes made during the outage.
2. On `family-cash-flow-api` → **Environment**, set `DATABASE_URL` to the backup database's **Internal Database URL**. If the API is in a different Render region than the database, use the **External Database URL** and add the API's outbound IPs under the database's **Networking** allow list (it allows internal connections only by default).
3. Production now runs on Render. When Neon is back, copy the Render database into Neon before pointing `DATABASE_URL` back, then resume the cron.

### Neon data is corrupted or deleted

- **Within Neon's restore window:** use Neon's own branch restore. It keeps the most recent data.
- **Older, or Neon cannot restore:** the mirror holds last night's copy. If the bad data already reached the mirror, use the backup database's **Recovery → Point-in-Time Recovery** for up to 3 days back. For anything older, restore a row from `backup_archive.dumps` with `pg_restore`. There is no one-click job for that yet.

### A sharp shrink stopped the mirror refresh

The run failed with `Mirror not refreshed; Neon shrank sharply`. Check production first. If the drop is expected (for example, test accounts were cleaned up), set `FORCE_MIRROR_REFRESH=1` on the cron, trigger one run, then delete the variable.

## Cost

The backup database is a paid Render Postgres instance billed separately from web services. The cron job uses the `starter` plan and runs for a minute or two a night.
