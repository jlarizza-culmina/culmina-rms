# Culmina RMS

## Stack
Next.js 14.1.0 · Supabase · Vercel · TypeScript strict
App router: src/app/ · API routes: src/app/api/ · Lib: src/lib/

## Key IDs
restaurant_id: af1cd630-f6c1-48a2-8fb7-3024bba90c2e
location_id:   36f59f14-5022-403c-9114-b12a30049f00

## Supabase clients — TWO different clients, never mix them
- src/lib/supabase.ts: createBrowserClient() with ANON key — client components only
- API routes: createClient() from @supabase/supabase-js with SERVICE_ROLE_KEY — server only
- Never use the browser client in API routes
- Always ADD COLUMN IF NOT EXISTS in migrations

## Environment variables
NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_PHONE_NUMBER

## Deployment
git add . && git commit -m "..." && git push && vercel --prod

## Design system
Fonts: Cormorant Garamond (item names) · Jost (structural text)
Palette: --accent #C05A2A · --surface #F2EDE4 · --text #2C2420
NEVER use bullet lists in UI — prose only
All spacing via CSS vars only, never arbitrary Tailwind values

## API route rules
- recipes/* and ingredients/*: validate restaurantId + userId from request body
- waitlist/*: validate via sessionId (session row contains restaurant_id implicitly)
- All API routes instantiate their own supabase client with SERVICE_ROLE_KEY

## Architecture
- No Type I hood: no on-site raw protein cooking — never generate prep workflows assuming this
- Soft delete preferred over hard delete on recipes and ingredients
- audit() not yet implemented — do not reference src/lib/audit.ts

## Spec documents
Google Drive folder: 1L0D3Bgd29HsKlsEraiap_qaGQwki24EF
See @docs/specs/index.md
