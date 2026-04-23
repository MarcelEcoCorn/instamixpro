import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_ING = { code:'', name:'', status:'aktywny' }

export default function Skladniki() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [suppliers, setSuppliers] = useState({})

  const [ingModal, setIngModal] = useState(false)
  const [ingForm, setIngForm] = useState(EMPTY_ING)
  const [ingEdit, setIngEdit] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('ingredients').select('*').order('code')
    setIngredients(data || [])
    setLoading(false)
  }

  async function loadSuppliers(ingredientId) {
    if (expandedId === ingredientId) { setExpandedId(null); return }
    const { data } = await supabase
      .from('ingredient_batches')
      .select('supplier_name, invoice_number, received_date, quantity_kg, delivery_lot')
      .eq('ingredient_id', ingredientId)
      .not('supplier_name', 'is', null)
      .order('received_date', { ascending: false })
    const grouped = {}
    for (const b of (data || [])) {
      const key = b.supplier_name
      if (!grouped[key]) grouped[key] = { supplier_name: key, deliveries: 0, last_delivery: b.received_date, total_kg: 0 }
      grouped[key].deliveries++
      grouped[key].total_kg += parseFloat(b.quantity_kg || 0)
      if (b.received_date > grouped[key].last_delivery) grouped[key].last_delivery = b.received_date
    }
    setSuppliers(p => ({ ...p, [ingredientId]: Object.values(grouped) }))
    setExpandedId(ingredientId)
  }

  const filtered = ingredients.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase())
  )

  const f = (k, v) => setIngForm(p => ({ ...p, [k]: v }))

  function openNewIng() { setIngForm(EMPTY_ING); setIngEdit(false); setError(''); setIngModal(true) }
  function openEditIng(ing) { setIngForm({ id: ing.id, code: ing.code, name: ing.name, status: ing.status }); setIngEdit(true); setError(''); setIngModal(true) }

  async function saveIng() {
    if (!ingForm.code || !ingForm.name) { setError('Kod i nazwa są wymagane'); return }
    setSaving(true); setError('')
    if (ingEdit) {
      const { error: err } = await supabase.from('ingredients').update({ code: ingForm.code, name: ingForm.name, status: ingForm.status, updated_at: new Date().toISOString() }).eq('id', ingForm.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('ingredients').insert({ code: ingForm.code, name: ingForm.name, status: ingForm.status, created_by: profile?.id })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setIngModal(false); load()
  }

  async function deleteIng(ing) {
    await supabase.from('ingredients').delete().eq('id', ing.id)
    setConfirmDelete(null); load()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Składniki</div><div className="page-sub">Dostęp: Admin</div></div>
        <div className="flex">
          <input className="search" placeholder="Szukaj składnika..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={openNewIng}>+ Nowy składnik</button>}
        </div>
      </div>

      <div className="info-box" style={{ marginBottom: 10, fontSize: 12 }}>
        Kliknij ▼ przy składniku aby zobaczyć listę dostawców z historii przyjęć.
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 280px)' }}>
        <table>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width: 32 }}></th>
            <th>Kod</th><th>Nazwa składnika</th><th>Status</th><th>Dostawców</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(ing => (
              <React.Fragment key={ing.id}>
                <tr>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => loadSuppliers(ing.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#5F5E5A', padding: '2px 4px' }}>
                      {expandedId === ing.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{ing.code}</span></td>
                  <td style={{ fontWeight: 500 }}>{ing.name}</td>
                  <td><span className={`badge ${ing.status === 'aktywny' ? 'b-ok' : ing.status === 'wstrzymany' ? 'b-err' : 'b-gray'}`}>{ing.status}</span></td>
                  <td className="muted">{suppliers[ing.id]?.length ?? '—'}</td>
                  <td>
                    {isAdmin && (
                      <div className="flex" style={{ gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => openEditIng(ing)}>Edytuj</button>
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(ing)}>Usuń</button>
                      </div>
                    )}
                  </td>
                </tr>
                {expandedId === ing.id && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0, background: '#F9F8F5' }}>
                      <div style={{ padding: '10px 16px 12px 40px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#0F6E56', marginBottom: 8 }}>Dostawcy z przyjęć — {ing.name}</div>
                        {!suppliers[ing.id] || suppliers[ing.id].length === 0 ? (
                          <div className="muted" style={{ fontSize: 12 }}>Brak przyjęć z przypisanym dostawcą</div>
                        ) : (
                          <table style={{ width: 'auto', minWidth: 500 }}>
                            <thead><tr>
                              <th>Dostawca</th>
                              <th style={{ textAlign:'center' }}>Liczba dostaw</th>
                              <th style={{ textAlign:'right' }}>Łącznie (kg)</th>
                              <th>Ostatnia dostawa</th>
                            </tr></thead>
                            <tbody>
                              {suppliers[ing.id].map((sup, idx) => (
                                <tr key={idx}>
                                  <td style={{ fontWeight: 500 }}>{sup.supplier_name}</td>
                                  <td style={{ textAlign:'center' }}><span className="badge b-info">{sup.deliveries}</span></td>
                                  <td style={{ textAlign:'right', fontWeight:500 }}>{sup.total_kg.toFixed(3)} kg</td>
                                  <td className="muted">{sup.last_delivery}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${ingModal ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setIngModal(false)}>
        <div className="modal" style={{ maxWidth: 400 }}>
          <div className="modal-title">{ingEdit ? 'Edytuj składnik' : 'Nowy składnik'}</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom: 10 }}><label>Kod składnika *</label><input value={ingForm.code} onChange={e => f('code', e.target.value)} placeholder="SKL-XXX" /></div>
          <div style={{ marginBottom: 10 }}><label>Nazwa składnika *</label><input value={ingForm.name} onChange={e => f('name', e.target.value)} /></div>
          <div><label>Status</label>
            <select value={ingForm.status} onChange={e => f('status', e.target.value)}>
              <option value="aktywny">Aktywny</option>
              <option value="wstrzymany">Wstrzymany</option>
              <option value="zarchiwizowany">Zarchiwizowany</option>
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setIngModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveIng} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${confirmDelete ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-title">Usuń składnik</div>
          <div className="warn-box">Czy na pewno chcesz usunąć <b>{confirmDelete?.code} — {confirmDelete?.name}</b>?<br />Zostaną usunięci również wszyscy dostawcy tego składnika.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteIng(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
