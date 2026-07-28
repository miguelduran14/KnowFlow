import type { ParseResult, SchemaField } from 'knowflow'
import { Fragment } from 'react'

function FieldRows({ field, depth }: { field: SchemaField; depth: number }) {
  const isGap = field.type === 'unresolved-copy'
  return (
    <Fragment>
      <tr className={isGap ? 'row--gap' : field.offsetUnknown ? 'row--unknown' : ''}>
        <td className="cell-name" style={{ paddingLeft: 10 + depth * 18 }}>
          {isGap ? `COPY ${field.unresolvedCopyMember}` : field.name}
          {field.redefines && <span className="pill pill--redefines">REDEFINES {field.redefines}</span>}
          {field.occurs !== undefined && <span className="pill">×{field.occurs}</span>}
          {field.occursDepending && (
            <span className="pill pill--warn">
              ×{field.occursDepending.min}..{field.occursDepending.max ?? '?'} según{' '}
              {field.occursDepending.dependingOn}
            </span>
          )}
        </td>
        <td>{isGap ? '—' : String(field.level).padStart(2, '0')}</td>
        <td>
          {isGap ? 'no disponible' : field.type === 'group' ? 'grupo' : field.picture ?? field.type}
          {/* Un PIC editado ocupa bytes de presentación: con la PIC delante
              no siempre se ve que ZZ,ZZ9.99 no es un campo de cálculo. */}
          {field.type === 'numeric-edited' && <span className="pill">editado</span>}
        </td>
        <td>{field.usage ?? ''}</td>
        <td className="cell-num">{isGap ? '?' : field.lengthInBytes}</td>
        <td className="cell-num">{isGap || field.offsetUnknown ? '?' : field.offset}</td>
      </tr>
      {(field.conditionValues ?? []).map(cond => (
        <tr key={cond.name} className="row--cond">
          <td className="cell-name" style={{ paddingLeft: 10 + (depth + 1) * 18 }}>
            88 {cond.name}
          </td>
          <td>88</td>
          <td colSpan={4}>= {cond.values.join(', ')}</td>
        </tr>
      ))}
      {field.children.map((child, i) => (
        <FieldRows key={`${child.name}-${i}`} field={child} depth={depth + 1} />
      ))}
    </Fragment>
  )
}

export function SchemaTable({ data }: { data: ParseResult }) {
  if (data.records.length === 0) {
    return (
      <div className="empty">
        <p>No se ha encontrado ninguna definición de datos en el fuente.</p>
      </div>
    )
  }
  const complete = data.missingCopybooks.length === 0
  return (
    <div className="schema">
      <div className={`schema__fidelity schema__fidelity--${complete ? 'verified' : 'partial'}`}>
        {complete
          ? 'Verificado por parser — cada byte y cada offset salen del fuente, no de una estimación.'
          : 'Parcialmente verificado — falta parte del esquema (ver aviso abajo).'}
      </div>
      {!complete && (
        <div className="schema__missing">
          Faltan copybooks: <strong>{data.missingCopybooks.join(', ')}</strong> — arrastra los
          members (.cpy) para completar el esquema. Los huecos y los offsets posteriores se marcan
          con «?»: no se inventa nada.
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Campo</th>
            <th>Nivel</th>
            <th>PIC / tipo</th>
            <th>USAGE</th>
            <th>Bytes</th>
            <th>Offset</th>
          </tr>
        </thead>
        <tbody>
          {data.records.map((record, i) => (
            <FieldRows key={`${record.name}-${i}`} field={record} depth={0} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
