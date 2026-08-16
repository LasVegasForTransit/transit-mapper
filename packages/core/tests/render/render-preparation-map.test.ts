import { describe, expect, it } from 'vitest';
import {
  initialRenderPreparationMap,
  RenderPreparationMutableMap,
  RenderPreparationMutableSet,
  updateRenderPreparationMap,
} from '../../src/render/render-preparation-map';

describe('renderer preparation map layers', () => {
  it('preserves insertion order and lookup semantics across bounded mutable shards', () => {
    const values = new RenderPreparationMutableMap<string, number | undefined>(1);
    values.set('first', 1).set('second', 2).set('empty', undefined).set('second', 3);

    expect(values.size).toBe(3);
    expect(values.get('second')).toBe(3);
    expect(values.get('empty')).toBeUndefined();
    expect(values.has('empty')).toBe(true);
    expect(values.has('missing')).toBe(false);
    expect([...values.keys()]).toEqual(['first', 'second', 'empty']);
    expect([...values.values()]).toEqual([1, 3, undefined]);
    expect([...values.entries()]).toEqual([
      ['first', 1],
      ['second', 3],
      ['empty', undefined],
    ]);

    const visited: string[] = [];
    values.forEach((value, key, map) => visited.push(`${key}:${String(value)}:${map.size}`));
    expect(visited).toEqual(['first:1:3', 'second:3:3', 'empty:undefined:3']);
  });

  it('applies removals and replacements without cloning a retained base', () => {
    const base = new Map([
      ['remove', 1],
      ['replace', 2],
    ]);
    expect(initialRenderPreparationMap(base)).toBe(base);
    const layered = updateRenderPreparationMap(
      base,
      new Map([
        ['replace', 3],
        ['add', 4],
      ]),
      new Set(['remove']),
    );

    expect(layered.size).toBe(2);
    expect(layered.get('remove')).toBeUndefined();
    expect(layered.get('replace')).toBe(3);
    expect(layered.has('add')).toBe(true);
    expect([...layered]).toEqual([
      ['replace', 3],
      ['add', 4],
    ]);
    expect([...layered.keys()]).toEqual(['replace', 'add']);
    expect([...layered.values()]).toEqual([3, 4]);

    const visited: string[] = [];
    layered.forEach((value, key, map) => visited.push(`${key}:${value}:${map.size}`));
    expect(visited).toEqual(['replace:3:2', 'add:4:2']);
    const cold = new Map([['cold', 1]]);
    expect(updateRenderPreparationMap(new Map(), cold, new Set())).toBe(cold);
  });

  it('implements readonly set algebra over sharded candidate identities', () => {
    const values = new RenderPreparationMutableSet<string>();
    values.add('a').add('b').add('b');

    expect(values.size).toBe(2);
    expect(values.has('a')).toBe(true);
    expect([...values]).toEqual(['a', 'b']);
    expect([...values.entries()]).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
    expect([...values.keys()]).toEqual(['a', 'b']);
    expect([...values.values()]).toEqual(['a', 'b']);
    expect(values.union(new Set(['b', 'c']))).toEqual(new Set(['a', 'b', 'c']));
    expect(values.intersection(new Set(['b', 'c']))).toEqual(new Set(['b']));
    expect(values.difference(new Set(['b', 'c']))).toEqual(new Set(['a']));
    expect(values.symmetricDifference(new Set(['b', 'c']))).toEqual(new Set(['a', 'c']));
    expect(values.isSubsetOf(new Set(['a', 'b', 'c']))).toBe(true);
    expect(values.isSubsetOf(new Set(['a']))).toBe(false);
    expect(values.isSupersetOf(new Set(['a']))).toBe(true);
    expect(values.isSupersetOf(new Set(['c']))).toBe(false);
    expect(values.isDisjointFrom(new Set(['c']))).toBe(true);
    expect(values.isDisjointFrom(new Set(['b']))).toBe(false);

    const visited: string[] = [];
    values.forEach((value, duplicate, set) => visited.push(`${value}:${duplicate}:${set.size}`));
    expect(visited).toEqual(['a:a:2', 'b:b:2']);
  });
});
