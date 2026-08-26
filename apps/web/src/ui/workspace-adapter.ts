import type { WorkbenchDetent } from '@transitmapper/workspace';
import type { DocumentRepresentationId } from '@transitmapper/renderer/presentation';
import type { SupplementalContent } from './Inspector';

const REPRESENTATION_LABEL: Record<DocumentRepresentationId, string> = {
  network: 'Network',
  infrastructure: 'Infrastructure',
  diagram: 'Diagram',
};

export function representationLabel(representation: DocumentRepresentationId): string {
  return REPRESENTATION_LABEL[representation];
}

export function supplementalDetent(content: SupplementalContent): WorkbenchDetent | null {
  if (content.kind === 'selection') return 'half';
  if (content.kind === 'tool-draft') return 'closed';
  return null;
}
