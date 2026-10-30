# Flock Energy — Urja Meter Ops API Service

This service wraps the legacy **Urja Meter Ops** portal (`urja-ops.flockenergy.tech`) in a clean, documented REST API. It gives product and data teams reliable programmatic access to smart meters, electrical network hierarchy, time-series energy readings, and geospatial proximity queries—without anyone needing to manually scrape or copy-paste from the browser.

---

## Quick Links

- **Protocol & Reverse Engineering Notes:** [`PROTOCOL.md`](./PROTOCOL.md) — Detailed breakdown of the portal's authentication, SvelteKit CSRF quirks, and the HMAC export signature.
- **Engineering Reflection:** [`REFLECTION.md`](./REFLECTION.md) — Answers to the 5 take-home reflection questions (assumptions, hardest parts, mistakes, self-critique).
- **OpenAPI 3.0 Spec:** [`openapi.json`](./openapi.json) — Complete API definition file.
- **Interactive Swagger UI:** `http://localhost:3000/docs` (when server is running).
- **Web Dashboard:** `http://localhost:3000/app/` (visual client built on top of the API).

---

## How It Works

```
┌───────────────────────────────────────┐
│     Urja Meter Ops (Legacy Portal)    │
│    https://urja-ops.flockenergy.tech  │
└───────────────────▲───────────────────┘
                    │ Cookie Auth + Origin Header + HMAC Signed Export
┌───────────────────┴───────────────────┐
│       UrjaClient (src/client.js)      │
│  • Session management & auto-renewal  │
│  • HMAC-SHA256 signature generation   │
│  • 5-min in-memory cache & indexing   │
│  • Type normalization (floats, ISO)   │
└───────────────────▲───────────────────┘
                    │
┌───────────────────┴───────────────────┐
│     Fastify API Engine (src/index.js) │
│  • GET /api/v1/meters                 │
│  • GET /api/v1/meters/:id             │
│  • GET /api/v1/meters/:id/readings    │
│  • GET /api/v1/meters/nearby          │
│  • GET /api/v1/transformers           │
│  • GET /api/v1/hierarchy              │
│  • GET /api/v1/export                 │
│  • GET /health                        │
└───────▲───────────────────────▲───────┘
        │                       │
┌───────┴───────────────┐ ┌─────┴────────────────┐
│ Downstream Consumers  │ │ Modern Web Dashboard │
│ (Product/Data / curl) │ │ (/app/ - Tailwind)   │
└───────────────────────┘ └──────────────────────┘
```

The upstream portal is built with SvelteKit and doesn't have an official public API. During reverse engineering, I found:
1. **Authentication:** Submitting `POST /login` with valid operator credentials returns a `__Secure-better-auth.session_token` cookie. SvelteKit rejects requests without an explicit matching `Origin` header (CSRF protection).
2. **Bulk Data & HMAC Signature:** The portal ships an admin bulk export route at `/portal/export`. By inspecting the frontend chunk code, I discovered it requires an HMAC-SHA256 signature generated using a signing secret exposed at `/portal/keys`.
3. **Data Quality Issues:** Telemetry numbers are stringified (`"48438.74"`), timestamps use localized UK format (`"23/06/2026 23:30"`), and coordinate values are strings. This API normalizes everything into proper floats and ISO 8601 UTC timestamps.

---

## Getting Started

### Prerequisites
- Node.js v18 or later (tested on Node v20/v24)
- npm v9 or later

### 1. Install dependencies
```bash
git clone <repository-url>
cd flock
npm install
```

### 2. Configuration
The service works out of the box with the default credentials provided in the assignment. If needed, you can override any setting using environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `URJA_BASE_URL` | Upstream portal URL | `https://urja-ops.flockenergy.tech` |
| `URJA_EMAIL` | Urja portal operator email | `operator@urja.local` |
| `URJA_PASSWORD` | Urja portal operator password | `urja-ops-2026` |
| `CACHE_TTL_MS` | In-memory cache TTL | `300000` (5 minutes) |

### 3. Run the service
```bash
npm start
```
For local development with file watching:
```bash
npm run dev
```

Once running:
- **API Base:** `http://localhost:3000`
- **Swagger Documentation:** `http://localhost:3000/docs`
- **Web Dashboard:** `http://localhost:3000/app/`
- **OpenAPI Schema:** `http://localhost:3000/openapi.json`

### 4. Run the tests
The repo includes an automated test suite verifying all routes, error handling, session auto-relogin, and data normalization:
```bash
npm test
```

---

## API Endpoints & Sample Requests

### 1. Health & Cache Status
Check service uptime and whether upstream session/cache are active:
```bash
curl http://localhost:3000/health
```
```json
{
  "status": "healthy",
  "timestamp": "2026-10-30T09:15:00.000Z",
  "uptimeSeconds": 14.2,
  "upstream": {
    "url": "https://urja-ops.flockenergy.tech",
    "authenticated": true
  },
  "cache": {
    "metersCount": 403,
    "transformersCount": 20,
    "lastHydratedAt": "2026-10-30T09:14:48.000Z"
  }
}
```

### 2. List & Filter Smart Meters
Supports filtering by search term (`q`), manufacturer (`make`), phase (`single` or `three`), status (`Installed`, `Faulty`, `Decommissioned`), and distribution transformer code (`dtCode`):
```bash
curl "http://localhost:3000/api/v1/meters?phase=three&make=HPL&page=1&limit=2"
```

### 3. Meter Detail
Fetches meter metadata, coordinates, and full network breadcrumb:
```bash
curl http://localhost:3000/api/v1/meters/J100000
```
Returns:
```json
{
  "meterId": "J100000",
  "serialNo": "SE33962",
  "make": "HPL",
  "phaseType": "single",
  "installStatus": "Installed",
  "dtCode": "DT-001",
  "geo": { "latitude": 26.938961, "longitude": 75.830957 },
  "hierarchy": {
    "zone": { "name": "Jaipur Zone", "code": "JZ-01" },
    "substation": { "name": "33/11 kV Malviya Nagar SS", "code": "SS-01" },
    "feeder": { "name": "Feeder 1", "code": "F-001" },
    "dt": { "name": "Malviya Nagar DT 1", "code": "DT-001" }
  }
}
```

### 4. Normalized Consumption Readings (Time-Series)
Fetches recent telemetry for a meter. Values are parsed to numbers and dates converted to standard UTC ISO 8601:
```bash
curl "http://localhost:3000/api/v1/meters/J100000/readings?limit=5"
```
```json
{
  "meterId": "J100000",
  "totalReadings": 336,
  "readings": [
    {
      "timestamp": "23/06/2026 23:30",
      "isoTimestamp": "2026-06-23T23:30:00.000Z",
      "kwh": 48438.74,
      "kvah": 52313.84,
      "voltR": 226
    }
  ]
}
```

### 5. Geospatial Proximity Search
Finds all meters within a radius (in km) around given coordinates using the Haversine formula:
```bash
curl "http://localhost:3000/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=5&limit=3"
```

### 6. Electrical Network Hierarchy
Reconstructs the 7-tier distribution grid tree (Zones → Circles → Divisions → Subdivisions → Substations → Feeders → DTs → Meters):
```bash
curl http://localhost:3000/api/v1/hierarchy
```

### 7. Bulk HMAC Export
Streams the complete normalized meter dataset generated via the HMAC-signed route:
```bash
curl http://localhost:3000/api/v1/export
```

---

## Design Decisions & Trade-offs

1. **Fastify instead of Express or NestJS:**
   Fastify has significantly higher throughput than Express, provides built-in JSON schema validation (via Ajv), and generates OpenAPI 3.0 specs out of the box with `@fastify/swagger`. I avoided heavy boilerplate frameworks like NestJS to keep the codebase small and readable for a 4–6 hour assignment.

2. **In-Memory Cache (5-Minute TTL):**
   The upstream dataset contains 403 meters and 20 transformers (~250 KB in memory). Rather than querying the upstream portal on every user request—which would be slow and brittle—the client hydrates the full dataset on startup using the HMAC bulk export. Filter and detail queries respond in under 2ms. Readings are still fetched per-meter when requested.

3. **Self-Healing Session Management:**
   Sessions expire after 1 hour upstream. Instead of failing requests, the client intercepts `401` and `403` responses, transparently re-authenticates with the portal, updates the session token, and retries the original request.

---

## Data Scale Analysis

The assignment prompt specifically asks: *at what data scale would this approach start to struggle, and what would you change?*

Here is an honest breakdown of the limits of the current architecture and how it would need to evolve:

- **Current Scale (403 meters):**
  Holding everything in memory in plain JavaScript arrays and Map objects is ideal. Memory usage is under 1 MB, cold start is instantaneous, and responses take <2ms without needing an external database.

- **At 10,000 to 50,000 meters:**
  - *Where it struggles:* Array filtering (`Array.filter()`) on every request starts taking 10–25ms. More importantly, the **geospatial proximity query** computes the Haversine formula across every single meter ($O(N)$); iterating 50,000 points on every spatial query will cause CPU spikes under concurrent load.
  - *What I'd change:* Add an in-memory spatial index (like **Flatbush** or an R-tree) for bounding-box and radius lookups, plus inverted index Maps for filtered fields (`make`, `phase`, `status`).

- **At 100,000 to 500,000 meters:**
  - *Where it struggles:* Holding this volume in Node heap memory risks GC pause spikes and potential OOM issues. Transferring a 500k-record JSON payload from the upstream portal on boot will hit HTTP timeouts and payload limits.
  - *What I'd change:* Move storage out of process memory into **PostgreSQL + PostGIS** (or SQLite with SpatiaLite). Spatial queries would use PostGIS `ST_DWithin` backed by GiST indexes ($O(\log N)$). Upstream sync would switch from a single bulk dump to paginated batch ingestion or change-data-capture.

- **At 1,000,000+ meters (State Utility Scale):**
  - *Where it struggles:* Single-instance Node service cannot scale horizontally without each instance hammering the legacy portal on startup.
  - *What I'd change:* Use a shared **Redis Cluster** for caching hot meter metadata with distributed locks to coordinate cache hydration. Put an API Gateway in front of multiple stateless Node workers. Use message queues (RabbitMQ/Kafka) to stream meter telemetry asynchronously into a time-series database (TimescaleDB or ClickHouse).

---

## What Was Intentionally Skipped

- **External Database (PostgreSQL / Redis):** Given the dataset size (403 meters), introducing Docker or Postgres dependencies would just make the project harder to clone and run locally without adding any user benefit.
- **Write / Mutation Endpoints:** Urja Ops is an operational lookup tool; no meter creation, update, or provisioning endpoints exist on the portal.
- **Client Authentication / API Keys:** In production, this service would run inside a private VPC behind an API Gateway (like Kong or AWS API Gateway) responsible for rate limiting, JWT validation, and client auth.

---

## What I'd Do With More Time

1. **Persistent SQLite / Redis Cache:** Allow multiple worker processes to share a cache so they don't independently hydrate from the portal.
2. **Circuit Breaker:** Wrap the upstream client with a circuit breaker (e.g., using `opossum`) so if Urja Ops goes down, the API gracefully serves stale cache instead of failing or timing out.
3. **Change Detection & Webhooks:** Run a lightweight background worker comparing meter statuses and emitting webhooks when a meter flips to `Faulty`.

---

## Project Structure

```
flock/
├── src/
│   ├── client.js          # Upstream client: login, CSRF bypass, HMAC signing, cache
│   ├── config.js          # Environment config & defaults
│   ├── index.js           # Fastify server, Swagger docs & web client mount
│   ├── schemas.js         # JSON schema / OpenAPI definitions
│   └── routes/
│       ├── meters.js      # List, filter, detail, readings, and spatial query
│       ├── transformers.js# DT listing and meter counts
│       ├── hierarchy.js   # Electrical network tree reconstruction
│       ├── export.js      # Bulk export route
│       └── health.js      # Service status & cache metrics
├── public/
│   └── index.html         # Web dashboard (Tailwind + Chart.js)
├── test/
│   └── api.test.js        # Integration test suite (12 test cases)
├── PROTOCOL.md            # Reverse engineering findings write-up
├── REFLECTION.md          # Answers to 5 evaluation questions
├── openapi.json           # Raw OpenAPI 3.0 specification
├── package.json           # Dependencies and scripts
└── README.md              # Project documentation
```

---

## Reviewer Verification Checklist

1. Clone repo and install: `npm install`
2. Run test suite: `npm test` (all 12 tests should pass)
3. Start the server: `npm start`
4. Test docs: Open `http://localhost:3000/docs` in your browser
5. Test dashboard: Open `http://localhost:3000/app/` in your browser
6. Read [`PROTOCOL.md`](./PROTOCOL.md) and [`REFLECTION.md`](./REFLECTION.md)
