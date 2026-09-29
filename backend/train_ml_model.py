import sqlite3
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
import joblib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nwis.db"

def train():
    print("Loading data from database...")
    conn = sqlite3.connect(DB_PATH)
    
    # Load events
    events_df = pd.read_sql("SELECT depth, formation, event_type FROM well_events", conn)
    
    # Load wells to generate "negative" (NONE) samples
    wells_df = pd.read_sql("SELECT total_depth, formation FROM wells", conn)
    
    conn.close()
    
    # Generate negative samples
    np.random.seed(42)
    negative_samples = []
    
    formations = events_df['formation'].unique() if not events_df.empty else ['Barail', 'Tipam', 'Girujan', 'Surma']
    if len(formations) == 0:
        formations = ['Barail', 'Tipam', 'Girujan']
        
    # We want 3x negative samples to represent normal drilling conditions
    for _ in range(len(events_df) * 3):
        depth = np.random.uniform(500, 4500)
        formation = np.random.choice(formations)
        negative_samples.append({'depth': depth, 'formation': formation, 'event_type': 'NONE'})
        
    neg_df = pd.DataFrame(negative_samples)
    
    # Combine
    df = pd.concat([events_df, neg_df], ignore_index=True)
    
    X = df[['depth', 'formation']]
    y = df['event_type']
    
    print(f"Training on {len(X)} samples (Events: {len(events_df)}, Normal: {len(neg_df)})...")
    
    # Preprocessing pipeline
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), ['depth']),
            ('cat', OneHotEncoder(handle_unknown='ignore'), ['formation'])
        ])
        
    # Model pipeline
    clf = Pipeline(steps=[
        ('preprocessor', preprocessor),
        ('classifier', RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42))
    ])
    
    clf.fit(X, y)
    
    # Save model
    model_path = BASE_DIR / "ml_model.joblib"
    joblib.dump(clf, model_path)
    print(f"Model saved to {model_path}")
    
    # Print sample predictions to verify
    sample_X = pd.DataFrame([{"depth": 2800, "formation": formations[0]}])
    probs = clf.predict_proba(sample_X)[0]
    print("\nSample Prediction (Depth 2800):")
    for cls, prob in zip(clf.classes_, probs):
        print(f"  {cls}: {prob*100:.1f}%")

if __name__ == "__main__":
    train()
