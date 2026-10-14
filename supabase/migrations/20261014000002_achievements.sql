-- Achievement catalogue. This is reference data that production needs too (user_achievements
-- references it), so it ships as a migration rather than in seed.sql. Safe to re-run.
insert into public.achievements (id, name, description, requirement, icon, sort_order) values
  ('first_query', 'First Query', 'You solved your first SQL challenge.', 'Complete any challenge.', 'sparkles', 1),
  ('query_streak', 'Query Streak', 'Three challenges in one sitting.', 'Complete 3 challenges in one session, each within 30 minutes of the previous one.', 'flame', 2),
  ('join_master', 'Join Master', 'You can stitch tables together.', 'Complete every challenge in the JOIN chapter (Tier 3).', 'git-merge', 3),
  ('error_hunter', 'Error Hunter', 'Every bug is a lesson.', 'Fail a challenge submission, then pass the same challenge.', 'bug', 4)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  requirement = excluded.requirement,
  icon = excluded.icon,
  sort_order = excluded.sort_order;
