# Local Agent Harness

An agentic coding loop that drives Qwen-family local models (Qwen 3.8 and older Qwen3) via Ollama with a small tool set against a single git repository. Built to be safe enough for work code and observable enough to learn from.

## Language

**Harness**:
The loop that sends a conversation to a Model, interprets its reply as text or Tool Calls, executes the tools, and feeds results back until the Run ends.
_Avoid_: Agent, runner, framework

**Model**:
A specific local weights file served by a Backend, e.g. qwen3.8:27b or qwen3:8b.
_Avoid_: LLM, engine

**Backend**:
An Ollama process serving Model inference over HTTP on a host you control, either localhost or an allow-listed host.
_Avoid_: Provider, server, endpoint

**Run**:
One invocation of the Harness with one task against one Target Directory, from first prompt to final answer, with its own log.
_Avoid_: Session, job, conversation

**Target Directory**:
The git repository the Run operates on. Every file tool is confined to it.
_Avoid_: Workspace, project, cwd

**Tool Call**:
A Model request to execute one of the six tools: read, write, edit, glob, grep, shell.
_Avoid_: Function call, action

**Confinement**:
The rule that a tool may only touch paths inside the Target Directory and may not read secret-pattern files without an explicit flag.
_Avoid_: Sandbox (reserved for real OS-level isolation, not in v1)

**Confirmation**:
The human yes/no gate before a write, edit or shell Tool Call runs. Skippable per Run, except for denylisted shell commands which are never run.
_Avoid_: Approval, permission prompt

**Thinking**:
Qwen's optional reasoning phase emitted before the answer. Off by default, switchable per Run.
_Avoid_: Reasoning mode, chain of thought
