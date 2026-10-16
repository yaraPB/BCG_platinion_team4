# BCG_platinion_team4

Platform concept for NGOs that connect smallholder farmers with the communities they feed.
Farmers get a crop recommendation that accounts for community need, log their harvest, and
see how it compared with the forecast. The NGO sees collected crops and needs by village and
plans who receives what.

## What is here

| Path | Purpose |
| --- | --- |
| `docs/PLAN.md` | Product plan: users, journeys, scope by phase, recommendation and allocation logic, data model, architecture, open questions |
| `mock/index.html` | Clickable single-file mock (no build, no dependencies) |
| `mock/screenshots/` | Rendered screens for quick review |

## Run the mock

Open `mock/index.html` in any browser. Nothing to install.

Useful links once it is open (hash routes):

| Screen | Route |
| --- | --- |
| Sign in | `#login` |
| Farmer: profile | `#farmer/profile` |
| Farmer: crop recommendation | `#farmer/recommend` |
| Farmer: harvest log | `#farmer/harvest` |
| Farmer: verify vs. forecast | `#farmer/verify` |
| NGO: overview | `#ngo/overview` |
| NGO: harvest submissions | `#ngo/submissions` |
| NGO: distribution planner | `#ngo/planner` |

Query switches: `?demo=full` preloads a harvest and an allocation so every screen has
content; `?theme=dark` forces dark mode. Farmer state is saved in the browser; use
"Reset demo" in the top bar to start over.

## Iterate

All scenario data (crops, villages, needs, harvest submissions, demo farmer) lives in the
`DATA` block at the top of the script in `mock/index.html`. Everything on screen is derived
from it. Recommendation scoring is in `recommend()`, verification in `verify()`, and the
cart logic in `autoAllocate()`.
