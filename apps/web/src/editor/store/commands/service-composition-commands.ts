import { throughRouteServices } from '@transitmapper/core/model/throughRoute';
import type { ServiceCommands } from '../contracts/service-commands';
import type { EditorRuntime } from '../runtime';

type ServiceCompositionCommands = Pick<ServiceCommands, 'throughRouteInto'>;

export function createServiceCompositionCommands(
  runtime: EditorRuntime,
): ServiceCompositionCommands {
  return {
    throughRouteInto(keepId, otherId) {
      return runtime.commitContent(false, (state) => {
        const system = throughRouteServices(state.system, keepId, otherId);
        if (!system) return { system: state.system, result: false };
        return {
          system,
          transient: {
            multiSelection: [],
            selection: { kind: 'service', id: keepId },
            activePatternId: keepId,
            armedTerminus: null,
          },
          result: true,
        };
      });
    },
  };
}
