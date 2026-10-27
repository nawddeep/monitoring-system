# Monitoring system: lake dashboard

Read-only dashboard for a four-channel lake prototype (pH, water temperature, TDS/EC, water level), built to the *Lake Monitoring System: Sensor Engineering Review* of 12 October 2026. It shows no data of its own: it reads from a PostgreSQL database through a read-only data API (see [dashboard/API.md](dashboard/API.md)).

## Quick start (3 commands)

Needs Node.js 20+ and Docker.

```sh
git clone https://github.com/nawddeep/monitoring-system.git && cd monitoring-system
cp .env.example .env                 # then set POSTGRES_PASSWORD (and the password inside DATABASE_URL)
docker compose up -d && npm start    # PostgreSQL on :5432, dashboard on http://127.0.0.1:8080/
```

`docker compose up` creates the schema from `db/init/` on first start only. To rebuild from scratch: `docker compose down -v`.

Until the data API is connected the dashboard shows "Not connected". Set `apiBase` in `dashboard/config.json` (no credentials in that file: the browser downloads it).

## Databases

| Where | Database | Used for |
|---|---|---|
| Your machine | Local Docker PostgreSQL (default) | Development and tests |
| Live | Neon PostgreSQL | Sensor readings written by the bridge; read by the dashboard API through a **read-only** role |

`db/init/` holds the schema migrations copied from the main app repo ([nawddeep/Lake_Monitoring-](https://github.com/nawddeep/Lake_Monitoring-)), so local and Neon have the same tables. That repo owns the schema and the sensor bridge; change the schema there first.

## Tests

```sh
npm test      # rendering and guardrail tests, using tests/fixtures only
```

## Secrets

`.env` is gitignored. Database passwords, Wi-Fi passwords and ingest tokens must never be committed. This repository is public.

## Pages, configuration and assumptions

See [dashboard/API.md](dashboard/API.md) for the API contract and [ASSUMPTIONS.md](ASSUMPTIONS.md) for what is unverified. Dashboard options are in `dashboard/config.json` (refresh interval, time zone `Asia/Kolkata`, sampling interval, default range).
