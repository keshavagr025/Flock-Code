// src/routes/hierarchy.js - Network topology and electrical hierarchy tree
import { urjaClient } from '../client.js';

export default async function hierarchyRoutes(fastify, options) {

  fastify.get('/hierarchy', {
    schema: {
      tags: ['Network Hierarchy'],
      summary: 'Get reconstructed electrical network hierarchy',
      description: 'Reconstructs the hierarchical structure of the electricity distribution grid: Zones -> Circles -> Divisions -> Subdivisions -> Substations -> Feeders -> DTs -> Meters.',
      response: {
        200: {
          type: 'object',
          properties: {
            summary: {
              type: 'object',
              properties: {
                totalMeters: { type: 'integer' },
                totalTransformers: { type: 'integer' },
                lastHydratedAt: { type: 'string', nullable: true }
              }
            },
            tree: {
              type: 'object',
              additionalProperties: true
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    await urjaClient.hydrateCache();

    return {
      summary: {
        totalMeters: urjaClient.cache.meters.length,
        totalTransformers: urjaClient.cache.transformers.length,
        lastHydratedAt: urjaClient.cache.lastHydratedAt ? new Date(urjaClient.cache.lastHydratedAt).toISOString() : null
      },
      tree: urjaClient.cache.hierarchyTree
    };
  });
}

