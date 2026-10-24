-- =====================================================================
-- VibeVibe Memory Wall: Supabase setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run again: it updates functions and policies in place.
-- =====================================================================

-- ---------- 1. Memories table ----------
create table if not exists public.memories (
  id            uuid primary key default gen_random_uuid(),
  cell_id       integer not null unique check (cell_id between 1 and 10000),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  x_username    text check (x_username is null or x_username ~ '^[A-Za-z0-9_]{1,15}$'),
  message       text not null check (char_length(message) between 1 and 280),
  image_path    text check (image_path is null or image_path ~ '^full/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  thumb_path    text check (thumb_path is null or thumb_path ~ '^thumb/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  created_at    timestamptz not null default now(),
  report_count  integer not null default 0,
  hidden        boolean not null default false,
  ip_hash       text
);
-- The UNIQUE constraint on cell_id is what guarantees a cell can never be
-- claimed twice, even if two people press "Save" at the same moment.

create index if not exists memories_ip_time_idx on public.memories (ip_hash, created_at);

-- ---------- 2. Reports table (moderation) ----------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  memory_id   uuid not null references public.memories(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 200),
  ip_hash     text not null,
  created_at  timestamptz not null default now(),
  unique (memory_id, ip_hash)
);
create index if not exists reports_ip_time_idx on public.reports (ip_hash, created_at);

-- ---------- 3. Row Level Security ----------
-- Visitors can only READ visible memories, and only the public columns.
-- They can never insert, update or delete rows directly; every write goes
-- through the checked functions below.
alter table public.memories enable row level security;
alter table public.reports  enable row level security;

revoke all on public.memories from anon, authenticated;
revoke all on public.reports  from anon, authenticated;
grant select (cell_id, display_name, x_username, message, image_path, thumb_path, created_at)
  on public.memories to anon, authenticated;

drop policy if exists "public can read visible memories" on public.memories;
create policy "public can read visible memories" on public.memories
  for select to anon, authenticated using (hidden = false);
-- (No policies on reports: visitors cannot read or write it directly.)

-- ---------- 4. Helper: anonymous visitor fingerprint for rate limits ----------
create or replace function public.vw_ip_hash() returns text
language sql stable set search_path = public, pg_temp as $$
  select md5('vibewall:' || coalesce(
    nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''),
    'unknown'));
$$;

-- ---------- 5. Claim a cell (the only way to add a memory) ----------
create or replace function public.claim_cell(
  p_cell integer, p_name text, p_x text, p_message text,
  p_image text default null, p_thumb text default null)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text; v_x text; v_msg text;
  v_ip   text := public.vw_ip_hash();
  v_row  public.memories;
begin
  if p_cell is null or p_cell < 1 or p_cell > 10000 then
    return json_build_object('ok', false, 'error', 'invalid_cell');
  end if;

  -- sanitize: strip control characters (newlines are allowed in messages)
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v_msg  := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'));
  v_x    := nullif(btrim(regexp_replace(coalesce(p_x, ''), '^\s*@', '')), '');

  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    return json_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if char_length(v_msg) < 1 or char_length(v_msg) > 280 then
    return json_build_object('ok', false, 'error', 'invalid_message');
  end if;
  if v_x is not null and v_x !~ '^[A-Za-z0-9_]{1,15}$' then
    return json_build_object('ok', false, 'error', 'invalid_x');
  end if;

  -- image: both paths or neither, correct format, and the files must really exist
  if (p_image is null) <> (p_thumb is null) then
    return json_build_object('ok', false, 'error', 'invalid_image');
  end if;
  if p_image is not null then
    if p_image !~ '^full/[0-9a-f-]{36}\.(webp|jpg|png)$'
       or p_thumb !~ '^thumb/[0-9a-f-]{36}\.(webp|jpg|png)$'
       or not exists (select 1 from storage.objects where bucket_id = 'memory-images' and name = p_image)
       or not exists (select 1 from storage.objects where bucket_id = 'memory-images' and name = p_thumb) then
      return json_build_object('ok', false, 'error', 'invalid_image');
    end if;
  end if;

  -- anti-spam: max 3 memories per 10 minutes and 20 per day per visitor
  if (select count(*) from public.memories where ip_hash = v_ip and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.memories where ip_hash = v_ip and created_at > now() - interval '1 day') >= 20 then
    return json_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.memories (cell_id, display_name, x_username, message, image_path, thumb_path, ip_hash)
  values (p_cell, v_name, v_x, v_msg, p_image, p_thumb, v_ip)
  on conflict (cell_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    return json_build_object('ok', false, 'error', 'taken');
  end if;

  return json_build_object('ok', true, 'memory', json_build_object(
    'cell_id', v_row.cell_id, 'display_name', v_row.display_name, 'x_username', v_row.x_username,
    'message', v_row.message, 'image_path', v_row.image_path, 'thumb_path', v_row.thumb_path,
    'created_at', v_row.created_at));
end $$;

-- ---------- 6. Whole-wall overview (one small request for all 10,000 cells) ----------
create or replace function public.get_wall() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_array(cell_id, case when hidden then null else thumb_path end, hidden)
                           order by cell_id), '[]'::json)
  from public.memories;
$$;

-- ---------- 7. Search by display name or X username ----------
create or replace function public.search_memories(q text) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(q, ''));
begin
  v := regexp_replace(v, '^@', '');
  if char_length(v) < 1 or char_length(v) > 40 then return '[]'::json; end if;
  v := replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_');
  return (
    select coalesce(json_agg(row_to_json(s)), '[]'::json) from (
      select cell_id, display_name, x_username, thumb_path
      from public.memories
      where hidden = false and (display_name ilike '%' || v || '%' or x_username ilike '%' || v || '%')
      order by cell_id limit 50) s);
end $$;

-- ---------- 8. Report a memory ----------
-- 3 reports from different visitors hide a memory automatically.
create or replace function public.report_memory(p_cell integer, p_reason text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_n integer;
  v_ip text := public.vw_ip_hash();
  v_reason text := left(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), 200);
begin
  if v_reason = '' then v_reason := 'unspecified'; end if;
  select id into v_id from public.memories where cell_id = p_cell and hidden = false;
  if v_id is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if (select count(*) from public.reports where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 10 then
    return json_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.reports (memory_id, reason, ip_hash) values (v_id, v_reason, v_ip)
  on conflict (memory_id, ip_hash) do nothing;
  select count(*) into v_n from public.reports where memory_id = v_id;
  update public.memories set report_count = v_n, hidden = hidden or v_n >= 3 where id = v_id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.claim_cell(integer, text, text, text, text, text) from public;
revoke all on function public.get_wall() from public;
revoke all on function public.search_memories(text) from public;
revoke all on function public.report_memory(integer, text) from public;
grant execute on function public.claim_cell(integer, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_wall() to anon, authenticated;
grant execute on function public.search_memories(text) to anon, authenticated;
grant execute on function public.report_memory(integer, text) to anon, authenticated;

-- ---------- 9. Image storage ----------
-- Public bucket: anyone can view images; uploads are limited to 5 MB
-- JPEG/PNG/WebP with random file names. Nobody can overwrite or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-images', 'memory-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vibewall upload images" on storage.objects;
create policy "vibewall upload images" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'memory-images'
              and name ~ '^(full|thumb)/[0-9a-f-]{36}\.(webp|jpg|png)$');

-- Done. Moderation: see README.md ("Moderation").
