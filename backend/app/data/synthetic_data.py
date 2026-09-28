"""
Synthetic data generator for NWIS.
Deterministic (fixed seed) — produces consistent demo patterns for Assam oil-fields.

SYNTHETIC / DEMO DATA — not real drilling records.
"""
import random
import argparse
from datetime import datetime, timedelta

from ..database import engine, SessionLocal
from ..models import models

# ── Fixed seed for reproducibility ────────────────────────────────────────────
RNG = random.Random(42)
SYNTHETIC_REFERENCE_DATE = datetime(2026, 1, 1)

# ── Lookup tables ─────────────────────────────────────────────────────────────
FIELDS     = ["Dibrugarh", "Tinsukia", "Moran"]
STATUSES   = ["ACTIVE", "COMPLETED", "SUSPENDED"]
EVENT_TYPES = ["MUD_LOSS", "STUCK_PIPE", "KICK", "TORQUE_SPIKE", "CEMENTING_ISSUE"]

# Formation depth windows (Assam representative stratigraphy)
FORMATION_WINDOWS = {
    "Tipam":  (800,  1800),
    "Barail": (1800, 3200),
    "Kopili": (3200, 4000),
    "Sylhet": (4000, 5000),
}

# ── Rich description templates ────────────────────────────────────────────────
DESCRIPTIONS = {
    "MUD_LOSS": [
        "Total lost circulation at {depth:.0f} m — returns dropped to zero within 15 min.",
        "Partial lost circulation observed at {depth:.0f} m; pit gain of 8 m³ noted.",
        "Severe lost circulation in natural fracture zone at {depth:.0f} m; ECD above fracture gradient.",
    ],
    "STUCK_PIPE": [
        "Differential sticking at {depth:.0f} m — pipe unable to reciprocate after connection.",
        "Key-seating detected at {depth:.0f} m; upward pull exceeds 40 t overpull.",
        "Pack-off and stuck pipe at {depth:.0f} m due to swelling shale.",
    ],
    "KICK": [
        "Gas influx at {depth:.0f} m — flow check positive; 4 m³ gain before shut-in.",
        "Unexpected pore pressure at {depth:.0f} m caused influx; well controlled via drillers method.",
        "Mud-weight insufficient for {formation} pressure at {depth:.0f} m; SIDPP 320 psi.",
    ],
    "TORQUE_SPIKE": [
        "Erratic torque spikes at {depth:.0f} m — ledge in {formation} causing drag.",
        "High torque and drag at {depth:.0f} m suggesting formation hardness change.",
        "String torque exceeded operational limit at {depth:.0f} m; reduced WOB required.",
    ],
    "CEMENTING_ISSUE": [
        "Poor cement bond observed on CBL/VDL log above {depth:.0f} m casing shoe.",
        "Incomplete zonal isolation at {depth:.0f} m — channeling suspected due to poor centralisation.",
        "Gas migration through cement at {depth:.0f} m detected post-job.",
    ],
}

CAUSES = {
    "MUD_LOSS":        "Natural fractures and high permeability zones in {formation} formation.",
    "STUCK_PIPE":      "High differential pressure against permeable zone at {depth:.0f} m.",
    "KICK":            "Insufficient mud weight for encountered pore pressure in {formation}.",
    "TORQUE_SPIKE":    "Ledge or formation hardness change causing mechanical drag at {depth:.0f} m.",
    "CEMENTING_ISSUE": "Channeling due to poor centralisation or mud contamination.",
}

MITIGATIONS = {
    "MUD_LOSS":        "Pumped LCM pill (10 ppb FLAKE + 10 ppb FIBER); reduced ECD by lowering flow rate.",
    "STUCK_PIPE":      "Worked pipe with rotation and reciprocation; spotted oil-based spotting fluid (50 bbl).",
    "KICK":            "Shut-in BOP; displaced to heavier mud ({mud_weight:.2f} SG) using drillers method.",
    "TORQUE_SPIKE":    "Reduced WOB to {wob:.0f} t and RPM to {rpm:.0f}; reamed to bottom at lower parameters.",
    "CEMENTING_ISSUE": "Performed remedial squeeze cement operation; confirmed bond on repeat log.",
}

OUTCOMES = [
    "Successfully resolved after {hrs} hours NPT. No further recurrence.",
    "Lost circulation partially controlled; continued drilling with reduced returns ({ret}%).",
    "Resumed drilling after {hrs} hours NPT following corrective action.",
    "Required additional remediation; total NPT {hrs} hours. Formation risk documented for future wells.",
]

# ── Base coordinates (Assam, Dibrugarh area) ──────────────────────────────────
BASE_LAT = 27.47
BASE_LON = 94.91


def _rand_date(days_back_min=60, days_back_max=2500):
    return SYNTHETIC_REFERENCE_DATE - timedelta(days=RNG.randint(days_back_min, days_back_max))


def _formation_for_depth(depth: float) -> str:
    for fm, (top, bot) in FORMATION_WINDOWS.items():
        if top <= depth <= bot:
            return fm
    return "Barail"


def _fmt_desc(template: str, **kwargs) -> str:
    return template.format(**kwargs)


def _make_event(
    well_id: str,
    event_type: str | None = None,
    depth: float | None = None,
    severity: str | None = None,
    formation: str | None = None,
) -> models.WellEvent:
    etype = event_type or RNG.choice(EVENT_TYPES)
    d = depth or round(RNG.uniform(1200, 3400), 1)
    fm = formation or _formation_for_depth(d)
    sev = severity or (
        "CRITICAL" if etype == "KICK"
        else RNG.choice(["LOW", "MEDIUM", "HIGH", "MEDIUM", "HIGH"])
    )
    mud_weight = round(RNG.uniform(1.10, 1.45), 2)
    wob = round(RNG.uniform(8, 22), 1)
    rpm = round(RNG.uniform(60, 130), 0)
    hrs = RNG.randint(4, 24)
    ret = RNG.randint(20, 80)

    desc_tmpl = RNG.choice(DESCRIPTIONS[etype])
    desc = _fmt_desc(desc_tmpl, depth=d, formation=fm)
    cause = _fmt_desc(CAUSES[etype], depth=d, formation=fm)
    mit = _fmt_desc(MITIGATIONS[etype], mud_weight=mud_weight, wob=wob, rpm=rpm)
    out_tmpl = RNG.choice(OUTCOMES)
    outcome = _fmt_desc(out_tmpl, hrs=hrs, ret=ret)

    date = _rand_date()
    year = date.year
    doc_type = RNG.choice(["DDR", "WCR", "MUD_REPORT", "COMPLETION"])
    page = RNG.randint(3, 45)

    return models.WellEvent(
        well_id=well_id,
        event_type=etype,
        depth=round(d, 1),
        formation=fm,
        severity=sev,
        description=desc,
        cause=cause,
        mitigation=mit,
        outcome=outcome,
        date=date,
        source_document=f"{doc_type}_{well_id}_{year}.pdf",
        source_page=page,
    )


def _make_drilling_params(well_id: str, max_depth: float, n: int = 40) -> list[models.DrillingParameter]:
    params = []
    step = max_depth / n
    base_torque = RNG.uniform(8, 15)
    for i in range(n):
        d = round(step * i + RNG.uniform(-3, 3), 1)
        depth = max(50.0, d)
        # Simulate torque increasing near Barail events for demo wells
        torque_mult = 1.0
        if "ACTIVE" in well_id or well_id in ("WELL-102", "WELL-103", "WELL-107", "WELL-112"):
            if 2800 <= depth <= 3000:
                torque_mult = RNG.uniform(1.5, 2.5)   # notable torque increase in risk zone
        params.append(models.DrillingParameter(
            well_id=well_id,
            depth=depth,
            rop=round(RNG.uniform(2, 14), 2),
            wob=round(RNG.uniform(6, 22), 2),
            rpm=round(RNG.uniform(60, 140), 1),
            torque=round(base_torque * torque_mult + RNG.uniform(-1, 2), 2),
            pressure=round(RNG.uniform(3200, 5200), 1),
            flow_rate=round(RNG.uniform(320, 750), 1),
            mud_weight=round(RNG.uniform(1.08, 1.42), 3),
            timestamp=SYNTHETIC_REFERENCE_DATE - timedelta(hours=n - i),
        ))
    return params


def _make_document(well_id: str, event: models.WellEvent, idx: int = 0) -> models.Document:
    """Create a synthetic DDR entry consistent with a specific event."""
    year = event.date.year if event.date else 2020
    doc_parts = event.source_document.split("_") if event.source_document else []
    # If the prefix is something like MUD_REPORT, handle it:
    if len(doc_parts) > 2 and doc_parts[0] == "MUD" and doc_parts[1] == "REPORT":
        doc_type = "MUD_REPORT"
    else:
        doc_type = doc_parts[0] if doc_parts else "DDR"
    doc_id = f"DOC-{well_id}-{event.event_type[:3]}-{year}-{idx}"
    text = (
        f"[SYNTHETIC DEMO DOCUMENT]\n\n"
        f"Document Type: {doc_type}\n"
        f"Well: {well_id}\n"
        f"Date: {event.date.strftime('%Y-%m-%d') if event.date else 'Unknown'}\n\n"
        f"EVENT RECORD\n"
        f"Event Type: {event.event_type.replace('_', ' ')}\n"
        f"Depth: {event.depth} m\n"
        f"Formation: {event.formation}\n"
        f"Severity: {event.severity}\n\n"
        f"Description: {event.description}\n\n"
        f"Cause: {event.cause}\n\n"
        f"Mitigation Applied: {event.mitigation}\n\n"
        f"Outcome: {event.outcome}\n\n"
        f"Source: {event.source_document} (Page {event.source_page})\n"
        f"\n[NOTE: This is synthetic/demo data generated for NWIS POC purposes.]"
    )
    return models.Document(
        document_id=doc_id,
        well_id=well_id,
        filename=event.source_document or f"DDR_{well_id}_{year}.pdf",
        document_type=doc_type,
        date=event.date or SYNTHETIC_REFERENCE_DATE - timedelta(days=365),
        text=text,
        processing_status="PROCESSED",
    )


# ── Main generator ────────────────────────────────────────────────────────────

def generate_synthetic_data(reset=False):
    if reset:
        models.Base.metadata.drop_all(bind=engine)
    
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if not reset and db.query(models.Well).count() > 0:
        db.close()
        print("[NWIS] Database already initialized. Use --reset to overwrite.")
        return

    wells, events, params, docs = [], [], [], []
    doc_counter = [0]  # mutable counter for unique doc IDs

    def add_doc(wid, e):
        doc_counter[0] += 1
        docs.append(_make_document(wid, e, doc_counter[0]))

    # ── 45 random background wells ────────────────────────────────────────────
    for i in range(1, 46):
        field = RNG.choice(FIELDS)
        lat = BASE_LAT + RNG.uniform(-0.25, 0.25)
        lon = BASE_LON + RNG.uniform(-0.25, 0.25)
        total_depth = round(RNG.uniform(2500, 4200), 1)
        status = RNG.choice(STATUSES)
        current_depth = total_depth if status != "ACTIVE" else round(RNG.uniform(total_depth * 0.6, total_depth * 0.95), 1)
        primary_formation = _formation_for_depth(total_depth * 0.75)

        well = models.Well(
            well_id=f"WELL-{i:03d}",
            name=f"OIL-{field[:3].upper()}-{i}",
            field=field,
            latitude=lat,
            longitude=lon,
            status=status,
            total_depth=total_depth,
            current_depth=current_depth,
            current_formation=_formation_for_depth(current_depth),
            formation=primary_formation,
            spud_date=_rand_date(300, 3000),
        )
        wells.append(well)

        n_events = RNG.randint(0, 3)
        for _ in range(n_events):
            e = _make_event(well.well_id)
            events.append(e)
            add_doc(well.well_id, e)

        params.extend(_make_drilling_params(well.well_id, total_depth, n=25))

    # ── Demo active well (ACTIVE-001) ─────────────────────────────────────────
    # current_depth = 2850 m — actively drilling in Barail
    # total_depth target = 3500 m
    active1 = models.Well(
        well_id="ACTIVE-001",
        name="DEMO-WELL-A1",
        field="Dibrugarh",
        latitude=BASE_LAT,
        longitude=BASE_LON,
        status="ACTIVE",
        total_depth=3500.0,
        current_depth=2850.0,      # <-- Currently at 2850 m
        current_formation="Barail",
        formation="Barail",
        spud_date=SYNTHETIC_REFERENCE_DATE - timedelta(days=45),
    )
    wells.append(active1)
    params.extend(_make_drilling_params("ACTIVE-001", 2850.0, n=60))

    # ── Demo active well 2 (ACTIVE-002) ──────────────────────────────────────
    active2 = models.Well(
        well_id="ACTIVE-002",
        name="DEMO-WELL-A2",
        field="Tinsukia",
        latitude=BASE_LAT + 0.08,
        longitude=BASE_LON + 0.10,
        status="ACTIVE",
        total_depth=3200.0,
        current_depth=1640.0,      # Shallower — in Tipam
        current_formation="Tipam",
        formation="Tipam",
        spud_date=SYNTHETIC_REFERENCE_DATE - timedelta(days=28),
    )
    wells.append(active2)
    params.extend(_make_drilling_params("ACTIVE-002", 1640.0, n=40))

    # ── Demo offset wells — guaranteed nearby events for risk demo ────────────
    # These create the critical Barail risk zone pattern at 2895–2930 m
    demo_offsets = [
        # (well_id, lat_offset, lon_offset, event_type, depth_m, severity, formation)
        ("WELL-102", +0.015, +0.010, "MUD_LOSS",       2905.0, "HIGH",     "Barail"),
        ("WELL-103", -0.020, +0.020, "MUD_LOSS",       2895.0, "CRITICAL", "Barail"),
        ("WELL-107", +0.030, -0.030, "TORQUE_SPIKE",   2910.0, "HIGH",     "Barail"),
        ("WELL-112", -0.040, -0.040, "STUCK_PIPE",     2930.0, "HIGH",     "Barail"),
        ("WELL-115", +0.050, +0.005, "KICK",           2870.0, "CRITICAL", "Barail"),
        ("WELL-118", -0.025, +0.035, "MUD_LOSS",       2918.0, "MEDIUM",   "Barail"),
        ("WELL-121", +0.012, -0.018, "TORQUE_SPIKE",   2885.0, "MEDIUM",   "Barail"),
    ]

    for wid, dlat, dlon, etype, edepth, esev, eform in demo_offsets:
        w = models.Well(
            well_id=wid,
            name=f"OIL-DBG-{wid}",
            field="Dibrugarh",
            latitude=BASE_LAT + dlat,
            longitude=BASE_LON + dlon,
            status="COMPLETED",
            total_depth=3500.0,
            current_depth=3500.0,   # completed = current == total
            current_formation="Kopili",
            formation="Barail",
            spud_date=_rand_date(500, 2000),
        )
        wells.append(w)

        # Primary guaranteed event (in risk zone)
        e1 = _make_event(wid, event_type=etype, depth=edepth, severity=esev, formation=eform)
        events.append(e1)
        add_doc(wid, e1)

        # Secondary event at different depth (for richer profiles)
        e2 = _make_event(wid)
        events.append(e2)
        add_doc(wid, e2)

        params.extend(_make_drilling_params(wid, 3500.0, n=35))

    # Commit
    db.add_all(wells)
    db.add_all(events)
    db.add_all(params)
    db.add_all(docs)
    db.commit()
    db.close()
    print(
        f"[NWIS] Seeded {len(wells)} wells, {len(events)} events, "
        f"{len(params)} param rows, {len(docs)} documents."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic data for NWIS")
    parser.add_argument("--reset", action="store_true", help="Drop existing tables and recreate data")
    args = parser.parse_args()
    generate_synthetic_data(reset=args.reset)
