-- ============================================================
-- KRF KENYA — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- EXTENSIONS
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS & AUTH
-- ============================================================
create table public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  name text not null,
  initials text,
  role text not null check (role in ('admin','commissioner','referee','linesman','official','player')),
  team_id uuid,
  jersey_number int,
  position text check (position in ('Centre Man','Winger Right','Winger Left','Front Right','Front Left')),
  player_status text check (player_status in ('Amateur','Semi-Professional','Professional')),
  age_category text check (age_category in ('Senior','U-23','U-18','U-16')),
  county text,
  phone text,
  national_id text,
  passport_photo_url text,
  docs_status text default 'incomplete' check (docs_status in ('incomplete','submitted','approved','flagged')),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- TEAMS
-- ============================================================
create table public.teams (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  abbr text not null,
  city text not null,
  color text default '#C8102E',
  bg_color text default '#1a0008',
  logo_url text,
  bio text,
  home_ground text,
  manager_id uuid references public.users(id),
  founded_year int,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table public.users add constraint fk_user_team
  foreign key (team_id) references public.teams(id);

-- ============================================================
-- TOURNAMENTS
-- ============================================================
create table public.tournaments (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  status text default 'upcoming' check (status in ('upcoming','ongoing','completed')),
  start_date date,
  end_date date,
  venue text,
  description text,
  video_trailer_url text,
  gradient text,
  max_teams int default 12,
  rounds int default 11,
  created_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- ============================================================
-- TOURNAMENT TEAMS (junction)
-- ============================================================
create table public.tournament_teams (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  unique(tournament_id, team_id)
);

-- ============================================================
-- MATCHES
-- ============================================================
create table public.matches (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id),
  home_team_id uuid references public.teams(id),
  away_team_id uuid references public.teams(id),
  home_score int default 0,
  away_score int default 0,
  status text default 'upcoming' check (status in ('upcoming','live','completed','abandoned','postponed')),
  current_period int default 1,
  period_time_seconds int default 0,
  venue text,
  match_date timestamptz,
  round_number int,
  referee_id uuid references public.users(id),
  linesman_id uuid references public.users(id),
  commissioner_id uuid references public.users(id),
  score_official_id uuid references public.users(id),
  report_status text default 'pending' check (report_status in ('pending','referee_submitted','linesman_signed','commissioner_countersigned','published')),
  report_locked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- MATCH EVENTS
-- ============================================================
create table public.match_events (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade,
  event_type text not null check (event_type in ('goal','yellow','red_card','foul','sub','injury','boundary','offside','penalty','disputed')),
  minute int,
  period int,
  player_id uuid references public.users(id),
  player_name text,
  team_id uuid references public.teams(id),
  description text,
  logged_by uuid references public.users(id),
  logged_by_role text,
  created_at timestamptz default now()
);

-- ============================================================
-- MATCH REPORTS
-- ============================================================
create table public.match_reports (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) unique,
  referee_id uuid references public.users(id),
  commissioner_id uuid references public.users(id),
  linesman_id uuid references public.users(id),
  narrative text,
  post_match_comments text,
  disciplinary_summary text,
  commissioner_notes text,
  disciplinary_recommendations text,
  result_confirmation text default 'confirmed',
  referee_submitted_at timestamptz,
  linesman_signed_at timestamptz,
  commissioner_countersigned_at timestamptz,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- MATCH INCIDENTS (Commissioner)
-- ============================================================
create table public.match_incidents (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id),
  reported_by uuid references public.users(id),
  incident_type text not null,
  minute int,
  teams_involved text,
  description text not null,
  action_taken text,
  disciplinary_recommendation text,
  severity text check (severity in ('minor','moderate','serious','critical')),
  status text default 'pending' check (status in ('pending','resolved','escalated')),
  created_at timestamptz default now()
);

-- ============================================================
-- PRE-MATCH CHECKLIST
-- ============================================================
create table public.pre_match_checklists (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) unique,
  commissioner_id uuid references public.users(id),
  teams_present boolean default false,
  lineups_verified boolean default false,
  eligibility_confirmed boolean default false,
  venue_inspected boolean default false,
  equipment_checked boolean default false,
  officials_briefed boolean default false,
  medical_standby boolean default false,
  scoreboard_working boolean default false,
  submitted_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- LINEUPS
-- ============================================================
create table public.lineups (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id),
  team_id uuid references public.teams(id),
  player_id uuid references public.users(id),
  position text,
  jersey_number int,
  is_starting boolean default true,
  submitted_by uuid references public.users(id),
  created_at timestamptz default now(),
  unique(match_id, team_id, player_id)
);

-- ============================================================
-- PLAYER STATS
-- ============================================================
create table public.player_stats (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references public.users(id),
  tournament_id uuid references public.tournaments(id),
  season text,
  games_played int default 0,
  goals int default 0,
  assists int default 0,
  yellow_cards int default 0,
  red_cards int default 0,
  updated_at timestamptz default now(),
  unique(player_id, tournament_id)
);

-- ============================================================
-- STANDINGS
-- ============================================================
create table public.standings (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id),
  team_id uuid references public.teams(id),
  played int default 0,
  won int default 0,
  drawn int default 0,
  lost int default 0,
  goals_for int default 0,
  goals_against int default 0,
  points int default 0,
  form text[] default '{}',
  updated_at timestamptz default now(),
  unique(tournament_id, team_id)
);

-- ============================================================
-- DOCUMENTS
-- ============================================================
create table public.documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  doc_type text not null check (doc_type in (
    'national_id','passport_photo','player_status','ministry_form',
    'police_clearance','helb_clearance','eacc_clearance','crb_clearance',
    'tax_compliance','kra_pin','officiating_licence',
    'team_logo','manager_photo','assistant1_photo','assistant2_photo',
    'players_list','contact_emails'
  )),
  file_url text,
  file_name text,
  file_size int,
  status text default 'pending' check (status in ('pending','approved','flagged','expired')),
  admin_note text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  uploaded_at timestamptz default now()
);

-- ============================================================
-- TEAM DOCUMENTS (for team registration)
-- ============================================================
create table public.team_documents (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid references public.teams(id) on delete cascade,
  doc_type text not null,
  file_url text,
  file_name text,
  status text default 'pending' check (status in ('pending','approved','flagged')),
  admin_note text,
  reviewed_by uuid references public.users(id),
  uploaded_at timestamptz default now()
);

-- ============================================================
-- MEDIA (Photos + Videos)
-- ============================================================
create table public.media (
  id uuid primary key default uuid_generate_v4(),
  title text,
  media_type text not null check (media_type in ('photo','video','stream')),
  file_url text not null,
  thumbnail_url text,
  album text,
  match_id uuid references public.matches(id),
  tournament_id uuid references public.tournaments(id),
  team_id uuid references public.teams(id),
  category text check (category in ('match_highlights','full_match','training','interview','gallery','other')),
  visibility text default 'public' check (visibility in ('public','members_only','admin_only')),
  approved boolean default false,
  uploaded_by uuid references public.users(id),
  views int default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- NEWS
-- ============================================================
create table public.news (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  content text,
  tag text,
  featured boolean default false,
  published boolean default false,
  hero_color text default '#C8102E',
  author_id uuid references public.users(id),
  published_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- SPONSORS
-- ============================================================
create table public.sponsors (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  tier text check (tier in ('title','gold','silver','bronze')),
  logo_url text,
  website_url text,
  is_active boolean default true,
  display_order int default 99,
  created_at timestamptz default now()
);

-- ============================================================
-- SITE SETTINGS
-- ============================================================
create table public.site_settings (
  key text primary key,
  value text,
  updated_by uuid references public.users(id),
  updated_at timestamptz default now()
);

-- ============================================================
-- REALTIME — enable for live scoring
-- ============================================================
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_events;
alter publication supabase_realtime add table public.standings;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.documents enable row level security;
alter table public.team_documents enable row level security;
alter table public.match_reports enable row level security;

-- Public read on non-sensitive tables
create policy "Public read matches" on public.matches for select using (true);
create policy "Public read teams" on public.teams for select using (true);
create policy "Public read standings" on public.standings for select using (true);
create policy "Public read tournaments" on public.tournaments for select using (true);
create policy "Public read media" on public.media for select using (approved = true and visibility = 'public');
create policy "Public read news" on public.news for select using (published = true);
create policy "Public read sponsors" on public.sponsors for select using (is_active = true);
create policy "Public read player_stats" on public.player_stats for select using (true);

-- Users can read their own data
create policy "Users read own profile" on public.users for select using (auth.uid() = id);
create policy "Users update own profile" on public.users for update using (auth.uid() = id);
create policy "Users read own docs" on public.documents for select using (auth.uid() = user_id);
create policy "Users insert own docs" on public.documents for insert with check (auth.uid() = user_id);

-- ============================================================
-- SEED: Site settings defaults
-- ============================================================
insert into public.site_settings (key, value) values
  ('hero_video_url', ''),
  ('hero_wallpaper_url', ''),
  ('ticker_message', 'Welcome to Kenya Rollball Federation — Official Site'),
  ('season_label', 'KPL Season 2025'),
  ('site_title', 'Kenya Rollball Federation'),
  ('facebook_url', 'https://facebook.com/kenyarollball'),
  ('instagram_url', 'https://instagram.com/kenyarollball'),
  ('youtube_url', 'https://youtube.com/@kenyarollball'),
  ('twitter_url', 'https://x.com/KenyaRollball'),
  ('tiktok_url', 'https://tiktok.com/@krfkenya');
