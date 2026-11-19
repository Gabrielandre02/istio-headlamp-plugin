#!/usr/bin/env bash
# One entrypoint for running the plugin in a local Headlamp.
#
#   dev.sh cluster   kind + Istio ambient + samples (kind-istio-ambient.sh)
#   dev.sh serve     build, prepare, start Headlamp and leave it running
#   dev.sh e2e       serve, run Playwright, stop again (extra args go to playwright)
#   dev.sh desktop   copy the build into the desktop app (and any folders given)
#   dev.sh down      stop the containers
#
# Env: CLUSTER (istio-dev), PORT (4466), BASE_PORT (4467), HEADLAMP_IMAGE,
#      PROFILE=base to also start Headlamp under /headlamp on BASE_PORT.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLUSTER="${CLUSTER:-istio-dev}"
export PORT="${PORT:-4466}"
export DEV_DIR="${DEV_DIR:-$PWD/.dev}"
COMPOSE=(docker compose -f dev/compose.yaml ${PROFILE:+--profile "$PROFILE"})

# Headlamp needs package.json next to main.js or it disables the plugin, and a
# read-only dist/ mount cannot take one, so collect the files into one folder.
# Copy all of dist, not just main.js: dist/locales is part of the build.
install_to() {
  local dest="$1"
  mkdir -p "$dest"
  rm -rf "$dest/locales"
  cp -R dist/. "$dest/"
  cp package.json "$dest/"
  echo "-> $dest"
}

prepare() {
  npm run build
  rm -rf "$DEV_DIR"
  mkdir -p "$DEV_DIR/kube"
  install_to "$DEV_DIR/plugins/istio-headlamp-plugin"
  # The container reaches the cluster over the kind network, not 127.0.0.1.
  kind get kubeconfig --name "$CLUSTER" --internal >"$DEV_DIR/kube/config"
  chmod -R a+rX "$DEV_DIR"
}

serve() {
  prepare
  "${COMPOSE[@]}" up -d
  for _ in $(seq 1 60); do
    curl -fs "http://localhost:${PORT}/config" >/dev/null && break
    sleep 1
  done
  echo "Headlamp: http://localhost:${PORT}  (rebuild with 'serve' again, then reload the page)"
}

case "${1:-}" in
  cluster) ./dev/kind-istio-ambient.sh ;;
  serve) serve ;;
  e2e)
    shift
    kubectl --context "kind-${CLUSTER}" apply \
      -f dev/sample-istio-config.yaml -f dev/sample-istio-config-extra.yaml >/dev/null
    trap '"${COMPOSE[@]}" down >/dev/null 2>&1 || true' EXIT
    serve
    cd e2e
    [ -d node_modules ] || npm ci
    npx playwright install chromium >/dev/null
    HEADLAMP_URL="http://localhost:${PORT}" HEADLAMP_CLUSTER="kind-${CLUSTER}" npx playwright test "$@"
    ;;
  desktop)
    shift
    npm run build
    install_to "$HOME/.config/Headlamp/plugins/istio-headlamp-plugin"
    for extra in "$@"; do install_to "$extra/istio-headlamp-plugin"; done
    echo "Reload the page (or restart the desktop app) to pick it up."
    shasum -a 256 dist/main.js
    ;;
  down) "${COMPOSE[@]}" --profile base down ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
