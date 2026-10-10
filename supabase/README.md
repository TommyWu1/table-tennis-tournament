# Supabase setup

Create a Supabase project and enable the Email provider. Disable public sign-ups; the organizer creates the small set of admin and scorekeeper accounts in Supabase Auth.

Run `migrations/001_schema.sql`, then `migrations/002_operations.sql`, in the Supabase SQL Editor. They create the five app tables, row policies and checked database operations. Apply them to a test project first; do not run the PGlite smoke against a live event.

After creating each Auth user, copy its UUID from the Auth users page and provision its app role in the SQL Editor:

```sql
insert into public.profiles (id, display_name, role)
values ('<auth-user-uuid>', 'Organizer', 'admin');
```

Use `scorekeeper` for phone score-entry accounts. Profiles are not self-editable, and only the admin role can use roster, payment and setup operations.

Copy `.env.example` to `.env.local`, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings. The publishable key is intended for the browser; never put a service-role key in Vite or commit project credentials.

The in-repo PGlite test runs the migrations with a test-only Auth shim and synthetic users. It checks a small RLS and tournament-operation flow; it does not verify permissions against a hosted Supabase project.
