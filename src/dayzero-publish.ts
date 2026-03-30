/**
 * Host-side DayZero report publisher.
 *
 * After a DayZero container exits successfully, this module:
 * 1. Finds the run output directory
 * 2. Runs build_reports.py to generate structured report JSON
 * 3. Obtains a Geodesic OAuth token
 * 4. Runs publish_workflow_results.py to create reports + mark workflow complete
 *
 * This runs on the host (not in the container) so it doesn't depend on
 * the agent remembering to do it — immune to context compaction.
 */
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const KNOWLEDGE_BASE = '/root/geodesic-explore/knowledge-base';
const BUILD_REPORTS_SCRIPT = path.join(
  KNOWLEDGE_BASE,
  '08_Skills/GeodesicSkills/dayzero-report-builder/build_reports.py',
);
const PUBLISH_SCRIPT = path.join(
  KNOWLEDGE_BASE,
  '08_Skills/GeodesicSkills/workflow-run-lifecycle/scripts/publish_workflow_results.py',
);

function run(cmd: string, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        timeout: 120_000,
        env: { ...process.env, ...env },
      },
      (err, stdout, stderr) => {
        if (err) {
          logger.error(
            { cmd: cmd.slice(0, 100), stderr: stderr?.slice(0, 500) },
            'Command failed',
          );
          reject(new Error(`${err.message}\n${stderr}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function getGeodesicToken(): Promise<string> {
  const env = readEnvFile([
    'GEODESIC_AUTH_TENANT_ID',
    'GEODESIC_AUTH_CLIENT_ID',
    'GEODESIC_AUTH_CLIENT_SECRET',
    'GEODESIC_AUTH_SCOPE',
  ]);

  const tid =
    process.env.GEODESIC_AUTH_TENANT_ID || env.GEODESIC_AUTH_TENANT_ID;
  const clientId =
    process.env.GEODESIC_AUTH_CLIENT_ID || env.GEODESIC_AUTH_CLIENT_ID;
  const clientSecret =
    process.env.GEODESIC_AUTH_CLIENT_SECRET || env.GEODESIC_AUTH_CLIENT_SECRET;
  let scope = process.env.GEODESIC_AUTH_SCOPE || env.GEODESIC_AUTH_SCOPE;
  // Azure CIAM client_credentials flow requires scope to end with /.default
  if (scope && !scope.endsWith('/.default')) {
    scope = `${scope}/.default`;
  }

  if (!tid || !clientId || !clientSecret || !scope) {
    throw new Error('Missing Geodesic OAuth credentials');
  }

  const tokenScript = `
import urllib.request, urllib.parse, json
data = urllib.parse.urlencode({
    'grant_type': 'client_credentials',
    'client_id': '${clientId}',
    'client_secret': '${clientSecret}',
    'scope': '${scope}',
}).encode()
req = urllib.request.Request('https://${tid}.ciamlogin.com/${tid}/oauth2/v2.0/token', data=data)
resp = json.load(urllib.request.urlopen(req, timeout=15))
print(resp['access_token'])
`;

  const token = (await run(`python3 -c "${tokenScript.replace(/"/g, '\\"')}"`)).trim();
  if (!token) throw new Error('Failed to obtain Geodesic OAuth token');
  return token;
}

/**
 * Find the most recent run directory for a company in the group's runs folder.
 */
function findRunDir(groupFolder: string, company: string): string | null {
  const runsDir = path.join(GROUPS_DIR, groupFolder, 'runs');
  if (!fs.existsSync(runsDir)) return null;

  const entries = fs.readdirSync(runsDir)
    .filter((e) => e.startsWith(`${company}_`))
    .map((e) => ({
      name: e,
      mtime: fs.statSync(path.join(runsDir, e)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? path.join(runsDir, entries[0].name) : null;
}

/**
 * Check if a run directory has completed delivery (Phase 4).
 */
function hasDelivery(runDir: string): boolean {
  return fs.existsSync(path.join(runDir, 'delivery'));
}

/**
 * Publish DayZero reports for a completed workflow run.
 */
export async function publishDayZeroReports(
  groupFolder: string,
  prompt: string,
): Promise<void> {
  // Extract workflow context from the prompt
  const wfMatch = prompt.match(/Workflow Run ID:\s*([0-9a-f-]{36})/i);
  if (!wfMatch) {
    logger.debug('No Workflow Run ID in prompt, skipping publish');
    return;
  }
  const workflowRunId = wfMatch[1];

  const companyMatch = prompt.match(/for company:\s*(\S+)/i);
  const company = companyMatch ? companyMatch[1] : '';
  if (!company) {
    logger.warn({ workflowRunId }, 'Cannot publish — no company in prompt');
    return;
  }

  // Find the run directory
  const runDir = findRunDir(groupFolder, company);
  if (!runDir) {
    logger.warn(
      { workflowRunId, company },
      'Cannot publish — no run directory found',
    );
    return;
  }

  if (!hasDelivery(runDir)) {
    logger.warn(
      { workflowRunId, runDir },
      'Cannot publish — no delivery directory (assessment incomplete)',
    );
    return;
  }

  logger.info(
    { workflowRunId, runDir, company },
    'Publishing DayZero reports (host-side)',
  );

  const env = readEnvFile(['GEODESIC_ENDPOINT', 'GEODESIC_DATA_TENANT']);
  const endpoint = process.env.GEODESIC_ENDPOINT || env.GEODESIC_ENDPOINT;
  const tenantId =
    process.env.GEODESIC_DATA_TENANT || env.GEODESIC_DATA_TENANT;

  if (!endpoint || !tenantId) {
    logger.error(
      { workflowRunId },
      'Cannot publish — missing GEODESIC_ENDPOINT or GEODESIC_DATA_TENANT',
    );
    return;
  }

  try {
    // Install PyYAML if needed
    await run('pip install pyyaml 2>/dev/null || pip3 install pyyaml 2>/dev/null').catch(() => {});

    // Step 1: Build reports JSON
    const reportsJson = `/tmp/dayzero-reports-${workflowRunId.slice(0, 8)}.json`;
    const targetName = company.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    logger.info({ workflowRunId }, 'Building reports JSON');
    const buildOutput = await run(
      `python3 ${BUILD_REPORTS_SCRIPT} ` +
        `--run-dir "${runDir}" ` +
        `--workflow-run-id "${workflowRunId}" ` +
        `--tenant-id "${tenantId}" ` +
        `--target-name "${targetName}" ` +
        `--output "${reportsJson}"`,
    );
    logger.info({ workflowRunId, output: buildOutput.trim() }, 'Reports built');

    // Step 2: Get OAuth token
    logger.info({ workflowRunId }, 'Obtaining Geodesic OAuth token');
    const authToken = await getGeodesicToken();

    // Step 3: Publish
    logger.info({ workflowRunId }, 'Publishing reports to Geodesic');
    const publishOutput = await run(
      `python3 ${PUBLISH_SCRIPT} ` +
        `--run-dir "${runDir}" ` +
        `--workflow-run-id "${workflowRunId}" ` +
        `--workflow-id "day_zero_analysis" ` +
        `--tenant-id "${tenantId}" ` +
        `--reports-json "${reportsJson}"`,
      {
        GRAPHQL_ENDPOINT: endpoint,
        AUTH_TOKEN: authToken,
        TENANT_ID: tenantId,
      },
    );
    logger.info(
      { workflowRunId, output: publishOutput.trim() },
      'Reports published successfully',
    );

    // Cleanup temp file
    try {
      fs.unlinkSync(reportsJson);
    } catch {
      /* ignore */
    }
  } catch (err) {
    logger.error(
      { workflowRunId, err },
      'Failed to publish DayZero reports',
    );

    // Try to mark the workflow as failed so it doesn't sit as "running"
    try {
      const { sendWorkflowFailure } = await import('./ipc.js');
      await sendWorkflowFailure(
        workflowRunId,
        `Report publishing failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch (failErr) {
      logger.error({ failErr }, 'Failed to send workflow failure update');
    }
  }
}
