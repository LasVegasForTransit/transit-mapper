import { Icon } from './Icon';
import type { AppBannerActionKind, AppBannerDescriptor } from './app-banner';

export interface AppBannerProps {
  banner: AppBannerDescriptor;
  /** Runs the action a descriptor names. The descriptor stays a plain value —
   *  it carries what the button says and what it means, never a closure — so
   *  `resolveAppBanner` can be exercised without a component tree. */
  onAction: (kind: AppBannerActionKind) => void;
}

const layoutClass: Record<AppBannerDescriptor['layout'], string> = {
  plain: '',
  inline: ' app-banner-action',
  wrapped: ' app-banner-dismissible',
};

export function AppBanner({ banner, onAction }: AppBannerProps) {
  const tone = banner.tone === 'update' ? ' app-banner-update' : '';
  // Bound outside the JSX so the closure below captures a value TypeScript has
  // already narrowed; reading `banner.dismiss` inside the handler would not be.
  const { dismiss } = banner;
  return (
    <div
      className={`app-banner${tone}${layoutClass[banner.layout]}`}
      role={banner.live === 'alert' ? 'alert' : 'status'}
    >
      {/* Wrapped in a span even when it stands alone: the flex layouts want
          the message to be one child beside its control, and the plain layout
          is unaffected by the extra element. */}
      <span>{banner.message}</span>
      {banner.actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          className="ghost-btn"
          onClick={() => onAction(action.kind)}
        >
          {action.label}
        </button>
      ))}
      {dismiss && (
        <button
          type="button"
          className="app-banner-dismiss"
          onClick={() => onAction(dismiss.kind)}
          aria-label={dismiss.label}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
