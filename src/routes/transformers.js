// src/routes/transformers.js - Routes for Distribution Transformers
import { urjaClient } from '../client.js';
import { TransformerSchema, ErrorResponseSchema } from '../schemas.js';

export default async function transformerRoutes(fastify, options) {

  // 1. List Transformers
  fastify.get('/transformers', {
    schema: {
      tags: ['Transformers'],
      summary: 'List distribution transformers',
      description: 'Retrieve a list of distribution transformers with connected meter counts and feeder information.',
      querystring: {
        type: 'object',
        properties: {
          feederCode: { type: 'string', description: 'Filter by feeder code (e.g. F-001)' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  name: { type: 'string' },
                  feederCode: { type: 'string' },
                  capacityKva: { type: 'number' },
                  connectedMetersCount: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    await urjaClient.hydrateCache();
    const { feederCode, page = 1, limit = 20 } = req.query;

    // Count meters connected to each DT
    const dtMeterCount = new Map();
    for (const meter of urjaClient.cache.meters) {
      if (meter.dtCode) {
        dtMeterCount.set(meter.dtCode, (dtMeterCount.get(meter.dtCode) || 0) + 1);
      }
    }

    let dts = urjaClient.cache.transformers.map(dt => ({
      ...dt,
      connectedMetersCount: dtMeterCount.get(dt.code) || 0
    }));

    if (feederCode) {
      const fLower = feederCode.toLowerCase();
      dts = dts.filter(dt => (dt.feederCode || '').toLowerCase() === fLower);
    }

    const total = dts.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    return {
      total,
      page,
      limit,
      totalPages,
      data: dts.slice(offset, offset + limit)
    };
  });

  // 2. Get Transformer Details + Connected Meters
  fastify.get('/transformers/:code', {
    schema: {
      tags: ['Transformers'],
      summary: 'Get transformer details and connected meters',
      description: 'Returns specifications of a single distribution transformer along with all smart meters connected to it.',
      params: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', description: 'Transformer code (e.g. DT-001)' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            feederCode: { type: 'string' },
            capacityKva: { type: 'number' },
            connectedMetersCount: { type: 'integer' },
            meters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  meterId: { type: 'string' },
                  serialNo: { type: 'string' },
                  phaseType: { type: 'string' },
                  installStatus: { type: 'string' },
                  make: { type: 'string' }
                }
              }
            }
          }
        },
        404: ErrorResponseSchema
      }
    }
  }, async (req, reply) => {
    await urjaClient.hydrateCache();
    const { code } = req.params;

    const dt = urjaClient.cache.transformers.find(d => d.code.toLowerCase() === code.toLowerCase());
    if (!dt) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Transformer '${code}' was not found.`
      });
    }

    const connectedMeters = urjaClient.cache.meters
      .filter(m => (m.dtCode || '').toLowerCase() === code.toLowerCase())
      .map(m => ({
        meterId: m.meterId,
        serialNo: m.serialNo,
        phaseType: m.phaseType,
        installStatus: m.installStatus,
        make: m.make
      }));

    return {
      ...dt,
      connectedMetersCount: connectedMeters.length,
      meters: connectedMeters
    };
  });
}

