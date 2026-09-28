"""
Synthetic data generator for NWIS.
Generates wells, historical events, and drilling parameters for the Assam oil-field demo.
"""
import random
from datetime import datetime, timedelta

from ..database import engine, SessionLocal
from ..models import models

# ── Lookup tables ─────────────────────────────────────────────────────────────

FIELDS      = ["Dibrugarh", "Tinsukia", "Moran"]
FORMATIONS  = ["Tipam", "Barail", "Kopili", "Sylhet"]
STATUSES    = ["ACTIVE", "COMPLETED", "SUSPENDED"]

EVENT_TYPES = ["MUD_LOSS", "STUCK_PIPE", "KICK", "TORQUE_SPIKE", "CEMENTING_ISSUE"]

DESCRIPTIONS = {
    "MUD_LOSS":        "Lost circulation observed; returns dropped significantly.",
    "STUCK_PIPE":      "Differential sticking; pipe unable to reciprocate.",
    "KICK":            "Unexpected influx detected; well control measures initiated.",
    "TORQUE_SPIKE":    "Erratic torque readings suggesting formation instability.",
    "CEMENTING_ISSUE": "Incomplete cement bond observed on CBL/VDL log.",
}

CAUSES = {
    "MUD_LOSS":        "Natural fractures and high permeability in formation.",
    "STUCK_PIPE":      "High differential pressure against permeable zone.",
    "KICK":            "Insufficient mud weight for encountered pore pressure.",
    "TORQUE_SPIKE":    "Ledge or formation hardness change causing drag.",
    "CEMENTING_ISSUE": "Channeling due to poor centralisation or mud contamination.",
}

MITIGATIONS = {
    "MUD_LOSS":        "Pumped LCM pill (10 ppb FLAKE + 10 ppb FIBER); reduced ECD.",
    "STUCK_PIPE":      "Worked pipe with rotation; spotted oil-based spotting fluid.",
    "KICK":            "Shut-in well; displaced to heavier mud using drillers method.",
    "TORQUE_SPIKE":    "Reduced WOB and RPM; reamed to bottom at lower parameters.",
    "CEMENTING_ISSUE": "Performed remedial squeeze cement operation.",
}

OUTCOMES = [
    "Successfully resolved after 8 hours NPT.",
    "Resumed drilling after 12 hours NPT.",
    "No further recurrence after corrective action.",
    "Lost circulation partially controlled; continued with reduced returns.",
]

# ── Base coordinates for Assam fields ─────────────────────────────────────────
BASE_LAT = 27.47
BASE_LON = 94.91

# ── Helpers ───────────────────────────────────────────────────────────────────

def _rand_date(days_back_min=50, days_back_max=2000):
    return datetime.now() - timedelta(days=random.randint(days_back_min, days_back_max))


def _make_event(well_id: str, total_depth: float, event_type: str | None = None,
                depth: float | None = None, severity: str | None = None) -> models.WellEvent:
    etype = event_type or random.choice(EVENT_TYPES)
    d = depth or random.uniform(1000, total_depth)
    formation = "Barail" if 2800 <= d <= 3200 else random.choice(FORMATIONS)
    sev = severity or ("CRITICAL" if etype == "KICK" else random.choice(["LOW", "MEDIUM", "HIGH"]))
    return models.WellEvent(
        well_id=well_id,
        event_type=etype,
        depth=round(d, 1),
        formation=formation,
        severity=sev,
        description=DESCRIPTIONS[etype],
        cause=CAUSES[etype],
        mitigation=MITIGATIONS[etype],
        outcome=random.choice(OUTCOMES),
        date=_rand_date(),
        source_document=f"DDR_{well_id}_{random.randint(2010, 2024)}.pdf",
    )


def _make_drilling_params(well_id: str, total_depth: float, n: int = 50) -> list[models.DrillingParameter]:
    params = []
    step = total_depth / n
    for i in range(n):
        depth = round(step * i + random.uniform(-5, 5), 1)
        params.append(models.DrillingParameter(
            well_id=well_id,
            depth=max(0, depth),
            rop=round(random.uniform(2, 15), 2),
            wob=round(random.uniform(5, 25), 2),
            rpm=round(random.uniform(60, 150), 1),
            torque=round(random.uniform(5, 30), 2),
            pressure=round(random.uniform(3000, 5500), 1),
            flow_rate=round(random.uniform(300, 800), 1),
            mud_weight=round(random.uniform(1.05, 1.45), 3),
            timestamp=datetime.now() - timedelta(hours=n - i),
        ))
    return params


# ── Main generator ────────────────────────────────────────────────────────────

def generate_synthetic_data():
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(models.Well).count() > 0:
        db.close()
        return

    wells, events, params = [], [], []

    # 50 random background wells
    for i in range(1, 51):
        field = random.choice(FIELDS)
        lat = BASE_LAT + random.uniform(-0.2, 0.2)
        lon = BASE_LON + random.uniform(-0.2, 0.2)
        total_depth = round(random.uniform(2500, 4000), 1)

        well = models.Well(
            well_id=f"WELL-{i:03d}",
            name=f"OIL-{field[:3].upper()}-{i}",
            field=field,
            latitude=lat,
            longitude=lon,
            status=random.choice(STATUSES),
            total_depth=total_depth,
            formation=random.choice(FORMATIONS),
        )
        wells.append(well)

        for _ in range(random.randint(0, 4)):
            events.append(_make_event(well.well_id, total_depth))

        params.extend(_make_drilling_params(well.well_id, total_depth, n=30))

    # ── Demo active well ──────────────────────────────────────────────────────
    active = models.Well(
        well_id="ACTIVE-001",
        name="DEMO-ACTIVE-WELL",
        field="Dibrugarh",
        latitude=BASE_LAT,
        longitude=BASE_LON,
        status="ACTIVE",
        total_depth=2850.0,
        formation="Barail",
    )
    wells.append(active)
    params.extend(_make_drilling_params("ACTIVE-001", 2850.0, n=50))

    # ── Demo offset wells (guaranteed nearby events for risk demo) ────────────
    demo_offsets = [
        ("WELL-102", BASE_LAT + 0.015, BASE_LON + 0.010, "MUD_LOSS",       2905.0, "HIGH"),
        ("WELL-103", BASE_LAT - 0.020, BASE_LON + 0.020, "MUD_LOSS",       2895.0, "CRITICAL"),
        ("WELL-107", BASE_LAT + 0.030, BASE_LON - 0.030, "TORQUE_SPIKE",   2910.0, "HIGH"),
        ("WELL-112", BASE_LAT - 0.040, BASE_LON - 0.040, "STUCK_PIPE",     2930.0, "HIGH"),
        ("WELL-115", BASE_LAT + 0.050, BASE_LON + 0.005, "KICK",           2870.0, "CRITICAL"),
    ]

    for wid, wlat, wlon, etype, edepth, esev in demo_offsets:
        w = models.Well(
            well_id=wid,
            name=f"DEMO-{wid}",
            field="Dibrugarh",
            latitude=wlat,
            longitude=wlon,
            status="COMPLETED",
            total_depth=3500.0,
            formation="Barail",
        )
        wells.append(w)
        events.append(_make_event(wid, 3500.0, event_type=etype, depth=edepth, severity=esev))
        # Add a second event per well for richer evidence
        events.append(_make_event(wid, 3500.0))
        params.extend(_make_drilling_params(wid, 3500.0, n=30))

    db.add_all(wells)
    db.add_all(events)
    db.add_all(params)
    db.commit()
    db.close()
    print(f"[NWIS] Seeded {len(wells)} wells, {len(events)} events, {len(params)} drilling param rows.")


if __name__ == "__main__":
    generate_synthetic_data()
