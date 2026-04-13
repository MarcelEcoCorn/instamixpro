import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_FORM = { code:'', name:'', version:'v1', status:'w_przegladzie', production_line:'zwykla', approved_at:'', notes:'', client:'', client_id:'' }

export default function Receptury() {
  const { profile } = useAuth()
  const canEdit = ['admin','technolog'].includes(profile?.role)

  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [dupModal, setDupModal] = useState(false)
  const [dupSource, setDupSource] = useState(null)
  const [dupForm, setDupForm] = useState({ code:'', client:'', client_id:'' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState([{ ingredient_id:'', percentage:'' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: r }, { data: i }, { data: c }] = await Promise.all([
      supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').order('code'),
      supabase.from('ingredients').select('id,code,name,has_allergen,allergen_type').eq('status','aktywny').order('code'),
      supabase.from('clients').select('id,number,name').order('number')
    ])
    setRecipes(r || [])
    setIngredients(i || [])
    setClients(c || [])
    setLoading(false)
  }

  const filtered = recipes.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase()) ||
    (r.client||'').toLowerCase().includes(search.toLowerCase())
  )

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() { setEditMode(false); setForm(EMPTY_FORM); setItems([{ ingredient_id:'', percentage:'' }]); setError(''); setModal(true) }

  function openEdit(recipe) {
    setEditMode(true)
    setForm({ id:recipe.id, code:recipe.code, name:recipe.name, version:recipe.version, status:recipe.status, production_line:recipe.production_line, approved_at:recipe.approved_at||'', notes:recipe.notes||'', client:recipe.client||'', client_id:recipe.client_id||'' })
    const sorted = (recipe.recipe_items||[]).sort((a,b) => a.sort_order-b.sort_order)
    setItems(sorted.length > 0 ? sorted.map(it => ({ id:it.id, ingredient_id:it.ingredient_id, percentage:it.percentage })) : [{ ingredient_id:'', percentage:'' }])
    setError(''); setModal(true)
  }

  function openDuplicate(recipe) {
    setDupSource(recipe)
    setDupForm({ code:'', client: recipe.client||'', client_id: recipe.client_id||'' })
    setError(''); setDupModal(true)
  }

  async function saveDuplicate() {
    if (!dupForm.code) { setError('Podaj nowy kod dla duplikatu'); return }
    if (dupForm.code === dupSource.code) { setError('Nowy kod musi być inny niż oryginalny'); return }
    setSaving(true); setError('')
    const { data: rec, error: err } = await supabase.from('recipes').insert({
      code: dupForm.code, name: dupSource.name, version: dupSource.version,
      status: 'w_przegladzie', production_line: dupSource.production_line,
      approved_at: null, notes: dupSource.notes,
      client: dupForm.client || null, client_id: dupForm.client_id || null,
      approved_by: profile?.id
    }).select().single()
    if (err) { setError(err.message); setSaving(false); return }
    const srcItems = (dupSource.recipe_items||[]).filter(it => it.ingredient_id)
    if (srcItems.length > 0) {
      await supabase.from('recipe_items').insert(
        srcItems.map((it, idx) => ({ recipe_id: rec.id, ingredient_id: it.ingredient_id, percentage: it.percentage, sort_order: idx }))
      )
    }
    setSaving(false); setDupModal(false); load()
  }

  function addItem() { setItems(p => [...p, { ingredient_id:'', percentage:'' }]) }
  function removeItem(i) { setItems(p => p.filter((_,idx) => idx!==i)) }
  function updateItem(i, k, v) { setItems(p => p.map((it,idx) => idx===i ? {...it,[k]:v} : it)) }
  const totalPct = items.reduce((s,it) => s+(parseFloat(it.percentage)||0), 0)
  const pctOk = Math.abs(totalPct-100) < 0.01

  async function save() {
    if (!form.code || !form.name) { setError('Kod i nazwa są wymagane'); return }
    if (!pctOk) { setError(`Suma udziałów musi wynosić 100% (aktualnie: ${totalPct.toFixed(3)}%)`); return }
    const validItems = items.filter(it => it.ingredient_id && it.percentage)
    if (validItems.length === 0) { setError('Dodaj co najmniej jeden składnik'); return }
    setSaving(true); setError('')
    const payload = { code:form.code, name:form.name, version:form.version, status:form.status, production_line:form.production_line, approved_at:form.approved_at||null, notes:form.notes||null, client:form.client||null, client_id:form.client_id||null, approved_by:profile?.id, updated_at:new Date().toISOString() }
    let recipeId = form.id
    if (editMode) {
      const { error: err } = await supabase.from('recipes').update(payload).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('recipe_items').delete().eq('recipe_id', form.id)
    } else {
      const { data: rec, error: err } = await supabase.from('recipes').insert(payload).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      recipeId = rec.id
    }
    await supabase.from('recipe_items').insert(
      validItems.map((it,idx) => ({ recipe_id:recipeId, ingredient_id:it.ingredient_id, percentage:parseFloat(it.percentage), sort_order:idx }))
    )
    setSaving(false); setModal(false); load()
  }

  async function quickStatusChange(recipe, newStatus) {
    await supabase.from('recipes').update({ status:newStatus, updated_at:new Date().toISOString() }).eq('id', recipe.id)
    load()
  }

  async function deleteRecipe(recipe) {
    await supabase.from('recipes').delete().eq('id', recipe.id)
    setConfirmDelete(null); load()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Receptury</div><div className="page-sub">Dostęp: Admin, Technolog</div></div>
        <div className="flex">
          <input className="search" placeholder="Szukaj receptury lub klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:240 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowa receptura</button>}
        </div>
      </div>

      <div className="card-0">
        <table>
          <thead><tr>
            <th style={{ width:32 }}></th>
            <th>Kod</th><th>Nazwa mieszanki</th><th>Wersja</th><th>Linia</th>
            <th>Klient</th><th>Skł.</th><th>Status</th><th>Data zatw.</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(r => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={{ textAlign:'center' }}>
                    <button onClick={() => setExpandedId(expandedId===r.id ? null : r.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                      {expandedId===r.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{r.code}</span></td>
                  <td style={{ fontWeight:500 }}>{r.name}</td>
                  <td><span className="badge b-info">{r.version}</span></td>
                  <td><span className={`badge ${r.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{r.production_line}</span></td>
                  <td style={{ fontSize:12 }}>
                    {r.client
                      ? <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'1px 8px', borderRadius:999, fontSize:11, fontWeight:500 }}>{r.client}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td>{r.recipe_items?.length||0}</td>
                  <td>
                    {canEdit ? (
                      <select value={r.status} onChange={e => quickStatusChange(r, e.target.value)}
                        style={{ fontSize:11, padding:'2px 6px', border:'0.5px solid #D3D1C7', borderRadius:6, background:r.status==='dopuszczona'?'#E1F5EE':r.status==='w_przegladzie'?'#FAEEDA':'#F1EFE8', color:r.status==='dopuszczona'?'#085041':r.status==='w_przegladzie'?'#633806':'#444441', cursor:'pointer' }}>
                        <option value="dopuszczona">Dopuszczona</option>
                        <option value="w_przegladzie">W przeglądzie</option>
                        <option value="zarchiwizowana">Zarchiwizowana</option>
                      </select>
                    ) : (
                      <span className={`badge ${r.status==='dopuszczona'?'b-ok':r.status==='w_przegladzie'?'b-warn':'b-gray'}`}>{r.status}</span>
                    )}
                  </td>
                  <td className="muted">{r.approved_at||'—'}</td>
                  <td>
                    <div className="flex" style={{ gap:4 }}>
                      {canEdit && <button className="btn btn-sm" onClick={() => openEdit(r)}>Edytuj</button>}
                      {canEdit && <button className="btn btn-sm" style={{ background:'#EEEDFE', color:'#3C3489', border:'0.5px solid #AFA9EC' }} onClick={() => openDuplicate(r)}>Duplikuj</button>}
                      {canEdit && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(r)}>Usuń</button>}
                    </div>
                  </td>
                </tr>
                {expandedId===r.id && (
                  <tr>
                    <td colSpan={10} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'10px 16px 12px 40px' }}>
                        {r.client && (
                          <div style={{ marginBottom:8 }}>
                            <span className="muted" style={{ marginRight:6 }}>Klient:</span>
                            <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 8px', borderRadius:999, fontSize:12 }}>{r.client}</span>
                          </div>
                        )}
                        {r.notes && <div className="muted" style={{ marginBottom:8, fontSize:12 }}>Uwagi: {r.notes}</div>}
                        <table style={{ width:'auto', minWidth:500 }}>
                          <thead><tr>
                            <th>Kod skł.</th><th>Nazwa składnika</th>
                            <th style={{ textAlign:'right' }}>Udział %</th>
                            <th style={{ textAlign:'right' }}>Na 100 kg</th>
                            <th>Alergen</th>
                          </tr></thead>
                          <tbody>
                            {(r.recipe_items||[]).sort((a,b)=>a.sort_order-b.sort_order).map(it => (
                              <tr key={it.id}>
                                <td><span className="lot">{it.ingredients?.code}</span></td>
                                <td>{it.ingredients?.name}</td>
                                <td style={{ textAlign:'right', fontWeight:500 }}>{parseFloat(it.percentage).toFixed(3)}%</td>
                                <td style={{ textAlign:'right' }}>{parseFloat(it.percentage).toFixed(3)} kg</td>
                                <td>{it.ingredients?.has_allergen ? <span className="badge b-err">{it.ingredients.allergen_type}</span> : <span className="muted">—</span>}</td>
                              </tr>
                            ))}
                            <tr style={{ background:'#E1F5EE' }}>
                              <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA</td>
                              <td style={{ fontWeight:500, textAlign:'right' }}>{(r.recipe_items||[]).reduce((s,it)=>s+parseFloat(it.percentage),0).toFixed(3)}%</td>
                              <td style={{ fontWeight:500, textAlign:'right' }}>100.000 kg</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal dodaj/edytuj */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:600 }}>
          <div className="modal-title">{editMode?'Edytuj recepturę':'Nowa receptura'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod mieszanki</label><input value={form.code} onChange={e => f('code',e.target.value)} placeholder="MIX-XXX" /></div>
            <div><label>Nazwa mieszanki</label><input value={form.name} onChange={e => f('name',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Wersja</label><input value={form.version} onChange={e => f('version',e.target.value)} placeholder="v1" /></div>
            <div><label>Linia produkcyjna</label>
              <select value={form.production_line} onChange={e => f('production_line',e.target.value)}>
                <option value="zwykla">Zwykła</option><option value="bezglutenowa">Bezglutenowa</option>
              </select>
            </div>
            <div><label>Status</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                <option value="w_przegladzie">W przeglądzie</option>
                <option value="dopuszczona">Dopuszczona</option>
                <option value="zarchiwizowana">Zarchiwizowana</option>
              </select>
            </div>
          </div>
          <div className="fr">
            <div><label>Data zatwierdzenia</label><input type="date" value={form.approved_at} onChange={e => f('approved_at',e.target.value)} /></div>
            <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Klient</label>
            <select value={form.client_id||''} onChange={e => {
              const c = clients.find(x => x.id === e.target.value)
              f('client_id', e.target.value)
              f('client', c ? c.name : '')
            }}>
              <option value="">— brak / wybierz klienta —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
            </select>
          </div>
          <div className="divider"/>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontWeight:500, fontSize:13 }}>Składniki receptury</span>
            <span style={{ fontSize:12, color:pctOk?'#085041':'#A32D2D', fontWeight:500 }}>
              Suma: {totalPct.toFixed(3)}% {pctOk?'✓':`(brakuje ${(100-totalPct).toFixed(3)}%)`}
            </span>
          </div>
          {items.map((it,idx) => (
            <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 110px 32px', gap:8, marginBottom:8, alignItems:'end' }}>
              <div>
                {idx===0 && <label>Składnik</label>}
                <select value={it.ingredient_id} onChange={e => updateItem(idx,'ingredient_id',e.target.value)}>
                  <option value="">— wybierz —</option>
                  {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
              </div>
              <div>
                {idx===0 && <label>Udział %</label>}
                <input type="number" step="0.001" min="0" max="100" value={it.percentage} onChange={e => updateItem(idx,'percentage',e.target.value)} placeholder="0.000" />
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)} style={{ height:34 }}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addItem} style={{ marginBottom:4 }}>+ Dodaj składnik</button>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Zapisz recepturę'}</button>
          </div>
        </div>
      </div>

      {/* Modal duplikowanie */}
      <div className={`modal-overlay ${dupModal?'open':''}`} onClick={e => e.target===e.currentTarget && setDupModal(false)}>
        <div className="modal" style={{ maxWidth:440 }}>
          <div className="modal-title">Duplikuj recepturę</div>
          <div className="info-box" style={{ marginBottom:12 }}>
            Duplikujesz: <b>{dupSource?.code} — {dupSource?.name}</b><br/>
            Duplikat otrzyma status "W przeglądzie" i będzie wymagał zatwierdzenia.
          </div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}>
            <label>Nowy kod mieszanki * (musi być inny niż oryginał)</label>
            <input value={dupForm.code} onChange={e => setDupForm(p=>({...p,code:e.target.value}))} placeholder={`np. ${dupSource?.code}-B`} />
          </div>
          <div>
            <label>Klient dla duplikatu</label>
            <select value={dupForm.client_id||''} onChange={e => {
              const c = clients.find(x => x.id === e.target.value)
              setDupForm(p => ({...p, client_id: e.target.value, client: c ? c.name : ''}))
            }}>
              <option value="">— brak / wybierz klienta —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setDupModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveDuplicate} disabled={saving}>{saving?'Duplikowanie...':'Utwórz duplikat'}</button>
          </div>
        </div>
      </div>

      {/* Potwierdzenie usunięcia */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń recepturę</div>
          <div className="warn-box">Czy na pewno chcesz usunąć <b>{confirmDelete?.code} — {confirmDelete?.name}</b>?<br/>Historia produkcji pozostanie nienaruszona.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteRecipe(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
