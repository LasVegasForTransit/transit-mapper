// Junction inspector: traffic control plus the per-lane turn editor. Each
// approach (an arm with lanes traveling INTO the junction) lists its
// incoming lanes left-to-right in travel order; the ← ↑ → toggles edit the
// REAL lane-connectivity graph (Node.connectors) — the map's connector
// guides redraw live, and future routing reads the same edges. "Automatic"
// junctions (no stored connectors) show the derived defaults; the first
// toggle materializes them as an explicit, stored graph.
import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import {
  classifyTurn,
  effectiveConnectors,
  incomingLanes,
  junctionGeometry,
  outgoingLanes,
  type JunctionArm,
  type TurnClass,
} from '@transitmapper/core/geometry/junctions';
import { useState } from 'react';
import { WAY_FAMILIES, laneKind, wayType } from '@transitmapper/core/model/catalog';
import { armRefKey, getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { metersFromOrigin } from '@transitmapper/core/model/geo';
import { junctionGroupOf } from '@transitmapper/core/model/junctions';
import type {
  LaneConnector,
  LaneSpec,
  Node,
  NodeControl,
  Way,
} from '@transitmapper/core/model/system';
import { Icon } from './Icon';
import { InspectorTabs, type InspectorTab } from './InspectorTabs';

const CONTROL_OPTIONS: [NodeControl, string][] = [
  ['uncontrolled', 'None'],
  ['signal', 'Signal'],
  ['stop', 'Stop'],
  ['yield', 'Yield'],
  ['roundabout', 'Roundabout'],
  ['levelCrossing', 'Level crossing'],
];

// A whole-node control describes the junction itself. An approach override
// describes only what a driver encounters, so roundabouts and rail crossings
// remain node-level concepts instead of becoming nonsensical per-arm choices.
const APPROACH_CONTROL_OPTIONS = CONTROL_OPTIONS.filter(
  ([value]) => value !== 'roundabout' && value !== 'levelCrossing',
);

const TURN_GLYPH: Record<Exclude<TurnClass, 'uturn'>, string> = {
  left: '←',
  straight: '↑',
  right: '→',
};
const TURN_ORDER: Exclude<TurnClass, 'uturn'>[] = ['left', 'straight', 'right'];

interface NodeInspectorProps {
  id: string;
}

const COMPASS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
];

/**
 * Which way a corridor leaves the junction, as a compass direction.
 *
 * Two unnamed streets crossing give a junction four arms all called "Street ·
 * Road", and a list of four identical rows tells nobody which one they are
 * about to disconnect. The bearing is the one thing that always differs.
 * A corridor that runs THROUGH the junction leaves on both sides and reads
 * as "east–west".
 */
function approachOf(node: Node, way: Way): string | undefined {
  const bearings: string[] = [];
  for (const ref of node.refs.filter((r) => r.wayId === way.id)) {
    for (const neighbor of [way.points[ref.pointIndex - 1], way.points[ref.pointIndex + 1]]) {
      if (!neighbor) continue;
      const [dx, dy] = metersFromOrigin(node.coord, neighbor);
      if (Math.hypot(dx, dy) < 0.01) continue;
      const clockwiseFromNorth = (90 - (Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      bearings.push(COMPASS[Math.round(clockwiseFromNorth / 45) % COMPASS.length]);
    }
  }
  return bearings.length > 0 ? [...new Set(bearings)].join('–') : undefined;
}

/** Signed turn angle from an incoming arm's heading to an outgoing arm. */
function turnBetween(inArm: JunctionArm, outArm: JunctionArm): number {
  const hx = -inArm.dir[0];
  const hy = -inArm.dir[1];
  return Math.atan2(
    hx * outArm.dir[1] - hy * outArm.dir[0],
    hx * outArm.dir[0] + hy * outArm.dir[1],
  );
}

/** The outgoing lane a toggled turn should land in: left turns take the
 *  leftmost target lane, right turns the rightmost, straight aligns from
 *  the right (matching the default heuristic). */
function targetLane(
  turn: TurnClass,
  outbound: LaneSpec[],
  inboundIndex: number,
  inboundCount: number,
): LaneSpec {
  if (turn === 'left') return outbound[0];
  if (turn === 'right') return outbound[outbound.length - 1];
  const fromRight = inboundCount - 1 - inboundIndex;
  return outbound[Math.max(0, outbound.length - 1 - fromRight)];
}

interface TurnToggle {
  inArm: JunctionArm;
  lane: LaneSpec;
  laneIndex: number;
  inboundCount: number;
  turn: Exclude<TurnClass, 'uturn'>;
}

export function NodeInspector({ id }: NodeInspectorProps) {
  const node = useEditor((s) => s.system.nodes.find((n) => n.id === id));
  const ways = useEditor((s) => s.system.ways);
  const namedWays = useEditor((s) => s.system.namedWays);
  const turnRestrictions = useEditor((s) => s.system.turnRestrictions);
  const approachControls = useEditor((s) => s.system.approachControls);
  const {
    setNodeControl,
    setNodeConnectors,
    disconnectNodeWay,
    setTurnRestriction,
    setApproachControl,
  } = useEditorCommands().network;
  const [tab, setTab] = useState<string>('turns');

  if (!node) return null;
  const waysById = new Map<string, Way>(ways.map((w) => [w.id, w]));
  const g = junctionGeometry(node, waysById);
  const connectors = effectiveConnectors(node, waysById, turnRestrictions);
  const control = node.control ?? 'uncontrolled';

  const nameOf = (way: Way): string | undefined => {
    const named = namedWays.find((n) => n.wayIds.includes(way.id));
    return named && named.name.trim() !== '' ? named.name : undefined;
  };

  /** What this way is called: its shared name, or the noun its family uses
   *  for an unnamed one ("Street", "Line"). */
  const wayIdentity = (way: Way): string =>
    nameOf(way) ?? WAY_FAMILIES[wayType(way.typeId).family].identityNoun;

  /** A heading for one arm. A named way needs no type appended — "East
   *  Russell Road" already says what it is — while "Street" on its own does
   *  not distinguish two arms of different types. */
  const wayLabel = (way: Way): string => {
    const named = nameOf(way);
    const type = wayType(way.typeId);
    return named ?? `${WAY_FAMILIES[type.family].identityNoun} · ${type.label}`;
  };

  // Every way meeting here, including one running STRAIGHT THROUGH the
  // junction — junctionGeometry's arms are way ENDS only, and a corridor
  // crossing the node mid-span is just as much a connection to sever. Keyed
  // by way, so a loop touching the junction twice lists once and leaves once.
  const connectedWays = [...new Set(node.refs.map((r) => r.wayId))]
    .map((wayId) => waysById.get(wayId))
    .filter((way): way is Way => way !== undefined);
  // Grouped the way model/junctions.ts groups them: a bike path meeting a
  // road is an ordinary junction, a road meeting a rail line is not.
  const mixedTypes = new Set(connectedWays.map((w) => junctionGroupOf(w.typeId))).size > 1;

  const isActive = (lane: LaneSpec, fromWayId: string, targetWayIds: Set<string>): boolean =>
    connectors.some(
      (c) =>
        c.from.wayId === fromWayId && c.from.laneId === lane.id && targetWayIds.has(c.to.wayId),
    );

  // Candidate target arms for one lane's turn-class, narrowed by any active
  // TurnRestriction (see model/system.ts) — a lane restricted to specific
  // target ways can never offer a turn outside that list, regardless of
  // what angle bucket it geometrically falls into.
  const turnTargets = (
    inArm: JunctionArm,
    lane: LaneSpec,
    turn: Exclude<TurnClass, 'uturn'>,
  ): JunctionArm[] => {
    if (!g) return [];
    const inGroup = junctionGroupOf(waysById.get(inArm.wayId)?.typeId ?? '');
    const byAngle = g.arms.filter(
      (a) =>
        a !== inArm &&
        classifyTurn(turnBetween(inArm, a)) === turn &&
        // A mismatched junction (findMismatchedTypeJunctions' document-audience
        // case) or a level crossing can put arms of two junction groups on one
        // Node — a rail lane offering a "turn" onto a street lane draws a
        // connector nothing can actually drive, since defaultConnectors
        // already refuses to derive one for exactly this reason.
        junctionGroupOf(waysById.get(a.wayId)?.typeId ?? '') === inGroup,
    );
    const restriction = getComponent(turnRestrictions, laneRefKey(inArm.wayId, lane.id));
    return restriction
      ? byAngle.filter((a) => restriction.allowedTargets.includes(a.wayId))
      : byAngle;
  };

  const toggleTurn = ({ inArm, lane, laneIndex, inboundCount, turn }: TurnToggle) => {
    const targets = turnTargets(inArm, lane, turn);
    if (targets.length === 0) return;
    const targetWayIds = new Set(targets.map((a) => a.wayId));
    const active = isActive(lane, inArm.wayId, targetWayIds);
    let next: LaneConnector[];
    if (active) {
      next = connectors.filter(
        (c) =>
          !(
            c.from.wayId === inArm.wayId &&
            c.from.laneId === lane.id &&
            targetWayIds.has(c.to.wayId)
          ),
      );
    } else {
      const additions: LaneConnector[] = [];
      for (const t of targets) {
        const targetWay = waysById.get(t.wayId);
        if (!targetWay) continue;
        const outbound = outgoingLanes(targetWay, t.end);
        if (outbound.length === 0) continue;
        additions.push({
          from: { wayId: inArm.wayId, laneId: lane.id },
          to: { wayId: t.wayId, laneId: targetLane(turn, outbound, laneIndex, inboundCount).id },
        });
      }
      next = [...connectors, ...additions];
    }
    setNodeConnectors(node.id, next);
  };

  const approaches = (g?.arms ?? [])
    .map((arm) => {
      const way = waysById.get(arm.wayId);
      if (!way) return null;
      const inbound = incomingLanes(way, arm.end);
      return inbound.length > 0 ? { arm, way, inbound } : null;
    })
    .filter((a): a is { arm: JunctionArm; way: Way; inbound: LaneSpec[] } => a !== null);

  const tabs: InspectorTab[] = [
    { id: 'turns', label: 'Turn lanes' },
    { id: 'control', label: 'Control' },
    { id: 'connections', label: 'Connections' },
  ];

  return (
    <aside className="panel panel-right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <span className="insp-name static">Junction</span>
      </div>
      <div className="insp-kind">
        {g ? `${g.arms.length} arms` : 'junction'} ·{' '}
        {node.connectors ? 'custom turn lanes' : 'automatic turn lanes'}
      </div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'turns' && (
        <div className="insp-section" role="tabpanel">
          <p className="insp-sub">
            Lanes are listed left-to-right as a driver on that approach sees them — toggle where
            each may go
          </p>
          {approaches.map(({ arm, way, inbound }) => (
            <div key={`${arm.wayId}:${arm.end}`} className="node-approach">
              <div className="node-approach-name">{wayLabel(way)}</div>
              {inbound.map((lane, i) => {
                const restrictionKey = laneRefKey(arm.wayId, lane.id);
                const restriction = getComponent(turnRestrictions, restrictionKey);
                return (
                  <div key={lane.id} className="node-lane-row">
                    <span className="node-lane-label">
                      {laneKind(lane.kindId).label} {i + 1}
                    </span>
                    <span className="node-lane-turns">
                      {TURN_ORDER.map((turn) => {
                        const targets = turnTargets(arm, lane, turn);
                        const active =
                          targets.length > 0 &&
                          isActive(lane, arm.wayId, new Set(targets.map((a) => a.wayId)));
                        return (
                          <button
                            key={turn}
                            className={`chip ${active ? 'active' : ''}`}
                            aria-pressed={active}
                            disabled={targets.length === 0}
                            title={
                              restriction && targets.length === 0
                                ? `${turn} turn restricted`
                                : `${turn} turn`
                            }
                            onClick={() =>
                              toggleTurn({
                                inArm: arm,
                                lane,
                                laneIndex: i,
                                inboundCount: inbound.length,
                                turn,
                              })
                            }
                          >
                            {TURN_GLYPH[turn]}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`ghost-btn icon-btn ${restriction ? 'active' : ''}`}
                        aria-pressed={!!restriction}
                        title={
                          restriction
                            ? 'Turn-restricted — click to unrestrict'
                            : 'Lock this lane to only its currently-toggled turns'
                        }
                        onClick={() => {
                          if (restriction) {
                            setTurnRestriction(arm.wayId, lane.id, undefined);
                          } else {
                            const allowed = [
                              ...new Set(
                                connectors
                                  .filter(
                                    (c) => c.from.wayId === arm.wayId && c.from.laneId === lane.id,
                                  )
                                  .map((c) => c.to.wayId),
                              ),
                            ];
                            setTurnRestriction(arm.wayId, lane.id, allowed);
                          }
                        }}
                      >
                        <Icon name="lock" size={12} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {node.connectors && (
            <div className="insp-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setNodeConnectors(node.id, undefined)}
              >
                Reset to automatic
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'control' && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label" id="node-control-label">
            Whole junction
          </label>
          <div className="chip-row" role="group" aria-labelledby="node-control-label">
            {CONTROL_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                className={`chip ${control === value ? 'active' : ''}`}
                aria-pressed={control === value}
                onClick={() =>
                  setNodeControl(node.id, value === 'uncontrolled' ? undefined : value)
                }
              >
                {label}
              </button>
            ))}
          </div>

          {approaches.length > 0 && (
            <>
              <label className="field-label">Per-approach override</label>
              <p className="insp-sub">
                E.g. a stop sign on the minor street only, leaving the main street free-flowing.
              </p>
              {approaches.map(({ arm, way }) => {
                const key = armRefKey(arm.wayId, arm.end);
                const override = getComponent(approachControls, key)?.control;
                const effective = override ?? control;
                return (
                  <div key={key} className="node-approach">
                    <div className="node-approach-name">{wayLabel(way)}</div>
                    <div
                      className="chip-row"
                      role="group"
                      aria-label={`${wayLabel(way)} traffic control`}
                    >
                      {APPROACH_CONTROL_OPTIONS.map(([value, label]) => (
                        <button
                          key={value}
                          className={`chip ${effective === value ? 'active' : ''}`}
                          aria-pressed={effective === value}
                          onClick={() => setApproachControl(arm.wayId, arm.end, value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {override !== undefined && (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setApproachControl(arm.wayId, arm.end, undefined)}
                      >
                        Use junction default
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {tab === 'connections' && (
        <div className="insp-section" role="tabpanel">
          {control === 'levelCrossing' ? (
            <p className="insp-sub">
              A guideway crossing a street at grade — real, not a fault to undo. No vehicle turns
              between the two, same as any other level crossing.
            </p>
          ) : (
            mixedTypes && (
              <p className="insp-sub">
                These ways aren't the same type, so no vehicle can actually turn between them.
                Disconnecting one is how you undo that.
              </p>
            )
          )}
          {!mixedTypes && (
            <p className="insp-sub">
              Disconnecting a way pulls its end clear of the others — the rest of the junction stays
              as it is.
            </p>
          )}
          <div className="svc-list">
            {connectedWays.map((way) => (
              <div key={way.id} className="svc-chip chip-removable">
                <span className="chip-removable-label">
                  {wayIdentity(way)} · {wayType(way.typeId).label}
                </span>
                <span className="node-lane-label">{approachOf(node, way)}</span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  aria-label={`Disconnect the ${approachOf(node, way) ?? ''} ${wayIdentity(
                    way,
                  )} arm from this junction`}
                  title="Disconnect from this junction"
                  onClick={() => disconnectNodeWay(node.id, way.id)}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
