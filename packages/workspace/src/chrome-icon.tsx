import type { CSSProperties } from 'react';

type ChromeIconName = 'chevronDown' | 'sidebar' | 'panelOpen';

interface ChromeIconProps {
  name: ChromeIconName;
  size?: number;
  style?: CSSProperties;
}

export function ChromeIcon({ name, size = 18, style }: ChromeIconProps) {
  const paths = {
    chevronDown: <path d="m6 9 6 6 6-6" />,
    sidebar: (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18m7-6-3-3 3-3" />
      </>
    ),
    panelOpen: (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18m5-9h4m-2-2 2 2-2 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
