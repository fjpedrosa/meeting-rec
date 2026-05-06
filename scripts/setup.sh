#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_ROOT/pipeline/.venv"
REQUIREMENTS_FILE="$PROJECT_ROOT/pipeline/requirements.txt"

RECREATE_VENV=0
SKIP_SYSTEM=0
SKIP_JS=0
SKIP_PYTHON=0

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [options]

Installs the local development/runtime dependencies for Meeting Rec.

Options:
  --recreate-venv   Delete and recreate pipeline/.venv before installing Python packages
  --skip-system     Skip Homebrew/system dependency installation
  --skip-js         Skip Bun JavaScript dependency installation
  --skip-python     Skip Python virtualenv dependency installation
  -h, --help        Show this help

Notes:
  - This project is macOS-focused: recording uses AVFoundation and osascript.
  - The script installs dependencies only. It does not build the desktop app.
EOF
}

log() {
  printf '\033[1;34m==> %s\033[0m\n' "$*" >&2
}

ok() {
  printf '\033[1;32m✓ %s\033[0m\n' "$*" >&2
}

warn() {
  printf '\033[1;33mWARNING: %s\033[0m\n' "$*" >&2
}

die() {
  printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recreate-venv)
      RECREATE_VENV=1
      shift
      ;;
    --skip-system)
      SKIP_SYSTEM=1
      shift
      ;;
    --skip-js)
      SKIP_JS=1
      shift
      ;;
    --skip-python)
      SKIP_PYTHON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

ensure_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "This setup script currently supports macOS only. The app depends on AVFoundation, osascript, and the Swift desktop target."
  fi
}

ensure_homebrew() {
  if ! command_exists brew; then
    die "Homebrew is required to install system dependencies. Install it from https://brew.sh and rerun this script."
  fi
}

brew_install_if_missing() {
  local command_name="$1"
  local formula="$2"

  if command_exists "$command_name"; then
    ok "$command_name is already installed"
    return
  fi

  ensure_homebrew
  log "Installing $formula with Homebrew"
  brew install "$formula"

  if ! command_exists "$command_name"; then
    die "$formula installed, but $command_name is still not available in PATH"
  fi
}

ensure_bun() {
  if command_exists bun; then
    ok "bun is already installed"
    return
  fi

  ensure_homebrew

  if brew info bun >/dev/null 2>&1; then
    log "Installing bun with Homebrew"
    brew install bun
  else
    log "Installing bun from the official Homebrew tap"
    brew install oven-sh/bun/bun
  fi

  command_exists bun || die "bun installed, but it is not available in PATH"
}

find_python_313() {
  if command_exists python3.13; then
    command -v python3.13
    return
  fi

  if command_exists brew; then
    local brew_python
    brew_python="$(brew --prefix python@3.13 2>/dev/null || true)/bin/python3.13"
    if [[ -x "$brew_python" ]]; then
      printf '%s\n' "$brew_python"
      return
    fi
  fi

  return 1
}

ensure_python_313() {
  local python_bin

  if python_bin="$(find_python_313)"; then
    ok "Python 3.13 is already installed: $python_bin"
    printf '%s\n' "$python_bin"
    return
  fi

  ensure_homebrew
  log "Installing python@3.13 with Homebrew"
  brew install python@3.13

  python_bin="$(find_python_313)" || die "python@3.13 installed, but python3.13 was not found"
  printf '%s\n' "$python_bin"
}

ensure_system_dependencies() {
  log "Checking system dependencies"
  ensure_macos

  brew_install_if_missing ffmpeg ffmpeg
  command_exists ffprobe || die "ffprobe was not found. It should be installed with ffmpeg."

  ensure_bun >/dev/null
  ensure_python_313 >/dev/null

  if command_exists swift; then
    ok "swift is available"
  else
    warn "swift is not available. Install Xcode Command Line Tools with: xcode-select --install"
  fi

  if command_exists codesign; then
    ok "codesign is available"
  else
    warn "codesign is not available. Desktop app signing will fail until Xcode Command Line Tools are installed."
  fi
}

ensure_runtime_directories() {
  log "Creating runtime directories"
  mkdir -p \
    "$PROJECT_ROOT/data/db" \
    "$PROJECT_ROOT/data/clips" \
    "$PROJECT_ROOT/data/recordings"
  ok "runtime directories are present"
}

install_js_dependencies() {
  log "Installing JavaScript dependencies with Bun"
  ensure_bun >/dev/null
  cd "$PROJECT_ROOT"
  bun install
  ok "JavaScript dependencies installed"
}

install_python_dependencies() {
  local python_bin
  python_bin="$(ensure_python_313)"

  if [[ "$RECREATE_VENV" -eq 1 && -d "$VENV_DIR" ]]; then
    log "Removing existing virtualenv: $VENV_DIR"
    rm -rf "$VENV_DIR"
  fi

  if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    log "Creating Python virtualenv at pipeline/.venv"
    "$python_bin" -m venv "$VENV_DIR"
  else
    ok "Python virtualenv already exists"
  fi

  local venv_python="$VENV_DIR/bin/python"
  local venv_version
  venv_version="$("$venv_python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

  if [[ "$venv_version" != "3.13" ]]; then
    die "pipeline/.venv uses Python $venv_version, but this project standardizes on Python 3.13. Rerun with --recreate-venv."
  fi

  log "Upgrading Python packaging tools"
  "$venv_python" -m pip install --upgrade pip setuptools wheel

  log "Installing Python requirements"
  "$venv_python" -m pip install -r "$REQUIREMENTS_FILE"

  log "Validating critical Python imports"
  "$venv_python" - <<'PY'
import certifi
import mlx_whisper
import numpy
import pyannote.audio
import scipy
import torch
import torchaudio
import whisperx

print(certifi.where())
PY

  ok "Python dependencies installed and validated"
}

print_next_steps() {
  cat <<EOF

Setup complete.

Next steps:
  1. Set HF_TOKEN if you use diarization:
       export HF_TOKEN="your_huggingface_token"

  2. Start the dev server:
       bun run dev

This script intentionally did NOT build the desktop app.
EOF
}

main() {
  log "Setting up Meeting Rec"
  ensure_runtime_directories

  if [[ "$SKIP_SYSTEM" -eq 0 ]]; then
    ensure_system_dependencies
  else
    warn "Skipping system dependency installation"
  fi

  if [[ "$SKIP_JS" -eq 0 ]]; then
    install_js_dependencies
  else
    warn "Skipping JavaScript dependency installation"
  fi

  if [[ "$SKIP_PYTHON" -eq 0 ]]; then
    install_python_dependencies
  else
    warn "Skipping Python dependency installation"
  fi

  if [[ -z "${HF_TOKEN:-}" ]]; then
    warn "HF_TOKEN is not set. pyannote diarization may fail until you export it."
  fi

  print_next_steps
}

main "$@"
