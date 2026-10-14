-- Local development seed (runs on `supabase db reset`).
-- The achievement catalogue ships as a migration (20261014000002_achievements.sql)
-- because production needs it too. Challenge content lives in /content, not the DB.
-- v1 needs no other seed data: users, progress and XP are created by real sign-ups
-- and submissions.
select 1;
