# Timelining transcribe service

Dockerised Railway service for YouTube and Telegram voice transcription (yt-dlp + OpenAI Whisper).

Railway builds from this directory (`rootDirectory: .transcribe`). Do not merge with [`.docker/`](../.docker/) (Neo4j).

## Local build

```bash
cd .transcribe
npm install
npm run build
npm start
```

Requires env: `OPENAI_API_KEY`, `PRIVATE_API_TOKEN`, `ENACT_BASE_URL`, `TIMELINING_BASE_URL`, `ENACT_PRIVATE_API_TOKEN`, `TIMELINING_PRIVATE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`.

## Railway

Create a second service in the timelining repo with `rootDirectory: .transcribe`. Set the env vars above and expose the generated public URL as `TRANSCRIBE_SERVICE_URL` on enact and timelining Vercel projects.
