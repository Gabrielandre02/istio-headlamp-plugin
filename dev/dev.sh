#!/usr/bin/env bash
# One entrypoint for running the plugin in a local Headlamp.
#
#   dev.sh cluster   kind + Istio ambient + samples (kind-istio-ambient.sh)
#   dev.sh serve     build, prepare, start Headlamp and leave it running
#   dev.sh e2e       serve, run Playwright, stop again (extra args go to playwright)
#   dev.sh desktop   copy the build into the desktop app (and any folders given)
#   dev.sh down      stop the containers
#
# Env: CLUSTER (istio-dev), PORT (4466; e2e uses 4476), BASE_PORT (4467),
#      HEADLAMP_IMAGE, PROFILE=base to also start Headlamp under /headlamp.
# e2e runs in its own compose project and folder, so it never touches a
# Headlamp left running by `serve`.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLUSTER="${CLUSTER:-istio-dev}"

if [ "${1:-}" = e2e ]; then
  export PORT="${PORT:-4476}" DEV_DIR="$PWD/.dev-e2e" COMPOSE_PROJECT_NAME=istio-headlamp-e2e
else
  export PORT="${PORT:-4466}" DEV_DIR="$PWD/.dev"
fi
# Always include the base profile on teardown so no container is orphaned.
COMPOSE=(docker compose -f dev/compose.yaml --profile base)
UP=(docker compose -f dev/compose.yaml ${PROFILE:+--profile "$PROFILE"})

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
  mkdir -p "$DEV_DIR/kube" "$DEV_DIR/plugins"
  # The container reaches the cluster over the kind network, not 127.0.0.1.
  # Done before touching the plugin so a missing cluster fails early. The
  # folders themselves are kept: deleting them would orphan the bind mounts.
  kind get kubeconfig --name "$CLUSTER" --internal >"$DEV_DIR/kube/config"
  rm -rf "$DEV_DIR/plugins/istio-headlamp-plugin"
  install_to "$DEV_DIR/plugins/istio-headlamp-plugin"
  chmod -R a+rX "$DEV_DIR"
}

serve() {
  prepare
  "${UP[@]}" up -d
  for _ in $(seq 1 60); do
    curl -fs "http://localhost:${PORT}/config" >/dev/null && break
    sleep 1
  done
  curl -fs "http://localhost:${PORT}/config" >/dev/null ||
    { echo "Headlamp did not answer on port ${PORT}" >&2; "${UP[@]}" logs --tail 20 >&2; exit 1; }
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
  down) "${COMPOSE[@]}" down ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
