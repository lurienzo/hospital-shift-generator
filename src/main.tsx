import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { ServiceProvider } from './state/ServiceProvider';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root non trovato');

createRoot(container).render(
  <StrictMode>
    <ServiceProvider>
      <Root />
    </ServiceProvider>
  </StrictMode>,
);
