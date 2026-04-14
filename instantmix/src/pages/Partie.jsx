import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_BATCH = { ingredient_id:'', supplier_name:'', spec_number:'', spec_approved_at:'', delivery_lot:'', production_date:'', expiry_date:'', received_date: new Date().toISOString().slice(0,10), quantity_kg:'', invoice_number:'', unit_price_pln:'', warehouse_location:'', status:'dopuszczona' }
const EMPTY_CORR = { correction_type:'ubytek_uszkodzenie', delta_kg:'', reason:'', event_date: new Date().toISOString().slice(0,10) }
const CORR_LABELS = { ubytek_uszkodzenie:'Ubytek / uszkodzenie', utylizacja_pelna:'Utylizacja (pełna)', korekta_inwentury:'Korekta inwentury', niedowazenie_dostawy:'Niedoważenie dostawy', zwrot_do_dostawcy:'Zwrot do dostawcy' }

export default function Partie() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [batches, setBatches] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [corrections, setCorrections] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [corrModal, setCorrModal] = useState(false)
  const [editCorrModal, setEditCorrModal] = useState(false)

  const [selectedBatch, setSelectedBatch] = useState(null)
  const [form, setForm] = useState(EMPTY_BATCH)
  const [editForm, setEditForm] = useState({})
  const [corrForm, setCorrForm] = useState(EMPTY_CORR)
  const [editCorrForm, setEditCorrForm] = useState({})

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: b }, { data: i }, { data: c }] = await Promise.all([
      supabase.from('ingredient_batches').select('*, ingredients(code,name)').order('received_date', { ascending: false }),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('stock_corrections').select('*').order('created_at', { ascending: false })
    ])
    setBatches(b || [])
    setIngredients(i || [])
    setCorrections(c || [])
    setLoading(false)
  }

  function effectiveQty(batch) {
    const corrs = corrections.filter(c => c.ingredient_batch_id === batch.id)
    return parseFloat(batch.quantity_kg) + corrs.reduce((s, c) => s + parseFloat(c.delta_kg), 0)
  }

  function effectiveValue(batch) {
    const qty = effectiveQty(batch)
    const price = parseFloat(batch.unit_price_pln || 0)
    return price > 0 ? qty * price : null
  }

  const filtered = batches.filter(b =>
    (b.ingredients?.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.ingredients?.code || '').toLowerCase().includes(search.toLowerCase()) ||
    b.delivery_lot.toLowerCase().includes(search.toLowerCase())
  )

  const totalValue = filtered.reduce((s, b) => {
    const v = effectiveValue(b)
    return v ? s + v : s
  }, 0)

  const stats = {
    total: batches.length,
    expiringSoon: batches.filter(b => { const d = new Date(b.expiry_date); return (d-new Date()) < 30*24*3600*1000 && d > new Date() && b.status==='dopuszczona' }).length,
    blocked: batches.filter(b => b.status==='wstrzymana').length,
    totalTons: (batches.reduce((s,b) => s+effectiveQty(b), 0)/1000).toFixed(1)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))
  const cf = (k, v) => setCorrForm(p => ({ ...p, [k]: v }))
  const ecf = (k, v) => setEditCorrForm(p => ({ ...p, [k]: v }))

  async function saveBatch() {
    if (!form.ingredient_id || !form.delivery_lot || !form.quantity_kg) { setError('Uzupełnij wymagane pola'); return }
    setSaving(true); setError('')
    const totalValue = form.unit_price_pln && form.quantity_kg ? (parseFloat(form.unit_price_pln) * parseFloat(form.quantity_kg)).toFixed(2) : null
    const { error: err } = await supabase.from('ingredient_batches').insert({
      ...form,
      quantity_kg: parseFloat(form.quantity_kg),
      unit_price_pln: form.unit_price_pln ? parseFloat(form.unit_price_pln) : null,
      total_value_pln: totalValue ? parseFloat(totalValue) : null,
      supplier_name: form.supplier_name || null,
      spec_number: form.spec_number || null,
      spec_approved_at: form.spec_approved_at || null,
      created_by: profile?.id
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(false); load()
  }

  function openEdit(batch) {
    setEditForm({ id:batch.id, delivery_lot:batch.delivery_lot, supplier_name:batch.supplier_name||'', spec_number:batch.spec_number||'', spec_approved_at:batch.spec_approved_at||'', production_date:batch.production_date||'', expiry_date:batch.expiry_date||'', received_date:batch.received_date||'', quantity_kg:batch.quantity_kg, invoice_number:batch.invoice_number||'', unit_price_pln:batch.unit_price_pln||'', warehouse_location:batch.warehouse_location||'', status:batch.status })
    setError(''); setEditModal(true)
  }

  async function saveEdit() {
    if (!editForm.delivery_lot) { setError('Nr partii dostawy jest wymagany'); return }
    setSaving(true); setError('')
    const totalValue = editForm.unit_price_pln && editForm.quantity_kg ? (parseFloat(editForm.unit_price_pln) * parseFloat(editForm.quantity_kg)).toFixed(2) : null
    const { error: err } = await supabase.from('ingredient_batches').update({
      delivery_lot:editForm.delivery_lot, supplier_name:editForm.supplier_name||null, spec_number:editForm.spec_number||null, spec_approved_at:editForm.spec_approved_at||null, production_date:editForm.production_date||null, expiry_date:editForm.expiry_date||null, received_date:editForm.received_date||null, quantity_kg:parseFloat(editForm.quantity_kg), invoice_number:editForm.invoice_number||null, unit_price_pln:editForm.unit_price_pln?parseFloat(editForm.unit_price_pln):null, total_value_pln:totalValue?parseFloat(totalValue):null, warehouse_location:editForm.warehouse_location||null, status:editForm.status, updated_at:new Date().toISOString()
    }).eq('id', editForm.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditModal(false); load()
  }

  function openCorr(batch) { setSelectedBatch(batch); setCorrForm(EMPTY_CORR); setError(''); setCorrModal(true) }

  async function saveCorrection() {
    if (!corrForm.reason) { setError('Podaj przyczynę korekty'); return }
    setSaving(true); setError('')
    const delta = corrForm.correction_type==='utylizacja_pelna' ? -effectiveQty(selectedBatch) : parseFloat(corrForm.delta_kg)
    const { error: err } = await supabase.from('stock_corrections').insert({ ingredient_batch_id:selectedBatch.id, correction_type:corrForm.correction_type, delta_kg:delta, reason:corrForm.reason, event_date:corrForm.event_date, approved_by:profile?.id })
    if (!err && corrForm.correction_type==='utylizacja_pelna') await supabase.from('ingredient_batches').update({ status:'wstrzymana' }).eq('id', selectedBatch.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setCorrModal(false); load()
  }

  function openEditCorr(corr) {
    setEditCorrForm({ id: corr.id, correction_type: corr.correction_type, delta_kg: corr.delta_kg, reason: corr.reason, event_date: corr.event_date })
    setError(''); setEditCorrModal(true)
  }

  async function saveEditCorr() {
    if (!editCorrForm.reason) { setError('Podaj przyczynę korekty'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('stock_corrections').update({
      correction_type: editCorrForm.correction_type,
      delta_kg: parseFloat(editCorrForm.delta_kg),
      reason: editCorrForm.reason,
      event_date: editCorrForm.event_date
    }).eq('id', editCorrForm.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditCorrModal(false); load()
  }

  async function deleteCorr(corrId) {
    if (!window.confirm('Czy na pewno chcesz usunąć tę korektę? Operacja jest nieodwracalna.')) return
    await supabase.from('stock_corrections').delete().eq('id', corrId)
    load()
  }

  const batchCorrections = selectedBatch ? corrections.filter(c => c.ingredient_batch_id===selectedBatch.id) : []

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Przyjęcie składników</div><div className="page-sub">Dostęp: Admin, Technolog</div></div>
        <div className="flex">
          <input className="search" placeholder="Szukaj partii..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_BATCH); setError(''); setModal(true) }}>+ Przyjęcie dostawy</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Partii na stanie</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Wygasa w 30 dni</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.expiringSoon}</div></div>
        <div className="stat-card"><div className="stat-label">Wstrzymane</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.blocked}</div></div>
        <div className="stat-card"><div className="stat-label">Wartość (filtr)</div><div className="stat-val" style={{ fontSize:15, color:'#3C3489' }}>{totalValue > 0 ? totalValue.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</div></div>
      </div>

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:1150 }}>
          <thead><tr>
            <th>Kod</th><th>Nazwa</th><th>Dostawca</th><th>Nr partii dostawy</th>
            <th>Data prod.</th><th>Ważny do</th><th>Data przyj.</th>
            <th style={{textAlign:'right'}}>Ilość (kg)</th>
            <th style={{textAlign:'right'}}>Cena/kg</th>
            <th style={{textAlign:'right'}}>Wartość (zł)</th>
            <th>Faktura</th><th>Status</th><th>Akcja</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={13} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(b => {
              const eff = effectiveQty(b)
              const val = effectiveValue(b)
              const corrs = corrections.filter(c => c.ingredient_batch_id===b.id)
              const hasCorr = corrs.length > 0
              const isExpiring = b.expiry_date && (new Date(b.expiry_date)-new Date()) < 30*24*3600*1000 && new Date(b.expiry_date)>new Date()
              return (
                <React.Fragment key={b.id}>
                  <tr style={{ background: hasCorr ? '#FAEEDA22' : undefined }}>
                    <td><span className="lot">{b.ingredients?.code}</span></td>
                    <td style={{ fontWeight:500 }}>{b.ingredients?.name}</td>
                    <td className="muted" style={{ fontSize:12 }}>{b.supplier_name || '—'}</td>
                    <td><span className="lot">{b.delivery_lot}</span>{hasCorr && <span className="badge b-warn" style={{ marginLeft:4, fontSize:10 }}>korekta</span>}</td>
                    <td className="muted">{b.production_date||'—'}</td>
                    <td className="muted" style={{ color:isExpiring?'#BA7517':undefined }}>{b.expiry_date||'—'}</td>
                    <td className="muted">{b.received_date}</td>
                    <td style={{ fontWeight:500, textAlign:'right' }}>
                      {hasCorr ? <><span style={{ textDecoration:'line-through', color:'#888', marginRight:4 }}>{b.quantity_kg}</span><b>{eff.toFixed(3)}</b></> : b.quantity_kg}
                    </td>
                    <td style={{ textAlign:'right', fontSize:12, color:'#5F5E5A' }}>{b.unit_price_pln ? parseFloat(b.unit_price_pln).toFixed(4) : '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:500, color: val ? '#3C3489' : '#888' }}>
                      {val !== null ? val.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}
                      {hasCorr && val !== null && <div style={{ fontSize:10, color:'#888' }}>po kor.</div>}
                    </td>
                    <td className="muted">{b.invoice_number||'—'}</td>
                    <td><span className={`badge ${b.status==='dopuszczona'?'b-ok':b.status==='wstrzymana'?'b-err':'b-warn'}`}>{b.status}</span></td>
                    <td>
                      <div className="flex" style={{ gap:4 }}>
                        {isAdmin && <button className="btn btn-sm" style={{ background:'#E6F1FB', color:'#0C447C', border:'0.5px solid #B5D4F4' }} onClick={() => openEdit(b)}>Edytuj</button>}
                        <button className="btn btn-sm btn-warn" onClick={() => openCorr(b)}>Korekta</button>
                      </div>
                    </td>
                  </tr>
                  {corrs.map(c => (
                    <tr key={c.id} style={{ background:'#F9F8F5', fontSize:11 }}>
                      <td colSpan={2} style={{ paddingLeft:24, color:'#888' }}>{CORR_LABELS[c.correction_type]}</td>
                      <td colSpan={3} style={{ color:'#888' }}>{c.reason}</td>
                      <td className="muted">{c.event_date}</td>
                      <td><span className={`badge ${c.delta_kg<0?'b-err':'b-ok'}`} style={{ fontSize:10 }}>{c.delta_kg>0?'+':''}{c.delta_kg} kg</span></td>
                      <td colSpan={4}></td>
                      <td colSpan={2}>
                        {isAdmin && (
                          <div className="flex" style={{ gap:4 }}>
                            <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openEditCorr(c)}>Edytuj</button>
                            <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => deleteCorr(c.id)}>Usuń</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal nowe przyjęcie */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">Przyjęcie dostawy — nowa partia</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Składnik *</label>
              <select value={form.ingredient_id} onChange={e => f('ingredient_id', e.target.value)}>
                <option value="">— wybierz składnik —</option>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </div>
            <div><label>Dostawca</label>
              <input value={form.supplier_name} onChange={e => f('supplier_name', e.target.value)} placeholder="np. StarChem Sp. z o.o." />
            </div>
          </div>
          <div className="fr">
            <div><label>Nr partii dostawy / atestu *</label><input value={form.delivery_lot} onChange={e => f('delivery_lot',e.target.value)} placeholder="AT-2025-XXXX" /></div>
            <div><label>Nr faktury</label><input value={form.invoice_number} onChange={e => f('invoice_number',e.target.value)} placeholder="FV/2025/XXXX" /></div>
          </div>
          <div className="fr">
            <div><label>Nr specyfikacji</label><input value={form.spec_number} onChange={e => f('spec_number',e.target.value)} /></div>
            <div><label>Data zatwierdzenia specyfikacji</label><input type="date" value={form.spec_approved_at} onChange={e => f('spec_approved_at',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Data produkcji</label><input type="date" value={form.production_date} onChange={e => f('production_date',e.target.value)} /></div>
            <div><label>Data ważności</label><input type="date" value={form.expiry_date} onChange={e => f('expiry_date',e.target.value)} /></div>
            <div><label>Data przyjęcia</label><input type="date" value={form.received_date} onChange={e => f('received_date',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Ilość (kg) *</label><input type="number" step="0.001" value={form.quantity_kg} onChange={e => f('quantity_kg',e.target.value)} /></div>
            <div><label>Cena za kg (PLN)</label>
              <input type="number" step="0.0001" value={form.unit_price_pln} onChange={e => f('unit_price_pln',e.target.value)} placeholder="0.0000" />
            </div>
            <div><label>Wartość (PLN) — auto</label>
              <input readOnly style={{ background:'#F1EFE8', fontWeight:500 }}
                value={form.unit_price_pln && form.quantity_kg ? (parseFloat(form.unit_price_pln||0)*parseFloat(form.quantity_kg||0)).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'} />
            </div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja magazynowa</label><input value={form.warehouse_location} onChange={e => f('warehouse_location',e.target.value)} placeholder="np. A-12-3" /></div>
            <div><label>Status partii</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                <option value="dopuszczona">Dopuszczona</option>
                <option value="wstrzymana">Wstrzymana</option>
                <option value="kwarantanna">Kwarantanna</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveBatch} disabled={saving}>{saving?'Zapisywanie...':'Zapisz partię'}</button>
          </div>
        </div>
      </div>

      {/* Modal edycja */}
      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal">
          <div className="modal-title">Edycja przyjęcia dostawy</div>
          <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Dostawca</label><input value={editForm.supplier_name||''} onChange={e => ef('supplier_name',e.target.value)} /></div>
            <div><label>Nr faktury</label><input value={editForm.invoice_number||''} onChange={e => ef('invoice_number',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Nr specyfikacji</label><input value={editForm.spec_number||''} onChange={e => ef('spec_number',e.target.value)} /></div>
            <div><label>Data zatwierdzenia specyfikacji</label><input type="date" value={editForm.spec_approved_at||''} onChange={e => ef('spec_approved_at',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Nr partii dostawy *</label><input value={editForm.delivery_lot||''} onChange={e => ef('delivery_lot',e.target.value)} /></div>
            <div><label>Lokalizacja magazynowa</label><input value={editForm.warehouse_location||''} onChange={e => ef('warehouse_location',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Data produkcji</label><input type="date" value={editForm.production_date||''} onChange={e => ef('production_date',e.target.value)} /></div>
            <div><label>Data ważności</label><input type="date" value={editForm.expiry_date||''} onChange={e => ef('expiry_date',e.target.value)} /></div>
            <div><label>Data przyjęcia</label><input type="date" value={editForm.received_date||''} onChange={e => ef('received_date',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Ilość (kg)</label><input type="number" step="0.001" value={editForm.quantity_kg||''} onChange={e => ef('quantity_kg',e.target.value)} /></div>
            <div><label>Cena za kg (PLN)</label><input type="number" step="0.0001" value={editForm.unit_price_pln||''} onChange={e => ef('unit_price_pln',e.target.value)} /></div>
            <div><label>Wartość (PLN) — auto</label>
              <input readOnly style={{ background:'#F1EFE8', fontWeight:500 }}
                value={editForm.unit_price_pln && editForm.quantity_kg ? (parseFloat(editForm.unit_price_pln||0)*parseFloat(editForm.quantity_kg||0)).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'} />
            </div>
          </div>
          <div><label>Status</label>
            <select value={editForm.status||'dopuszczona'} onChange={e => ef('status',e.target.value)}>
              <option value="dopuszczona">Dopuszczona</option>
              <option value="wstrzymana">Wstrzymana</option>
              <option value="kwarantanna">Kwarantanna</option>
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      {/* Modal korekta */}
      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal">
          <div className="modal-title">Korekta stanu magazynowego</div>
          {selectedBatch && (
            <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
              <b>{selectedBatch.ingredients?.code}</b> — {selectedBatch.ingredients?.name} &nbsp;|&nbsp;
              Partia: <span className="lot">{selectedBatch.delivery_lot}</span> &nbsp;|&nbsp;
              Stan: <b>{effectiveQty(selectedBatch).toFixed(3)} kg</b>
              {effectiveValue(selectedBatch) !== null && <span> &nbsp;|&nbsp; Wartość: <b>{effectiveValue(selectedBatch).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</b></span>}
            </div>
          )}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrForm.correction_type} onChange={e => cf('correction_type',e.target.value)}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {corrForm.correction_type !== 'utylizacja_pelna' && (
              <div><label>Korekta ilości (kg) — ujemna = ubytek</label>
                <input type="number" step="0.001" value={corrForm.delta_kg} onChange={e => cf('delta_kg',e.target.value)} placeholder="np. -50 lub +20" />
              </div>
            )}
          </div>
          {corrForm.correction_type==='utylizacja_pelna' && <div className="warn-box">Utylizacja pełna — partia zostanie wstrzymana. Nieodwracalne.</div>}
          <div style={{ marginBottom:10 }}><label>Przyczyna (wymagane)</label><input value={corrForm.reason} onChange={e => cf('reason',e.target.value)} placeholder="np. opakowanie uszkodzone" /></div>
          <div><label>Data zdarzenia</label><input type="date" value={corrForm.event_date} onChange={e => cf('event_date',e.target.value)} /></div>
          {batchCorrections.length > 0 && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:12, fontWeight:500, marginBottom:6 }}>Historia korekt tej partii</div>
              {batchCorrections.map(c => (
                <div key={c.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:12, color:'#5F5E5A', padding:'5px 0', borderBottom:'0.5px solid #D3D1C7' }}>
                  <span><b>{CORR_LABELS[c.correction_type]}</b>: {c.reason} &nbsp;
                    <span className={`badge ${c.delta_kg<0?'b-err':'b-ok'}`} style={{ fontSize:10 }}>{c.delta_kg>0?'+':''}{c.delta_kg} kg</span>
                    &nbsp;<span className="muted">{c.event_date}</span>
                  </span>
                  {isAdmin && (
                    <div className="flex" style={{ gap:4, marginLeft:8 }}>
                      <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => { setCorrModal(false); openEditCorr(c) }}>Edytuj</button>
                      <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => deleteCorr(c.id)}>Usuń</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-danger" onClick={saveCorrection} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>

      {/* Modal edycja korekty */}
      <div className={`modal-overlay ${editCorrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditCorrModal(false)}>
        <div className="modal" style={{ maxWidth:460 }}>
          <div className="modal-title">Edycja korekty</div>
          <div className="warn-box" style={{ marginBottom:10 }}>Edycja korekt dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}><label>Typ korekty</label>
            <select value={editCorrForm.correction_type||''} onChange={e => ecf('correction_type',e.target.value)}>
              {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="fr">
            <div><label>Korekta ilości (kg)</label>
              <input type="number" step="0.001" value={editCorrForm.delta_kg||''} onChange={e => ecf('delta_kg',e.target.value)} />
            </div>
            <div><label>Data zdarzenia</label>
              <input type="date" value={editCorrForm.event_date||''} onChange={e => ecf('event_date',e.target.value)} />
            </div>
          </div>
          <div><label>Przyczyna (wymagane)</label>
            <input value={editCorrForm.reason||''} onChange={e => ecf('reason',e.target.value)} />
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditCorrModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEditCorr} disabled={saving}>{saving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
