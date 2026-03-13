import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE } from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { readEnvFile } from './env.js';
import {
  GeodesicWorkflowHelper,
  WorkflowUpdateOptions,
} from './geodesic-workflow-helper.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

// --- Geodesic OAuth token cache ---
let cachedGeodesicToken: string | null = null;
let geodesicTokenExpiresAt = 0;

async function getGeodesicToken(): Promise<string | null> {
  if (cachedGeodesicToken && Date.now() < geodesicTokenExpiresAt) {
    return cachedGeodesicToken;
  }

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
  const scope = process.env.GEODESIC_AUTH_SCOPE || env.GEODESIC_AUTH_SCOPE;

  if (!tid || !clientId || !clientSecret || !scope) {
    logger.warn('Missing GEODESIC_AUTH_* credentials for workflow updates');
    return null;
  }

  const tokenUrl = `https://${tid}.ciamlogin.com/${tid}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: scope + '/.default',
  });

  try {
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!resp.ok) {
      logger.error(
        { status: resp.status },
        'Failed to obtain Geodesic OAuth token',
      );
      return null;
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
    };
    cachedGeodesicToken = data.access_token;
    // Refresh 60s before expiry
    geodesicTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedGeodesicToken;
  } catch (err) {
    logger.error({ err }, 'Exception obtaining Geodesic OAuth token');
    return null;
  }
}

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→isMain lookup from registered groups
    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For update_workflow
    workflowRunId?: string;
    status?: string;
    progress?: number;
    currentPhase?: string;
    currentTask?: string;
    errorMessage?: string;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroups(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        // Defense in depth: agent cannot set isMain via IPC
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'update_workflow': {
      const wfRunId = data.workflowRunId as string | undefined;
      if (!wfRunId) {
        logger.warn('update_workflow missing workflowRunId');
        break;
      }

      const token = await getGeodesicToken();
      if (!token) {
        logger.warn('Cannot update workflow — no Geodesic token');
        break;
      }

      const env = readEnvFile(['GEODESIC_ENDPOINT', 'GEODESIC_DATA_TENANT']);
      const endpoint = process.env.GEODESIC_ENDPOINT || env.GEODESIC_ENDPOINT;
      const tenantId =
        process.env.GEODESIC_DATA_TENANT || env.GEODESIC_DATA_TENANT;

      if (!endpoint || !tenantId) {
        logger.warn(
          'Cannot update workflow — missing GEODESIC_ENDPOINT or GEODESIC_DATA_TENANT',
        );
        break;
      }

      const helper = new GeodesicWorkflowHelper({
        endpoint,
        token,
        tenantId,
      });

      const updates: WorkflowUpdateOptions = {};
      if (data.status)
        updates.status = data.status as WorkflowUpdateOptions['status'];
      if (data.progress != null) updates.progress = data.progress as number;
      if (data.currentPhase) updates.currentPhase = data.currentPhase as string;
      if (data.currentTask) updates.currentTask = data.currentTask as string;
      if (data.errorMessage) updates.errorMessage = data.errorMessage as string;

      const success = await helper.updateWorkflowRun(wfRunId, updates);
      logger.info(
        { workflowRunId: wfRunId, success, sourceGroup },
        'Workflow update processed via IPC',
      );
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

/**
 * Send a workflow failure update to Geodesic when a container dies unexpectedly.
 * Called from the main process when a container exits with a non-zero code
 * and the prompt contained a Workflow Run ID.
 */
export async function sendWorkflowFailure(
  workflowRunId: string,
  errorMessage: string,
): Promise<void> {
  const token = await getGeodesicToken();
  if (!token) {
    logger.warn(
      { workflowRunId },
      'Cannot send workflow failure — no Geodesic token',
    );
    return;
  }

  const env = readEnvFile(['GEODESIC_ENDPOINT', 'GEODESIC_DATA_TENANT']);
  const endpoint = process.env.GEODESIC_ENDPOINT || env.GEODESIC_ENDPOINT;
  const tenantId =
    process.env.GEODESIC_DATA_TENANT || env.GEODESIC_DATA_TENANT;

  if (!endpoint || !tenantId) {
    logger.warn(
      { workflowRunId },
      'Cannot send workflow failure — missing GEODESIC_ENDPOINT or GEODESIC_DATA_TENANT',
    );
    return;
  }

  const helper = new GeodesicWorkflowHelper({ endpoint, token, tenantId });
  const success = await helper.markFailed(workflowRunId, errorMessage);
  logger.info(
    { workflowRunId, success },
    'Workflow failure update sent after container crash',
  );
}
