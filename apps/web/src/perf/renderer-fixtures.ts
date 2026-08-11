import type { TransitSystem, Viewport } from '@transitmapper/core/model/system';
import { generatePerfFixture } from './fixtures';
import { createPortMason, PORT_MASON_RENDERER_CENTER } from './renderer-port-mason-fixture';
import {
  createComplexDiagram,
  createGradeStack,
  createJunctionFixture,
  createNoisyCurves,
  createRailGuideway,
  createSharedServiceTrunk,
} from './renderer-specialized-fixtures';
import type { RendererFixtureDescriptor, RendererFixtureId } from './renderer-fixture-types';

export type { RendererFixtureDescriptor, RendererFixtureId } from './renderer-fixture-types';

const PORT_MASON_CAMERA: Viewport = { center: [...PORT_MASON_RENDERER_CENTER], zoom: 12.2 };
const DENSE_CAMERA: Viewport = { center: [-115.268, 36.0545], zoom: 10 };
const RTC_CAMERA: Viewport = { center: [-115.20325, 36.1115], zoom: 10 };
const JUNCTION_CENTER: [number, number] = [-115.176, 36.13];

export const RENDERER_FIXTURE_DESCRIPTORS: readonly RendererFixtureDescriptor[] = [
  {
    id: 'port-mason',
    label: 'Port Mason reference',
    camera: PORT_MASON_CAMERA,
    viewMode: 'infrastructure',
    create: createPortMason,
  },
  {
    id: 'dense-downtown',
    label: 'Dense downtown',
    camera: DENSE_CAMERA,
    viewMode: 'network',
    create: () => generatePerfFixture('dense'),
  },
  {
    id: 'rtc-scale',
    label: 'RTC scale',
    camera: RTC_CAMERA,
    viewMode: 'infrastructure',
    create: () => generatePerfFixture('rtc'),
  },
  {
    id: 'acute-junction',
    label: 'Acute junction',
    camera: { center: JUNCTION_CENTER, zoom: 17.5 },
    viewMode: 'infrastructure',
    create: () => createJunctionFixture('acute-junction', [0, 164, 205]),
  },
  {
    id: 'five-arm-junction',
    label: 'Five-arm junction',
    camera: { center: JUNCTION_CENTER, zoom: 17.5 },
    viewMode: 'infrastructure',
    create: () => createJunctionFixture('five-arm-junction', [5, 73, 145, 218, 292]),
  },
  {
    id: 'grade-stack',
    label: 'Grade stack',
    camera: { center: JUNCTION_CENTER, zoom: 17 },
    viewMode: 'infrastructure',
    create: createGradeStack,
  },
  {
    id: 'noisy-curves',
    label: 'Noisy curves',
    camera: { center: JUNCTION_CENTER, zoom: 16.5 },
    viewMode: 'infrastructure',
    create: createNoisyCurves,
  },
  {
    id: 'rail-guideway',
    label: 'Rail guideway',
    camera: { center: JUNCTION_CENTER, zoom: 17 },
    viewMode: 'infrastructure',
    create: createRailGuideway,
  },
  {
    id: 'shared-service-trunk',
    label: 'Shared service trunk',
    camera: { center: JUNCTION_CENTER, zoom: 16 },
    viewMode: 'network',
    create: createSharedServiceTrunk,
  },
  {
    id: 'complex-diagram',
    label: 'Complex Diagram',
    camera: PORT_MASON_CAMERA,
    viewMode: 'diagram',
    create: createComplexDiagram,
  },
];

const DESCRIPTOR_BY_ID = new Map(
  RENDERER_FIXTURE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

function rendererFixtureDescriptor(id: RendererFixtureId): RendererFixtureDescriptor {
  const descriptor = DESCRIPTOR_BY_ID.get(id);
  if (!descriptor) throw new Error(`Unknown renderer fixture: ${id}`);
  return descriptor;
}

export function createRendererFixture(id: RendererFixtureId): TransitSystem {
  return rendererFixtureDescriptor(id).create();
}
