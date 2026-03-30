/**
 * DayZero Channel for NanoClaw
 * =============================================================================
 * Exposes an HTTP API to trigger workflow runs (DayZero assessments, etc.).
 * Accepts POST /v1/run with a workflow_type and engagement mode,
 * routes the prompt to the appropriate agent group, and collects responses.
 *
 * Responses are accumulated per-run and retrievable via GET /v1/runs/:id.
 */

import crypto from 'crypto';
import http from 'http';

import fs from 'fs';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

// --- Constants ---

const DEFAULT_PORT = 9002;
const DAYZERO_JID = 'internal:dayzero';
const BASIN_JID = 'internal:basin';

// Map workflow_type → JID for routing
const WORKFLOW_JID_MAP: Record<string, string> = {
  dayzero: DAYZERO_JID,
  basin: BASIN_JID,
  curator: 'internal:curator',
};

// --- Interfaces ---

interface RunRecord {
  id: string;
  workflowType: string;
  company: string;
  engagementMode: string;
  status: 'running' | 'completed' | 'error';
  startedAt: string;
  messages: Array<{ text: string; timestamp: string }>;
  jid: string; // Which group JID this run routes to
  // Geodesic workflow integration
  workflowRunId?: string;
  tenantId?: string;
  workspaceId?: string;
}

interface DayZeroChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
}

// --- Channel Implementation ---

export class DayZeroChannel implements Channel {
  name = 'dayzero';

  private server: http.Server | null = null;
  private connected = false;
  private port: number;
  private opts: DayZeroChannelOpts;
  private apiKey: string | null;
  private repoPath: string | null;

  // Track active and completed runs
  private runs = new Map<string, RunRecord>();

  constructor(opts: DayZeroChannelOpts) {
    this.opts = opts;

    const envConfig = readEnvFile([
      'DAYZERO_PORT',
      'DAYZERO_API_KEY',
      'DAYZERO_WORKFLOWS_PATH',
    ]);
    this.port = parseInt(
      process.env.DAYZERO_PORT ||
        envConfig.DAYZERO_PORT ||
        String(DEFAULT_PORT),
      10,
    );
    this.apiKey =
      process.env.DAYZERO_API_KEY || envConfig.DAYZERO_API_KEY || null;
    this.repoPath =
      process.env.DAYZERO_WORKFLOWS_PATH ||
      envConfig.DAYZERO_WORKFLOWS_PATH ||
      null;

    if (!this.apiKey) {
      logger.warn(
        'DAYZERO_API_KEY not set. DayZero API will accept unauthenticated requests. ' +
          'Set DAYZERO_API_KEY for production use.',
      );
    }
  }

  async connect(): Promise<void> {
    // Auto-register workflow groups with repo mounts
    this.ensureGroupRegistered('dayzero', DAYZERO_JID, 'DayZero', 600000);
    this.ensureGroupRegistered('basin', BASIN_JID, 'Basin', 900000);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );

      this.server.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        } else {
          logger.error({ err }, 'DayZero HTTP server error');
        }
      });

      this.server.listen(this.port, () => {
        this.connected = true;
        logger.info({ port: this.port }, 'DayZero API listening');
        resolve();
      });
    });
  }

  private ensureGroupRegistered(
    folder: string,
    jid: string,
    name: string,
    timeout: number,
  ): void {
    const groups = this.opts.registeredGroups();
    if (groups[jid]) return;

    const group: RegisteredGroup = {
      name,
      folder,
      trigger: '',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    };

    // Mount the workflows directory (contains all Geodesic repos) read-only.
    // Each repo may contain its own workflow framework and data packages.
    // Run output goes to /workspace/group/runs/ which is already writable.
    if (this.repoPath && fs.existsSync(this.repoPath)) {
      group.containerConfig = {
        additionalMounts: [
          {
            hostPath: this.repoPath,
            containerPath: 'workflows',
            readonly: true,
          },
        ],
        timeout,
      };
      logger.info(
        { folder, repoPath: this.repoPath },
        `${name} workflows directory will be mounted at /workspace/extra/workflows (read-only)`,
      );
    } else if (jid === DAYZERO_JID) {
      // Only warn for DayZero — Basin inherits the same mount
      logger.warn(
        'DAYZERO_WORKFLOWS_PATH not set or path does not exist. ' +
          'Set DAYZERO_WORKFLOWS_PATH in .env to mount workflow repositories.',
      );
    }

    this.opts.registerGroup(jid, group);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Find the run that this message belongs to by matching the JID
    for (const [, run] of this.runs) {
      if (run.status === 'running' && run.jid === jid) {
        run.messages.push({
          text,
          timestamp: new Date().toISOString(),
        });
        logger.info(
          { runId: run.id.slice(0, 8), workflowType: run.workflowType, length: text.length },
          'Workflow agent response captured',
        );
        return;
      }
    }

    logger.warn({ jid }, 'Workflow agent response received but no active run for JID');
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return Object.values(WORKFLOW_JID_MAP).includes(jid);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // no-op
  }

  // --- HTTP Request Handler ---

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = req.url || '';
    const method = req.method || '';

    // Health check endpoint (no auth required)
    if (method === 'GET' && url === '/health') {
      this.handleHealth(res);
      return;
    }

    // Check authentication for protected endpoints
    if (this.apiKey && !this.isAuthenticated(req)) {
      logger.warn(
        { url, method, ip: req.socket.remoteAddress },
        'Unauthorized DayZero API request',
      );
      this.sendJson(res, 401, {
        error:
          'Unauthorized. Include X-Api-Key header or Authorization: Bearer <token>',
      });
      return;
    }

    if (method === 'POST' && url === '/v1/run') {
      this.readBody(req)
        .then((body) => this.handleRun(body, res))
        .catch((err) => {
          logger.error({ err }, 'Error handling DayZero run');
          this.sendJson(res, 500, { error: 'Internal server error' });
        });
      return;
    }

    // GET /v1/runs/:id
    const runMatch = url.match(/^\/v1\/runs\/([a-f0-9-]+)$/);
    if (method === 'GET' && runMatch) {
      this.handleGetRun(runMatch[1], res);
      return;
    }

    // POST /v1/runs/:id/complete — mark a run as completed
    const completeMatch = url.match(/^\/v1\/runs\/([a-f0-9-]+)\/complete$/);
    if (method === 'POST' && completeMatch) {
      this.handleCompleteRun(completeMatch[1], res);
      return;
    }

    if (method === 'GET' && url === '/v1/runs') {
      this.handleListRuns(res);
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  private handleHealth(res: http.ServerResponse): void {
    const activeRuns = [...this.runs.values()]
      .filter((r) => r.status === 'running')
      .map((r) => ({ id: r.id.slice(0, 8), workflow_type: r.workflowType }));

    this.sendJson(res, 200, {
      status: 'ok',
      active_runs: activeRuns.length,
      runs: activeRuns,
    });
  }

  private async handleRun(
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const workflowType = String(body.workflow_type || '');
    const company = String(body.company || '');
    const engagementMode = String(
      body.engagement_mode || body.engagementMode || 'turnaround_diagnostic',
    );
    const phase = body.phase ? String(body.phase) : undefined;

    // Geodesic workflow integration fields
    const workflowRunId = body.workflow_run_id
      ? String(body.workflow_run_id)
      : undefined;
    const tenantId = body.tenant_id ? String(body.tenant_id) : undefined;
    const workspaceId = body.workspace_id
      ? String(body.workspace_id)
      : undefined;

    if (!workflowType) {
      this.sendJson(res, 400, {
        error: 'Missing required field: workflow_type',
      });
      return;
    }

    if (!company) {
      this.sendJson(res, 400, {
        error: 'Missing required field: company',
      });
      return;
    }

    // Resolve the target group JID from workflow type
    const targetJid = WORKFLOW_JID_MAP[workflowType] || DAYZERO_JID;
    const targetFolder = workflowType === 'basin' ? 'basin'
      : workflowType === 'curator' ? 'curator'
      : 'dayzero';

    const runId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    logger.info(
      {
        runId: runId.slice(0, 8),
        workflowType,
        company,
        engagementMode,
        targetJid,
        workflowRunId,
        tenantId,
        workspaceId,
      },
      'Workflow run requested',
    );

    // Create run record
    const run: RunRecord = {
      id: runId,
      workflowType,
      company,
      engagementMode,
      status: 'running',
      startedAt: timestamp,
      messages: [],
      jid: targetJid,
      workflowRunId,
      tenantId,
      workspaceId,
    };
    this.runs.set(runId, run);

    // Build prompt for the agent based on workflow type
    const promptLines = this.buildPrompt(
      workflowType, company, engagementMode, runId, phase,
      workflowRunId, tenantId, workspaceId, body,
    );

    // Report metadata for group discovery
    this.opts.onChatMetadata(
      targetJid,
      timestamp,
      workflowType.charAt(0).toUpperCase() + workflowType.slice(1),
      targetFolder,
      true,
    );

    // Inject message into NanoClaw message flow
    this.opts.onMessage(targetJid, {
      id: runId,
      chat_jid: targetJid,
      sender: 'workflow-api',
      sender_name: `${workflowType} API`,
      content: promptLines.join('\n'),
      timestamp,
      is_from_me: false,
      is_bot_message: false,
    });

    this.sendJson(res, 200, {
      status: 'started',
      run_id: runId,
      workflow_type: workflowType,
      company,
      engagement_mode: engagementMode,
      poll_url: `/v1/runs/${runId}`,
    });
  }

  private handleGetRun(runId: string, res: http.ServerResponse): void {
    const run = this.runs.get(runId);
    if (!run) {
      this.sendJson(res, 404, { error: 'Run not found' });
      return;
    }

    const response: Record<string, unknown> = {
      id: run.id,
      workflow_type: run.workflowType,
      company: run.company,
      engagement_mode: run.engagementMode,
      status: run.status,
      started_at: run.startedAt,
      message_count: run.messages.length,
      messages: run.messages,
    };

    // Include workflow context if available
    if (run.workflowRunId) {
      response.workflow_run_id = run.workflowRunId;
    }
    if (run.tenantId) {
      response.tenant_id = run.tenantId;
    }
    if (run.workspaceId) {
      response.workspace_id = run.workspaceId;
    }

    this.sendJson(res, 200, response);
  }

  private handleCompleteRun(runId: string, res: http.ServerResponse): void {
    const run = this.runs.get(runId);
    if (!run) {
      this.sendJson(res, 404, { error: 'Run not found' });
      return;
    }

    run.status = 'completed';
    logger.info({ runId: runId.slice(0, 8) }, 'DayZero run marked complete');
    this.sendJson(res, 200, { status: 'completed', run_id: runId });
  }

  private handleListRuns(res: http.ServerResponse): void {
    const runs = [...this.runs.values()].map((r) => ({
      id: r.id,
      workflow_type: r.workflowType,
      company: r.company,
      engagement_mode: r.engagementMode,
      status: r.status,
      started_at: r.startedAt,
      message_count: r.messages.length,
    }));

    this.sendJson(res, 200, { runs });
  }

  // --- Helpers ---

  private buildPrompt(
    workflowType: string,
    company: string,
    engagementMode: string,
    runId: string,
    phase: string | undefined,
    workflowRunId: string | undefined,
    tenantId: string | undefined,
    workspaceId: string | undefined,
    body: Record<string, unknown>,
  ): string[] {
    const promptLines: string[] = [];

    if (workflowType === 'basin') {
      // Basin needs SDG path and DayZero run reference
      const sdgOutputPath = body.sdg_output_path
        ? String(body.sdg_output_path)
        : `/workspace/extra/workflows/Synthetic-Data-Generator/runs/${company}/output`;
      const dayzeroRunDir = body.dayzero_run_dir
        ? String(body.dayzero_run_dir)
        : undefined;
      const scenarios = body.scenarios
        ? (body.scenarios as string[])
        : undefined;

      promptLines.push(
        `Run a Basin simulation for company: ${company}`,
        '',
        `Run ID: ${runId}`,
        `Simulation repo: /workspace/extra/workflows/Simulation/`,
        `SDG output: ${sdgOutputPath}`,
      );
      if (dayzeroRunDir) {
        promptLines.push(`DayZero run output: /workspace/extra/workflows/DayZero/runs/${dayzeroRunDir}/`);
      }
      promptLines.push(`Output directory: /workspace/group/runs/${company}_${runId.slice(0, 8)}/`);
      if (scenarios && scenarios.length > 0) {
        promptLines.push('', `Scenarios to run: ${scenarios.join(', ')}`);
      }
    } else {
      // DayZero and other workflow types
      promptLines.push(
        `Run a ${workflowType} workflow (${engagementMode} mode) for company: ${company}`,
        '',
        `Run ID: ${runId}`,
        `Workflow repo: /workspace/extra/workflows/DayZero/`,
        `Data package: /workspace/extra/workflows/DayZero/data/${company}/`,
        `Output directory: /workspace/group/runs/${company}_${runId.slice(0, 8)}/`,
      );
      if (phase) {
        promptLines.push('', `Resume from phase: ${phase}`);
      }
    }

    // Include Geodesic workflow context if provided
    if (workflowRunId) {
      promptLines.push('', '--- Geodesic Workflow Integration ---');
      promptLines.push(`Workflow Run ID: ${workflowRunId}`);
      if (tenantId) {
        promptLines.push(`Tenant ID: ${tenantId}`);
      }
      if (workspaceId) {
        promptLines.push(`Workspace ID: ${workspaceId}`);
      }
      promptLines.push('', 'Update workflow progress via GraphQL mutation:');
      promptLines.push(
        'updateWorkflowRun(workflowRunId, status, progress, currentPhase, currentTask)',
      );
    }

    return promptLines;
  }

  private isAuthenticated(req: http.IncomingMessage): boolean {
    if (!this.apiKey) {
      return true; // No auth required if apiKey not set
    }

    // Check X-Api-Key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader && apiKeyHeader === this.apiKey) {
      return true;
    }

    // Check Authorization: Bearer <token> header
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1] === this.apiKey) {
        return true;
      }
    }

    return false;
  }

  private readBody(
    req: http.IncomingMessage,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          resolve(body);
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown,
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

// --- Channel Registration ---

registerChannel('dayzero', (opts: ChannelOpts) => {
  return new DayZeroChannel(opts);
});
