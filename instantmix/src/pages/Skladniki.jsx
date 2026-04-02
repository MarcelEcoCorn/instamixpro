import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_ING = { code:'', name:'', status:'aktywny' }
const EMPTY_SUP = { supplier_name:'', producer_name:'', country_of_origin:'', has_allergen:false, allergen_type:'', gmo:false, spec_number:'', spec_approved_at:'', is_active:true }

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

  const [supModal, setSupModal] = useState(false)
  const [supForm, setSupForm] = useState(EMPTY_SUP)
  const [supEdit, setSupEdit] = useState(false)
  const [supIngId, setSupIngId] = useState(null)

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
    if (suppliers[ingredientId]) {
      setExpandedId(expandedId === ingredientId ? null : ingredientId)
      return
    }
    const { data } = await supabase.from('ingredient_suppliers').select('*').eq('ingredient_id', ingredientId).order('supplier_name')
    setSuppliers(p => ({ ...p, [ingredientId]: data || [] }))
    setExpandedId(ingredientId)
  }

  async function refreshSuppliers(ingredientId) {
    const { data } = await supabase.from('ingredient_suppliers').select('*').eq('ingredient_id', ingredientId).order('supplier_name')
    setSuppliers(p => ({ ...p, [ingredientId]: data || [] }))
  }

  const filtered = ingredients.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase())
  )

  const f = (k, v) => setIngForm(p => ({ ...p, [k]: v }))
  const sf = (k, v) => setSupForm(p => ({ ...p, [k]: v }))

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

  function openNewSup(ingredientId) {
    setSupIngId(ingredientId); setSupForm(EMPTY_SUP); setSupEdit(false); setError(''); setSupModal(true)
  }
  function openEditSup(sup, ingredientId) {
    setSupIngId(ingredientId)
    setSupForm({ id: sup.id, supplier_name: sup.supplier_name, producer_name: sup.producer_name || '', country_of_origin: sup.country_of_origin || '', has_allergen: sup.has_allergen, allergen_type: sup.allergen_type || '', gmo: sup.gmo, spec_number: sup.spec_number || '', spec_approved_at: sup.spec_approved_at || '', is_active: sup.is_active })
    setSupEdit(true); setError(''); setSupModal(true)
  }

  async function saveSup() {
    if (!supForm.supplier_name) { setError('Nazwa dostawcy jest wymagana'); return }
    setSaving(true); setError('')
    const payload = { ingredient_id: supIngId, supplier_name: supForm.supplier_name, producer_name: supForm.producer_name || null, country_of_origin: supForm.country_of_origin || null, has_allergen: supForm.has_allergen, allergen_type: supForm.has_allergen ? (supForm.allergen_type || null) : null, gmo: supForm.gmo, spec_number: supForm.spec_number || null, spec_approved_at: supForm.spec_approved_at || null, is_active: supForm.is_active, updated_at: new Date().toISOString() }
    if (supEdit) {
      const { error: err } = await supabase.from('ingredient_suppliers').update(payload).eq('id', supForm.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('ingredient_suppliers').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setSupModal(false); refreshSuppliers(supIngId)
  }

  async function deleteSup(sup, ingredientId) {
    await supabase.from('ingredient_suppliers').delete().eq('id', sup.id)
    refreshSuppliers(ingredientId)
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
        Kliknij ▼ przy składniku aby zobaczyć i zarządzać listą dostawców. Każdy składnik może mieć wielu dostawców z osobnymi specyfikacjami.
      </div>

      <div className="card-0">
        <table>
          <thead><tr>
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: '#0F6E56' }}>Dostawcy — {ing.name}</span>
                          {isAdmin && <button className="btn btn-sm btn-primary" onClick={() => openNewSup(ing.id)}>+ Dodaj dostawcę</button>}
                        </div>
                        {!suppliers[ing.id] || suppliers[ing.id].length === 0 ? (
                          <div className="muted" style={{ fontSize: 12 }}>Brak dostawców — dodaj pierwszego dostawcę</div>
                        ) : (
                          <table style={{ width: '100%' }}>
                            <thead><tr>
                              <th>Dostawca</th><th>Producent</th><th>Kraj</th>
                              <th>Alergen</th><th>GMO</th><th>Nr spec.</th><th>Data zatw.</th><th>Status</th>
                              {isAdmin && <th></th>}
                            </tr></thead>
                            <tbody>
                              {suppliers[ing.id].map(sup => (
                                <tr key={sup.id}>
                                  <td style={{ fontWeight: 500 }}>{sup.supplier_name}</td>
                                  <td className="muted">{sup.producer_name || '—'}</td>
                                  <td className="muted">{sup.country_of_origin || '—'}</td>
                                  <td>{sup.has_allergen ? <span className="badge b-err">{sup.allergen_type}</span> : <span className="muted">Brak</span>}</td>
                                  <td>{sup.gmo ? <span className="badge b-warn">TAK</span> : <span className="badge b-ok">NIE</span>}</td>
                                  <td className="muted">{sup.spec_number || '—'}</td>
                                  <td className="muted">{sup.spec_approved_at || '—'}</td>
                                  <td><span className={`badge ${sup.is_active ? 'b-ok' : 'b-gray'}`}>{sup.is_active ? 'Aktywny' : 'Nieaktywny'}</span></td>
                                  {isAdmin && (
                                    <td>
                                      <div className="flex" style={{ gap: 4 }}>
                                        <button className="btn btn-sm" onClick={() => openEditSup(sup, ing.id)}>Edytuj</button>
                                        <button className="btn btn-sm btn-danger" onClick={() => deleteSup(sup, ing.id)}>Usuń</button>
                                      </div>
                                    </td>
                                  )}
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

      {/* Modal składnik */}
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

      {/* Modal dostawca */}
      <div className={`modal-overlay ${supModal ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setSupModal(false)}>
        <div className="modal">
          <div className="modal-title">{supEdit ? 'Edytuj dostawcę' : 'Nowy dostawca'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Nazwa dostawcy *</label><input value={supForm.supplier_name} onChange={e => sf('supplier_name', e.target.value)} placeholder="np. StarChem Sp. z o.o." /></div>
            <div><label>Producent</label><input value={supForm.producer_name} onChange={e => sf('producer_name', e.target.value)} placeholder="np. ChemCorp GmbH" /></div>
          </div>
          <div className="fr3">
            <div><label>Kraj pochodzenia</label><input value={supForm.country_of_origin} onChange={e => sf('country_of_origin', e.target.value)} placeholder="np. PL, DE, NL" /></div>
            <div><label>Alergen</label>
              <select value={supForm.has_allergen ? 'tak' : 'nie'} onChange={e => sf('has_allergen', e.target.value === 'tak')}>
                <option value="nie">NIE</option><option value="tak">TAK</option>
              </select>
            </div>
            <div><label>GMO</label>
              <select value={supForm.gmo ? 'tak' : 'nie'} onChange={e => sf('gmo', e.target.value === 'tak')}>
                <option value="nie">NIE</option><option value="tak">TAK</option>
              </select>
            </div>
          </div>
          {supForm.has_allergen && (
            <div style={{ marginBottom: 10 }}><label>Typ alergenu</label><input value={supForm.allergen_type} onChange={e => sf('allergen_type', e.target.value)} placeholder="np. Gluten, Mleko, Orzechy" /></div>
          )}
          <div className="fr">
            <div><label>Nr specyfikacji</label><input value={supForm.spec_number} onChange={e => sf('spec_number', e.target.value)} placeholder="SPEC-2025-XXX" /></div>
            <div><label>Data zatwierdzenia spec.</label><input type="date" value={supForm.spec_approved_at} onChange={e => sf('spec_approved_at', e.target.value)} /></div>
          </div>
          <div><label>Status dostawcy</label>
            <select value={supForm.is_active ? 'tak' : 'nie'} onChange={e => sf('is_active', e.target.value === 'tak')}>
              <option value="tak">Aktywny</option><option value="nie">Nieaktywny</option>
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setSupModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveSup} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz dostawcę'}</button>
          </div>
        </div>
      </div>

      {/* Potwierdzenie usunięcia */}
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
