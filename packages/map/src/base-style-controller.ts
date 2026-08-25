import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

export interface BaseStyleController<ThemeId extends string> {
  request(theme: ThemeId): Promise<void>;
  selectLocal(theme: ThemeId): void;
  flush(): Promise<void>;
  dispose(): void;
}

export interface BaseStyleControllerOptions<ThemeId extends string> {
  map: MapLibreMap;
  initialTheme: ThemeId;
  local(theme: ThemeId): StyleSpecification;
  remoteUrl(theme: ThemeId): string;
  fetch?: (url: string, signal: AbortSignal) => Promise<StyleSpecification>;
  probe?: (url: string) => Promise<boolean>;
  carry?: (
    previous: StyleSpecification | undefined,
    next: StyleSpecification,
    theme: ThemeId,
  ) => StyleSpecification;
  recoverDocumentLayers?: (theme: ThemeId, fullRebuild: boolean) => void;
  timeoutMs: number;
  online?: () => boolean;
  isInteractionActive(): boolean;
  onUnavailable(error: unknown): void;
}

type StyleRequestResult =
  | { kind: 'style'; style: StyleSpecification }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' };

async function fetchStyleDocument(url: string, signal: AbortSignal): Promise<StyleSpecification> {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok) throw new Error(`Basemap style request failed (${response.status})`);
  return (await response.json()) as StyleSpecification;
}

async function probeStyleDocument(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    return response.ok;
  } catch {
    return false;
  }
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

class BaseStyleControllerImplementation<
  ThemeId extends string,
> implements BaseStyleController<ThemeId> {
  private disposed = false;
  private generation = 0;
  private currentTheme: ThemeId;
  private appliedRemoteTheme: ThemeId | undefined;
  private pendingTheme: ThemeId | undefined;
  private activeAbort: AbortController | undefined;
  private activeRequest: Promise<void> = Promise.resolve();

  constructor(private readonly options: BaseStyleControllerOptions<ThemeId>) {
    this.currentTheme = options.initialTheme;
  }

  request(theme: ThemeId): Promise<void> {
    this.activeRequest = this.execute(theme);
    return this.activeRequest;
  }

  selectLocal(theme: ThemeId): void {
    this.cancelActive();
    this.pendingTheme = undefined;
    this.commitLocal(theme);
  }

  async flush(): Promise<void> {
    await this.activeRequest;
    if (this.pendingTheme !== undefined && !this.options.isInteractionActive()) {
      await this.request(this.pendingTheme);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActive();
    this.pendingTheme = undefined;
  }

  private async execute(theme: ThemeId): Promise<void> {
    if (this.disposed || this.deferForInteraction(theme) || this.skipAppliedTheme(theme)) return;
    this.pendingTheme = undefined;
    this.cancelActive();
    if (!(this.options.online ?? (() => navigator.onLine))()) {
      this.commitLocal(theme);
      this.options.onUnavailable(
        new Error('The base map is unavailable while the browser is offline.'),
      );
      return;
    }

    const requestGeneration = ++this.generation;
    const abortController = new AbortController();
    this.activeAbort = abortController;
    const result = await this.requestWithinBudget(theme, abortController);
    if (requestGeneration !== this.generation) return;
    this.activeAbort = undefined;
    this.handleResult(theme, result, abortController, requestGeneration);
  }

  private deferForInteraction(theme: ThemeId): boolean {
    if (!this.options.isInteractionActive()) return false;
    this.cancelActive();
    this.pendingTheme = theme === this.appliedRemoteTheme ? undefined : theme;
    return true;
  }

  private skipAppliedTheme(theme: ThemeId): boolean {
    if (theme !== this.appliedRemoteTheme) return false;
    this.cancelActive();
    this.pendingTheme = undefined;
    return true;
  }

  private async requestWithinBudget(
    theme: ThemeId,
    abortController: AbortController,
  ): Promise<StyleRequestResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<StyleRequestResult>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), this.options.timeoutMs);
    });
    const fetchStyle = this.options.fetch ?? fetchStyleDocument;
    const request = fetchStyle(this.options.remoteUrl(theme), abortController.signal).then<
      StyleRequestResult,
      StyleRequestResult
    >(
      (style) => ({ kind: 'style', style }),
      (error: unknown) => ({ kind: 'error', error }),
    );
    const result = await Promise.race([request, timeout]);
    clearTimeout(timer);
    return result;
  }

  private handleResult(
    theme: ThemeId,
    result: StyleRequestResult,
    abortController: AbortController,
    requestGeneration: number,
  ): void {
    if (result.kind === 'timeout') {
      abortController.abort();
      this.commitLocal(theme);
      this.probeUnavailable(theme, requestGeneration);
      return;
    }
    if (result.kind === 'error') {
      if (!abortError(result.error)) this.options.onUnavailable(result.error);
      this.commitLocal(theme);
      return;
    }
    if (this.deferForInteraction(theme)) return;
    if (this.commit(theme, result.style)) {
      this.currentTheme = theme;
      this.appliedRemoteTheme = theme;
    }
  }

  private probeUnavailable(theme: ThemeId, requestGeneration: number): void {
    const probeStyle = this.options.probe ?? probeStyleDocument;
    void probeStyle(this.options.remoteUrl(theme)).then((reachable) => {
      if (!reachable && !this.disposed && requestGeneration === this.generation) {
        this.options.onUnavailable(new Error('The base map is unavailable.'));
      }
    });
  }

  private commitLocal(theme: ThemeId): void {
    if (theme === this.currentTheme && this.appliedRemoteTheme === undefined) return;
    if (this.commit(theme, this.options.local(theme))) {
      this.currentTheme = theme;
      this.appliedRemoteTheme = undefined;
    }
  }

  private commit(theme: ThemeId, next: StyleSpecification): boolean {
    const carry = this.options.carry ?? ((_previous, incoming) => incoming);
    // MapLibre can omit sources and layers added after the bootstrap style from
    // transformStyle's previous value. Snapshot the live style before the
    // transition so application-owned sources remain paired with their layers.
    const previous = this.options.map.getStyle();
    try {
      this.options.map.setStyle(next, {
        diff: true,
        transformStyle: (_mapPrevious, incoming) => carry(previous, incoming, theme),
      });
      this.options.recoverDocumentLayers?.(theme, false);
      return true;
    } catch {
      return this.commitFull(theme, carry(previous, next, theme));
    }
  }

  private commitFull(theme: ThemeId, next: StyleSpecification): boolean {
    try {
      this.options.map.setStyle(next, { diff: false });
      this.options.recoverDocumentLayers?.(theme, true);
      return true;
    } catch (error) {
      this.options.onUnavailable(error);
      return false;
    }
  }

  private cancelActive(): void {
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
  }
}

export function createBaseStyleController<ThemeId extends string>(
  options: BaseStyleControllerOptions<ThemeId>,
): BaseStyleController<ThemeId> {
  return new BaseStyleControllerImplementation(options);
}
