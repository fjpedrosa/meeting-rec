#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DESKTOP_DIR")"
BUILD_DIR="$DESKTOP_DIR/build"
APP_NAME="Meeting Transcriber"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
BINARY_NAME="MeetingTranscriber"

echo "Building Swift project..."
cd "$DESKTOP_DIR"
swift build -c release

echo "Cleaning previous build..."
rm -rf "$APP_BUNDLE"

echo "Creating app bundle structure..."
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

echo "Copying binary..."
cp "$DESKTOP_DIR/.build/release/$BINARY_NAME" "$APP_BUNDLE/Contents/MacOS/"

echo "Copying Info.plist..."
cp "$DESKTOP_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/"

echo "Signing app (ad-hoc)..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "✓ App lista en: $APP_BUNDLE"
