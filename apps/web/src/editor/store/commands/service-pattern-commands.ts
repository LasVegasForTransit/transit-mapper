import { oneSection, patternHasSplit, patternRunLegs } from '@transitmapper/core/model/geo';
import { shortId } from '@transitmapper/core/model/ids';
import { trimPatternSectionsTo } from '@transitmapper/core/model/pattern-section-trimming';
import {
  dividePatternAtPosition,
  endPatternAtPosition,
  extendPatternTerminus,
  trimPatternAtPosition,
} from '@transitmapper/core/model/serviceEdits';
import {
  divideServicePath,
  replaceServicePath,
  servicePathOperatingMeters,
  setPatternStopSkipped,
  withPatternSections,
} from '@transitmapper/core/model/service-path-edits';
import { materializeRouteSpans } from '@transitmapper/core/model/routeLegs';
import { lineForService } from '@transitmapper/core/model/system';
import type { ServiceCommands } from '../contracts/service-commands';
import { unusedPaletteColor } from '../internal-operations/service-creation';
import type { EditorRuntime } from '../runtime';

type ServicePatternCommands = Pick<
  ServiceCommands,
  | 'trimPatternTo'
  | 'trimPatternAt'
  | 'extendPatternTerminus'
  | 'endPatternAt'
  | 'divideServiceAt'
  | 'splitServiceAt'
  | 'setStopSkipped'
  | 'makePatternTwoWay'
>;

type TerminusPatternCommands = Pick<ServiceCommands, 'extendPatternTerminus' | 'endPatternAt'>;

function createTerminusPatternCommands(runtime: EditorRuntime): TerminusPatternCommands {
  return {
    extendPatternTerminus(serviceId, patternId, side, spans) {
      return runtime.commitContent(false, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === patternId ? service.path : undefined;
        const legs = materializeRouteSpans(state.system, spans);
        const extended = pattern && legs ? extendPatternTerminus(pattern, side, legs) : null;
        return {
          system: extended
            ? replaceServicePath(state.system, serviceId, patternId, extended)
            : state.system,
          result: extended !== null,
        };
      });
    },

    endPatternAt(serviceId, position) {
      return runtime.commitContent(false, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === position.patternId ? service.path : undefined;
        if (!pattern) return { system: state.system, result: false };
        const ended = endPatternAtPosition(state.system.ways, pattern, position);
        if (!ended) return { system: state.system, result: false };
        return {
          system: replaceServicePath(
            state.system,
            serviceId,
            position.patternId,
            withPatternSections(pattern, ended.pattern.sections),
          ),
          result: true,
        };
      });
    },
  };
}

type DivisionPatternCommands = Pick<ServiceCommands, 'divideServiceAt' | 'splitServiceAt'>;

function createDivisionPatternCommands(runtime: EditorRuntime): DivisionPatternCommands {
  return {
    divideServiceAt(serviceId, position) {
      return runtime.commitContent<string | null>(null, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === position.patternId ? service.path : undefined;
        const division = pattern
          ? dividePatternAtPosition(state.system.ways, pattern, position)
          : null;
        if (!service || !pattern || !division) return { system: state.system, result: null };
        const spawnedServiceId = shortId();
        const system = divideServicePath(state.system, {
          sourceServiceId: service.id,
          spawnedServiceId,
          remaining: division.remaining,
          divided: division.divided,
          line: { kind: 'source' },
        });
        if (system === state.system) return { system: state.system, result: null };
        return {
          system,
          transient: {
            selection: { kind: 'service', id: spawnedServiceId },
            activePatternId: spawnedServiceId,
          },
          result: spawnedServiceId,
        };
      });
    },

    splitServiceAt(serviceId, patternId, wayId, t) {
      return runtime.commitContent<string | null>(null, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === patternId ? service.path : undefined;
        if (!service || !pattern) return { system: state.system, result: null };
        const near = trimPatternSectionsTo(state.system.ways, pattern.sections, {
          wayId,
          t,
          side: 'end',
        });
        const far = trimPatternSectionsTo(state.system.ways, pattern.sections, {
          wayId,
          t,
          side: 'start',
        });
        if (!near?.length || !far?.length) return { system: state.system, result: null };
        const nearPattern = { ...pattern, sections: near };
        const farPattern = { ...pattern, sections: far };
        const [remaining, divided] =
          servicePathOperatingMeters(state.system, nearPattern) >=
          servicePathOperatingMeters(state.system, farPattern)
            ? [nearPattern, farPattern]
            : [farPattern, nearPattern];
        const sourceLine = lineForService(state.system, service.id);
        if (!sourceLine) return { system: state.system, result: null };
        const spawnedServiceId = shortId();
        const system = divideServicePath(state.system, {
          sourceServiceId: service.id,
          spawnedServiceId,
          remaining,
          divided,
          line: {
            kind: 'new',
            id: shortId(),
            name: `${sourceLine.name} 2`,
            color: unusedPaletteColor(state.system, service.modeId),
          },
        });
        if (system === state.system) return { system: state.system, result: null };
        return {
          system,
          transient: { selection: { kind: 'service', id: spawnedServiceId } },
          result: spawnedServiceId,
        };
      });
    },
  };
}

type TrimPatternCommands = Pick<ServiceCommands, 'trimPatternAt' | 'trimPatternTo'>;

function createTrimPatternCommands(runtime: EditorRuntime): TrimPatternCommands {
  return {
    trimPatternAt(serviceId, position, side) {
      return runtime.commitContent(false, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === position.patternId ? service.path : undefined;
        if (!pattern) return { system: state.system, result: false };
        const trimmed = trimPatternAtPosition(state.system.ways, pattern, position, side);
        if (!trimmed) return { system: state.system, result: false };
        return {
          system: replaceServicePath(
            state.system,
            serviceId,
            position.patternId,
            withPatternSections(pattern, trimmed.sections),
          ),
          result: true,
        };
      });
    },

    trimPatternTo: (...[serviceId, patternId, wayId, t, side]) => {
      return runtime.commitContent(false, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === patternId ? service.path : undefined;
        const sections = pattern
          ? trimPatternSectionsTo(state.system.ways, pattern.sections, { wayId, t, side })
          : null;
        if (!pattern || !sections || sections.length === 0)
          return { system: state.system, result: false };
        return {
          system: replaceServicePath(
            state.system,
            serviceId,
            patternId,
            withPatternSections(pattern, sections),
          ),
          result: true,
        };
      });
    },
  };
}

type PatternStopCommands = Pick<ServiceCommands, 'setStopSkipped' | 'makePatternTwoWay'>;

function createPatternStopCommands(runtime: EditorRuntime): PatternStopCommands {
  return {
    setStopSkipped: (...[serviceId, patternId, run, stationId, skipped]) => {
      runtime.commitContent(undefined, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === patternId ? service.path : undefined;
        const updated = pattern ? setPatternStopSkipped(pattern, run, stationId, skipped) : null;
        return {
          system: updated
            ? replaceServicePath(state.system, serviceId, patternId, updated)
            : state.system,
          result: undefined,
        };
      });
    },

    makePatternTwoWay(serviceId, patternId) {
      runtime.commitContent(undefined, (state) => {
        const service = state.system.services.find((candidate) => candidate.id === serviceId);
        const pattern = service?.path.id === patternId ? service.path : undefined;
        if (!pattern || !patternHasSplit(pattern))
          return { system: state.system, result: undefined };
        const legs = patternRunLegs(pattern, 'outbound').map((entry) => entry.leg);
        return {
          system: replaceServicePath(state.system, serviceId, patternId, {
            ...pattern,
            sections: oneSection(legs),
          }),
          result: undefined,
        };
      });
    },
  };
}

export function createServicePatternCommands(runtime: EditorRuntime): ServicePatternCommands {
  return {
    ...createTerminusPatternCommands(runtime),
    ...createDivisionPatternCommands(runtime),
    ...createTrimPatternCommands(runtime),
    ...createPatternStopCommands(runtime),
  };
}
