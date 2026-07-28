import {
  createClaudeProvider,
  DEFAULT_CLAUDE_MODEL,
  explainProgram,
  factsFidelity,
  type ProgramFacts,
} from 'knowflow'
import { useCallback, useEffect, useMemo, useState } from 'react'

const KEY_STORAGE = 'knowflow.apiKey'
const MODEL_STORAGE = 'knowflow.model'

export function ExplainPanel({ facts }: { facts: ProgramFacts }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '')
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_CLAUDE_MODEL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [explanation, setExplanation] = useState<string | undefined>()

  const fidelity = useMemo(() => factsFidelity(facts.data, facts.flow, facts.inventory), [facts])

  // Una explicación pertenece a los hechos con los que se generó: si el
  // fuente cambia, dejar la anterior en pantalla la convertiría en una
  // afirmación falsa sobre el programa nuevo.
  useEffect(() => {
    setExplanation(undefined)
    setError(undefined)
  }, [facts])

  const saveKey = useCallback((value: string) => {
    setApiKey(value)
    localStorage.setItem(KEY_STORAGE, value)
  }, [])

  const saveModel = useCallback((value: string) => {
    setModel(value)
    localStorage.setItem(MODEL_STORAGE, value)
  }, [])

  const explain = useCallback(() => {
    setBusy(true)
    setError(undefined)
    const provider = createClaudeProvider({ apiKey, model: model || DEFAULT_CLAUDE_MODEL })
    explainProgram(facts, provider)
      .then(setExplanation)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [apiKey, model, facts])

  return (
    <div className="explain">
      <div className="explain__config">
        <label>
          Clave API (Anthropic)
          <input
            type="password"
            value={apiKey}
            onChange={e => saveKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
          />
        </label>
        <label>
          Modelo
          <input type="text" value={model} onChange={e => saveModel(e.target.value)} />
        </label>
        <button onClick={explain} disabled={busy || apiKey.trim() === ''}>
          {busy ? 'Explicando…' : 'Explicar programa'}
        </button>
      </div>
      <p className="explain__byok">
        BYOK: tu clave se guarda solo en este navegador (localStorage) y la llamada va directa de
        tu máquina a Anthropic — el código no pasa por ningún servidor de KnowFlow. El modelo
        recibe únicamente los hechos verificados por el parser, nunca el código fuente crudo.
      </p>
      {error && <div className="explain__error">{error}</div>}
      {explanation && (
        <article className="explain__result">
          <div className={`explain__badge explain__badge--${fidelity.level}`}>
            {fidelity.level === 'verified'
              ? 'Prosa generada por IA sobre hechos verificados por el parser. Los hechos están verificados; la redacción, júzgala tú.'
              : `Prosa generada por IA sobre hechos PARCIALMENTE verificados (${fidelity.reasons.join('; ')}). Lo que el parser no pudo verificar queda declarado como tal.`}
          </div>
          <pre>{explanation}</pre>
        </article>
      )}
    </div>
  )
}
