#!/usr/bin/env bash
set -euo pipefail

# Keep the hostile-code worker independent of the hosted image's floating package set.
# Update the version, URL, and digest together after reviewing the Ubuntu security notice.
readonly BUBBLEWRAP_VERSION="0.9.0-1ubuntu0.3"
readonly BUBBLEWRAP_SHA256="2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094"
readonly BUBBLEWRAP_URL="https://security.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"

if [[ "$(uname -s)" != "Linux" || "$(dpkg --print-architecture)" != "amd64" ]]; then
  echo "AgentShip's pinned CI bubblewrap package supports Linux amd64 only." >&2
  exit 1
fi

package_path="$(mktemp "${RUNNER_TEMP:-/tmp}/agentship-bubblewrap.XXXXXX.deb")"
cleanup() {
  unlink "$package_path" 2>/dev/null || true
}
trap cleanup EXIT

curl --fail --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors \
  --output "$package_path" "$BUBBLEWRAP_URL"
printf '%s  %s\n' "$BUBBLEWRAP_SHA256" "$package_path" | sha256sum --check --strict
sudo dpkg --install "$package_path"

test -x /usr/bin/bwrap
test -x /usr/bin/unshare
test -x /usr/bin/setpriv
test ! -u /usr/bin/bwrap
test "$(dpkg-query --showformat='${Version}' --show bubblewrap)" = "$BUBBLEWRAP_VERSION"
test "$(/usr/bin/bwrap --version)" = "bubblewrap 0.9.0"

# Create the empty network namespace without configuring loopback, then make bubblewrap
# share that already-private namespace. This avoids hosted-kernel RTM_NEWADDR restrictions.
# The trusted setpriv wrapper clears every namespace capability before code executes.
/usr/bin/unshare \
  --user \
  --map-root-user \
  --net \
  /usr/bin/bwrap \
  --die-with-parent \
  --new-session \
  --unshare-all \
  --share-net \
  --ro-bind / / \
  --proc /proc \
  --dev /dev \
  -- /usr/bin/setpriv \
  --bounding-set=-all \
  --inh-caps=-all \
  --ambient-caps=-all \
  -- /usr/bin/true
