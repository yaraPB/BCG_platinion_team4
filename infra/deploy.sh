#!/usr/bin/env bash
# Deploy ViaMensa to Azure. Requires: az CLI logged in (az login), permission to create resources and role assignments.
#
#   RESOURCE_GROUP=viamensa-rg LOCATION=westeurope ./infra/deploy.sh
#
# Optional env: LOCATION (default: the existing group's region), USE_ROLE_ASSIGNMENTS=true (needs Owner/RBAC Admin;
# default false works with plain Contributor), PREFIX (default viamensa), ANTHROPIC_API_KEY (enables LLM alert analysis), IMAGE_TAG (default git sha),
# AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID (service-principal sign-in, no browser).
# Secrets (Postgres password, JWT secret, demo password) are generated on first run and stored in Key Vault;
# re-runs read them back from Key Vault so they stay stable.
set -euo pipefail

RG="${RESOURCE_GROUP:?set RESOURCE_GROUP}"
LOCATION="${LOCATION:-}"
PREFIX="${PREFIX:-viamensa}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

# Bicep and Azure MCP are .NET tools; hosts without libicu (e.g. minimal WSL) need invariant globalization.
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

# Non-interactive sign-in with a service principal when no az session exists.
if ! az account show -o none 2>/dev/null; then
  if [ -n "${AZURE_CLIENT_ID:-}" ] && [ -n "${AZURE_CLIENT_SECRET:-}" ] && [ -n "${AZURE_TENANT_ID:-}" ]; then
    echo "==> Signing in with service principal"
    az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID" -o none
  else
    echo "Not signed in. Run 'az login' or set AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID." >&2
    exit 1
  fi
fi
[ -n "${AZURE_SUBSCRIPTION_ID:-}" ] && az account set --subscription "$AZURE_SUBSCRIPTION_ID"

# Reuse an existing resource group (common when you only have Contributor on a pre-created group).
if EXISTING=$(az group show -n "$RG" --query location -o tsv 2>/dev/null); then
  LOCATION="${LOCATION:-$EXISTING}"
  echo "==> Using existing resource group $RG ($EXISTING)"
else
  LOCATION="${LOCATION:-westeurope}"
  echo "==> Creating resource group $RG ($LOCATION)"
  az group create -n "$RG" -l "$LOCATION" -o none
fi

# Object ID of whoever deploys: granted vault-secret access so redeploys can read the generated secrets back.
if [ "$(az account show --query user.type -o tsv)" = "servicePrincipal" ]; then
  DEPLOYER_ID=$(az ad sp show --id "$(az account show --query user.name -o tsv)" --query id -o tsv 2>/dev/null || true)
else
  DEPLOYER_ID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
fi
USE_RBAC="${USE_ROLE_ASSIGNMENTS:-false}"

# Reuse secrets if the vault already exists (stable passwords across deploys).
KV=$(az keyvault list -g "$RG" --query "[?starts_with(name, '${PREFIX}kv')].name | [0]" -o tsv 2>/dev/null || true)
read_secret() { [ -n "$KV" ] && az keyvault secret show --vault-name "$KV" -n "$1" --query value -o tsv 2>/dev/null || true; }
DB_URL=$(read_secret database-url)
PG_PASSWORD="${PG_PASSWORD:-$(echo "$DB_URL" | sed -n 's#.*://[^:]*:\([^@]*\)@.*#\1#p')}"
PG_PASSWORD="${PG_PASSWORD:-$(gen 24)}"
JWT_SECRET="${JWT_SECRET:-$(read_secret jwt-secret)}"; JWT_SECRET="${JWT_SECRET:-$(gen 48)}"
DEMO_PASSWORD="${DEMO_PASSWORD:-$(read_secret demo-user-password)}"; DEMO_PASSWORD="${DEMO_PASSWORD:-$(gen 16)}"
ANTHROPIC="${ANTHROPIC_API_KEY:-$(read_secret anthropic-api-key)}"

params=(prefix="$PREFIX" location="$LOCATION" postgresPassword="$PG_PASSWORD" jwtSecret="$JWT_SECRET"
        demoUserPassword="$DEMO_PASSWORD" anthropicApiKey="$ANTHROPIC" useRoleAssignments="$USE_RBAC"
        deployerObjectId="$DEPLOYER_ID")

echo "==> Phase 1: platform (registry, vault, database, environment)"
OUT=$(az deployment group create -g "$RG" -f "$ROOT/infra/main.bicep" -n "viamensa-platform" \
  --parameters "${params[@]}" deployApps=false --query properties.outputs -o json)
ACR=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['acrName']['value'])")

echo "==> Building images in ACR ($ACR), tag $TAG"
az acr build -r "$ACR" -t "viamensa-api:$TAG" -t "viamensa-api:latest" "$ROOT/backend" -o none
az acr build -r "$ACR" -t "viamensa-web:$TAG" -t "viamensa-web:latest" -f "$ROOT/Dockerfile.web" "$ROOT" -o none

echo "==> Phase 2: container apps"
OUT=$(az deployment group create -g "$RG" -f "$ROOT/infra/main.bicep" -n "viamensa-apps" \
  --parameters "${params[@]}" deployApps=true apiImageTag="$TAG" webImageTag="$TAG" --query properties.outputs -o json)
API=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['apiUrl']['value'])")
WEB=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['webUrl']['value'])")

echo "==> Waiting for API readiness"
for _ in $(seq 1 30); do curl -fsS "$API/readyz" >/dev/null 2>&1 && break; sleep 10; done
curl -fsS "$API/readyz" && echo

cat <<MSG

Deployed.
  Web:  $WEB
  API:  $API   (OpenAPI docs: $API/docs)
  Demo sign-in: demo@viamensa.app / (Key Vault secret 'demo-user-password')
MSG
