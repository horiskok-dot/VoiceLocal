# Third-party components

Voice Local uses these third-party components. Copyright and license notices are retained in the runtime/licenses directory, installed npm packages and the Electron distribution.

|Component|Source|License information|
|---|---|---|
|Electron / Chromium|https://www.electronjs.org/|MIT / multiple third-party licenses (bundled LICENSE and LICENSES.chromium.html)|
|React / React DOM|https://github.com/facebook/react|MIT|
|Lucide|https://github.com/lucide-icons/lucide|ISC|
|MCP SDK|https://github.com/modelcontextprotocol/typescript-sdk|MIT|
|Mammoth|https://github.com/mwilliamson/mammoth.js|BSD-2-Clause (license retained in installed package)|
|pdf-parse / PDF.js|https://github.com/mehmet-kozan/pdf-parse / https://github.com/mozilla/pdf.js|MIT / Apache-2.0 (notices retained in installed packages)|
|EmbeddingGemma 2 Q8_0 GGUF (text encoder)|https://huggingface.co/ggml-org/embeddinggemma-2-GGUF|Apache-2.0 per model card; source model https://huggingface.co/google/embeddinggemma-2|
|.NET / System.Speech|https://github.com/dotnet/runtime|MIT|
|NAudio|https://github.com/naudio/NAudio|MIT; copyright 2020 Mark Heath|
|whisper.cpp|https://github.com/ggml-org/whisper.cpp|MIT|
|Whisper model|https://huggingface.co/ggerganov/whisper.cpp|Model card / OpenAI Whisper MIT|
|GigaAM v3 RNNT INT8 (Russian speech recognition)|https://huggingface.co/istupakov/gigaam-v3-onnx|MIT; license retained in runtime/asr/model/LICENSE.txt|
|onnx-asr|https://github.com/istupakov/onnx-asr|MIT|
|ONNX Runtime|https://github.com/microsoft/onnxruntime|MIT|
|NumPy|https://github.com/numpy/numpy|BSD-3-Clause|
|PyInstaller|https://github.com/pyinstaller/pyinstaller|GPL-2.0-or-later with bootloader exception; included license in build tool|
|llama.cpp|https://github.com/ggml-org/llama.cpp|MIT|
|Qwen3.5 model and projector GGUF|https://huggingface.co/unsloth/Qwen3.5-2B-GGUF|Apache 2.0 per model card|
|Piper 2023.11.14-2|https://github.com/rhasspy/piper|MIT; included third-party components retain their licenses|
|eSpeak NG in Piper|https://github.com/espeak-ng/espeak-ng|GPL 3.0 or later; source is available at linked repository|
|Irina voice|https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU/irina/medium|Included MODEL_CARD states dataset license Unknown; no broader license clearance is asserted|

Models and binaries are downloaded from the above publishers. runtime/manifest.json records exact URLs, sizes and SHA-256 digests for this installation. Voice Local was implemented independently from observed UI patterns; it does not include the original VoiceOS application code or account credentials.
