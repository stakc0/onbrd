# COPYCAT autolaunch backend

Mechanic: a Helius webhook records buys. Any buy transaction that spends at least `COPYCAT_MIN_SOL_TRIGGER` SOL, meaning >= 1 SOL by default, queues a launch. `process-copycat-launch` creates the next Pump.fun token through PumpPortal/Jito.

Required Supabase secrets:

- `COPYCAT_MINT`, main coin CA after launch
- `COPYCAT_LAUNCH_PRIVATE_KEY`, backend-only launch wallet private key
- `COPYCAT_ADMIN_SECRET`, random secret for processor calls
- `COPYCAT_WEBHOOK_SECRET`, random secret for Helius webhook header
- `COPYCAT_MIN_SOL_TRIGGER=1`
- `COPYCAT_DEV_BUY_SOL=0`, minimum/no dev buy for copied launches
- `COPYCAT_IMAGE_URL=https://raw.githubusercontent.com/stakc0/copycat/main/public/token/copycat-token.jpg
- `COPYCAT_WEBSITE=https://copy-cat.lol`
- `COPYCAT_TWITTER=https://x.com/catalyst100x`
- `COPYCAT_TELEGRAM`, optional

Helius webhook target:

`https://<project>.supabase.co/functions/v1/copycat-buy-webhook`

Header:

`x-copycat-secret: <COPYCAT_WEBHOOK_SECRET>`

Processor endpoint:

`POST https://<project>.supabase.co/functions/v1/process-copycat-launch`

Header:

`x-copycat-admin-secret: <COPYCAT_ADMIN_SECRET>`
