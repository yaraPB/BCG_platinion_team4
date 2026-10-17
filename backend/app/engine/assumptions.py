"""Every number the engine uses that is not computed from the network, with its provenance.

kind:
- sourced:  published figure, cited.
- derived:  computed from sourced figures.
- estimate: modelling assumption; tunable; shown as such in the UI.
- client:   provided by the client (demo values in the seed).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

WB_2024 = "https://documents1.worldbank.org/curated/en/099021825075534986/pdf/P177582-0dd9be28-fd9b-4fe4-83e0-93b06501ddb0.pdf"
UNOPS_VIA_JICA = ("https://www.jica.go.jp/english/about/policy/environment/id/africa/a_b_fi/south_sudan/__icsFiles/"
                  "afieldfile/2024/12/05/171_IMPLEMENTATION_REVIEW_STUDY_OF_THE_PROJECT_FOR_THE_DEVELOPMENT_OF_JUBA_RIVER"
                  "_PORT_IN_THE_REPUBLIC_OF_SOUTH_SUDAN_1.pdf")
AFDB = ("https://www.afdb.org/fileadmin/uploads/afdb/Documents/Generic-Documents/South%20Sudan%20Infrastructure%20Action"
        "%20Plan%20-%20%20A%20Program%20for%20Sustained%20Strong%20Economic%20Growth%20-%20Chapter%207%20-%20Transport%20"
        "Infrastructure%20and%20Services.pdf")
LOGCLUSTER_JUBA_PORT = "https://lca.logcluster.org/south-sudan-republic-21-juba-port-assessment"
WFP_SS_AIR_RIVER = "https://x.com/WFP_SouthSudan/status/1755112404088737797"
WFP_SS_PREPOSITION = "https://www.wfp.org/news/wfp-calls-cash-frontload-south-sudan-operations-amid-warnings-rising-hunger"
UNHCR_UGANDA_RATION = "https://im.unhcr.org/uga/wfp.html"
WFP_FOOD_BASKET = "https://wfp.org/wfp-food-basket"


@dataclass(frozen=True, slots=True)
class Assumption:
    key: str
    value: float
    unit: str
    label: str
    kind: str
    source: str
    url: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


ASSUMPTIONS: tuple[Assumption, ...] = (
    Assumption("road_rate_paved", 0.20, "USD/t-km", "Truck freight tariff, trunk road", "sourced",
               "World Bank, South Sudan Transport Sector Development Project (Jul 2024): freight tariff $0.2 per ton-km",
               WB_2024),
    Assumption("road_rate_unpaved", 0.40, "USD/t-km", "Truck freight tariff, unpaved road", "sourced",
               "UNOPS 2018 via JICA/MoT review: trucks $0.20–0.40 per ton-km (upper bound used for unpaved roads)",
               UNOPS_VIA_JICA),
    Assumption("road_rate_track", 0.65, "USD/t-km", "Truck freight tariff, dirt track", "estimate",
               "AfDB South Sudan Infrastructure Action Plan: route rates up to $0.65 (Yei–Juba) and $0.85 (Malakal–Juba) "
               "per ton-km; $0.65 applied to dirt tracks", AFDB),
    Assumption("river_rate", 0.10, "USD/t-km", "Barge freight tariff", "sourced",
               "UNOPS 2018 via JICA/MoT review: river barges $0.05–0.10 per ton-km (upper bound used)", UNOPS_VIA_JICA),
    Assumption("port_handling", 35.0, "USD/t", "River port handling per transfer", "sourced",
               "Logistics Cluster, Juba port assessment: handling charges up to US$35–50/mt (lower bound used)",
               LOGCLUSTER_JUBA_PORT),
    Assumption("air_cost_per_t", 2700.0, "USD/t", "Air delivery (airlift/airdrop)", "sourced",
               "WFP South Sudan: delivering food by air costs ~$2,700 per metric ton vs ~$300 by river", WFP_SS_AIR_RIVER),
    Assumption("wfp_river_cost_per_t", 300.0, "USD/t", "WFP river delivery reference (not used in routing)", "sourced",
               "WFP South Sudan: ~$300 per metric ton by river", WFP_SS_AIR_RIVER),
    Assumption("truck_speed_paved", 45.0, "km/h", "Loaded truck average speed, paved", "estimate",
               "Planning estimate incl. checkpoints; tune per client fleet data"),
    Assumption("truck_speed_unpaved", 25.0, "km/h", "Loaded truck average speed, unpaved", "estimate",
               "Planning estimate incl. checkpoints; tune per client fleet data"),
    Assumption("truck_speed_track", 15.0, "km/h", "Loaded truck average speed, dirt track", "estimate",
               "Planning estimate (dry season); tune per client fleet data"),
    Assumption("barge_speed_downstream", 8.0, "km/h", "Barge convoy speed downstream", "estimate",
               "Planning estimate incl. stops; tune per operator data"),
    Assumption("barge_speed_upstream", 5.0, "km/h", "Barge convoy speed upstream", "estimate",
               "Planning estimate incl. stops; tune per operator data"),
    Assumption("port_transfer_hours", 12.0, "h", "Loading/unloading at a river port", "estimate", "Planning estimate"),
    Assumption("air_mobilisation_hours", 48.0, "h", "Time to mobilise an air delivery", "estimate", "Planning estimate"),
    Assumption("air_speed_kmh", 250.0, "km/h", "Cargo aircraft block speed", "estimate", "Planning estimate"),
    Assumption("ration_kg_per_person_day", 0.565, "kg/person/day", "Full general food ration (2,100 kcal)", "sourced",
               "WFP general distribution example (Uganda): cereals 400 g, pulses 80 g, oil 30 g, salt 5 g, CSB 50 g "
               "targeting 2,100 kcal/person/day", UNHCR_UGANDA_RATION),
    Assumption("cycle_days", 7.0, "days", "Planning cycle covered by one delivery", "client",
               "Client setting (demo value)"),
    Assumption("airdrop_vs_road_ratio", 17.0, "x", "WFP: airdrops up to 17x road cost (context only)", "sourced",
               "WFP South Sudan, preposition appeal", WFP_SS_PREPOSITION),
)

# Mapping of qualitative likelihood (from analysts or the LLM) to a probability used in simulation.
# These are explicit modelling choices, not forecasts — shown to the user and tunable per client.
LIKELIHOOD_BANDS: dict[str, float] = {"very_likely": 0.85, "likely": 0.6, "possible": 0.35, "unlikely": 0.1}
SEVERITY_FACTOR: dict[str, float] = {"low": 0.5, "medium": 0.75, "high": 1.0}


@dataclass(frozen=True, slots=True)
class Params:
    road_rate_paved: float
    road_rate_unpaved: float
    road_rate_track: float
    river_rate: float
    port_handling: float
    air_cost_per_t: float
    truck_speed_paved: float
    truck_speed_unpaved: float
    truck_speed_track: float
    barge_speed_downstream: float
    barge_speed_upstream: float
    port_transfer_hours: float
    air_mobilisation_hours: float
    air_speed_kmh: float
    ration_kg_per_person_day: float
    cycle_days: float

    def road_rate(self, surface: str) -> float:
        return {"paved": self.road_rate_paved, "unpaved": self.road_rate_unpaved}.get(surface, self.road_rate_track)

    def truck_speed(self, surface: str) -> float:
        return {"paved": self.truck_speed_paved, "unpaved": self.truck_speed_unpaved}.get(surface, self.truck_speed_track)

    def tonnes_for(self, people: int) -> float:
        return people * self.ration_kg_per_person_day * self.cycle_days / 1000.0


def default_params(overrides: dict[str, float] | None = None) -> Params:
    values = {a.key: a.value for a in ASSUMPTIONS}
    values.update(overrides or {})
    fields = Params.__dataclass_fields__
    return Params(**{k: float(values[k]) for k in fields})
