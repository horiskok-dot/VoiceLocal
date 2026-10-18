$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$python = 'test-output\asr-venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  py -3.11 -m venv test-output\asr-venv
}
& $python -m pip install 'onnx-asr[cpu,hub]==0.12.0' 'pyinstaller==6.22.3'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python asr\download.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python -m PyInstaller --noconfirm --onedir --name voice-asr --distpath runtime\asr --workpath test-output\pybuild --specpath test-output --collect-submodules onnx_asr --collect-data onnx_asr --copy-metadata onnx-asr asr\worker.py
exit $LASTEXITCODE
