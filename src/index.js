// src/index.js - Entry point for Flock Urja API Service
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config.js';
import { urjaClient } from './client.js';
import meterRoutes from './routes/meters.js';
import transformerRoutes from './routes/transformers.js';
import hierarchyRoutes from './routes/hierarchy.js';
import exportRoutes from './routes/export.js';
import healthRoutes from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
    }
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true
  });

  // Configure OpenAPI / Swagger
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Flock Energy — Urja Meter Ops API',
        description: 'Clean, documented REST API service bridging the Urja Meter Ops distribution metering portal. Provides programmatic access to smart meters, network hierarchy, DT topology, time-series energy consumption, and geospatial queries.',
        version: '1.0.0',
        contact: {
          name: 'Flock Energy Engineering Take-Home'
        }
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Local development server'
        }
      ],
      tags: [
        { name: 'Meters', description: 'Smart meter listings, details, and search' },
        { name: 'Readings', description: 'Normalized time-series energy consumption readings' },
        { name: 'Spatial Query', description: 'Geographic proximity search for meters' },
        { name: 'Transformers', description: 'Distribution Transformers (DTs) and network assets' },
        { name: 'Network Hierarchy', description: 'Electrical grid topology: Zone -> Feeder -> DT -> Meter' },
        { name: 'Bulk Export', description: 'HMAC-signed full dataset export' },
        { name: 'System', description: 'Health check and operational diagnostics' }
      ]
    }
  });

  // Interactive Swagger UI documentation at /docs
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    },
    staticCSP: true,
    transformStaticCSP: (header) => header
  });

  // Serve raw OpenAPI JSON at /openapi.json
  fastify.get('/openapi.json', { schema: { hide: true } }, async (req, reply) => {
    return fastify.swagger();
  });

  // Serve Modern Web Client UI from /public
  const publicDir = path.join(rootDir, 'public');
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/app/',
    decorateReply: false
  });

  // Redirect root / to /app/ or /docs
  fastify.get('/', { schema: { hide: true } }, async (req, reply) => {
    return reply.redirect('/app/');
  });

  // Register API routes
  await fastify.register(healthRoutes);
  await fastify.register(meterRoutes, { prefix: '/api/v1' });
  await fastify.register(transformerRoutes, { prefix: '/api/v1' });
  await fastify.register(hierarchyRoutes, { prefix: '/api/v1' });
  await fastify.register(exportRoutes, { prefix: '/api/v1' });

  return fastify;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n======================================================`);
    console.log(`🚀 Urja API Service running at http://localhost:${config.port}`);
    console.log(`📚 Interactive Swagger UI:   http://localhost:${config.port}/docs`);
    console.log(`📄 OpenAPI Specification:    http://localhost:${config.port}/openapi.json`);
    console.log(`📊 Modern Web Dashboard:     http://localhost:${config.port}/app/`);
    console.log(`======================================================\n`);

    // Export openapi.json file to root directory for repository deliverable
    const spec = app.swagger();
    await fs.writeFile(path.join(rootDir, 'openapi.json'), JSON.stringify(spec, null, 2), 'utf-8');
    console.log('✅ Generated openapi.json in repository root');

    // Pre-hydrate cache in background
    console.log('🔄 Initializing in-memory cache from Urja Ops portal...');
    urjaClient.hydrateCache()
      .then(cache => {
        console.log(`✅ Cache hydrated: ${cache.meters.length} meters, ${cache.transformers.length} transformers.`);
      })
      .catch(err => {
        console.warn(`⚠️ Background cache hydration warning: ${err.message}. Will retry on next request.`);
      });

  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// If executed directly, run start
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}
