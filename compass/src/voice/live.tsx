import { createRoot } from 'react-dom/client'
import CompassDemo from '../components/CompassDemo'

const root = document.getElementById('compass-live-root')
if (root) createRoot(root).render(<CompassDemo />)
