import {
  createClaudeProvider,
  createOpenAICompatibleProvider,
  DEFAULT_CLAUDE_MODEL,
  explainProgram,
  factsFidelity,
  type Explanation,
  type ExplanationProvider,
  type ProgramFacts,
  type WalkthroughStep,
} from 'knowflow'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GlossaryText } from './glossary.js'

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

/**
 * Placeholder animado mientras la IA responde. Muestra la estructura del
 * dossier ya reservada (badge + resumen + 5 slots de recorrido + espina)
 * para que la espera se sienta menos vacía y el layout no salte al llegar.
 */
function DossierSkeleton({ reduce }: { reduce: boolean }) {
  const shimmer = reduce ? undefined : 'sk-shimmer'
  return (
    <div className="dossier dossier--skeleton" aria-hidden="true">
      <div className="sk-line sk-line--badge" />
      <div className={`sk-line sk-line--long ${shimmer ?? ''}`} />
      <div className={`sk-line sk-line--med ${shimmer ?? ''}`} />
      <div className="sk-line sk-line--eyebrow" />
      <div className="dossier__cols">
        <div className="sk-steps">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`sk-step ${shimmer ?? ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="sk-step__n" />
              <div className="sk-step__body">
                <div className="sk-line sk-line--full" />
                <div className="sk-line sk-line--half" />
              </div>
            </div>
          ))}
        </div>
        <div className="sk-spine">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`sk-node ${shimmer ?? ''}`} style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Espina del recorrido: un nodo por etapa con párrafo. NO es el grafo
 * completo — ese vive en Flujo — solo las etapas curadas por la IA. Las
 * ramas condicionales (etapas con `branches`) llevan una línea segmentada
 * de entrada, no continua, para avisar "aquí hay una decisión".
 */
function RecorridoDiagram({
  steps,
  hovered,
  onHover,
  onJump,
}: {
  steps: WalkthroughStep[]
  hovered: string | undefined
  onHover: (p: string | undefined) => void
  onJump: (p: string) => void
}) {
  const nodes = steps.filter(
    (s): s is WalkthroughStep & { paragraph: string } => typeof s.paragraph === 'string',
  )
  if (nodes.length === 0) return null
  const H = 46
  const height = nodes.length * H + 8

  return (
    <svg
      className="rec-diagram"
      viewBox={`0 0 220 ${height}`}
      width="220"
      role="img"
      aria-label="Espina del recorrido"
    >
      {nodes.slice(0, -1).map((_, i) => {
        // Si la ETAPA SIGUIENTE es condicional, la conexión que llega a ella
        // se dibuja segmentada: la próxima ejecución depende de una guarda.
        const next = nodes[i + 1]!
        const cls = next.branches ? 'rec-edge rec-edge--branch' : 'rec-edge'
        return <line key={i} className={cls} x1="110" y1={i * H + 34} x2="110" y2={(i + 1) * H + 10} />
      })}
      {nodes.map((n, i) => {
        const on = hovered === n.paragraph
        const cls = ['rec-node', on ? 'rec-node--on' : '', n.branches ? 'rec-node--branch' : '']
          .filter(Boolean)
          .join(' ')
        return (
          <g
            key={n.paragraph + i}
            className={cls}
            onMouseEnter={() => onHover(n.paragraph)}
            onMouseLeave={() => onHover(undefined)}
            onClick={() => onJump(n.paragraph)}
            role="button"
            tabIndex={0}
          >
            <rect x="14" y={i * H + 10} width="192" height="26" rx="7" />
            <text x="110" y={i * H + 27} textAnchor="middle">
              {n.paragraph}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function ExplainPanel({
  facts,
  onJumpToParagraph,
  explanation,
  onExplanation,
}: {
  facts: ProgramFacts
  onJumpToParagraph?: ((paragraph: string) => void) | undefined
  /** Estado de la explicación levantado a App para sobrevivir cambios de pestaña. */
  explanation: Explanation | undefined
  onExplanation: (e: Explanation | undefined) => void
}) {
  const reduce = useReducedMotion()
  const [kind, setKind] = useState<ProviderKind>(
    () => (localStorage.getItem(STORE.kind) as ProviderKind) || 'claude',
  )
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORE.key) ?? '')
  const [model, setModel] = useState(() => localStorage.getItem(STORE.model) ?? DEFAULT_CLAUDE_MODEL)
  const [corpKey, setCorpKey] = useState(() => localStorage.getItem(STORE.corpKey) ?? '')
  const [corpModel, setCorpModel] = useState(() => localStorage.getItem(STORE.corpModel) ?? '')
  const [corpEndpoint, setCorpEndpoint] = useState(() => localStorage.getItem(STORE.corpEndpoint) ?? '')
  const [corpAuthName, setCorpAuthName] = useState(
    () => localStorage.getItem(STORE.corpAuthName) ?? 'Authorization',
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [hovered, setHovered] = useState<string | undefined>()

  const fidelity = useMemo(() => factsFidelity(facts.data, facts.flow, facts.inventory), [facts])

  // Una explicación pertenece a los hechos con los que se generó: si el
  // fuente cambia, la anterior sería una afirmación falsa del programa nuevo.
  useEffect(() => {
    onExplanation(undefined)
    setError(undefined)
    setHovered(undefined)
  }, [facts, onExplanation])

  const persist = useCallback((storeKey: string, value: string, set: (v: string) => void) => {
    set(value)
    localStorage.setItem(storeKey, value)
  }, [])

  const chooseKind = useCallback((value: ProviderKind) => {
    setKind(value)
    localStorage.setItem(STORE.kind, value)
  }, [])

  const corpAuth =
    corpAuthName.toLowerCase() === 'authorization'
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
      .then(onExplanation)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [kind, apiKey, model, corpEndpoint, corpKey, corpModel, corpAuth, facts, onExplanation])

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.04 } },
  }
  const item: Variants = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 26 },
    },
  }

  return (
    <div className="explain">
      <div className="explain__providers">
        <button className={kind === 'claude' ? 'prov prov--active' : 'prov'} onClick={() => chooseKind('claude')}>
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
            <input type="text" value={model} onChange={e => persist(STORE.model, e.target.value, setModel)} />
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

      {busy && !explanation && <DossierSkeleton reduce={!!reduce} />}

      <AnimatePresence mode="wait">
        {explanation && (
          <motion.article
            key="result"
            className="dossier"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            {...(reduce ? {} : { exit: { opacity: 0 } })}
          >
            <div className={`explain__badge explain__badge--${fidelity.level}`}>
              {fidelity.level === 'verified'
                ? 'Prosa generada por IA sobre hechos verificados por el parser. Los hechos están verificados; la redacción, júzgala tú.'
                : `Prosa sobre hechos PARCIALMENTE verificados: ${fidelity.reasons.join('; ')}.`}
            </div>

            {explanation.structured ? (
              <motion.div variants={container} initial="hidden" animate="show">
                {explanation.summary && (
                  <motion.p variants={item} className="dossier__summary">
                    <GlossaryText text={explanation.summary} />
                  </motion.p>
                )}

                <motion.div variants={item} className="dossier__eyebrow">
                  Recorrido · orden de ejecución
                </motion.div>

                <div className="dossier__cols">
                  <motion.ol className="wt" variants={container} initial="hidden" animate="show">
                    {explanation.walkthrough.map((step, i) => (
                      <motion.li
                        key={i}
                        variants={item}
                        className={
                          [
                            'wt__step',
                            step.paragraph && hovered === step.paragraph ? 'wt__step--on' : '',
                            step.branches ? 'wt__step--branch' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')
                        }
                        onMouseEnter={() => setHovered(step.paragraph)}
                        onMouseLeave={() => setHovered(undefined)}
                        {...(reduce ? {} : { whileHover: { x: 3 } })}
                      >
                        <span className="wt__n">{i + 1}</span>
                        <span className="wt__body">
                          <GlossaryText text={step.text} />
                          {step.paragraph && (
                            <span className="wt__meta">
                              {/* Chip clickable: salta al párrafo real en la pestaña Flujo.
                                  Es la última milla de verificabilidad — el lector puede ir a
                                  la línea del fuente y comprobar la afirmación. */}
                              <button
                                type="button"
                                className="wt__para-chip"
                                onClick={() => onJumpToParagraph?.(step.paragraph!)}
                                title="Ver este párrafo en el diagrama de Flujo"
                              >
                                {step.paragraph}
                                {step.line !== undefined && (
                                  <span className="wt__para-line">L{step.line}</span>
                                )}
                              </button>
                              {step.branches && (
                                <span className="wt__branch-tag" title="Aquí hay una decisión (IF/EVALUATE)">
                                  rama
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </motion.li>
                    ))}
                  </motion.ol>

                  <div className="dossier__diagram">
                    <RecorridoDiagram
                      steps={explanation.walkthrough}
                      hovered={hovered}
                      onHover={setHovered}
                      onJump={p => onJumpToParagraph?.(p)}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              // Respaldo: el modelo no devolvió estructura; se muestra tal cual.
              <pre className="dossier__raw">{explanation.raw}</pre>
            )}
          </motion.article>
        )}
      </AnimatePresence>
    </div>
  )
}
