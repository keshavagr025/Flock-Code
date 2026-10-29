// src/routes/health.js - Service health check and cache status
import process from 'node:process';
import { urjaClient } from '../client.js';

export default async function healthRoutes(fastify, options) {

  fastify.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Service health and cache diagnostics',
      description: 'Reports service uptime, upstream portal session status, and cache hydration metrics.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            timestamp: { type: 'string' },
            uptimeSeconds: { type: 'number' },
            upstream: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                authenticated: { type: 'boolean' },
                sessionExpiresAt: { type: 'string', nullable: true }
              }
            },
            cache: {
              type: 'object',
              properties: {
                metersCount: { type: 'integer' },
                transformersCount: { type: 'integer' },
                lastHydratedAt: { type: 'string', nullable: true },
                cacheTtlMs: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      upstream: {
        url: urjaClient.baseUrl,
        authenticated: Boolean(urjaClient.sessionToken),
        sessionExpiresAt: urjaClient.sessionExpiresAt ? new Date(urjaClient.sessionExpiresAt).toISOString() : null
      },
      cache: {
        metersCount: urjaClient.cache.meters.length,
        transformersCount: urjaClient.cache.transformers.length,
        lastHydratedAt: urjaClient.cache.lastHydratedAt ? new Date(urjaClient.cache.lastHydratedAt).toISOString() : null,
        cacheTtlMs: urjaClient.cacheTtlMs
      }
    };
  });
}

