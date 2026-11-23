import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import './styles/base.css';
import './styles/buildings.css';
import { AppProvider } from './state/store';
import { AppShell } from './features/shell/AppShell';

class FatalErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[night-map] fatal', error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="fatal">
          <div>
            <p className="eyebrow">Night Map</p>
            <h1>The instrument failed to start</h1>
            <p>{this.state.message}</p>
            <p className="muted">
              The bundled dataset is validated on load. If this is a data error, rebuild with <code>npm run data:build</code>.
            </p>
            <button type="button" className="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FatalErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </FatalErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[night-map] service worker registration failed', err);
    });
  });
}
