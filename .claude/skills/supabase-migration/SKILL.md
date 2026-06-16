---
name: supabase-migration
description: Write and apply a Supabase migration for Culmina RMS. Use when adding tables, columns, or changing schema.
disable-model-invocation: true
---

## Rules
- Always ADD COLUMN IF NOT EXISTS — never bare ADD COLUMN
- Never modify existing migration files — create new ones
- Run migrations in Supabase dashboard SQL editor (no local CLI configured)
- Name convention: describe the change in the filename

## Key tables
- recipes (soft delete: is_active=false)
- ingredients (soft delete: is_active=false)  
- menus, menu_items
- waitlist_sessions, guests
- restaurants, locations

## Migration template
```sql
-- Description: [what this migration does]
-- Date: [today]

ALTER TABLE [table_name]
  ADD COLUMN IF NOT EXISTS [column_name] [type] [constraints];
```

## Steps
1. Write the SQL
2. Test in Supabase dashboard SQL editor
3. Confirm no existing data is affected
4. Document in docs/specs/index.md if it's a schema change
