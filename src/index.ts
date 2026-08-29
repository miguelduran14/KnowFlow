export { parse } from './parser.js'
export { parseFlow } from './flow-parser.js'
export { parseInventory } from './inventory.js'
export { checkAdvisories } from './advisories.js'
export { renderDossier, type DossierInput } from './dossier.js'
export { GLOSSARY, GLOSSARY_BY_ID, segmentText, type GlossaryEntry, type Segment } from './glossary.js'
export { flowEdgeLabel, flowToMermaid, linkedFlowToMermaid } from './mermaid.js'
export { linkPrograms } from './linker.js'
export {
  explainProgram,
  SYSTEM_PROMPT,
  type ProgramFacts,
  type Explanation,
  type WalkthroughStep,
} from './explain/explain.js'
export { factsFidelity, renderFacts, type FactsFidelity } from './explain/facts.js'
export { createClaudeProvider, DEFAULT_CLAUDE_MODEL, type ClaudeProviderOptions } from './explain/claude.js'
export {
  createOpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from './explain/openai.js'
export { createFakeProvider, type FakeProvider } from './explain/fake.js'
export type { ExplanationProvider } from './explain/provider.js'
export type {
  Advisory,
  AdvisoryRule,
  ConditionValue,
  CrossProgramCall,
  CursorUsage,
  DataSection,
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
  RenamesGroup,
  SchemaField,
} from './types.js'
