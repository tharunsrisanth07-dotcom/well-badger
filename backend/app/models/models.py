from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
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
    status = Column(String)
    total_depth = Column(Float)
    formation = Column(String)
    
    events = relationship("WellEvent", back_populates="well")
    documents = relationship("Document", back_populates="well")
    parameters = relationship("DrillingParameter", back_populates="well")

class WellEvent(Base):
    __tablename__ = "well_events"
    
    event_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    event_type = Column(String) # MUD_LOSS, STUCK_PIPE, KICK, TORQUE_SPIKE
    depth = Column(Float)
    formation = Column(String)
    severity = Column(String) # LOW, MEDIUM, HIGH, CRITICAL
    description = Column(String)
    cause = Column(String)
    mitigation = Column(String)
    outcome = Column(String)
    date = Column(DateTime)
    source_document = Column(String)
    
    well = relationship("Well", back_populates="events")

class Formation(Base):
    __tablename__ = "formations"
    
    formation_id = Column(String, primary_key=True, index=True)
    name = Column(String)
    top_depth = Column(Float)
    bottom_depth = Column(Float)

class Document(Base):
    __tablename__ = "documents"
    
    document_id = Column(String, primary_key=True, index=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    filename = Column(String)
    document_type = Column(String) # WCR, DDR
    date = Column(DateTime)
    text = Column(String)
    processing_status = Column(String)
    
    well = relationship("Well", back_populates="documents")

class DrillingParameter(Base):
    __tablename__ = "drilling_parameters"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    well_id = Column(String, ForeignKey("wells.well_id"))
    timestamp = Column(DateTime)
    depth = Column(Float)
    rop = Column(Float)
    wob = Column(Float)
    rpm = Column(Float)
    torque = Column(Float)
    pressure = Column(Float)
    flow_rate = Column(Float)
    mud_weight = Column(Float)
    
    well = relationship("Well", back_populates="parameters")
