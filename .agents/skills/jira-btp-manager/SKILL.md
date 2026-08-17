---
name: jira-btp-manager
description: Manage Jira issues and project work for the Builder Tools and Platforms (BTP) Jira project using the Atlassian MCP or the official Atlassian CLI. Use this skill when a user asks to create Jira tickets, search issues in BTP, update existing issues, transition issue status, inspect editable fields, or generate JQL-driven issue reports specifically for BTP.
---

# Jira BTP Manager

Manage BTP Jira work with safe, repeatable workflows.

**Preferred execution method:** Use the Atlassian MCP tools (`mcp_atlassian_*`) as the primary approach — they are authenticated and reliable. Fall back to the `acli` CLI only when the MCP is unavailable.

## Operating Rules

- Default project key to `BTP` for all operations.
- Keep operations scoped to BTP unless the user explicitly asks for another project.
- For issue creation, populate only required fields by default.
- When creating or updating a Jira task, use the standard task description template with `## Context`, `## Scope`, `## Plan`, and `## Validation`.
- Add optional fields only when the user explicitly asks for them.
- Validate required fields before creating issues.
- Prefer explicit field keys (for example `customfield_13106`) when setting custom fields.
- Confirm available transitions before attempting to transition an issue.
- When active implementation begins, transition the issue from `To Do` to `In Progress`.
- When implementation work is complete, transition the issue to `In Review`.
- When transitioning to `In Review`, add a comment that includes:
    - validation steps performed
    - completion notes
    - implementation details
- Move an issue to `Done` only after explicit user verification/approval.
- Before moving to `Done`, update completion notes if new verified details are available and add a final `## Completion Notes` comment.
- If the local CLI command differs from examples, adapt syntax using `--help` while preserving this workflow.

## Atlassian MCP (Preferred)

The Atlassian MCP tools are the most reliable execution path. Known site details:

- **Cloud ID:** `b77ca6d7-0f1b-4c67-a606-6977b755ee45`
- **Site URL:** `https://modernatx.atlassian.net`
- **Project key:** `BTP`

Key MCP tools:

- `mcp_atlassian_createJiraIssue` — create an issue
- `mcp_atlassian_getJiraIssue` — read an issue
- `mcp_atlassian_editJiraIssue` — update fields
- `mcp_atlassian_transitionJiraIssue` — change status
- `mcp_atlassian_addCommentToJiraIssue` — add a comment
- `mcp_atlassian_searchJiraIssuesUsingJql` — JQL search
- `mcp_atlassian_getTransitionsForJiraIssue` — list available transitions

## CLI Detection (Fallback)

> **Note:** The `acli` CLI can return `unauthorized` errors even after a successful `acli jira auth login`. If this happens, switch to the Atlassian MCP tools instead.

Detect the Jira CLI binary before running commands.

```bash
if command -v acli >/dev/null 2>&1; then
  JIRA_CLI='acli jira'
elif command -v jira >/dev/null 2>&1; then
  JIRA_CLI='jira'
elif command -v atlassian >/dev/null 2>&1; then
  JIRA_CLI='atlassian jira'
else
  echo 'Jira CLI not found in PATH' >&2
fi
```

> **`acli` uses `workitem`, not `issue`, as the subcommand.** Use `$JIRA_CLI workitem --help` to confirm flags for the installed version. The flag `--type` sets the issue type and `-p` sets the project key.

## Core Workflows

### 1) Create Issue

1. Identify issue type and required fields from `references/btp-issue-fields.csv`.
2. For Jira tasks, use the standard task description template with `## Context`, `## Scope`, `## Plan`, and `## Validation`.
3. Build a payload with required fields only.
4. Add optional fields only if requested.
5. Create the issue with explicit project and issue type.

**MCP (preferred):**

```
mcp_atlassian_createJiraIssue(
  cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45",
  projectKey = "BTP",
  issueTypeName = "Story",
  summary = "Implement runner autoscaling alarm",
  description = "..."
)
```

**CLI fallback — required fields only:**

```bash
# acli uses 'workitem', not 'issue'; -p for project, -t for type, -s for summary
$JIRA_CLI workitem create \
  -p BTP \
  -t "Story" \
  -s "Implement runner autoscaling alarm"
```

**CLI fallback — with optional fields:**

```bash
$JIRA_CLI workitem create \
  -p BTP \
  -t "Story" \
  -s "Implement runner autoscaling alarm" \
  -d "Add CloudWatch alarms and notifications for runner fleet saturation" \
  -l "runners,observability"
```

### 2) Search Issues In BTP

Use JQL scoped to BTP and request only needed fields.

**MCP (preferred):**

```
mcp_atlassian_searchJiraIssuesUsingJql(
  cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45",
  jql = "project = BTP AND statusCategory != Done ORDER BY updated DESC",
  limit = 50
)
```

**CLI fallback:**

```bash
$JIRA_CLI workitem search \
  --jql 'project = BTP AND statusCategory != Done ORDER BY updated DESC' \
  --limit 50
```

Common JQL snippets:

- `project = BTP AND issuetype = Story`
- `project = BTP AND labels = platform`
- `project = BTP AND assignee = currentUser()`
- `project = BTP AND "TAGs" in (ops,infra)`

### 3) Update Issue

1. Read current issue first.
2. Update only requested Jira fields.
3. Re-read issue to verify changes.

**MCP (preferred):**

```
mcp_atlassian_getJiraIssue(cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45", issueKey = "BTP-123")

mcp_atlassian_editJiraIssue(
  cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45",
  issueKey = "BTP-123",
  summary = "Implement runner autoscaling alarms and dashboards"
)
```

**CLI fallback:**

```bash
$JIRA_CLI workitem view BTP-123

$JIRA_CLI workitem edit BTP-123 \
  --summary "Implement runner autoscaling alarms and dashboards"
```

### 4) Transition Issue

Always resolve valid transition names or IDs first.

**MCP (preferred):**

```
mcp_atlassian_getTransitionsForJiraIssue(cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45", issueKey = "BTP-123")

mcp_atlassian_transitionJiraIssue(
  cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45",
  issueKey = "BTP-123",
  transitionId = "<id from above>"
)
```

**CLI fallback:**

```bash
$JIRA_CLI workitem transition --help
$JIRA_CLI workitem transition BTP-123 --transition "In Progress"
```

If transition fails, fetch transitions again and retry with the exact name or ID returned by the CLI.

### 5) Work Lifecycle Management

Use this default lifecycle when the user asks to work on an issue:

1. Start work:
    - verify current status
    - transition Jira to `In Progress`
2. Complete implementation:
    - transition Jira to `In Review`
    - add a structured comment with validation and completion details
3. Finalize:
    - wait for explicit user confirmation that verification is complete
    - add a final `## Completion Notes` comment with verified outcomes and follow-up work
    - transition Jira to `Done`

`In Review` comment template:

```text
## Validation

Implementation details:
- <what was changed>
- <why this approach was used>

Validation steps performed:
1. <step>
2. <step>

## Completion Notes

- <known limitations or follow-ups>
- <deployment/rollback notes if relevant>
```

Verified completion comment template:

```text
## Completion Notes

- <known limitations or follow-ups>
- <verified outcome and evidence>
- <follow-up tasks or explicit statement that none remain>
```

- examples:
    - `BTP-0001-define-stack-contract.md`
    - `BTP-0007-install-arc-controller.md`

Local task lifecycle:

1. Create the task file in `tasks/todo/` from the template below.
2. When work starts, move task to `tasks/in-progress/` and update frontmatter to `status: in_progress`.
3. After local task update succeeds, transition Jira issue to `In Progress`.
4. Implement changes linked to the task.
5. Run validation gates and capture outputs in the task file.
6. Move task to `tasks/done/` when complete and set frontmatter `status: in_review`.
7. Add completion notes (and deployment evidence for infra tasks), then transition Jira issue to `In Review`.
8. After explicit user verification, update local frontmatter to `status: done`, refresh `## Completion Notes`, add the verified completion comment, then transition Jira issue to `Done`.

Jira-to-local status alignment:

- Jira `To Do` -> local file in `tasks/todo/` with `status: backlog`
- Jira `In Progress` -> local file in `tasks/in-progress/` with `status: in_progress`
- Jira `In Review` -> local file remains in `tasks/done/` with `status: in_review` until user verification
- Jira `Done` -> local file in `tasks/done/` with `status: done`

Local task template:

```md
---
id: TASK-0000
title: Replace with task title
status: backlog
definition_of_done:
    - Lint and format pass.
    - Build passes.
    - `npm run deploy:dev` succeeds when infrastructure changes are included.
    - Relevant docs updated.
---

## Context

Why this task exists.

## Scope

- What is included
- What is excluded

## Plan

1. Step one
2. Step two
3. Step three

## Validation

- [ ] `npm run lint`
- [ ] `npm run format`
- [ ] `npm run build`
- [ ] `npm run deploy:dev` (required for infrastructure changes before marking task done)
- [ ] If deploy fails with expired AWS STS credentials, run `./scripts/aws_login.sh dev`, complete auth, and retry deploy
- [ ] Integration tests are run. (Integration tests check aws resources are deployed, configured, and running as expected)

---

## Completion Notes

Record implementation details, outcomes, and any follow-up tasks.
```

## BTP Issue Type Reference

Use `references/btp-issue-fields.csv` as the source of truth for known issue types and field keys.

Known issue types:

- Initiative (`10114`)
- Feature / Capability (`10611`)
- Epic (`10000`)
- Story (`10001`)
- Task (`10002`)
- Spike (`10078`)

Minimum create-time fields for all listed types:

- `project`
- `issuetype`
- `summary`
- `reporter`

## Field Handling Guidelines

- `array<string>` fields: pass JSON arrays (`["a","b"]`).
- `userpicker` fields: pass account ID or CLI-supported user identifier.
- `multiuserpicker` fields: pass array of user identifiers.
- `select` fields: pass the option value/name recognized by Jira.
- `date` fields: use `YYYY-MM-DD`.
- `float` fields: pass numeric values (for example story points).

## Response Contract

When executing this skill for a user:

1. State operation intent (`create`, `search`, `update`, `transition`).
2. Show the exact command to run (or that was run).
3. Return concise results:
    - Create: new issue key and URL.
    - Search: table/list of keys, summaries, statuses.
    - Update: changed fields and post-update values.
    - Transition: previous status and new status.
4. Include any validation warnings (missing required fields, unknown field keys, invalid transitions).
5. For issue execution workflows, explicitly report lifecycle movement:
    - whether `In Progress` was set when work started
    - whether `In Review` was set when implementation finished
    - the comment content added for validation/completion notes
    - whether user verification was received before moving to `Done`
6. When local task tracking is used, also report:
    - task file path and current directory (`tasks/todo`, `tasks/in-progress`, `tasks/done`)
    - frontmatter status changes (`backlog`, `in_progress`, `in_review`, `done`)
    - validation gates executed and completion/deployment evidence recorded
7. For Jira write actions, explicitly confirm local task create/update was completed before the Jira write.
