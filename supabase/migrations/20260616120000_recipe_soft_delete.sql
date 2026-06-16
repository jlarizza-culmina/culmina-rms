-- Recipe soft delete: preserve deleted recipes in history rather than destroying them.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_deleted  boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid;
