---
agent: agent
tools:
    [
        vscode,
        execute,
        read,
        agent,
        browser,
        edit,
        search,
        web,
        'atlassian/*',
        'pulumi/*',
        'github/*',
        todo,
    ]
description: Implement one project task at a time for this Pulumi infrastructure repo
---

Implement exactly one task at a time in this `github-runners-eks` repository.

Optional task ID: ${input:taskId}
Optional task: ${input:task}

Execution rules:

- Prefer minimal, targeted changes.
- Do not expand scope beyond the current task.
- Preserve existing architecture and naming patterns unless the task requires otherwise.
- Treat changes in `src/` as infrastructure changes.
- Treat changes limited to `tests/` as non-infrastructure changes unless the task also changes infrastructure code or stack configuration.
- Test-only changes do not require `npm run deploy:dev`, but they may still require `npm run build` when the tests depend on compiled TypeScript surfaces or changed code artifacts.
- Do not add unit tests, mock-based tests, or Pulumi runtime mock coverage for this repository.
- When tests are needed, write integration or E2E tests that validate real deployed behavior, deployed stack outputs, or live stack initialization paths.
- Follow repository instructions in `AGENTS.md`.
- Use BTP Jira for task tracking. Do not use markdown task lists or ad hoc tracking.

Implementation standards:

- Kubernetes components should be children and dependent on the Pulumi component that represents the cluster itself, not the root stack component. This ensures proper dependency tracking and destroy order.
- TypeScript strict-mode friendly
- 4-space indentation
- Prefer explicit types over `any`
- Prefer async/await
- Prefer immutable patterns
- Keep files under 750 lines
- Follow existing Pulumi component patterns
- Use `pulumi.ComponentResource` for reusable components
- Always set `{ parent: this }` on child resources inside a component
- Use `registerOutputs()` appropriately
- Never create Pulumi resources inside `apply()`
- Pass Outputs directly as inputs and use `pulumi.interpolate` for string composition when needed
- Use aliases for safe refactors when renaming or moving resources
- Use secret-aware config handling and never hardcode credentials or tokens
- Add or update integration or E2E tests when applicable
- Never add unit tests or mock-based validation for infrastructure behavior
- Add clear JSDoc where infrastructure logic is introduced or changed
- Fill any missing implementation, validation, documentation, deploy, or review steps that a complete delivery pass would normally require

Required workflow:

1. Start with the repository task safety check — search BTP for existing work:
    ```
    mcp_atlassian_searchJiraIssuesUsingJql(
      cloudId = "b77ca6d7-0f1b-4c67-a606-6977b755ee45",
      jql = "project = BTP AND statusCategory != Done ORDER BY priority ASC, updated DESC",
      limit = 50
    )
    ```
2. Determine the single task to implement:
    - If `taskId` or `task` is provided, use that task.
    - Otherwise, select the next ready unblocked task from the Jira search results.
    - Skip tasks marked as `Epic` and skip tasks that are not implementable leaf tasks.
    - If a provided task resolves to an epic, do not start it. Report that it is not an implementable leaf task and stop.
    - Prefer the highest-priority ready task. If there is a tie, choose the first ready task returned.
    - If no ready task exists, or the selected task is unclear, blocked, or too large to complete safely in one pass, stop and report that clearly.
3. If `taskId` is available, read the task record with `mcp_atlassian_getJiraIssue` before editing.
4. Restate the single selected task and confirm the intended scope.
5. Inspect the relevant code before editing.
6. Make only the changes required for this task.
7. Add or update integration or E2E tests for the changed behaviour when applicable.
    - Do not add unit tests or mocked Pulumi tests.
    - Prefer tests that validate deployed resources, deployed stack outputs, or real environment behavior.
8. Update documentation when user-facing behaviour, architecture, configuration, or operations changed.
9. Run `npm run lint`.
10. Run `npm run format`.
11. If the task changed TypeScript or other repository code, run `npm run build`.
    - This can include test-only changes when the affected tests depend on compiled TypeScript surfaces or changed code artifacts.
12. If this was an infrastructure change, run `npm run deploy -- dev --scope compute`.
    - Do not run the deploy command for changes limited to `tests/`.
    - Ensure the deployment is successful and that no unintended changes were introduced.
13. If the deploy fails due to expired AWS credentials, run `./scripts/aws_login.sh dev` and retry the deploy once.
14. Run the most relevant integration-focused test commands for the changed area. At minimum, run `npm run test` when code or tests changed if that command exercises the integration coverage used by the repo.
15. Use `aws`, `eksctl`, and `kubectl` to debug infrastructure or runtime failures and fix issues.
16. Fix issues until the deploy and tests pass without unexpected failures.
17. If the task scope included documentation changes, verify that the documentation is clear and accurate.
18. Perform a final review against the definition of done and report a verdict: `PASS`, `PASS WITH NOTES`, or `NEEDS WORK`.
19. If task-tracking follow-up is warranted, provide suggested completion notes or blockers for the coordinating agent or user instead of mutating task state yourself.

When finished, provide:

- The task ID and title that were provided or selected
- A concise summary of what changed
- The files touched
- The validation commands that were run and their results
- Whether deploy or live debugging was required and whether it passed
- The final verdict: `PASS`, `PASS WITH NOTES`, or `NEEDS WORK`
- Any blockers or specific follow-up items, including whether the task appears ready for user to close

If no ready task exists, report that clearly and stop.

If the next ready tasks are epics or other non-leaf tasks only, report that no implementable leaf task is ready and stop.

If the selected task is unclear, blocked, or too large to complete safely in one pass, stop and ask for clarification before making changes.
