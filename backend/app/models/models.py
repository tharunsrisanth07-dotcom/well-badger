from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from ..database import Base


class Well(Base):
    __tablename__ = "wells"

    well_id = Column(String, primary_key=True, index=True)
    name = Column(String)
    field = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    status = Column(String)          # ACTIVE | COMPLETED | SUSPENDED
    total_depth = Column(Float)      # Final TD (m) — may not be reached yet
    current_depth = Column(Float)    # Current drilling depth (m) — differs from TD for active wells
    current_formation = Column(String)  # Formation being drilled right now
    formation = Column(String)       # Primary/target formation
    spud_date = Column(DateTime, nullable=True)

    events = relationship("WellEvent", back_populates="well")
    documents = relationship("Document", back_populates="well")
    parameters = relationship("DrillingParameter", back_populates="well")


class WellEvent(Base):
    __tablename__ = "well_events"

    event_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    event_type = Column(String)      # MUD_LOSS | STUCK_PIPE | KICK | TORQUE_SPIKE | CEMENTING_ISSUE
    depth = Column(Float)            # Depth at which event occurred (m)
    formation = Column(String)
    severity = Column(String)        # LOW | MEDIUM | HIGH | CRITICAL
    description = Column(Text)
    cause = Column(Text)
    mitigation = Column(Text)
    outcome = Column(Text)
    date = Column(DateTime)
    source_document = Column(String)
    source_page = Column(Integer, nullable=True)

    well = relationship("Well", back_populates="events")


class Formation(Base):
    __tablename__ = "formations"

    formation_id = Column(String, primary_key=True, index=True)
    name = Column(String)
    top_depth = Column(Float)
    bottom_depth = Column(Float)
    description = Column(Text, nullable=True)


class Document(Base):
    __tablename__ = "documents"

    document_id = Column(String, primary_key=True, index=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    filename = Column(String)
    document_type = Column(String)   # WCR | DDR | MUD_REPORT | COMPLETION
    date = Column(DateTime)
    text = Column(Text)
    processing_status = Column(String)  # PROCESSED | PENDING | FAILED

    well = relationship("Well", back_populates="documents")


class DrillingParameter(Base):
    __tablename__ = "drilling_parameters"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    timestamp = Column(DateTime)
    depth = Column(Float)
    rop = Column(Float, nullable=True)         # Rate of Penetration (m/hr)
    wob = Column(Float, nullable=True)         # Weight on Bit (tonnes)
    rpm = Column(Float, nullable=True)         # Rotary Speed
    torque = Column(Float, nullable=True)      # kN·m
    pressure = Column(Float, nullable=True)    # Standpipe pressure (psi)
    flow_rate = Column(Float, nullable=True)   # lpm
    mud_weight = Column(Float, nullable=True)  # SG

    well = relationship("Well", back_populates="parameters")
