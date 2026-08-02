-- Run this in Supabase SQL Editor (one time)

create table if not exists public.publications (
  id uuid primary key,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pdf_path text not null,
  thumb_path text,
  pdf_filename text not null default ''
);

create index if not exists idx_publications_created_at
  on public.publications (created_at desc);

create table if not exists public.login_attempts (
  ip text primary key,
  fail_count integer not null default 0,
  window_start timestamptz not null,
  locked_until timestamptz
);

create table if not exists public.csrf_tokens (
  token text primary key,
  session_id text not null,
  expires_at timestamptz not null
);

-- Storage bucket policies are configured in Dashboard (public read).
