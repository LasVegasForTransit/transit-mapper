import { useState } from 'react';

import { nextCount } from './lib/counter';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans text-gray-900">
      <h1 className="text-3xl font-bold">LVBT app</h1>
      <p className="mt-4">
        A Vite and React app on Cloudflare Workers, following the LVBT repository standard. Replace
        this page.
      </p>
      <button
        type="button"
        className="mt-4 rounded border px-3 py-1"
        onClick={() => {
          setCount(nextCount(count));
        }}
      >
        Clicked {count} times
      </button>
    </main>
  );
}
