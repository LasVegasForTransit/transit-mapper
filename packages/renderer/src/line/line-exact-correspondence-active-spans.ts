import type { LineSpan } from './line-span-types';

export interface RankedLineSpan {
  readonly span: LineSpan;
  readonly lineRank: number;
}

/** The sweep retains active spans so each carrier interval uses its full member set. */
export interface ActiveSpanNode {
  item: RankedLineSpan;
  items: RankedLineSpan[];
  left: ActiveSpanNode | undefined;
  right: ActiveSpanNode | undefined;
  height: number;
}

const textEncoder = new TextEncoder();

function compareText(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function compareRankedLineSpans(left: RankedLineSpan, right: RankedLineSpan): number {
  const rankDifference = left.lineRank - right.lineRank;
  return rankDifference !== 0 ? rankDifference : compareText(left.span.id, right.span.id);
}

function nodeHeight(node: ActiveSpanNode | undefined): number {
  return node?.height ?? 0;
}

function updateHeight(node: ActiveSpanNode): ActiveSpanNode {
  node.height = Math.max(nodeHeight(node.left), nodeHeight(node.right)) + 1;
  return node;
}

function rotateLeft(node: ActiveSpanNode): ActiveSpanNode {
  const pivot = node.right;
  if (pivot === undefined)
    throw new Error('Active Line span tree cannot rotate without a right child.');
  node.right = pivot.left;
  pivot.left = updateHeight(node);
  return updateHeight(pivot);
}

function rotateRight(node: ActiveSpanNode): ActiveSpanNode {
  const pivot = node.left;
  if (pivot === undefined)
    throw new Error('Active Line span tree cannot rotate without a left child.');
  node.left = pivot.right;
  pivot.right = updateHeight(node);
  return updateHeight(pivot);
}

function balanceActiveSpanNode(node: ActiveSpanNode): ActiveSpanNode {
  updateHeight(node);
  const balance = nodeHeight(node.left) - nodeHeight(node.right);
  if (balance > 1) {
    if (node.left !== undefined && nodeHeight(node.left.left) < nodeHeight(node.left.right))
      node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (balance < -1) {
    if (node.right !== undefined && nodeHeight(node.right.right) < nodeHeight(node.right.left))
      node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}

export function insertActiveSpan(
  node: ActiveSpanNode | undefined,
  item: RankedLineSpan,
): ActiveSpanNode {
  if (node === undefined)
    return { item, items: [item], left: undefined, right: undefined, height: 1 };
  const comparison = compareRankedLineSpans(item, node.item);
  if (comparison === 0) {
    node.items.push(item);
    return node;
  }
  if (comparison < 0) node.left = insertActiveSpan(node.left, item);
  else node.right = insertActiveSpan(node.right, item);
  return balanceActiveSpanNode(node);
}

function firstActiveSpanNode(node: ActiveSpanNode): ActiveSpanNode {
  let current = node;
  while (current.left !== undefined) current = current.left;
  return current;
}

function removeActiveSpanNode(node: ActiveSpanNode): ActiveSpanNode | undefined {
  if (node.left === undefined) return node.right;
  if (node.right === undefined) return node.left;
  const successor = firstActiveSpanNode(node.right);
  node.item = successor.item;
  node.items = successor.items;
  node.right = removeActiveSpanKey(node.right, successor.item);
  return balanceActiveSpanNode(node);
}

function removeActiveSpanKey(
  node: ActiveSpanNode | undefined,
  item: RankedLineSpan,
): ActiveSpanNode | undefined {
  if (node === undefined) throw new Error('Active Line span tree lost a span key.');
  const comparison = compareRankedLineSpans(item, node.item);
  if (comparison === 0) return removeActiveSpanNode(node);
  if (comparison < 0) node.left = removeActiveSpanKey(node.left, item);
  else node.right = removeActiveSpanKey(node.right, item);
  return balanceActiveSpanNode(node);
}

export function removeActiveSpan(
  node: ActiveSpanNode | undefined,
  item: RankedLineSpan,
): ActiveSpanNode | undefined {
  if (node === undefined) throw new Error('Active Line span tree lost a span.');
  const comparison = compareRankedLineSpans(item, node.item);
  if (comparison === 0) {
    const itemIndex = node.items.indexOf(item);
    if (itemIndex < 0) throw new Error('Active Line span tree lost a duplicate span.');
    node.items.splice(itemIndex, 1);
    return node.items.length === 0 ? removeActiveSpanNode(node) : node;
  }
  if (comparison < 0) node.left = removeActiveSpan(node.left, item);
  else node.right = removeActiveSpan(node.right, item);
  return balanceActiveSpanNode(node);
}

export function collectActiveSpans(
  node: ActiveSpanNode | undefined,
  spans: RankedLineSpan[],
): void {
  if (node === undefined) return;
  collectActiveSpans(node.left, spans);
  spans.push(...node.items);
  collectActiveSpans(node.right, spans);
}
