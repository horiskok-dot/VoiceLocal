"""Local GigaAM speech recognition over a newline-delimited JSON pipe."""

import json
import sys

import onnx_asr


def send(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    model = onnx_asr.load_model("gigaam-v3-rnnt", path=sys.argv[1], quantization="int8")
    send({"ready": True})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            send({"id": request["id"], "text": model.recognize(request["path"])})
        except Exception as exc:
            send({"id": request.get("id") if "request" in locals() else None, "error": str(exc)})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        send({"ready": False, "error": str(exc)})
        sys.exit(1)
