---
name: security-auditor
description: >
    Use this skill when the user wants to run a security audit on npm dependencies, triage
    vulnerabilities, assess exploitability, and plan remediation. Trigger when the user says
    things like "run npm audit", "check for vulnerabilities", "security scan", "are there
    security issues", "CVE check", or when running periodic maintenance security checks.
    Also trigger when a specific vulnerability or advisory needs to be evaluated for impact
    on this project.
---

# Security Auditor Skill

A structured skill for running npm security audits, triaging vulnerabilities by exploitability and remediation effort, and producing actionable change assessments.

---

## Phase 1: Run the Audit

Execute the npm audit command to collect raw vulnerability data:

```bash
npm audit --json 2>/dev/null
```

Also run a dry-run fix to see what can be auto-resolved:

```bash
npm audit fix --dry-run --json 2>/dev/null
```

Parse the output into findings matching the **security-audit-report** schema (`.agents/schemas/security-audit-report.schema.json`).

### Key Data to Extract

For each vulnerability:

- **Package name** and **vulnerable version range**
- **Severity**: info, low, moderate, high, critical
- **Advisory URL** (GitHub Advisory Database link)
- **Patched versions** (if a fix exists)
- **Dependency path** (direct vs transitive — is this in `dependencies` or buried in a sub-dependency?)
- **CWE identifiers** and **CVSS score** (if available)

---

## Phase 2: Triage Each Vulnerability

For each finding, assess three dimensions:

### 2a. Is the Vulnerable Code Path Actually Used?

Not every vulnerability in a dependency is exploitable in this project. Evaluate:

1. **Direct dependency?** If the vulnerable package is a direct dependency in `package.json`, it's more likely to be in the code path.
2. **Transitive dependency?** Trace the dependency chain. A vulnerability in a deeply nested test-only transitive dep is lower priority.
3. **Is the vulnerable API used?** Search the codebase for imports or usage of the affected module. If the vulnerable function/method is never called, the practical risk is lower.
4. **Runtime vs build-time?** Vulnerabilities in build tools (TypeScript, ESLint, Jest) are generally lower risk than runtime dependencies deployed to infrastructure.
5. **Network exposure?** This is a Pulumi IaC project running in a devcontainer/CI — it's not a web server. Vulnerabilities requiring network-accessible attack vectors (e.g., XSS, request smuggling) are less relevant unless they affect the EKS workloads.

### 2b. Is a Fix Available?

- **Auto-fixable**: `npm audit fix` can resolve it without breaking changes
- **Manual fix available**: A patched version exists but requires a major version bump or dependency swap
- **No fix available**: The upstream hasn't patched it yet — mitigation or workaround needed
- **Won't fix**: The maintainer has declined to fix — consider whether to replace the dependency

### 2c. Exploitability in Context

Consider the OWASP risk rating factors:

- **Attack vector**: Network, local, physical? (Most IaC vulns are local)
- **Attack complexity**: How hard is it to exploit?
- **Privileges required**: Does the attacker need access to the devcontainer or AWS credentials?
- **User interaction**: Is user action required?

---

## Phase 3: Score Risk and Complexity

### Risk Score (0-4) — Maps from npm audit severity with context adjustment

| npm Severity | Default Risk | Adjustments                                       |
| ------------ | ------------ | ------------------------------------------------- |
| critical     | 0            | +1 if transitive-only AND not in runtime path     |
| high         | 1            | +1 if dev-only dependency, +1 if no known exploit |
| moderate     | 2            | +1 if transitive-only                             |
| low          | 3            | —                                                 |
| info         | 4            | —                                                 |

**Floor**: Never raise risk above 4 or below 0.

### Complexity Score (0-4)

| Score | Criteria                                               | Examples                                                  |
| ----- | ------------------------------------------------------ | --------------------------------------------------------- |
| 0     | Trivial — `npm audit fix` resolves it                  | Auto-fixable patch-level update                           |
| 1     | Small — manual version bump, no code changes           | Update a direct dep to its patched version                |
| 2     | Moderate — code changes needed, testing required       | Major version bump with API changes to fix the vuln       |
| 3     | Large — dependency replacement or significant refactor | Replace a vulnerable package with an alternative          |
| 4     | Epic — architectural change needed                     | Fundamental dependency is compromised, requires migration |

### Auto-Actionable Criteria

Set `auto_actionable: true` when ALL of these are true:

- `npm audit fix --dry-run` shows it can be resolved automatically
- No breaking changes introduced by the fix
- The fix only updates patch or minor versions
- No manual code changes required

---

## Phase 4: Produce Output

Generate change assessments matching the **change-assessment** schema (`.agents/schemas/change-assessment.schema.json`).

### Grouping Strategy

- **Group all auto-fixable vulnerabilities** into a single "Security: auto-fix batch" assessment
- **Keep critical/high severity issues separate** — one assessment per vulnerability
- **Group low/info findings** into a single "Security: low-priority findings" assessment

### Output Format

Present findings in two sections:

#### Summary Table

| Package | Severity | Title | Fix Available | Risk | Complexity | Auto-Fix? |
| ------- | -------- | ----- | ------------- | ---- | ---------- | --------- |
| ...     | ...      | ...   | ...           | ...  | ...        | ...       |

#### Detailed Assessments

For each assessment, output valid JSON matching the change-assessment schema:

```json
{
    "category": "security-audit",
    "title": "Security: <vulnerability title>",
    "description": "...",
    "risk": 1,
    "complexity": 0,
    "current_state": {
        "package": "...",
        "vulnerable_version": "...",
        "severity": "high",
        "advisory_url": "..."
    },
    "recommended_action": "Run `npm audit fix` to update to patched version X.Y.Z",
    "affected_files": ["package.json", "package-lock.json"],
    "breaking_changes": false,
    "source_urls": ["https://github.com/advisories/..."],
    "auto_actionable": true
}
```

---

## Remediation Workflow

When the maintainer agent acts on security findings:

### For Auto-Fixable Issues

1. Run `npm audit fix`
2. Run `npm run build` to verify nothing broke
3. Run `npm run test` to validate
4. Create a branch and PR with the fixes

### For Manual Fixes

1. Update the specific package version in `package.json`
2. Run `npm install` to regenerate lockfile
3. Search codebase for any API changes needed
4. Run full quality gates: `npm run lint && npm run format && npm run build && npm run test`
5. Create a branch and PR with the fixes

### For No-Fix-Available

1. Document the vulnerability and its non-exploitability in this context (if applicable)
2. Add to a tracking issue for periodic re-check
3. Consider dependency alternatives if the vulnerability is critical

---

## Behavior Guidelines

- **Never ignore critical or high severity in direct dependencies** — always surface these prominently
- **Context matters more than severity score** — a "critical" XSS in a CLI tool used only at build time is less urgent than a "high" in a runtime dependency
- **Check if the advisory is disputed or withdrawn** — sometimes advisories are retracted
- **Consider the full dependency chain** — fixing a transitive vuln may require updating the parent package
- **Don't create noise** — if all findings are low/info with no practical impact, say so clearly and recommend monitoring rather than action
- **Track what can't be fixed now** — unpatched vulnerabilities should be noted for follow-up
