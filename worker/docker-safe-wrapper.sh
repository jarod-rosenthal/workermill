#!/bin/bash
# Docker CLI security wrapper — prevents host filesystem access from worker containers.
#
# Workers can still: spin up containers (databases, caches), use docker compose,
# pull images, view logs, etc. Only blocks flags that enable host escape:
#   --privileged     (full device + capability access)
#   --pid=host       (host PID namespace visibility)
#   -v /host/path:*  (host filesystem bind mounts — named volumes are fine)
#   --mount type=bind,source=/host/path (same via --mount syntax)

DOCKER=/usr/bin/docker.real

# Only inspect 'run' and 'create' — everything else passes through unchanged.
# This covers: docker compose, docker info, docker ps, docker logs, docker stop, etc.
subcmd="${1:-}"
if [[ "$subcmd" == "container" ]]; then
  subcmd="${2:-}"
fi

if [[ "$subcmd" != "run" && "$subcmd" != "create" ]]; then
  exec "$DOCKER" "$@"
fi

# Scan arguments for dangerous flags
i=1
while [[ $i -le $# ]]; do
  arg="${!i}"

  case "$arg" in
    --privileged)
      echo "BLOCKED: --privileged is not allowed — containers run without elevated privileges." >&2
      exit 1
      ;;
    --pid=host)
      echo "BLOCKED: --pid=host is not allowed — host PID namespace access is restricted." >&2
      exit 1
      ;;

    # -v VALUE (space-separated)
    -v|--volume)
      ((i++))
      vol="${!i:-}"
      # Host bind mount = starts with / and has a colon (e.g., /etc:/etc)
      # Named volume = no leading / (e.g., pgdata:/var/lib/postgresql) — allowed
      # Anonymous volume = no colon (e.g., /data) — allowed
      if [[ "$vol" == /* && "$vol" == *:* ]]; then
        echo "BLOCKED: Host bind mount '$vol' is not allowed — use named volumes instead." >&2
        echo "  Example: docker run -v pgdata:/var/lib/postgresql/data postgres:16" >&2
        exit 1
      fi
      ;;

    # --volume=VALUE (equals-separated)
    --volume=*)
      vol="${arg#--volume=}"
      if [[ "$vol" == /* && "$vol" == *:* ]]; then
        echo "BLOCKED: Host bind mount '$vol' is not allowed — use named volumes instead." >&2
        exit 1
      fi
      ;;

    # -vVALUE (no space — less common but valid Docker syntax)
    -v/*)
      vol="${arg#-v}"
      if [[ "$vol" == /* && "$vol" == *:* ]]; then
        echo "BLOCKED: Host bind mount '$vol' is not allowed — use named volumes instead." >&2
        exit 1
      fi
      ;;

    # --mount VALUE or --mount=VALUE
    --mount|--mount=*)
      if [[ "$arg" == "--mount" ]]; then
        ((i++))
        mount_spec="${!i:-}"
      else
        mount_spec="${arg#--mount=}"
      fi
      # Only block type=bind with absolute source path
      if [[ "$mount_spec" == *type=bind* ]]; then
        src=$(echo "$mount_spec" | sed -n 's/.*\(source\|src\)=\([^,]*\).*/\2/p')
        if [[ "$src" == /* ]]; then
          echo "BLOCKED: Bind mount from host path '$src' is not allowed — use named volumes instead." >&2
          exit 1
        fi
      fi
      ;;
  esac

  ((i++))
done

exec "$DOCKER" "$@"
