# MG Music Studios

Marianas Grown Productions' virtual recording studio. **Milestone 1: read-only Studio Lobby.**

Sign in, see your music projects, open one, see its recordings and artwork, select a WAV and play it from private Supabase storage.

## Safety rules for this app
- Uses the existing Supabase project `kboglwjaeapuoibxvtfa` (MGP Creative Studio). Never create another.
- Browser code uses only the public publishable/anon key. **Never a service-role key.**
- Read-only: only `select` queries and signed URLs. No insert/update/delete/upload.
- Private bucket `mgp-assets` is accessed with short-lived signed URLs. Storage and table RLS policies decide access.

## Run locally
```bash
cp .env.example .env.local   # then fill in the publishable key
npm install
npm run dev                  # http://localhost:5173
```
Add `?mock=1` to the address to see clearly labelled demo data with no Supabase connection.

## Next rooms
Mixing, AI Producer, Mastering, Production, Story Drop and Release Manager, in that order of the directive.
