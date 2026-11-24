#!/usr/bin/env bash
# Fills every empty secret in .env with a strong random value.
# Safe to run again: secrets that already have a value are kept.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Arquivo .env nao encontrado. Rode antes: cp .env.example .env" >&2
  exit 1
fi

# Sets KEY=value only when KEY is empty in .env
set_if_empty() {
  local key="$1" value="$2"
  if grep -q "^${key}=$" .env; then
    # Use a delimiter that never appears in base64, hex or JSON
    sed -i "s|^${key}=$|${key}=${value}|" .env
    echo "  ${key}: gerado"
  else
    echo "  ${key}: ja tinha valor, mantido"
  fi
}

hex() { openssl rand -hex "$1"; }

echo "==> Gerando segredos"
set_if_empty KEY_VAULTS_SECRET "$(openssl rand -base64 32)"
set_if_empty AUTH_SECRET "$(openssl rand -base64 32)"
set_if_empty GATEWAY_SERVICE_TOKEN "$(hex 32)"
# Database passwords go inside connection URLs: hex only, no special characters
set_if_empty LOBE_POSTGRES_PASSWORD "$(hex 24)"
set_if_empty RUSTFS_SECRET_KEY "$(hex 24)"
set_if_empty TWENTY_POSTGRES_PASSWORD "$(hex 24)"
set_if_empty TWENTY_ENCRYPTION_KEY "$(openssl rand -base64 32)"

if grep -q '^JWKS_KEY=$' .env; then
  echo "==> Gerando o par de chaves JWKS (usa a imagem do LobeHub, pode demorar no primeiro download)"
  script='const c=require("crypto");const {privateKey,publicKey}=c.generateKeyPairSync("rsa",{modulusLength:2048});const meta={alg:"RS256",kid:c.randomBytes(8).toString("hex"),use:"sig"};console.log(JSON.stringify({keys:[{...privateKey.export({format:"jwk"}),...meta}]}));console.log(JSON.stringify({keys:[{...publicKey.export({format:"jwk"}),...meta}]}))'
  if command -v node >/dev/null 2>&1; then
    keys=$(node -e "$script")
  else
    keys=$(docker run --rm --entrypoint /bin/node lobehub/lobehub -e "$script")
  fi
  private_key=${keys%%$'\n'*}
  public_key=${keys#*$'\n'}
  case "$private_key$public_key" in
    '{"keys":'*'{"keys":'*) ;;
    *) echo "Falha ao gerar o JWKS_KEY." >&2; exit 1 ;;
  esac
  sed -i "s|^JWKS_KEY=$|JWKS_KEY=${private_key}|" .env
  sed -i "s|^JWKS_PUBLIC_KEY=$|JWKS_PUBLIC_KEY=${public_key}|" .env
  echo "  JWKS_KEY e JWKS_PUBLIC_KEY: gerados"
else
  echo "  JWKS_KEY: ja tinha valor, mantido"
fi

chmod 600 .env
echo
echo "Segredos prontos em .env (permissao restrita ao root)."
echo "Guarde uma copia do .env num gerenciador de senhas: sem ele os backups nao podem ser restaurados."
