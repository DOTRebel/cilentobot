# Cilento News Bot

Bot Telegram per il fetch di notizie dai siti cilentani.

## Installazione

```bash
npm install
```

## Configurazione

1. Crea il bot su Telegram con @BotFather e prendi il token
2. Imposta il token:
   ```bash
   node bot.js --set-token <TOKEN>
   ```
3. Avvia il bot e invia il comando `/configura` per registrare la tua chat

## Comandi

- `/start` - Avvia il bot
- `/notizie` - Ricevi le ultime notizie subito
- `/configura` - Registra la tua chat per ricevere notizie periodiche

## Esecuzione

```bash
npm start
```

Il bot controlla le notizie ogni 15 minuti e invia le novità automaticamente.