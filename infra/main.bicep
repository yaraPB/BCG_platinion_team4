// ViaMensa on Azure: Container Apps (api + web), PostgreSQL Flexible Server, Key Vault, ACR, Log Analytics, App Insights.
// Two-phase deploy (see deploy.sh): deployApps=false creates the platform; images are built in ACR; deployApps=true
// creates/updates the container apps.

targetScope = 'resourceGroup'

@description('Short prefix for resource names (lowercase letters/digits).')
@minLength(3)
@maxLength(12)
param prefix string = 'viamensa'

param location string = resourceGroup().location

@description('Create/update the container apps (requires images in ACR).')
param deployApps bool = false

param apiImageTag string = 'latest'
param webImageTag string = 'latest'

@secure()
@description('PostgreSQL admin password (letters and digits only, 16+ chars).')
param postgresPassword string

@secure()
@description('JWT signing secret (32+ random chars).')
param jwtSecret string

@secure()
@description('Password for the seeded demo client user.')
param demoUserPassword string

@secure()
@description('Optional Anthropic API key. Empty = rule-based alert analysis only.')
param anthropicApiKey string = ''

param postgresSku string = 'Standard_B1ms'

@description('Grant AcrPull / Key Vault Secrets User via Azure RBAC. Needs Microsoft.Authorization write (Owner or RBAC Admin). When false (default, works with plain Contributor): images are pulled with the registry admin credential and the vault uses access policies.')
param useRoleAssignments bool = false

@description('Object ID of the deploying user/principal; given read/write on vault secrets so redeploys can reuse them (access-policy mode).')
param deployerObjectId string = ''

@description('Show a one-click "Use demo account" button on the sign-in page (demo deployments only).')
param showDemoLogin bool = true
param apiMinReplicas int = 1
param apiMaxReplicas int = 5

var suffix = uniqueString(resourceGroup().id)
var names = {
  logs: '${prefix}-logs'
  insights: '${prefix}-ai'
  acr: toLower('${prefix}acr${suffix}')
  identity: '${prefix}-id'
  kv: take('${prefix}kv${suffix}', 24)
  pg: '${prefix}-pg-${suffix}'
  env: '${prefix}-env'
  api: '${prefix}-api'
  web: '${prefix}-web'
}
var pgAdmin = 'viamensa_admin'
var dbName = 'viamensa'
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var kvSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.logs
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: names.insights
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: names.acr
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: !useRoleAssignments }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.identity
  location: location
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useRoleAssignments) {
  name: guid(acr.id, identity.id, 'acrpull')
  scope: acr
  properties: { roleDefinitionId: acrPullRole, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kv
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: useRoleAssignments
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    accessPolicies: useRoleAssignments ? [] : concat(
      [ { tenantId: subscription().tenantId, objectId: identity.properties.principalId, permissions: { secrets: [ 'get', 'list' ] } } ],
      empty(deployerObjectId) ? [] : [ { tenantId: subscription().tenantId, objectId: deployerObjectId, permissions: { secrets: [ 'get', 'list', 'set' ] } } ]
    )
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useRoleAssignments) {
  name: guid(kv.id, identity.id, 'kvsecretsuser')
  scope: kv
  properties: { roleDefinitionId: kvSecretsUserRole, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: names.pg
  location: location
  sku: { name: postgresSku, tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: pgAdmin
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

// Allow Azure-hosted services (Container Apps) to reach the server. For a production tenant, switch to VNet integration.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: dbName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource secretDbUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: { value: 'postgresql+psycopg://${pgAdmin}:${postgresPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require' }
}

resource secretJwt 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'jwt-secret'
  properties: { value: jwtSecret }
}

resource secretDemo 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'demo-user-password'
  properties: { value: demoUserPassword }
}

resource secretAnthropic 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(anthropicApiKey)) {
  parent: kv
  name: 'anthropic-api-key'
  properties: { value: anthropicApiKey }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: names.env
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

var registry = useRoleAssignments
  ? { server: acr.properties.loginServer, identity: identity.id }
  : { server: acr.properties.loginServer, username: acr.name, passwordSecretRef: 'acr-password' }
var registrySecrets = useRoleAssignments ? [] : [ { name: 'acr-password', value: acr.listCredentials().passwords[0].value } ]
var webFqdn = '${names.web}.${env.properties.defaultDomain}'
var baseSecrets = [
  { name: 'database-url', keyVaultUrl: secretDbUrl.properties.secretUri, identity: identity.id }
  { name: 'jwt-secret', keyVaultUrl: secretJwt.properties.secretUri, identity: identity.id }
  { name: 'demo-user-password', keyVaultUrl: secretDemo.properties.secretUri, identity: identity.id }
]
var anthropicSecrets = empty(anthropicApiKey) ? [] : [
  { name: 'anthropic-api-key', keyVaultUrl: '${kv.properties.vaultUri}secrets/anthropic-api-key', identity: identity.id }
]
var baseEnv = [
  { name: 'VIAMENSA_ENVIRONMENT', value: 'production' }
  { name: 'VIAMENSA_DATABASE_URL', secretRef: 'database-url' }
  { name: 'VIAMENSA_JWT_SECRET', secretRef: 'jwt-secret' }
  { name: 'VIAMENSA_DEMO_USER_PASSWORD', secretRef: 'demo-user-password' }
  { name: 'VIAMENSA_CORS_ORIGINS', value: '["https://${webFqdn}"]' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'WEB_CONCURRENCY', value: '2' }
]
var anthropicEnv = empty(anthropicApiKey) ? [] : [ { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' } ]

resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: names.api
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  dependsOn: [ acrPull, kvSecretsUser, pgDb, pgAllowAzure, secretAnthropic ]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: 8000, transport: 'auto', allowInsecure: false }
      registries: [ registry ]
      secrets: concat(baseSecrets, anthropicSecrets, registrySecrets)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acr.properties.loginServer}/viamensa-api:${apiImageTag}'
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: concat(baseEnv, anthropicEnv)
          probes: [
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8000 }, periodSeconds: 30, initialDelaySeconds: 15 }
            { type: 'Readiness', httpGet: { path: '/readyz', port: 8000 }, periodSeconds: 10, initialDelaySeconds: 10 }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: [ { name: 'http', http: { metadata: { concurrentRequests: '40' } } } ]
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: names.web
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  dependsOn: [ acrPull ]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [ registry ]
      // The demo password is shown on the sign-in page as a one-click shortcut (set showDemoLogin=false to hide it).
      secrets: concat(registrySecrets, showDemoLogin ? [ { name: 'demo-user-password', keyVaultUrl: secretDemo.properties.secretUri, identity: identity.id } ] : [])
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${acr.properties.loginServer}/viamensa-web:${webImageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            [ { name: 'VIAMENSA_API_URL', value: 'https://${names.api}.${env.properties.defaultDomain}' } ],
            showDemoLogin ? [ { name: 'VIAMENSA_DEMO_PASSWORD', secretRef: 'demo-user-password' } ] : []
          )
          probes: [ { type: 'Liveness', httpGet: { path: '/', port: 3000 }, periodSeconds: 30, initialDelaySeconds: 15 } ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [ { name: 'http', http: { metadata: { concurrentRequests: '80' } } } ]
      }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
output apiUrl string = 'https://${names.api}.${env.properties.defaultDomain}'
output webUrl string = 'https://${webFqdn}'
