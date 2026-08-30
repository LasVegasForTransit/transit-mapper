import { describe, expect, it } from 'vitest';
import {
  LYR_CONNECTORS,
  LYR_JUNCTION_GUIDES,
  LYR_LINE_CASING,
  LYR_LINE_STRIPE,
  LYR_LINE_STRIPE_SELECTED,
  LYR_LINE_STRIPE_HIT,
  LYR_SERVICES_HIT,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_SERVICE_SELECTED,
  SRC_CONNECTORS,
  SRC_HIT_FEATURES,
  SRC_JUNCTION_GUIDES,
  SRC_SERVICES,
} from '@transitmapper/renderer/layers';
import { LAYER_SPECS } from '../../../src/map/layers/layerSpecs';
import { ALL_SYSTEM_FEATURE_SOURCES } from '@transitmapper/renderer/layers';

describe('service occurrence hit layer', () => {
  it('uses the same per-feature offset as the painted bundled line', () => {
    const layer = LAYER_SPECS.find((candidate) => candidate.id === LYR_SERVICES_HIT);

    expect(layer?.type).toBe('line');
    if (layer?.type !== 'line') throw new Error('service hit layer is missing');
    expect(layer.source).toBe(SRC_HIT_FEATURES);
    expect(layer.paint?.['line-offset']).toEqual(['get', 'offset']);
  });

  it('uses visible Line stripes for Network paint and hit geometry', () => {
    const casing = LAYER_SPECS.find((candidate) => candidate.id === LYR_LINE_CASING);
    const stripe = LAYER_SPECS.find((candidate) => candidate.id === LYR_LINE_STRIPE);
    const selected = LAYER_SPECS.find((candidate) => candidate.id === LYR_LINE_STRIPE_SELECTED);
    const hit = LAYER_SPECS.find((candidate) => candidate.id === LYR_LINE_STRIPE_HIT);

    if (casing?.type !== 'line') throw new Error('Line casing layer is missing');
    if (stripe?.type !== 'line') throw new Error('Line stripe layer is missing');
    if (selected?.type !== 'line') throw new Error('Line stripe selection layer is missing');
    if (hit?.type !== 'line') throw new Error('Line stripe hit layer is missing');

    expect(casing.source).toBe(SRC_SERVICES);
    expect(casing.filter).toEqual(['==', ['get', 'routeRole'], 'casing']);
    expect(stripe.source).toBe(SRC_SERVICES);
    expect(stripe.filter).toEqual(['==', ['get', 'routeRole'], 'stripe']);
    expect(selected.source).toBe(SRC_SERVICES);
    expect(selected.filter).toEqual(['==', ['get', 'routeRole'], 'stripe']);
    expect(hit.source).toBe(SRC_SERVICES);
    expect(hit.filter).toEqual(['==', ['get', 'routeRole'], 'stripe']);
    expect(hit.paint?.['line-opacity']).toBe(0);
    expect(hit.paint?.['line-width']).toBe(24);
  });

  it('keeps Line scene features out of legacy Service paint layers', () => {
    const legacyServiceLayerIds = [
      LYR_SERVICES_ELEVATED,
      LYR_SERVICE_SELECTED,
      LYR_SERVICES_SOLID_CASING,
      LYR_SERVICES_SOLID,
      LYR_SERVICES_UNDERGROUND_CASING,
      LYR_SERVICES_UNDERGROUND,
    ];
    const lineSceneExclusion = ['!', ['has', 'routeRole']];

    for (const id of legacyServiceLayerIds) {
      const layer = LAYER_SPECS.find((candidate) => candidate.id === id);
      if (!layer || !('filter' in layer)) throw new Error(`Missing legacy Service layer ${id}`);
      expect(JSON.stringify(layer.filter), id).toContain(JSON.stringify(lineSceneExclusion));
    }
  });

  it('service termini paint above service and corridor lines for hit priority', () => {
    const terminus = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-service-termini');
    const service = LAYER_SPECS.findIndex((layer) => layer.id === LYR_SERVICES_HIT);
    const corridor = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-ways-solid');

    expect(terminus).toBeGreaterThan(service);
    expect(terminus).toBeGreaterThan(corridor);
  });

  it('the action anchor paints above the line it resolves', () => {
    const anchor = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-action-anchor');
    const service = LAYER_SPECS.findIndex((layer) => layer.id === LYR_SERVICES_HIT);

    expect(anchor).toBeGreaterThan(service);
  });

  it('keeps selected-junction guides on a transient source above renderer connectors', () => {
    const rendererConnectors = LAYER_SPECS.find((candidate) => candidate.id === LYR_CONNECTORS);
    const selectedGuides = LAYER_SPECS.find((candidate) => candidate.id === LYR_JUNCTION_GUIDES);
    const rendererIndex = LAYER_SPECS.findIndex((layer) => layer.id === LYR_CONNECTORS);
    const guideIndex = LAYER_SPECS.findIndex((layer) => layer.id === LYR_JUNCTION_GUIDES);

    if (rendererConnectors?.type !== 'line') throw new Error('renderer connector layer is missing');
    if (selectedGuides?.type !== 'line') throw new Error('junction guide layer is missing');
    expect(rendererConnectors.source).toBe(SRC_CONNECTORS);
    expect(SRC_JUNCTION_GUIDES).toBe('tm-junction-guides');
    expect(selectedGuides.source).toBe(SRC_JUNCTION_GUIDES);
    expect(guideIndex).toBeGreaterThan(rendererIndex);
    expect(ALL_SYSTEM_FEATURE_SOURCES).toContain(SRC_CONNECTORS);
    expect(ALL_SYSTEM_FEATURE_SOURCES).not.toContain(SRC_JUNCTION_GUIDES);
  });
});
