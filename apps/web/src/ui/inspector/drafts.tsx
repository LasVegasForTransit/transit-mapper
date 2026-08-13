import { useEffect } from 'react';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import {
  FACILITY_TYPES,
  WAY_FAMILIES,
  mode,
  modesForWayType,
  profilePresetsForWayType,
  wayType,
} from '@transitmapper/core/model/catalog';
import type { Tool } from '../../editor/store';
import { ColorField } from '../ColorField';
import { Panel } from '../Panel';
import { useView } from '../ViewProvider';
import { GEOMETRY_OPTIONS, GradeChips } from './shared';
/**
 * When a drawing tool is armed (anything but Select), the sidebar shows
 * THAT tool's draft options instead of a selected object's details — the
 * right sidebar is the one dynamic/contextual surface in this app, and a
 * tool's own configuration is exactly that kind of content, same as a
 * selected object's properties are. This used to be a second version of
 * "dynamic panel," floating above the bottom tool dock as its own
 * `.tool-options` strip — confirmed by the user as the exact kind of
 * bundling this app keeps needing to be undone: one dynamic surface, not
 * two. The bottom dock's only job now is picking WHICH tool; this is where
 * that tool's own settings live, right where a selection's details would.
 */
export interface ToolDraftInspectorProps {
  tool: Tool;
}

export function ToolDraftInspector({ tool }: ToolDraftInspectorProps) {
  if (tool === 'way') return <WayDraftInspector />;
  if (tool === 'stop') return <StopDraftInspector />;
  if (tool === 'facility') return <FacilityDraftInspector />;
  // Select has no draft options: erasing and splitting are variants of it,
  // shown on the dock button and picked from its chevron (see Toolbar), which
  // is where every other tool's variants live.
  return null;
}

/**
 * Network view is mode-first: you're drawing a LINE, so "Line type" (Bus,
 * Light rail, Subway, …) is the one real choice, chosen from the dock's own
 * tool menu — this panel only carries the REST of that choice's fallout
 * (which physical carrier when the mode allows more than one, grade, shape,
 * color). Infrastructure view stays way-type-first (rail, road, bike,
 * aerial, water, …), with class/cross-section/direction as real physical-
 * alignment facts that belong here too — but only there; see each field's
 * own comment for why they're Infrastructure-only.
 */
function WayDraftInspector() {
  const draftWayTypeId = useEditor((s) => s.draftWayTypeId);
  const draftModeId = useEditor((s) => s.draftModeId);
  const draftGeometry = useEditor((s) => s.draftGeometry);
  const draftColor = useEditor((s) => s.draftColor);
  const draftGrade = useEditor((s) => s.draftGrade);
  const draftClassId = useEditor((s) => s.draftClassId);
  const draftPresetId = useEditor((s) => s.draftPresetId);
  const draftOneWay = useEditor((s) => s.draftOneWay);
  const palette = useEditor((s) => s.system.palette);
  const {
    setDraftWayType,
    setDraftGeometry,
    setDraftColor,
    setDraftGrade,
    setDraftClassId,
    setDraftPreset,
    setDraftOneWay,
    setDraftServiceEnabled,
    addPaletteColor,
  } = useEditorCommands().tools;
  const { viewMode } = useView();

  const type = wayType(draftWayTypeId);
  const compatibleModes = modesForWayType(draftWayTypeId);
  const networkFirst = viewMode === 'network';
  const currentMode = mode(draftModeId);

  // The whole separation of concerns, enforced: drawing in the
  // Infrastructure view NEVER creates a service; drawing in the Network view
  // (mode-first, "draw a line") always does. The store flag just mirrors
  // which view the Way tool is being used from.
  useEffect(() => {
    setDraftServiceEnabled(networkFirst);
  }, [networkFirst, setDraftServiceEnabled]);

  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        {networkFirst && <span className="dot" style={{ background: draftColor }} />}
        <span className="insp-name static">
          {networkFirst ? currentMode.label : WAY_FAMILIES[type.family].toolLabel}
        </span>
      </div>
      <div className="insp-kind">Drawing tool · options apply to what you draw next</div>
      {/* How to STOP drawing, which is the one thing you cannot work out by
          trying. Both gestures already worked — interactions.ts has bound
          double-click to finishWay since it was written, and the touch
          adapter maps a double tap onto it — but nothing said so anywhere in
          the interface, so on a phone the only visible way to end a line was
          a key the device does not have. */}
      <p className="panel-hint">Double-tap the last point to finish, or press Enter.</p>
      <div className="insp-section">
        {networkFirst && currentMode.wayTypeIds.length > 1 && (
          <>
            <label className="field-label">Runs on</label>
            <select
              className="opt-select"
              value={draftWayTypeId}
              onChange={(e) => setDraftWayType(e.target.value)}
            >
              {currentMode.wayTypeIds.map((id) => (
                <option key={id} value={id}>
                  {wayType(id).label}
                </option>
              ))}
            </select>
          </>
        )}

        {!networkFirst && profilePresetsForWayType(draftWayTypeId).length > 0 && (
          <>
            <label className="field-label">Cross-section</label>
            <select
              className="opt-select"
              value={draftPresetId ?? ''}
              onChange={(e) => setDraftPreset(e.target.value || null)}
            >
              <option value="">Default</option>
              {profilePresetsForWayType(draftWayTypeId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Road classification is a physical-alignment fact, not a service
            one — the real question to ask while drawing the actual street
            in Infrastructure view, not while sketching where a bus line
            goes. An armed preset already carries its own class, so this
            follows the same "don't show a field whose answer is already
            decided elsewhere" rule. */}
        {type.classes.length > 0 && !draftPresetId && !networkFirst && (
          <>
            <label className="field-label">Class</label>
            <div className="chip-row" role="group" aria-label="Class">
              {type.classes.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${draftClassId === c.id ? 'active' : ''}`}
                  aria-pressed={draftClassId === c.id}
                  onClick={() => setDraftClassId(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}

        <GradeChips value={draftGrade} disabled={false} onChange={setDraftGrade} />

        <label className="field-label" id="draft-shape-label">
          Shape
        </label>
        <div className="chip-row" role="group" aria-labelledby="draft-shape-label">
          {GEOMETRY_OPTIONS.map(([g, label]) => (
            <button
              key={g}
              className={`chip ${draftGeometry === g ? 'active' : ''}`}
              aria-pressed={draftGeometry === g}
              onClick={() => setDraftGeometry(g)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Same reasoning as Class above: one-way-ness is a fact about the
            physical street, decided when it's actually drawn in
            Infrastructure view — not a choice inherent to sketching a
            schematic line. */}
        {!networkFirst && (
          <>
            <label className="field-label" id="draft-direction-label">
              Direction
            </label>
            <div className="chip-row" role="group" aria-labelledby="draft-direction-label">
              <button
                className={`chip ${!draftOneWay ? 'active' : ''}`}
                aria-pressed={!draftOneWay}
                onClick={() => setDraftOneWay(false)}
              >
                Two-way
              </button>
              <button
                className={`chip ${draftOneWay ? 'active' : ''}`}
                aria-pressed={draftOneWay}
                onClick={() => setDraftOneWay(true)}
              >
                One-way
              </button>
            </div>
            {/* This was a `title` on the (non-focusable) chip row above, which
                made it unreachable by finger AND by keyboard — a tooltip on a
                div is readable only by a mouse that happens to rest there. It
                is the only place either behaviour is written down, so it says
                so on screen. Both gestures are named, since neither the key
                nor the long press is guessable. */}
            <p className="panel-hint">
              A one-way runs the direction you draw it. Press O to switch before you draw, or D to
              flip it after. Long-press an endpoint — right-click with a mouse — to branch a one-way
              segment off it.
            </p>
          </>
        )}

        {networkFirst && compatibleModes.length > 0 && (
          <ColorField
            label="Color"
            value={draftColor}
            palette={palette}
            onChange={setDraftColor}
            onAddToPalette={addPaletteColor}
          />
        )}
      </div>
    </Panel>
  );
}

/** One shortcut, two explicit place concepts: Network places a Stop;
 * Infrastructure draws a Station boundary. */
function StopDraftInspector() {
  const { viewMode } = useView();
  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        <span className="insp-name static">
          {viewMode === 'infrastructure' ? 'Station' : 'Stop'}
        </span>
      </div>
      <div className="insp-kind">Drawing tool</div>
      <div className="insp-section">
        {viewMode === 'infrastructure' ? (
          <p className="panel-hint">
            Drag a rectangle — or click corner points, double-click to close — to define a Station
            boundary. Add the physical Stops where passengers board in Network.
          </p>
        ) : (
          <p className="panel-hint">
            Tap to place a Stop — the physical point where a Service picks up passengers. It snaps
            onto the Line under it.
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * Options for the Facility tool. Two distinct clicks share it:
 *  - normal: click the map to start a new facility complex — a boundary
 *    drawn around the click, ready for bus bays/platforms/entrances placed
 *    inside it (see the Inspector once it's selected).
 *  - armed (via a complex's Inspector "Place inside"): the next click drops
 *    the chosen facility type straight into that complex instead.
 */
function FacilityDraftInspector() {
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const complexMode = useEditor((s) => s.draftFacilityComplexMode);
  const placingFor = useEditor((s) => s.placingFacilityForGroupId);
  const groups = useEditor((s) => s.system.groups);
  const { cancelPlacingFacility } = useEditorCommands().groups;

  const placingGroup = placingFor ? groups.find((g) => g.id === placingFor) : undefined;
  const typeLabel = FACILITY_TYPES[draftFacilityTypeId].label.toLowerCase();
  const article = /^[aeiou]/.test(typeLabel) ? 'an' : 'a';
  const isArea = FACILITY_TYPES[draftFacilityTypeId].geometryKind === 'area';

  // One plain sentence that matches what a click actually does. The WHAT
  // (entrance/depot/… or Complex) is the tool's flyout variant, not a menu
  // buried here.
  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        <span className="insp-name static">Facility</span>
      </div>
      <div className="insp-kind">Drawing tool</div>
      <div className="insp-section">
        {placingGroup ? (
          <p className="panel-hint">
            Click the map to place {article} {typeLabel} in{' '}
            {placingGroup.name?.trim() ? placingGroup.name : 'this complex'}.{' '}
            <button type="button" className="link-btn" onClick={cancelPlacingFacility}>
              Cancel
            </button>
          </p>
        ) : complexMode ? (
          <p className="panel-hint">
            Drag a rectangle — or click corner points and double-click to close — to outline the
            site.
          </p>
        ) : isArea ? (
          <p className="panel-hint">
            Drag to draw the {typeLabel}'s shape · inside a Station boundary it joins that place
            automatically.
          </p>
        ) : (
          <p className="panel-hint">
            Click the map to place {article} {typeLabel} · inside a Station boundary it joins that
            place automatically.
          </p>
        )}
      </div>
    </Panel>
  );
}
