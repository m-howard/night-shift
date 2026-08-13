## What and why

<!-- What changes, and what problem it solves. The diff shows what; explain why. -->

## Test plan

<!-- How a reviewer verifies this. Commands they can run, and what they should see. -->

```bash
bun run lint && bun run lint:md
bun run typecheck
bun run test:coverage
```

## Checklist

- [ ] Behaviour changes are covered by tests — unit in `tests/unit/`, live-AWS in
      `tests/integration/`
- [ ] New configuration follows the fail-closed rule: required means required, and the error
      names the variable
- [ ] An ADR is added for any architectural decision, saying what it **costs**
- [ ] `bun.lock` is the only lockfile touched

## Infrastructure changes

<!-- Delete this section if infra/ is untouched. -->

- [ ] `pulumi preview` output reviewed, and attached or summarised below
- [ ] IAM changes grant no more than the work in front of them requires
- [ ] Cost impact considered and stated

## Opened by an agent?

<!-- Delete this section if a human wrote this. -->

- [ ] The change is inside what policy already lets the night shift own, or this PR is explicitly
      marked for human decision
- [ ] Source for the change is linked — release note, advisory, or vendor post
