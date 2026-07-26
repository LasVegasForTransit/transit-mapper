import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  /** What this boundary is protecting, named for the message the user reads
   *  — "dialog" produces "This dialog couldn't be opened." Keep it a noun a
   *  non-technical person would use for the thing that just failed. */
  label: string;
  /** Rendered when nothing has gone wrong, which is almost always. */
  children: ReactNode;
  /** Called on the way down, so a caller can close the surface that broke
   *  rather than leaving a dead panel on screen. */
  onError?: () => void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * The only thing in the app that can stop a render error from becoming a blank
 * page — and the app is a document editor, so a blank page means the user's
 * unsaved work is gone with no way to get it back.
 *
 * The concrete failure this exists for is not exotic. Every dialog is a
 * `lazy()` chunk with a content-hashed filename. Deploy, and a tab that was
 * already open is holding a URL that no longer exists; the next dialog the
 * user opens fetches a 404, the import promise rejects, and without a boundary
 * above the `Suspense` that rejection unmounts the entire tree. A person who
 * left the editor open over lunch loses everything by clicking "Export".
 *
 * Still a class component because React has never shipped a hook equivalent —
 * `componentDidCatch` and `getDerivedStateFromError` have no function-component
 * counterpart, and this is the documented way to write one.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error reporting service exists yet, so the console is the only record
    // there is. Logged rather than swallowed: a boundary that hides the stack
    // trades one silent failure for another.
    console.error(`${this.props.label} failed to render:`, error, info.componentStack);
    this.props.onError?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Deliberately does not promise the work is saved. This component cannot
    // know that — a save may have failed, or the last 400ms of edits may
    // never have been written — and a change set about not lying to people
    // regarding durability is the wrong place to start guessing.
    return (
      <div className="app-banner" role="alert">
        This {this.props.label} couldn’t be opened. Reloading the page usually fixes it; your last saved system is still in this browser.
      </div>
    );
  }
}
