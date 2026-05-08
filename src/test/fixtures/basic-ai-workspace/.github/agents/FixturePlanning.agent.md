---
name: FixturePlanning
description: Plans fixture work.
agents:
  - FixtureImplementation
tools:
  - read
handoffs:
  - label: Implement fixture
    agent: FixtureImplementation
    prompt: Implement the fixture plan.
    send: true
---
Plan fixture work carefully.