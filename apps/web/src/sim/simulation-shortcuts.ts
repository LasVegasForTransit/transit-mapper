export interface SimulationShortcutCommands {
  togglePaused(): void;
  stepSpeed(direction: -1 | 1): void;
}

export interface SimulationShortcutBinding {
  readonly group: 'Simulation';
  readonly keys: readonly string[];
  readonly description: string;
  readonly mod?: false;
  readonly shift?: false;
  run(commands: SimulationShortcutCommands): void;
}

export const SIMULATION_SHORTCUT_BINDINGS: readonly SimulationShortcutBinding[] = [
  {
    group: 'Simulation',
    keys: ['k'],
    description: 'Run / pause the simulation',
    run: (commands) => commands.togglePaused(),
  },
  {
    group: 'Simulation',
    keys: [','],
    description: 'Slow the simulation down',
    run: (commands) => commands.stepSpeed(-1),
  },
  {
    group: 'Simulation',
    keys: ['.'],
    description: 'Speed the simulation up',
    run: (commands) => commands.stepSpeed(1),
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    element !== null &&
    (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
  );
}

export function attachSimulationKeyboard(commands: SimulationShortcutCommands): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey) return;
    const binding = SIMULATION_SHORTCUT_BINDINGS.find((candidate) =>
      candidate.keys.some((key) => event.key.toLowerCase() === key),
    );
    if (!binding) return;

    event.preventDefault();
    if (event.repeat) return;
    binding.run(commands);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
