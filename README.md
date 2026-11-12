# Blimp

Money drops near you. Grab it before it drifts off.

Blimp is a web app that installs to your phone's home screen. It uses your real GPS and a real map (MapLibre with free OpenFreeMap tiles, restyled in Blimp's look), and it runs on Supabase for accounts and data.

**Money is play money for now.** Real payouts through Stripe come after the legal check.

---

## What works

- **Sign-up:** phone or email with a 6-digit code, then pick an @name and turn on location and notifications. Every step has **Skip**, which makes a guest account you can upgrade later from the You tab.
- **Home:** a full-screen live map with pulsing drops, filters (All, Near me, Following, Ending soon), zoom and recenter buttons, and a swipe-up sheet with drop cards, the full list and a code box.
- **Claiming:** slide to claim. The **server** checks that you're inside the zone with real GPS, that it's one claim per person, that the drop isn't over, and a daily claim limit. On your first claim it asks where to send the payout.
- **Dropping:** name, color, pool, number of people (it works out the amount per person and the 5% fee), radius (1 block, 0.1 mi or 0.25 mi), time, Public or Code only, Be there or Anywhere, and anonymous or @name. It drops at your location.
- **Live drop:** a countdown, a claims bar, a feed, the share code with a Share button, test claims, and ending early.
- **Recap:** when a drop is over, unclaimed money goes back to the dropper automatically.
- **You tab:** your @name, account, balance, cash out (demo), +$500 play money, payout method, pretend location for testing, who you follow, and your activity.
- **Following and pings:** a banner shows when someone drops near you or someone you follow drops anywhere. You also get a phone notification if you allowed them and the app is open in the background.
- **Shared links:** `your-link/#code=FRONT` opens that drop's code.

**Demo mode:** with no Supabase keys, the app still runs completely on one phone. That's how you know the build works before setup.

---

## Setup (about 10 minutes, all doable from your phone)

### 1. Supabase (accounts and database), free

1. Go to **supabase.com** → sign up → **New project**. Name it `blimp` and pick a region near you (East US).
2. Open **SQL Editor** → **New query** → paste everything in `supabase/schema.sql` → **Run**. You should see "Success."
3. **Authentication → Sign In / Providers:**
   - Turn on **Allow anonymous sign-ins**. This is what makes the Skip button work.
   - **Email** is on by default. Leave it on.
4. **Authentication → Emails (Templates):** so emails send a **6-digit code** instead of a link, add this line to the **Magic Link**, **Confirm signup** and **Change Email Address** templates, then save:
   ```
   Your Blimp code: {{ .Token }}
   ```
5. **Project Settings → API** (or the **Connect** button): copy the **Project URL** and the **anon / publishable key**. You'll paste them into Vercel next.

### 2. Vercel (puts it online), free

1. Go to **vercel.com** → sign up with GitHub.
2. **Add New → Project** → import the **blimp** repo. Vercel detects **Vite** on its own.
3. **Deploy.** You get a link like `blimp-xyz.vercel.app`. (The Supabase URL and publishable key are already in `.env.production`, so there's nothing to paste.)
5. Back in Supabase: **Authentication → URL Configuration → Site URL** = your Vercel link.

### 3. Put it on your phone

- **iPhone:** open the link in **Safari** → Share → **Add to Home Screen**.
- **Android:** open the link in **Chrome** → menu → **Install app**.

It opens full-screen with the Blimp icon.

### Optional: phone-number codes

Texting codes needs an SMS provider. In Supabase: **Authentication → Sign In / Providers → Phone** → turn it on and connect **Twilio**, which charges a small amount per text. Until then, people sign up with email. The app tells them if phone codes aren't set up yet.

---

## Testing tips

- **Not in Wilmington?** In the You tab, turn on **Pretend location**, then tap the map to place yourself. Starter drops: **Welcome to Blimp** at Front & Market (public) and code **FRONT** near the Cotton Exchange.
- **Watch a drop fill:** on your live drop, tap **Test: simulate a claim**.
- **Two phones:** sign up on both, drop on one, claim on the other.

---

## How it's built

| Part | Tool |
|---|---|
| App | Vite + plain JavaScript (`src/`) |
| Map | MapLibre GL + OpenFreeMap (free, no key), recolored in `src/map.js` |
| GPS | Browser geolocation (`src/geo.js`) |
| Backend | Supabase: Postgres, auth, realtime (`src/data/live.js`) |
| Rules and money | Postgres functions in `supabase/schema.sql` (server-side, so they can't be cheated from the app) |
| Demo backend | `src/data/demo.js` (same rules, on-device) |

Run locally: `npm install` → copy `.env.example` to `.env` → `npm run dev`.

Tests: `node test/sql.test.mjs` (database rules) and `node test/app.test.cjs` after `npx vite build -c test/vite.test.config.js` (app flow).

## Next up

- Real payouts with Stripe Connect (after the lawyer check)
- Pings when the app is closed (web push or the native app)
- Stronger anti-farming: device checks, payout-account matching, holds on new accounts
- iPhone and Android App Store versions (Expo) with the same design
