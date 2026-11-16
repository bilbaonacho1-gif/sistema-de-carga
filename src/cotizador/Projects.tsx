/**
 * PROYECTOS: los depósitos guardados de cada usuario. Se guarda lo que se está armando con un
 * nombre, se deja, se empieza otro y después se sigue con el mismo. Para pasarle uno a otra persona
 * se comparte con un código (o un link), que el otro pega acá.
 */
import { Check, Copy, FolderOpen, Link2, Pencil, Plus, RefreshCw, Save, Share2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../web/components/overlays'
import { Button, Field, Input } from '../web/components/ui'
import { usePlan } from '../web/plan/planStore'
import { canEdit, CloudError, codeFrom, deleteProject, listProjects, renameProject, shareLink, shareProject, useAuth, type ProjectInfo } from './cloud'
import { closeProject, hasWork, openByCode, openProject, saveAsNew, saveNow, startNew, useProject } from './projects'

const say = (e: unknown) => (e instanceof CloudError ? e.message : 'No se pudo hacer.')
const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
const STATUS = { saved: 'Guardado', dirty: 'Con cambios sin guardar', saving: 'Guardando…', error: 'No se pudo guardar' }

export function ProjectsSection() {
  const toast = useToast()
  const user = useAuth((s) => s.user)
  const edit = canEdit(user)
  const { current, shared, status, error } = useProject()
  const [list, setList] = useState<ProjectInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [blank, setBlank] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // el proyecto del que se está mostrando el código para compartir
  const [sharing, setSharing] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!edit) { setList([]); return }
    try { setList(await listProjects()); setLoadError(null) } catch (e) { setLoadError(say(e)) }
  }, [edit])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try { await fn(); if (done) toast.ok(done) } catch (e) { toast.error(say(e)) } finally { setBusy(false) }
    await load()
  }
  /** Antes de cambiar lo que hay en pantalla: si no está guardado en un proyecto, se pregunta. */
  const okToReplace = () => current || shared || !hasWork() || window.confirm('Lo que tenés armado ahora no está guardado en ningún proyecto y se va a perder. ¿Seguir igual?')
  const goDepot = () => usePlan.getState().setSection('deposito')

  const open = (p: ProjectInfo) => { if (okToReplace()) void run(async () => { if (current) await saveNow(); await openProject(p.id); goDepot() }, `Abriste "${p.name}".`) }
  const saveCurrentAs = () => run(async () => { await saveAsNew(name); setName('') }, 'Proyecto guardado. Desde ahora los cambios se guardan solos.')
  const startBlank = () => { if (okToReplace()) void run(async () => { if (current) await saveNow(); await startNew(blank); setBlank(''); goDepot() }, 'Proyecto nuevo creado.') }
  const openCode = () => { if (okToReplace()) void run(async () => { if (current) await saveNow(); const p = await openByCode(codeFrom(code)); setCode(''); goDepot(); toast.ok(p.mine ? `Abriste tu proyecto "${p.name}".` : `Abriste "${p.name}", de ${p.owner}.`) }) }
  const rename = (p: ProjectInfo) => {
    const next = window.prompt('Nombre del proyecto', p.name)
    if (next === null || !next.trim() || next.trim() === p.name) return
    void run(async () => { await renameProject(p.id, next); if (current?.id === p.id) useProject.setState({ current: { id: p.id, name: next.trim() } }) }, 'Nombre cambiado.')
  }
  const remove = (p: ProjectInfo) => {
    if (!window.confirm(`¿Eliminar el proyecto "${p.name}"? No se puede recuperar.`)) return
    void run(async () => { await deleteProject(p.id); if (current?.id === p.id) closeProject() }, 'Proyecto eliminado.')
  }
  const share = (p: ProjectInfo, on: boolean) => run(async () => { await shareProject(p.id, on); setSharing(on ? p.id : null) }, on ? undefined : 'Ya no está compartido: el código dejó de servir.')
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.ok(`${what} copiado.`) } catch { toast.error('No se pudo copiar. Seleccionalo y copialo a mano.') }
  }

  return (
    <div className="proj">
      {/* lo que hay en pantalla */}
      <section className="proj__card proj__now">
        <h2>Lo que tenés abierto</h2>
        {current ? <>
          <p className="proj__name"><FolderOpen size={18} aria-hidden /> <strong>{current.name}</strong> <span className={`proj__st proj__st--${status}`}>{STATUS[status]}</span></p>
          {status === 'error' && <p className="login__error">{error}</p>}
          <p className="muted small">Los cambios se guardan solos a los pocos segundos. Podés cerrarlo, abrir otro y después seguir con este.</p>
          <div className="proj__btns">
            <Button icon={Save} onClick={() => run(async () => { if (!(await saveNow())) throw new CloudError('x', useProject.getState().error ?? 'No se pudo guardar.') }, 'Guardado.')} disabled={busy || status === 'saved'}>Guardar ahora</Button>
            <Button icon={X} onClick={() => run(async () => { await saveNow(); closeProject() }, 'Proyecto cerrado. Lo que ves en pantalla ya no se guarda en él.')} disabled={busy}>Cerrar el proyecto</Button>
          </div>
        </> : shared ? <>
          <p className="note note--blue">Estás viendo <b>{shared.name}</b>, que te compartió <b>{shared.owner}</b>. Es una copia: lo que cambies acá no cambia el proyecto de esa persona.</p>
          {edit && <SaveAs label="Guardarlo como proyecto mío" name={name} setName={setName} onSave={saveCurrentAs} busy={busy} placeholder={`${shared.name} (copia)`} />}
        </> : <>
          <p className="muted">{hasWork() ? 'Lo que estás armando no está guardado en ningún proyecto: solo está en esta computadora.' : 'No hay ningún proyecto abierto.'}</p>
          {edit && hasWork() && <SaveAs label="Guardarlo como proyecto" name={name} setName={setName} onSave={saveCurrentAs} busy={busy} placeholder="Nombre del proyecto (ej. Depósito Pérez)" />}
        </>}
      </section>

      {edit ? <>
        <section className="proj__card">
          <header className="proj__head"><h2>Mis proyectos</h2><Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Actualizar</Button></header>
          {loadError && <p className="login__error">{loadError}</p>}
          {list && !list.length && <p className="muted">Todavía no guardaste ninguno.</p>}
          <ul className="proj__list">
            {list?.map((p) => (
              <li key={p.id} className={current?.id === p.id ? 'is-open' : ''}>
                <div className="proj__row">
                  <div className="proj__info">
                    <strong>{p.name}</strong>
                    <span>guardado el {when(p.updated_at)}{current?.id === p.id ? ' · abierto ahora' : ''}{p.share_code ? ' · compartido' : ''}</span>
                  </div>
                  <div className="proj__btns">
                    {current?.id !== p.id && <Button size="sm" variant="primary" icon={FolderOpen} onClick={() => open(p)} disabled={busy}>Abrir</Button>}
                    <Button size="sm" icon={Share2} onClick={() => (p.share_code ? setSharing(sharing === p.id ? null : p.id) : share(p, true))} disabled={busy}>Compartir</Button>
                    <Button size="sm" icon={Pencil} onClick={() => rename(p)} disabled={busy} aria-label={`Cambiar el nombre de ${p.name}`}>Nombre</Button>
                    <Button size="sm" icon={Trash2} onClick={() => remove(p)} disabled={busy} aria-label={`Eliminar ${p.name}`}>Eliminar</Button>
                  </div>
                </div>
                {sharing === p.id && p.share_code && (
                  <div className="proj__share">
                    <p>Pasale este <b>código</b> a quien quieras. Lo pega en "Abrir con un código" y ve el proyecto (una copia: no te cambia el tuyo).</p>
                    <div className="proj__code">
                      <code>{p.share_code}</code>
                      <Button size="sm" icon={Copy} onClick={() => copy(p.share_code!, 'Código')}>Copiar código</Button>
                      <Button size="sm" icon={Link2} onClick={() => copy(shareLink(p.share_code!), 'Link')}>Copiar link</Button>
                    </div>
                    <button type="button" className="link-btn" onClick={() => share(p, false)}>Dejar de compartirlo</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="proj__cols">
          <section className="proj__card">
            <h2>Empezar un proyecto nuevo</h2>
            <p className="muted small">Arranca en blanco. {current ? 'El que tenés abierto queda guardado.' : ''}</p>
            <form className="proj__inline" onSubmit={(e) => { e.preventDefault(); startBlank() }}>
              <Field label="Nombre">{(id) => <Input id={id} value={blank} maxLength={80} onChange={(e) => setBlank(e.target.value)} placeholder="Ej. Depósito Pérez" />}</Field>
              <Button variant="primary" icon={Plus} type="submit" disabled={busy || !blank.trim()}>Crear</Button>
            </form>
          </section>
          <CodeBox code={code} setCode={setCode} onOpen={openCode} busy={busy} />
        </div>
      </> : <>
        <CodeBox code={code} setCode={setCode} onOpen={openCode} busy={busy} />
        <p className="note note--blue">Tu usuario es de <b>solo ver</b>: podés abrir los proyectos que te compartan con un código, pero no guardar proyectos propios. Si necesitás guardar, pedile al administrador que te cambie el permiso.</p>
      </>}
    </div>
  )
}

function SaveAs({ label, name, setName, onSave, busy, placeholder }: { label: string; name: string; setName(v: string): void; onSave(): void; busy: boolean; placeholder: string }) {
  return (
    <form className="proj__inline" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <Field label={label}>{(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />}</Field>
      <Button variant="primary" icon={Check} type="submit" disabled={busy || !name.trim()}>Guardar</Button>
    </form>
  )
}

function CodeBox({ code, setCode, onOpen, busy }: { code: string; setCode(v: string): void; onOpen(): void; busy: boolean }) {
  return (
    <section className="proj__card">
      <h2>Abrir con un código</h2>
      <p className="muted small">Si alguien te compartió un proyecto, pegá acá el código o el link que te pasó.</p>
      <form className="proj__inline" onSubmit={(e) => { e.preventDefault(); onOpen() }}>
        <Field label="Código o link">{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej. CZMJMVLN" autoComplete="off" />}</Field>
        <Button icon={FolderOpen} type="submit" disabled={busy || codeFrom(code).length !== 8}>Abrir</Button>
      </form>
    </section>
  )
}
