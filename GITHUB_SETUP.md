# GitHub upload and first test

This package is intended for a **new private** repository called `mg-music-studios`. Do not overwrite StoreFlow or the Marianas Grown website.

1. In GitHub, create a private repository named `mg-music-studios` with no starter README.
2. Upload the **contents** of this folder (not the ZIP itself) to that repository. Keep `.env.local`, passwords, and secret keys out of GitHub.
3. On a computer with Node.js, run `npm ci` then `npm run build`.
4. Copy `.env.example` to `.env.local` and replace the placeholder with the **public** publishable/anon key from the existing Supabase project. Never use a `service_role` or secret key.
5. Run `npm run dev` to test sign-in. `?mock=1` intentionally shows demo content. Without configuration, the app shows an explicit warning.
6. Verify the existing project, recordings, artwork, and playback using the owner's authorized account. No live tests were run during packaging.

## Scope

Read-only client code: selects and short-lived signed URLs only. No schema or policy changes; no new Supabase project; no deployment performed.
