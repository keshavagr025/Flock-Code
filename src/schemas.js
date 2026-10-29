// src/schemas.js - OpenAPI / JSON schemas for the API service

export const MeterSummarySchema = {
  type: 'object',
  properties: {
    meterId: { type: 'string', example: 'J100000' },
    serialNo: { type: 'string', example: 'SE33962' },
    make: { type: 'string', example: 'HPL' },
    phaseType: { type: 'string', enum: ['single', 'three'], example: 'single' },
    installStatus: { type: 'string', enum: ['Installed', 'Faulty', 'Decommissioned'], example: 'Installed' },
    installType: { type: 'string', example: 'Whole Current' },
    build: { type: 'string', example: 'legacy' },
    dtCode: { type: 'string', example: 'DT-001' }
  }
};

export const GeoLocationSchema = {
  type: 'object',
  nullable: true,
  properties: {
    latitude: { type: 'number', example: 26.938961 },
    longitude: { type: 'number', example: 75.830956 }
  }
};

export const HierarchyNodeSchema = {
  type: 'object',
  nullable: true,
  properties: {
    name: { type: 'string', example: 'Jaipur Zone 1' },
    code: { type: 'string', nullable: true, example: 'Z-01' }
  }
};

export const MeterHierarchySchema = {
  type: 'object',
  nullable: true,
  properties: {
    zone: HierarchyNodeSchema,
    circle: HierarchyNodeSchema,
    division: HierarchyNodeSchema,
    subdivision: HierarchyNodeSchema,
    substation: HierarchyNodeSchema,
    feeder: HierarchyNodeSchema,
    dt: HierarchyNodeSchema
  }
};

export const MeterDetailSchema = {
  type: 'object',
  properties: {
    meterId: { type: 'string', example: 'J100000' },
    serialNo: { type: 'string', example: 'SE33962' },
    make: { type: 'string', example: 'HPL' },
    phaseType: { type: 'string', example: 'single' },
    installStatus: { type: 'string', example: 'Installed' },
    installType: { type: 'string', example: 'Whole Current' },
    build: { type: 'string', example: 'legacy' },
    dtCode: { type: 'string', example: 'DT-001' },
    geo: GeoLocationSchema,
    hierarchy: MeterHierarchySchema
  }
};

export const EnergyReadingSchema = {
  type: 'object',
  properties: {
    timestamp: { type: 'string', example: '23/06/2026 23:30' },
    isoTimestamp: { type: 'string', nullable: true, example: '2026-06-23T23:30:00Z' },
    kwh: { type: 'number', example: 48438.74 },
    kvah: { type: 'number', example: 52313.84 },
    voltR: { type: 'number', example: 226 }
  }
};

export const TransformerSchema = {
  type: 'object',
  properties: {
    code: { type: 'string', example: 'DT-001' },
    name: { type: 'string', example: 'Malviya Nagar DT 1' },
    feederCode: { type: 'string', example: 'F-001' },
    capacityKva: { type: 'number', example: 100 }
  }
};

export const ErrorResponseSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 404 },
    error: { type: 'string', example: 'Not Found' },
    message: { type: 'string', example: 'Meter J999999 not found' }
  }
};

