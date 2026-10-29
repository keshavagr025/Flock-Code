# PROTOCOL.md — Urja Meter Ops Reverse Engineering & Protocol Analysis

This document provides a technical breakdown of the internal workings of the **Urja Meter Ops** portal (`https://urja-ops.flockenergy.tech`), discovered during our black-box investigation.

---

## 1. Overview of the Portal

Urja Meter Ops is an internal distribution utility portal used by operations staff to monitor smart electricity meters, network topology (transformers/feeders), and consumption telemetry.

* **Frontend Framework:** SvelteKit (Vite build)
* **Authentication Library:** `better-auth`
* **Session Mechanism:** HttpOnly, Secure cookie (`__Secure-better-auth.session_token`)
* **Data Transport:** SvelteKit form actions, internal REST-like endpoints (`/portal/*`), and serialized page loads.

---

## 2. Authentication Flow & Security Quirks

### Login Mechanism
* **Endpoint:** `POST /login`
* **Content-Type:** `application/x-www-form-urlencoded`
* **Parameters:** `email` and `password`
* **Success Indicator:** Status `200 OK` (with `Set-Cookie`) or `302/303 Redirect` to `/` (which redirects to `/meters`).

### Quirk 1: SvelteKit CSRF Protection Rejection
When sending a standard programmatic `POST` request without browser context, the server immediately rejects the request with:
```http
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Cross-site POST form submissions are forbidden
```
**Resolution:** SvelteKit verifies that the incoming `Origin` header matches the host. The request must include:
```http
Origin: https://urja-ops.flockenergy.tech
Referer: https://urja-ops.flockenergy.tech/login
```

### Quirk 2: Session Cookie & Lifetime
Upon authentication, the server sets:
```http
Set-Cookie: __Secure-better-auth.session_token=<token>; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax
```
* **Lifetime:** Exactly 3600 seconds (1 hour).
* **Auto-renewal:** Our API wrapper automatically intercepts `401 Unauthorized` or `403 Forbidden` responses, triggers a transparent re-login with the configured credentials, updates the session token, and re-executes the original request.

---

## 3. Discovered Internal Endpoints & Data Model

While the portal appears to be a multi-page web app, inspecting the compiled JavaScript bundle (`app.*.js` and page chunks) revealed clean, hidden JSON endpoints under the `/portal/*` path:

### A. Smart Meters Search & Listing
* **Endpoint:** `GET /portal/meters/search?q={query}&page={page}`
* **Auth:** Session cookie required.
* **Response Payload:**
```json
{
  "data": [
    {
      "meterId": "J100000",
      "serialNo": "SE33962",
      "make": "HPL",
      "phaseType": "single",
      "installStatus": "Decommissioned",
      "dtCode": "DT-001"
    }
  ],
  "total": 403
}
```
* **Page size:** 20 meters per page.

---

### B. Distribution Transformers (DTs)
* **Endpoint:** `GET /portal/dts?page={page}`
* **Auth:** Session cookie required.
* **Response Payload:**
```json
{
  "data": [
    {
      "code": "DT-001",
      "name": "Malviya Nagar DT 1",
      "feederCode": "F-001",
      "capacityKva": 100
    }
  ],
  "total": 20
}
```

---

### C. Individual Meter Telemetry & Geography
Navigating to a meter detail page (`/meters/{id}`) initiates lazy client-side fetches:

1. **Geographic Coordinates:**
   * **Endpoint:** `GET /portal/meters/{meterId}/geo`
   * **Response:**
     ```json
     {
       "data": {
         "latitude": "26.938961002479868",
         "longitude": "75.83095696146852"
       }
     }
     ```
   * *Quirk:* Coordinates are returned as string representations rather than floating-point numbers.

2. **Energy Consumption Time-Series:**
   * **Endpoint:** `GET /portal/meters/{meterId}/energy`
   * **Response:** Array of 330+ time-series readings.
     ```json
     {
       "data": [
         {
           "timestamp": "23/06/2026 23:30",
           "kwh": "48438.74",
           "kvah": "52313.84",
           "voltR": "226"
         }
       ]
     }
     ```
   * *Quirks:* 
     * Timestamps use Indian/UK standard format (`DD/MM/YYYY HH:mm`) rather than ISO 8601.
     * Electrical quantities (`kwh`, `kvah`, `voltR`) are string types.

---

## 4. The "Secret" Bulk Export Endpoint (HMAC Authorization)

During inspection of the transformers chunk (`/_app/immutable/nodes/4.*.js`), we discovered that the portal contains an administrative bulk export feature.

### Mechanism:
1. **Fetch Signing Secret:**
   * **Endpoint:** `GET /portal/keys`
   * **Response:**
     ```json
     {
       "data": {
         "signingSecret": "I3dZPPf5CgTp7JyGNMI8i6z8LFR7TmSR"
       }
     }
     ```
2. **HMAC Signature Generation:**
   * A signature is computed using HMAC-SHA256:
   * **String to sign:**
     ```
     GET\n/portal/export\npage=1\n{timestampInSeconds}
     ```
   * **Key:** `signingSecret`
   * **Output:** Hex-encoded HMAC hash.
3. **Bulk Export Request:**
   * **Endpoint:** `GET /portal/export?page=1`
   * **Headers:**
     * `x-timestamp`: Unix timestamp in seconds (e.g. `1793222140`)
     * `x-signature`: Computed HMAC hex string
4. **Data Returned:**
   The bulk export returns the **entire dataset of 403 smart meters in a single HTTP call**, complete with:
   * Meter identification (`meterId`, `serialNo`, `make`, `phaseType`, `installStatus`, `installType`, `build`)
   * Full 7-tier electrical network hierarchy (`zone` → `circle` → `division` → `subdivision` → `substation` → `feeder` → `dt`)
   * Geographic coordinates (`geo: { lat, lng }`)

---

## 5. Summary of Quirks, Pitfalls & Solutions

| Portal Characteristic | Behavior / Quirk | Wrapper Solution |
| :--- | :--- | :--- |
| **CSRF Protection** | Rejects POST requests without `Origin` header (`403 Forbidden`). | Upstream client injects valid `Origin` and `Referer` headers. |
| **Session Lifetime** | Sessions expire after 1 hour (`Max-Age=3600`). | Client tracks expiration and transparently retries requests on 401/403. |
| **Stringified Numbers** | `kwh`, `kvah`, `voltR`, `lat`, and `lng` are returned as strings. | API normalizes values to strict IEEE 754 floating-point numbers. |
| **Non-Standard Dates** | Telemetry dates use `DD/MM/YYYY HH:mm`. | API parses them into standard ISO 8601 UTC strings (`isoTimestamp`). |
| **Multiple Data Paths** | Telemetry can be fetched per-meter, or bulk downloaded via HMAC. | Hybrid architecture: fast in-memory index hydrated via HMAC bulk export, with live per-meter telemetry calls on demand. |

