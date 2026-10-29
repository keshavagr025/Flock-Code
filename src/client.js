// src/client.js - Reverse-engineered upstream client for Urja Meter Ops portal
import crypto from 'node:crypto';
import { config } from './config.js';

export class UrjaClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.portal.baseUrl;
    this.email = options.email || config.portal.email;
    this.password = options.password || config.portal.password;
    this.timeoutMs = options.timeoutMs || config.portal.timeoutMs;
    this.cacheTtlMs = options.cacheTtlMs || config.portal.cacheTtlMs;

    this.sessionToken = null;
    this.sessionExpiresAt = null;

    // In-memory cache & index
    this.cache = {
      meters: [],
      metersById: new Map(),
      transformers: [],
      hierarchyTree: null,
      lastHydratedAt: null,
      isHydrating: false
    };
  }

  /**
   * Authenticate against Urja Ops portal and retrieve session token.
   * Urja Ops uses SvelteKit + better-auth with CSRF protection (requires Origin header).
   */
  async login() {
    const loginUrl = `${this.baseUrl}/login`;
    const body = new URLSearchParams({
      email: this.email,
      password: this.password
    });

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/login`,
        'User-Agent': 'Flock-Urja-API-Client/1.0'
      },
      body: body.toString(),
      redirect: 'manual'
    });

    if (res.status !== 200 && res.status !== 302 && res.status !== 303) {
      const errText = await res.text();
      throw new Error(`Failed to login to Urja Ops: Status ${res.status} - ${errText}`);
    }

    // Extract __Secure-better-auth.session_token
    const rawCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

    for (const c of rawCookies) {
      if (c.includes('__Secure-better-auth.session_token=')) {
        const match = c.match(/__Secure-better-auth\.session_token=([^;]+)/);
        if (match) {
          this.sessionToken = match[1];
          // Default session TTL: 1 hour (3600 seconds)
          this.sessionExpiresAt = Date.now() + 50 * 60 * 1000; // renew after 50 mins
          break;
        }
      }
    }

    if (!this.sessionToken) {
      throw new Error('Login succeeded but session cookie was not returned.');
    }

    return this.sessionToken;
  }

  /**
   * Ensures a valid active session token exists, renewing if necessary.
   */
  async ensureSession() {
    if (!this.sessionToken || !this.sessionExpiresAt || Date.now() >= this.sessionExpiresAt) {
      await this.login();
    }
    return this.sessionToken;
  }

  /**
   * Internal fetch with automatic session injection and 401/403 retry.
   */
  async fetchWithAuth(path, options = {}) {
    await this.ensureSession();

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers = {
      'Cookie': `__Secure-better-auth.session_token=${this.sessionToken}`,
      'User-Agent': 'Flock-Urja-API-Client/1.0',
      ...(options.headers || {})
    };

    let res = await fetch(url, {
      ...options,
      headers
    });

    // Auto-relogin once if session expired or rejected
    if (res.status === 401 || res.status === 403) {
      await this.login();
      headers['Cookie'] = `__Secure-better-auth.session_token=${this.sessionToken}`;
      res = await fetch(url, {
        ...options,
        headers
      });
    }

    return res;
  }

  /**
   * Fetch the HMAC signing secret used for bulk exports.
   */
  async fetchSigningSecret() {
    const res = await this.fetchWithAuth('/portal/keys');
    if (!res.ok) {
      throw new Error(`Failed to fetch signing secret: Status ${res.status}`);
    }
    const json = await res.json();
    return json.data.signingSecret;
  }

  /**
   * Generate an HMAC-SHA256 signature for the portal bulk export route.
   */
  generateHmacSignature(method, path, query, secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = [method, path, query, timestamp].join('\n');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const signature = hmac.digest('hex');
    return { timestamp, signature };
  }

  /**
   * Fetch the full bulk export of meters from /portal/export using HMAC auth.
   */
  async fetchBulkExport(page = 1) {
    const secret = await this.fetchSigningSecret();
    const method = 'GET';
    const path = '/portal/export';
    const query = `page=${page}`;
    const { timestamp, signature } = this.generateHmacSignature(method, path, query, secret);

    const res = await this.fetchWithAuth(`${path}?${query}`, {
      headers: {
        'x-timestamp': timestamp,
        'x-signature': signature
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch bulk export: Status ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Search meters using the portal's search endpoint.
   */
  async searchMeters(query = '', page = 1) {
    const path = `/portal/meters/search?q=${encodeURIComponent(query)}&page=${page}`;
    const res = await this.fetchWithAuth(path);
    if (!res.ok) {
      throw new Error(`Failed to search meters: Status ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Fetch paginated Distribution Transformers from /portal/dts.
   */
  async fetchTransformers(page = 1) {
    const path = `/portal/dts?page=${page}`;
    const res = await this.fetchWithAuth(path);
    if (!res.ok) {
      throw new Error(`Failed to fetch transformers: Status ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Fetch latitude and longitude for a specific meter.
   */
  async fetchMeterGeo(meterId) {
    const path = `/portal/meters/${encodeURIComponent(meterId)}/geo`;
    const res = await this.fetchWithAuth(path);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to fetch meter geo for ${meterId}: Status ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Fetch recent time-series energy consumption readings for a meter.
   */
  async fetchMeterEnergy(meterId) {
    const path = `/portal/meters/${encodeURIComponent(meterId)}/energy`;
    const res = await this.fetchWithAuth(path);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to fetch energy readings for ${meterId}: Status ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Hydrates the local in-memory cache using the bulk export and transformer endpoints.
   */
  async hydrateCache(force = false) {
    const now = Date.now();
    if (!force && this.cache.lastHydratedAt && (now - this.cache.lastHydratedAt < this.cacheTtlMs)) {
      return this.cache;
    }

    if (this.cache.isHydrating) {
      // Return existing cache while hydration runs
      return this.cache;
    }

    this.cache.isHydrating = true;
    try {
      // 1. Fetch bulk export of meters
      const bulkData = await this.fetchBulkExport(1);
      const rawMeters = bulkData.data || [];

      // 2. Normalize and index meters
      const metersById = new Map();
      const normalizedMeters = rawMeters.map(m => {
        const item = {
          meterId: m.meterId,
          serialNo: m.serialNo,
          make: m.make,
          phaseType: m.phaseType,
          installStatus: m.installStatus,
          installType: m.installType || 'Unknown',
          build: m.build || 'Unknown',
          dtCode: m.dtCode,
          hierarchy: m.hierarchy || null,
          geo: m.geo ? {
            latitude: typeof m.geo.lat === 'string' ? parseFloat(m.geo.lat) : m.geo.lat,
            longitude: typeof m.geo.lng === 'string' ? parseFloat(m.geo.lng) : m.geo.lng
          } : null
        };
        metersById.set(item.meterId, item);
        return item;
      });

      // 3. Fetch transformers
      let allTransformers = [];
      let dtPage = 1;
      let totalDtPages = 1;
      do {
        const dtRes = await this.fetchTransformers(dtPage);
        const dtList = dtRes.data || [];
        allTransformers.push(...dtList);
        totalDtPages = Math.ceil((dtRes.total || dtList.length) / 20) || 1;
        dtPage++;
      } while (dtPage <= totalDtPages && dtPage <= 10);

      // 4. Reconstruct network hierarchy tree
      const hierarchyTree = this.buildHierarchyTree(normalizedMeters, allTransformers);

      this.cache.meters = normalizedMeters;
      this.cache.metersById = metersById;
      this.cache.transformers = allTransformers;
      this.cache.hierarchyTree = hierarchyTree;
      this.cache.lastHydratedAt = Date.now();

      return this.cache;
    } finally {
      this.cache.isHydrating = false;
    }
  }

  /**
   * Reconstruct the network hierarchy tree from zones down to individual meters.
   */
  buildHierarchyTree(meters, transformers) {
    const tree = { zones: {} };

    // DT lookup map
    const dtMap = new Map();
    for (const dt of transformers) {
      dtMap.set(dt.code, dt);
    }

    for (const meter of meters) {
      const h = meter.hierarchy || {};
      const zoneName = h.zone?.name || 'Unassigned Zone';
      const circleName = h.circle?.name || 'Unassigned Circle';
      const divisionName = h.division?.name || 'Unassigned Division';
      const subDivisionName = h.subdivision?.name || 'Unassigned SubDivision';
      const substationName = h.substation?.name || 'Unassigned Substation';
      const feederName = h.feeder?.name || (h.feeder?.code ? `Feeder ${h.feeder.code}` : 'Unassigned Feeder');
      const dtCode = meter.dtCode || h.dt?.code || 'Unassigned DT';
      const dtName = h.dt?.name || dtMap.get(dtCode)?.name || dtCode;

      // Ensure nested paths
      tree.zones[zoneName] = tree.zones[zoneName] || { code: h.zone?.code || null, circles: {} };
      const circles = tree.zones[zoneName].circles;

      circles[circleName] = circles[circleName] || { code: h.circle?.code || null, divisions: {} };
      const divisions = circles[circleName].divisions;

      divisions[divisionName] = divisions[divisionName] || { code: h.division?.code || null, subDivisions: {} };
      const subDivisions = divisions[divisionName].subDivisions;

      subDivisions[subDivisionName] = subDivisions[subDivisionName] || { code: h.subdivision?.code || null, substations: {} };
      const substations = subDivisions[subDivisionName].substations;

      substations[substationName] = substations[substationName] || { code: h.substation?.code || null, feeders: {} };
      const feeders = substations[substationName].feeders;

      feeders[feederName] = feeders[feederName] || { code: h.feeder?.code || null, dts: {} };
      const dts = feeders[feederName].dts;

      dts[dtCode] = dts[dtCode] || {
        code: dtCode,
        name: dtName,
        capacityKva: dtMap.get(dtCode)?.capacityKva || null,
        meters: []
      };

      dts[dtCode].meters.push({
        meterId: meter.meterId,
        serialNo: meter.serialNo,
        phaseType: meter.phaseType,
        installStatus: meter.installStatus,
        make: meter.make
      });
    }

    return tree;
  }
}

// Export singleton instance
export const urjaClient = new UrjaClient();

