"""Fetch only the files needed for the bundled quantized Russian ASR model."""

import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "runtime" / "asr" / "model"
OUT.mkdir(parents=True, exist_ok=True)
REPO = "istupakov/gigaam-v3-onnx"
REVISION = "322c3b29492673eb7d0b434bfa9dfb8653e34d02"
FILES = (
    "config.json",
    "v3_rnnt_encoder.int8.onnx",
    "v3_rnnt_decoder.int8.onnx",
    "v3_rnnt_joint.int8.onnx",
    "v3_vocab.txt",
    "LICENSE.txt",
)

for name in FILES:
    source = hf_hub_download(REPO, name, revision=REVISION)
    shutil.copyfile(source, OUT / name)
    print(f"Installed {name}")
