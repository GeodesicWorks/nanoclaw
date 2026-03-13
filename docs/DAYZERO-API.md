# DayZero API

HTTP API for triggering workflow runs (DayZero assessments, etc.) via NanoClaw.

## Overview

The DayZero channel exposes an HTTP server (default port `9002`) that accepts
requests to run agent workflows. Each request spawns a NanoClaw container agent
that executes the specified workflow type against a company's data package.

The channel auto-registers the `internal:dayzero` group on startup and mounts
the configured workflows directory into the container read-only.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `DAYZERO_PORT` | `9002` | HTTP port for the DayZero API |
| `DAYZERO_API_KEY` | — | API key for authentication (optional but recommended) |
| `DAYZERO_WORKFLOWS_PATH` | — | Path to directory containing workflow repos (e.g. `/root/geodesic-explore`) |

### Geodesic Integration (optional)

These enable the agent to post workflow progress updates to the Geodesic platform
via the `update_workflow` MCP tool and host-side IPC handler.

| Environment Variable | Description |
|---|---|
| `GEODESIC_AUTH_TENANT_ID` | Azure AD tenant ID for OAuth |
| `GEODESIC_AUTH_CLIENT_ID` | OAuth client ID |
| `GEODESIC_AUTH_CLIENT_SECRET` | OAuth client secret |
| `GEODESIC_AUTH_SCOPE` | OAuth scope |
| `GEODESIC_ENDPOINT` | GraphQL endpoint URL |
| `GEODESIC_DATA_TENANT` | Geodesic data tenant ID |

### Prerequisites

- Workflow repos cloned under `DAYZERO_WORKFLOWS_PATH` (e.g. `DayZero/` containing framework, playbooks, and data packages)
- Mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`) includes `DAYZERO_WORKFLOWS_PATH` as an allowed root
- Workflow data packages present at `{DAYZERO_WORKFLOWS_PATH}/DayZero/data/{company}/`

The `internal:dayzero` group is auto-registered on channel startup — no manual
database registration is needed.

## Authentication

Set `DAYZERO_API_KEY` in `.env` to enable authentication. When set, all
endpoints except `/health` require one of:

- `X-Api-Key: <key>` header
- `Authorization: Bearer <key>` header

If `DAYZERO_API_KEY` is not set, the API accepts unauthenticated requests.

## Endpoints

### `GET /health`

Returns API status and active runs. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "active_runs": 1,
  "runs": [
    { "id": "a1b2c3d4", "workflow_type": "day_zero_analysis" }
  ]
}
```

### `POST /v1/run`

Start a new workflow run.

**Request body:**
```json
{
  "workflow_type": "day_zero_analysis",
  "company": "point_b",
  "engagement_mode": "turnaround_diagnostic",
  "phase": "phase_2",
  "workflow_run_id": "uuid",
  "tenant_id": "uuid",
  "workspace_id": "uuid"
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `workflow_type` | Yes | — | Workflow type identifier (e.g. `day_zero_analysis`) |
| `company` | Yes | — | Company slug matching a data package directory (e.g. `point_b`) |
| `engagement_mode` | No | `turnaround_diagnostic` | Mode: `turnaround_diagnostic` or `carveout_separation` |
| `phase` | No | — | Resume from a specific phase instead of starting from the beginning |
| `workflow_run_id` | No | — | Geodesic workflow run ID for progress tracking |
| `tenant_id` | No | — | Geodesic tenant ID |
| `workspace_id` | No | — | Geodesic workspace ID |

**Response:**
```json
{
  "status": "started",
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "workflow_type": "day_zero_analysis",
  "company": "point_b",
  "engagement_mode": "turnaround_diagnostic",
  "poll_url": "/v1/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### `GET /v1/runs`

List all runs (active and completed).

**Response:**
```json
{
  "runs": [
    {
      "id": "a1b2c3d4-...",
      "workflow_type": "day_zero_analysis",
      "company": "point_b",
      "engagement_mode": "turnaround_diagnostic",
      "status": "running",
      "started_at": "2026-03-10T07:30:00.000Z",
      "message_count": 5
    }
  ]
}
```

### `GET /v1/runs/:id`

Get status and agent messages for a specific run. Messages are posted by the
agent as it progresses through phases — poll this endpoint to track progress.

**Response:**
```json
{
  "id": "a1b2c3d4-...",
  "workflow_type": "day_zero_analysis",
  "company": "point_b",
  "engagement_mode": "turnaround_diagnostic",
  "status": "running",
  "started_at": "2026-03-10T07:30:00.000Z",
  "message_count": 3,
  "messages": [
    { "text": "Starting Phase 0: Orient — inventorying data package for point_b", "timestamp": "2026-03-10T07:30:15.000Z" },
    { "text": "Phase 0 complete: Orient — orientation package written", "timestamp": "2026-03-10T07:45:00.000Z" },
    { "text": "Phase 1: Found 14 EBITDA add-backs totaling $12.3M, 6 flagged as recurring", "timestamp": "2026-03-10T08:10:00.000Z" }
  ],
  "workflow_run_id": "uuid",
  "tenant_id": "uuid",
  "workspace_id": "uuid"
}
```

### `POST /v1/runs/:id/complete`

Mark a run as completed.

**Response:**
```json
{
  "status": "completed",
  "run_id": "a1b2c3d4-..."
}
```

## Progress Reporting

The agent reports progress through two channels:

### 1. DayZero API Messages

The agent uses the `send_message` MCP tool to post human-readable progress
updates. These appear in the `messages` array when polling `GET /v1/runs/:id`.

Updates are posted at phase transitions, key findings, errors, and completion.

### 2. Geodesic Workflow Updates

When `workflow_run_id` is provided in the trigger request, the agent also
updates the Geodesic platform via the `update_workflow` MCP tool. This posts
structured progress (status, percentage, current phase/task) to the Geodesic
GraphQL API.

The host-side IPC handler obtains an OAuth token using the `GEODESIC_AUTH_*`
credentials and calls the `updateWorkflowRun` GraphQL mutation.

Progress mapping for DayZero assessments:

| Phase | Progress |
|---|---|
| Orient | 0.1 |
| Quantify | 0.3 |
| Compare | 0.5 |
| Connect | 0.7 |
| Deliver | 0.9 |
| Complete | 1.0 |

## Output

Assessment artifacts are written by the agent to the group's persistent storage:
```
groups/dayzero/runs/{company}_{run_id_prefix}/
```

For DayZero turnaround diagnostics, this follows the standard run structure:
```
runs/point_b_a1b2c3d4/
  phase_0_orient/
    orientation_package.yaml
  phase_1_quantify/
    quantified_baseline.yaml
    findings/F_1001.yaml, ...
  phase_2_compare/
    discrepancy_register.yaml
    findings/F_2001.yaml, ...
  phase_3_connect/
    thread_map.yaml
    findings/F_3001.yaml, ...
  assessment_summary.md
  delivery/
    primer.md
    assessment_workbook.xlsx
```

## Container Mount Structure

The agent container has the following mounts relevant to DayZero:

| Container Path | Host Path | Access | Purpose |
|---|---|---|---|
| `/workspace/extra/workflows/` | `DAYZERO_WORKFLOWS_PATH` | Read-only | All workflow repos (DayZero framework, data packages, playbooks) |
| `/workspace/group/` | `groups/dayzero/` | Read-write | Persistent storage (run output, notes, logs) |
| `/workspace/ipc/` | `data/ipc/dayzero/` | Read-write | IPC messages and workflow updates |

## Example Usage

```bash
# Start a DayZero turnaround diagnostic for Point B
curl -X POST http://localhost:9002/v1/run \
  -H "Content-Type: application/json" \
  -d '{"workflow_type": "day_zero_analysis", "company": "point_b"}'

# Start with Geodesic workflow tracking
curl -X POST http://localhost:9002/v1/run \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "day_zero_analysis",
    "company": "point_b",
    "workflow_run_id": "uuid",
    "tenant_id": "uuid",
    "workspace_id": "uuid"
  }'

# Start a carveout separation analysis
curl -X POST http://localhost:9002/v1/run \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "day_zero_analysis",
    "company": "acme_division",
    "engagement_mode": "carveout_separation"
  }'

# Poll for progress
curl http://localhost:9002/v1/runs/<run_id>

# List all runs
curl http://localhost:9002/v1/runs

# Mark complete
curl -X POST http://localhost:9002/v1/runs/<run_id>/complete
```
