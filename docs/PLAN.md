# Platform plan: NGO platform connecting farmers and communities

> Historical reference for the supplied HTML mock. This describes proposed farmer and NGO workflows, not the current Next.js API. For implemented behavior, see [README](../README.md), [Architecture](ARCHITECTURE.md) and [API](API.md).

Working title in the mock: **HarvestLink** (placeholder, rename freely).

## 1. Problem and goal

NGOs support smallholder farmers and distribute food to vulnerable households, but the two
sides are planned separately. Farmers pick crops without knowing what the community lacks,
and NGOs discover the harvest only after it is in. The platform closes that loop:

1. Farmers get a crop recommendation that already accounts for community need.
2. Farmers log what they actually harvested.
3. The platform compares forecast vs. actual, so recommendations improve each season.
4. NGOs see collected crops and needs by village and plan who receives what.

## 2. Users

| User | Device / context | What they need |
| --- | --- | --- |
| Farmer | Low-end phone, patchy data, maybe low literacy | Few screens, prefilled forms, local language, works offline |
| NGO field officer | Phone or laptop, visits villages | Register farmers and households, verify harvests, run distribution day |
| NGO program manager | Laptop | Village-level view of supply vs. need, allocation planning, reporting to donors |
| Community household | No login in v1 | Represented by the field officer; receives a basket |

## 3. User journeys

### Farmer journey

1. **Sign in** with phone number + PIN (OTP by SMS). Field officer can create the account on
   the farmer's behalf.
2. **Farm profile.** Village, GPS location (device location or map pin), land size in hectares,
   soil type, rainfall zone, irrigation, available capital, labor, last season's crop, planting
   season, free-text suggestions and crop preferences.
3. **Crop recommendation.** Ranked list of crops with a probability per crop (they sum to 100%),
   expected yield, input cost vs. capital, harvest window, community demand, and the reasons
   for and against each crop. The farmer commits to one crop; this becomes the **plan**.
4. **Harvest log** (second login). Crop harvested, quantity, area actually planted, harvest
   date, quality grade, costs, problems met (pests, drought, seed quality), quantity to make
   available to the community, notes and photos.
5. **Verification** (third step). The harvest is compared with the plan: same crop or not,
   actual vs. expected yield, timing difference. The farmer confirms what differed. The result
   feeds the recommendation engine and the NGO's "forecast match rate".

### NGO journey

1. **Overview.** Filters for district, village and season scope every number on the page.
   Headline: share of community need covered. Then collected crops by village, coverage by
   village, need vs. collected by crop.
2. **Submissions.** Every harvest log with recommended vs. harvested crop, match status and
   verification status. Field officers verify pending entries here.
3. **Distribution planner (the cart).** Left: stock per crop (collected minus allocated).
   Right: households of the selected village with their need profile and a visual basket.
   Auto-allocate by need, then adjust by hand, then export the plan for distribution day.

## 4. Scope by phase

### MVP (what the mock shows)

- Farmer: profile, rule-based recommendation, harvest log, verification.
- NGO: overview dashboards, submissions list, distribution planner with auto-allocate and
  CSV export.
- Roles: farmer, NGO coordinator. Demo data in a single file.

### v1.1

- Phone + OTP auth, offline-first PWA, SMS/USSD fallback for the harvest log.
- Household registry with photo and ID, distribution-day check-off (who received what).
- Localization (at least two languages), unit preferences (kg, bags, sacks).

### v2

- Data-driven recommendation using the verification history, weather and price feeds.
- Logistics: collection points, transport, storage, loss tracking.
- Donor reporting and open data exports.

## 5. Recommendation engine

**v0 (in the mock): transparent scoring.** Each crop starts at 0 and gets points for:

| Factor | Effect |
| --- | --- |
| Soil match | + if the crop suits the farmer's soil type, − otherwise |
| Water | + if water need fits rainfall zone or irrigation exists, − if not |
| Season | − if the crop is off-season for the chosen planting window |
| Capital | + if input cost × hectares fits capital, − proportional to shortfall |
| Community demand | + proportional to the unmet share of the village's need for that crop |
| Rotation | − if same crop as last season, + for legume after cereal |
| Farmer preference | + if the farmer marked the crop as preferred |

Scores are turned into probabilities with a softmax, so the list always sums to 100% and the
farmer sees relative confidence, not an absolute promise. Each crop shows its reasons for and
against, so an NGO officer can explain the result.

**v1: learn from outcomes.** Every verified harvest is a labelled example (profile +
recommendation → actual crop and yield). Start with per-village yield calibration, then a
gradient-boosted model on profile, weather and season features. Keep the reason list; a model
without explanations will not be trusted in the field.

## 6. Verification logic

- **Crop match:** harvested crop equals planned crop.
- **Yield variance:** (actual − expected) / expected. Within ±25% counts as "matches forecast".
- **Timing:** days between expected and actual harvest date.
- **Outcome labels:** Matches forecast · Above forecast · Below forecast · Different crop.
- The farmer tags causes (drought, pests, flooding, seed quality, no inputs, changed plan).
  These tags are the most valuable training signal and the main input for NGO interventions.

## 7. Distribution planner (cart) logic

- **Need per household** = members × per-capita baseline per crop (kg per month) × months in
  cycle. Baseline is adjustable per program.
- **Priority** = number of vulnerability tags (children under 5, elderly, pregnant or
  lactating, chronic illness, female-headed) plus household size.
- **Auto-allocate** per crop: if stock covers total need, give everyone their need. Otherwise
  split stock proportionally to need × priority weight. Round to whole kg.
- **Manual override** per household and crop, with stock guard (cannot allocate more than
  remaining).
- **Constraints to add later:** maximum per household, dietary restrictions, substitution
  rules (sorghum for maize), minimum viable basket.
- **Output:** per-household plan, village pick list, remaining stock. Export to CSV / print
  for distribution day; later, check-off on the phone.

## 8. Data model (first cut)

| Entity | Key fields |
| --- | --- |
| Farmer | id, name, phone, village_id, location (point), hectares, soil, rainfall_zone, irrigation, capital, labor, last_crop, preferences, notes |
| Village | id, name, district, households, population, support_share |
| Crop | id, name, yield_per_ha, cost_per_ha, days_to_harvest, seasons, soils, water_need, family |
| Recommendation | id, farmer_id, season, scores (json), committed_crop_id, planted_on, expected_yield |
| HarvestLog | id, farmer_id, recommendation_id, crop_id, qty_kg, hectares_planted, harvested_on, quality, cost, issues[], pooled_kg, notes, photos[] |
| Verification | id, harvest_id, crop_match, variance, timing_days, outcome, causes[], verified_by, verified_at |
| Household | id, village_id, members, tags[], contact |
| Need | household_id or village_id, crop_id, qty_kg, period |
| Allocation | id, cycle_id, household_id, crop_id, qty_kg, status (planned / delivered) |
| DistributionCycle | id, name, from, to, district |

## 9. Architecture proposal

- **Frontend:** PWA (React or Svelte), offline-first with a local queue for forms. The mock
  is plain HTML/CSS/JS so it can be ported to any stack.
- **Backend:** REST or GraphQL API (NestJS or Django), PostgreSQL with PostGIS for locations.
- **Auth:** phone + OTP, roles farmer / officer / manager. Officers can act on behalf of farmers.
- **Recommendation service:** starts as a function inside the API; moves to its own service
  once the model is trained.
- **Messaging:** SMS gateway for OTP, reminders ("time to log your harvest") and USSD fallback.
- **Hosting:** single region near the program, low bandwidth budgets, image compression on
  the device.

## 10. The mock

- File: `mock/index.html`. No build step, no dependencies. Open it in a browser.
- Edit the `DATA` block at the top of the script to change crops, villages, needs and
  submissions. Everything else is derived.
- Hash routes let you link to a screen: `#login`, `#farmer/profile`, `#farmer/recommend`,
  `#farmer/harvest`, `#farmer/verify`, `#ngo/overview`, `#ngo/submissions`, `#ngo/planner`.
- Theme toggle in the top bar; `?theme=dark` forces dark mode.
- Farmer state persists in the browser (localStorage). "Reset demo" in the top bar clears it.
- Charts follow the data-viz rules used in the repo: one fixed color per crop, status colors
  only for status, legend plus table view on every chart, tooltips on every mark.

## 11. Open questions for the team

1. Which country / program is the pilot? It decides crops, seasons, languages and units.
2. Do farmers log harvests themselves or does the field officer do it during visits?
3. Does pooled produce get bought by the NGO, donated, or sold at a community market?
4. What is the distribution cycle (monthly, quarterly) and the per-capita baseline?
5. Which existing registries (households, farmer IDs) must the platform integrate with?
