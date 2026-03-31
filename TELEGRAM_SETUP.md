# Notificações Telegram para novas reservas

Este projeto usa uma Cloud Function (`notifyTelegramOnReservation`) que dispara quando um documento é criado em `reservas/{reservationId}`.

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
```

Depois faz deploy:

```bash
firebase deploy --only functions
```

## 5) Teste rapido

1. Cria uma reserva nova no sistema (colecao `reservas`).
2. Verifica se a mensagem chega no Telegram.
3. Se nao chegar, valida logs:

```bash
firebase functions:log --only notifyTelegramOnReservation
```

## Notas

- A function envia apenas reservas novas com status `Pendente`.
- Token do bot nunca deve ir para o front-end.
