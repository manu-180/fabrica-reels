#!/usr/bin/env bash
# uso: agentes/empujar.sh "<mensaje>" <comando> [args...]
# Baja la punta de la rama del estado, corre el comando parado ahí, commitea lo que cambió en
# cuentas/ y pushea. Si otro job pusheó en el medio, vuelve a bajar y a correr el comando: 8 vueltas
# con espera creciente, siempre fast-forward, nunca force push. Si la rama no existe, la crea huérfana.
set -euo pipefail

MENSAJE="$1"
shift
RAMA="${RAMA_ESTADO:-estado}"
export GIT_AUTHOR_NAME="manu-180" GIT_AUTHOR_EMAIL="157671390+manu-180@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
RAIZ="$(git rev-parse --show-toplevel)"
DIR="${RUNNER_TEMP:-/tmp}/estado-push"
# Igual que .github/scripts/estado.sh: el checkout no guarda el token (el agente corre en el mismo
# runner) y sólo este paso lo recibe, en FABRICA_GIT_TOKEN.
if [ -n "${FABRICA_GIT_TOKEN:-}" ]; then
  git -C "$RAIZ" config --local credential.helper ''
  git -C "$RAIZ" config --local --add credential.helper '!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$FABRICA_GIT_TOKEN"; }; f'
fi

for intento in 1 2 3 4 5 6 7 8; do
  cd "$RAIZ"
  rm -rf "$DIR"
  git worktree prune
  rc=0
  git ls-remote --exit-code --heads origin "refs/heads/$RAMA" > /dev/null || rc=$?
  if [ "$rc" = 0 ]; then
    git fetch -q --depth=1 origin "refs/heads/$RAMA"
    git worktree add -q --detach "$DIR" FETCH_HEAD
  elif [ "$rc" = 2 ]; then
    VACIO=$(git hash-object -w -t tree /dev/null)
    git worktree add -q --detach "$DIR" "$(git commit-tree "$VACIO" -m "[fabrica] rama del estado")"
  else
    sleep $((intento * 5 + RANDOM % 5))
    continue
  fi
  (cd "$DIR" && "$@")
  cd "$DIR"
  git add -A -- cuentas
  if git diff --cached --quiet; then
    echo "Nada nuevo para guardar."
    exit 0
  fi
  git commit -q -m "$MENSAJE"
  if git push -q origin "HEAD:refs/heads/$RAMA"; then
    echo "Guardado en $RAMA: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep $((intento * 5 + RANDOM % 5))
done
echo "::error::No se pudo pushear a $RAMA en 8 vueltas."
exit 1
