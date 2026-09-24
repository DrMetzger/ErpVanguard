import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'
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

if (Capacitor.isNativePlatform()) import('./native')

const colorSchemeManager = localStorageColorSchemeManager({ key: 'vanguard.color-scheme' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" limit={3} autoClose={2500} />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
)
