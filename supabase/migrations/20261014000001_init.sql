-- QueryQuest v1 schema.
-- Tier/chapter/challenge definitions live in version-controlled content files, so their
-- ids are plain text here (no FKs). Only app data lives in Postgres, never learner SQL.
--
-- Security model:
--   * RLS is enabled on every table.
--   * Signed-in users can SELECT their own rows, and UPDATE only display_name/timezone
--     on their own profile. They cannot write XP, completions, achievements, hints or
--     attempts at all.
--   * All game writes go through server-side code with the service role key, and XP is
--     awarded only by public.award_challenge(), which anon/authenticated cannot execute.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  timezone text not null default 'Asia/Jakarta' check (public.is_valid_timezone(timezone)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  challenges_completed integer not null default 0 check (challenges_completed >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_completion_date date,
  updated_at timestamptz not null default now()
);

create table public.challenge_completions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id text not null,
  chapter_id text not null,
  tier_id text not null,
  xp_awarded integer not null check (xp_awarded >= 0),
  hints_used integer not null default 0 check (hints_used between 0 and 3),
  completed_at timestamptz not null default now(),
  -- Each challenge can be completed (and rewarded) once per user.
  constraint challenge_completions_user_challenge_key unique (user_id, challenge_id)
);
create index challenge_completions_user_completed_at_idx on public.challenge_completions (user_id, completed_at desc);
create index challenge_completions_user_chapter_idx on public.challenge_completions (user_id, chapter_id);

create table public.xp_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount > 0),
  source_type text not null check (source_type in ('challenge', 'chapter_bonus', 'tier_bonus')),
  source_id text not null,
  created_at timestamptz not null default now(),
  -- Challenge XP and chapter/tier bonuses are each awarded at most once.
  constraint xp_transactions_user_source_key unique (user_id, source_type, source_id)
);
create index xp_transactions_user_created_at_idx on public.xp_transactions (user_id, created_at desc);

create table public.achievements (
  id text primary key,
  name text not null,
  description text not null,
  requirement text not null,
  icon text not null,
  sort_order integer not null default 0
);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table public.hint_usages (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id text not null,
  hint_index integer not null check (hint_index between 0 and 2),
  revealed_at timestamptz not null default now(),
  primary key (user_id, challenge_id, hint_index)
);

create table public.challenge_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id text not null,
  passed boolean not null,
  feedback_code text,
  created_at timestamptz not null default now()
);
create index challenge_attempts_user_challenge_idx on public.challenge_attempts (user_id, challenge_id, created_at);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger player_stats_set_updated_at before update on public.player_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New users get a profile and a stats row
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_tz text := new.raw_user_meta_data ->> 'timezone';
begin
  insert into public.profiles (id, display_name, timezone)
  values (
    new.id,
    nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 50), ''),
    case when requested_tz is not null and public.is_valid_timezone(requested_tz) then requested_tz else 'Asia/Jakarta' end
  );
  insert into public.player_stats (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.challenge_completions enable row level security;
alter table public.xp_transactions enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.hint_usages enable row level security;
alter table public.challenge_attempts enable row level security;

create policy "Users read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users read own stats" on public.player_stats
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own completions" on public.challenge_completions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own xp" on public.xp_transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own achievements" on public.user_achievements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own hint usage" on public.hint_usages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own attempts" on public.challenge_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Achievement catalogue is public" on public.achievements
  for select to anon, authenticated using (true);

-- Defence in depth on top of RLS: Supabase grants table privileges to anon/authenticated
-- by default. Take away every write privilege, then give back only what is needed.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on public.profiles, public.player_stats, public.challenge_completions, public.xp_transactions,
  public.user_achievements, public.hint_usages, public.challenge_attempts from anon;
grant update (display_name, timezone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- award_challenge: the only way XP is ever granted
-- ---------------------------------------------------------------------------
-- Called by the Next.js server (service role) after the server has validated a
-- submission against the challenge's expected result. Chapter/tier membership,
-- XP amounts and the JOIN chapter id come from server-side content files, never
-- from the browser.
--
-- Runs in a single transaction and is idempotent: a second call for the same
-- (user, challenge) awards nothing.

create or replace function public.award_challenge(
  p_user_id uuid,
  p_challenge_id text,
  p_chapter_id text,
  p_tier_id text,
  p_xp integer,
  p_chapter_challenge_ids text[],
  p_chapter_bonus integer,
  p_tier_challenge_ids text[],
  p_tier_bonus integer,
  p_join_chapter_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_hints integer;
  v_inserted integer;
  v_xp_gained integer := 0;
  v_chapter_completed boolean := false;
  v_tier_completed boolean := false;
  v_new_achievements text[] := '{}';
  v_recent timestamptz[];
  v_stats public.player_stats%rowtype;
begin
  if p_xp < 0 or p_chapter_bonus < 0 or p_tier_bonus < 0 then
    raise exception 'XP amounts must not be negative';
  end if;
  if not (p_challenge_id = any (p_chapter_challenge_ids)) or not (p_challenge_id = any (p_tier_challenge_ids)) then
    raise exception 'Challenge % is not part of the given chapter/tier', p_challenge_id;
  end if;

  -- Serialise awards per user so concurrent submissions cannot both miss (or both
  -- award) a chapter/tier bonus.
  select * into v_stats from public.player_stats where user_id = p_user_id for update;
  if not found then
    raise exception 'Unknown user %', p_user_id;
  end if;

  select count(*) into v_hints
  from public.hint_usages where user_id = p_user_id and challenge_id = p_challenge_id;

  insert into public.challenge_completions (user_id, challenge_id, chapter_id, tier_id, xp_awarded, hints_used)
  values (p_user_id, p_challenge_id, p_chapter_id, p_tier_id, p_xp, least(v_hints, 3))
  on conflict (user_id, challenge_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'alreadyCompleted', true, 'xpGained', 0, 'chapterCompleted', false, 'tierCompleted', false,
      'newAchievements', '[]'::jsonb, 'totalXp', v_stats.total_xp, 'currentStreak', v_stats.current_streak
    );
  end if;

  if p_xp > 0 then
    insert into public.xp_transactions (user_id, amount, source_type, source_id)
    values (p_user_id, p_xp, 'challenge', p_challenge_id);
    v_xp_gained := p_xp;
  end if;

  -- Chapter bonus once every challenge of the chapter is completed.
  if not exists (
    select 1 from unnest(p_chapter_challenge_ids) as c(id)
    where not exists (select 1 from public.challenge_completions cc where cc.user_id = p_user_id and cc.challenge_id = c.id)
  ) then
    v_chapter_completed := true;
    if p_chapter_bonus > 0 then
      insert into public.xp_transactions (user_id, amount, source_type, source_id)
      values (p_user_id, p_chapter_bonus, 'chapter_bonus', p_chapter_id)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_xp_gained := v_xp_gained + p_chapter_bonus * v_inserted;
    end if;
  end if;

  -- Tier bonus once every challenge of the tier is completed.
  if v_chapter_completed and not exists (
    select 1 from unnest(p_tier_challenge_ids) as c(id)
    where not exists (select 1 from public.challenge_completions cc where cc.user_id = p_user_id and cc.challenge_id = c.id)
  ) then
    v_tier_completed := true;
    if p_tier_bonus > 0 then
      insert into public.xp_transactions (user_id, amount, source_type, source_id)
      values (p_user_id, p_tier_bonus, 'tier_bonus', p_tier_id)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_xp_gained := v_xp_gained + p_tier_bonus * v_inserted;
    end if;
  end if;

  -- Daily streak in the user's own timezone.
  select timezone into v_tz from public.profiles where id = p_user_id;
  v_today := (now() at time zone coalesce(v_tz, 'Asia/Jakarta'))::date;

  update public.player_stats s set
    total_xp = s.total_xp + v_xp_gained,
    challenges_completed = s.challenges_completed + 1,
    current_streak = case
      when s.last_completion_date = v_today then s.current_streak
      when s.last_completion_date = v_today - 1 then s.current_streak + 1
      else 1
    end,
    last_completion_date = v_today
  where s.user_id = p_user_id
  returning * into v_stats;

  update public.player_stats set longest_streak = greatest(longest_streak, current_streak)
  where user_id = p_user_id
  returning * into v_stats;

  -- Achievements. ON CONFLICT keeps them idempotent.
  -- First Query: the first completed challenge.
  insert into public.user_achievements (user_id, achievement_id)
  values (p_user_id, 'first_query') on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then v_new_achievements := array_append(v_new_achievements, 'first_query'); end if;

  -- Query Streak: 3 completions in one session (each within 30 minutes of the previous).
  select array_agg(completed_at order by completed_at desc) into v_recent
  from (
    select completed_at from public.challenge_completions
    where user_id = p_user_id order by completed_at desc limit 3
  ) recent;
  if coalesce(array_length(v_recent, 1), 0) = 3
     and v_recent[1] - v_recent[2] <= interval '30 minutes'
     and v_recent[2] - v_recent[3] <= interval '30 minutes' then
    insert into public.user_achievements (user_id, achievement_id)
    values (p_user_id, 'query_streak') on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then v_new_achievements := array_append(v_new_achievements, 'query_streak'); end if;
  end if;

  -- Join Master: finishing the JOIN chapter.
  if v_chapter_completed and p_join_chapter_id is not null and p_chapter_id = p_join_chapter_id then
    insert into public.user_achievements (user_id, achievement_id)
    values (p_user_id, 'join_master') on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then v_new_achievements := array_append(v_new_achievements, 'join_master'); end if;
  end if;

  -- Error Hunter: a failed submission before passing this challenge.
  if exists (
    select 1 from public.challenge_attempts
    where user_id = p_user_id and challenge_id = p_challenge_id and not passed
  ) then
    insert into public.user_achievements (user_id, achievement_id)
    values (p_user_id, 'error_hunter') on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then v_new_achievements := array_append(v_new_achievements, 'error_hunter'); end if;
  end if;

  return jsonb_build_object(
    'alreadyCompleted', false,
    'xpGained', v_xp_gained,
    'chapterCompleted', v_chapter_completed,
    'tierCompleted', v_tier_completed,
    'newAchievements', to_jsonb(v_new_achievements),
    'totalXp', v_stats.total_xp,
    'currentStreak', v_stats.current_streak
  );
end;
$$;

-- Only the server (service role) may award XP. Functions are executable by PUBLIC by
-- default and Supabase also grants EXECUTE to anon/authenticated, so revoke all three.
revoke execute on function public.award_challenge(uuid, text, text, text, integer, text[], integer, text[], integer, text)
  from public, anon, authenticated;
grant execute on function public.award_challenge(uuid, text, text, text, integer, text[], integer, text[], integer, text)
  to service_role;

-- The trigger function must not be callable through the API either.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
