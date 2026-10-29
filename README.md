# Flock Energy Urja Meter Ops API Service

A clean, modern, well-documented REST API service bridging the legacy **Urja Meter Ops** utility portal (`https://urja-ops.flockenergy.tech`).

This service provides programmatic access to smart meters, electrical network hierarchy (Zones → Substations → Feeders → Distribution Transformers), geospatial proximity search, and normalized time-series energy consumption readings.

---

## Quick Links
* **Protocol & Reverse Engineering Write-Up:** [`PROTOCOL.md`](./PROTOCOL.md)
* **OpenAPI 3.0 Specification:** [`openapi.json`](./openapi.json)
* **Engineering Reflection & Self-Critique:** [`REFLECTION.md`](./REFLECTION.md)
* **Interactive Browser Swagger UI:** `http://localhost:3000/docs` (when running)
* **Modern Web Dashboard:** `http://localhost:3000/app/` (when running)

---

## Architecture Overview

```
┌──────────────────────────────────────┐
│       Legacy Urja Ops Portal         │
│   (SvelteKit + better-auth session)   │
└──────────────────▲───────────────────┘
                   │ Upstream HTTP (Cookie Auth + HMAC Signed Export)
┌──────────────────┴───────────────────┐
│          UrjaClient (client.js)      │
│  • Auto-login & session renewal      │
│  • HMAC-SHA256 signature generator   │
│  • In-memory cache & geospatial index│
└──────────────────▲───────────────────┘
                   │
┌──────────────────┴───────────────────┐
│     Fastify API Service (src/index.js)│
│  • GET /api/v1/meters                │
│  • GET /api/v1/meters/:id            │
│  • GET /api/v1/meters/:id/readings   │
│  • GET /api/v1/meters/nearby         │
│  • GET /api/v1/transformers          │
│  • GET /api/v1/hierarchy             │
│  • GET /api/v1/export                │
│  • GET /health                       │
└──────▲────────────────────────▲──────┘
       │                        │
┌──────┴──────────────┐  ┌──────┴──────────────┐
│  Data / Product API │  │ Modern Web Dashboard│
│   (JSON / Swagger)  │  │ (Tailwind + Chartjs)│
└─────────────────────┘  └─────────────────────┘
```

---

## Getting Started

### Prerequisites
* **Node.js** v18+ (tested on Node v20/v24)
* **npm** v9+

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd flock
npm install
```

### 2. Configuration (Optional)
The service runs out of the box with default credentials for the Urja portal. You can override settings via environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Local server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `URJA_BASE_URL` | Upstream portal URL | `https://urja-ops.flockenergy.tech` |
| `URJA_EMAIL` | Portal operator email | `operator@urja.local` |
| `URJA_PASSWORD`| Portal operator password | `urja-ops-2026` |
| `CACHE_TTL_MS` | In-memory cache time-to-live | `300000` (5 minutes) |

### 3. Run the Service
Start the server:
```bash
npm start
```
* **API Server:** `http://localhost:3000`
* **Interactive Swagger UI:** `http://localhost:3000/docs`
* **Raw OpenAPI Spec:** `http://localhost:3000/openapi.json`
* **Modern Web Dashboard:** `http://localhost:3000/app/`

### 4. Run Automated Tests
Execute the comprehensive integration test suite (13 automated tests):
```bash
npm test
```

---

## Sample Requests (`curl`)

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. List & Filter Smart Meters
Search for three-phase meters manufactured by HPL:
```bash
curl "http://localhost:3000/api/v1/meters?phase=three&make=HPL&page=1&limit=5"
```

### 3. Get Meter Details (Hierarchy & Coordinates)
```bash
curl http://localhost:3000/api/v1/meters/J100000
```

### 4. Fetch Normalized Time-Series Consumption Readings
Returns parsed numbers (`kWh`, `kVAh`, `voltR`) and ISO timestamps:
```bash
curl "http://localhost:3000/api/v1/meters/J100000/readings?limit=10"
```

### 5. Geospatial Proximity Query
Find all smart meters within a 5 km radius of Jaipur center (`26.9389, 75.8309`):
```bash
curl "http://localhost:3000/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=5"
```

### 6. Network Grid Hierarchy
Returns the reconstructed tree (Zones → Circles → Divisions → Substations → Feeders → DTs → Meters):
```bash
curl http://localhost:3000/api/v1/hierarchy
```

### 7. Bulk Export (HMAC Signed)
```bash
curl http://localhost:3000/api/v1/export
```

---

## Design Decisions & Trade-offs

1. **JavaScript + Fastify:**
   * **Decision:** We selected Fastify for its high throughput, native JSON schema support, and plug-and-play OpenAPI generation via `@fastify/swagger`.
   * **Trade-off:** We avoided heavy frameworks (like NestJS) to keep the codebase transparent, lightweight, and easy to review in a 1-hour follow-up interview.

2. **In-Memory Cache & Indexing:**
   * **Decision:** On startup, the service fetches the 403-meter dataset via the portal's HMAC-signed export endpoint and builds an in-memory index.
   * **Benefit:** Queries for meters, filters, hierarchy, and spatial proximity respond in **under 2 milliseconds**, completely insulating the legacy portal from load spikes.
   * **Freshness & Stale Data:** Cache expires after 5 minutes (`CACHE_TTL_MS`). A background refresh is triggered on expiration. Live telemetry readings (`/readings`) are always fetched dynamically per meter.

3. **Data Normalization:**
   * **Decision:** The legacy portal returns numbers as strings (e.g. `"48438.74"`) and dates in UK format (`"23/06/2026 23:30"`).
   * **Benefit:** Our API parses values into real numbers and ISO 8601 strings (`isoTimestamp: "2026-06-23T23:30:00.000Z"`), making consumption seamless for analytics tools and time-series databases.

4. **Self-Healing Session Management:**
   * **Decision:** The upstream client tracks session tokens and intercepts `401/403` responses. If a session expires, it re-authenticates automatically and retries the request without failing the caller.

---

## What Was Intentionally Skipped
* **Database Persistence (PostgreSQL/SQLite):** Given the dataset size (403 meters), an external database was omitted to avoid unnecessary external dependencies and allow zero-config local execution.
* **Write Operations:** The portal is an operations lookup tool; write endpoints (e.g. creating/deleting meters) do not exist upstream.
* **Authentication on the Wrapper:** In a production deployment, this service would sit behind an API Gateway (e.g. Kong, Cloudflare, or AWS API Gateway) with OAuth/JWT auth.

---

## What We'd Improve With More Time
* **Persistent Redis/SQLite Cache:** For multi-instance horizontal scaling.
* **Circuit Breakers & Exponential Backoff:** Gracefully handle legacy portal downtime.
* **SSE / Webhooks:** Stream real-time alerts when meter status flips to `Faulty`.

---

## Project Structure

```
flock/
├── src/
│   ├── client.js          # Upstream client: login, CSRF, HMAC signing, caching
│   ├── config.js          # Configuration & environment variables
│   ├── index.js           # Fastify server, Swagger docs & dashboard mount
│   ├── schemas.js         # OpenAPI / JSON schemas
│   └── routes/
│       ├── meters.js      # Meter listing, detail, readings, and spatial query
│       ├── transformers.js# DT listing and connected meter mapping
│       ├── hierarchy.js   # Electrical network tree
│       ├── export.js      # HMAC bulk export route
│       └── health.js      # System health & diagnostics
├── public/
│   └── index.html         # Modern web client dashboard (Tailwind + Chart.js)
├── test/
│   └── api.test.js        # Automated integration tests (13 test cases)
├── PROTOCOL.md            # Reverse engineering findings & portal analysis
├── REFLECTION.md          # 5 evaluation questions answered
├── openapi.json           # OpenAPI 3.0 specification
├── package.json           # Node.js project manifest & scripts
└── README.md              # Project documentation
```

