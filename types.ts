export interface RepomirrorConfig {
  source_repo: string;
  target_repo: string;
  transformation_instructions: string;
  config_version: string;
  default_remote?: string;
  auto_sync?: boolean;
  remotes?: RemoteConfig[];
  target_remote?: string;
  times_to_loop?: number;
}

export interface RemoteConfig {
  name: string;
  url: string;
  branch: string;
}

export interface InitOptions {
  sourceRepo?: string;
  targetRepo?: string;
  transformationInstructions?: string;
}

export interface SyncOptions {
  autoPush?: boolean;
}

export interface PushOptions {
  remote?: string;
  branch?: string;
  all?: boolean;
  dryRun?: boolean;
}

export interface PullOptions {
  sourceOnly?: boolean;
  syncAfter?: boolean;
  check?: boolean;
}

export interface GithubActionsOptions {
  workflowName?: string;
  schedule?: string;
  autoPush?: boolean;
}

export interface SetupGithubPrSyncOptions {
  targetRepo?: string;
  timesToLoop?: number;
  overwrite?: boolean;
}

export interface DispatchSyncOptions {
  yes?: boolean;
  quiet?: boolean;
}