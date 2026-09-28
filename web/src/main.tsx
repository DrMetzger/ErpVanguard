import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'
import '@mantine/charts/styles.css'
import './global.css'

import { Capacitor } from '@capacitor/core'
import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { theme } from './theme'
import { reloadForNewVersion, ScreenGuard } from './components/ScreenGuard'

if (Capacitor.isNativePlatform()) import('./native')

// Arquivo de tela da versão antiga sumiu (acabou de publicar): recarrega sozinho em vez de tela preta.
window.addEventListener('vite:preloadError', (event) => { if (reloadForNewVersion()) event.preventDefault() })

const colorSchemeManager = localStorageColorSchemeManager({ key: 'vanguard.color-scheme' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" limit={3} autoClose={2500} />
      <BrowserRouter>
        <AuthProvider>
          <ScreenGuard>
            <App />
          </ScreenGuard>
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
)
