# VYRA AI — Go-Live Guide

## 1. Deploy the API (Render, ~10 min)
1. Push this folder to GitHub. In Render: **New → Blueprint** and pick the repo (`render.yaml` is read automatically).
2. Fill the secret env vars: `FAL_KEY`, `ELEVENLABS_API_KEY`, the two voice IDs, `PUBLIC_API_URL` (your Render URL), `PUBLIC_APP_URL`, `CORS_ORIGINS`.
3. Keep the **persistent disk** (videos + job history survive restarts). On a free plan without a disk, videos vanish on every restart.
4. Open `https://YOUR-API/api/health`. You should see `"features": {"text":true,"photo":true,...}`.

## 2. Deploy the web app (Vercel, ~5 min)
1. Import the repo. Add env var `EXPO_PUBLIC_API_URL=https://YOUR-API`.
2. Build command and output are in `vercel.json` (`expo export --platform web` → `dist`).
3. Put that Vercel URL into `PUBLIC_APP_URL` and `CORS_ORIGINS` on Render.

## 3. Mobile apps (optional, EAS)
```
npm i -g eas-cli && eas login
eas build --profile preview --platform android     # APK to test
eas build --profile production --platform all
eas submit --platform all
```
Set `EXPO_PUBLIC_API_URL` in `eas.json` env or EAS secrets. Change the bundle IDs in `app.json` (`com.vyra.cinematic`) to ones you own.

## 4. Protect your wallet (do this BEFORE announcing)
- `VYRA_DAILY_LIMIT` (default 5) caps free videos per person per day. Do the math: videos/day × cost per video.
- `VYRA_MAX_CONCURRENT` (default 2) limits parallel renders.
- Set a **hard spend limit / low-balance alert** in fal.ai and ElevenLabs dashboards.
- For a soft launch use `VYRA_ACCESS_CODES=friends2026,beta1` (invite only). Clear it to go public.
- Emergency brake: set `VYRA_MAINTENANCE=true` and redeploy.
- Daily limits are keyed on a device ID + IP, so a determined person can bypass them. Add real accounts + payments (Stripe / Play Billing) before scaling.

## 5. Pre-launch checklist
- [ ] `/api/health` shows all features you plan to advertise
- [ ] Generate one of each: Text, Photo, Ad, Talking Fruits (verify Hindi voices sound right)
- [ ] Open a `/v/<id>` share link in WhatsApp to confirm the preview unfurls
- [ ] Test on a real phone (iOS and Android) and in Chrome + Safari
- [ ] Replace `support@vyra.ai` in `App.js`, `landing/*.html` with your real inbox
- [ ] Have terms/privacy reviewed (templates in `landing/`)
- [ ] Replace Unsplash images in `shared.js` with your own licensed artwork
- [ ] Confirm ElevenLabs voices you chose allow commercial use
- [ ] Spend limits set at providers

## 6. What changed in v2
Real photo-to-video • Ad Studio (4 templates) • Prompt Director (3 rewrites) • camera + mood controls • live preview of the exact prompt • job queue with position + progress bar • jobs survive refresh and server restarts • daily quota with refunds on failures • access codes • content screening • video thumbnails • shareable `/v/<id>` links with social previews • remix, favorites, search, delete • in-app native playback • Talking Fruits uses the chosen story and matches clip length to dialogue • auto-deletion after 7 days • rate limiting, security headers, CORS allow-list • landing page, Terms, Privacy.

## 7. Known limits (be honest with users)
- Talking Fruits voices are laid over the footage; frame-accurate lip-sync is not included.
- Jobs and quotas are in server memory/disk of ONE instance. Don't scale to multiple instances without moving to Redis/Postgres + object storage (S3/R2).
- This build was code-checked but not run against live provider keys in the environment it was written in. Run the checklist above before announcing. `ELEVENLABS_MODEL_ID` defaults to the value from your original code; change it if ElevenLabs rejects it.
