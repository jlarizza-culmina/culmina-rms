# Recipe Manager — Deployment Guide
# Vercel + Supabase + Cloudflare

Estimated time: 30–45 minutes. You have all three accounts from Culmina.

---

## Step 1 — Supabase (10 min)

1. Go to https://supabase.com/dashboard
2. Click **New project** (or use an existing project — a separate one is cleaner)
   - Name: `recipe-manager`
   - Password: generate a strong one, save it
   - Region: pick closest to you (US East for CT)
3. Wait ~2 minutes for the project to spin up
4. Go to **SQL Editor** → **New query**
5. Paste the entire contents of `supabase/schema.sql` and click **Run**
6. Confirm success: you should see "Success. No rows returned"
7. Go to **Settings** → **API**
8. Copy and save these three values:
   - **Project URL** (looks like: https://abcdefgh.supabase.co)
   - **anon public** key (long JWT starting with eyJ...)
   - **service_role** key (keep this private — you won't need it in the app)
9. Go to **Authentication** → **URL Configuration**
   - Add your future Vercel URL to **Redirect URLs**:
     `https://your-app.vercel.app/**`
   - (You'll update this after Vercel deploy — come back to this)
10. Go to **Authentication** → **Email** → make sure **Enable email** is on
    - Enable **Magic Link** (passwordless)
    - Set **Site URL** to your future Vercel URL

---

## Step 2 — Local Setup (5 min)

```bash
# Clone or move the recipe-app folder to wherever you keep projects
cd recipe-app

# Install dependencies
npm install

# Copy the env example
cp .env.local.example .env.local

# Edit .env.local with your Supabase values from Step 1
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# ANTHROPIC_API_KEY=sk-ant-...
```

Get your Anthropic API key from https://console.anthropic.com → API Keys.

```bash
# Test locally
npm run dev
# Open http://localhost:3000
```

You should see the login screen. Enter your email, get the magic link, log in, and test adding a recipe.

---

## Step 3 — Push to GitHub (3 min)

```bash
# In the recipe-app directory
git init
git add .
git commit -m "Initial recipe manager"

# Create a new repo on github.com (name: recipe-manager or similar)
# Then:
git remote add origin https://github.com/YOUR_USERNAME/recipe-manager.git
git branch -M main
git push -u origin main
```

---

## Step 4 — Deploy to Vercel (5 min)

1. Go to https://vercel.com/dashboard (you're already signed in from Culmina)
2. Click **Add New** → **Project**
3. Import your `recipe-manager` GitHub repository
4. Vercel will auto-detect it as a Next.js project — leave settings as-is
5. Before clicking Deploy, click **Environment Variables** and add:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
   | `ANTHROPIC_API_KEY` | your Anthropic API key |

6. Click **Deploy**
7. Wait ~90 seconds. You'll get a URL like `recipe-manager-xyz.vercel.app`
8. Copy that URL — you need it for the next step

---

## Step 5 — Update Supabase Auth URLs (2 min)

1. Go back to Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL** to your Vercel URL: `https://recipe-manager-xyz.vercel.app`
3. Add to **Redirect URLs**: `https://recipe-manager-xyz.vercel.app/**`
4. Save

Test it: go to your Vercel URL, enter your email, click the magic link, and you should land back on the app logged in.

---

## Step 6 — Connect a Custom Domain via Cloudflare (10 min)

You'll want something like `recipes.yourdomain.com` or a dedicated domain.

**In Vercel:**
1. Go to your project → **Settings** → **Domains**
2. Click **Add Domain**
3. Type your domain (e.g. `recipes.corretto.bar` or `mise.yourdomain.com`)
4. Vercel will show you a CNAME record to add

**In Cloudflare:**
1. Go to https://dash.cloudflare.com
2. Select your domain
3. Go to **DNS** → **Add record**
   - Type: `CNAME`
   - Name: `recipes` (or whatever subdomain you chose)
   - Target: `cname.vercel-dns.com` (Vercel will give you the exact value)
   - Proxy: **Proxied** (orange cloud — gives you Cloudflare CDN + DDoS protection)
4. Save

**Back in Supabase**, add the new domain to Redirect URLs:
`https://recipes.yourdomain.com/**`

DNS propagates in 1–5 minutes with Cloudflare. Your app should then be live at your custom domain.

---

## Step 7 — Install as a PWA (optional, 2 min)

**On iPhone/iPad:**
1. Open your app URL in Safari
2. Tap the Share button → **Add to Home Screen**
3. Name it "Recipes" → Add
4. It appears as an app icon and opens fullscreen

**On Android:**
1. Open in Chrome
2. Tap the three-dot menu → **Add to Home screen**

**On Desktop (Chrome/Edge):**
1. Look for the install icon in the address bar (⊕)
2. Click Install — it opens in its own window like a native app

---

## Environment Variables Reference

| Variable | Where to find it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

The `ANTHROPIC_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix) — it never reaches the browser.

---

## Ongoing Deployments

Every `git push` to `main` auto-deploys via Vercel. No manual steps needed.

```bash
# Make changes, then:
git add .
git commit -m "Your change"
git push
# Vercel deploys automatically in ~60 seconds
```

---

## Troubleshooting

**"Invalid redirect URI" on magic link login:**
→ Update Supabase → Authentication → URL Configuration with your exact domain.

**API returns 502:**
→ Check Vercel → your project → Functions → `/api/chat` logs.
→ Verify `ANTHROPIC_API_KEY` is set correctly in Vercel environment variables.

**Recipes not saving:**
→ Check Supabase → Table Editor → recipes — if empty, the schema may not have run.
→ Re-run `supabase/schema.sql` in the SQL Editor.

**App not loading after domain change:**
→ Cloudflare DNS usually propagates in under 5 minutes. Check https://dnschecker.org

---

## Adding the App Icon (optional)

Replace the placeholder icons with real ones for a polished home screen experience:

1. Create a 512×512 PNG with your logo (the moka pot mascot would be perfect)
2. Go to https://realfavicongenerator.net, upload it, download the package
3. Place `icon-192.png` and `icon-512.png` in `public/icons/`
4. `git push` — Vercel redeploys automatically
