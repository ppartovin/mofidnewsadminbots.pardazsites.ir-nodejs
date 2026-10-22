# Bale Bot (Node.js + Express)

A minimal Express port of the Flask webhook. It retains `/webhook`, `/`, the external JSON data file (`FILE_PATH`), read-only `school_schedule.json`, and the AI JSON response contract.

## Run

Requires Node.js 18 or newer. Run `npm install`, set the variables from `.env.example` in the process environment, then run `npm start`. `FILE_PATH` must point to the JSON file the assistant may edit. The service listens on port 5000 by default (`PORT` changes it).

Set the Bale webhook URL to `https://your-domain/webhook`. Logs are written to `logs/bot.log`; secrets are redacted.
