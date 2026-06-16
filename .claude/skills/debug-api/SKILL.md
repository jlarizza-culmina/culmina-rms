---
name: debug-api
description: Debug a failing API route in Culmina RMS. Use when an API route returns an error or unexpected result.
disable-model-invocation: true
---

## Common failure modes in this stack

**Wrong Supabase client**
- API routes must use SERVICE_ROLE_KEY, not ANON key
- Check: does the route import from src/lib/supabase.ts? That's wrong for API routes.

**Missing env vars on Vercel**
- SUPABASE_SERVICE_ROLE_KEY is server-only — not prefixed with NEXT_PUBLIC_
- Check Vercel dashboard if works locally but fails in prod

**RLS blocking writes**
- SERVICE_ROLE_KEY bypasses RLS — if you're seeing permission errors, wrong client is being used

**Twilio SMS failures**
- Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER are set
- SMS failures are logged but don't throw — check console output

## Current API routes
ai/ingredient-import · ai/ingredients/bulk-map · chat
ingredients/bulk-map · location-info/[locationId]
mta/arrivals · nutrition/update · recipes/import
usda/search · waitlist/action · waitlist/guest-lookup
waitlist/join · weather/capture
