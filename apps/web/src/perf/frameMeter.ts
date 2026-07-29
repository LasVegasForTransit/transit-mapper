import type { Map as MLMap } from 'maplibre-gl';
import { formatFrameStats, summarizeFrames, type FrameStats } from './frameStats';

const WINDOW = 240; // rolling painted-frame samples (~a few seconds of movement)
const MAX_GAP_MS = 500; // ignore idle gaps between bursts of rendering

export interface FrameMeter {
  stats: () => FrameStats;
  detach: () => void;
}

/**
 * Sample PAINTED-frame intervals via MapLibre's 'render' event — the map
 * repaints on demand, so consecutive renders during a drag are the real pan
 * frame times (a plain rAF counter would over-report, ticking even when the map
 * isn't painting). Shows a small live overlay bottom-left. Note: the ambient
 * vehicle sim pushes at ~30Hz, so an IDLE map reads ~30fps here (that's the sim
 * cadence, not jank); the number that matters is the one WHILE panning.
 */
export function attachFrameMeter(map: MLMap): FrameMeter {
  const durations: number[] = [];
  let last = performance.now();

  const onRender = () => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (dt > 0 && dt < MAX_GAP_MS) {
      durations.push(dt);
      if (durations.length > WINDOW) durations.shift();
    }
  };
  map.on('render', onRender);

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px ui-monospace,SFMono-Regular,monospace;' +
    'background:var(--md-sys-color-inverse-surface);color:var(--md-sys-color-inverse-on-surface);' +
    'padding:4px 8px;border-radius:6px;' +
    'pointer-events:none;white-space:nowrap;letter-spacing:0.02em';
  document.body.appendChild(overlay);

  let overlayRaf = requestAnimationFrame(function refresh() {
    overlay.textContent = formatFrameStats(summarizeFrames(durations));
    overlayRaf = requestAnimationFrame(refresh);
  });

  return {
    stats: () => summarizeFrames(durations),
    detach: () => {
      map.off('render', onRender);
      cancelAnimationFrame(overlayRaf);
      overlay.remove();
    },
  };
}
