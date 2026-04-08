import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STATUS_LABELS = {
  nowe: 'Nowe',
  w_realizacji: 'W realizacji',
  zrealizowane: 'Zrealizowane',
  wyslane: 'Wysłane do klienta',
  anulowane: 'Anulowane'
}
const STATUS_COLORS = {
  nowe: 'b-info',
  w_realizacji: 'b-warn',
  zrealizowane: 'b-ok',
  wyslane: 'b-purple',
  anulowane: 'b-gray'
}

const EMPTY_FORM = { client:'', recipe_id:'', quantity_kg:'', ship_date:'', status:'nowe', notes:'' }

export default function Zlecenia() {
  const { profile } = useAuth()
  const canEdit = ['admin','technolog'].includes(profile?.role)

  const [orders, setOrders] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywne')

  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: o }, { data: r }] = await Promise.all([
      supabase.from('orders').select('*, recipes(code, name, version, production_line), production_batches(lot_number)').order('ship_date', { ascending: true }),
      supabase.from('recipes').select('id,code,name,version').eq('status','dopuszczona').order('code')
    ])
    setOrders(o || [])
    setRecipes(r || [])
    setLoading(false)
  }

  const filtered = orders.filter(o => {
    const q = search.toLowerCase()
    const matchQ = !q || o.order_number.toLowerCase().includes(q) || o.client.toLowerCase().includes(q) || (o.recipes?.name||'').toLowerCase().includes(q)
    const matchStatus = filterStatus === 'wszystkie' ? true :
      filterStatus === 'aktywne' ? ['nowe','w_realizacji'].includes(o.status) : o.status === filterStatus
    return matchQ && matchStatus
  })

  const stats = {
    nowe: orders.filter(o => o.status==='nowe').length,
    w_realizacji: orders.filter(o => o.status==='w_realizacji').length,
    zrealizowane: orders.filter(o => o.status==='zrealizowane').length,
    pilne: orders.filter(o => ['nowe','w_realizacji'].includes(o.status) && new Date(o.ship_date) <= new Date(Date.now()+7*24*3600*1000)).length
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() {
    setForm(EMPTY_FORM); setEditMode(false); setError(''); setModal(true)
  }

  function openEdit(order) {
    setForm({ id:order.id, client:order.client, recipe_id:order.recipe_id, quantity_kg:order.quantity_kg, ship_date:order.ship_date, status:order.status, notes:order.notes||'' })
    setEditMode(true); setError(''); setModal(true)
  }

  async function generateOrderNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('orders').select('order_number').ilike('order_number', `ZL-${year}-%`).order('order_number', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const last = parseInt(data[0].order_number.split('-')[2]) || 0
      return `ZL-${year}-${String(last+1).padStart(4,'0')}`
    }
    return `ZL-${year}-0001`
  }

  async function save() {
    if (!form.client) { setError('Klient jest wymagany'); return }
    if (!form.recipe_id) { setError('Wybierz recepturę'); return }
    if (!form.quantity_kg) { setError('Ilość jest wymagana'); return }
    if (!form.ship_date) { setError('Data wysyłki jest wymagana'); return }
    setSaving(true); setError('')
    if (editMode) {
      const { error: err } = await supabase.from('orders').update({
        client: form.client, recipe_id: form.recipe_id, quantity_kg: parseFloat(form.quantity_kg),
        ship_date: form.ship_date, status: form.status, notes: form.notes||null, updated_at: new Date().toISOString()
      }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const orderNumber = await generateOrderNumber()
      const { error: err } = await supabase.from('orders').insert({
        order_number: orderNumber, client: form.client, recipe_id: form.recipe_id,
        quantity_kg: parseFloat(form.quantity_kg), ship_date: form.ship_date,
        status: form.status, notes: form.notes||null, created_by: profile?.id
      })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function quickStatus(order, newStatus) {
    await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', order.id)
    load()
  }

  async function deleteOrder(order) {
    await supabase.from('orders').delete().eq('id', order.id)
    setConfirmDelete(null); load()
  }

  function daysUntil(dateStr) {
    const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000*60*60*24))
    return diff
  }

  function shipDateBadge(order) {
    if (['zrealizowane','wyslane','anulowane'].includes(order.status)) return null
    const days = daysUntil(order.ship_date)
    if (days < 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Przeterminowane</span>
    if (days === 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Dziś!</span>
    if (days <= 3) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>{days}d</span>
    if (days <= 7) return <span className="badge b-warn" style={{ fontSize:10, marginLeft:6 }}>{days}d</span>
    return null
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Zlecenia produkcyjne</div><div className="page-sub">Dostęp: Admin, Technolog</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj zlecenia, klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowe zlecenie</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Nowe</div><div className="stat-val" style={{ color:'#0C447C' }}>{stats.nowe}</div></div>
        <div className="stat-card"><div className="stat-label">W realizacji</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.w_realizacji}</div></div>
        <div className="stat-card"><div className="stat-label">Zrealizowane</div><div className="stat-val" style={{ color:'#085041' }}>{stats.zrealizowane}</div></div>
        <div className="stat-card"><div className="stat-label">Pilne (≤7 dni)</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.pilne}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {['aktywne','wszystkie','nowe','w_realizacji','zrealizowane','wyslane','anulowane'].map(s => (
          <button key={s} className="btn btn-sm" onClick={() => setFilterStatus(s)}
            style={{ background:filterStatus===s?'#1D9E75':undefined, color:filterStatus===s?'#fff':undefined, borderColor:filterStatus===s?'#1D9E75':undefined }}>
            {s==='aktywne'?'Aktywne':s==='wszystkie'?'Wszystkie':STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:860 }}>
          <thead><tr>
            <th>Nr zlecenia</th><th>Klient</th><th>Receptura</th><th>Ilość (kg)</th>
            <th>Data wysyłki</th><th>Partia prod.</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(o => (
              <tr key={o.id} style={{ background: daysUntil(o.ship_date) < 0 && ['nowe','w_realizacji'].includes(o.status) ? '#FCEBEB55' : undefined }}>
                <td><span className="lot">{o.order_number}</span></td>
                <td style={{ fontWeight:500 }}>{o.client}</td>
                <td>
                  <div style={{ fontWeight:500, fontSize:13 }}>{o.recipes?.name}</div>
                  <div className="muted" style={{ fontSize:11 }}>{o.recipes?.code} · {o.recipes?.version}</div>
                </td>
                <td style={{ fontWeight:500, textAlign:'right' }}>{parseFloat(o.quantity_kg).toLocaleString('pl-PL')} kg</td>
                <td>
                  <span className="muted">{o.ship_date}</span>
                  {shipDateBadge(o)}
                </td>
                <td>
                  {o.production_batches
                    ? <span className="lot">{o.production_batches.lot_number}</span>
                    : <span className="muted">—</span>
                  }
                </td>
                <td>
                  {canEdit ? (
                    <select value={o.status} onChange={e => quickStatus(o, e.target.value)}
                      style={{ fontSize:11, padding:'2px 6px', border:'0.5px solid #D3D1C7', borderRadius:6, cursor:'pointer',
                        background: o.status==='nowe'?'#E6F1FB':o.status==='w_realizacji'?'#FAEEDA':o.status==='zrealizowane'?'#E1F5EE':o.status==='wyslane'?'#EEEDFE':'#F1EFE8',
                        color: o.status==='nowe'?'#0C447C':o.status==='w_realizacji'?'#633806':o.status==='zrealizowane'?'#085041':o.status==='wyslane'?'#3C3489':'#888'
                      }}>
                      {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <span className={`badge ${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                  )}
                </td>
                <td>
                  {canEdit && (
                    <div className="flex" style={{ gap:4 }}>
                      <button className="btn btn-sm" onClick={() => openEdit(o)}>Edytuj</button>
                      <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(o)}>Usuń</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak zleceń</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal nowe/edytuj zlecenie */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">{editMode?'Edytuj zlecenie':'Nowe zlecenie produkcyjne'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Klient *</label><input value={form.client} onChange={e => f('client',e.target.value)} placeholder="Nazwa klienta" /></div>
            <div><label>Data wysyłki *</label><input type="date" value={form.ship_date} onChange={e => f('ship_date',e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Receptura *</label>
            <select value={form.recipe_id} onChange={e => f('recipe_id',e.target.value)}>
              <option value="">— wybierz recepturę —</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.code} — {r.name} ({r.version})</option>)}
            </select>
          </div>
          <div className="fr">
            <div><label>Ilość (kg) *</label><input type="number" step="0.001" value={form.quantity_kg} onChange={e => f('quantity_kg',e.target.value)} /></div>
            <div><label>Status</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Utwórz zlecenie'}</button>
          </div>
        </div>
      </div>

      {/* Potwierdzenie usunięcia */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń zlecenie</div>
          <div className="warn-box">Czy na pewno chcesz usunąć zlecenie <b>{confirmDelete?.order_number}</b> dla klienta <b>{confirmDelete?.client}</b>?</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteOrder(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
