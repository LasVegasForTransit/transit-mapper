import type { Pattern, PatternLeg, Service } from '../model/system';

export type ServiceSpanBranch = 'shared' | 'outbound' | 'inbound' | 'turnaround';

export interface ServiceSpanDependencyIdentity {
  serviceId: string;
  patternId: string;
  sectionIndex: number;
  branch: ServiceSpanBranch;
  legIndex: number;
}

export interface ServiceSpanDependency {
  id: string;
  serviceId: string;
  wayId: string;
}

function encodedPart(value: string): string {
  return encodeURIComponent(value);
}

/** Stable domain identity for one service leg before it becomes render geometry. */
export function serviceSpanDependencyId(identity: ServiceSpanDependencyIdentity): string {
  return `service-span:${encodedPart(identity.serviceId)}:${encodedPart(identity.patternId)}:${identity.sectionIndex}:${identity.branch}:${identity.legIndex}`;
}

/** Stable domain identity for one named-corridor label path. */
export function namedWayLabelDependencyId(namedWayId: string, wayId: string): string {
  return `named-way-label:${encodedPart(namedWayId)}:${encodedPart(wayId)}`;
}

interface PatternBranch {
  branch: ServiceSpanBranch;
  legs: readonly PatternLeg[];
}

function branchesForPatternSection(section: Pattern['sections'][number]): readonly PatternBranch[] {
  if (section.kind === 'split') {
    return [
      { branch: 'outbound', legs: section.outbound },
      { branch: 'inbound', legs: section.inbound },
    ];
  }
  return [{ branch: section.kind, legs: section.legs }];
}

interface PatternSpanContext {
  serviceId: string;
  patternId: string;
  sectionIndex: number;
}

function branchSpans(context: PatternSpanContext, branch: PatternBranch): ServiceSpanDependency[] {
  return branch.legs.map((leg, legIndex) => ({
    id: serviceSpanDependencyId({ ...context, branch: branch.branch, legIndex }),
    serviceId: context.serviceId,
    wayId: leg.wayId,
  }));
}

function patternSpans(serviceId: string, pattern: Pattern): ServiceSpanDependency[] {
  const spans: ServiceSpanDependency[] = [];
  for (let sectionIndex = 0; sectionIndex < pattern.sections.length; sectionIndex++) {
    const context = { serviceId, patternId: pattern.id, sectionIndex };
    for (const branch of branchesForPatternSection(pattern.sections[sectionIndex])) {
      spans.push(...branchSpans(context, branch));
    }
  }
  return spans;
}

export function buildServiceSpanDependencies(services: Service[]): ServiceSpanDependency[] {
  const spans: ServiceSpanDependency[] = [];
  for (const service of services) {
    for (const pattern of service.patterns) spans.push(...patternSpans(service.id, pattern));
  }
  return spans;
}
