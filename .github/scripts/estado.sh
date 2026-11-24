#!/usr/bin/env bash
# Prepara FABRICA_ESTADO desde la rama `estado`.
#   estado.sh lectura <dir>             copia la punta de la rama (planear, vigía: no pushean)
#   estado.sh escritura <dir> <cuenta>  worktree de la rama, para que correr.mjs con FABRICA_PUSH=1 pushee
# En los dos casos suma al banco los guiones que el agente semanal deja en cuentas/<id>/guiones-auto/.
set -euo pipefail

modo=${1:?modo}
dir=${2:?dir}
cuenta=${3:-}
rama=estado
raiz=${FABRICA_RAIZ:-$GITHUB_WORKSPACE}

rc=0
git ls-remote --exit-code --heads origin "refs/heads/$rama" > /dev/null || rc=$?
if [ "$rc" != 0 ] && [ "$rc" != 2 ]; then
  echo "::error::No se pudo consultar la rama $rama (git ls-remote salió con $rc): sin el estado se publicaría dos veces."
  exit 1
fi

if [ "$modo" = lectura ]; then
  mkdir -p "$dir"
  if [ "$rc" = 0 ]; then
    git fetch -q --depth=1 origin "refs/heads/$rama"
    git archive FETCH_HEAD | tar -x -C "$dir"
  else
    echo "La rama $rama todavía no existe: el estado arranca vacío."
  fi
elif [ "$modo" = escritura ]; then
  : "${cuenta:?cuenta}"
  export GIT_AUTHOR_NAME=manu-180 GIT_AUTHOR_EMAIL=157671390+manu-180@users.noreply.github.com
  export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
  # El token no queda en .git/config (checkout sin persist-credentials): lo lee este helper de la
  # variable FABRICA_GIT_TOKEN, que sólo existe en el paso que pushea. Así npm, npx y el render, que
  # corren código de terceros en el mismo runner, no encuentran una credencial con permiso de escritura.
  git config --local credential.helper ''
  git config --local --add credential.helper '!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$FABRICA_GIT_TOKEN"; }; f'
  if [ "$rc" = 0 ]; then
    git fetch -q origin "+refs/heads/$rama:refs/remotes/origin/$rama"
    git worktree add -q --detach "$dir" "origin/$rama"
    rel="cuentas/$cuenta/estado.json"
    # Si la cuenta alguna vez guardó estado y ahora no está, arrancar de cero republicaría lo de 48 h.
    if ! git cat-file -e "origin/$rama:$rel" 2> /dev/null && [ -n "$(git log -1 --format=%H "origin/$rama" -- "$rel")" ]; then
      echo "::error::[fabrica:$cuenta] la rama $rama tuvo $rel y ahora no lo tiene: no se arranca de cero."
      exit 1
    fi
  else
    vacio=$(git hash-object -w -t tree /dev/null)
    git worktree add -q --detach "$dir" "$(git commit-tree "$vacio" -m "rama del estado")"
  fi
else
  echo "uso: estado.sh lectura|escritura <dir> [cuenta]" >&2
  exit 2
fi

for auto in "$dir"/cuentas/*/guiones-auto; do
  [ -d "$auto" ] || continue
  id=$(basename "$(dirname "$auto")")
  destino="$raiz/cuentas/$id/guiones"
  [ -d "$destino" ] || continue
  cp -n "$auto"/*.json "$destino"/ 2> /dev/null || true
done
