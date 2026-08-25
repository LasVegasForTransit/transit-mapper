import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

export interface BaseStyleController<ThemeId extends string> {
  request(theme: ThemeId): Promise<void>;
  selectLocal(theme: ThemeId): Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
}

export interface BaseStyleControllerOptions<ThemeId extends string> {
  map: MapLibreMap;
  initialTheme: ThemeId;
  initialStyle?: 'local' | 'remote';
  local(theme: ThemeId): StyleSpecification;
  remoteUrl(theme: ThemeId): string;
  fetch?: (url: string, signal: AbortSignal) => Promise<StyleSpecification>;
  probe?: (url: string) => Promise<boolean>;
  carry?: (
    previous: StyleSpecification | undefined,
    next: StyleSpecification,
    theme: ThemeId,
  ) => StyleSpecification;
  isDocumentStateRetained?: () => boolean;
  onThemeApplied?: (theme: ThemeId) => void;
  recoverDocumentLayers?: (theme: ThemeId, fullRebuild: boolean) => void;
  timeoutMs: number;
  online?: () => boolean;
  isInteractionActive(): boolean;
  onUnavailable(error: unknown): void;
}

type StyleRequestResult =
  | { kind: 'style'; style: StyleSpecification }
  | { kind: 'error'; error: unknown }
  | { kind: 'cancelled' }
  | { kind: 'timeout' };

type StyleSettlement =
  | { kind: 'loaded'; fullRebuild: boolean }
  | { kind: 'failed'; error: unknown }
  | { kind: 'cancelled' };

interface CarriedStyleTransition {
  previous: StyleSpecification;
  carried: StyleSpecification;
}

interface ActiveStyleNotification {
  marker: string;
  onApplied(): void;
}

const STYLE_TRANSITION_METADATA_KEY = 'transitmapper:base-style-transition';

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function styleWithTransitionMarker(style: StyleSpecification, marker: string): StyleSpecification {
  return {
    ...style,
    metadata: {
      ...metadataRecord(style.metadata),
      [STYLE_TRANSITION_METADATA_KEY]: marker,
    },
  };
}

function styleHasTransitionMarker(style: StyleSpecification | undefined, marker: string): boolean {
  return metadataRecord(style?.metadata)[STYLE_TRANSITION_METADATA_KEY] === marker;
}

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
  private activeTransitionCancel: (() => void) | undefined;
  private activeRequest: Promise<void> = Promise.resolve();
  private lastUsableStyle: StyleSpecification;
  private lastUsableTheme: ThemeId;
  private hasRemoteTransitionBaseline = false;
  private transitionSequence = 0;
  private activeStyleNotification: ActiveStyleNotification | undefined;
  private readonly onStyleLoad = () => {
    const notification = this.activeStyleNotification;
    if (!notification) return;
    if (!styleHasTransitionMarker(this.options.map.getStyle(), notification.marker)) return;
    notification.onApplied();
  };

  constructor(private readonly options: BaseStyleControllerOptions<ThemeId>) {
    this.currentTheme = options.initialTheme;
    this.appliedRemoteTheme = options.initialStyle === 'remote' ? options.initialTheme : undefined;
    this.lastUsableTheme = options.initialTheme;
    this.lastUsableStyle = options.map.getStyle();
    // Register before the host installs its persistent recovery listeners.
    // Those listeners must observe the theme that belongs to this style.load.
    options.map.on('style.load', this.onStyleLoad);
  }

  request(theme: ThemeId): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.activeRequest = this.execute(theme);
    return this.activeRequest;
  }

  selectLocal(theme: ThemeId): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.cancelActive();
    this.pendingTheme = undefined;
    const requestGeneration = ++this.generation;
    this.activeRequest = this.applyLocalBootstrap(theme, requestGeneration);
    return this.activeRequest;
  }

  async flush(): Promise<void> {
    if (this.disposed) return;
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
    this.options.map.off('style.load', this.onStyleLoad);
  }

  private async execute(theme: ThemeId): Promise<void> {
    if (this.disposed || this.deferForInteraction(theme) || this.skipAppliedTheme(theme)) return;
    this.pendingTheme = undefined;
    this.cancelActive();
    if (!(this.options.online ?? (() => navigator.onLine))()) {
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
    await this.handleResult(theme, result, abortController, requestGeneration);
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
    const request = Promise.resolve()
      .then(() => fetchStyle(this.options.remoteUrl(theme), abortController.signal))
      .then<StyleRequestResult, StyleRequestResult>(
        (style) => ({ kind: 'style', style }),
        (error: unknown) => ({ kind: 'error', error }),
      );
    let cancelRequest: ((result: StyleRequestResult) => void) | undefined;
    const cancelled = new Promise<StyleRequestResult>((resolve) => {
      cancelRequest = resolve;
    });
    const onAbort = () => cancelRequest?.({ kind: 'cancelled' });
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    const result = await Promise.race([request, timeout, cancelled]);
    abortController.signal.removeEventListener('abort', onAbort);
    clearTimeout(timer);
    return result;
  }

  private async handleResult(
    theme: ThemeId,
    result: StyleRequestResult,
    abortController: AbortController,
    requestGeneration: number,
  ): Promise<void> {
    if (result.kind === 'cancelled') return;
    if (result.kind === 'timeout') {
      abortController.abort();
      this.probeUnavailable(theme, requestGeneration);
      return;
    }
    if (result.kind === 'error') {
      if (!abortError(result.error)) this.options.onUnavailable(result.error);
      return;
    }
    if (this.deferForInteraction(theme)) return;
    if (await this.commit(theme, result.style, requestGeneration)) {
      this.currentTheme = theme;
      this.appliedRemoteTheme = theme;
    }
  }

  private probeUnavailable(theme: ThemeId, requestGeneration: number): void {
    const probeStyle = this.options.probe ?? probeStyleDocument;
    void Promise.resolve()
      .then(() => probeStyle(this.options.remoteUrl(theme)))
      .then((reachable) => {
        if (!reachable && !this.disposed && requestGeneration === this.generation) {
          this.options.onUnavailable(new Error('The base map is unavailable.'));
        }
      })
      .catch((error: unknown) => {
        if (!this.disposed && requestGeneration === this.generation) {
          this.options.onUnavailable(error);
        }
      });
  }

  private async applyLocalBootstrap(theme: ThemeId, requestGeneration: number): Promise<void> {
    if (theme === this.currentTheme && this.appliedRemoteTheme === undefined) return;
    const { carried: localStyle } = this.carryStyle(theme, this.options.local(theme));
    const result = await this.applyStyle(
      localStyle,
      (markedStyle) => this.options.map.setStyle(markedStyle, { diff: true }),
      requestGeneration,
      () => this.options.onThemeApplied?.(theme),
    );
    if (result.kind === 'cancelled') return;
    if (result.kind === 'failed') {
      this.options.onUnavailable(result.error);
      await this.restoreLastUsableStyle(requestGeneration);
      return;
    }
    this.currentTheme = theme;
    this.appliedRemoteTheme = undefined;
    this.lastUsableTheme = theme;
    this.lastUsableStyle = this.options.map.getStyle();
  }

  private async commit(
    theme: ThemeId,
    next: StyleSpecification,
    requestGeneration: number,
  ): Promise<boolean> {
    const { previous, carried } = this.carryStyle(theme, next);
    if (!this.hasRemoteTransitionBaseline) {
      this.lastUsableStyle = previous;
      this.lastUsableTheme = this.currentTheme;
      this.hasRemoteTransitionBaseline = true;
    }
    const result = await this.applyStyle(
      carried,
      (markedStyle) => this.options.map.setStyle(markedStyle, { diff: true }),
      requestGeneration,
      () => this.options.onThemeApplied?.(theme),
    );
    if (result.kind === 'cancelled') return false;
    if (result.kind === 'failed') {
      this.options.onUnavailable(result.error);
      await this.restoreLastUsableStyle(requestGeneration);
      return false;
    }
    this.lastUsableStyle = this.options.map.getStyle();
    this.lastUsableTheme = theme;
    const fullRebuild =
      result.fullRebuild ||
      (this.options.isDocumentStateRetained ? !this.options.isDocumentStateRetained() : false);
    this.options.recoverDocumentLayers?.(theme, fullRebuild);
    return true;
  }

  private carryStyle(theme: ThemeId, next: StyleSpecification): CarriedStyleTransition {
    const previous = this.options.map.getStyle();
    const carry = this.options.carry ?? ((_previous, incoming) => incoming);
    // MapLibre can omit runtime-added sources from transformStyle's previous
    // value. Carry the live snapshot before stamping it so a host that returns
    // a fresh style cannot discard the transition identity either.
    return { previous, carried: carry(previous, next, theme) };
  }

  private applyStyle(
    style: StyleSpecification,
    apply: (markedStyle: StyleSpecification) => unknown,
    requestGeneration: number,
    onApplied: () => void,
  ): Promise<StyleSettlement> {
    if (this.disposed || requestGeneration !== this.generation) {
      return Promise.resolve({ kind: 'cancelled' });
    }
    const marker = `${requestGeneration}:${++this.transitionSequence}`;
    const markedStyle = styleWithTransitionMarker(style, marker);
    let applied = false;
    const notifyApplied = () => {
      if (applied) return;
      applied = true;
      onApplied();
    };
    this.activeStyleNotification = { marker, onApplied: notifyApplied };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ kind: 'failed', error: new Error('Map style did not become usable in time.') });
      }, this.options.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.options.map.off('style.load', onStyleLoad);
        if (this.activeTransitionCancel === cancel) this.activeTransitionCancel = undefined;
        if (this.activeStyleNotification?.marker === marker) {
          this.activeStyleNotification = undefined;
        }
      };
      const cancel = () => {
        cleanup();
        resolve({ kind: 'cancelled' });
      };
      const onStyleLoad = () => {
        if (this.disposed || requestGeneration !== this.generation) {
          cancel();
          return;
        }
        if (!styleHasTransitionMarker(this.options.map.getStyle(), marker)) return;
        cleanup();
        resolve({ kind: 'loaded', fullRebuild: true });
      };
      this.activeTransitionCancel = cancel;
      this.options.map.on('style.load', onStyleLoad);
      try {
        apply(markedStyle);
        // MapLibre's successful diff path updates the current style without a
        // style.load event. A full rebuild does emit style.load later. The
        // marker distinguishes both from stale events and unrelated errors.
        if (styleHasTransitionMarker(this.options.map.getStyle(), marker)) {
          notifyApplied();
          cleanup();
          resolve({ kind: 'loaded', fullRebuild: false });
        }
      } catch (error) {
        cleanup();
        resolve({ kind: 'failed', error });
      }
    });
  }

  private async restoreLastUsableStyle(requestGeneration: number): Promise<void> {
    const result = await this.applyStyle(
      this.lastUsableStyle,
      (markedStyle) => this.options.map.setStyle(markedStyle, { diff: false }),
      requestGeneration,
      () => this.options.onThemeApplied?.(this.lastUsableTheme),
    );
    if (result.kind !== 'loaded') return;
    this.options.recoverDocumentLayers?.(this.lastUsableTheme, true);
  }

  private cancelActive(): void {
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.activeTransitionCancel?.();
    this.activeTransitionCancel = undefined;
    this.activeStyleNotification = undefined;
  }
}

export function createBaseStyleController<ThemeId extends string>(
  options: BaseStyleControllerOptions<ThemeId>,
): BaseStyleController<ThemeId> {
  return new BaseStyleControllerImplementation(options);
}
