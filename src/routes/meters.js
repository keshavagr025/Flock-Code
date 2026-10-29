// src/routes/meters.js - Routes for Smart Meter management and querying
import { urjaClient } from '../client.js';
import {
  MeterDetailSchema,
  ErrorResponseSchema,
  EnergyReadingSchema
} from '../schemas.js';

/**
 * Calculates Haversine distance between two coordinates in kilometers.
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parses Urja timestamp format "DD/MM/YYYY HH:mm" into an ISO string.
 */
function parseUrjaTimestamp(tsStr) {
  if (!tsStr) return null;
  const [datePart, timePart] = tsStr.split(' ');
  if (!datePart || !timePart) return null;
  const [day, month, year] = datePart.split('/');
  const [hour, minute] = timePart.split(':');
  const d = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hour, 10), parseInt(minute, 10)));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default async function meterRoutes(fastify, options) {

  // 1. List / Query Meters
  fastify.get('/meters', {
    schema: {
      tags: ['Meters'],
      summary: 'List and filter smart meters',
      description: 'Retrieve a paginated list of smart meters with optional filtering by search text, make, phase, status, or transformer.',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search term for Meter ID or Serial Number' },
          make: { type: 'string', description: 'Filter by meter manufacturer (e.g. HPL, L&T, Genus, Allied)' },
          phase: { type: 'string', enum: ['single', 'three'], description: 'Filter by phase type' },
          status: { type: 'string', enum: ['Installed', 'Faulty', 'Decommissioned'], description: 'Filter by installation status' },
          dtCode: { type: 'string', description: 'Filter by Distribution Transformer code (e.g. DT-001)' },
          page: { type: 'integer', default: 1, minimum: 1, description: 'Page number' },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100, description: 'Items per page' }
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
              items: MeterDetailSchema
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    // Ensure cache is hydrated
    await urjaClient.hydrateCache();
    const { q, make, phase, status, dtCode, page = 1, limit = 20 } = req.query;

    let filtered = urjaClient.cache.meters;

    if (q) {
      const qLower = q.toLowerCase();
      filtered = filtered.filter(m =>
        m.meterId.toLowerCase().includes(qLower) ||
        m.serialNo.toLowerCase().includes(qLower)
      );
    }

    if (make) {
      const makeLower = make.toLowerCase();
      filtered = filtered.filter(m => m.make.toLowerCase() === makeLower);
    }

    if (phase) {
      filtered = filtered.filter(m => m.phaseType === phase);
    }

    if (status) {
      const statusLower = status.toLowerCase();
      filtered = filtered.filter(m => m.installStatus.toLowerCase() === statusLower);
    }

    if (dtCode) {
      const dtLower = dtCode.toLowerCase();
      filtered = filtered.filter(m => (m.dtCode || '').toLowerCase() === dtLower);
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      total,
      page,
      limit,
      totalPages,
      data: paginated
    };
  });

  // 2. Geospatial Query - Nearby Meters
  fastify.get('/meters/nearby', {
    schema: {
      tags: ['Meters', 'Spatial Query'],
      summary: 'Find meters near a geographic location',
      description: 'Search for meters located within a given radius (in km) from specified latitude and longitude coordinates.',
      querystring: {
        type: 'object',
        required: ['lat', 'lng'],
        properties: {
          lat: { type: 'number', description: 'Latitude of center point' },
          lng: { type: 'number', description: 'Longitude of center point' },
          radiusKm: { type: 'number', default: 5, description: 'Search radius in kilometers' },
          limit: { type: 'integer', default: 50, maximum: 200 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            center: {
              type: 'object',
              properties: {
                lat: { type: 'number' },
                lng: { type: 'number' }
              }
            },
            radiusKm: { type: 'number' },
            totalFound: { type: 'integer' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  meter: MeterDetailSchema,
                  distanceKm: { type: 'number' }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    await urjaClient.hydrateCache();
    const { lat, lng, radiusKm = 5, limit = 50 } = req.query;

    const results = [];
    for (const meter of urjaClient.cache.meters) {
      if (meter.geo && typeof meter.geo.latitude === 'number' && typeof meter.geo.longitude === 'number') {
        const dist = haversineDistanceKm(lat, lng, meter.geo.latitude, meter.geo.longitude);
        if (dist <= radiusKm) {
          results.push({
            meter,
            distanceKm: Math.round(dist * 1000) / 1000
          });
        }
      }
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);
    const sliced = results.slice(0, limit);

    return {
      center: { lat, lng },
      radiusKm,
      totalFound: results.length,
      data: sliced
    };
  });

  // 3. Get Meter By ID
  fastify.get('/meters/:id', {
    schema: {
      tags: ['Meters'],
      summary: 'Get smart meter details by ID',
      description: 'Fetches detailed information for a specific meter, including nameplate specifications, network hierarchy, and geo coordinates.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Meter ID (e.g. J100000)' }
        }
      },
      response: {
        200: MeterDetailSchema,
        404: ErrorResponseSchema
      }
    }
  }, async (req, reply) => {
    await urjaClient.hydrateCache();
    const { id } = req.params;

    const meter = urjaClient.cache.metersById.get(id);
    if (!meter) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Meter with ID '${id}' was not found.`
      });
    }

    return meter;
  });

  // 4. Get Meter Consumption / Energy Readings
  fastify.get('/meters/:id/readings', {
    schema: {
      tags: ['Meters', 'Readings'],
      summary: 'Get historical consumption and electrical readings',
      description: 'Fetches normalized time-series readings (kWh, kVAh, voltage) for a specific meter, parsed into clean numbers and ISO timestamps.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Meter ID (e.g. J100000)' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 100, maximum: 500, description: 'Maximum readings to return' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            meterId: { type: 'string' },
            readingCount: { type: 'integer' },
            readings: {
              type: 'array',
              items: EnergyReadingSchema
            }
          }
        },
        404: ErrorResponseSchema
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    const { limit = 100 } = req.query;

    const rawReadings = await urjaClient.fetchMeterEnergy(id);
    if (!rawReadings) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `No energy readings found for meter '${id}'.`
      });
    }

    // Normalize readings: convert strings to numbers and add ISO timestamp
    const normalized = rawReadings.map(r => ({
      timestamp: r.timestamp,
      isoTimestamp: parseUrjaTimestamp(r.timestamp),
      kwh: parseFloat(r.kwh) || 0,
      kvah: parseFloat(r.kvah) || 0,
      voltR: parseFloat(r.voltR) || 0
    }));

    const sliced = normalized.slice(0, limit);

    return {
      meterId: id,
      readingCount: sliced.length,
      readings: sliced
    };
  });
}

