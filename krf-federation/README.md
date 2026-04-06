# KRF Kenya — Deployment Guide

## Your file structure
```
krf-federation/
├── public/
│   ├── index.html        ← Public fan site
│   ├── portal.html       ← Member portal
│   ├── css/
│   │   ├── public.css
│   │   └── portal.css
│   ├── js/
│   │   ├── public.js
│   │   └── portal.js
│   └── assets/
│       ├── videos/       ← Drop hero video here
│       └── images/       ← Logos, flags
├── api/
│   ├── auth.js
│   ├── matches.js
│   ├── upload.js
│   └── data.js
├── data/
│   ├── schema.sql        ← Run in Supabase
│   ├── teams.json
│   └── players.json
├── package.json
└── vercel.json
```

---

## Step 1 — Supabase (5 minutes)

1. Go to https://supabase.com → New project
2. Name it `krf-kenya` · choose region **East Africa (Nairobi)**
3. Once created → SQL Editor → paste entire `data/schema.sql` → Run
4. Go to Settings → API → copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_KEY`
5. Go to Authentication → Settings → disable email confirmation (easier for testing)

---

## Step 2 — Vercel (5 minutes)

1. Go to https://vercel.com → New Project
2. Upload / drag your `krf-federation/` folder  
   OR connect GitHub: `git init && git add . && git commit -m "init" && vercel`
3. Add Environment Variables (Settings → Environment Variables):
   ```
   SUPABASE_URL          = paste from step 1
   SUPABASE_ANON_KEY     = paste from step 1
   SUPABASE_SERVICE_KEY  = paste from step 1
   JWT_SECRET            = any random string (e.g. krf-super-secret-2025)
   ```
4. Click Deploy → live in ~30 seconds

Your URLs will be:
- Public site: `https://krf-kenya.vercel.app`
- Portal:      `https://krf-kenya.vercel.app/portal`

---

## Step 3 — Custom Domain (10 minutes)

1. Vercel → Settings → Domains → Add `krfkenya.co.ke`
2. Go to your domain registrar (Safaricom, KENIC, etc.)
3. Add these DNS records:
   ```
   A     @    76.76.21.21
   CNAME www  cname.vercel-dns.com
   ```
4. SSL is automatic — takes ~5 minutes

---

## Step 4 — Wire up Supabase keys in HTML

Replace `%%SUPABASE_URL%%` and `%%SUPABASE_ANON_KEY%%` in both HTML files.

**Option A — Manual (quick):** Find and replace in index.html and portal.html:
```html
window.ENV_SUPABASE_URL      = 'https://xxxxx.supabase.co';
window.ENV_SUPABASE_ANON_KEY = 'eyJhbGci...';
```

**Option B — Vercel Edge Config (production):** Create a `middleware.js` that injects them at runtime.

---

## Step 5 — Create first admin user

1. Go to Supabase → Authentication → Users → Invite User
2. Email: `admin@krfkenya.co.ke` → Send invite
3. User clicks email link → sets password
4. In SQL Editor, run:
   ```sql
   INSERT INTO public.users (id, email, name, initials, role, is_active)
   VALUES (
     (SELECT id FROM auth.users WHERE email = 'admin@krfkenya.co.ke'),
     'admin@krfkenya.co.ke', 'Admin User', 'AD', 'admin', true
   );
   ```
5. Login at `/portal` with `admin` role selected

---

## Step 6 — Create officials

Same as Step 5 for:
- commissioner@krfkenya.co.ke → role: `commissioner`
- referee@krfkenya.co.ke      → role: `referee`
- linesman@krfkenya.co.ke     → role: `linesman`

---

## Step 7 — Seed initial data (optional)

In Supabase SQL Editor, run:
```sql
-- Insert teams from teams.json
INSERT INTO public.teams (name, abbr, city, color, bg_color, home_ground, bio) VALUES
  ('Nairobi Bulls', 'NB', 'Nairobi', '#C8102E', '#1a0008', 'Nyayo National Stadium', 'Three-time league champions.'),
  ('Mombasa Sharks', 'MS', 'Mombasa', '#0057A8', '#00061a', 'Mombasa Stadium', 'The coastal powerhouse.'),
  ('Kisumu Kings', 'KK', 'Kisumu', '#009A4D', '#001a0c', 'Kisumu Municipal Stadium', 'Western Kenya finest.'),
  ('Eldoret Eagles', 'EE', 'Eldoret', '#F4A900', '#1a1000', 'Eldoret Sports Club', 'Rift Valley champions.'),
  ('Nakuru Riders', 'NR', 'Nakuru', '#7B2FBE', '#0e001a', 'Nakuru ASK Showground', 'The Purple Army.'),
  ('Thika Thunder', 'TT', 'Thika', '#E85D04', '#1a0600', 'Thika Municipal Stadium', 'Mid-table contenders.'),
  ('Nyeri Hawks', 'NH', 'Nyeri', '#03A9F4', '#00101a', 'Nyeri Stadium', 'Mt. Kenya region.'),
  ('Garissa Falcons', 'GF', 'Garissa', '#FF6B35', '#1a0800', 'Garissa Stadium', 'Northern Kenya ambassadors.'),
  ('Kakamega Lions', 'KL', 'Kakamega', '#4CAF50', '#001a02', 'Kakamega High School', 'Lions of the West.'),
  ('Machakos Storm', 'NS', 'Machakos', '#9E9E9E', '#111', 'Machakos Stadium', 'Never gives up.'),
  ('Embu Blazers', 'EB', 'Embu', '#FF4081', '#1a0010', 'Embu Stadium', 'Young squad with ambition.'),
  ('Bungoma United', 'BU', 'Bungoma', '#00BCD4', '#001a1a', 'Bungoma Stadium', 'Building for the future.');
```

---

## Live Streaming Setup

For real video streaming to the public site:

1. Sign up at https://cloudflare.com/stream (or Mux.com)
2. Create a live input → get RTMP URL + stream key
3. In Admin → Site Settings → paste the RTMP URL
4. On match day: open OBS → Settings → Stream → Custom → paste RTMP URL + key
5. The stream will automatically appear on the public site live page

---

## Real-time Live Scores

Already wired via Supabase Realtime. Once you:
1. Have SUPABASE_URL and SUPABASE_ANON_KEY in the HTML
2. Have a match set to `status = 'live'` in the database
3. Officials log into the portal and update scores

→ Scores update automatically on the public site for all viewers within ~1 second.
No extra setup needed.

---

## Contact
info@krfkenya.co.ke
