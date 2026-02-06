#!/usr/bin/env bash
set -euo pipefail

DEFAULT_VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/obs/"

read -r -p "Vault folder [${DEFAULT_VAULT}]: " VAULT_DIR
VAULT_DIR="${VAULT_DIR:-$DEFAULT_VAULT}"

if [[ ! -d "$VAULT_DIR" ]]; then
  echo "Creating vault directory: $VAULT_DIR"
  mkdir -p "$VAULT_DIR"
fi

if [[ ! -f "manifest.json" ]]; then
  echo "manifest.json not found in the current directory."
  exit 1
fi

PLUGIN_ID=$(node -e "const m=require('./manifest.json'); process.stdout.write(m.id);")
DEV_SUFFIX="-dev"
TARGET_DIR="$VAULT_DIR/.obsidian/plugins/${PLUGIN_ID}${DEV_SUFFIX}"

mkdir -p "$TARGET_DIR"

# Write a dev-suffixed manifest into the target plugin folder.
node - <<'NODE' "$TARGET_DIR" "$DEV_SUFFIX"
const fs = require('fs');
const path = require('path');

const targetDir = process.argv[2];
const suffix = process.argv[3];
const manifestPath = path.join(process.cwd(), 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const updated = {
  ...manifest,
  id: `${manifest.id}${suffix}`,
  name: manifest.name ? `${manifest.name} Dev` : `${manifest.id}${suffix}`,
};

fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(updated, null, 2));
NODE

cp styles.css "$TARGET_DIR"
cp main.js "$TARGET_DIR"

echo "Installed dev plugin to: $TARGET_DIR"
