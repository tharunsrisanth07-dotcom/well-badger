import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    (
        r'(function GeospatialSection.*?return \(\n\s*<div className="section-enter".*?>\n\s*<div.*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1        <WorkspaceHeader title="GEOSPATIAL ANALYSIS" subtitle="Spatial context · nearby wells · analog relevance" />\n'
    ),
    (
        r'(function RiskSection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="RISK INTELLIGENCE" subtitle="Depth-aligned historical risk and supporting evidence" />\n'
    ),
    (
        r'(function WellsSection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="WELL EXPLORER" subtitle="Historical and active-well context" />\n'
    ),
    (
        r'(function KnowledgeSection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="KNOWLEDGE BASE" subtitle="Institutional drilling memory and source-linked events" />\n'
    ),
    (
        r'(function SearchSection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="NWIS QUERY CONSOLE" subtitle="Evidence-grounded drilling intelligence retrieval" />\n'
    ),
    (
        r'(function AnomalySection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="ANOMALY DETECTION" subtitle="Statistical telemetry anomalies vs historical baseline" />\n'
    ),
    (
        r'(function AuditSection.*?return \(\n\s*<div className="section-enter".*?>\n)(?!\s*<WorkspaceHeader)',
        r'\1      <WorkspaceHeader title="DECISION AUDIT REPORT" subtitle="Engine provenance and model integrity" />\n'
    )
]

for pattern, repl in replacements:
    content = re.sub(pattern, repl, content, flags=re.DOTALL)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
