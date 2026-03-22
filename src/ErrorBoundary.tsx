import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: "",
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Renderer crash captured by ErrorBoundary", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-shell">
          <section className="empty-state" data-testid="renderer-error">
            <div className="empty-state__panel">
              <span className="empty-state__eyebrow">Renderer error</span>
              <h2>The editor hit an unexpected error.</h2>
              <p>
                The window stayed open so the failure can be diagnosed instead of
                disappearing silently.
              </p>
              <pre className="preview-panel">{this.state.errorMessage}</pre>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
