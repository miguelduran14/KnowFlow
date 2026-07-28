export { parse } from './parser.js'
export { parseFlow } from './flow-parser.js'
export { parseInventory } from './inventory.js'
export { flowEdgeLabel, flowToMermaid, linkedFlowToMermaid } from './mermaid.js'
export { linkPrograms } from './linker.js'
export { explainProgram, SYSTEM_PROMPT, type ProgramFacts } from './explain/explain.js'
export { factsFidelity, renderFacts, type FactsFidelity } from './explain/facts.js'
export { createClaudeProvider, DEFAULT_CLAUDE_MODEL, type ClaudeProviderOptions } from './explain/claude.js'
export { createFakeProvider, type FakeProvider } from './explain/fake.js'
export type { ExplanationProvider } from './explain/provider.js'
export type {
  ConditionValue,
  CrossProgramCall,
  CursorUsage,
  DataType,
  ExecBlock,
  FileOperation,
  FileUsage,
  FileVerb,
  FlowEdge,
  FlowEdgeKind,
  FlowParagraph,
  FlowResult,
  Inventory,
  LinkedFlow,
  LinkedProgram,
  OccursDepending,
  ParseResult,
  SchemaField,
} from './types.js'
