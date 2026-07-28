import type { IconName } from '../ui/Icon';

// Each icon's raw shape data, copied once from lucide-react@1.27.0's
// per-icon source (node_modules/lucide-react/dist/esm/icons/*.mjs) rather
// than imported from it. Two reasons this is a copy, not an import:
//
// - lucide-react only ships type declarations for its public barrel; the
//   per-icon modules' raw `__iconNode` export has no types, and TypeScript's
//   ambient-module-declaration mechanism doesn't reliably shadow a path that
//   genuinely resolves to a real file (see git history on this file for the
//   dead end that chased before landing here).
// - Rendering the actual React component instead (via react-dom/server) was
//   tried first and rejected: it pulls a second copy of react-dom into the
//   client bundle, which corrupts every hook call app-wide ("Invalid hook
//   call") — see map/icons.ts's own comment.
//
// This is what map/icons.ts's on-map pictogram rasterizer draws from; the
// React UI's <Icon/> (ui/Icon.tsx) still renders the real lucide-react
// components normally. A future Lucide upgrade that redraws one of these
// icons would need this file re-copied to match — a real but low-severity
// drift risk, worth it to avoid the alternatives above.
export type IconNode = readonly (readonly [string, Record<string, string>])[];

export const ICON_NODES: Record<IconName, IconNode> = {
  cursor: [
    [
      'path',
      {
        d: 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z',
        key: 'edeuup',
      },
    ],
  ],
  line: [
    ['circle', { cx: '6', cy: '19', r: '3', key: '1kj8tv' }],
    ['path', { d: 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15', key: '1d8sl' }],
    ['circle', { cx: '18', cy: '5', r: '3', key: 'gq8acd' }],
  ],
  station: [['circle', { cx: '12', cy: '12', r: '10', key: '1mglay' }]],
  road: [
    ['path', { d: 'M12 17v4', key: '1riwvh' }],
    ['path', { d: 'M12 5V3', key: 'vd5es' }],
    ['path', { d: 'M12 9v3', key: 'qyerrc' }],
    [
      'path',
      {
        d: 'M2.077 18.449A2 2 0 0 0 4 21h16a2 2 0 0 0 1.924-2.55l-4-14A2 2 0 0 0 16 3H8a2 2 0 0 0-1.924 1.45z',
        key: '1cuxct',
      },
    ],
  ],
  pan: [
    ['path', { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2', key: '1fvzgz' }],
    ['path', { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2', key: '1kc0my' }],
    ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8', key: '10h0bg' }],
    [
      'path',
      {
        d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
        key: '1s1gnw',
      },
    ],
  ],
  share: [
    ['circle', { cx: '18', cy: '5', r: '3', key: 'gq8acd' }],
    ['circle', { cx: '6', cy: '12', r: '3', key: 'w7nqdw' }],
    ['circle', { cx: '18', cy: '19', r: '3', key: '1xt0gg' }],
    ['line', { x1: '8.59', x2: '15.42', y1: '13.51', y2: '17.49', key: '47mynk' }],
    ['line', { x1: '15.41', x2: '8.59', y1: '6.51', y2: '10.49', key: '1n3mei' }],
  ],
  download: [
    ['path', { d: 'M12 15V3', key: 'm9g1x1' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', key: 'ih7n3h' }],
    ['path', { d: 'm7 10 5 5 5-5', key: 'brsn70' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14', key: '1ays0h' }],
    ['path', { d: 'M12 5v14', key: 's699le' }],
  ],
  trash: [
    ['path', { d: 'M10 11v6', key: 'nco0om' }],
    ['path', { d: 'M14 11v6', key: 'outv1u' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', key: 'miytrc' }],
    ['path', { d: 'M3 6h18', key: 'd0wm0j' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', key: 'e791ji' }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18', key: '1bl5f8' }],
    ['path', { d: 'm6 6 12 12', key: 'd8bk6v' }],
  ],
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2', key: '17jyea' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2', key: 'zix9uf' }],
  ],
  file: [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
        key: '1oefj6',
      },
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5', key: 'wfsgrz' }],
  ],
  geoStraight: [['path', { d: 'M22 2 2 22', key: 'y4kqgn' }]],
  geoCurved: [
    ['circle', { cx: '19', cy: '5', r: '2', key: 'mhkx31' }],
    ['circle', { cx: '5', cy: '19', r: '2', key: 'v8kfzx' }],
    ['path', { d: 'M5 17A12 12 0 0 1 17 5', key: '1okkup' }],
  ],
  geoFreeform: [
    ['path', { d: 'M2 12q2.5 2 5 0t5 0 5 0 5 0', key: '8ddzzs' }],
    ['path', { d: 'M2 19q2.5 2 5 0t5 0 5 0 5 0', key: '1wj4st' }],
    ['path', { d: 'M2 5q2.5 2 5 0t5 0 5 0 5 0', key: '69x50u' }],
  ],
  keyboard: [
    ['path', { d: 'M10 8h.01', key: '1r9ogq' }],
    ['path', { d: 'M12 12h.01', key: '1mp3jc' }],
    ['path', { d: 'M14 8h.01', key: '1primd' }],
    ['path', { d: 'M16 12h.01', key: '1l6xoz' }],
    ['path', { d: 'M18 8h.01', key: 'emo2bl' }],
    ['path', { d: 'M6 8h.01', key: 'x9i8wu' }],
    ['path', { d: 'M7 16h10', key: 'wp8him' }],
    ['path', { d: 'M8 12h.01', key: 'czm47f' }],
    ['rect', { width: '20', height: '16', x: '2', y: '4', rx: '2', key: '18n3k1' }],
  ],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5', key: '1gmf2c' }]],
  layers: [
    [
      'path',
      {
        d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
        key: 'zw3jo',
      },
    ],
    [
      'path',
      {
        d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12',
        key: '1wduqc',
      },
    ],
    [
      'path',
      {
        d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17',
        key: 'kqbvx6',
      },
    ],
  ],
  undo: [
    ['path', { d: 'M9 14 4 9l5-5', key: '102s5s' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11', key: 'f3b9sd' }],
  ],
  redo: [
    ['path', { d: 'm15 14 5-5-5-5', key: '12vg1m' }],
    ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13', key: '6uklza' }],
  ],
  sidebar: [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }]],
  door: [
    ['path', { d: 'M11 20H2', key: 'nlcfvz' }],
    [
      'path',
      {
        d: 'M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z',
        key: 'au4z13',
      },
    ],
    ['path', { d: 'M11 4H8a2 2 0 0 0-2 2v14', key: '74r1mk' }],
    ['path', { d: 'M14 12h.01', key: '1jfl7z' }],
    ['path', { d: 'M22 20h-3', key: 'vhrsz' }],
  ],
  bike: [
    ['circle', { cx: '18.5', cy: '17.5', r: '3.5', key: '15x4ox' }],
    ['circle', { cx: '5.5', cy: '17.5', r: '3.5', key: '1noe27' }],
    ['circle', { cx: '15', cy: '5', r: '1', key: '19l28e' }],
    ['path', { d: 'M12 17.5V14l-3-3 4-3 2 3h2', key: '1npguv' }],
  ],
  elevator: [
    ['path', { d: 'M12 2v20', key: 't6zp3m' }],
    ['path', { d: 'm8 18 4 4 4-4', key: 'bh5tu3' }],
    ['path', { d: 'm8 6 4-4 4 4', key: 'ybng9g' }],
  ],
  parking: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }],
    ['path', { d: 'M9 17V7h4a3 3 0 0 1 0 6H9', key: '1dfk2c' }],
  ],
  depot: [
    ['path', { d: 'M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11', key: 'pb2vm6' }],
    [
      'path',
      {
        d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z',
        key: 'doq5xv',
      },
    ],
    ['path', { d: 'M6 13h12', key: 'yf64js' }],
    ['path', { d: 'M6 17h12', key: '1jwigz' }],
  ],
  bus: [
    ['path', { d: 'M8 6v6', key: '18i7km' }],
    ['path', { d: 'M15 6v6', key: '1sg6z9' }],
    ['path', { d: 'M2 12h19.6', key: 'de5uta' }],
    [
      'path',
      {
        d: 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3',
        key: '1wwztk',
      },
    ],
    ['circle', { cx: '7', cy: '18', r: '2', key: '19iecd' }],
    ['path', { d: 'M9 18h5', key: 'lrx6i' }],
    ['circle', { cx: '16', cy: '18', r: '2', key: '1v4tcr' }],
  ],
  platform: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }],
    ['path', { d: 'M3 12h18', key: '1i2n21' }],
  ],
  square: [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }]],
  warning: [
    [
      'path',
      {
        d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
        key: 'wmoenq',
      },
    ],
    ['path', { d: 'M12 9v4', key: 'juzpu7' }],
    ['path', { d: 'M12 17h.01', key: 'p32p05' }],
  ],
  clock: [
    ['circle', { cx: '12', cy: '12', r: '10', key: '1mglay' }],
    ['path', { d: 'M12 6v6l4 2', key: 'mmk7yg' }],
  ],
  boundary: [
    ['path', { d: 'm12 8 6-3-6-3v10', key: 'mvpnpy' }],
    [
      'path',
      {
        d: 'm8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12',
        key: 'ek95tt',
      },
    ],
    ['path', { d: 'm6.49 12.85 11.02 6.3', key: '1kt42w' }],
    ['path', { d: 'M17.51 12.85 6.5 19.15', key: 'v55bdg' }],
  ],
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2', key: '1w4ew1' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4', key: 'fwvmzm' }],
  ],
  play: [
    [
      'path',
      {
        d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
        key: '10ikf1',
      },
    ],
  ],
  pause: [
    ['rect', { x: '14', y: '3', width: '5', height: '18', rx: '1', key: 'kaeet6' }],
    ['rect', { x: '5', y: '3', width: '5', height: '18', rx: '1', key: '1wsw3u' }],
  ],
};
