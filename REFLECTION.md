# REFLECTION.md — Engineering Decisions & Self-Critique

### 1. What assumptions did you make?
* **Read-only access pattern:** I assumed the utility portal is strictly read-only and that downstream consumers (product, data science, operations) need reliable, structured read access rather than write capabilities (e.g. meter provisioning or commands).
* **Dataset stability & size:** Based on the bulk export reporting 403 meters and 20 distribution transformers, the dataset fits easily in RAM. Therefore, I assumed an in-memory caching and indexing strategy with a 5-minute TTL would provide sub-millisecond response times without overwhelming the legacy server with repetitive queries.
* **Network hierarchy consistency:** I assumed that electrical network relationships (Zone → Circle → Division → Subdivision → Substation → Feeder → Distribution Transformer → Meter) are hierarchical and static over the duration of a session, even though individual readings stream in dynamically.

---

### 2. Which part was the most difficult, and how did you get unstuck?
* **The CSRF and route redirection hurdle:** Initially, attempting to submit credentials to `POST /` resulted in a `403 Forbidden` response and then a `405 Method Not Allowed`. Getting unstuck required methodically inspecting the SvelteKit runtime:
  1. I observed that `GET /` issues a 302 redirect to `/login`. The form action was mounted at `/login`, not `/`.
  2. SvelteKit implements strict cross-site request forgery protection by validating that the `Origin` header matches the host. Once I configured the upstream HTTP client to supply `Origin: https://urja-ops.flockenergy.tech`, authentication succeeded immediately, returning the `__Secure-better-auth.session_token` cookie.
* **Discovering the HMAC signing protocol:** Finding the `/portal/export` endpoint in the compiled client code was exciting, but it failed with an unauthorized status when called directly. By auditing the AST of the Vite bundle for the transformers page, I extracted the signature generation function (`HMAC-SHA256` of `[METHOD, PATH, QUERY, TIMESTAMP]` keyed against the signing secret from `/portal/keys`), unlocking the complete bulk dataset.

---

### 3. If you had another day, what would you improve?
* **Persistent caching with SQLite / Redis:** While in-memory caching is fast and zero-dependency, if multiple instances of this service were deployed behind a load balancer, they would each independently query the legacy portal. Adding a lightweight SQLite or Redis cache with write-through invalidation would keep multiple workers synchronized.
* **Background polling & change-data-capture (CDC):** Instead of refreshing the cache on demand when a request arrives past TTL, I would implement a background cron job that periodically checks for changes in meter status or new readings, emitting webhooks or SSE (Server-Sent Events) to downstream consumers when anomalies (e.g. a meter switching to `Faulty`) are detected.
* **Rate limiting & circuit breaker:** If the legacy portal slows down or becomes temporarily unavailable, our client should trip a circuit breaker to serve stale cache gracefully rather than cascading failures to callers.

---

### 4. What mistake did you make while solving this?
* **Assuming login could be submitted to root (`/`):** When looking at the rendered HTML, the `<form method="POST">` had no explicit `action` attribute. In standard browser semantics on `/login`, it posts to `/login`, but when probing via fetch script, I initially sent the POST request to `https://urja-ops.flockenergy.tech/`. This returned `405 Method Not Allowed`, confusing me until I remembered that `/` had redirected to `/login` in the browser.
* **Logger configuration assumption:** During the initial test run, I included `pino-pretty` in the Fastify logger options assuming it came bundled with Fastify. Running `npm test` caught this immediately with an unhandled rejection. I resolved it by using clean environment-aware logger settings without unnecessary extra dependencies.

---

### 5. If you were reviewing your own submission, what would you criticise?
* **Coupling of upstream client and in-memory cache:** In `UrjaClient`, the upstream HTTP communication logic and the caching/indexing logic are housed in the same class. While this makes the codebase simple and readable for a 4–6 hour take-home, in a larger production microservice, the HTTP client (data fetcher) and the repository/index layer (query interface) should be separate classes with dependency injection.
* **Bulk export dependency for listing:** The service relies on the HMAC bulk export to populate its search index. If the utility portal's engineering team revoked the `/portal/keys` endpoint or changed the signing scheme, the bulk hydration would fail. While the client has direct fallbacks (`/portal/meters/search`), a more resilient architecture would gracefully degrade to page-by-page scraping if the HMAC route ever returned an error.

