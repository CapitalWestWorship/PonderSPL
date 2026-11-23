#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"
APP_NAME="PonderSPL"
APP_BUNDLE="$PROJECT_DIR/$APP_NAME.app"

echo "=== Building Ponder SPL (Universal Binary for Intel & Apple Silicon) ==="
echo "Project Directory: $PROJECT_DIR"

mkdir -p "$BUILD_DIR"
rm -rf "$APP_BUNDLE"

SRC_FILES=(
    "$PROJECT_DIR/src/DSP/SPLEngine.mm"
    "$PROJECT_DIR/src/Audio/AudioDeviceManager.mm"
    "$PROJECT_DIR/src/Logging/CSVLogger.mm"
    "$PROJECT_DIR/src/Logging/ScheduleManager.mm"
    "$PROJECT_DIR/src/UI/HUDWindowController.mm"
    "$PROJECT_DIR/src/UI/MainWindowController.mm"
    "$PROJECT_DIR/src/UI/AppDelegate.mm"
    "$PROJECT_DIR/src/main.mm"
)

FRAMEWORKS=(
    -framework Cocoa
    -framework WebKit
    -framework CoreAudio
    -framework AudioToolbox
    -framework AVFoundation
    -framework Accelerate
    -framework IOKit
)

INCLUDES=(
    -I"$PROJECT_DIR/src"
    -I"$PROJECT_DIR/src/DSP"
    -I"$PROJECT_DIR/src/Audio"
    -I"$PROJECT_DIR/src/Logging"
    -I"$PROJECT_DIR/src/UI"
)

COMMON_FLAGS=(
    -O3
    -std=c++17
    -fobjc-arc
    "${INCLUDES[@]}"
    "${FRAMEWORKS[@]}"
)

echo "-> Compiling arm64 (Apple Silicon) binary..."
clang++ -target arm64-apple-macos12.0 "${COMMON_FLAGS[@]}" "${SRC_FILES[@]}" -o "$BUILD_DIR/${APP_NAME}_arm64"

echo "-> Compiling x86_64 (Intel) binary..."
clang++ -target x86_64-apple-macos12.0 "${COMMON_FLAGS[@]}" "${SRC_FILES[@]}" -o "$BUILD_DIR/${APP_NAME}_x86_64"

echo "-> Creating Universal Mach-O binary with lipo..."
lipo -create -output "$BUILD_DIR/$APP_NAME" "$BUILD_DIR/${APP_NAME}_arm64" "$BUILD_DIR/${APP_NAME}_x86_64"

echo "-> Verifying binary architectures:"
file "$BUILD_DIR/$APP_NAME"

echo "-> Assembling $APP_NAME.app bundle..."
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/ui"

cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/"
cp "$PROJECT_DIR/resources/Info.plist" "$APP_BUNDLE/Contents/"
cp "$PROJECT_DIR/resources/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/"
cp "$PROJECT_DIR/ui/index.html" "$APP_BUNDLE/Contents/Resources/ui/"
cp "$PROJECT_DIR/ui/style.css" "$APP_BUNDLE/Contents/Resources/ui/"
cp "$PROJECT_DIR/ui/app.js" "$APP_BUNDLE/Contents/Resources/ui/"
cp "$PROJECT_DIR/ui/hud.html" "$APP_BUNDLE/Contents/Resources/ui/"

echo "-> Signing app bundle (ad-hoc)..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "=== Build Complete! ==="
echo "App Bundle created at: $APP_BUNDLE"
ls -ld "$APP_BUNDLE"

# --- DMG installer ---------------------------------------------------------
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PROJECT_DIR/resources/Info.plist")"
DMG_PATH="$PROJECT_DIR/${APP_NAME}_v${VERSION}.dmg"
STAGING="$BUILD_DIR/dmg_staging"

echo "-> Creating installer DMG ($DMG_PATH)..."
rm -rf "$STAGING" "$DMG_PATH"
mkdir -p "$STAGING"
cp -R "$APP_BUNDLE" "$STAGING/"
ln -s /Applications "$STAGING/Applications"   # drag-to-install shortcut

hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" -ov -format UDZO "$DMG_PATH" >/dev/null
rm -rf "$STAGING"

echo "=== DMG Complete! ==="
ls -lh "$DMG_PATH"
