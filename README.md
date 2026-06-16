# Roofmaxxers PPSA Command — Dashboard

The teammate-facing web app: live metrics from the data your `roofmaxxers-ingest` backend writes into Supabase.

- **Login** with a Supabase magic link (no password)
- **Performance view** — per-client funnel, margin, KPI bands, "what to fix" flags
- **Team view** — add / promote teammates, toggle Full / Ops-only access
- **Real revenue** from ForceCharge dollars (charges − credits)
- **Auto-refresh** via the Slack + Meta cron jobs already running

## Deploy (one time, ~10 minutes)

1. **Push this folder to a new GitHub repo** (e.g. `roofmaxxers-dashboard`)
2. **Vercel → Add New Project → Import** the repo
   - Framework: **Vite** (auto-detected)
3. **Environment Variables** (Vercel → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = `https://pqvdgpjkrsoyqlodmtny.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
4. **Redeploy** so env vars take effect
5. **Add the custom domain** `dashboard.roofmaxxers.com`:
   - Vercel → Settings → Domains → add the subdomain
   - Vercel shows you the DNS records to add
   - Add the CNAME at your domain registrar (whoever runs roofmaxxers.com DNS)
   - SSL is automatic once DNS resolves

## Promote yourself to Full access (one-time SQL)

After your first login, Supabase auto-creates a profile row with `access='ops'`. Run this in Supabase → SQL Editor → New query to promote yourself:

```sql
update profiles
set role = 'Owner', access = 'full'
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```

Do the same for Rafael with `role = 'Admin / Partner', access = 'full'`.

Everyone else (Daniel, future setters) defaults to `Ops only` — the right level for the role.
