import { createRoot } from 'react-dom/client'
import SiteDemo from './SiteDemo'

const root = document.getElementById('compass-live-root')
if (root) createRoot(root).render(<SiteDemo />)
