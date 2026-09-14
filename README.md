# VCode Leads

A compact team CRM for VCode: manually add or CSV-upload leads, export a list, and sync only Instantly's Interested and Not Interested outcomes into one dashboard.

## Run it

1. Create a file called `.env` beside `server.js` (copy `.env.example`) and add `INSTANTLY_API_KEY=your_new_key`. Give that key `leads:read`, `leads:update`, and `emails:read` to use the mail-content view. It is ignored by Git and read only by the server.
2. Run `npm start`, then open `http://localhost:3000`.

There are no package dependencies; Node 18+ is sufficient.

## Sync Instantly without webhooks

Click **Sync Instantly** when you want the latest results. The service requests `POST /api/v2/leads/list`, follows cursor pagination, and imports only `lt_interest_status: 1` (Interested) and `-1` (Not Interested). It deliberately ignores Out of Office and every other Instantly status.

For a production deployment, put this service behind HTTPS, set the API key in the host’s environment, and replace `data.json` with a database (e.g. Supabase/Postgres) before multiple people edit leads concurrently.
