import type { FieldReference, ParseResult, ReferenceResult, SchemaField, TraceResult, TraceStep } from '@miguelduran14/knowflow'
import { traceField } from '@miguelduran14/knowflow'
import { ArrowLineLeft, ArrowLineRight, PushPin, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Mapa de bytes: el esquema como memoria. Combina las direcciones A+B
 * ratificadas — una CINTA proporcional (cada campo ocupa el ancho de sus
 * bytes reales) como base, y SUB-PISTAS alineadas bajo los mismos bytes para
 * lo que se solapa o repite (REDEFINES, OCCURS, grupos). Todo son hechos del
 * parser: offset, tamaño en bytes, tipo, redefines, occurs. La tabla clásica
 * queda como alternativa (ver DataPanel).
 */

interface TypeMeta {
  hue: string
  tag: string
}

const TYPE_META: Record<SchemaField['type'], TypeMeta> = {
  alphanumeric: { hue: 'var(--t-alpha)', tag: 'X' },
  numeric: { hue: 'var(--t-num)', tag: '9' },
  'numeric-edited': { hue: 'var(--t-edit)', tag: 'ED' },
  'packed-decimal': { hue: 'var(--t-packed)', tag: 'C3' },
  binary: { hue: 'var(--t-bin)', tag: 'CB' },
  'float-single': { hue: 'var(--t-bin)', tag: 'F4' },
  'float-double': { hue: 'var(--t-bin)', tag: 'F8' },
  pointer: { hue: 'var(--t-bin)', tag: 'PTR' },
  index: { hue: 'var(--t-bin)', tag: 'IDX' },
  group: { hue: 'var(--text-dim)', tag: 'GRP' },
  'unresolved-copy': { hue: 'var(--missing)', tag: '?' },
}

/** Estilo de relleno de un segmento: tinte suave del hue + hue pleno en borde/chip. */
function segStyle(hue: string, extra: Record<string, string> = {}): React.CSSProperties {
  return {
    ['--sc' as string]: hue,
    ['--sf' as string]: `color-mix(in srgb, ${hue} 18%, var(--bg-raised))`,
    ...extra,
  }
}

/** Cuenta las posiciones de dígito de una PIC numérica ("S9(10)V99" → 12). */
function digitCount(picture: string | undefined): number | undefined {
  if (!picture) return undefined
  let total = 0
  const re = /9(?:\((\d+)\))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(picture)) !== null) total += m[1] ? Number(m[1]) : 1
  return total || undefined
}

/** Regla de bytes: ticks a intervalos "redondos", siempre con 0 y el final. */
function ruler(total: number): number[] {
  const step = total <= 24 ? 4 : total <= 80 ? 8 : total <= 200 ? 16 : 32
  const marks: number[] = []
  for (let i = 0; i <= total; i += step) marks.push(i)
  if (marks[marks.length - 1] !== total) marks.push(total)
  return marks
}

/** Ficha del campo enfocado, en lenguaje del parser (sin inventar nada). */
function detailFor(f: SchemaField): React.ReactNode {
  const end = f.offset + Math.max(1, f.lengthInBytes) - 1
  const digits = f.type === 'packed-decimal' || f.type === 'binary' ? digitCount(f.picture) : undefined
  return (
    <>
      <span className="bm-detail__name">{f.name}</span>
      {f.picture && (
        <span>
          <span className="k">PIC</span> <span className="v">{f.picture}</span>
        </span>
      )}
      {f.usage && (
        <span>
          <span className="k">USAGE</span> <span className="v">{f.usage}</span>
        </span>
      )}
      <span>
        <span className="k">bytes</span> <span className="v">{f.lengthInBytes}</span>
      </span>
      <span>
        <span className="k">offset</span>{' '}
        <span className="v">{f.offsetUnknown ? 'no verificable' : `${f.offset}–${end}`}</span>
      </span>
      {f.dataSection && (
        <span>
          <span className="k">sección</span> <span className="v">{f.dataSection}</span>
        </span>
      )}
      {f.conditionValues && f.conditionValues.length > 0 && (
        <span>
          <span className="k">88</span>{' '}
          <span className="v">{f.conditionValues.map(c => c.name).join(', ')}</span>
        </span>
      )}
      {digits !== undefined && f.type === 'packed-decimal' && (
        <em>
          {digits} dígitos en {f.lengthInBytes} bytes · en DISPLAY ocuparía {digits}
        </em>
      )}
      {f.type === 'unresolved-copy' && <em>copybook {f.unresolvedCopyMember} ausente — estructura desconocida</em>}
    </>
  )
}

interface SubTrack {
  label: string
  redef: boolean
  occurs?: number | undefined
  children: SchemaField[]
}

/** Deriva las sub-pistas de un registro: REDEFINES, OCCURS y grupos. */
function subTracksOf(record: SchemaField): SubTrack[] {
  const out: SubTrack[] = []
  for (const child of record.children) {
    if (child.redefines) {
      out.push({
        label: `REDEFINES ${child.redefines} — misma memoria`,
        redef: true,
        children: child.children.length > 0 ? child.children : [child],
      })
    } else if (child.children.length > 0) {
      if (child.occurs) {
        const elemBytes = Math.round(child.lengthInBytes / child.occurs)
        out.push({
          label: `${child.name} · OCCURS ×${child.occurs} — un elemento (${elemBytes}B), se repite`,
          redef: false,
          occurs: child.occurs,
          children: child.children,
        })
      } else {
        out.push({ label: `${child.name} — dentro`, redef: false, children: child.children })
      }
    }
  }
  return out
}

function Segment({
  field,
  total,
  onActive,
  onPin,
  pinned,
}: {
  field: SchemaField
  total: number
  onActive: (f: SchemaField) => void
  onPin: (f: SchemaField) => void
  pinned: boolean
}) {
  const meta = TYPE_META[field.type]
  const len = Math.max(field.lengthInBytes, 0)
  const gap = field.type === 'unresolved-copy'
  const cls = ['bm-seg', gap ? 'bm-seg--gap' : '', field.offsetUnknown ? 'bm-seg--unknown' : '', pinned ? 'bm-seg--pinned' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      style={{ left: `${(field.offset / total) * 100}%`, width: `${(Math.max(len, 1) / total) * 100}%`, ...segStyle(meta.hue) }}
      tabIndex={0}
      role="button"
      aria-pressed={pinned}
      aria-label={`${field.name}, ${field.picture ?? 'grupo'}, ${len} bytes`}
      onMouseEnter={() => onActive(field)}
      onFocus={() => onActive(field)}
      onClick={() => onPin(field)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPin(field)
        }
      }}
    >
      <span className="bm-seg__tag">{meta.tag}</span>
      <span className="bm-seg__name">{field.name}</span>
      <span className="bm-seg__meta">
        {field.picture ?? 'grupo'} · {len}B
        {field.conditionValues && field.conditionValues.length > 0 ? ' · 88' : ''}
      </span>
    </div>
  )
}

function RecordMap({
  record,
  onHover,
  onPin,
  pinnedField,
}: {
  record: SchemaField
  onHover: (f: SchemaField) => void
  onPin: (f: SchemaField) => void
  pinnedField: SchemaField | undefined
}) {
  const total = record.lengthInBytes

  // Registro elemental (77) o sin longitud fiable: una sola barra.
  if (record.children.length === 0 || total <= 0) {
    return (
      <div className="bm-record">
        <RecordHead record={record} />
        <div className="bm-track" style={{ position: 'relative' }}>
          <Segment
            field={record}
            total={Math.max(total, record.lengthInBytes, 1)}
            onActive={onHover}
            onPin={onPin}
            pinned={pinnedField === record}
          />
        </div>
      </div>
    )
  }

  // Cinta: hijos directos que ocupan almacenamiento (los REDEFINES solapan).
  const mainFields = record.children.filter(c => !c.redefines).sort((a, b) => a.offset - b.offset)
  // Huecos de relleno (SYNC) entre campos: se dibujan honestos, no se ocultan.
  const gaps: { off: number; len: number }[] = []
  let cursor = 0
  for (const f of mainFields) {
    if (f.offset > cursor) gaps.push({ off: cursor, len: f.offset - cursor })
    cursor = Math.max(cursor, f.offset + f.lengthInBytes)
  }

  const subTracks = subTracksOf(record)

  return (
    <div className="bm-record">
      <RecordHead record={record} />
      <div className="bm-viz">
        <div className="bm-ruler">
          {ruler(total).map(m => (
            <span key={m} className="bm-tick" style={{ left: `${(m / total) * 100}%` }}>
              {m}
            </span>
          ))}
        </div>

        <div className="bm-track">
          {gaps.map((g, i) => (
            <div
              key={`gap${i}`}
              className="bm-pad"
              style={{ left: `${(g.off / total) * 100}%`, width: `${(g.len / total) * 100}%` }}
              title={`${g.len} byte(s) de relleno (alineación SYNC)`}
            />
          ))}
          {mainFields.map((f, i) => (
            <Segment
              key={`${f.name}-${i}`}
              field={f}
              total={total}
              onActive={onHover}
              onPin={onPin}
              pinned={pinnedField === f}
            />
          ))}
        </div>

        {subTracks.map((st, i) => (
          <div key={`st${i}`} className={`bm-subtrack${st.redef ? ' bm-subtrack--redef' : ''}`}>
            <div className="bm-subtrack__label">
              {st.label}
              {st.redef && <span className="bm-chip bm-chip--redef">REDEFINES</span>}
              {st.occurs && <span className="bm-chip bm-chip--occ">×{st.occurs}</span>}
            </div>
            {st.children.map((c, j) => {
              const meta = TYPE_META[c.type]
              return (
                <div
                  key={`${c.name}-${j}`}
                  className={`bm-subseg${pinnedField === c ? ' bm-subseg--pinned' : ''}`}
                  style={{
                    left: `${(c.offset / total) * 100}%`,
                    width: `${(Math.max(c.lengthInBytes, 1) / total) * 100}%`,
                    ...(st.redef ? {} : segStyle(meta.hue)),
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={pinnedField === c}
                  aria-label={`${c.name}, ${c.picture ?? 'grupo'}, ${c.lengthInBytes} bytes`}
                  onMouseEnter={() => onHover(c)}
                  onFocus={() => onHover(c)}
                  onClick={() => onPin(c)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPin(c)
                    }
                  }}
                >
                  <b>{c.name}</b>
                  <span>
                    {c.picture ?? 'grupo'} · {c.lengthInBytes}B
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function RecordHead({ record }: { record: SchemaField }) {
  return (
    <div className="bm-record__head">
      <span className="bm-record__name">{record.name}</span>
      <span className="bm-record__sub">
        {String(record.level).padStart(2, '0')}
        {record.dataSection ? ` · ${record.dataSection}` : ''} · {record.lengthInBytes} bytes
      </span>
    </div>
  )
}

// ── Panel de usos (where-used) del campo FIJADO ────────────────────────

const ROLE_META: Record<FieldReference['kind'], { label: string; cls: string; title: string }> = {
  read: { label: 'R', cls: 'bm-role--r', title: 'Se lee' },
  write: { label: 'W', cls: 'bm-role--w', title: 'Se escribe' },
  'read-write': { label: 'RW', cls: 'bm-role--rw', title: 'Se lee y se escribe en la misma sentencia' },
  unclassified: { label: '?', cls: 'bm-role--u', title: 'El verbo no permite afirmar el rol' },
}

/**
 * Dónde se lee y dónde se escribe el campo fijado, en la PROCEDURE
 * DIVISION (P6). Se apoya en la pasada `collectReferences` del motor —
 * todo son hechos del parser; lo incierto va marcado. Cada fila salta al
 * párrafo en el diagrama de Flujo y a la línea en el código.
 */
function FieldUses({
  field,
  references,
  onJumpToParagraph,
  onOpenCode,
}: {
  field: SchemaField
  references: ReferenceResult
  onJumpToParagraph: ((name: string) => void) | undefined
  onOpenCode: ((line: number) => void) | undefined
}) {
  const target = field.name.toUpperCase()
  const usage = references.fields.find(f => f.name === target)

  // Lista única en orden de línea: una ocurrencia `read-write` vive en
  // `reads` y `writes` a la vez, así que se deduplica por línea+verbo+rol.
  const rows: FieldReference[] = []
  if (usage) {
    const seen = new Set<string>()
    for (const ref of [...usage.writes, ...usage.reads, ...usage.unclassified].sort((a, b) => a.line - b.line)) {
      const key = `${ref.line}|${ref.verb}|${ref.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(ref)
    }
  }

  return (
    <div className="bm-uses">
      {usage ? (
        <>
          <div className="bm-uses__head">
            <span className="bm-uses__title">Usos</span>
            <span className="bm-uses__counts">
              <b>{usage.reads.length}</b> lect · <b>{usage.writes.length}</b> escr
              {usage.unclassified.length > 0 && (
                <>
                  {' '}
                  · <b>{usage.unclassified.length}</b> sin clasif.
                </>
              )}
            </span>
          </div>
          <ul className="bm-uses__list">
            {rows.map((ref, i) => {
              const meta = ROLE_META[ref.kind]
              return (
                <li key={i} className="bm-uses__row">
                  <span className={`bm-role ${meta.cls}`} title={meta.title}>
                    {meta.label}
                  </span>
                  {onJumpToParagraph && !ref.paragraphImplicit ? (
                    <button
                      type="button"
                      className="bm-uses__para bm-uses__para--link"
                      onClick={() => onJumpToParagraph(ref.paragraph)}
                      title="Enfocar este párrafo en el diagrama de Flujo"
                    >
                      {ref.paragraph}
                    </button>
                  ) : (
                    <span className="bm-uses__para">
                      {ref.paragraph}
                      {ref.paragraphImplicit ? ' (entrada)' : ''}
                    </span>
                  )}
                  {onOpenCode ? (
                    <button
                      type="button"
                      className="bm-uses__line bm-uses__line--link"
                      onClick={() => onOpenCode(ref.line)}
                      title="Ver esta línea en el código"
                    >
                      L{ref.line}
                    </button>
                  ) : (
                    <span className="bm-uses__line">L{ref.line}</span>
                  )}
                  <span className="bm-uses__verb">{ref.verb}</span>
                  {ref.via88 && (
                    <span className="bm-uses__mark" title={`Referenciado por la condición ${ref.via88}`}>
                      vía {ref.via88}
                    </span>
                  )}
                  {ref.uncertain && (
                    <span
                      className="bm-uses__mark bm-uses__mark--warn"
                      title="Rol no seguro: argumento por referencia de una CALL, MOVE CORRESPONDING, homónimo del esquema o SQL dinámico"
                    >
                      ~ incierto
                    </span>
                  )}
                  <span className="bm-uses__snippet" title={ref.snippet}>
                    {ref.snippet}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="bm-uses__none">
          No se lee ni se escribe en la PROCEDURE DIVISION del fuente aportado
          {references.fragment ? ' (fuente parcial)' : ''}.
        </div>
      )}

      <FieldTrace
        target={target}
        references={references}
        onJumpToParagraph={onJumpToParagraph}
        onOpenCode={onOpenCode}
      />
    </div>
  )
}

// ── Trazabilidad transitiva (P7) ──────────────────────────────────────

/** Un salto directo de la traza: el otro extremo + verbo + salto al código. */
function TraceStepRow({
  step,
  direction,
  onJumpToParagraph,
  onOpenCode,
}: {
  step: TraceStep
  direction: 'upstream' | 'downstream'
  onJumpToParagraph: ((name: string) => void) | undefined
  onOpenCode: ((line: number) => void) | undefined
}) {
  const peer = direction === 'upstream' ? step.from : step.to
  return (
    <li className="bm-trace__row">
      {step.paragraph && onJumpToParagraph ? (
        <button
          type="button"
          className="bm-trace__peer bm-uses__para--link"
          onClick={() => onJumpToParagraph(step.paragraph!)}
          title={`Asignado en ${step.paragraph} — enfocar en Flujo`}
        >
          {peer}
        </button>
      ) : (
        <span className="bm-trace__peer">{peer}</span>
      )}
      <span className="bm-trace__via">{step.redefines ? 'solape REDEFINES' : step.verb}</span>
      {step.line > 0 &&
        (onOpenCode ? (
          <button
            type="button"
            className="bm-uses__line bm-uses__line--link"
            onClick={() => onOpenCode(step.line)}
            title="Ver esta línea en el código"
          >
            L{step.line}
          </button>
        ) : (
          <span className="bm-uses__line">L{step.line}</span>
        ))}
      {step.uncertain && !step.redefines && (
        <span className="bm-uses__mark bm-uses__mark--warn" title="Flujo no seguro">
          ~
        </span>
      )}
    </li>
  )
}

/** Un lado de la traza (arriba o abajo): saltos directos + cadena completa. */
function TraceSide({
  result,
  direction,
  label,
  Icon,
  onJumpToParagraph,
  onOpenCode,
}: {
  result: TraceResult
  direction: 'upstream' | 'downstream'
  label: string
  Icon: typeof ArrowLineLeft
  onJumpToParagraph: ((name: string) => void) | undefined
  onOpenCode: ((line: number) => void) | undefined
}) {
  const [openChain, setOpenChain] = useState(false)
  if (result.direct.length === 0) return null
  const arrow = direction === 'upstream' ? ' ← ' : ' → '
  const deeper = result.paths.some(p => p.nodes.length > 2)

  return (
    <div className="bm-trace__side">
      <div className="bm-trace__head">
        <Icon size={12} weight="bold" />
        <span>{label}</span>
        <b>{result.direct.length}</b>
      </div>
      <ul className="bm-trace__list">
        {result.direct.map((s, i) => (
          <TraceStepRow
            key={i}
            step={s}
            direction={direction}
            onJumpToParagraph={onJumpToParagraph}
            onOpenCode={onOpenCode}
          />
        ))}
      </ul>
      {deeper && (
        <>
          <button type="button" className="bm-trace__toggle" onClick={() => setOpenChain(v => !v)}>
            {openChain ? 'ocultar cadena completa' : 'ver cadena completa'}
          </button>
          {openChain && (
            <ul className="bm-trace__paths">
              {result.paths.map((p, i) => (
                <li key={i} className="bm-trace__path">
                  <span className="bm-trace__chain">{p.nodes.join(arrow)}</span>
                  {p.uncertain && <span className="bm-trace__flag bm-trace__flag--warn">~</span>}
                  {p.cyclic && <span className="bm-trace__flag">ciclo</span>}
                  {p.truncated && <span className="bm-trace__flag">…</span>}
                </li>
              ))}
              {result.truncated && <li className="bm-trace__path bm-trace__path--more">… caminos recortados</li>}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/**
 * De dónde viene el valor del campo fijado y a dónde va, encadenando
 * MOVE/COMPUTE/… y solapes REDEFINES (P7). Insensible al orden de
 * ejecución: cada arista es un flujo POSIBLE ("puede venir de / puede ir
 * a"). Sin aristas → no se dibuja nada.
 */
function FieldTrace({
  target,
  references,
  onJumpToParagraph,
  onOpenCode,
}: {
  target: string
  references: ReferenceResult
  onJumpToParagraph: ((name: string) => void) | undefined
  onOpenCode: ((line: number) => void) | undefined
}) {
  const up = useMemo(() => traceField(references, target, 'upstream'), [references, target])
  const down = useMemo(() => traceField(references, target, 'downstream'), [references, target])
  if (up.direct.length === 0 && down.direct.length === 0) return null

  return (
    <div className="bm-trace">
      <div
        className="bm-trace__legend"
        title="Cada arista es un flujo posible; no se tiene en cuenta el orden de ejecución"
      >
        Trazabilidad · puede venir de / puede ir a
      </div>
      <TraceSide
        result={up}
        direction="upstream"
        label="De dónde viene"
        Icon={ArrowLineLeft}
        onJumpToParagraph={onJumpToParagraph}
        onOpenCode={onOpenCode}
      />
      <TraceSide
        result={down}
        direction="downstream"
        label="A dónde va"
        Icon={ArrowLineRight}
        onJumpToParagraph={onJumpToParagraph}
        onOpenCode={onOpenCode}
      />
    </div>
  )
}

/**
 * Ficha única del campo, anclada como pie pegajoso (sticky) al fondo del
 * scroll: así no se pierde de vista aunque el registro sea muy alto. Muestra
 * el campo fijado (clic) o, si no hay ninguno, el que se está sobrevolando.
 * Al FIJAR un campo, la ficha crece con el panel de usos (P6).
 */
function Detail({
  field,
  pinned,
  onUnpin,
  references,
  onJumpToParagraph,
  onOpenCode,
}: {
  field: SchemaField | undefined
  pinned: boolean
  onUnpin: () => void
  references: ReferenceResult | undefined
  onJumpToParagraph: ((name: string) => void) | undefined
  onOpenCode: ((line: number) => void) | undefined
}) {
  return (
    <div
      className={`bm-detail${field ? '' : ' bm-detail--empty'}${pinned ? ' bm-detail--pinned' : ''}`}
      aria-live="polite"
    >
      {field ? (
        <>
          {pinned && (
            <span className="bm-detail__pin" title="Campo fijado">
              <PushPin size={12} weight="fill" /> fijado
            </span>
          )}
          {detailFor(field)}
          {pinned && (
            <button
              type="button"
              className="bm-detail__unpin"
              onClick={onUnpin}
              title="Soltar (Esc)"
              aria-label="Soltar el campo fijado"
            >
              <X size={13} weight="bold" />
            </button>
          )}
          {pinned && references && field.type !== 'unresolved-copy' && (
            <FieldUses
              field={field}
              references={references}
              onJumpToParagraph={onJumpToParagraph}
              onOpenCode={onOpenCode}
            />
          )}
        </>
      ) : (
        'Pasa el ratón (o tabula) por un campo para ver su ficha · clic para fijarla.'
      )}
    </div>
  )
}

export function ByteMap({
  data,
  references,
  onJumpToParagraph,
  onOpenCode,
}: {
  data: ParseResult
  references?: ReferenceResult | undefined
  onJumpToParagraph?: ((name: string) => void) | undefined
  onOpenCode?: ((line: number) => void) | undefined
}) {
  // Campo sobrevolado (previsualización) y campo fijado al clic. La ficha
  // muestra el fijado si lo hay; si no, el sobrevolado — así el hover NO pisa
  // un campo que has clavado para leerlo con calma.
  const [hovered, setHovered] = useState<SchemaField | undefined>()
  const [pinned, setPinned] = useState<SchemaField | undefined>()
  const shown = pinned ?? hovered

  const onHover = useCallback((f: SchemaField) => setHovered(f), [])
  // Clic en el campo ya fijado lo suelta (toggle); en otro, re-fija.
  const onPin = useCallback((f: SchemaField) => setPinned(prev => (prev === f ? undefined : f)), [])

  // Esc suelta el campo fijado — gesto estándar de "cerrar/soltar".
  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])

  if (data.records.length === 0) {
    return (
      <div className="empty">
        <p>No se ha encontrado ninguna definición de datos en el fuente.</p>
      </div>
    )
  }
  const complete = data.missingCopybooks.length === 0
  return (
    <div className="bytemap">
      <div className={`schema__fidelity schema__fidelity--${complete ? 'verified' : 'partial'}`}>
        {complete
          ? 'Verificado por parser — el ancho de cada campo son sus bytes reales; los offsets salen del fuente, no de una estimación.'
          : 'Parcialmente verificado — falta parte del esquema; los huecos se marcan y no se dibuja lo que no se sabe.'}
      </div>
      {!complete && (
        <div className="schema__missing">
          Faltan copybooks: <strong>{data.missingCopybooks.join(', ')}</strong> — arrastra los members (.cpy)
          para completar el mapa.
        </div>
      )}
      <div className="bytemap__legend" aria-label="Leyenda de tipos">
        {(
          [
            ['alphanumeric', 'Alfanum. X'],
            ['numeric', 'Num. 9'],
            ['packed-decimal', 'Empaq. C3'],
            ['numeric-edited', 'Editado ED'],
            ['binary', 'Binario CB'],
          ] as const
        ).map(([t, label]) => (
          <span key={t} className="bm-lg">
            <span
              className="bm-sw"
              style={segStyle(TYPE_META[t].hue, { background: `color-mix(in srgb, ${TYPE_META[t].hue} 20%, var(--bg-raised))`, borderColor: `color-mix(in srgb, ${TYPE_META[t].hue} 45%, var(--border))` })}
            />
            {label}
          </span>
        ))}
        <span className="bm-lg">
          <span className="bm-sw bm-sw--redef" /> REDEFINES
        </span>
        <span className="bm-lg">
          <span className="bm-sw bm-sw--gap" /> hueco
        </span>
      </div>
      {data.records.map((record, i) => (
        <RecordMap
          key={`${record.name}-${i}`}
          record={record}
          onHover={onHover}
          onPin={onPin}
          pinnedField={pinned}
        />
      ))}

      <Detail
        field={shown}
        pinned={pinned !== undefined}
        onUnpin={() => setPinned(undefined)}
        references={references}
        onJumpToParagraph={onJumpToParagraph}
        onOpenCode={onOpenCode}
      />
    </div>
  )
}
