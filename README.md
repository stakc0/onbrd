# onbrd

Onboard keeps the original Qomo interface and adds a context-aware X onboarding bot.

## Bot

Copy `.env.bot.example` to `.env.bot.local`, set the X credentials, OpenRouter key, bot handle, and referral base URL. The bot replies to mentions with a personalized onboarding response plus a signup referral and QR link.

Run a safe preview with `npm run bot:dry-run`, or poll with `npm run bot:loop`.
