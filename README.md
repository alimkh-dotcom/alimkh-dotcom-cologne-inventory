# Cologne Inventory

Personal fragrance collection tracker — adapted from the cigar-inventory app.

**Views**
- **Inventory** — every bottle: size, fill level, price paid, seller, status (in stock / finished / sold / traded)
- **Journal** — wear log with ratings (scent, longevity, projection, versatility), occasions, and accord tags
- **Catalog** — the fragrance database: brand, name, inspired-by original, full note pyramid, seasons, gender

**AI auto-fill** — when adding or editing a fragrance, one click fills the inspired-by original,
note pyramid, gender, seasons and occasions from just the brand + name (Gemini, via a Vercel
serverless function — same pattern as the cigar app's Neptune lookup).

**Seed data** — ships with a 142-bottle starter collection (`src/seedData.json`); the empty state
offers a one-click import.

## Stack

React 19 + Vite + Tailwind, Firebase (Google sign-in + Firestore sync), deployed on Vercel.
Runs in **local-only mode** (localStorage, no login) until Firebase env vars are configured.

## Setup

1. `npm install`
2. **Firebase** (optional but recommended): create a project at console.firebase.google.com →
   enable **Google** sign-in (Authentication → Sign-in method) → create a **Firestore** database →
   register a Web app and copy the config into `.env` (see `.env.example`, `VITE_FIREBASE_*` keys).
   Suggested Firestore rules:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
3. **Gemini**: set `GEMINI_API_KEY` in the Vercel project env (Settings → Environment Variables).
   The auto-fill button needs the deployed serverless function (`api/autofill-fragrance.js`),
   so it works on Vercel deployments and `vercel dev`, not plain `npm run dev`.
4. `npm run dev` to develop, or push to a Vercel-connected repo to deploy.
