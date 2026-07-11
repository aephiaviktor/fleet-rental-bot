#!/usr/bin/env bash
# Detached launcher for Fleet Rental Bot.
# - Builds synchronously
# - Spawns electron in the background with setsid+nohup+disown so it survives
#   the launching console closing (e.g. a Windows desktop shortcut's wsl.exe
#   process exiting)
# - Logs:  analysis/electron-stdout-<PROFILE>.log,
#          analysis/electron-stderr-<PROFILE>.log
# - Pid:   analysis/electron-<PROFILE>.pid
#
# Usage:  ./scripts/launch.sh <PROFILE>   (e.g. MUD, ONI, USTUR)
#
# Per-faction launchers (one script per PROFILE) are convenience wrappers
# around this one. The PID check and build/launch logic live here so the
# three wrappers can stay tiny.
set -u
if [ $# -lt 1 ]; then
  printf 'Usage: %s <PROFILE>\n' "$0" >&2
  exit 2
fi
PROFILE="$1"
# Reject anything that isn't a simple profile name; we use it in paths
# and grep patterns below.
case "$PROFILE" in
  ''|*[!A-Za-z0-9_-]*) printf 'Invalid PROFILE %s\n' "$PROFILE" >&2; exit 2 ;;
esac

export PATH="/home/viktor/.nvm/versions/node/v22.22.0/bin:$PATH"
export ELECTRON_ENABLE_LOGGING=0

# WSLg display: probe the WSLg sockets and force-set DISPLAY/WAYLAND_DISPLAY
# if the sockets are reachable. The WSLg init does not always propagate
# these into non-interactive shells (e.g., `wsl.exe bash -lc "..."` from a
# Windows desktop shortcut), so Electron segfaults with "Missing X server or
# $DISPLAY" without this. We force (not just-if-empty) because the env var
# can be set to a stale value across WSLg restarts.
if [ -S /mnt/wslg/.X11-unix/X0 ]; then
  export DISPLAY=:0
fi
if [ -S /mnt/wslg/runtime-dir/wayland-0 ]; then
  export WAYLAND_DISPLAY=wayland-0
fi
# XDG_RUNTIME_DIR is conditional: /run/user/<uid> from systemd is also valid.
if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d /mnt/wslg/runtime-dir ]; then
  export XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir
fi

# Resolve the repo root from this script's location so the launcher is
# path-agnostic — works from a fresh clone anywhere on disk.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT" || exit 1
mkdir -p analysis
stdout_log="analysis/electron-stdout-${PROFILE}.log"
stderr_log="analysis/electron-stderr-${PROFILE}.log"
pid_file="analysis/electron-${PROFILE}.pid"

if [ -f "$pid_file" ]; then
  existing=$(cat "$pid_file" 2>/dev/null || true)
  # A naive `kill -0` check is unsafe under WSL2: when a bot dies its PID
  # gets recycled by some other process, so the recycled PID is "alive" but
  # no longer ours. Verify the cmdline actually points at *this* profile's
  # electron binary + its user-data-dir before refusing to relaunch.
  if [ -n "$existing" ] && [ -r "/proc/$existing/cmdline" ]; then
    cmdline=$(tr '\0' ' ' < "/proc/$existing/cmdline" 2>/dev/null || true)
    if printf '%s' "$cmdline" | grep -q "node_modules/electron/dist/electron" \
       && printf '%s' "$cmdline" | grep -q "profiles/${PROFILE}"; then
      printf 'Fleet Rental Bot (%s) is already running (pid %s).\n' "$PROFILE" "$existing"
      printf 'Stop it first with: kill %s\n' "$existing"
      exit 0
    fi
  fi
  # pid file is stale (process gone OR pid recycled by another process) — drop it.
  rm -f "$pid_file"
fi

printf 'Building Fleet Rental Bot (%s)...\n' "$PROFILE"
npm run build 2>&1 | tail -5
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  printf '\nBuild failed with exit code %s. Not starting electron.\n' "$status"
  exit "$status"
fi

printf 'Launching Fleet Rental Bot (%s) in background...\n' "$PROFILE"
# --profile is read by Electron before app.whenReady(). It selects the local
# profile folder under ~/.config/fleet-rental-bot/profiles/ without hardcoding
# a faction or relying on env files.
# setsid puts electron in a new session/process group so it survives the
# launching console closing (which kills the wsl.exe process group).
setsid nohup ./node_modules/.bin/electron . --profile "$PROFILE" \
  >"$stdout_log" 2>"$stderr_log" </dev/null &
electron_pid=$!
disown
echo "$electron_pid" > "$pid_file"

sleep 2
if ! kill -0 "$electron_pid" 2>/dev/null; then
  printf '\nFleet Rental Bot (%s) exited within 2s of start. See %s.\n' "$PROFILE" "$stderr_log"
  rm -f "$pid_file"
  exit 1
fi

printf '\nFleet Rental Bot (%s) launched (pid %s).\n' "$PROFILE" "$electron_pid"
printf '  stdout: %s\n  stderr: %s\n  pid:    %s\n' "$stdout_log" "$stderr_log" "$pid_file"
printf '\nYou can close this window. To stop the bot: kill %s\n' "$electron_pid"
exit 0
