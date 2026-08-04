import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, useEditorStore } from '../editor/EditorProvider';
import {
  crossingsWithoutJoiningChunked,
  planIssues,
  validateSystemQuick,
  type Issue,
} from '@transitmapper/core/model/validate';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { IconButton } from './IconButton';
import { Popover } from './Popover';
import { useListboxKeyboardNav } from './useListboxKeyboardNav';

function useDebouncedSystem(system: TransitSystem, delayMs: number): TransitSystem {
  const [debounced, setDebounced] = useState<TransitSystem>(system);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(system), delayMs);
    return () => window.clearTimeout(timer.current);
  }, [delayMs, system]);
  return debounced;
}

/**
 * A pure sanity check surfaced as UI: lines that don't run anywhere, routes
 * with a hole in them, lines running the wrong way up a street, and ways that
 * cross without joining (see model/validate.ts). Hidden
 * entirely when the system is clean — this is a warning light, not a panel
 * that's always present and usually empty.
 */
export function IssuesPopover() {
  const store = useEditorStore();
  // Quick validation reads ways/services/stations/nodes; crossing detection
  // reads only ways/nodes. System name, viewport, palette, facilities, and
  // other unrelated changes retain those references and restart neither pass.
  const ways = useEditor((s) => s.system.ways);
  const services = useEditor((s) => s.system.services);
  const stations = useEditor((s) => s.system.stations);
  const nodes = useEditor((s) => s.system.nodes);
  const quickSource = useMemo<TransitSystem>(
    () => ({ ...store.getState().system, ways, services, stations, nodes }),
    [store, ways, services, stations, nodes],
  );
  const crossingSource = useMemo<TransitSystem>(
    () => ({ ...store.getState().system, ways, nodes }),
    [store, ways, nodes],
  );
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  // This component is mounted the whole session (top-bar indicator), and
  // Top-level system identity is fresh on every mutation — a drag frame, an
  // unrelated edit, a GTFS batch. The badge doesn't need sub-frame freshness,
  // so debounce only the dependency snapshots each validation tier reads.
  const debouncedQuick = useDebouncedSystem(quickSource, 400);
  const debouncedCrossings = useDebouncedSystem(crossingSource, 400);
  const quickIssues = useMemo(() => validateSystemQuick(debouncedQuick), [debouncedQuick]);

  // Crossing-without-joining detection is the expensive half of validation
  // (see validate.ts's note — real routes sharing street corridors keep this
  // in the millions of candidate pairs even with a spatial grid). Streamed in
  // via the chunked generator instead of computed synchronously, so this
  // badge stays a live, accurate warning light without ever blocking a frame
  // — the exact same batch+yield shape as the GTFS import itself.
  const [crossingIssues, setCrossingIssues] = useState<Issue[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setCrossingIssues([]);
    (async () => {
      for await (const batch of crossingsWithoutJoiningChunked(debouncedCrossings, {
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        setCrossingIssues((prev) => [...prev, ...batch]);
      }
    })();
    return () => {
      // A boolean would suppress stale results but leave the old dense pass
      // consuming main-thread slices beside the replacement. Abort at the
      // core operation boundaries so only the newest document keeps working.
      controller.abort();
    };
  }, [debouncedCrossings]);

  // Only what someone can act on. A document that contradicts the model —
  // a way with one point, a stop riding a way that is gone — is repaired as
  // it loads (serialize.ts), and a warning about it would be a warning nobody
  // could do anything with. See IssueAudience in model/validate.ts.
  const issues = useMemo(
    () => planIssues([...quickIssues, ...crossingIssues]),
    [quickIssues, crossingIssues],
  );
  const { containerRef, onKeyDown } = useListboxKeyboardNav<HTMLDivElement>();

  if (issues.length === 0) return null;

  const label = `${issues.length} issue${issues.length === 1 ? '' : 's'} found`;
  const firstJumpableId = issues.find((i) => i.target)?.id;

  return (
    <Popover
      trigger={<IconButton icon="warning" label={label} active className="issues-trigger" />}
    >
      <div
        className="issues-popover"
        role="listbox"
        aria-label="Issues"
        ref={containerRef}
        onKeyDown={onKeyDown}
      >
        <span className="panel-section-label">{label}</span>
        <ul className="issues-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={issue.id === firstJumpableId ? 0 : -1}
                className="issues-item"
                disabled={!issue.target}
                onClick={() => issue.target && selectAndFocus(issue.target)}
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
