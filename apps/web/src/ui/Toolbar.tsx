import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import { useDocumentView } from '../editor/document-view-controls';
import { useInertRef } from '@transitmapper/workspace/inert-ref';
import type { SelectVariant } from '../editor/store';
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  MODE_ORDER,
  MODES,
  WAY_FAMILIES,
  profilePresetsForWayType,
  wayType,
  wayTypesByFamily,
  type WayFamily,
} from '@transitmapper/core/model/catalog';
import { facilityRender } from '@transitmapper/core/style/catalogStyle';
import {
  DropdownMenu,
  DropdownMenuChoice,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './DropdownMenu';
import { Icon, type IconName } from './Icon';
import { useUi } from './UiProvider';
interface PassengerPlaceToolPresentation {
  label: 'Stop' | 'Station';
  icon: IconName;
}

/** The shared S shortcut has a view-specific, user-facing meaning: Network
 * places the boarding point services call at; Infrastructure draws the
 * optional passenger place that can contain several of those points. */
export function passengerPlaceTool(
  viewMode: 'network' | 'infrastructure',
): PassengerPlaceToolPresentation {
  return viewMode === 'network'
    ? { label: 'Stop', icon: 'stop' }
    : { label: 'Station', icon: 'boundary' };
}

// One dock icon per way family; unknown families fall back to the plain line.
const FAMILY_TOOL_ICON: Record<WayFamily, IconName> = {
  guideway: 'line',
  roadway: 'road',
  path: 'bike',
  aerial: 'geoCurved',
  water: 'geoFreeform',
};

// Sticky per-family variant: pressing the Track tool again gives you the
// same track standard you last drew, not always the catalog's first one.
const lastTypeByFamily: Partial<Record<WayFamily, string>> = {};

/**
 * The floating tool dock — Figma-style: every button is a MODE (what the
 * cursor does), and variants live behind each tool's chevron as a MENU
 * (pick and dismiss). The drawing tools are generated from the catalog's
 * way-type families, so "just draw a road" / "just draw a track" is one
 * click, and a new catalog family gets a tool with no UI code.
 *
 * Context-dependent by view: Infrastructure shows the physical tools
 * (Road, Track, Path, … + Stop, Facility); Network shows the Line tool
 * (mode-first service drawing) + Stop. Diagram is read-only.
 */
export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const selectVariant = useEditor((s) => s.selectVariant);
  const draftWayTypeId = useEditor((s) => s.draftWayTypeId);
  const draftModeId = useEditor((s) => s.draftModeId);
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const draftFacilityComplexMode = useEditor((s) => s.draftFacilityComplexMode);
  const {
    setTool,
    setSelectVariant,
    setDraftWayType,
    setDraftMode,
    setDraftPreset,
    setDraftFacilityType,
    setDraftFacilityComplexMode,
  } = useEditorCommands().tools;
  const { viewMode } = useDocumentView();
  const { uiHidden } = useUi();
  const dockRef = useInertRef<HTMLDivElement>(uiHidden);
  // Diagram is schematic, so its marks cannot become document edits (see
  // map/interactions.ts's isDiagramMode gating). Drawing tools stay disabled,
  // while the separate reader continues to offer its own controls.
  const diagram = viewMode === 'diagram';
  const locked = diagram;
  const network = viewMode === 'network';
  const placeTool = passengerPlaceTool(network ? 'network' : 'infrastructure');
  const activeFamily = tool === 'way' ? wayType(draftWayTypeId).family : null;

  const activateFamily = (family: WayFamily, typeId?: string) => {
    const fallback = wayTypesByFamily().find((e) => e.family === family)?.typeIds[0];
    const resolved = typeId ?? lastTypeByFamily[family] ?? fallback;
    if (!resolved) return;
    lastTypeByFamily[family] = resolved;
    setDraftWayType(resolved);
    setTool('way');
  };

  return (
    <div ref={dockRef} className="toolbar-dock zen-cluster">
      <div className="tool-row">
        {/* Cluster 1: selection — neither a path nor a place. */}
        <div className="tool-cluster" role="toolbar" aria-label="Select">
          {/* The dock button wears the variant, so it promises what the next
              press does: "Erase" erases, the way "Road" draws a road. Alt and
              Ctrl still reach the same two operations for a mouse; this is how
              a finger reaches them, since neither key can be held. */}
          <ToolButton
            icon={SELECT_VARIANTS[selectVariant].icon}
            label={SELECT_VARIANTS[selectVariant].label}
            hotkey="V"
            active={tool === 'select'}
            disabled={false}
            onClick={() => setTool('select')}
            menu={[
              {
                entries: SELECT_VARIANT_ORDER.map((id) => ({
                  id,
                  label: SELECT_VARIANTS[id].label,
                  checked: selectVariant === id,
                  onSelect: () => {
                    setSelectVariant(id);
                    setTool('select');
                  },
                })),
              },
            ]}
          />
          {/* Network view only: a marquee here catches LINES, where the Select
              tool's catches the streets under them. Both gestures are useful
              and neither can be inferred from the box, so they are two tools
              rather than one tool with a hidden modifier. Infrastructure view
              has no lines to sweep, so the button isn't there at all. */}
          {network && (
            <ToolButton
              icon="line"
              label="Select lines"
              hotkey="E"
              active={tool === 'lines'}
              disabled={locked}
              onClick={() => setTool('lines')}
            />
          )}
        </div>

        {/* Cluster 2: PATHS — linear infrastructure (or lines in Network).
            Absent in Diagram view rather than present and disabled: a
            schematic projection has nothing to draw on (see `diagram`), and
            eleven dead buttons taught nobody that. */}
        {!diagram && (
          <div className="tool-cluster" role="toolbar" aria-label="Draw paths">
            {network ? (
              // Network view: you draw LINES (services). One tool; its variants
              // are the modes.
              <ToolButton
                icon="line"
                label={MODES[draftModeId].label}
                hotkey="L"
                active={tool === 'way'}
                disabled={locked}
                onClick={() => setTool('way')}
                menu={[
                  {
                    entries: MODE_ORDER.map((id) => ({
                      id,
                      label: MODES[id].label,
                      checked: draftModeId === id,
                      onSelect: () => {
                        setDraftMode(id);
                        setTool('way');
                      },
                    })),
                  },
                ]}
              />
            ) : (
              // Infrastructure view: one drawing tool per way family — click
              // Road and you're drawing a road. The chevron menu picks the
              // variant (track standard, path kind, or a road cross-section).
              wayTypesByFamily().map(({ family, typeIds }) => {
                const info = WAY_FAMILIES[family];
                const isActive = tool === 'way' && activeFamily === family;
                const presets = family === 'roadway' ? profilePresetsForWayType(typeIds[0]) : [];
                const menu =
                  typeIds.length > 1
                    ? [
                        {
                          entries: typeIds.map((id) => ({
                            id,
                            label: wayType(id).label,
                            checked: draftWayTypeId === id,
                            onSelect: () => activateFamily(family, id),
                          })),
                        },
                      ]
                    : presets.length > 0
                      ? [
                          {
                            label: 'Cross-section',
                            entries: [
                              {
                                id: '',
                                label: 'Default',
                                checked: false,
                                onSelect: () => {
                                  activateFamily(family, typeIds[0]);
                                  setDraftPreset(null);
                                },
                              },
                              ...presets.map((p) => ({
                                id: p.id,
                                label: p.label,
                                checked: false,
                                onSelect: () => {
                                  activateFamily(family, typeIds[0]);
                                  setDraftPreset(p.id);
                                },
                              })),
                            ],
                          },
                        ]
                      : undefined;
                return (
                  <ToolButton
                    key={family}
                    icon={FAMILY_TOOL_ICON[family]}
                    label={info.toolLabel}
                    active={isActive}
                    disabled={locked}
                    onClick={() => activateFamily(family)}
                    menu={menu}
                  />
                );
              })
            )}
          </div>
        )}

        {/* Cluster 3: PLACES. Infrastructure draws a Station's physical
            boundary (a click-points or drag-rectangle boundary, same
            grammar as a facility complex — see interactions.ts's
            startStationBoundaryDraw), not a schematic pin, so it wears the same
            "boundary" glyph as Facility's site-boundary mode; Network view
            places a Stop, so it keeps the plain stop icon. The invisible spacer balances the
            cluster's card when Facility's menu caret is present (Infra view
            only) — same width as .tool-btn-caret's own footprint — so the
            pair reads as centered rather than lopsided toward the caret.
            Absent in Diagram view for the same reason as the paths cluster
            above. */}
        {!diagram && (
          <div className="tool-cluster" role="toolbar" aria-label="Places">
            {!network && <span className="tool-caret-spacer" aria-hidden="true" />}
            <ToolButton
              icon={placeTool.icon}
              label={placeTool.label}
              hotkey="S"
              active={tool === 'stop'}
              disabled={locked}
              onClick={() => setTool('stop')}
            />
            {!network && (
              // The Facility tool wears its current variant and places it on
              // click; "Complex" (draw a site boundary to build inside) is one
              // more variant, never a hidden default.
              <ToolButton
                icon={
                  draftFacilityComplexMode
                    ? 'boundary'
                    : // facilityRender lives in packages/core, which can't know
                      // about this app's icon vocabulary — its `icon` field is a
                      // plain string by necessity. The cast is the one place that
                      // boundary is crossed; every value it can actually return
                      // (see catalogStyle.ts's facilityRender) is a real IconName.
                      (facilityRender(draftFacilityTypeId).icon as IconName)
                }
                label="Facility"
                hotkey="F"
                active={tool === 'facility'}
                disabled={locked}
                onClick={() => setTool('facility')}
                menu={[
                  {
                    label: 'Access points (placed)',
                    entries: FACILITY_TYPE_ORDER.filter(
                      (id) => FACILITY_TYPES[id].geometryKind === 'point',
                    ).map((id) => ({
                      id,
                      label: FACILITY_TYPES[id].label,
                      checked: !draftFacilityComplexMode && draftFacilityTypeId === id,
                      onSelect: () => {
                        setDraftFacilityType(id);
                        setTool('facility');
                      },
                    })),
                  },
                  {
                    label: 'Structures (drawn to shape)',
                    entries: FACILITY_TYPE_ORDER.filter(
                      (id) => FACILITY_TYPES[id].geometryKind === 'area',
                    ).map((id) => ({
                      id,
                      label: FACILITY_TYPES[id].label,
                      checked: !draftFacilityComplexMode && draftFacilityTypeId === id,
                      onSelect: () => {
                        setDraftFacilityType(id);
                        setTool('facility');
                      },
                    })),
                  },
                  {
                    label: 'Land',
                    entries: [
                      {
                        id: 'complex',
                        label: 'Site boundary (a complex\u2019s land)',
                        checked: draftFacilityComplexMode,
                        onSelect: () => {
                          setDraftFacilityComplexMode(true);
                          setTool('facility');
                        },
                      },
                    ],
                  },
                ]}
              />
            )}
          </div>
        )}

        {/* Cluster 4: Demolish — Infrastructure view only. Its target is
            physical way geometry, the same reason Road/Track/Path are
            infra-only; ways stay clickable by other tools in Network view,
            this just doesn't put a dedicated bulldozer button there.

            Absent in Diagram view for the same reason as the two clusters
            above: a schematic projection has no physical geometry to
            demolish, so the button would only ever be disabled. */}
        {!network && !diagram && (
          <div className="tool-cluster" role="toolbar" aria-label="Demolish">
            <ToolButton
              icon="demolish"
              label="Demolish"
              hotkey="B"
              active={tool === 'demolish'}
              disabled={locked}
              onClick={() => setTool('demolish')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What each Select variant is called and what it looks like on the dock.
 *
 * Labels are what the next press DOES, not what the control is: the button
 * reads "Erase" while erasing, the same way the paths cluster reads "Road"
 * while drawing one. An earlier version of this shipped as three checkboxes
 * under a heading reading MODIFIERS, which named the mechanism rather than
 * the operation and implied a press could erase and split at once.
 */
const SELECT_VARIANTS: Record<SelectVariant, { label: string; icon: IconName }> = {
  select: { label: 'Select', icon: 'cursor' },
  erase: { label: 'Erase', icon: 'trash' },
  split: { label: 'Split', icon: 'line' },
};

const SELECT_VARIANT_ORDER: SelectVariant[] = ['select', 'erase', 'split'];

interface ToolMenuEntry {
  id: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/** Variant menus can be sectioned when their entries are different KINDS of
 *  thing (the Facility tool's markers vs. footprints vs. site complex) — a
 *  labeled group per kind, not one undifferentiated list. */
interface ToolMenuSection {
  label?: string;
  entries: ToolMenuEntry[];
}

interface ToolButtonProps {
  icon: IconName;
  label: string;
  hotkey?: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  /** Variant menu behind the chevron — a MENU (pick, dismiss), never a mode. */
  menu?: ToolMenuSection[];
}

function ToolButton({ icon, label, hotkey, active, disabled, onClick, menu }: ToolButtonProps) {
  // The button itself is always the same square (size-14 = 56×56, Tailwind's
  // own scale — no hand-tracked width/height pair to keep in sync in
  // app.css) whether or not it carries a menu; the caret is what's free to
  // add its own width when there's one to show (see .tool-btn-caret below).
  const hasMenu = !!menu && menu.length > 0;
  return (
    <div className={`tool-btn-group ${active ? 'active' : ''}`}>
      <button
        className={`tool-btn size-14 ${active ? 'active' : ''}`}
        disabled={disabled}
        aria-pressed={active}
        title={hotkey ? `${label} (${hotkey})` : label}
        onClick={onClick}
      >
        <Icon name={icon} size={20} />
        <span className="tool-btn-label">{label}</span>
      </button>
      {hasMenu && (
        <DropdownMenu
          align="center"
          trigger={
            <button
              className="tool-btn-caret"
              disabled={disabled}
              aria-label={`${label} options`}
              title={`${label} options`}
            >
              <Icon name="chevronDown" size={12} />
            </button>
          }
        >
          {menu.map((section, si) => (
            <div key={section.label ?? si}>
              {si > 0 && <DropdownMenuSeparator />}
              {section.label && <DropdownMenuLabel>{section.label}</DropdownMenuLabel>}
              {section.entries.map((entry) => (
                <DropdownMenuChoice
                  key={entry.id || 'default'}
                  checked={entry.checked}
                  onSelect={entry.onSelect}
                >
                  {entry.label}
                </DropdownMenuChoice>
              ))}
            </div>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}
