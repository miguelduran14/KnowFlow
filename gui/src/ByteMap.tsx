import type { ParseResult, SchemaField } from 'knowflow'
import { useState } from 'react'

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
}: {
  field: SchemaField
  total: number
  onActive: (f: SchemaField) => void
}) {
  const meta = TYPE_META[field.type]
  const len = Math.max(field.lengthInBytes, 0)
  const gap = field.type === 'unresolved-copy'
  return (
    <div
      className={`bm-seg${gap ? ' bm-seg--gap' : ''}${field.offsetUnknown ? ' bm-seg--unknown' : ''}`}
      style={{ left: `${(field.offset / total) * 100}%`, width: `${(Math.max(len, 1) / total) * 100}%`, ...segStyle(meta.hue) }}
      tabIndex={0}
      role="button"
      aria-label={`${field.name}, ${field.picture ?? 'grupo'}, ${len} bytes`}
      onMouseEnter={() => onActive(field)}
      onFocus={() => onActive(field)}
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

function RecordMap({ record }: { record: SchemaField }) {
  const [active, setActive] = useState<SchemaField | undefined>()
  const total = record.lengthInBytes

  // Registro elemental (77) o sin longitud fiable: una sola barra.
  if (record.children.length === 0 || total <= 0) {
    return (
      <div className="bm-record">
        <RecordHead record={record} />
        <div className="bm-track" style={{ position: 'relative' }}>
          <Segment field={record} total={Math.max(total, record.lengthInBytes, 1)} onActive={setActive} />
        </div>
        <Detail active={active} />
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
            <Segment key={`${f.name}-${i}`} field={f} total={total} onActive={setActive} />
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
                  className="bm-subseg"
                  style={{
                    left: `${(c.offset / total) * 100}%`,
                    width: `${(Math.max(c.lengthInBytes, 1) / total) * 100}%`,
                    ...(st.redef ? {} : segStyle(meta.hue)),
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.name}, ${c.picture ?? 'grupo'}, ${c.lengthInBytes} bytes`}
                  onMouseEnter={() => setActive(c)}
                  onFocus={() => setActive(c)}
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
      <Detail active={active} />
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

function Detail({ active }: { active: SchemaField | undefined }) {
  return (
    <div className={`bm-detail${active ? '' : ' bm-detail--empty'}`} aria-live="polite">
      {active ? detailFor(active) : 'Pasa el ratón (o tabula) por un campo para ver su ficha.'}
    </div>
  )
}

export function ByteMap({ data }: { data: ParseResult }) {
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
        <RecordMap key={`${record.name}-${i}`} record={record} />
      ))}
    </div>
  )
}
