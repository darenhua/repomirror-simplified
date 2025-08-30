import { promises as fs } from "fs";
import path, { join, resolve, basename } from "path";
import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import yaml from "yaml";
import inquirer from "inquirer";
import { query } from "@anthropic-ai/claude-code";
import { 
  RepomirrorConfig, 
  InitOptions, 
  SyncOptions, 
  PushOptions, 
  PullOptions,
  RemoteConfig 
} from "./types";

async function loadConfig(sourceRepo?: string): Promise<RepomirrorConfig | null> {
  try {
    const baseDir = sourceRepo && sourceRepo !== "./" 
      ? resolve(process.cwd(), sourceRepo) 
      : process.cwd();
    const configPath = join(baseDir, "repomirror.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepomirrorConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: RepomirrorConfig, sourceRepo?: string): Promise<void> {
  const baseDir = sourceRepo && sourceRepo !== "./" 
    ? resolve(process.cwd(), sourceRepo) 
    : process.cwd();
  await fs.mkdir(baseDir, { recursive: true });
  const configPath = join(baseDir, "repomirror.yaml");
  const configContent = yaml.stringify(config);
  await fs.writeFile(configPath, configContent, "utf-8");
}

async function performPreflightChecks(targetRepo: string): Promise<void> {
  console.log(chalk.cyan("\n🔍 Performing preflight checks...\n"));

  console.log(chalk.white("1. Checking if target directory exists..."));
  const dirSpinner = ora(`   Accessing ${targetRepo}`).start();
  try {
    await fs.access(targetRepo);
    dirSpinner.succeed(`   Target directory ${chalk.green(targetRepo)} exists`);
  } catch {
    dirSpinner.fail(`   Target directory ${chalk.red(targetRepo)} does not exist`);
    process.exit(1);
  }

  console.log(chalk.white("2. Checking if target directory is a git repository..."));
  const gitSpinner = ora(`   Verifying git repository in ${targetRepo}`).start();
  try {
    const { stdout } = await execa("git", ["rev-parse", "--git-dir"], { cwd: targetRepo });
    const gitDir = stdout.trim();
    gitSpinner.succeed(`   Git repository found (git dir: ${chalk.green(gitDir)})`);
  } catch {
    gitSpinner.fail(`   Target directory ${chalk.red(targetRepo)} is not a git repository`);
    process.exit(1);
  }

  console.log(chalk.white("3. Checking git remotes configuration..."));
  const remoteSpinner = ora(`   Listing git remotes in ${targetRepo}`).start();
  try {
    const { stdout } = await execa("git", ["remote", "-v"], { cwd: targetRepo });
    if (!stdout.trim()) {
      remoteSpinner.fail(`   Target directory ${chalk.red(targetRepo)} has no git remotes configured`);
      process.exit(1);
    }
    const remotes = stdout.trim().split("\n");
    const remoteNames = [...new Set(remotes.map((line) => line.split("\t")[0]))];
    remoteSpinner.succeed(`   Found ${chalk.green(remoteNames.length)} git remote(s): ${chalk.green(remoteNames.join(", "))}`);
  } catch {
    remoteSpinner.fail(`   Failed to check git remotes in ${chalk.red(targetRepo)}`);
    process.exit(1);
  }

  if (process.env.SKIP_CLAUDE_TEST !== "true") {
    console.log(chalk.white("4. Testing Claude Code configuration..."));
    const claudeSpinner = ora("   Running Claude Code test command").start();
    try {
      const { stdout } = await execa("claude", ["-p", "say hi more than 10 chars"], {
        timeout: 30000,
        input: "",
      });
      if (!stdout || stdout.trim().length < 10) {
        claudeSpinner.fail("   Claude Code test failed - response was empty or too short");
        process.exit(1);
      }
      claudeSpinner.succeed("   Claude Code is working correctly");
    } catch {
      claudeSpinner.fail("   Claude Code is not properly configured");
      console.log(chalk.red("   Please run `claude` to set up your profile"));
      process.exit(1);
    }
  }

  console.log(chalk.green("\n✅ All preflight checks passed!\n"));
}

async function generateTransformationPrompt(
  sourceRepo: string,
  targetRepo: string,
  transformationInstructions: string,
): Promise<string> {
  if (process.env.SKIP_CLAUDE_TEST === "true") {
    return `Your job is to port ${sourceRepo} to ${targetRepo} and maintain the repository.

You have access to the current ${sourceRepo} repository as well as the ${targetRepo} repository.

Make a commit and push your changes after every single file edit.

Use the ${targetRepo}/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

${transformationInstructions}`;
  }

  const metaPrompt = `Generate an optimized prompt for repo transformation. Include instructions about:
- Porting from ${sourceRepo} to ${targetRepo}
- Transformation requirements: ${transformationInstructions}
- Using agent/ directory for planning
- Making commits after each file edit
- Maintaining the repository`;

  const result = await query({ prompt: metaPrompt });
  return result as string;
}

async function createRepoMirrorFiles(
  sourceRepo: string,
  targetRepo: string,
  prompt: string,
): Promise<void> {
  const repomirrorDir = join(resolve(sourceRepo), ".repomirror");
  await fs.mkdir(repomirrorDir, { recursive: true });

  await fs.writeFile(join(repomirrorDir, "prompt.md"), prompt, "utf-8");

  const syncScript = `#!/usr/bin/env bash
cd "${resolve(targetRepo)}"
claude -p "$(cat ${join(repomirrorDir, "prompt.md")})"`;
  await fs.writeFile(join(repomirrorDir, "sync.sh"), syncScript, "utf-8");
  await fs.chmod(join(repomirrorDir, "sync.sh"), 0o755);

  const ralphScript = `#!/usr/bin/env bash
while true; do
  cd "${resolve(targetRepo)}"
  claude -p "$(cat ${join(repomirrorDir, "prompt.md")})"
  echo "Claude session ended. Restarting in 3 seconds..."
  sleep 3
done`;
  await fs.writeFile(join(repomirrorDir, "ralph.sh"), ralphScript, "utf-8");
  await fs.chmod(join(repomirrorDir, "ralph.sh"), 0o755);

  await fs.writeFile(join(repomirrorDir, ".gitignore"), "*.log\ntmp/\n", "utf-8");
}

export async function init(options?: InitOptions): Promise<void> {
  console.log(chalk.cyan("I'll help you maintain a transformed copy of this repo:\n"));

  const sourceRepoPath = options?.sourceRepo || "./";
  const existingConfig = await loadConfig(sourceRepoPath);
  if (existingConfig) {
    console.log(chalk.yellow("Found existing repomirror.yaml, using as defaults\n"));
  }

  const currentDir = process.cwd();
  const repoName = basename(currentDir);
  const defaultTarget = existingConfig?.target_repo || `../${repoName}-transformed`;

  const defaults = {
    sourceRepo: options?.sourceRepo || existingConfig?.source_repo || "./",
    targetRepo: options?.targetRepo || existingConfig?.target_repo || defaultTarget,
    transformationInstructions: 
      options?.transformationInstructions ||
      existingConfig?.transformation_instructions ||
      "translate this python repo to typescript",
  };

  const answers = await inquirer.prompt<InitOptions>([
    {
      type: "input",
      name: "sourceRepo",
      message: "Source Repo you want to transform:",
      default: defaults.sourceRepo,
      when: !options?.sourceRepo,
    },
    {
      type: "input",
      name: "targetRepo",
      message: "Where do you want to transform code to:",
      default: defaults.targetRepo,
      when: !options?.targetRepo,
    },
    {
      type: "input",
      name: "transformationInstructions",
      message: "What changes do you want to make:",
      default: defaults.transformationInstructions,
      when: !options?.transformationInstructions,
    },
  ]);

  const finalConfig: RepomirrorConfig = {
    source_repo: options?.sourceRepo || answers.sourceRepo || defaults.sourceRepo,
    target_repo: options?.targetRepo || answers.targetRepo || defaults.targetRepo,
    transformation_instructions:
      options?.transformationInstructions || answers.transformationInstructions || defaults.transformationInstructions,
    config_version: "0.1.0",
  };

  await saveConfig(finalConfig, finalConfig.source_repo);
  console.log(chalk.green("\n✅ Saved configuration to repomirror.yaml"));

  await performPreflightChecks(finalConfig.target_repo);

  console.log(chalk.cyan("\nGenerating transformation prompt..."));
  try {
    const optimizedPrompt = await generateTransformationPrompt(
      finalConfig.source_repo,
      finalConfig.target_repo,
      finalConfig.transformation_instructions,
    );

    console.log(chalk.green("✔ Generated transformation prompt"));

    await createRepoMirrorFiles(
      finalConfig.source_repo,
      finalConfig.target_repo,
      optimizedPrompt,
    );

    console.log(chalk.green("\n✅ repomirror initialized successfully!"));
    console.log(chalk.cyan("\nNext steps:"));
    console.log(chalk.white("run `npx repomirror sync` - this will run the sync.sh script once"));
    console.log("");
    console.log(chalk.white("run `npx repomirror sync-forever` - this will run the ralph.sh script, working forever to implement all the changes"));
  } catch (error) {
    console.log(chalk.red("✖ Failed to generate transformation prompt"));
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function sync(options?: SyncOptions): Promise<void> {
  const syncScript = join(process.cwd(), ".repomirror", "sync.sh");

  try {
    await fs.access(syncScript);
  } catch {
    console.error(chalk.red("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first."));
    process.exit(1);
  }

  console.log(chalk.cyan("Running sync.sh..."));

  const subprocess = execa("bash", [syncScript], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const signalHandler = () => {
    console.log(chalk.yellow("\nStopping sync..."));
    subprocess.kill("SIGINT");
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    await subprocess;
    console.log(chalk.green("Sync completed successfully"));

    if (options?.autoPush) {
      const config = await loadConfig();
      if (config) {
        await push({ all: true });
      }
    }
  } catch (error) {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    
    if (error instanceof Error && (error as any).signal === "SIGINT") {
      console.log(chalk.yellow("\nSync stopped by user"));
      process.exit(0);
    }
    
    console.error(chalk.red(`Sync failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  } finally {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
  }
}

export async function syncForever(options?: SyncOptions): Promise<void> {
  const ralphScript = join(process.cwd(), ".repomirror", "ralph.sh");

  try {
    await fs.access(ralphScript);
  } catch {
    console.error(chalk.red("Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first."));
    process.exit(1);
  }

  console.log(chalk.cyan("Running ralph.sh (continuous sync)..."));
  console.log(chalk.yellow("Press Ctrl+C to stop"));

  const subprocess = execa("bash", [ralphScript], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const signalHandler = () => {
    console.log(chalk.yellow("\nStopping continuous sync..."));
    subprocess.kill("SIGINT");
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    await subprocess;
  } catch (error) {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    
    if (error instanceof Error && (error as any).signal === "SIGINT") {
      console.log(chalk.yellow("\nContinuous sync stopped by user"));
      process.exit(0);
    }
    
    console.error(chalk.red(`Continuous sync failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  } finally {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
  }
}

export async function remote(action: string, ...args: string[]): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error(chalk.red("Error: repomirror.yaml not found. Run 'npx repomirror init' first."));
    process.exit(1);
  }

  switch (action) {
    case "add": {
      const [name, url, branch = "main"] = args;
      if (!name || !url) {
        console.error(chalk.red("Usage: repomirror remote add <name> <url> [branch]"));
        process.exit(1);
      }
      
      if (!config.remotes) {
        config.remotes = [];
      }
      
      const existingIndex = config.remotes.findIndex(r => r.name === name);
      if (existingIndex >= 0) {
        config.remotes[existingIndex] = { name, url, branch };
        console.log(chalk.green(`✅ Updated remote '${name}'`));
      } else {
        config.remotes.push({ name, url, branch });
        console.log(chalk.green(`✅ Added remote '${name}'`));
      }
      
      await saveConfig(config);
      break;
    }
    
    case "list": {
      if (!config.remotes || config.remotes.length === 0) {
        console.log(chalk.yellow("No remotes configured"));
      } else {
        console.log(chalk.cyan("Configured remotes:"));
        config.remotes.forEach(remote => {
          console.log(`  ${remote.name}: ${remote.url} (${remote.branch})`);
        });
      }
      break;
    }
    
    case "remove": {
      const [name] = args;
      if (!name) {
        console.error(chalk.red("Usage: repomirror remote remove <name>"));
        process.exit(1);
      }
      
      if (!config.remotes) {
        console.log(chalk.yellow(`Remote '${name}' not found`));
        return;
      }
      
      const index = config.remotes.findIndex(r => r.name === name);
      if (index >= 0) {
        config.remotes.splice(index, 1);
        console.log(chalk.green(`✅ Removed remote '${name}'`));
        await saveConfig(config);
      } else {
        console.log(chalk.yellow(`Remote '${name}' not found`));
      }
      break;
    }
    
    default:
      console.error(chalk.red(`Unknown action: ${action}`));
      console.log("Available actions: add, list, remove");
      process.exit(1);
  }
}

export async function push(options?: PushOptions): Promise<void> {
  const config = await loadConfig();
  if (!config || !config.remotes || config.remotes.length === 0) {
    console.error(chalk.red("Error: No remotes configured. Use 'repomirror remote add' to add a remote."));
    process.exit(1);
  }

  const targetRepo = config.target_repo;
  
  if (options?.all) {
    console.log(chalk.cyan("Pushing to all configured remotes..."));
    for (const remote of config.remotes) {
      try {
        console.log(chalk.gray(`Pushing to ${remote.name} (${remote.branch})...`));
        if (!options.dryRun) {
          await execa("git", ["push", remote.url, `HEAD:${remote.branch}`], { cwd: targetRepo });
        }
        console.log(chalk.green(`✅ Pushed to ${remote.name}`));
      } catch (error) {
        console.error(chalk.red(`Failed to push to ${remote.name}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  } else {
    const remoteName = options?.remote || config.default_remote || "origin";
    const remote = config.remotes.find(r => r.name === remoteName);
    
    if (!remote) {
      console.error(chalk.red(`Error: Remote '${remoteName}' not found`));
      process.exit(1);
    }
    
    const branch = options?.branch || remote.branch;
    console.log(chalk.cyan(`Pushing to ${remoteName} (${branch})...`));
    
    if (!options?.dryRun) {
      try {
        await execa("git", ["push", remote.url, `HEAD:${branch}`], { cwd: targetRepo });
        console.log(chalk.green(`✅ Pushed to ${remoteName}`));
      } catch (error) {
        console.error(chalk.red(`Failed to push: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow(`[DRY RUN] Would push to ${remote.url} (${branch})`));
    }
  }
}

export async function pull(options?: PullOptions): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error(chalk.red("Error: repomirror.yaml not found. Run 'npx repomirror init' first."));
    process.exit(1);
  }

  const sourceRepo = config.source_repo;
  
  if (options?.check) {
    console.log(chalk.cyan("Checking for source changes..."));
    try {
      await execa("git", ["fetch"], { cwd: sourceRepo });
      const { stdout } = await execa("git", ["status", "-uno"], { cwd: sourceRepo });
      console.log(stdout);
    } catch (error) {
      console.error(chalk.red(`Failed to check: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
    return;
  }

  console.log(chalk.cyan("Pulling source changes..."));
  try {
    await execa("git", ["pull"], { cwd: sourceRepo, stdio: "inherit" });
    console.log(chalk.green("✅ Source updated"));
    
    if (!options?.sourceOnly) {
      if (options?.syncAfter) {
        await syncForever();
      } else if (config.auto_sync) {
        await sync();
      }
    }
  } catch (error) {
    console.error(chalk.red(`Failed to pull: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}