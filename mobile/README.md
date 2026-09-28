# ERP Vanguard – App Android

App Android feito com [Capacitor](https://capacitorjs.com): empacota o mesmo ERP web (`../web`)
e conversa com a API em `https://app.erpvanguard.com.br`.

- **Download do APK de teste:** https://app.erpvanguard.com.br/download/ (publicado pelo workflow *Android* a cada mudança em `web/` ou `mobile/`; assinado com a chave fixa de teste `android/app/vanguard-teste.keystore`, para a versão nova instalar por cima).
- **Recursos do celular:** localização (com aceite do usuário; o admin vê em Administração › Dispositivos), avisos do sistema como notificação do Android, uso sem internet (telas já abertas ficam guardadas; gravações entram numa fila e são enviadas sozinhas quando a conexão volta, com `Idempotency-Key` para não gravar duas vezes) e aviso de versão nova.
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
