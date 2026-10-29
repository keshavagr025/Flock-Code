// test/api.test.js - Comprehensive integration test suite for Flock Urja API
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { urjaClient } from '../src/client.js';

test('Urja API Service Integration Tests', async (t) => {
  const app = await buildApp();

  await t.test('1. GET /health should report service status and cache metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'healthy');
    assert.ok(typeof body.uptimeSeconds === 'number');
    assert.ok(body.upstream);
    assert.ok(body.cache);
  });

  await t.test('2. GET /openapi.json should return valid OpenAPI 3.0 specification', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json'
    });

    assert.equal(res.statusCode, 200);
    const spec = JSON.parse(res.body);
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'Flock Energy — Urja Meter Ops API');
    assert.ok(spec.paths['/api/v1/meters']);
    assert.ok(spec.paths['/api/v1/meters/{id}']);
    assert.ok(spec.paths['/api/v1/meters/{id}/readings']);
    assert.ok(spec.paths['/api/v1/meters/nearby']);
    assert.ok(spec.paths['/api/v1/transformers']);
    assert.ok(spec.paths['/api/v1/hierarchy']);
    assert.ok(spec.paths['/api/v1/export']);
  });

  await t.test('3. UrjaClient upstream authentication and cache hydration', async () => {
    const cache = await urjaClient.hydrateCache();
    assert.ok(cache.meters.length > 0, 'Meters should be loaded into cache');
    assert.ok(cache.transformers.length > 0, 'Transformers should be loaded into cache');
    assert.ok(cache.hierarchyTree, 'Hierarchy tree should be constructed');
    assert.ok(urjaClient.sessionToken, 'Session token should be populated');
  });

  await t.test('4. GET /api/v1/meters should return paginated list of smart meters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters?page=1&limit=10'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.page, 1);
    assert.equal(body.limit, 10);
    assert.ok(body.total >= 400, 'Total meters should be around 403');
    assert.equal(body.data.length, 10);

    const first = body.data[0];
    assert.ok(first.meterId);
    assert.ok(first.serialNo);
    assert.ok(first.make);
    assert.ok(first.phaseType);
    assert.ok(first.installStatus);
  });

  await t.test('5. GET /api/v1/meters with filters (make, status, phase)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters?phase=single&status=Installed'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    for (const m of body.data) {
      assert.equal(m.phaseType, 'single');
      assert.equal(m.installStatus, 'Installed');
    }
  });

  await t.test('6. GET /api/v1/meters/:id should return single meter details with hierarchy & geo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters/J100000'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.meterId, 'J100000');
    assert.ok(body.hierarchy);
    assert.ok(body.geo);
    assert.ok(typeof body.geo.latitude === 'number');
    assert.ok(typeof body.geo.longitude === 'number');
  });

  await t.test('7. GET /api/v1/meters/:id for invalid ID should return 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters/NON_EXISTENT_ID'
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 404);
    assert.equal(body.error, 'Not Found');
  });

  await t.test('8. GET /api/v1/meters/:id/readings should return parsed time-series readings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters/J100000/readings?limit=5'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.meterId, 'J100000');
    assert.equal(body.readings.length, 5);

    const firstReading = body.readings[0];
    assert.ok(firstReading.timestamp);
    assert.ok(firstReading.isoTimestamp);
    assert.ok(typeof firstReading.kwh === 'number');
    assert.ok(typeof firstReading.kvah === 'number');
    assert.ok(typeof firstReading.voltR === 'number');
  });

  await t.test('9. GET /api/v1/meters/nearby should perform spatial proximity query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=10'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.totalFound > 0);
    assert.ok(body.data.length > 0);
    assert.ok(body.data[0].distanceKm <= 10);
  });

  await t.test('10. GET /api/v1/transformers should return DTs with connected meters count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/transformers?page=1&limit=5'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.total > 0);
    assert.equal(body.data.length, 5);
    assert.ok(typeof body.data[0].connectedMetersCount === 'number');
  });

  await t.test('11. GET /api/v1/hierarchy should return complete network hierarchy tree', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/hierarchy'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.summary.totalMeters > 0);
    assert.ok(body.tree.zones);
  });

  await t.test('12. GET /api/v1/export should return full export dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.total >= 400);
    assert.ok(Array.isArray(body.data));
  });

  await app.close();
});

