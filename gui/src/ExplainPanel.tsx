import {
  createClaudeProvider,
  createOpenAICompatibleProvider,
  DEFAULT_CLAUDE_MODEL,
  explainProgram,
  factsFidelity,
  type ExplanationProvider,
  type ProgramFacts,
} from 'knowflow'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ProviderKind = 'claude' | 'corporate'

const STORE = {
  kind: 'knowflow.providerKind',
  key: 'knowflow.apiKey',
  model: 'knowflow.model',
  corpKey: 'knowflow.corp.apiKey',
  corpModel: 'knowflow.corp.model',
  corpEndpoint: 'knowflow.corp.endpoint',
  corpAuthName: 'knowflow.corp.authName',
} as const

export function ExplainPanel({ facts }: { facts: ProgramFacts }) {
  const [kind, setKind] = useState<ProviderKind>(
    () => (localStorage.getItem(STORE.kind) as ProviderKind) || 'claude',
  )
  // Claude
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORE.key) ?? '')
  const [model, setModel] = useState(() => localStorage.getItem(STORE.model) ?? DEFAULT_CLAUDE_MODEL)
  // Corporativa (compatible con OpenAI)
  const [corpKey, setCorpKey] = useState(() => localStorage.getItem(STORE.corpKey) ?? '')
  const [corpModel, setCorpModel] = useState(() => localStorage.getItem(STORE.corpModel) ?? '')
  const [corpEndpoint, setCorpEndpoint] = useState(() => localStorage.getItem(STORE.corpEndpoint) ?? '')
  const [corpAuthName, setCorpAuthName] = useState(
    () => localStorage.getItem(STORE.corpAuthName) ?? 'Authorization',
  )

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

  const persist = useCallback(
    (storeKey: string, value: string, set: (v: string) => void) => {
      set(value)
      localStorage.setItem(storeKey, value)
    },
    [],
  )

  const chooseKind = useCallback((value: ProviderKind) => {
    setKind(value)
    localStorage.setItem(STORE.kind, value)
  }, [])

  // Azure usa `api-key` sin prefijo; el resto, `Authorization: Bearer`.
  const corpAuth = corpAuthName.toLowerCase() === 'authorization'
    ? { name: 'Authorization', prefix: 'Bearer ' }
    : { name: corpAuthName, prefix: '' }

  const ready =
    kind === 'claude'
      ? apiKey.trim() !== ''
      : corpKey.trim() !== '' && corpEndpoint.trim() !== '' && corpModel.trim() !== ''

  const explain = useCallback(() => {
    setBusy(true)
    setError(undefined)
    const provider: ExplanationProvider =
      kind === 'claude'
        ? createClaudeProvider({ apiKey, model: model || DEFAULT_CLAUDE_MODEL })
        : createOpenAICompatibleProvider({
            id: 'corporativa',
            endpoint: corpEndpoint,
            apiKey: corpKey,
            model: corpModel,
            auth: corpAuth,
          })
    explainProgram(facts, provider)
      .then(setExplanation)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [kind, apiKey, model, corpEndpoint, corpKey, corpModel, corpAuth, facts])

  return (
    <div className="explain">
      <div className="explain__providers">
        <button
          className={kind === 'claude' ? 'prov prov--active' : 'prov'}
          onClick={() => chooseKind('claude')}
        >
          Claude (Anthropic)
        </button>
        <button
          className={kind === 'corporate' ? 'prov prov--active' : 'prov'}
          onClick={() => chooseKind('corporate')}
        >
          IA corporativa
        </button>
      </div>

      {kind === 'claude' ? (
        <div className="explain__config">
          <label>
            Clave API (Anthropic)
            <input
              type="password"
              value={apiKey}
              onChange={e => persist(STORE.key, e.target.value, setApiKey)}
              placeholder="sk-ant-…"
              autoComplete="off"
            />
          </label>
          <label>
            Modelo
            <input
              type="text"
              value={model}
              onChange={e => persist(STORE.model, e.target.value, setModel)}
            />
          </label>
        </div>
      ) : (
        <div className="explain__config explain__config--corp">
          <label className="wide">
            Endpoint (chat completions)
            <input
              type="text"
              value={corpEndpoint}
              onChange={e => persist(STORE.corpEndpoint, e.target.value, setCorpEndpoint)}
              placeholder="https://gateway.corp/v1/chat/completions"
              autoComplete="off"
            />
          </label>
          <label>
            Modelo
            <input
              type="text"
              value={corpModel}
              onChange={e => persist(STORE.corpModel, e.target.value, setCorpModel)}
              placeholder="p. ej. codex, axet-1"
            />
          </label>
          <label>
            Clave / token
            <input
              type="password"
              value={corpKey}
              onChange={e => persist(STORE.corpKey, e.target.value, setCorpKey)}
              autoComplete="off"
            />
          </label>
          <label>
            Cabecera de auth
            <input
              type="text"
              value={corpAuthName}
              onChange={e => persist(STORE.corpAuthName, e.target.value, setCorpAuthName)}
              placeholder="Authorization · api-key"
            />
          </label>
        </div>
      )}

      <button className="explain__go" onClick={explain} disabled={busy || !ready}>
        {busy ? 'Explicando…' : 'Explicar programa'}
      </button>

      <p className="explain__byok">
        BYOK: tus credenciales se guardan solo en este navegador (localStorage) y la llamada va
        directa de tu máquina al proveedor que configures — el código no pasa por ningún servidor de
        KnowFlow. El modelo recibe únicamente los hechos verificados por el parser, nunca el código
        fuente crudo.
        {kind === 'corporate' && (
          <>
            {' '}
            <strong>
              Enviar COBOL de clientes por cualquier endpoint, corporativo incluido, sigue siendo tu
              decisión y responsabilidad: úsalo solo con código sintético/público o por un canal
              sancionado para ese código.
            </strong>
          </>
        )}
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
