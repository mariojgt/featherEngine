import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from './Player';

const container = document.getElementById('game-root');
if (!container) throw new Error('Missing #game-root element');

createRoot(container).render(
  <StrictMode>
    <Player />
  </StrictMode>,
);
