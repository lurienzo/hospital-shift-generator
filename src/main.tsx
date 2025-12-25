import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppV2 } from './v2/App'
import './index.css'

// Simple hash-based routing for v1 vs v2
function Router() {
  const isV2 = window.location.hash === '#/v2' || window.location.pathname.includes('/v2')
  
  if (isV2) {
    return <AppV2 />
  }
  
  return <App />
}

// Listen for hash changes
window.addEventListener('hashchange', () => {
  // Force re-render on hash change
  const root = document.getElementById('root')
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <Router />
      </StrictMode>,
    )
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)

