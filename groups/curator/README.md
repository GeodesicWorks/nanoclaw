# Curator Group — Setup & Triggering

## Registration

The Curator group auto-registers when a message arrives with its trigger. Register it
via the DayZero channel or manually via the main group's IPC.

### Via DayZero Channel API

```bash
curl -X POST http://localhost:9002/v1/run \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: ${DAYZERO_API_KEY}" \
  -d '{
    "workflow_type": "curator",
    "tenant_id": "e7d347f1-ea8c-4933-9807-29f19a9237e7"
  }'
```

### Group Registration (via main group IPC)

The group must be registered with `additionalMounts` pointing to the DayZero run
output directory so the agent can read assessment_summary.md and thread_map.yaml.

```json
{
  "name": "curator",
  "folder": "curator",
  "trigger": "curator",
  "containerConfig": {
    "additionalMounts": [
      {
        "hostPath": "/mnt/c/Users/wyatt/Coding/Geodesic/DayZero/runs/datto_turnaround_20260323",
        "containerPath": "run-output",
        "readonly": true
      }
    ],
    "timeout": 600000
  }
}
```

The `hostPath` should be updated to match the actual run directory for each invocation.

## Environment

The container automatically receives these secrets via stdin:
- `GEODESIC_ENDPOINT` — GraphQL API URL
- `GEODESIC_DATA_TENANT` — Tenant UUID

## Trigger Message Format

The agent expects:
```
curator run_id=<run_id> audience=<board|operator|consultant>
```

## Outputs

1. **BriefComposition** — via `createBriefComposition` mutation
2. **Report** — via `createReport`, `createReportSection`, `createReportBlock` mutations
