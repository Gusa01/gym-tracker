# Fit Tracker

A fitness tracking app built with Expo (React Native) and Supabase.

## Setup

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the six values:

   | Variable | Where to find it |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase dashboard → your project → Settings → API |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → your project → Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → your project → Settings → API (server/test-only — never prefix with `EXPO_PUBLIC_`, must never ship in the app bundle) |
   | `SUPABASE_PROJECT_REF` | Supabase dashboard → your project → Settings → General |
   | `SUPABASE_DB_PASSWORD` | The database password you set when you created the project (reset it from Settings → Database if you don't have it) |
   | `SUPABASE_ACCESS_TOKEN` | A personal access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |

   `.env.local` is gitignored and must never be committed.

3. **Turn off "Confirm email"**: in the Supabase dashboard, go to **Authentication → Providers → Email** and disable **Confirm email**. This is required for sign-up/sign-in to work as implemented. It is **not** controlled by any file in this repo — the local `supabase/config.toml`'s `enable_confirmations = false` only applies to a local Supabase stack (`supabase start`), and this project targets a hosted project instead, so that setting is inert here. `supabase db push` (see Migrations below) never pushes auth settings, so this must be done manually in the dashboard for every hosted project.

## Linking

Link the local project to your hosted Supabase project so the CLI can push migrations to it. Source `.env.local` into your shell first so the variables are available:

```bash
# from the repo root, with .env.local's variables loaded into your shell
npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
```

## Running

- Start the app: `npx expo start`
- Run the test suite: `npm test`

  The Jest suite hits the live hosted Supabase project referenced in `.env.local` — it does not run against a local/Dockerized database. Make sure `.env.local` is filled in before running tests.

## Migrations

This project uses a hosted Supabase project, not a local Docker-based Supabase stack. Migrations live in `supabase/migrations/` and are applied with:

```bash
npx supabase db push
```

`db push` is **forward-only**: it applies any migration files that haven't been applied yet, but unlike `supabase db reset` it does not wipe and reapply everything from scratch, and it does not roll anything back.

- Never edit an already-applied migration file — create a new one instead:

  ```bash
  npx supabase migration new <name>
  ```

- Then edit the generated file under `supabase/migrations/` and run `npx supabase db push` again.
