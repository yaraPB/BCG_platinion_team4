"""Correlated disruption model.

Two layers of dependence, because disruptions are neither independent nor identical in their consequences:

1. Hazard occurrence. Each hazard k occurs with probability p_k. Occurrences are drawn jointly with a Gaussian
   copula whose correlation matrix encodes which hazards tend to come together (e.g. a flood and a landslide in the
   same basin, a conflict and checkpoint closures on the same corridor).

2. Footprint impact. If hazard k occurs, every corridor in its footprint is affected through a one-factor Gaussian
   copula: Y_e = sqrt(rho_k) * W_k + sqrt(1 - rho_k) * eps_e. A shared shock W_k makes corridors fail *together*
   (rho high for floods, ~0 for road accidents). Corridor e closes if Phi(Y_e) < q_close(e) and is degraded
   (slower and/or more expensive, still open) if Phi(Y_e) < q_close(e) + q_degrade(e).

Consequences depend on the hazard kind and the corridor surface: a flood closes dirt tracks far more often than paved
roads and does not close the river; a fuel shortage closes nothing but raises cost; an accident closes one road for
a day or two. These parameters are modelling estimates (exposed via /v1/assumptions) and are tunable per client.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import numpy as np

from .geo import point_to_polyline_km
from .network import Network

SURFACES = ("paved", "unpaved", "track", "river", "transfer")


@dataclass(frozen=True, slots=True)
class Consequence:
    p_close: dict[str, float]  # P(close | hazard occurs, full exposure) by surface
    p_degrade: float  # P(degraded | occurs, not closed, full exposure)
    delay_factor: float  # travel-time multiplier on degraded corridors
    cost_factor: float  # cost multiplier on degraded corridors
    rho: float  # within-footprint correlation
    duration_days: float  # typical duration (used for "wait it out" comparisons)
    label: str


def _pc(paved: float, unpaved: float, track: float, river: float, transfer: float) -> dict[str, float]:
    return dict(zip(SURFACES, (paved, unpaved, track, river, transfer), strict=True))


CONSEQUENCES: dict[str, Consequence] = {
    "flood": Consequence(_pc(0.35, 0.70, 0.90, 0.0, 0.2), 0.8, 1.8, 1.15, 0.85, 21, "Flooding / washout"),
    "conflict": Consequence(_pc(0.60, 0.60, 0.65, 0.50, 0.5), 0.8, 1.5, 1.30, 0.50, 14, "Armed conflict / insecurity"),
    "accident": Consequence(_pc(0.50, 0.50, 0.50, 0.30, 0.3), 1.0, 1.3, 1.00, 0.00, 2, "Accident / breakdown"),
    "landslide": Consequence(_pc(0.60, 0.70, 0.80, 0.0, 0.0), 0.8, 1.5, 1.10, 0.70, 10, "Landslide"),
    "storm": Consequence(_pc(0.20, 0.50, 0.70, 0.30, 0.3), 0.9, 1.5, 1.05, 0.80, 3, "Storm / heavy rain"),
    "fuel_shortage": Consequence(_pc(0, 0, 0, 0, 0), 1.0, 1.10, 1.60, 1.00, 14, "Fuel shortage (cost, not closure)"),
    "strike": Consequence(_pc(0.30, 0.30, 0.30, 0.30, 0.3), 1.0, 1.40, 1.20, 0.90, 5, "Strike / protest"),
    "checkpoint": Consequence(_pc(0.40, 0.40, 0.40, 0.30, 0.3), 1.0, 1.60, 1.25, 0.60, 7, "Checkpoint closures / levies"),
    "other": Consequence(_pc(0.30, 0.30, 0.30, 0.20, 0.2), 0.8, 1.30, 1.10, 0.50, 7, "Other disruption"),
}
KINDS = tuple(CONSEQUENCES)

# Base correlation between hazard kinds (symmetric). Scaled down when footprints do not overlap.
_KIND_RHO = {
    ("flood", "flood"): 0.6, ("flood", "landslide"): 0.5, ("flood", "storm"): 0.6, ("storm", "landslide"): 0.4,
    ("conflict", "conflict"): 0.4, ("conflict", "checkpoint"): 0.6, ("conflict", "strike"): 0.2,
    ("flood", "conflict"): 0.1, ("fuel_shortage", "strike"): 0.3, ("fuel_shortage", "conflict"): 0.2,
}


def kind_rho(a: str, b: str) -> float:
    return _KIND_RHO.get((a, b), _KIND_RHO.get((b, a), 0.0))


@dataclass
class Hazard:
    id: str
    kind: str
    title: str
    probability: float
    severity: float = 1.0  # multiplies closure/degrade probabilities (low 0.5, medium 0.75, high 1.0)
    corridor_ids: list[str] = field(default_factory=list)
    node_ids: list[str] = field(default_factory=list)
    circle: tuple[float, float, float] | None = None  # lon, lat, radius_km
    duration_days: float | None = None

    def __post_init__(self) -> None:
        if self.kind not in CONSEQUENCES:
            self.kind = "other"
        self.probability = float(min(1.0, max(0.0, self.probability)))
        self.severity = float(min(1.0, max(0.0, self.severity)))

    @property
    def consequence(self) -> Consequence:
        return CONSEQUENCES[self.kind]

    def exposure(self, net: Network) -> np.ndarray:
        """Exposure in [0, 1] per corridor: 1 for listed corridors or corridors touching listed nodes; for a circle,
        1 - distance/radius from the corridor geometry to the centre."""
        x = np.zeros(len(net.corridors))
        for cid in self.corridor_ids:
            if cid in net.corr_ix:
                x[net.corr_ix[cid]] = 1.0
        for nid in self.node_ids:
            if nid in net.node_ix:
                for k in net.incident_corridors(nid):
                    x[k] = 1.0
        if self.circle:
            lon, lat, radius = self.circle
            for k, c in enumerate(net.corridors):
                d = point_to_polyline_km(lon, lat, c.geometry)
                x[k] = max(x[k], max(0.0, 1.0 - d / max(radius, 1e-6)))
        return x

    def to_dict(self) -> dict:
        d = asdict(self)
        d["consequence"] = asdict(self.consequence)
        return d


def norm_cdf(x: np.ndarray) -> np.ndarray:
    """Standard normal CDF, vectorised (Abramowitz & Stegun 7.1.26 erf, |error| < 1.5e-7)."""
    z = np.abs(x) / math.sqrt(2.0)
    t = 1.0 / (1.0 + 0.3275911 * z)
    poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    erf = 1.0 - poly * np.exp(-z * z)
    return 0.5 * (1.0 + np.sign(x) * erf)


def nearest_psd_correlation(r: np.ndarray) -> np.ndarray:
    vals, vecs = np.linalg.eigh((r + r.T) / 2)
    vals = np.clip(vals, 1e-8, None)
    m = vecs @ np.diag(vals) @ vecs.T
    d = np.sqrt(np.diag(m))
    return m / np.outer(d, d)


def hazard_correlation(net: Network, hazards: list[Hazard], exposures: list[np.ndarray]) -> np.ndarray:
    n = len(hazards)
    r = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            base = kind_rho(hazards[i].kind, hazards[j].kind)
            if base == 0:
                continue
            overlap = float(np.minimum(exposures[i], exposures[j]).max()) if n else 0.0
            r[i, j] = r[j, i] = base * (1.0 if overlap > 0 else 0.5)
    return nearest_psd_correlation(r) if n > 1 else r


@dataclass
class SampledStates:
    closed: np.ndarray  # bool [runs, corridors]
    time_mult: np.ndarray  # float [runs, corridors]
    cost_mult: np.ndarray  # float [runs, corridors]
    occurred: np.ndarray  # bool [runs, hazards]


def sample_states(net: Network, hazards: list[Hazard], runs: int, rng: np.random.Generator) -> SampledStates:
    n_c, n_h = len(net.corridors), len(hazards)
    closed = np.zeros((runs, n_c), dtype=bool)
    tm = np.ones((runs, n_c))
    cm = np.ones((runs, n_c))
    if n_h == 0:
        return SampledStates(closed, tm, cm, np.zeros((runs, 0), dtype=bool))
    exposures = [hz.exposure(net) for hz in hazards]
    corr = hazard_correlation(net, hazards, exposures)
    chol = np.linalg.cholesky(corr)
    z = rng.standard_normal((runs, n_h)) @ chol.T
    probs = np.array([hz.probability for hz in hazards])
    occurred = norm_cdf(z) < probs

    surface_of = np.array([SURFACES.index(c.surface) if c.surface in SURFACES else 1 for c in net.corridors])
    for k, hz in enumerate(hazards):
        idx = np.nonzero(exposures[k] > 0)[0]
        if idx.size == 0:
            continue
        cons = hz.consequence
        x = exposures[k][idx] * hz.severity
        pclose_tab = np.array([cons.p_close[s] for s in SURFACES])
        q_close = np.clip(x * pclose_tab[surface_of[idx]], 0.0, 1.0)
        q_deg = np.clip(x * cons.p_degrade * (1.0 - q_close), 0.0, 1.0)
        w = rng.standard_normal((runs, 1))
        eps = rng.standard_normal((runs, idx.size))
        u = norm_cdf(math.sqrt(cons.rho) * w + math.sqrt(1.0 - cons.rho) * eps)
        hit = occurred[:, k:k + 1]
        c = hit & (u < q_close)
        dgr = hit & ~c & (u < q_close + q_deg)
        closed[:, idx] |= c
        tm[:, idx] = np.where(dgr, np.maximum(tm[:, idx], cons.delay_factor), tm[:, idx])
        cm[:, idx] = np.where(dgr, np.maximum(cm[:, idx], cons.cost_factor), cm[:, idx])
    return SampledStates(closed, tm, cm, occurred)


def expected_outcome(net: Network, hz: Hazard) -> tuple[set[str], dict[str, float], dict[str, float]]:
    """Deterministic 'if this hazard happens' state: corridors with q_close >= 0.5 close, other exposed ones degrade."""
    x = hz.exposure(net)
    cons = hz.consequence
    closed, tm, cm = set(), {}, {}
    for k, c in enumerate(net.corridors):
        if x[k] <= 0:
            continue
        q = x[k] * hz.severity * cons.p_close.get(c.surface, 0.3)
        if q >= 0.5:
            closed.add(c.id)
        elif x[k] * hz.severity >= 0.25:
            tm[c.id] = cons.delay_factor
            cm[c.id] = cons.cost_factor
    return closed, tm, cm
