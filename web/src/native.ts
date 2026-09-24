import { App } from '@capacitor/app'

// Botão "voltar" do Android: volta uma tela ou fecha o app na tela inicial.
App.addListener('backButton', ({ canGoBack }) => {
  if (canGoBack) window.history.back()
  else App.exitApp()
})
