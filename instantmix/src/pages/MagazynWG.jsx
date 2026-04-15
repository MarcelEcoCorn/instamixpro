import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function MagazynWG() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = ['admin','technolog'].includes(profile?.role)

  const [goods, setGoods] = useState([])
  const [wzDocs, setWzDocs] = useState([])
  const [prodBatches, setProdBatches] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [search, setSearch] = useState('')

  const [acceptModal, setAcceptModal] = useState(false)
  const [acceptForm, setAcceptForm] = useState({ production_batch_id:'', order_id:'', received_date: new Date().toISOString().slice(0,10), quantity_kg:'', location:'', notes:'' })
  const [selectedProdBatch, setSelectedProdBatch] = useState(null)

  const [editModal, setEditModal] = useState(false)
  const [editGood, setEditGood] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)

  const [wzModal, setWzModal] = useState(false)
  const [wzGood, setWzGood] = useState(null)
  const [wzForm, setWzForm] = useState({ issue_date: new Date().toISOString().slice(0,10), quantity_kg:'', recipient:'', carrier:'', notes:'' })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filterView, setFilterView] = useState('aktywne')
  const [printWzData, setPrintWzData] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: g }, { data: wz }, { data: pb }, { data: o }] = await Promise.all([
      supabase.from('v_finished_goods').select('*').order('received_date', { ascending: false }),
      supabase.from('wz_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('v_production').select('id, lot_number, recipe_code, recipe_name, quantity_kg, production_date, client').order('production_date', { ascending: false }),
      supabase.from('orders').select('id, order_number, client, quantity_kg, recipe_id, recipes(name,code)').in('status',['w_realizacji','zrealizowane']).order('ship_date')
    ])
    const acceptedBatchIds = new Set((g||[]).map(x => x.production_batch_id))
    setGoods(g || [])
    setWzDocs(wz || [])
    setProdBatches((pb||[]).filter(p => !acceptedBatchIds.has(p.id)))
    setOrders(o || [])
    setLoading(false)
  }

  const filtered = goods.filter(g => {
    const q = search.toLowerCase()
    const matchQ = !q || g.lot_number?.toLowerCase().includes(q) || g.recipe_name?.toLowerCase().includes(q) || (g.client||'').toLowerCase().includes(q) || (g.order_number||'').toLowerCase().includes(q)
    const isFullyIssued = parseFloat(g.available_kg) <= 0
    const matchView = filterView === 'wszystkie' ? true :
      filterView === 'aktywne' ? !isFullyIssued :
      filterView === 'wydane' ? isFullyIssued : true
    return matchQ && matchView
  })

  const stats = {
    total: goods.length,
    available: goods.filter(g => parseFloat(g.available_kg) > 0).length,
    totalKg: goods.reduce((s,g) => s + parseFloat(g.original_kg), 0).toFixed(1),
    availableKg: goods.reduce((s,g) => s + parseFloat(g.available_kg), 0).toFixed(1),
  }

  const af = (k,v) => setAcceptForm(p => ({ ...p, [k]: v }))
  const wf = (k,v) => setWzForm(p => ({ ...p, [k]: v }))

  function handleBatchSelect(batchId) {
    af('production_batch_id', batchId)
    const pb = prodBatches.find(p => p.id === batchId)
    setSelectedProdBatch(pb || null)
    if (pb) {
      af('quantity_kg', pb.quantity_kg)
      // Ustaw datę przyjęcia na datę produkcji jeśli aktualna data jest wcześniejsza
      if (pb.production_date && acceptForm.received_date < pb.production_date) {
        af('received_date', pb.production_date)
      }
    }
  }

  async function saveAccept() {
    if (!acceptForm.production_batch_id) { setError('Wybierz partię produkcyjną'); return }
    if (!acceptForm.quantity_kg) { setError('Podaj ilość'); return }
    // Walidacja daty — nie wcześniej niż data produkcji
    if (selectedProdBatch?.production_date && acceptForm.received_date < selectedProdBatch.production_date) {
      setError(`Data przyjęcia nie może być wcześniejsza niż data produkcji (${selectedProdBatch.production_date})`); return
    }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('finished_goods').insert({
      production_batch_id: acceptForm.production_batch_id,
      order_id: acceptForm.order_id || null,
      received_date: acceptForm.received_date,
      quantity_kg: parseFloat(acceptForm.quantity_kg),
      location: acceptForm.location || null,
      notes: acceptForm.notes || null,
      created_by: profile?.id
    })
    if (err) { setError(err.message); setSaving(false); return }
    if (acceptForm.order_id) {
      await supabase.from('orders').update({ status:'zrealizowane', updated_at: new Date().toISOString() }).eq('id', acceptForm.order_id)
    }
    setSaving(false); setAcceptModal(false)
    setAcceptForm({ production_batch_id:'', order_id:'', received_date: new Date().toISOString().slice(0,10), quantity_kg:'', location:'', notes:'' })
    setSelectedProdBatch(null)
    load()
  }

  function openEdit(good) {
    setEditGood(good)
    setEditForm({ received_date: good.received_date, quantity_kg: good.original_kg, location: good.location||'', notes: good.notes||'' })
    setError(''); setEditModal(true)
  }

  async function saveEdit() {
    if (!editForm.received_date || !editForm.quantity_kg) { setError('Uzupełnij wymagane pola'); return }
    setSavingEdit(true); setError('')
    const { error: err } = await supabase.from('finished_goods').update({
      received_date: editForm.received_date,
      quantity_kg: parseFloat(editForm.quantity_kg),
      location: editForm.location || null,
      notes: editForm.notes || null,
      updated_at: new Date().toISOString()
    }).eq('id', editGood.id)
    setSavingEdit(false)
    if (err) { setError(err.message); return }
    setEditModal(false); load()
  }

  async function generateWzNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('wz_documents').select('wz_number').ilike('wz_number', `WZ-${year}-%`).order('wz_number', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const last = parseInt(data[0].wz_number.split('-')[2]) || 0
      return `WZ-${year}-${String(last+1).padStart(4,'0')}`
    }
    return `WZ-${year}-0001`
  }

  function openWz(good) {
    setWzGood(good)
    setWzForm({ issue_date: new Date().toISOString().slice(0,10), quantity_kg: parseFloat(good.available_kg).toFixed(3), recipient: good.client||'', carrier:'', notes:'' })
    setError(''); setWzModal(true)
  }

  async function saveWz() {
    if (!wzForm.quantity_kg || parseFloat(wzForm.quantity_kg) <= 0) { setError('Podaj ilość do wydania'); return }
    if (parseFloat(wzForm.quantity_kg) > parseFloat(wzGood.available_kg)) { setError(`Maksymalna dostępna ilość: ${wzGood.available_kg} kg`); return }
    setSaving(true); setError('')
    const wzNumber = await generateWzNumber()
    const { error: err } = await supabase.from('wz_documents').insert({
      wz_number: wzNumber,
      finished_good_id: wzGood.id,
      order_id: wzGood.order_id || null,
      issue_date: wzForm.issue_date,
      quantity_kg: parseFloat(wzForm.quantity_kg),
      recipient: wzForm.recipient || null,
      carrier: wzForm.carrier || null,
      notes: wzForm.notes || null,
      issued_by: profile?.id
    })
    if (err) { setError(err.message); setSaving(false); return }
    if (wzGood.order_id) {
      const newAvailable = parseFloat(wzGood.available_kg) - parseFloat(wzForm.quantity_kg)
      if (newAvailable <= 0.001) {
        await supabase.from('orders').update({ status:'wyslane', updated_at: new Date().toISOString() }).eq('id', wzGood.order_id)
      }
    }
    setSaving(false); setWzModal(false)
    setPrintWzData({ wzNumber, good: wzGood, form: {...wzForm} })
    load()
  }

  function printWZ(wzNumber, good, form) {
    const qty = parseFloat(form.quantity_kg).toFixed(3)
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<title>Dokument WZ ${wzNumber}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;padding:16px}
  .header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:14px}
  .company{font-size:16px;font-weight:bold;color:#0F6E56}
  .doc-title{font-size:13px;font-weight:bold;margin-top:3px}
  .wz-number{font-size:18px;font-weight:bold;color:#0F6E56;margin-top:4px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
  .info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}
  .info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}
  .info-value{font-size:13px;font-weight:bold}
  table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th{background:#0F6E56;color:#fff;padding:6px;font-size:9px;text-align:left;border:1px solid #085041}
  td{padding:6px;border:1px solid #D3D1C7;font-size:11px}
  .total td{background:#E1F5EE;font-weight:bold}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}
  .sig-line{border-bottom:1px solid #333;margin-top:28px;margin-bottom:4px}
  .sig-label{font-size:9px;color:#888;text-transform:uppercase}
  .footer{margin-top:12px;font-size:9px;color:#888;text-align:center;border-top:1px solid #D3D1C7;padding-top:6px}
  @media print{@page{margin:10mm;size:A4}}
</style></head><body>
<div class="header">
  <div>
    <div class="company">InstantMix Pro</div>
    <div class="doc-title">Wydanie Zewnętrzne (WZ)</div>
    <div class="wz-number">${wzNumber}</div>
  </div>
  <div style="text-align:right;font-size:10px;color:#555">
    Data wydania: <strong>${form.issue_date}</strong><br>
    Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} ${new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}<br>
    Wystawił: <strong>${profile?.full_name||'—'}</strong>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">Odbiorca</div><div class="info-value">${form.recipient||'—'}</div></div>
  <div class="info-box"><div class="info-label">Przewoźnik / transport</div><div class="info-value">${form.carrier||'—'}</div></div>
  <div class="info-box"><div class="info-label">Nr zlecenia</div><div class="info-value">${good.order_number||'—'}</div></div>
  <div class="info-box"><div class="info-label">Nr partii produkcyjnej</div><div class="info-value">${good.lot_number}</div></div>
  <div class="info-box"><div class="info-label">Receptura</div><div class="info-value">${good.recipe_code} — ${good.recipe_name}</div></div>
  <div class="info-box"><div class="info-label">Lokalizacja magazynowa</div><div class="info-value">${good.location||'—'}</div></div>
</div>
<table>
  <thead><tr>
    <th>Lp.</th><th>Kod produktu</th><th>Nazwa produktu</th>
    <th style="text-align:right">Ilość (kg)</th><th>Nr partii</th><th>Uwagi</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>1</td><td>${good.recipe_code}</td>
      <td>${good.recipe_name} (${good.recipe_version})</td>
      <td style="text-align:right;font-weight:bold">${qty}</td>
      <td>${good.lot_number}</td>
      <td>${form.notes||''}</td>
    </tr>
    <tr class="total">
      <td colspan="3" style="text-align:right">RAZEM:</td>
      <td style="text-align:right">${qty} kg</td>
      <td colspan="2"></td>
    </tr>
  </tbody>
</table>
<div class="sig-grid">
  <div><div class="sig-label">Wydał (magazyn)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div>
  <div><div class="sig-label">Odebrał (kierowca / odbiorca)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div>
  <div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div>
</div>
<div class="footer">InstantMix Pro | ${wzNumber} | ${form.issue_date} | Wystawił: ${profile?.full_name||'—'}</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`
    const win = window.open('','_blank')
    win.document.write(html); win.document.close()
  }

  function getWzForGood(goodId) {
    return wzDocs.filter(w => w.finished_good_id === goodId)
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Magazyn Wyrobów Gotowych</div><div className="page-sub">Przyjęcia i wydania WZ</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj partii, receptury, klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:240 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setAcceptForm({ production_batch_id:'', order_id:'', received_date: new Date().toISOString().slice(0,10), quantity_kg:'', location:'', notes:'' }); setSelectedProdBatch(null); setError(''); setAcceptModal(true) }}>+ Przyjęcie na magazyn</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Pozycji na stanie</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Dostępnych</div><div className="stat-val" style={{ color:'#085041' }}>{stats.available}</div></div>
        <div className="stat-card"><div className="stat-label">Łącznie przyjęto (kg)</div><div className="stat-val">{parseFloat(stats.totalKg).toLocaleString('pl-PL')}</div></div>
        <div className="stat-card"><div className="stat-label">Dostępne (kg)</div><div className="stat-val" style={{ color:'#085041' }}>{parseFloat(stats.availableKg).toLocaleString('pl-PL')}</div></div>
      </div>

      {printWzData && (
        <div className="info-box" style={{ marginBottom:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>✓ Dokument <b>{printWzData.wzNumber}</b> został wystawiony pomyślnie.</span>
          <div className="flex" style={{ gap:8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => printWZ(printWzData.wzNumber, printWzData.good, printWzData.form)}>Drukuj WZ</button>
            <button className="btn btn-sm" onClick={() => setPrintWzData(null)}>✕</button>
          </div>
        </div>
      )}

      <div className="flex" style={{ marginBottom:10, gap:6 }}>
        {['aktywne','wydane','wszystkie'].map(f => (
          <button key={f} className="btn btn-sm" onClick={() => setFilterView(f)}
            style={{ background:filterView===f?'#1D9E75':undefined, color:filterView===f?'#fff':undefined, borderColor:filterView===f?'#1D9E75':undefined }}>
            {f==='aktywne'?'Aktywne (dostępne)':f==='wydane'?'Wydane':'Wszystkie'}
          </button>
        ))}
      </div>

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead><tr>
            <th style={{ width:32 }}></th>
            <th>Nr partii prod.</th><th>Receptura</th><th>Klient / Zlecenie</th>
            <th>Data przyjęcia</th><th style={{ textAlign:'right' }}>Przyjęto (kg)</th>
            <th style={{ textAlign:'right' }}>Wydano (kg)</th>
            <th style={{ textAlign:'right' }}>Dostępne (kg)</th>
            <th>Lokalizacja</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(g => {
              const wzList = getWzForGood(g.id)
              const available = parseFloat(g.available_kg)
              return (
                <React.Fragment key={g.id}>
                  <tr style={{ background: available <= 0 ? '#F9F8F5' : undefined }}>
                    <td style={{ textAlign:'center' }}>
                      {wzList.length > 0 && (
                        <button onClick={() => setExpandedId(expandedId===g.id ? null : g.id)}
                          style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                          {expandedId===g.id ? '▲' : '▼'}
                        </button>
                      )}
                    </td>
                    <td><span className="lot">{g.lot_number}</span></td>
                    <td>
                      <div style={{ fontWeight:500 }}>{g.recipe_name}</div>
                      <div className="muted" style={{ fontSize:11 }}>{g.recipe_code} · {g.recipe_version}</div>
                    </td>
                    <td>
                      {g.order_number ? (
                        <div><span className="lot">{g.order_number}</span><div className="muted" style={{ fontSize:11 }}>{g.client}</div></div>
                      ) : <span className="muted">{g.client||'—'}</span>}
                    </td>
                    <td className="muted">{g.received_date}</td>
                    <td style={{ textAlign:'right', color:'#085041', fontWeight:500 }}>{parseFloat(g.original_kg).toFixed(3)}</td>
                    <td style={{ textAlign:'right', color:'#633806' }}>{parseFloat(g.issued_kg).toFixed(3)}</td>
                    <td style={{ textAlign:'right' }}>
                      <span style={{ fontWeight:700, color: available <= 0 ? '#888' : '#0F6E56' }}>{available.toFixed(3)}</span>
                      {available <= 0 && <span className="badge b-gray" style={{ marginLeft:6, fontSize:10 }}>Wydano</span>}
                    </td>
                    <td className="muted">{g.location||'—'}</td>
                    <td>
                      <div className="flex" style={{ gap:4 }}>
                        {canEdit && isAdmin && (
                          <button className="btn btn-sm" style={{ background:'#E6F1FB', color:'#0C447C', border:'0.5px solid #B5D4F4' }} onClick={() => openEdit(g)}>Edytuj</button>
                        )}
                        {canEdit && available > 0 && (
                          <button className="btn btn-sm btn-primary" onClick={() => openWz(g)}>Wystaw WZ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId===g.id && wzList.length > 0 && (
                    <tr>
                      <td colSpan={10} style={{ padding:0, background:'#F9F8F5' }}>
                        <div style={{ padding:'8px 16px 10px 40px' }}>
                          <div style={{ fontSize:12, fontWeight:500, marginBottom:6, color:'#0F6E56' }}>Dokumenty WZ — {g.lot_number}</div>
                          <table style={{ width:'auto', minWidth:600 }}>
                            <thead><tr>
                              <th>Nr WZ</th><th>Data wydania</th><th>Odbiorca</th>
                              <th>Przewoźnik</th><th style={{ textAlign:'right' }}>Ilość (kg)</th>
                            </tr></thead>
                            <tbody>
                              {wzList.map(wz => (
                                <tr key={wz.id}>
                                  <td><span className="lot">{wz.wz_number}</span></td>
                                  <td className="muted">{wz.issue_date}</td>
                                  <td>{wz.recipient||'—'}</td>
                                  <td className="muted">{wz.carrier||'—'}</td>
                                  <td style={{ textAlign:'right', fontWeight:500 }}>{parseFloat(wz.quantity_kg).toFixed(3)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {!loading && filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak towarów na magazynie</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal przyjęcia */}
      <div className={`modal-overlay ${acceptModal?'open':''}`} onClick={e => e.target===e.currentTarget && setAcceptModal(false)}>
        <div className="modal">
          <div className="modal-title">Przyjęcie towaru na magazyn WG</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}>
            <label>Partia produkcyjna *</label>
            <select value={acceptForm.production_batch_id} onChange={e => handleBatchSelect(e.target.value)}>
              <option value="">— wybierz partię —</option>
              {prodBatches.map(pb => (
                <option key={pb.id} value={pb.id}>{pb.lot_number} — {pb.recipe_name} ({pb.quantity_kg} kg) · {pb.production_date}</option>
              ))}
            </select>
            {selectedProdBatch && (
              <div className="muted" style={{ fontSize:12, marginTop:4 }}>
                Data produkcji: <b>{selectedProdBatch.production_date}</b> — data przyjęcia nie może być wcześniejsza
              </div>
            )}
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Powiąż ze zleceniem (opcjonalne)</label>
            <select value={acceptForm.order_id} onChange={e => af('order_id', e.target.value)}>
              <option value="">— brak powiązania —</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>{o.order_number} — {o.client} ({o.recipes?.name}, {o.quantity_kg} kg)</option>
              ))}
            </select>
          </div>
          <div className="fr">
            <div>
              <label>Data przyjęcia</label>
              <input type="date" value={acceptForm.received_date}
                min={selectedProdBatch?.production_date || undefined}
                onChange={e => {
                  if (selectedProdBatch?.production_date && e.target.value < selectedProdBatch.production_date) {
                    setError(`Data przyjęcia nie może być wcześniejsza niż data produkcji (${selectedProdBatch.production_date})`)
                  } else {
                    setError('')
                  }
                  af('received_date', e.target.value)
                }} />
            </div>
            <div><label>Ilość (kg) *</label><input type="number" step="0.001" value={acceptForm.quantity_kg} onChange={e => af('quantity_kg',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja magazynowa</label><input value={acceptForm.location} onChange={e => af('location',e.target.value)} placeholder="np. Regał A-3" /></div>
            <div><label>Uwagi</label><input value={acceptForm.notes} onChange={e => af('notes',e.target.value)} placeholder="opcjonalne" /></div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setAcceptModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveAccept} disabled={saving}>{saving?'Zapisywanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>

      {/* Modal edycji przyjęcia */}
      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Edycja przyjęcia — {editGood?.lot_number}</div>
          <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={editForm.received_date||''} onChange={e => setEditForm(p=>({...p,received_date:e.target.value}))} /></div>
            <div><label>Ilość (kg)</label><input type="number" step="0.001" value={editForm.quantity_kg||''} onChange={e => setEditForm(p=>({...p,quantity_kg:e.target.value}))} /></div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja</label><input value={editForm.location||''} onChange={e => setEditForm(p=>({...p,location:e.target.value}))} /></div>
            <div><label>Uwagi</label><input value={editForm.notes||''} onChange={e => setEditForm(p=>({...p,notes:e.target.value}))} /></div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>{savingEdit?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      {/* Modal WZ */}
      <div className={`modal-overlay ${wzModal?'open':''}`} onClick={e => e.target===e.currentTarget && setWzModal(false)}>
        <div className="modal">
          <div className="modal-title">Wystawienie dokumentu WZ</div>
          {wzGood && (
            <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
              <b>{wzGood.lot_number}</b> — {wzGood.recipe_name}<br/>
              Dostępne: <b>{parseFloat(wzGood.available_kg).toFixed(3)} kg</b>
              {wzGood.order_number && <span> · Zlecenie: <b>{wzGood.order_number}</b></span>}
            </div>
          )}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data wydania</label><input type="date" value={wzForm.issue_date} onChange={e => wf('issue_date',e.target.value)} /></div>
            <div><label>Ilość do wydania (kg) *</label><input type="number" step="0.001" value={wzForm.quantity_kg} onChange={e => wf('quantity_kg',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Odbiorca</label><input value={wzForm.recipient} onChange={e => wf('recipient',e.target.value)} placeholder="Nazwa firmy / osoby" /></div>
            <div><label>Przewoźnik / transport</label><input value={wzForm.carrier} onChange={e => wf('carrier',e.target.value)} placeholder="np. DHL, własny transport" /></div>
          </div>
          <div><label>Uwagi</label><input value={wzForm.notes} onChange={e => wf('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setWzModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveWz} disabled={saving}>{saving?'Zapisywanie...':'Wystaw WZ i drukuj'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
