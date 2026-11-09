import { createRoot } from 'react-dom/client';
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/700.css';
import './styles.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// Cache the app for offline use and update silently when a new version is deployed.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
