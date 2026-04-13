import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_FORM = { number: '', name: '', notes: '' }

export default function Klienci() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*, recipes(id)').order('number')
    setClients(data || [])
    setLoading(false)
  }

  const filtered = clients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.number.toLowerCase().includes(search.toLowerCase())
  )

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() { setForm(EMPTY_FORM); setEditMode(false); setError(''); setModal(true) }
  function openEdit(c) { setForm({ id: c.id, number: c.number, name: c.name, notes: c.notes||'' }); setEditMode(true); setError(''); setModal(true) }

  async function save() {
    if (!form.number) { setError('Numer klienta jest wymagany'); return }
    if (!form.name) { setError('Nazwa klienta jest wymagana'); return }
    setSaving(true); setError('')
    if (editMode) {
      const { error: err } = await supabase.from('clients').update({
        number: form.number, name: form.name, notes: form.notes||null, updated_at: new Date().toISOString()
      }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('recipes').update({ client: form.name }).eq('client_id', form.id)
    } else {
      const { error: err } = await supabase.from('clients').insert({
        number: form.number, name: form.name, notes: form.notes||null
      })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function deleteClient(c) {
    await supabase.from('recipes').update({ client_id: null }).eq('client_id', c.id)
    await supabase.from('clients').delete().eq('id', c.id)
    setConfirmDelete(null); load()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Kartoteka klientów</div><div className="page-sub">Dostęp: Admin</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowy klient</button>}
        </div>
      </div>

      <div className="card-0">
        <table>
          <thead><tr>
            <th style={{ width:120 }}>Nr klienta</th>
            <th>Nazwa klienta</th>
            <th>Uwagi</th>
            <th style={{ width:80, textAlign:'center' }}>Receptur</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(c => (
              <tr key={c.id}>
                <td><span className="lot">{c.number}</span></td>
                <td style={{ fontWeight:500 }}>{c.name}</td>
                <td className="muted">{c.notes||'—'}</td>
                <td style={{ textAlign:'center' }}><span className="badge b-info">{c.recipes?.length||0}</span></td>
                <td>
                  {isAdmin && (
                    <div className="flex" style={{ gap:4 }}>
                      <button className="btn btn-sm" onClick={() => openEdit(c)}>Edytuj</button>
                      <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(c)}>Usuń</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={5} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak klientów</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:440 }}>
          <div className="modal-title">{editMode?'Edytuj klienta':'Nowy klient'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Numer klienta *</label><input value={form.number} onChange={e => f('number',e.target.value)} placeholder="np. K-001" /></div>
            <div><label>Nazwa klienta *</label><input value={form.name} onChange={e => f('name',e.target.value)} placeholder="Nazwa firmy" /></div>
          </div>
          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Dodaj klienta'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń klienta</div>
          <div className="warn-box">Czy na pewno chcesz usunąć klienta <b>{confirmDelete?.number} — {confirmDelete?.name}</b>?<br/>Receptury tego klienta zostaną odłączone ale nie usunięte.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteClient(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
