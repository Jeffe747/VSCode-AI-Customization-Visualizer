---
name: Proceed
description: 'Use when: describe when this agent should be selected.'
tools: [execute,read,edit,search,agent,web,todo]
agents: []
user-invocable: true
disable-model-invocation: false
handoffs:
  - send: false
    label: Proceed
    agent: Proceed
    prompt: Proceed
---
# Worker

Read AGENTS.md and understand it.
