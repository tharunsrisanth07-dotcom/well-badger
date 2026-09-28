# NWIS - Nearby Wells Intelligence System

**AI-Powered Offset Well Knowledge and Decision Support Platform for Drilling Operations**

## Core Product Vision
NWIS serves as the "institutional memory for drilling operations," acting as a decision-support layer alongside eRTMAC. It answers the fundamental question: 
> "Given where the active well is currently drilling, what happened in nearby wells under similar geological and drilling conditions, what risks were observed, and what historical knowledge should the engineer review before proceeding?"

## Major System Components
* **Active Well Monitoring**: Context of current well (location, depth, formation).
* **Geospatial Intelligence**: Calculates distances and uncovers relevant offset wells via a dynamic interactive map.
* **Historical Knowledge Repository**: A structured database of historical events and well records.
* **Risk Engine**: Predicts risks (e.g. mud loss, stuck pipe) based on spatial proximity, depth overlap, and formation correlation.
* **Explainable Alerts**: Transparent visual feedback explaining why a risk was raised (evidence from offset wells).
* **Decision Support Dashboard**: A polished React-based industrial dashboard.

## Technical Architecture
* **Frontend**: React (Vite), TypeScript, TailwindCSS, React-Leaflet
* **Backend**: Python, FastAPI, SQLite (Simulating PostgreSQL/PostGIS using Haversine for geospatial logic)
* **Data**: Synthetic datasets modeling realistic drilling events in Assam region fields (Dibrugarh, Tinsukia).

## How to Run (Local Proof of Concept)

### Backend
1. Ensure Python is installed.
2. Navigate to `backend` directory.
3. Install requirements (e.g. `pip install fastapi uvicorn sqlalchemy pydantic pandas haversine`)
4. Generate the synthetic data:
   ```bash
   python -m app.data.synthetic_data
   ```
5. Start the FastAPI server:
   ```bash
   python -m uvicorn app.main:app --reload --port 8000
   ```
   *The API will be available at http://localhost:8000*

### Frontend
1. Navigate to `frontend` directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   *The application will be available at http://localhost:5173*

## Demo Scenario
1. Start the application. The dashboard will automatically select `ACTIVE-001`.
2. Notice the **Geospatial Intelligence** map showing the active well in red and historical offset wells in blue.
3. Check the **Drilling Risk Prediction**. As the upcoming depth overlaps with historical high-risk intervals (2800m-3000m in Barail formation), the system calculates risk percentages for Mud Loss and Torque Spike.
4. Explore the **Historical Evidence & Mitigation** tab to see exactly what happened in the nearby wells and what actions were taken previously.
5. Change the "Analysis Radius" to see how spatial proximity affects the available knowledge.

## Limitations & Future Work
- **Data source**: The POC uses synthetic data. In production, this would connect directly to the eRTMAC data stream and real document intelligence pipelines.
- **Geospatial queries**: The POC calculates haversine distance in python. Production would use proper PostGIS ST_DWithin spatial queries.
- **Decision Support**: This is an analytical decision support tool, not an autonomous drilling control system. The engineer remains the decision-maker.
