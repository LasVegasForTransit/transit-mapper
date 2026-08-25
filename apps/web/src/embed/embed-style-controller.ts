import {
  createBaseStyleController,
  type BaseStyleController,
  type BaseStyleControllerOptions,
} from '@transitmapper/map';

export type EmbedStyleControllerOptions<ThemeId extends string> = Omit<
  BaseStyleControllerOptions<ThemeId>,
  'initialStyle'
>;

/** An embed starts after its remote style has loaded, so a failed theme change
 * must retain that usable map instead of selecting the editor's transparent
 * bootstrap style. */
export function createEmbedStyleController<ThemeId extends string>(
  options: EmbedStyleControllerOptions<ThemeId>,
): BaseStyleController<ThemeId> {
  return createBaseStyleController({ ...options, initialStyle: 'remote' });
}
