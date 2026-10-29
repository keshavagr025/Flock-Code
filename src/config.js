// src/config.js - Configuration settings for the Urja API service
import process from 'node:process';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  portal: {
    baseUrl: process.env.URJA_BASE_URL || 'https://urja-ops.flockenergy.tech',
    email: process.env.URJA_EMAIL || 'operator@urja.local',
    password: process.env.URJA_PASSWORD || 'urja-ops-2026',
    // Cache TTL in milliseconds (default 5 minutes)
    cacheTtlMs: parseInt(process.env.CACHE_TTL_MS || String(5 * 60 * 1000), 10),
    // Request timeout in milliseconds
    timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10)
  }
};

