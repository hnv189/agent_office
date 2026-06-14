# 01 · Concept

## The metaphor

Agent Playground turns an AI agent team into a **pixel-art office you can watch**.
The fiction: "Mission Control" is a building, each agent has its own **room**, and
the agents are little creatures (octopus, person, robot, cat, car, rocket). You
glance at the office and instantly see who is busy, who is asleep, and who is
talking to whom.

This is a deliberately **playful, ambient** way to monitor automation. Instead of
a table of green/red status rows, you get a living scene.

## Core behaviours

- **Working = motion.** An `active` agent walks back and forth across its room with
  a two-frame walk cycle and a bobbing animation, and floats a **speech bubble**
  describing what it's doing (e.g. `scanning…`, `hypothesis!`, `dispatching`).
- **Idle = rest.** A non-active agent stands/sits still and shows a floating **ZZZ**.
- **On-demand** agents wait until a task wakes them.
- **Linkage = visits.** When one agent triggers a connected agent, the first creature
  physically **walks from its room to the partner's room and back** (an overlay
  sprite tweened between the two room rectangles).
- **Tasks flow through a pipeline.** A task (text and/or an image) is assigned to a
  starting agent; running it sends the work down the chain of connections, lighting
  up each agent in turn and logging to the **LIVE ticker**.

## Vocabulary (use these exact terms)

| Term | Meaning |
|------|---------|
| **Agent** | A configurable AI worker: name, sprite, room, prompt, model connection, schedule, tools. |
| **Room** | A themed environment one agent lives in. Theme = label + accent colour (see `ROOM_THEMES`). |
| **Sprite / Character** | The pixel creature representing an agent (`octo`, `person`, `robot`, `cat`, `car`, `rocket`). |
| **Status** | `active` (moving), `ondemand` (waiting), `idle` (asleep). |
| **Schedule** | When an agent runs: `always`, `ondemand`, or `every` N hours. |
| **Connection** | A directed link `from → to` between two agents. Drives both the pipeline and the visit animation. |
| **Pipeline** | The linear chain of agents derived from connections starting at a task's assignee (`pipelineFrom`). |
| **Task** | A unit of work (`text` or `image`) pushed into a pipeline. |
| **Visit** | A transient animation of one agent travelling to another's room. |
| **Ticker** | The scrolling LIVE feed of recent events at the bottom of the Office. |
| **Demo / Live mode** | Simulated responses vs. real model calls. |

## The six default agents

| Agent | Colour | Character | Room | Role | Schedule |
|-------|--------|-----------|------|------|----------|
| Nova | purple | octopus | Command HQ | command (dispatcher) | always-on |
| Cobalt | blue | person | Observatory | research (observer) | every 21h |
| Ember | red | robot | Security | security (watcher) | on-demand |
| Rosa | pink | cat | Research Lab | research (scientist) | every 12h |
| Sol | yellow | car | Workshop | build (builder) | on-demand |
| Clay | orange | rocket | Studio | studio (maker) | on-demand |

Default connections form one pipeline plus a branch:
`Nova → Cobalt → Rosa → Sol → Clay`, and `Nova → Ember`.

`role` only selects which pool of simulated speech-bubble phrases an agent uses
(see `SIM_ACTIONS` in `store.jsx`). It does not change real model behaviour.
