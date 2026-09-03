import { describe, expect, it } from 'vitest';
import {
  parseAlignment,
  parseApproachControls,
  parseFacility,
  parseGroup,
  parseMedians,
  parseNamedWay,
  parseNode,
  parseStation,
  parseStop,
  parseTurnRestrictions,
  parseVehicleKind,
  parseWay,
} from '../../../src/model/schema-v17-system/parse-infrastructure-records';

describe('schema-v17 infrastructure record parsing', () => {
  it('preserves every portable infrastructure field', () => {
    expect(
      parseAlignment(
        {
          id: 'alignment-a',
          points: [
            [-115.2, 36.1],
            [-115.18, 36.11],
            [-115.16, 36.12],
          ],
          geometry: 'curved',
          curveControls: [{ pointIndex: 1, radiusMeters: 24 }],
        },
        'Alignment',
      ),
    ).toEqual({
      id: 'alignment-a',
      points: [
        [-115.2, 36.1],
        [-115.18, 36.11],
        [-115.16, 36.12],
      ],
      geometry: 'curved',
      curveControls: [{ pointIndex: 1, radiusMeters: 24 }],
    });

    expect(
      parseWay(
        {
          id: 'way-a',
          alignmentId: 'alignment-a',
          typeId: 'road',
          classId: 'arterial',
          grade: 'atGrade',
          profile: {
            lanes: [
              { id: 'forward', kindId: 'bus', widthMeters: 3.2, direction: 'forward' },
              { id: 'reverse', kindId: 'bus', widthMeters: 3.2, direction: 'reverse' },
              { id: 'both', kindId: 'rail', widthMeters: 3, direction: 'both' },
              { id: 'closed', kindId: 'shoulder', widthMeters: 1, direction: 'none' },
            ],
          },
        },
        'Way',
      ),
    ).toMatchObject({ id: 'way-a', classId: 'arterial', grade: 'atGrade' });

    expect(
      parseStop(
        {
          id: 'stop-a',
          name: 'Main Street',
          coord: [-115.18, 36.11],
          stationId: 'station-a',
          anchors: [{ alignmentId: 'alignment-a', t: 0.5 }],
          autoNamed: false,
          dwellSeconds: 30,
          majorStop: true,
        },
        'Stop',
      ),
    ).toMatchObject({
      id: 'stop-a',
      name: 'Main Street',
      stationId: 'station-a',
      autoNamed: false,
      dwellSeconds: 30,
      majorStop: true,
    });

    expect(
      parseStation(
        {
          id: 'station-a',
          name: 'Central Station',
          coord: [-115.18, 36.11],
          footprint: [
            [-115.181, 36.109],
            [-115.179, 36.111],
          ],
          platforms: [
            {
              id: 'platform-a',
              points: [
                [-115.181, 36.11],
                [-115.179, 36.11],
              ],
              edges: 2,
            },
          ],
        },
        'Station',
      ),
    ).toMatchObject({
      id: 'station-a',
      name: 'Central Station',
      platforms: [{ id: 'platform-a', edges: 2 }],
    });

    expect(
      parseFacility(
        { id: 'facility-a', typeId: 'depot', name: 'Depot', geometry: [-115.17, 36.1] },
        'Facility',
      ),
    ).toEqual({
      id: 'facility-a',
      typeId: 'depot',
      name: 'Depot',
      geometry: [-115.17, 36.1],
    });
    expect(
      parseFacility(
        {
          id: 'facility-b',
          typeId: 'yard',
          geometry: [
            [-115.18, 36.1],
            [-115.17, 36.1],
          ],
        },
        'Facility',
      ).geometry,
    ).toHaveLength(2);

    expect(
      parseGroup(
        {
          id: 'group-a',
          name: 'Transit center',
          memberIds: ['stop-a', 'station-a'],
          footprint: [
            [-115.181, 36.109],
            [-115.179, 36.111],
          ],
          color: '#336699',
        },
        'Group',
      ),
    ).toMatchObject({ id: 'group-a', name: 'Transit center', color: '#336699' });

    expect(
      parseNode(
        {
          id: 'node-a',
          coord: [-115.18, 36.11],
          refs: [{ wayId: 'way-a', pointIndex: 1 }],
          control: 'signal',
          connectors: [
            {
              from: { wayId: 'way-a', laneId: 'forward' },
              to: { wayId: 'way-b', laneId: 'forward' },
            },
          ],
        },
        'Node',
      ),
    ).toMatchObject({
      id: 'node-a',
      control: 'signal',
      connectors: [{ from: { laneId: 'forward' }, to: { wayId: 'way-b' } }],
    });

    expect(
      parseNamedWay(
        { id: 'named-way-a', name: 'Main Street', wayIds: ['way-a', 'way-b'] },
        'Named Way',
      ),
    ).toEqual({ id: 'named-way-a', name: 'Main Street', wayIds: ['way-a', 'way-b'] });

    expect(
      parseVehicleKind(
        {
          id: 'bus-a',
          modeId: 'bus',
          label: 'Articulated bus',
          widthM: 2.55,
          lengthM: 18,
          capacityPax: 120,
          topSpeedKmh: 100,
          accelMps2: 1.2,
          decelMps2: 1.5,
        },
        'Vehicle kind',
      ),
    ).toMatchObject({
      id: 'bus-a',
      capacityPax: 120,
      topSpeedKmh: 100,
      accelMps2: 1.2,
      decelMps2: 1.5,
    });

    expect(parseTurnRestrictions({ approach: { allowedTargets: ['through', 'left'] } })).toEqual({
      approach: { allowedTargets: ['through', 'left'] },
    });
    expect(parseMedians({ median: { widthM: 2.5, kindId: 'raised' } })).toEqual({
      median: { widthM: 2.5, kindId: 'raised' },
    });
    expect(parseApproachControls({ approach: { control: 'yield' } })).toEqual({
      approach: { control: 'yield' },
    });
  });

  it('rejects ambiguous Alignment geometry and curve controls', () => {
    expect(() =>
      parseAlignment(
        {
          id: 'alignment-a',
          points: [
            [-115.2, 36.1],
            [-115.2, 36.1],
          ],
          geometry: 'straight',
        },
        'Alignment',
      ),
    ).toThrow('at least two distinct points');

    expect(() =>
      parseAlignment(
        {
          id: 'alignment-a',
          points: [
            [-115.2, 36.1],
            [-115.18, 36.11],
          ],
          geometry: 'curved',
          curveControls: [
            { pointIndex: 1, radiusMeters: 20 },
            { pointIndex: 1, radiusMeters: 30 },
          ],
        },
        'Alignment',
      ),
    ).toThrow('invalid or repeated');

    expect(() =>
      parseAlignment(
        {
          id: 'alignment-a',
          points: [
            [-115.2, 36.1],
            [-115.18, 36.11],
          ],
          geometry: 'curved',
          curveControls: [{ pointIndex: 2, radiusMeters: 20 }],
        },
        'Alignment',
      ),
    ).toThrow('invalid or repeated');
  });

  it('rejects duplicate lane identity and out-of-range Stop anchors', () => {
    expect(() =>
      parseWay(
        {
          id: 'way-a',
          alignmentId: 'alignment-a',
          typeId: 'road',
          grade: 'atGrade',
          profile: {
            lanes: [
              { id: 'lane-a', kindId: 'bus', widthMeters: 3, direction: 'forward' },
              { id: 'lane-a', kindId: 'bus', widthMeters: 3, direction: 'reverse' },
            ],
          },
        },
        'Way',
      ),
    ).toThrow('repeats a lane ID');

    expect(() =>
      parseStop(
        {
          id: 'stop-a',
          coord: [-115.18, 36.11],
          anchors: [{ alignmentId: 'alignment-a', t: 1.1 }],
        },
        'Stop',
      ),
    ).toThrow('zero through one');
  });

  it('rejects repeated component targets and invalid positive values', () => {
    expect(() =>
      parseNamedWay(
        { id: 'named-way-a', name: 'Main Street', wayIds: ['way-a', 'way-a'] },
        'Named Way',
      ),
    ).toThrow('duplicate values');

    expect(() =>
      parseVehicleKind(
        {
          id: 'bus-a',
          modeId: 'bus',
          label: 'Bus',
          widthM: 2.5,
          lengthM: 12,
          capacityPax: 0,
        },
        'Vehicle kind',
      ),
    ).toThrow('must be positive');

    expect(() => parseMedians({ median: { widthM: 0, kindId: 'raised' } })).toThrow(
      'must be positive',
    );
    expect(() => parseApproachControls({ approach: { control: 'unknown' } })).toThrow('is invalid');
  });
});
