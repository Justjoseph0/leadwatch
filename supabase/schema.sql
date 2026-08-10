-- LeadWatch: leads table
-- Run this in your Supabase SQL editor to set up the schema.

create table if not exists leads (
  id               uuid primary key default gen_random_uuid(),
  domain           text unique not null,
  url              text not null,
  title            text,
  platform         text,
  quality_score    smallint default 0,
  emails           text[] default '{}',
  socials          jsonb default '{}',
  -- true when at least one email or social profile was found
  has_contact      boolean generated always as (
                     (emails <> '{}') or (socials <> '{}')
                   ) stored,
  status           text default 'new' check (status in ('new', 'contacted', 'replied', 'ignored')),
  first_seen_at    timestamptz default now(),
  contacted_at     timestamptz,
  notes            text
);

-- Indexes for the most common filter/sort patterns
create index if not exists leads_status_idx          on leads (status);
create index if not exists leads_platform_idx        on leads (platform);
create index if not exists leads_quality_score_idx   on leads (quality_score desc);
create index if not exists leads_first_seen_at_idx   on leads (first_seen_at desc);

-- Row Level Security (permissive for now — tighten with actual auth policies later)
alter table leads enable row level security;

create policy "Allow all for now"
  on leads
  for all
  using (true)
  with check (true);

-- Alert rules table
create table if not exists alert_rules (
  id            uuid primary key default gen_random_uuid(),
  platform      text,
  min_score     smallint,
  max_score     smallint,
  has_contact   boolean,
  email_to      text not null,  -- where to send the alert
  created_at    timestamptz default now()
);

alter table alert_rules enable row level security;

create policy "Allow all alert_rules for now"
  on alert_rules
  for all
  using (true)
  with check (true);
