import type { VisibleSourcePiece } from './line-visible-sources';

export interface VisibleFragmentPartition {
  readonly canonicalCarrierRange: readonly [number, number];
  readonly piece: VisibleSourcePiece;
}

interface SourceEvent {
  readonly position: number;
  readonly action: 'add' | 'remove';
  readonly pieceIndex: number;
}

const textEncoder = new TextEncoder();

function compareIds(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function comparePieces(left: VisibleSourcePiece, right: VisibleSourcePiece): number {
  const contributorDifference = left.contributorIndex - right.contributorIndex;
  return contributorDifference === 0
    ? compareIds(left.sourceShardId, right.sourceShardId)
    : contributorDifference;
}

function requiredPiece(pieces: readonly VisibleSourcePiece[], index: number): VisibleSourcePiece {
  const piece = pieces.at(index);
  if (piece === undefined) throw new Error('Visible source sweep lost a piece.');
  return piece;
}

class ActiveSourcePieces {
  readonly #active = new Set<number>();
  readonly #heap: number[] = [];

  constructor(private readonly pieces: readonly VisibleSourcePiece[]) {}

  add(pieceIndex: number): void {
    this.#active.add(pieceIndex);
    this.#heap.push(pieceIndex);
    this.siftUp(this.#heap.length - 1);
  }

  remove(pieceIndex: number): void {
    this.#active.delete(pieceIndex);
  }

  first(): VisibleSourcePiece | undefined {
    for (;;) {
      const pieceIndex = this.#heap.at(0);
      if (pieceIndex === undefined) return undefined;
      if (this.#active.has(pieceIndex)) return requiredPiece(this.pieces, pieceIndex);
      this.removeFirst();
    }
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compareIndexes(this.#heap[index], this.#heap[parent]) >= 0) return;
      [this.#heap[index], this.#heap[parent]] = [this.#heap[parent], this.#heap[index]];
      index = parent;
    }
  }

  private removeFirst(): void {
    const first = this.#heap.at(0);
    const last = this.#heap.pop();
    if (first === undefined || last === undefined || this.#heap.length === 0) return;
    this.#heap[0] = last;
    this.siftDown(0);
  }

  private siftDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      const current = this.#heap.at(index);
      const childIndex = this.smallerChildIndex(left, right);
      if (
        current === undefined ||
        childIndex === undefined ||
        this.compareIndexes(current, this.#heap[childIndex]) <= 0
      ) {
        return;
      }
      [this.#heap[index], this.#heap[childIndex]] = [this.#heap[childIndex], this.#heap[index]];
      index = childIndex;
    }
  }

  private smallerChildIndex(left: number, right: number): number | undefined {
    const leftPieceIndex = this.#heap.at(left);
    const rightPieceIndex = this.#heap.at(right);
    if (leftPieceIndex === undefined) return undefined;
    if (rightPieceIndex === undefined) return left;
    return this.compareIndexes(leftPieceIndex, rightPieceIndex) <= 0 ? left : right;
  }

  private compareIndexes(left: number, right: number): number {
    return comparePieces(requiredPiece(this.pieces, left), requiredPiece(this.pieces, right));
  }
}

function sourceEvents(pieces: readonly VisibleSourcePiece[]): readonly SourceEvent[] {
  return pieces
    .flatMap((piece, pieceIndex) => [
      { position: piece.canonicalCarrierRange[0], action: 'add' as const, pieceIndex },
      { position: piece.canonicalCarrierRange[1], action: 'remove' as const, pieceIndex },
    ])
    .sort((left, right) => left.position - right.position);
}

function applyEvents(
  events: readonly SourceEvent[],
  offset: number,
  active: ActiveSourcePieces,
): { readonly position: number; readonly nextOffset: number } {
  const position = events[offset].position;
  let nextOffset = offset;
  while (nextOffset < events.length && events[nextOffset].position === position) {
    const event = events[nextOffset];
    if (event.action === 'add') active.add(event.pieceIndex);
    else active.remove(event.pieceIndex);
    nextOffset += 1;
  }
  return { position, nextOffset };
}

function appendPartition(
  partitions: VisibleFragmentPartition[],
  range: readonly [number, number],
  piece: VisibleSourcePiece,
): void {
  const previous = partitions.at(-1);
  if (previous?.piece === piece && previous.canonicalCarrierRange[1] === range[0]) {
    partitions[partitions.length - 1] = {
      canonicalCarrierRange: [previous.canonicalCarrierRange[0], range[1]],
      piece,
    };
  } else {
    partitions.push({ canonicalCarrierRange: range, piece });
  }
}

export function partitionVisibleSourcePieces(
  pieces: readonly VisibleSourcePiece[],
): readonly VisibleFragmentPartition[] {
  const events = sourceEvents(pieces);
  const partitions: VisibleFragmentPartition[] = [];
  const active = new ActiveSourcePieces(pieces);
  let offset = 0;
  while (offset < events.length) {
    const applied = applyEvents(events, offset, active);
    offset = applied.nextOffset;
    const next = events.at(offset);
    const selected = active.first();
    if (next !== undefined && selected !== undefined && applied.position < next.position) {
      appendPartition(partitions, [applied.position, next.position], selected);
    }
  }
  return partitions;
}
