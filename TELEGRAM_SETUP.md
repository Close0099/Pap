# Notificações Telegram para novas reservas

Este projeto usa uma Cloud Function (`notifyTelegramOnReservation`) que dispara quando um documento é criado em `reservas/{reservationId}`.
Tambem pode usar comandos no Telegram via webhook (`telegramCommandWebhook`) para consultar dados de gestao.

## 1) Criar bot no Telegram

1. No Telegram, abre `@BotFather`.
2. Envia `/newbot` e segue os passos.
3. Guarda o token gerado (formato parecido com `123456:ABC...`).

## 2) Obter chat ID

Opcao A (chat privado):
1. Envia uma mensagem para o bot.
2. Abre no browser:
   `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
3. Procura `chat.id` no JSON.

Opcao B (grupo):
1. Adiciona o bot ao grupo.
2. Envia uma mensagem no grupo.
3. Usa o mesmo `getUpdates` e copia o `chat.id` (normalmente negativo).

## 3) Instalar dependencias das Functions

Na pasta do projeto:

```bash
cd functions
npm install
```

## 4) Definir segredos no Firebase

```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set TELEGRAM_CHAT_ID
firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET
```

Depois faz deploy:

```bash
firebase deploy --only functions
```

## 5) Ativar webhook de comandos

Depois do deploy das functions, configura o webhook no bot:

```bash
curl "https://api.telegram.org/bot<SEU_TOKEN>/setWebhook?url=https://europe-west1-pap-padel-v2.cloudfunctions.net/telegramCommandWebhook?key=<TELEGRAM_WEBHOOK_SECRET>"
```

Teste no chat autorizado (o mesmo `TELEGRAM_CHAT_ID`):

- `/help`
- `/stats`
- `/hoje`
- `/dia 2026-04-15`
- `/utilizadores`

## 6) Teste rapido

1. Cria uma reserva nova no sistema (colecao `reservas`).
2. Verifica se a mensagem chega no Telegram.
3. Se nao chegar, valida logs:

```bash
firebase functions:log --only notifyTelegramOnReservation
```

## Notas

- A function envia mensagem quando uma nova reserva e criada.
- Token do bot nunca deve ir para o front-end.

## Opcao sem upgrade (envio automatico 09:00 e 13:00)

Se nao queres Blaze, usa GitHub Actions (ja preparado no projeto):

- Workflow: `.github/workflows/telegram-daily-report.yml`
- Script: `automation/telegram-reports/send-daily-report.mjs`

### Secrets que precisas no GitHub

No repositorio > Settings > Secrets and variables > Actions, cria:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### O que ele faz

- Corre de hora em hora.
- So envia nas horas `9` e `13` (fuso `Europe/Lisbon`).
- Evita duplicados com lock em `jobLocks/telegram-report-YYYY-MM-DD-HH` no Firestore.

### Ativacao

1. Fazer commit/push dos ficheiros novos para o GitHub.
2. Confirmar que Actions estao ativadas no repositorio.
3. Executar manualmente uma vez (`Run workflow`) para teste.
4. Verificar no Telegram e no separador Actions os logs.
