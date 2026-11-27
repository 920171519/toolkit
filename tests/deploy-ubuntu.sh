#!/usr/bin/env bash
set -euo pipefail

deploy_script="$(cd -- "$(dirname -- "$0")/.." && pwd)/scripts/deploy-ubuntu.sh"
sandbox="$(mktemp -d /tmp/toolkit-deploy-test.XXXXXX)"
[[ "$sandbox" == /tmp/toolkit-deploy-test.* ]]
trap 'rm -rf -- "$sandbox"' EXIT
mkdir -p "$sandbox/bin" "$sandbox/project/scripts"
cp -- "$deploy_script" "$sandbox/project/scripts/deploy-ubuntu.sh"

for tool in awk dirname grep; do
  ln -s -- "$(command -v "$tool")" "$sandbox/bin/$tool"
done

cat > "$sandbox/bin/systemctl" <<'MOCK'
#!/bin/bash
case "$1" in
  list-unit-files)
    printf '%s disabled disabled\n' "$DEPLOY_TEST_UNIT"
    for ((i = 0; i < 4000; i++)); do
      printf 'unrelated-service-%05d.service enabled enabled\n' "$i"
    done
    ;;
  stop)
    printf 'stop %s\n' "$2" >> "$DEPLOY_TEST_CALLS"
    exit "$DEPLOY_TEST_STOP_CODE"
    ;;
  start)
    printf 'start %s\n' "$2" >> "$DEPLOY_TEST_CALLS"
    ;;
  *) exit 90 ;;
esac
MOCK

cat > "$sandbox/bin/sudo" <<'MOCK'
#!/bin/bash
exec "$@"
MOCK

cat > "$sandbox/bin/pnpm" <<'MOCK'
#!/bin/bash
printf 'pnpm %s\n' "$*" >> "$DEPLOY_TEST_CALLS"
MOCK

chmod +x "$sandbox/bin/systemctl" "$sandbox/bin/sudo" "$sandbox/bin/pnpm"

run_deploy() {
  : > "$sandbox/calls"
  PATH="$sandbox/bin" BASH_ENV= SERVICE_NAME="${3:-toolkit}" STOP_CMD= START_CMD= DO_BUILD=1 \
    DEPLOY_TEST_UNIT="$1" DEPLOY_TEST_STOP_CODE="$2" DEPLOY_TEST_CALLS="$sandbox/calls" \
    "$BASH" "$sandbox/project/scripts/deploy-ubuntu.sh" > "$sandbox/output" 2>&1
}

assert_calls() {
  diff -u <(printf '%s\n' "$@") "$sandbox/calls"
}

run_deploy 'toolkit.service' 0
assert_calls 'stop toolkit.service' 'pnpm install --frozen-lockfile' 'pnpm build' 'start toolkit.service'

run_deploy 'toolkit.timer.service' 0 'toolkit.timer'
assert_calls 'stop toolkit.timer.service' 'pnpm install --frozen-lockfile' 'pnpm build' 'start toolkit.timer.service'

run_deploy 'toolkit.service-extra' 0
assert_calls 'pnpm install --frozen-lockfile' 'pnpm build'

status=0
run_deploy 'toolkit.service' 19 || status=$?
[[ "$status" -eq 19 ]]
assert_calls 'stop toolkit.service'

printf 'Ubuntu deployment mock tests passed (4 scenarios).\n'
