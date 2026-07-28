import type { Inventory } from 'knowflow'

/**
 * "¿Este programa qué toca?" — ficheros con su DD y sus operaciones,
 * tablas DB2, cursores y comandos CICS. Todo es extracción literal del
 * fuente: no se interpreta qué hace una consulta, solo se dice que está
 * ahí y en qué línea.
 */
export function InventoryPanel({ inventory }: { inventory: Inventory }) {
  const empty =
    inventory.files.length === 0 &&
    inventory.execs.length === 0 &&
    inventory.unresolvedFileOps.length === 0

  if (empty) {
    return (
      <div className="empty">
        <p>Este programa no abre ficheros ni tiene bloques EXEC SQL/CICS.</p>
        <p className="empty__hint">
          Solo se listan los que aparecen en el fuente aportado — un SELECT que viva en un copybook
          ausente no se adivina.
        </p>
      </div>
    )
  }

  return (
    <div className="inventory">
      {inventory.unresolvedFileOps.length > 0 && (
        <div className="inventory__warn">
          Operaciones de E/S cuyo fichero no se puede resolver con este fuente:{' '}
          <strong>
            {[...new Set(inventory.unresolvedFileOps.map(o => `${o.verb} ${o.target}`))].join(', ')}
          </strong>{' '}
          — falta el SELECT o el FD. No se atribuyen a ningún fichero.
        </div>
      )}

      {inventory.files.length > 0 && (
        <section className="inventory__group">
          <h3>Ficheros</h3>
          {inventory.files.map(file => (
            <div key={file.name} className="inv-file">
              <div className="inv-file__head">
                <span className="inv-file__name">{file.name}</span>
                {file.assignTo && <span className="pill">DD {file.assignTo}</span>}
                {file.organization && <span className="pill">{file.organization}</span>}
                {file.access && <span className="pill">{file.access}</span>}
              </div>
              {file.operations.length === 0 ? (
                <div className="inv-op inv-op--none">declarado, pero sin operaciones en el fuente</div>
              ) : (
                file.operations.map((op, i) => (
                  <div key={i} className="inv-op">
                    <span className={`inv-verb inv-verb--${op.verb.toLowerCase()}`}>
                      {op.verb}
                      {op.mode ? ` ${op.mode}` : ''}
                    </span>
                    <span className="inv-op__where">
                      {op.paragraph} · L{op.line}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))}
        </section>
      )}

      {inventory.tables.length > 0 && (
        <section className="inventory__group">
          <h3>Tablas DB2</h3>
          <div className="inv-tags">
            {inventory.tables.map(table => (
              <span key={table} className="inv-tag inv-tag--table">
                {table}
              </span>
            ))}
          </div>
        </section>
      )}

      {inventory.cursors.length > 0 && (
        <section className="inventory__group">
          <h3>Cursores</h3>
          {inventory.cursors.map(cursor => {
            // Un cursor que se abre y nunca se cierra es justo el tipo de
            // cosa que un mantenedor necesita ver de un vistazo.
            const ops = (
              [
                ['DECLARE', cursor.declared],
                ['OPEN', cursor.opened],
                ['FETCH', cursor.fetched],
                ['CLOSE', cursor.closed],
              ] as const
            ).map(([label, present]) => (
              <span key={label} className={present ? 'inv-step' : 'inv-step inv-step--absent'}>
                {label}
              </span>
            ))
            return (
              <div key={cursor.name} className="inv-cursor">
                <span className="inv-cursor__name">{cursor.name}</span>
                <span className="inv-cursor__steps">{ops}</span>
                {cursor.tables.length > 0 && (
                  <span className="inv-cursor__tables">sobre {cursor.tables.join(', ')}</span>
                )}
              </div>
            )
          })}
        </section>
      )}

      {inventory.cicsCommands.length > 0 && (
        <section className="inventory__group">
          <h3>Comandos CICS</h3>
          <div className="inv-tags">
            {inventory.cicsCommands.map(c => (
              <span key={c.command} className="inv-tag inv-tag--cics">
                {c.command}
                {c.count > 1 && <em> ×{c.count}</em>}
              </span>
            ))}
          </div>
        </section>
      )}

      {inventory.execs.length > 0 && (
        <section className="inventory__group">
          <h3>Bloques EXEC</h3>
          <table className="inv-execs">
            <thead>
              <tr>
                <th>Línea</th>
                <th>Dónde</th>
                <th>Tipo</th>
                <th>Texto (literal del fuente)</th>
              </tr>
            </thead>
            <tbody>
              {inventory.execs.map((exec, i) => (
                <tr key={i}>
                  <td className="cell-num">{exec.line}</td>
                  <td>{exec.paragraph ?? 'DATA DIVISION'}</td>
                  <td>
                    <span className={`inv-tag inv-tag--${exec.kind}`}>
                      {exec.kind.toUpperCase()} {exec.verb}
                    </span>
                  </td>
                  <td className="inv-execs__text">{exec.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
