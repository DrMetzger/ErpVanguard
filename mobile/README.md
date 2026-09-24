# ERP Vanguard – App Android

App Android feito com [Capacitor](https://capacitorjs.com): empacota o mesmo ERP web (`../web`)
e conversa com a API em `https://app.erpvanguard.com.br`.

- **ID do app:** `br.com.erpvanguard.app`
- **Build:** automático no GitHub Actions (workflow *Android*) a cada mudança em `web/` ou `mobile/`.
  - `erp-vanguard-<versão>-teste-apk`: APK para instalar direto no celular e testar.
  - `erp-vanguard-<versão>-playstore-aab`: pacote assinado para a Play Store (só quando os secrets
    da chave de upload estão configurados).

## Secrets para publicar na Play Store

| Secret | Conteúdo |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | a chave de upload (`upload.jks`) em base64 |
| `ANDROID_KEYSTORE_PASSWORD` | senha do keystore |
| `ANDROID_KEY_ALIAS` | alias da chave (ex.: `upload`) |
| `ANDROID_KEY_PASSWORD` | senha da chave |

## Rodando localmente (precisa do Android Studio)

```bash
npm install --prefix ../web && npm install
npm run sync     # compila o web apontando para o servidor e copia para o projeto Android
npm run open     # abre no Android Studio
```

Ícones e splash foram gerados a partir de `assets/` com
`npx @capacitor/assets generate --android`.
