# Committee Tape

A self-serve, shared song library. Members pick an mp3 from their device
and upload it themselves — it shows up in the shared tape for everyone,
with no git commits and no redeploy.

- `songs` table in Supabase Postgres — the source of truth for the feed.
- `songs` bucket in Supabase Storage — holds the uploaded mp3 files.
- `index.html` — the page (uploader panel + player).
- `player.js` — loads the feed from Supabase and plays tracks; subscribes
  to realtime inserts so new uploads appear live.
- `upload.js` — file picker, validation, storage upload, DB insert.
- `supabase.js` — the single shared Supabase client (used by everything).
- `supabase-config.js` — where `SUPABASE_URL` / `SUPABASE_ANON_KEY` live.

## Supabase setup

Create a project at https://supabase.com (free tier is fine), then:

### 1. Database table (`songs`)

Run this in the Supabase Dashboard → SQL Editor:

```sql
create table songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  storage_path text not null,
  added_by text not null,
  added_at timestamptz default now()
);

alter table songs enable row level security;

-- permissive, no auth in this app (same pattern as the rest of the project)
create policy "songs select for anon" on songs
  for select to anon
  using (true);

create policy "songs insert for anon" on songs
  for insert to anon
  with check (true);
```

`storage_path` stores the resolved public Storage URL for the uploaded
mp3. `added_by` is the uploader's display name (captured in the uploader
panel and remembered in localStorage).

### 2. Storage bucket (`songs`)

The `songs` bucket must be created **public** — do this in the Dashboard
(Storage → New bucket → name it `songs` → check "Public bucket"). Bucket
creation isn't available through the SQL Editor.

Then allow anonymous uploads into it (the default Storage RLS only lets
anon *read* public buckets — without this, uploads fail with a
row-level-security error). Run in the SQL Editor:

```sql
create policy "anon can upload to songs bucket" on storage.objects
  for insert to anon
  with check (bucket_id = 'songs');

create policy "anon can read songs bucket" on storage.objects
  for select to anon
  using (bucket_id = 'songs');
```

### 3. Realtime (for live updates)

Enable realtime on the `songs` table: Dashboard → Database → Replication
→ in the `supabase_realtime` publication, toggle on the `songs` table.
Without this, uploads still work but only appear after a refresh.

## Config

The app needs your Supabase project's URL and anon key. The real values
live in `supabase-config.js`, which is **git-ignored** — a committed
template (`supabase-config.example.js`) shows the expected shape.

1. If you're on a fresh clone: copy the template to your real file:
   `cp supabase-config.example.js supabase-config.js`
2. Grab the values from Supabase Dashboard → Settings → API.
3. Paste them into `supabase-config.js`.

Notes:

- There is **no build step** and no server, so `.env` files don't work —
  the browser can't read them. The JS config file *is* the mechanism. If
  a build pipeline is added later, `supabase-config.js` is the single
  place env-style values flow in.
- The anon/publishable key is **public by design** and safe to expose in
  the browser — the RLS policies above are what actually guard access.
  Never put your `service_role` / secret key in this file.

## Uploading a song

Open the site, click **+ ADD A SONG** above the player:

1. Pick an mp3 (audio only, max 15MB).
2. Optionally set Title / Artist (Title falls back to the filename if
   blank).
3. Your name is filled in from last time (used as `added_by`) — edit it
   if you're on a shared machine.
4. Hit **Upload**. It disables itself while uploading, and shows either
   a success message or a clear inline error.

New uploads appear at the front of the tape for everyone, live.
