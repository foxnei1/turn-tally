import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ConfiguredApp from './app/ConfiguredApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfiguredApp />
  </StrictMode>,
)
