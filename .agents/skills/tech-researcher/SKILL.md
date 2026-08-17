---
name: tech-researcher
description: >
    Use this skill when the user wants to research technology choices, software dependencies,
    architectural patterns, integration strategies, or best practices before building something.
    Trigger when the user says things like "research X", "explore options for Y", "what tech should I use for Z",
    "help me decide between A and B", "investigate best practices for", "I need to figure out what to use for",
    or when starting a new project and needing to evaluate technology stacks. Also trigger when the user
    wants a structured decision with rationale, or asks about tradeoffs between tools/frameworks/services.
    Always use this skill at the start of implementation planning when technology choices are still open.
---

# Research & Exploration Skill

A structured skill for identifying technology choices, best practices, and architectural patterns before committing to implementation.

---

## Phase 0: Gather Constraints (ALWAYS DO THIS FIRST)

Before researching anything, ask the user for context. Do not skip this step — it shapes everything.

Ask these questions (combine into a single message, not one at a time):

**Required context:**

- What is the goal or problem being solved?
- Are there any technology constraints? (e.g., must use Python, must run on AWS, existing stack)
- What are the scale/performance requirements? (e.g., 100 users vs 10M users)
- What's the team's experience level with the domain?
- Are there budget or licensing constraints? (open source only, no paid APIs, etc.)
- What is the timeline? (prototype vs production-ready)

**Optional but valuable:**

- Existing infrastructure or integrations that must be preserved
- Security or compliance requirements (SOC2, HIPAA, GDPR, etc.)
- Any options already considered or ruled out?

Once you have enough to proceed, confirm the scope and move to Phase 1.

---

## Phase 2: Research Execution

For each research area identified, investigate using available tools (web search, docs, code examples).

### Research Areas

Structure your research around these categories as relevant:

#### 1. System & Software Technologies / Dependencies

- What are the leading tools/libraries/frameworks for this use case?
- What do official docs and community best practices recommend?
- What are version stability, maintenance status, and community size?
- What are known limitations or gotchas?

#### 2. Integrations & Architectural Patterns

- How do components connect? (APIs, event queues, SDKs, webhooks)
- What are the standard architectural patterns for this problem space?
- What are the tradeoffs between patterns? (e.g., monolith vs microservices, REST vs GraphQL)
- Are there reference architectures from major cloud providers or respected open-source projects?

#### 3. Best Practices

- What does the community consider idiomatic/standard?
- What anti-patterns should be avoided?
- Are there benchmarks or comparison studies?

---

## Phase 3: Structure Your Findings

For each major decision area, produce a structured analysis:

```
### [Decision Area]

**Decision**: [chosen option]
**Rationale**: [why this is the best fit given the constraints]
**Alternatives Considered**:
  - [Option B]: [why not chosen]
  - [Option C]: [why not chosen]
**Risks / Caveats**: [anything the team should watch out for]
**Next Steps**: [what to validate or prototype first]
```

---

## Phase 4: Produce the Research Summary

Deliver a complete Research & Exploration report with:

1. **Context Summary** — Restate the problem, constraints, and requirements (so anyone reading later has full context)
2. **Technology Decisions** — One structured block per major decision (see Phase 3 format)
3. **Integration Architecture** — How the chosen components fit together (include a simple diagram in ASCII or Mermaid if helpful)
4. **Open Questions** — Anything that couldn't be resolved and needs a spike/prototype
5. **Recommended Next Steps** — Ordered list of what to do first

---

## Behavior Guidelines

- **Don't recommend what you don't know** — if something is outside your training or rapidly evolving, say so and search for current info
- **Prefer specificity over hedging** — make a clear recommendation, don't just list options without guidance
- **Respect constraints** — never recommend something that violates a stated constraint, even if it's the "best" tool
- **Surface tradeoffs honestly** — if the best option has real downsides, say so
- **Scale your research to scope** — a quick prototype needs less research than a production system

---

## Output Format

Default to a structured Markdown document (suitable for saving as a `.md` file or pasting into Notion/Confluence). Use headers, tables for comparisons, and code blocks for config examples.

If the user wants a briefer output (e.g., "just give me a quick take"), condense to bullet points with a clear recommendation per area.
