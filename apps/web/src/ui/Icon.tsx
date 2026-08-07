import type { ComponentType, CSSProperties } from 'react';
import {
  Bike,
  Bus,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  DoorOpen,
  File,
  Hammer,
  Hand,
  Keyboard,
  LandPlot,
  Layers,
  Lock,
  MoveVertical,
  MousePointer2,
  ParkingSquare,
  Pause,
  Play,
  Plus,
  Redo2,
  Road,
  Route,
  Rows,
  Share2,
  Slash,
  Spline,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
  Warehouse,
  Waves,
  X,
  type LucideProps,
} from 'lucide-react';

// Real icons (Lucide, MIT-licensed) behind the app's existing name
// vocabulary. Every existing call site (`<Icon name="road">`,
// catalogStyle.ts's facilityRender, the Toolbar's per-tool-family lookup,
// IconButton) keeps its exact string unchanged — only what each name renders
// to changed, from a hand-drawn 24x24 path to a real icon. `map/icons.ts`
// reuses this same ICONS map to rasterize on-map pictograms, so the React UI
// and the map canvas still share one vocabulary, not two.
export const ICONS = {
  cursor: MousePointer2,
  line: Route,
  station: Circle,
  road: Road,
  pan: Hand,
  share: Share2,
  download: Download,
  plus: Plus,
  trash: Trash2,
  x: X,
  copy: Copy,
  file: File,
  geoStraight: Slash,
  geoCurved: Spline,
  geoFreeform: Waves,
  keyboard: Keyboard,
  chevronDown: ChevronDown,
  check: Check,
  layers: Layers,
  undo: Undo2,
  redo: Redo2,
  sidebar: Square,
  door: DoorOpen,
  bike: Bike,
  elevator: MoveVertical,
  parking: ParkingSquare,
  depot: Warehouse,
  bus: Bus,
  platform: Rows,
  square: Square,
  warning: TriangleAlert,
  clock: Clock,
  boundary: LandPlot,
  lock: Lock,
  play: Play,
  pause: Pause,
  demolish: Hammer,
} satisfies Record<string, ComponentType<LucideProps>>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, style }: IconProps) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={2} style={style} aria-hidden="true" />;
}
