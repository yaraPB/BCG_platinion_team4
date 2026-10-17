# JSON API

The Next.js app serves all endpoints. Authentication is not required for this synthetic, stateless scenario model.

## GET `/api/network`

Returns the input network:

| Field | Type | Description |
| --- | --- | --- |
| `region` | string | Display name |
| `notice` | string | Dataset provenance and limitations |
| `nodes` | array | Hubs, communities and junctions |
| `corridors` | array | IDs, endpoints, travel hours and risk values |
| `scenarios` | array | Labels, descriptions and `closedRoads` presets |

See `src/lib/types.ts` for the full types and `src/lib/data/network.ts` for editable inputs.

## GET `/api/plan`

Returns the all-open baseline: seven on-plan destinations, 110,400 reachable people and 168 tonnes assigned. Plan responses include `Cache-Control: no-store`.

## POST `/api/plan`

Calculates a fresh plan. It does not change the baseline or store a scenario.

### Request

```http
POST /api/plan
Content-Type: application/json
```

```json
{ "closedRoads": ["juba-bor"] }
```

`closedRoads` is required and must be an array of known ID strings. `[]` resets the calculation. Duplicate IDs are deduplicated. The array may not contain more entries than the network has corridors. The body limit is 4,096 bytes, checked while reading the request stream.

### Response

Example excerpt (the `deliveries` array is omitted):

```json
{
  "closedRoads": ["juba-bor"],
  "stockRemaining": { "juba": 26, "wau": 64, "malakal": 32 },
  "summary": {
    "reachablePeople": 110400,
    "totalPeople": 110400,
    "assignedTonnes": 168,
    "totalTonnes": 168,
    "onPlan": 6,
    "rerouted": 1,
    "supplierChanged": 0,
    "unreachable": 0
  }
}
```

The complete response includes `deliveries` in allocation priority order:

| Field | Description |
| --- | --- |
| `communityId`, `name` | Destination identity |
| `people`, `ipc`, `foodDays` | Population and priority inputs |
| `requestedTonnes`, `assignedTonnes` | Requested and allocated food |
| `plannedSupplierId`, `supplierId` | Planned and selected hub; selected hub is `null` when unserved |
| `status` | `on-plan`, `rerouted`, `supplier-changed` or `unreachable` |
| `hours` | Sum of travel times; `null` when unserved |
| `path`, `roadIds` | Ordered node and corridor IDs from hub to destination |
| `coordinates` | Ordered `[longitude, latitude]` pairs |
| `reason` | Explanation of the assignment or failure |

### Errors

Error responses have the shape `{ "error": "Human-readable explanation." }`.

| Status | Cause |
| --- | --- |
| `400` | Missing body, malformed JSON, invalid field shape or unknown corridor |
| `413` | Body exceeds 4,096 bytes |
| `415` | Content type is not `application/json` |
| `500` | Unexpected calculation or request-reading failure |

### Client example

```typescript
const response = await fetch("/api/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ closedRoads: ["juba-bor"] }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
```

### Scenario examples

| Closure set | Expected result |
| --- | --- |
| `[]` | All seven destinations on plan |
| `["juba-bor"]` | Bor rerouted using its planned supplier |
| `["juba-bor", "bor-malakal", "rumbek-bentiu"]` | Bor unserved; reachable population becomes 92,000 |
| `["juba-bor", "rumbek-bentiu", "bentiu-malakal", "juba-yei"]` | Two supplier changes and one rerouted delivery |
