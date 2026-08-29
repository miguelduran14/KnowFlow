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
import { CheckCircle, Eye, EyeSlash, FloppyDisk, Trash } from '@phosphor-icons/react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  profiles: 'knowflow.connProfiles',
} as const

/**
 * Un perfil de conexión guardado: una combinación con nombre de proveedor +
 * clave + modelo + endpoint. Evita volver a teclear la configuración al
 * alternar entre, p. ej., una clave personal de Claude y un gateway
 * corporativo. Vive en localStorage como el resto de la config BYOK — nada
 * sale de la máquina.
 */
interface ConnProfile {
  id: string
  name: string
  kind: ProviderKind
  apiKey: string
  model: string
  corpKey: string
  corpModel: string
  corpEndpoint: string
  corpAuthName: string
}

function loadProfiles(): ConnProfile[] {
  try {
    const raw = localStorage.getItem(STORE.profiles)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ConnProfile[]) : []
  } catch {
    return []
  }
}

/**
 * Campo de clave con botón de mostrar/ocultar. La clave ya se guarda en
 * localStorage al escribir, pero el campo de contraseña (puntos) no deja
 * verla — así el usuario confirma que sigue ahí y no la vuelve a pegar.
 */
function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string | undefined
}) {
  const [show, setShow] = useState(false)
  return (
    <label>
      {label}
      <span className="secret">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          className="secret__toggle"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Ocultar clave' : 'Mostrar clave'}
          title={show ? 'Ocultar' : 'Mostrar'}
        >
          {show ? <EyeSlash size={15} /> : <Eye size={15} />}
        </button>
      </span>
    </label>
  )
}

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

  // Perfiles de conexión guardados y cuál está aplicado. El nombrado en curso
  // (`naming`) muestra un pequeño campo inline en lugar de un prompt del
  // navegador.
  const [profiles, setProfiles] = useState<ConnProfile[]>(loadProfiles)
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>()
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [hovered, setHovered] = useState<string | undefined>()
  // Texto que va llegando en streaming, antes de tener la estructura final.
  const [streamingText, setStreamingText] = useState('')

  const fidelity = useMemo(() => factsFidelity(facts.data, facts.flow, facts.inventory), [facts])

  // Una explicación pertenece a los hechos con los que se generó: si el
  // fuente cambia, la anterior sería una afirmación falsa del programa nuevo.
  // Se omite el primer pase (montaje): ExplainPanel se desmonta al cambiar
  // de pestaña, así que un simple "cambiaron las deps" en el efecto de
  // montaje borraría, al volver, una explicación que sigue siendo válida
  // (vive levantada en App, ver el comentario de la prop `explanation`).
  const firstFacts = useRef(true)
  useEffect(() => {
    if (firstFacts.current) {
      firstFacts.current = false
      return
    }
    onExplanation(undefined)
    setError(undefined)
    setHovered(undefined)
    setStreamingText('')
  }, [facts, onExplanation])

  const persist = useCallback((storeKey: string, value: string, set: (v: string) => void) => {
    set(value)
    localStorage.setItem(storeKey, value)
  }, [])

  const chooseKind = useCallback((value: ProviderKind) => {
    setKind(value)
    localStorage.setItem(STORE.kind, value)
  }, [])

  const writeProfiles = useCallback((next: ConnProfile[]) => {
    setProfiles(next)
    try {
      localStorage.setItem(STORE.profiles, JSON.stringify(next))
    } catch {
      // Cuota excedida: los perfiles no persisten, pero la sesión sigue.
    }
  }, [])

  // Aplica un perfil guardado: vuelca sus campos al estado y a las claves
  // individuales de STORE (así el resto de la lógica —`ready`, `explain`—
  // sigue leyendo de un solo sitio) y lo marca como activo.
  const applyProfile = useCallback(
    (p: ConnProfile) => {
      chooseKind(p.kind)
      persist(STORE.key, p.apiKey, setApiKey)
      persist(STORE.model, p.model || DEFAULT_CLAUDE_MODEL, setModel)
      persist(STORE.corpKey, p.corpKey, setCorpKey)
      persist(STORE.corpModel, p.corpModel, setCorpModel)
      persist(STORE.corpEndpoint, p.corpEndpoint, setCorpEndpoint)
      persist(STORE.corpAuthName, p.corpAuthName || 'Authorization', setCorpAuthName)
      setActiveProfileId(p.id)
    },
    [chooseKind, persist],
  )

  // Guarda la configuración actual como perfil. Si ya existe uno con el mismo
  // nombre (case-insensitive), lo actualiza en vez de duplicarlo.
  const commitProfile = useCallback(() => {
    const name = draftName.trim()
    if (name === '') return
    const snapshot = { kind, apiKey, model, corpKey, corpModel, corpEndpoint, corpAuthName }
    const existing = profiles.find(p => p.name.toLowerCase() === name.toLowerCase())
    const id = existing ? existing.id : `p${Date.now().toString(36)}`
    const profile: ConnProfile = { id, name, ...snapshot }
    const next = existing
      ? profiles.map(p => (p.id === id ? profile : p))
      : [...profiles, profile]
    writeProfiles(next)
    setActiveProfileId(id)
    setNaming(false)
    setDraftName('')
  }, [draftName, kind, apiKey, model, corpKey, corpModel, corpEndpoint, corpAuthName, profiles, writeProfiles])

  const deleteProfile = useCallback(
    (id: string) => {
      writeProfiles(profiles.filter(p => p.id !== id))
      setActiveProfileId(cur => (cur === id ? undefined : cur))
    },
    [profiles, writeProfiles],
  )

  const activeProfile = profiles.find(p => p.id === activeProfileId)

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
    setStreamingText('')
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
    // Streaming: el texto se va acumulando y mostrando en vivo; al terminar,
    // explainProgram devuelve la estructura ya validada contra los párrafos.
    explainProgram(facts, provider, chunk => setStreamingText(prev => prev + chunk))
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
      <section className="explain__setup" aria-label="Configuración del proveedor">
        <div className="conn-profiles">
          <label className="conn-profiles__field">
            <span className="conn-profiles__label">Perfil</span>
            <select
              className="conn-profiles__select"
              value={activeProfileId ?? ''}
              onChange={e => {
                const p = profiles.find(x => x.id === e.target.value)
                if (p) applyProfile(p)
                else setActiveProfileId(undefined)
              }}
              aria-label="Elegir un perfil de conexión guardado"
            >
              <option value="">
                {profiles.length ? 'Elegir guardado…' : 'Sin perfiles guardados'}
              </option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {naming ? (
            <span className="conn-profiles__namer">
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitProfile()
                  else if (e.key === 'Escape') {
                    setNaming(false)
                    setDraftName('')
                  }
                }}
                placeholder="Nombre del perfil"
                aria-label="Nombre del perfil"
              />
              <button className="conn-profiles__ok" onClick={commitProfile} title="Guardar perfil">
                <CheckCircle size={15} weight="fill" />
              </button>
              <button
                className="conn-profiles__cancel"
                onClick={() => {
                  setNaming(false)
                  setDraftName('')
                }}
                title="Cancelar"
                aria-label="Cancelar"
              >
                ×
              </button>
            </span>
          ) : (
            <>
              <button
                className="conn-profiles__save"
                onClick={() => {
                  setDraftName(activeProfile?.name ?? '')
                  setNaming(true)
                }}
                title="Guardar la configuración actual como un perfil"
              >
                <FloppyDisk size={14} weight="bold" /> Guardar
              </button>
              {activeProfileId && (
                <button
                  className="conn-profiles__del"
                  onClick={() => deleteProfile(activeProfileId)}
                  title="Borrar este perfil"
                  aria-label="Borrar este perfil"
                >
                  <Trash size={14} />
                </button>
              )}
            </>
          )}
        </div>

        <div className="explain__providers" role="group" aria-label="Proveedor de IA">
          <button
            className={kind === 'claude' ? 'prov prov--active' : 'prov'}
            onClick={() => chooseKind('claude')}
            aria-pressed={kind === 'claude'}
          >
            Claude (Anthropic)
          </button>
          <button
            className={kind === 'corporate' ? 'prov prov--active' : 'prov'}
            onClick={() => chooseKind('corporate')}
            aria-pressed={kind === 'corporate'}
          >
            IA corporativa
          </button>
        </div>

      {kind === 'claude' ? (
        <div className="explain__config">
          <SecretField
            label="Clave API (Anthropic)"
            value={apiKey}
            onChange={v => persist(STORE.key, v, setApiKey)}
            placeholder="sk-ant-…"
          />
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
          <SecretField
            label="Clave / token"
            value={corpKey}
            onChange={v => persist(STORE.corpKey, v, setCorpKey)}
          />
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

        <div className="explain__actions">
          <button className="explain__go" onClick={explain} disabled={busy || !ready}>
            {busy ? 'Explicando…' : 'Explicar programa'}
          </button>
          {ready && (
            <span className="explain__saved">
              <CheckCircle size={14} weight="fill" /> Configuración guardada en este navegador
            </span>
          )}
        </div>
      </section>

      {error && <div className="explain__error">{error}</div>}

      {/* Mientras llega la respuesta: si ya hay texto en streaming se muestra
          en vivo (con cursor), y si no, el esqueleto para que la espera no
          quede vacía. Al completar, la vista salta a la versión estructurada. */}
      {busy && !explanation && streamingText === '' && <DossierSkeleton reduce={!!reduce} />}
      {busy && !explanation && streamingText !== '' && (
        <div className="dossier dossier--streaming" aria-live="polite" aria-busy="true">
          <div className="explain__badge explain__badge--streaming">Generando la explicación…</div>
          <p className="dossier__streamtext">
            {streamingText}
            <span className="dossier__caret" aria-hidden="true" />
          </p>
        </div>
      )}

      {/* Sin AnimatePresence: con `explanation` pasando a undefined al cambiar
          de fuente, AnimatePresence esperaba una salida (exit) que a veces no
          terminaba — el dossier viejo se quedaba visible en el DOM aunque el
          estado ya estuviera vacío. Mismo bug ya resuelto así en el cajón del
          glosario (ver glossary.tsx): se prefiere una desaparición inmediata
          y garantizada a una salida suave que a veces no ocurre. Solo queda
          la animación de ENTRADA (initial→animate). */}
      {explanation && (
          <motion.article
            key="result"
            className="dossier"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className={`explain__badge explain__badge--${fidelity.level}`}>
              {fidelity.level === 'verified'
                ? 'Prosa generada por IA sobre hechos verificados por el parser. Los hechos están verificados; la redacción, júzgala tú.'
                : `Prosa sobre hechos parcialmente verificados — ${fidelity.reasons.join('; ')}.`}
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
    </div>
  )
}
