# Local Audio Setup

OwnPilot can run speech-to-text and text-to-speech without paid APIs.

## Components

- **STT:** `whisper.cpp` running an OpenAI-compatible server.
- **TTS:** `piper` CLI with a local `.onnx` voice model.

## Config Center

Create or update `audio_service`:

```text
provider_type = local
base_url = http://127.0.0.1:2022
local_tts_command = piper
local_tts_model = D:\models\piper\tr_TR-voice.onnx
```

`api_key` is not required for local mode.

## Run Local STT

Run `whisper.cpp` in OpenAI-compatible server mode and point `base_url` at it.
The server must expose:

```text
POST /v1/audio/transcriptions
```

## Run Local TTS

Install Piper and download a voice model. OwnPilot calls:

```bash
piper --model <local_tts_model> --output_file <temp.wav>
```

Piper output is WAV. Telegram voice replies try to convert WAV to OGG/Opus with
`ffmpeg` so they can be sent as native voice notes. If `ffmpeg` is unavailable,
OwnPilot falls back to sending the generated audio file.

## Telegram

For voice input only, set `audio_service.provider_type = local`.

For voice replies, also set Telegram config:

```text
voice_reply_mode = voice_messages
```

Use `always` only if every assistant response should be synthesized.

## Diagnostics

After saving Config Center settings, check readiness:

```text
GET /api/v1/voice/diagnostics
```

For local mode this verifies:

- `base_url` responds for the local Whisper server.
- `local_tts_model` points to an existing Piper `.onnx` file.
- `local_tts_command` can be executed.
- `ffmpeg` is available for Telegram native voice replies.

`ffmpeg` is optional. If it is missing, Telegram TTS replies still work as audio
file attachments instead of native voice notes.
