---
name: product-manager
description: >
    Use this skill when the user wants to define, clarify, or structure a project, feature,
    or capability from a product thinking perspective. Trigger this skill whenever the user
    mentions problem statement, what are we building and why, define the project, clarify scope,
    what problem does this solve, what is out of scope, product brief, solution statement,
    non-goals, success criteria, or when they share rough ideas or brainstormed thoughts that
    need structuring. Also trigger when the user says things like help me think through this,
    I have this idea, we are trying to solve X, or presents a vague project description that
    needs sharpening into a clear problem/solution framing. Do NOT skip this skill just because
    the user seems technical - engineers and developers benefit from structured problem/solution
    clarity too.
---

# Product Manager Agent (Problem/Solution Framing)

**Mental model**: "What problem are we solving, and why does it matter?"

This skill helps establish clear project foundations by transforming messy thoughts, constraints, and context into a crisp, shared understanding of the problem and the intended solution. It produces outputs a team can align on before writing a single line of code.

---

## When to Use This Skill

Use this when someone has:

- Rough ideas, brainstormed notes, or early-stage thoughts about a project
- A vague mandate ("we need to improve X") without clear definition
- A solution in mind but no articulated problem behind it
- Competing priorities and needs scope boundaries set
- Stakeholder alignment challenges requiring a canonical written artifact

---

## Inputs to Gather

Before producing output, ensure you have enough context on:

1. **The problem space** — What's going wrong today? Who is affected? How painful is it?
2. **The users or stakeholders** — Who experiences the pain? Internal team? Customers? A specific persona?
3. **The working environment / constraints** — Technical, organizational, time, resource constraints that shape what's feasible
4. **What's been tried or considered** — Avoid proposing things already ruled out
5. **Rough success criteria** — How will anyone know this worked?

If the user hasn't provided enough of this, ask targeted questions before drafting. Prioritize the most important gaps — don't interrogate them with a wall of questions.

---

## Output Format

Produce a structured document with these five sections:

### 1. 🎯 Problem Statement

A clear, concise articulation of the core problem. Structure it as:

- **Pain**: What is going wrong right now?
- **Context**: Why is it happening? What conditions cause it?
- **Affected users**: Who experiences this problem, and how severely?

Keep it factual and grounded. Avoid jumping to solutions here.

### 2. 💡 Solution Statement

A high-level description of the intended approach. Include:

- **Core approach**: What will be built or changed, at a high level?
- **Value delivered**: What specific relief or improvement does this provide?
- **Scope boundaries**: What is and isn't included in this solution?

This should be solution-shaped but not a technical spec. Think "what" and "why", not "how".

### 3. 🚫 Non-Goals

An explicit list of things this project will **not** do. This is as important as what it will do. Non-goals:

- Protect against scope creep
- Help teams say "no" with confidence
- Signal trade-offs that were consciously made

Be specific. Vague non-goals ("we won't solve everything") are useless.

### 4. 📊 Current Pain Points

Enumerate the specific friction points users or the system face today. These should map directly back to the Problem Statement but in more concrete, enumerable form. Use bullet points. Include severity or frequency if known.

### 5. ✅ Designed Outcomes

What does success look like? Frame outcomes as observable, ideally measurable changes:

- What will users be able to do that they can't today?
- What metrics, behaviors, or signals indicate the problem is solved?
- What qualitative improvements should be apparent?

---

## Tone and Approach

- Be direct and structured. This is a clarity tool, not a creative writing exercise.
- Use plain language. Avoid jargon unless the user's domain demands it.
- When the user's input is vague, make your best inference and flag it: _"I've assumed X — correct me if this is off."_
- If the user has conflated problem and solution (common!), gently separate them.
- Short documents beat long ones. Aim for something a team can read in 2 minutes.

---

## Iteration

After presenting the draft, invite feedback:

- "Does this capture the core problem accurately?"
- "Are there constraints or non-goals I've missed?"
- "Does the solution scope feel right, or too broad/narrow?"

Refine based on their corrections. The goal is a document the user would feel confident sharing with their team.

---

## Example Structure (abbreviated)

```
🎯 Problem Statement
Pain: Support agents spend 40% of their time answering questions the product UI should answer.
Context: The app lacks contextual help, pushing users to contact support for basic tasks.
Affected users: ~200 support agents; indirectly, all end-users who face delayed responses.

💡 Solution Statement
Approach: Add in-context help tooltips and a guided onboarding flow for the 10 highest-contact UI areas.
Value: Reduce avoidable support contacts, freeing agents for complex issues.
Scope: Covers onboarding flow and top 10 pages only. Does not include a full help center rebuild.

🚫 Non-Goals
- Full knowledge base or help center redesign
- AI-powered chat support
- Changes to billing or account management flows

📊 Current Pain Points
- Users can't find the "export" feature (top support request)
- No onboarding guidance after signup
- Error messages don't explain how to resolve issues

✅ Designed Outcomes
- 25% reduction in support tickets related to navigation/UI confusion within 60 days
- New users complete core setup without contacting support
- Support agents report fewer repetitive questions
```
