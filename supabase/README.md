# Supabase setup

The hosted workspace uses [project fgqtdanfagdfdevpaase](https://supabase.com/dashboard/project/fgqtdanfagdfdevpaase). Both repository migrations were applied on October 10, 2026, as `tournament_app_schema` and `tournament_app_operations`. All five app tables have row security enabled; anonymous requests are denied table access. The Vercel production environment contains the project's URL and publishable browser key. Do not rerun the initial migrations on this project.

The following instructions also work for a separate installation.

Create a Supabase project and enable the Email provider. Disable public sign-ups; the organizer creates the small set of admin and scorekeeper accounts in Supabase Auth.

Run `migrations/001_schema.sql`, then `migrations/002_operations.sql`, in the Supabase SQL Editor. They create the five app tables, row policies and checked database operations. Apply them to a test project first; do not run the PGlite smoke against a live event.

After creating each Auth user, copy its UUID from the Auth users page and provision its app role in the SQL Editor:

For accounts created manually, enable **Auto Confirm User** when adding them. The user should choose their password in Supabase; passwords are never stored in this repository. A Supabase dashboard account is separate from an app Auth account.

```sql
insert into public.profiles (id, display_name, role)
values ('<auth-user-uuid>', 'Organizer', 'admin');
```

Use `scorekeeper` for phone score-entry accounts. Profiles are not self-editable, and only the admin role can use roster, payment and setup operations.

Copy `.env.example` to `.env.local`, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings. The publishable key is intended for the browser; never put a service-role key in Vite or commit project credentials.

The in-repo PGlite test runs the migrations with a test-only Auth shim and synthetic users. It checks a small RLS and tournament-operation flow; it does not verify permissions against a hosted Supabase project.
