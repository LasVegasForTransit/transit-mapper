import type {
  MapDefinition,
  MapDriver,
  MapDriverAttachment,
  MapDriverAttachOptions,
} from './map-driver';

export interface DeferredMapDriverOptions {
  definition: MapDefinition;
  load(signal: AbortSignal): Promise<MapDriver>;
}

const abortedAttachment: MapDriverAttachment = {
  resolveFeature: () => Promise.resolve(null),
  dispose() {},
};

function reportSafely(options: MapDriverAttachOptions, error: unknown): void {
  try {
    options.host.reportError(error);
  } catch {
    // Diagnostics cannot prevent an aborted attachment from releasing its resources.
  }
}

function disposeLateAttachment(
  options: MapDriverAttachOptions,
  attachment: MapDriverAttachment,
): void {
  try {
    attachment.dispose();
  } catch (error) {
    reportSafely(options, error);
  }
}

function attachmentWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

class DeferredMapDriver implements MapDriver {
  readonly definition: MapDefinition;

  constructor(private readonly options: DeferredMapDriverOptions) {
    this.definition = options.definition;
  }

  async attach(attachOptions: MapDriverAttachOptions): Promise<MapDriverAttachment> {
    if (attachmentWasAborted(attachOptions.signal)) return abortedAttachment;

    const driver = await this.options.load(attachOptions.signal);
    if (attachmentWasAborted(attachOptions.signal)) return abortedAttachment;

    const attachment = await driver.attach(attachOptions);
    if (!attachmentWasAborted(attachOptions.signal)) return attachment;

    disposeLateAttachment(attachOptions, attachment);
    return abortedAttachment;
  }
}

export function createDeferredMapDriver(options: DeferredMapDriverOptions): MapDriver {
  return new DeferredMapDriver(options);
}
