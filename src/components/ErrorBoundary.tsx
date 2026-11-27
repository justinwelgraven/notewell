import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** "app": the whole window; "note": just the open note (the rest of the app keeps working). */
  scope: "app" | "note";
  /** Changing this (e.g. opening another note) clears the error. */
  resetKey?: string;
}
interface State {
  error: Error | null;
  copied: boolean;
}

/**
 * Safety net: if part of the screen hits an unexpected error, show a short message with a way out
 * instead of a blank window. Notes are saved continuously, so nothing is lost by reloading.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`Notewell (${this.props.scope}) error:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, copied: false });
  }

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    const note = this.props.scope === "note";
    const details = `${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 6).join("\n")}`;
    return (
      <div className={`crash${note ? " crash-note" : ""}`} role="alert">
        <div className="crash-box">
          <h2>{note ? "This note couldn't be shown" : "Something went wrong"}</h2>
          <p>
            Your notes are safe: they're saved continuously{note ? "." : ", on this device and in Dropbox."}
            {note ? " Try again, or open another note." : " Reloading Notewell usually fixes this."}
          </p>
          <div className="crash-actions">
            {note && (
              <button className="btn btn-secondary" onClick={() => this.setState({ error: null, copied: false })}>
                Try again
              </button>
            )}
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Reload Notewell
            </button>
          </div>
          <button
            className="crash-copy"
            onClick={() => {
              void navigator.clipboard?.writeText(details).then(() => this.setState({ copied: true }));
            }}
          >
            {copied ? "Details copied" : "Copy error details (to send to Claude)"}
          </button>
        </div>
      </div>
    );
  }
}
