#!/usr/bin/env bash
# Kept so CI and muscle memory keep working; see dev/dev.sh.
exec "$(dirname "$0")/dev.sh" e2e "$@"
