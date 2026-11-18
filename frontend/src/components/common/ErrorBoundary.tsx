import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** "page" keeps the surrounding shell alive; "app" is the last line of defence. */
  scope?: "page" | "app";
}

interface State {
  error: Error | null;
}

/**
 * One malformed API response or render bug used to blank the whole app (black screen,
 * no way out). Now the failure stays inside the page and the user can retry or leave.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const page = this.props.scope !== "app";
    return (
      <div className={page ? "py-16" : "grid min-h-screen place-items-center bg-charcoal px-4"}>
        <div className="mx-auto max-w-[420px]">
          <h1 className="text-[18px] font-semibold text-warm">Halaman ini gagal dimuat</h1>
          <p className="mt-2 text-[13.5px] leading-6 text-ash">
            Ada data yang tidak terbaca. Coba muat ulang; kalau tetap gagal, kirim pesan di bawah ke admin.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-panel p-3 font-mono text-[12px] leading-5 text-ash">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="h-11 rounded-lg bg-flame px-4 text-[13.5px] font-medium text-[#1a1305] hover:bg-[#f09a52] sm:h-10"
            >
              Coba lagi
            </button>
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-lg border border-white/12 px-4 text-[13.5px] text-warm hover:bg-white/[0.06] sm:h-10"
            >
              Ke beranda
            </a>
          </div>
        </div>
      </div>
    );
  }
}
