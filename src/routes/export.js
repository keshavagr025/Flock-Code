// src/routes/export.js - Bulk export route using upstream HMAC-SHA256 signature
import { urjaClient } from '../client.js';

export default async function exportRoutes(fastify, options) {

  fastify.get('/export', {
    schema: {
      tags: ['Bulk Export'],
      summary: 'Export complete meter dataset with HMAC authorization',
      description: 'Fetches the complete dataset using the upstream HMAC-SHA256 signed /portal/export route. Ideal for data pipelines and analytics integrations.',
      querystring: {
        type: 'object',
        properties: {
          fresh: { type: 'boolean', default: false, description: 'Force a live query to the upstream portal instead of returning cached export' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            source: { type: 'string', example: 'upstream-hmac-export' },
            exportedAt: { type: 'string' },
            total: { type: 'integer' },
            data: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { fresh } = req.query;

    if (fresh) {
      const liveData = await urjaClient.fetchBulkExport(1);
      return {
        source: 'live-upstream-hmac-export',
        exportedAt: new Date().toISOString(),
        total: liveData.total || liveData.data?.length || 0,
        data: liveData.data || []
      };
    }

    await urjaClient.hydrateCache();
    return {
      source: 'cached-export',
      exportedAt: urjaClient.cache.lastHydratedAt ? new Date(urjaClient.cache.lastHydratedAt).toISOString() : new Date().toISOString(),
      total: urjaClient.cache.meters.length,
      data: urjaClient.cache.meters
    };
  });
}

