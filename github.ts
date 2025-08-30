import { promises as fs } from "fs";
import { join, resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import yaml from "yaml";
import { execa } from "execa";
import { 
  RepomirrorConfig,
  GithubActionsOptions,
  SetupGithubPrSyncOptions,
  DispatchSyncOptions 
} from "./types";

async function loadConfig(): Promise<RepomirrorConfig | null> {
  try {
    const configPath = join(process.cwd(), "repomirror.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepomirrorConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: RepomirrorConfig): Promise<void> {
  const configPath = join(process.cwd(), "repomirror.yaml");
  const configContent = yaml.stringify(config);
  await fs.writeFile(configPath, configContent, "utf-8");
}

export async function githubActions(options?: GithubActionsOptions): Promise<void> {
  console.log(chalk.cyan("Setting up GitHub Actions workflow for RepoMirror\n"));

  const config = await loadConfig();
  if (!config) {
    console.error(chalk.red("Error: repomirror.yaml not found"));
    console.log(chalk.yellow("Please run 'npx repomirror init' first"));
    process.exit(1);
  }

  const targetRepo = config.target_repo;
  const schedule = options?.schedule || "0 */6 * * *";
  const workflowName = options?.workflowName || "repomirror-sync.yml";
  const autoPush = options?.autoPush !== false;

  const workflowContent = `name: RepoMirror Sync

on:
  schedule:
    - cron: '${schedule}'
  workflow_dispatch: # Allow manual trigger
  push:
    branches: [ main ]
    paths:
      - '.repomirror/**'
      - 'repomirror.yaml'

jobs:
  sync:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout source repository
      uses: actions/checkout@v4
      with:
        path: source
    
    - name: Checkout target repository
      uses: actions/checkout@v4
      with:
        repository: ${targetRepo}
        token: \${{ secrets.GITHUB_TOKEN }}
        path: target
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install repomirror
      run: npm install -g repomirror
    
    - name: Setup Claude Code
      env:
        CLAUDE_API_KEY: \${{ secrets.CLAUDE_API_KEY }}
      run: |
        echo "Setting up Claude Code..."
        mkdir -p ~/.config/claude
        echo "api_key = \\"\$CLAUDE_API_KEY\\"" > ~/.config/claude/config
    
    - name: Run RepoMirror sync
      working-directory: source
      env:
        SKIP_CLAUDE_TEST: true
      run: npx repomirror sync
    
    ${autoPush ? `- name: Push changes to target
      working-directory: target
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        
        if [ -n "$(git status --porcelain)" ]; then
          git add -A
          git commit -m "Automated sync from source repository"
          git push
        else
          echo "No changes to push"
        fi` : ''}
`;

  const workflowsDir = join(process.cwd(), ".github", "workflows");
  await fs.mkdir(workflowsDir, { recursive: true });
  
  const workflowPath = join(workflowsDir, workflowName);
  await fs.writeFile(workflowPath, workflowContent, "utf-8");
  
  console.log(chalk.green(`✅ Created workflow file: .github/workflows/${workflowName}`));
  console.log(chalk.cyan("\nNext steps:"));
  console.log(chalk.white("1. Commit and push the workflow file"));
  console.log(chalk.white("2. Add CLAUDE_API_KEY secret to your GitHub repository"));
  console.log(chalk.white("3. The workflow will run automatically based on the schedule"));
}

export async function setupGithubPrSync(options?: SetupGithubPrSyncOptions): Promise<void> {
  console.log(
    chalk.cyan("I'll help you set up a github actions workflow that will run the sync-one command on every pr merge\n")
  );

  const config = await loadConfig();
  if (!config) {
    console.error(chalk.red("Error: repomirror.yaml not found"));
    console.log(chalk.yellow("Please run 'npx repomirror init' first"));
    process.exit(1);
  }

  const workflowPath = join(process.cwd(), ".github", "workflows", "repomirror.yml");
  
  if (!options?.overwrite) {
    try {
      await fs.access(workflowPath);
      console.log(chalk.yellow("Workflow file already exists at .github/workflows/repomirror.yml"));
      const { overwrite } = await inquirer.prompt([{
        type: "confirm",
        name: "overwrite",
        message: "Do you want to overwrite it?",
        default: false,
      }]);
      if (!overwrite) {
        console.log(chalk.yellow("Aborted"));
        return;
      }
    } catch {
      // File doesn't exist, continue
    }
  }

  const targetRepo = options?.targetRepo || config.target_remote || await (async () => {
    const { repo } = await inquirer.prompt([{
      type: "input",
      name: "repo",
      message: "Target repository (owner/repo format):",
      validate: (input) => /^[^/]+\/[^/]+$/.test(input) || "Please use owner/repo format",
    }]);
    return repo;
  })();

  const timesToLoop = options?.timesToLoop || config.times_to_loop || 3;

  const workflowContent = `name: RepoMirror PR Sync

on:
  workflow_dispatch: # Allow manual trigger
  push:
    branches: [ main ]
    paths:
      - '.repomirror/**'
      - 'repomirror.yaml'

jobs:
  sync:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout source repository
      uses: actions/checkout@v4
      with:
        path: source
    
    - name: Checkout target repository  
      uses: actions/checkout@v4
      with:
        repository: ${targetRepo}
        token: \${{ secrets.GITHUB_TOKEN }}
        path: target
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install repomirror
      run: npm install -g repomirror
    
    - name: Setup Claude Code
      env:
        ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      run: |
        echo "Setting up Claude Code..."
        mkdir -p ~/.config/claude
        echo "api_key = \\"\$ANTHROPIC_API_KEY\\"" > ~/.config/claude/config
    
    - name: Run RepoMirror sync loop
      working-directory: source
      env:
        SKIP_CLAUDE_TEST: true
      run: |
        for i in $(seq 1 ${timesToLoop}); do
          echo "=== Sync iteration \$i of ${timesToLoop} ==="
          npx repomirror sync-one --auto-push || echo "Sync iteration \$i failed, continuing..."
          if [ \$i -lt ${timesToLoop} ]; then
            echo "Sleeping 30 seconds before next iteration..."
            sleep 30
          fi
        done
    
    - name: Push final changes to target
      working-directory: target
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        
        if [ -n "$(git status --porcelain)" ]; then
          git add -A
          git commit -m "Automated PR sync from source repository [$(date)]"
          git push
        else
          echo "No changes to push"
        fi
`;

  const workflowsDir = join(process.cwd(), ".github", "workflows");
  await fs.mkdir(workflowsDir, { recursive: true });
  await fs.writeFile(workflowPath, workflowContent, "utf-8");

  // Save settings to config
  config.target_remote = targetRepo;
  config.times_to_loop = timesToLoop;
  await saveConfig(config);

  console.log(chalk.green("✅ Created workflow file: .github/workflows/repomirror.yml"));
  console.log(chalk.green("✅ Settings saved to repomirror.yaml"));
  console.log(chalk.cyan("\nNext steps:"));
  console.log(chalk.white("1. Commit and push the workflow file"));
  console.log(chalk.white("2. Add ANTHROPIC_API_KEY secret to your GitHub repository"));
  console.log(chalk.white("3. Add GITHUB_TOKEN secret with write access to target repo"));
  console.log(chalk.white("4. Use 'npx repomirror dispatch-sync' to manually trigger the workflow"));
}

export async function dispatchSync(options?: DispatchSyncOptions): Promise<void> {
  const workflowPath = join(process.cwd(), ".github", "workflows", "repomirror.yml");
  
  try {
    await fs.access(workflowPath);
  } catch {
    console.error(chalk.red("Error: .github/workflows/repomirror.yml not found"));
    console.log(chalk.yellow("Please run 'npx repomirror setup-github-pr-sync' first"));
    process.exit(1);
  }

  if (options?.quiet && !options?.yes) {
    console.error(chalk.red("Error: --quiet flag can only be used with --yes flag"));
    process.exit(1);
  }

  if (!options?.yes) {
    const { confirm } = await inquirer.prompt([{
      type: "confirm",
      name: "confirm",
      message: "Dispatch workflow_dispatch event to repomirror.yml?",
      default: true,
    }]);
    if (!confirm) {
      console.log(chalk.yellow("Aborted"));
      return;
    }
  }

  const spinner = options?.quiet ? null : ora("Dispatching workflow...").start();

  try {
    await execa("gh", ["workflow", "run", "repomirror.yml"], { cwd: process.cwd() });
    
    if (!options?.quiet) {
      spinner?.succeed("Workflow dispatched successfully");
      console.log(chalk.green("✅ Workflow dispatch triggered"));
      console.log(chalk.cyan("View the workflow run at:"));
      
      const { stdout: repoUrl } = await execa("gh", ["repo", "view", "--json", "url", "-q", ".url"]);
      console.log(chalk.white(`${repoUrl}/actions/workflows/repomirror.yml`));
    }
  } catch (error) {
    if (!options?.quiet) {
      spinner?.fail("Failed to dispatch workflow");
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.yellow("\nMake sure:"));
      console.log(chalk.yellow("1. GitHub CLI (gh) is installed"));
      console.log(chalk.yellow("2. You are authenticated with 'gh auth login'"));
      console.log(chalk.yellow("3. You have workflow dispatch permissions"));
    }
    process.exit(1);
  }
}