import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const CORR_LABELS = {
  korekta_inwentury: 'Korekta inwentury',
  ubytek_uszkodzenie: 'Ubytek / uszkodzenie',
  utylizacja: 'Utylizacja',
  zwrot: 'Zwrot do produkcji',
  inne: 'Inne',
}

export default function MagazynWG() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = ['admin', 'technolog'].includes(profile?.role)

  const [products, setProducts] = useState([])
  const [goods, setGoods] = useState([])
  const [wzDocs, setWzDocs] = useState([])
  const [corrections, setCorrections] = useState([])
  const [prodBatches, setProdBatches] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [batchValues, setBatchValues] = useState({})

  const [expandedProduct, setExpandedProduct] = useState(null)
  const [expandedGood, setExpandedGood] = useState(null)

  const [search, setSearch] = useState('')
  const [filterView, setFilterView] = useState('aktywne')

  const [acceptModal, setAcceptModal] = useState(false)
  const [acceptForm, setAcceptForm] = useState({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0, 10), quantity_kg: '', location: '', notes: '' })
  const [selectedProdBatch, setSelectedProdBatch] = useState(null)

  const [editModal, setEditModal] = useState(false)
  const [editGood, setEditGood] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)

  const [wzModal, setWzModal] = useState(false)
  const [wzGood, setWzGood] = useState(null)
  const [wzForm, setWzForm] = useState({ issue_date: new Date().toISOString().slice(0, 10), quantity_kg: '', recipient: '', carrier: '', notes: '' })

  const [corrModal, setCorrModal] = useState(false)
  const [corrGood, setCorrGood] = useState(null)
  const [corrForm, setCorrForm] = useState({ correction_type: 'korekta_inwentury', delta_kg: '', reason: '', event_date: new Date().toISOString().slice(0, 10) })

  const [inwenturaModal, setInwenturaModal] = useState(false)
  const [inwenturaRows, setInwenturaRows] = useState([])
  const [inwenturaDate, setInwenturaDate] = useState(new Date().toISOString().slice(0, 10))
  const [savingInwentura, setSavingInwentura] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [printWzData, setPrintWzData] = useState(null)

  const [bilansDat1, setBilansDat1] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [bilansDat2, setBilansDat2] = useState(new Date().toISOString().slice(0, 10))
  const [bilansMode, setBilansMode] = useState('miesiac')
  const [showBilans, setShowBilans] = useState(false)
  const [bilansData, setBilansData] = useState([])
  const [bilansLoading, setBilansLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: g }, { data: wz }, { data: pb }, { data: o }, { data: fc }] = await Promise.all([
      supabase.from('v_finished_goods').select('*').order('received_date', { ascending: false }),
      supabase.from('wz_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('v_production').select('id,lot_number,recipe_code,recipe_name,quantity_kg,production_date,client').order('production_date', { ascending: false }),
      supabase.from('orders').select('id,order_number,client,quantity_kg,recipe_id,recipes(name,code)').in('status', ['w_realizacji', 'zrealizowane']).order('ship_date'),
      supabase.from('fg_corrections').select('*').order('created_at', { ascending: false }),
    ])
    // Pobierz wartości surowców per partia produkcyjna
    const batchIds = (g || []).map(x => x.production_batch_id).filter(Boolean)
    let bvMap = {}
    if (batchIds.length > 0) {
      const { data: pbi } = await supabase
        .from('production_batch_items')
        .select('production_batch_id, quantity_used_kg, ingredient_batches(unit_price_pln)')
        .in('production_batch_id', batchIds)
      for (const item of (pbi || [])) {
        const price = parseFloat(item.ingredient_batches?.unit_price_pln || 0)
        const qty = parseFloat(item.quantity_used_kg || 0)
        const val = price * qty
        if (!bvMap[item.production_batch_id]) bvMap[item.production_batch_id] = 0
        bvMap[item.production_batch_id] += val
      }
    }
    setBatchValues(bvMap)
    const acceptedBatchIds = new Set((g || []).map(x => x.production_batch_id))
    setGoods(g || [])
    setWzDocs(wz || [])
    setCorrections(fc || [])
    setProdBatches((pb || []).filter(p => !acceptedBatchIds.has(p.id)))
    setOrders(o || [])
    const productMap = {}
    for (const item of (g || [])) {
      const key = item.recipe_code + '||' + item.recipe_name
      if (!productMap[key]) {
        productMap[key] = { recipe_code: item.recipe_code, recipe_name: item.recipe_name, recipe_version: item.recipe_version, original_kg: 0, issued_kg: 0, corrections_kg: 0, available_kg: 0, batch_count: 0 }
      }
      productMap[key].original_kg += parseFloat(item.original_kg || 0)
      productMap[key].issued_kg += parseFloat(item.issued_kg || 0)
      productMap[key].corrections_kg += parseFloat(item.corrections_kg || 0)
      productMap[key].available_kg += parseFloat(item.available_kg || 0)
      productMap[key].batch_count++
    }
    setProducts(Object.values(productMap))
    setLoading(false)
  }

  function goodsForProduct(recipe_code) { return goods.filter(g => g.recipe_code === recipe_code) }

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase()
    const matchQ = !q || p.recipe_name.toLowerCase().includes(q) || p.recipe_code.toLowerCase().includes(q)
    const matchView = filterView === 'wszystkie' ? true : filterView === 'aktywne' ? p.available_kg > 0 : filterView === 'wydane' ? p.available_kg <= 0 : true
    return matchQ && matchView
  })

  const stats = {
    products: products.length,
    available: products.filter(p => parseFloat(p.available_kg) > 0).length,
    totalKg: goods.reduce((s, g) => s + parseFloat(g.original_kg || 0), 0).toFixed(1),
    availableKg: goods.reduce((s, g) => s + parseFloat(g.available_kg || 0), 0).toFixed(1),
  }

  const af = (k, v) => setAcceptForm(p => ({ ...p, [k]: v }))

  function handleBatchSelect(batchId) {
    af('production_batch_id', batchId)
    const pb = prodBatches.find(p => p.id === batchId)
    setSelectedProdBatch(pb || null)
    if (pb) af('quantity_kg', pb.quantity_kg)
  }

  async function saveAccept() {
    if (!acceptForm.production_batch_id) { setError('Wybierz partię produkcyjną'); return }
    if (!acceptForm.quantity_kg) { setError('Podaj ilość'); return }
    if (selectedProdBatch?.production_date && acceptForm.received_date < selectedProdBatch.production_date) { setError('Data przyjęcia nie może być wcześniejsza niż data produkcji'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('finished_goods').insert({ production_batch_id: acceptForm.production_batch_id, order_id: acceptForm.order_id || null, received_date: acceptForm.received_date, quantity_kg: parseFloat(acceptForm.quantity_kg), location: acceptForm.location || null, notes: acceptForm.notes || null, created_by: profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    if (acceptForm.order_id) await supabase.from('orders').update({ status: 'zrealizowane', updated_at: new Date().toISOString() }).eq('id', acceptForm.order_id)
    setSaving(false); setAcceptModal(false)
    setAcceptForm({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0, 10), quantity_kg: '', location: '', notes: '' })
    setSelectedProdBatch(null); load()
  }

  function openEdit(good) { setEditGood(good); setEditForm({ received_date: good.received_date, quantity_kg: good.original_kg, location: good.location || '', notes: good.notes || '' }); setError(''); setEditModal(true) }

  async function saveEdit() {
    if (!editForm.received_date || !editForm.quantity_kg) { setError('Uzupełnij wymagane pola'); return }
    setSavingEdit(true); setError('')
    const { error: err } = await supabase.from('finished_goods').update({ received_date: editForm.received_date, quantity_kg: parseFloat(editForm.quantity_kg), location: editForm.location || null, notes: editForm.notes || null, updated_at: new Date().toISOString() }).eq('id', editGood.id)
    setSavingEdit(false)
    if (err) { setError(err.message); return }
    setEditModal(false); load()
  }

  function openCorr(good) { setCorrGood(good); setCorrForm({ correction_type: 'korekta_inwentury', delta_kg: '', reason: '', event_date: new Date().toISOString().slice(0, 10) }); setError(''); setCorrModal(true) }

  async function saveCorr() {
    if (!corrForm.reason) { setError('Podaj przyczynę korekty'); return }
    if (corrForm.correction_type !== 'utylizacja' && !corrForm.delta_kg) { setError('Podaj ilość korekty'); return }
    setSaving(true); setError('')
    const delta = corrForm.correction_type === 'utylizacja' ? -parseFloat(corrGood.available_kg) : parseFloat(corrForm.delta_kg)
    const { error: err } = await supabase.from('fg_corrections').insert({ finished_good_id: corrGood.id, correction_type: corrForm.correction_type, delta_kg: delta, reason: corrForm.reason, event_date: corrForm.event_date, approved_by: profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false); setCorrModal(false); load()
  }

  function openInwentura() {
    const rows = goods.filter(g => parseFloat(g.available_kg) > 0).map(g => ({ id: g.id, lot_number: g.lot_number, recipe_name: g.recipe_name, recipe_code: g.recipe_code, available_kg: parseFloat(g.available_kg), inwentura_kg: parseFloat(g.available_kg).toFixed(3) }))
    setInwenturaRows(rows); setInwenturaDate(new Date().toISOString().slice(0, 10)); setError(''); setInwenturaModal(true)
  }

  async function saveInwentura() {
    setSavingInwentura(true); setError('')
    const toSave = inwenturaRows.filter(r => Math.abs(parseFloat(r.inwentura_kg) - r.available_kg) > 0.001)
    for (const r of toSave) {
      const delta = parseFloat(r.inwentura_kg) - r.available_kg
      await supabase.from('fg_corrections').insert({ finished_good_id: r.id, correction_type: 'korekta_inwentury', delta_kg: parseFloat(delta.toFixed(3)), reason: `Inwentura ${inwenturaDate}`, event_date: inwenturaDate, approved_by: profile?.id })
    }
    setSavingInwentura(false); setInwenturaModal(false); load()
  }

  async function generateWzNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('wz_documents').select('wz_number').ilike('wz_number', `WZ-${year}-%`).order('wz_number', { ascending: false }).limit(1)
    if (data && data.length > 0) { const last = parseInt(data[0].wz_number.split('-')[2]) || 0; return `WZ-${year}-${String(last + 1).padStart(4, '0')}` }
    return `WZ-${year}-0001`
  }

  function openWz(good) { setWzGood(good); setWzForm({ issue_date: new Date().toISOString().slice(0, 10), quantity_kg: parseFloat(good.available_kg).toFixed(3), recipient: good.client || '', carrier: '', notes: '' }); setError(''); setWzModal(true) }
  const wf = (k, v) => setWzForm(p => ({ ...p, [k]: v }))

  async function saveWz() {
    if (!wzForm.quantity_kg || parseFloat(wzForm.quantity_kg) <= 0) { setError('Podaj ilość do wydania'); return }
    if (parseFloat(wzForm.quantity_kg) > parseFloat(wzGood.available_kg)) { setError(`Maksymalna dostępna ilość: ${wzGood.available_kg} kg`); return }
    setSaving(true); setError('')
    const wzNumber = await generateWzNumber()
    const { error: err } = await supabase.from('wz_documents').insert({ wz_number: wzNumber, finished_good_id: wzGood.id, order_id: wzGood.order_id || null, issue_date: wzForm.issue_date, quantity_kg: parseFloat(wzForm.quantity_kg), recipient: wzForm.recipient || null, carrier: wzForm.carrier || null, notes: wzForm.notes || null, issued_by: profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    if (wzGood.order_id && parseFloat(wzGood.available_kg) - parseFloat(wzForm.quantity_kg) <= 0.001) await supabase.from('orders').update({ status: 'wyslane', updated_at: new Date().toISOString() }).eq('id', wzGood.order_id)
    setSaving(false); setWzModal(false)
    setPrintWzData({ wzNumber, good: wzGood, form: { ...wzForm } }); load()
  }

  function printWZ(wzNumber, good, form) {
    const qty = parseFloat(form.quantity_kg).toFixed(3)
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>WZ ${wzNumber}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:14px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.wz-number{font-size:18px;font-weight:bold;color:#0F6E56;margin-top:4px}.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}.info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}.info-value{font-size:13px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-bottom:14px}th{background:#0F6E56;color:#fff;padding:6px;font-size:9px;text-align:left;border:1px solid #085041}td{padding:6px;border:1px solid #D3D1C7;font-size:11px}.total td{background:#E1F5EE;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1px solid #333;margin-top:28px;margin-bottom:4px}.sig-label{font-size:9px;color:#888;text-transform:uppercase}@media print{@page{margin:10mm;size:A4}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:13px;font-weight:bold;margin-top:3px">Wydanie Zewnętrzne (WZ)</div><div class="wz-number">${wzNumber}</div></div><div style="text-align:right;font-size:10px;color:#555">Data wydania: <strong>${form.issue_date}</strong><br>Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}<br>Wystawił: <strong>${profile?.full_name||'—'}</strong></div></div><div class="info-grid"><div class="info-box"><div class="info-label">Odbiorca</div><div class="info-value">${form.recipient||'—'}</div></div><div class="info-box"><div class="info-label">Przewoźnik</div><div class="info-value">${form.carrier||'—'}</div></div><div class="info-box"><div class="info-label">Nr zlecenia</div><div class="info-value">${good.order_number||'—'}</div></div><div class="info-box"><div class="info-label">Nr partii produkcyjnej</div><div class="info-value">${good.lot_number}</div></div><div class="info-box"><div class="info-label">Receptura</div><div class="info-value">${good.recipe_code} — ${good.recipe_name}</div></div><div class="info-box"><div class="info-label">Lokalizacja</div><div class="info-value">${good.location||'—'}</div></div></div><table><thead><tr><th>Lp.</th><th>Kod</th><th>Nazwa produktu</th><th style="text-align:right">Ilość (kg)</th><th>Nr partii</th><th>Uwagi</th></tr></thead><tbody><tr><td>1</td><td>${good.recipe_code}</td><td>${good.recipe_name} (${good.recipe_version})</td><td style="text-align:right;font-weight:bold">${qty}</td><td>${good.lot_number}</td><td>${form.notes||''}</td></tr><tr class="total"><td colspan="3" style="text-align:right">RAZEM:</td><td style="text-align:right">${qty} kg</td><td colspan="2"></td></tr></tbody></table><div class="sig-grid"><div><div class="sig-label">Wydał (magazyn)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Odebrał</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('', '_blank'); win.document.write(html); win.document.close()
  }

  function setMiesiac() { const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); setBilansDat1(`${y}-${String(m+1).padStart(2,'0')}-01`); setBilansDat2(`${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`); setBilansMode('miesiac') }
  function setKwartal() { const now = new Date(); const y = now.getFullYear(); const q = Math.floor(now.getMonth()/3); const fm=q*3+1; const lm=q*3+3; setBilansDat1(`${y}-${String(fm).padStart(2,'0')}-01`); setBilansDat2(`${y}-${String(lm).padStart(2,'0')}-${String(new Date(y,lm,0).getDate()).padStart(2,'0')}`); setBilansMode('kwartal') }
  function setRok() { const y=new Date().getFullYear(); setBilansDat1(`${y}-01-01`); setBilansDat2(`${y}-12-31`); setBilansMode('rok') }

  async function obliczBilans() {
    setBilansLoading(true); setShowBilans(true)
    const d1=bilansDat1, d2=bilansDat2

    // Pobierz wartości surowców per partia
    const { data: allGoods } = await supabase.from('finished_goods').select('id,production_batch_id')
    const allBatchIds = (allGoods||[]).map(x=>x.production_batch_id).filter(Boolean)
    const bvLocal = {}
    if (allBatchIds.length > 0) {
      const { data: pbi } = await supabase.from('production_batch_items').select('production_batch_id,quantity_used_kg,ingredient_batches(unit_price_pln)').in('production_batch_id', allBatchIds)
      for (const item of (pbi||[])) {
        const price = parseFloat(item.ingredient_batches?.unit_price_pln||0)
        const qty = parseFloat(item.quantity_used_kg||0)
        if (!bvLocal[item.production_batch_id]) bvLocal[item.production_batch_id] = 0
        bvLocal[item.production_batch_id] += price * qty
      }
    }
    // Mapa finished_good_id -> batch_value (proporcjonalnie do ilości)
    const fgValueMap = {}
    const fgQtyMap = {}
    for (const fg of (allGoods||[])) {
      fgValueMap[fg.id] = bvLocal[fg.production_batch_id] || 0
    }

    const [{ data: przyjecia }, { data: przyjBefore }, { data: wzPeriod }, { data: wzBefore }, { data: corrPeriod }, { data: corrBefore }] = await Promise.all([
      supabase.from('finished_goods').select('id,quantity_kg,received_date,production_batches(recipe_id,recipes(code,name))').gte('received_date',d1).lte('received_date',d2),
      supabase.from('finished_goods').select('id,quantity_kg,received_date,production_batches(recipe_id,recipes(code,name))').lt('received_date',d1),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').gte('issue_date',d1).lte('issue_date',d2),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').lt('issue_date',d1),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').gte('event_date',d1).lte('event_date',d2),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').lt('event_date',d1),
    ])
    function rk(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.code+'||'+r.name:null }
    function rn(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.name:'?' }
    function rc(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.code:'?' }
    const keys=new Set(), boMap={}, przychMap={}, rozchMap={}, korMap={}, nameMap={}, codeMap={}
    const boValMap={}, przychValMap={}, rozchValMap={}
    for (const p of (przyjBefore||[])) { const k=rk(p); if(!k) continue; keys.add(k); boMap[k]=(boMap[k]||0)+parseFloat(p.quantity_kg); boValMap[k]=(boValMap[k]||0)+(fgValueMap[p.id]||0); nameMap[k]=rn(p); codeMap[k]=rc(p) }
    for (const w of (wzBefore||[])) { const k=rk(w); if(!k) continue; keys.add(k); boMap[k]=(boMap[k]||0)-parseFloat(w.quantity_kg); nameMap[k]=rn(w); codeMap[k]=rc(w) }
    for (const c of (corrBefore||[])) { const k=rk(c); if(!k) continue; keys.add(k); boMap[k]=(boMap[k]||0)+parseFloat(c.delta_kg); nameMap[k]=rn(c); codeMap[k]=rc(c) }
    for (const p of (przyjecia||[])) { const k=rk(p); if(!k) continue; keys.add(k); przychMap[k]=(przychMap[k]||0)+parseFloat(p.quantity_kg); przychValMap[k]=(przychValMap[k]||0)+(fgValueMap[p.id]||0); nameMap[k]=rn(p); codeMap[k]=rc(p) }
    for (const w of (wzPeriod||[])) { const k=rk(w); if(!k) continue; keys.add(k); rozchMap[k]=(rozchMap[k]||0)+parseFloat(w.quantity_kg); nameMap[k]=rn(w); codeMap[k]=rc(w) }
    for (const c of (corrPeriod||[])) { const k=rk(c); if(!k) continue; keys.add(k); korMap[k]=(korMap[k]||0)+parseFloat(c.delta_kg); nameMap[k]=rn(c); codeMap[k]=rc(c) }
    const bilans=[...keys].map(k=>{const bo=parseFloat(Math.max(0,boMap[k]||0).toFixed(3)); const przych=parseFloat((przychMap[k]||0).toFixed(3)); const kor=parseFloat((korMap[k]||0).toFixed(3)); const rozch=parseFloat((rozchMap[k]||0).toFixed(3)); const bz=parseFloat(Math.max(0,bo+przych+kor-rozch).toFixed(3)); const boVal=parseFloat((boValMap[k]||0).toFixed(2)); const przychVal=parseFloat((przychValMap[k]||0).toFixed(2)); const bzVal=parseFloat(Math.max(0,boVal+przychVal).toFixed(2)); return {key:k,code:codeMap[k],name:nameMap[k],bo,przych,kor,rozch,bz,boVal,przychVal,bzVal}}).filter(r=>r.bo>0||r.przych>0||r.kor!==0||r.rozch>0||r.bz>0).sort((a,b)=>a.code.localeCompare(b.code))
    setBilansData(bilans); setBilansLoading(false)
  }

  function printBilans() {
    const d1str=new Date(bilansDat1).toLocaleDateString('pl-PL'), d2str=new Date(bilansDat2).toLocaleDateString('pl-PL')
    const rowsHtml=bilansData.map((r,i)=>`<tr><td>${i+1}</td><td style="font-family:monospace;font-size:8px">${r.code}</td><td>${r.name}</td><td style="text-align:right">${r.bo.toFixed(3)}</td><td style="text-align:right;color:#085041">${r.przych.toFixed(3)}</td><td style="text-align:right;color:${r.kor<0?'#A32D2D':'#633806'}">${r.kor!==0?(r.kor>0?'+':'')+r.kor.toFixed(3):'—'}</td><td style="text-align:right;color:#7B3F00">${r.rozch.toFixed(3)}</td><td style="text-align:right;font-weight:bold;color:#0C447C">${r.bz.toFixed(3)}</td></tr>`).join('')
    const sumaHtml=`<tr class="total"><td colspan="3" style="text-align:right">SUMA:</td><td style="text-align:right">${bilansData.reduce((s,r)=>s+r.bo,0).toFixed(3)}</td><td style="text-align:right;color:#085041">${bilansData.reduce((s,r)=>s+r.przych,0).toFixed(3)}</td><td style="text-align:right">${bilansData.reduce((s,r)=>s+r.kor,0).toFixed(3)}</td><td style="text-align:right;color:#7B3F00">${bilansData.reduce((s,r)=>s+r.rozch,0).toFixed(3)}</td><td style="text-align:right;font-weight:bold">${bilansData.reduce((s,r)=>s+r.bz,0).toFixed(3)}</td></tr>`
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Bilans Magazyn Instant</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;padding:14px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}.company{font-size:15px;font-weight:bold;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#0F6E56;color:#fff;padding:5px;border:1px solid #085041;font-size:8px;text-align:left}td{padding:4px 5px;border:1px solid #D3D1C7;font-size:9px}tr:nth-child(even) td{background:#FAFAF8}.total td{background:#E1F5EE!important;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1.5px solid #333;margin-top:24px;margin-bottom:4px}.sig-label{font-size:8px;color:#888;text-transform:uppercase}@media print{@page{margin:8mm;size:A4 landscape}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:12px;font-weight:bold;margin-top:3px">Bilans Magazynu Instant — Wyroby Gotowe</div><div style="font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px">Okres: ${d1str} — ${d2str}</div></div><div style="text-align:right;font-size:9px;color:#555">Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}<br>Wydrukował: ${profile?.full_name||'—'}</div></div><table><thead><tr><th style="width:22px">Lp.</th><th style="width:60px">Kod</th><th>Nazwa produktu</th><th style="width:65px;text-align:right">BO (kg)</th><th style="width:65px;text-align:right">Przychód (kg)</th><th style="width:60px;text-align:right">Korekty (kg)</th><th style="width:65px;text-align:right">Rozchód (kg)</th><th style="width:65px;text-align:right">BZ (kg)</th></tr></thead><tbody>${rowsHtml}${sumaHtml}</tbody></table><div class="sig-grid"><div><div class="sig-label">Sporządził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Weryfikował</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const corrForGood = (goodId) => corrections.filter(c => c.finished_good_id === goodId)
  const wzForGood = (goodId) => wzDocs.filter(w => w.finished_good_id === goodId)
  const fmt3 = v => parseFloat(v || 0).toFixed(3)

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Magazyn Instant</div><div className="page-sub">Wyroby gotowe — przyjęcia, inwentury, wydania WZ</div></div>
        <div className="flex" style={{ gap: 8 }}>
          <input className="search" placeholder="Szukaj produktu..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          {canEdit && <button className="btn btn-sm" onClick={openInwentura}>📋 Inwentura</button>}
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setAcceptForm({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0,10), quantity_kg: '', location: '', notes: '' }); setSelectedProdBatch(null); setError(''); setAcceptModal(true) }}>+ Przyjęcie</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Produktów na stanie</div><div className="stat-val">{stats.products}</div></div>
        <div className="stat-card"><div className="stat-label">Z dostępnym stanem</div><div className="stat-val" style={{ color: '#085041' }}>{stats.available}</div></div>
        <div className="stat-card"><div className="stat-label">Łącznie przyjęto (kg)</div><div className="stat-val">{parseFloat(stats.totalKg).toLocaleString('pl-PL')}</div></div>
        <div className="stat-card"><div className="stat-label">Dostępne (kg)</div><div className="stat-val" style={{ color: '#085041' }}>{parseFloat(stats.availableKg).toLocaleString('pl-PL')}</div></div>
      </div>

      {/* Bilans */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>Bilans magazynowy</span>
          <div className="flex" style={{ gap: 6 }}>
            <button className={`btn btn-sm ${bilansMode==='miesiac'?'btn-primary':''}`} onClick={setMiesiac}>Bieżący miesiąc</button>
            <button className={`btn btn-sm ${bilansMode==='kwartal'?'btn-primary':''}`} onClick={setKwartal}>Bieżący kwartał</button>
            <button className={`btn btn-sm ${bilansMode==='rok'?'btn-primary':''}`} onClick={setRok}>Bieżący rok</button>
            <button className={`btn btn-sm ${bilansMode==='custom'?'btn-primary':''}`} onClick={() => setBilansMode('custom')}>Własny zakres</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto 1fr', gap: 10, alignItems: 'end' }}>
          <div><label>Od</label><input type="date" value={bilansDat1} onChange={e => { setBilansDat1(e.target.value); setBilansMode('custom') }} /></div>
          <div style={{ paddingTop: 20, color: '#888' }}>→</div>
          <div><label>Do</label><input type="date" value={bilansDat2} onChange={e => { setBilansDat2(e.target.value); setBilansMode('custom') }} /></div>
          <button className="btn btn-primary btn-sm" onClick={obliczBilans} style={{ alignSelf: 'flex-end' }}>Oblicz bilans</button>
          {showBilans && bilansData.length > 0 && <button className="btn btn-sm" onClick={printBilans} style={{ alignSelf: 'flex-end' }}>Drukuj bilans</button>}
        </div>
        {showBilans && (
          <div style={{ marginTop: 12 }}>
            {bilansLoading ? (
              <div style={{ textAlign: 'center', padding: 16 }}><span className="spinner" /> Obliczam bilans...</div>
            ) : bilansData.length === 0 ? (
              <div className="muted" style={{ padding: 12 }}>Brak ruchów w wybranym okresie.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 700 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff' }}><tr>
                    <th>Kod</th><th>Nazwa produktu</th>
                    <th style={{ textAlign: 'right', background: '#E6F1FB', color: '#0C447C' }}>BO (kg)</th>
                    <th style={{ textAlign: 'right', background: '#E6F1FB', color: '#0C447C' }}>Wart. BO (zł)</th>
                    <th style={{ textAlign: 'right', background: '#E1F5EE', color: '#085041' }}>Przychód (kg)</th>
                    <th style={{ textAlign: 'right', background: '#E1F5EE', color: '#085041' }}>Wart. przychodu (zł)</th>
                    <th style={{ textAlign: 'right', background: '#FFF8E1', color: '#E65100' }}>Korekty (kg)</th>
                    <th style={{ textAlign: 'right', background: '#FAEEDA', color: '#7B3F00' }}>Rozchód (kg)</th>
                    <th style={{ textAlign: 'right', background: '#EEEDFE', color: '#3C3489' }}>BZ (kg)</th>
                    <th style={{ textAlign: 'right', background: '#EEEDFE', color: '#3C3489' }}>Wart. BZ (zł)</th>
                  </tr></thead>
                  <tbody>
                    {bilansData.map(r => (
                      <tr key={r.key}>
                        <td><span className="lot">{r.code}</span></td>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ textAlign: 'right', color: '#0C447C' }}>{r.bo.toFixed(3)}</td>
                        <td style={{ textAlign: 'right', color: '#0C447C', fontSize: 11 }}>{r.boVal > 0 ? r.boVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                        <td style={{ textAlign: 'right', color: '#085041', fontWeight: 500 }}>{r.przych.toFixed(3)}</td>
                        <td style={{ textAlign: 'right', color: '#085041', fontSize: 11, fontWeight: 500 }}>{r.przychVal > 0 ? r.przychVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                        <td style={{ textAlign: 'right', color: r.kor < 0 ? '#A32D2D' : r.kor > 0 ? '#085041' : '#888' }}>{r.kor !== 0 ? (r.kor > 0 ? '+' : '') + r.kor.toFixed(3) : '—'}</td>
                        <td style={{ textAlign: 'right', color: '#7B3F00', fontWeight: 500 }}>{r.rozch.toFixed(3)}</td>
                        <td style={{ textAlign: 'right', color: '#3C3489', fontWeight: 700 }}>{r.bz.toFixed(3)}</td>
                        <td style={{ textAlign: 'right', color: '#3C3489', fontSize: 11, fontWeight: 700 }}>{r.bz > 0 ? r.bzVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#F1EFE8' }}>
                      <td colSpan={2} style={{ fontWeight: 500, textAlign: 'right' }}>SUMA</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{bilansData.reduce((s,r)=>s+r.bo,0).toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#0C447C' }}>{bilansData.reduce((s,r)=>s+r.boVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#085041' }}>{bilansData.reduce((s,r)=>s+r.przych,0).toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#085041' }}>{bilansData.reduce((s,r)=>s+r.przychVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#E65100' }}>{bilansData.reduce((s,r)=>s+r.kor,0).toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#7B3F00' }}>{bilansData.reduce((s,r)=>s+r.rozch,0).toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#3C3489' }}>{bilansData.reduce((s,r)=>s+r.bz,0).toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#3C3489' }}>{bilansData.reduce((s,r)=>s+r.bzVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {printWzData && (
        <div className="info-box" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>✓ Dokument <b>{printWzData.wzNumber}</b> wystawiony pomyślnie.</span>
          <div className="flex" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => printWZ(printWzData.wzNumber, printWzData.good, printWzData.form)}>Drukuj WZ</button>
            <button className="btn btn-sm" onClick={() => setPrintWzData(null)}>✕</button>
          </div>
        </div>
      )}

      <div className="flex" style={{ marginBottom: 10, gap: 6 }}>
        {[['aktywne','Dostępne'],['wydane','Wydane'],['wszystkie','Wszystkie']].map(([val,label]) => (
          <button key={val} className="btn btn-sm" onClick={() => setFilterView(val)}
            style={{ background: filterView===val?'#1D9E75':undefined, color: filterView===val?'#fff':undefined, borderColor: filterView===val?'#1D9E75':undefined }}>
            {label}
          </button>
        ))}
      </div>

      {/* Główna tabela */}
      <div style={{ background: '#fff', border: '0.5px solid #D3D1C7', borderRadius: 8, overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff' }}><tr>
            <th style={{ width: 32 }}></th>
            <th>Kod</th><th>Nazwa produktu</th>
            <th style={{ textAlign: 'right' }}>Przyjęto (kg)</th>
            <th style={{ textAlign: 'right' }}>Korekty (kg)</th>
            <th style={{ textAlign: 'right' }}>Wydano (kg)</th>
            <th style={{ textAlign: 'right' }}>Dostępne (kg)</th>
            <th style={{ textAlign: 'right' }}>Wart. surowców</th>
            <th style={{ textAlign: 'center' }}>Partii</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Ładowanie...</td></tr>}
            {!loading && filteredProducts.map(p => {
              const isExpanded = expandedProduct === p.recipe_code
              const available = parseFloat(p.available_kg)
              const partieList = goodsForProduct(p.recipe_code)
              return (
                <React.Fragment key={p.recipe_code}>
                  <tr style={{ background: available <= 0 ? '#F9F8F5' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <button onClick={() => setExpandedProduct(isExpanded ? null : p.recipe_code)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#5F5E5A', padding: '2px 4px' }}>
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </td>
                    <td><span className="lot">{p.recipe_code}</span></td>
                    <td style={{ fontWeight: 500 }}>{p.recipe_name} <span className="badge b-info" style={{ fontSize: 10 }}>{p.recipe_version}</span></td>
                    <td style={{ textAlign: 'right', color: '#085041', fontWeight: 500 }}>{fmt3(p.original_kg)}</td>
                    <td style={{ textAlign: 'right', color: parseFloat(p.corrections_kg) < 0 ? '#A32D2D' : parseFloat(p.corrections_kg) > 0 ? '#085041' : '#888' }}>
                      {parseFloat(p.corrections_kg) !== 0 ? (parseFloat(p.corrections_kg) > 0 ? '+' : '') + fmt3(p.corrections_kg) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: '#633806' }}>{fmt3(p.issued_kg)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: available <= 0 ? '#888' : '#0F6E56' }}>{fmt3(available)}</span>
                      {available <= 0 && <span className="badge b-gray" style={{ marginLeft: 6, fontSize: 10 }}>Wydano</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: '#3C3489' }}>
                      {(() => { const v = goodsForProduct(p.recipe_code).reduce((s,g) => s + (batchValues[g.production_batch_id] || 0), 0); return v > 0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—' })()}
                    </td>
                    <td style={{ textAlign: 'center', color: '#5F5E5A' }}>{p.batch_count}</td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: '#F9F8F5' }}>
                        <div style={{ padding: '8px 16px 12px 40px' }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: '#0F6E56', marginBottom: 8 }}>Partie — {p.recipe_name}</div>
                          <table style={{ width: 'auto', minWidth: 700 }}>
                            <thead><tr>
                              <th style={{ width: 32 }}></th>
                              <th>Nr partii</th><th>Data przyjęcia</th>
                              <th style={{ textAlign: 'right' }}>Przyjęto (kg)</th>
                              <th style={{ textAlign: 'right' }}>Korekty (kg)</th>
                              <th style={{ textAlign: 'right' }}>Wydano (kg)</th>
                              <th style={{ textAlign: 'right' }}>Dostępne (kg)</th>
                              <th style={{ textAlign: 'right' }}>Wart. surowców</th>
                              <th>Lokalizacja</th><th>Zlecenie</th><th></th>
                            </tr></thead>
                            <tbody>
                              {partieList.map(g => {
                                const avail = parseFloat(g.available_kg)
                                const gCorrs = corrForGood(g.id)
                                const gWz = wzForGood(g.id)
                                const gExpanded = expandedGood === g.id
                                return (
                                  <React.Fragment key={g.id}>
                                    <tr style={{ background: avail <= 0 ? '#F1EFE8' : '#fff' }}>
                                      <td style={{ textAlign: 'center' }}>
                                        {(gCorrs.length > 0 || gWz.length > 0) && (
                                          <button onClick={() => setExpandedGood(gExpanded ? null : g.id)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#5F5E5A', padding: '1px 3px' }}>
                                            {gExpanded ? '▲' : '▼'}
                                          </button>
                                        )}
                                      </td>
                                      <td><span className="lot" style={{ fontSize: 11 }}>{g.lot_number}</span></td>
                                      <td className="muted" style={{ fontSize: 11 }}>{g.received_date}</td>
                                      <td style={{ textAlign: 'right', color: '#085041', fontWeight: 500, fontSize: 12 }}>{fmt3(g.original_kg)}</td>
                                      <td style={{ textAlign: 'right', fontSize: 11, color: parseFloat(g.corrections_kg) < 0 ? '#A32D2D' : parseFloat(g.corrections_kg) > 0 ? '#085041' : '#888' }}>
                                        {parseFloat(g.corrections_kg) !== 0 ? (parseFloat(g.corrections_kg) > 0 ? '+' : '') + fmt3(g.corrections_kg) : '—'}
                                      </td>
                                      <td style={{ textAlign: 'right', color: '#633806', fontSize: 12 }}>{fmt3(g.issued_kg)}</td>
                                      <td style={{ textAlign: 'right' }}>
                                        <span style={{ fontWeight: 700, color: avail <= 0 ? '#888' : '#0F6E56', fontSize: 12 }}>{fmt3(avail)}</span>
                                      </td>
                                      <td style={{ textAlign: 'right', fontSize: 11, color: '#3C3489' }}>
                                        {batchValues[g.production_batch_id] ? batchValues[g.production_batch_id].toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}
                                      </td>
                                      <td className="muted" style={{ fontSize: 11 }}>{g.location || '—'}</td>
                                      <td style={{ fontSize: 11 }}>
                                        {g.order_number ? <span className="lot" style={{ fontSize: 10 }}>{g.order_number}</span> : <span className="muted">—</span>}
                                      </td>
                                      <td>
                                        <div className="flex" style={{ gap: 3 }}>
                                          {canEdit && avail > 0 && <button className="btn btn-sm btn-primary" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => openWz(g)}>WZ</button>}
                                          {canEdit && avail > 0 && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px', background: '#FFF3E0', color: '#E65100', border: '0.5px solid #FFCC80' }} onClick={() => openCorr(g)}>Korekta</button>}
                                          {isAdmin && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => openEdit(g)}>Edytuj</button>}
                                        </div>
                                      </td>
                                    </tr>
                                    {gExpanded && (
                                      <tr>
                                        <td colSpan={10} style={{ padding: '6px 8px 8px 48px', background: '#F1EFE8' }}>
                                          {gCorrs.length > 0 && (
                                            <div style={{ marginBottom: 8 }}>
                                              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4, color: '#E65100' }}>Historia korekt</div>
                                              {gCorrs.map(c => (
                                                <div key={c.id} style={{ fontSize: 11, color: '#5F5E5A', padding: '3px 0', borderBottom: '0.5px solid #D3D1C7', display: 'flex', gap: 12 }}>
                                                  <span><b>{CORR_LABELS[c.correction_type] || c.correction_type}</b>: {c.reason}</span>
                                                  <span className={`badge ${parseFloat(c.delta_kg) < 0 ? 'b-err' : 'b-ok'}`} style={{ fontSize: 10 }}>{parseFloat(c.delta_kg) > 0 ? '+' : ''}{parseFloat(c.delta_kg).toFixed(3)} kg</span>
                                                  <span className="muted">{c.event_date}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {gWz.length > 0 && (
                                            <div>
                                              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4, color: '#0C447C' }}>Dokumenty WZ</div>
                                              {gWz.map(wz => (
                                                <div key={wz.id} style={{ fontSize: 11, color: '#5F5E5A', padding: '3px 0', borderBottom: '0.5px solid #D3D1C7', display: 'flex', gap: 12 }}>
                                                  <span className="lot" style={{ fontSize: 10 }}>{wz.wz_number}</span>
                                                  <span>{wz.recipient || '—'}</span>
                                                  <span style={{ fontWeight: 500 }}>{parseFloat(wz.quantity_kg).toFixed(3)} kg</span>
                                                  <span className="muted">{wz.issue_date}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {!loading && filteredProducts.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Brak towarów na magazynie</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal przyjęcia */}
      <div className={`modal-overlay ${acceptModal?'open':''}`} onClick={e => e.target===e.currentTarget && setAcceptModal(false)}>
        <div className="modal">
          <div className="modal-title">Przyjęcie towaru na Magazyn Instant</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom: 10 }}>
            <label>Partia produkcyjna *</label>
            <select value={acceptForm.production_batch_id} onChange={e => handleBatchSelect(e.target.value)}>
              <option value="">— wybierz partię —</option>
              {prodBatches.map(pb => <option key={pb.id} value={pb.id}>{pb.lot_number} — {pb.recipe_name} ({pb.quantity_kg} kg) · {pb.production_date}</option>)}
            </select>
            {selectedProdBatch && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Data produkcji: <b>{selectedProdBatch.production_date}</b></div>}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>Powiąż ze zleceniem (opcjonalne)</label>
            <select value={acceptForm.order_id} onChange={e => af('order_id', e.target.value)}>
              <option value="">— brak powiązania —</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.order_number} — {o.client} ({o.recipes?.name}, {o.quantity_kg} kg)</option>)}
            </select>
          </div>
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={acceptForm.received_date} min={selectedProdBatch?.production_date||undefined} onChange={e => af('received_date', e.target.value)} /></div>
            <div><label>Ilość (kg) *</label><input type="number" step="0.001" value={acceptForm.quantity_kg} onChange={e => af('quantity_kg', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja magazynowa</label><input value={acceptForm.location} onChange={e => af('location', e.target.value)} placeholder="np. Regał A-3" /></div>
            <div><label>Uwagi</label><input value={acceptForm.notes} onChange={e => af('notes', e.target.value)} placeholder="opcjonalne" /></div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setAcceptModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveAccept} disabled={saving}>{saving?'Zapisywanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>

      {/* Modal edycji */}
      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal" style={{ maxWidth: 480 }}>
          <div className="modal-title">Edycja przyjęcia — {editGood?.lot_number}</div>
          <div className="info-box" style={{ marginBottom: 10 }}>Edycja dostępna tylko dla Admina.</div>
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

      {/* Modal korekty */}
      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal" style={{ maxWidth: 480 }}>
          <div className="modal-title">Korekta stanu — {corrGood?.lot_number}</div>
          {corrGood && <div style={{ background: '#F1EFE8', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}><b>{corrGood.recipe_code}</b> — {corrGood.recipe_name}<br />Dostępne: <b>{fmt3(corrGood.available_kg)} kg</b></div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrForm.correction_type} onChange={e => setCorrForm(p=>({...p,correction_type:e.target.value}))}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {corrForm.correction_type !== 'utylizacja' && (
              <div><label>Korekta ilości (kg) — ujemna = ubytek</label>
                <input type="number" step="0.001" value={corrForm.delta_kg} onChange={e => setCorrForm(p=>({...p,delta_kg:e.target.value}))} placeholder="np. -10 lub +5" />
              </div>
            )}
          </div>
          {corrForm.correction_type === 'utylizacja' && <div className="warn-box">Utylizacja pełna — cały dostępny stan zostanie wyzerowany.</div>}
          <div style={{ marginBottom: 10 }}><label>Przyczyna *</label><input value={corrForm.reason} onChange={e => setCorrForm(p=>({...p,reason:e.target.value}))} placeholder="np. zniszczenie opakowania" /></div>
          <div><label>Data zdarzenia</label><input type="date" value={corrForm.event_date} onChange={e => setCorrForm(p=>({...p,event_date:e.target.value}))} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-danger" onClick={saveCorr} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>

      {/* Modal inwentura */}
      <div className={`modal-overlay ${inwenturaModal?'open':''}`} onClick={e => e.target===e.currentTarget && setInwenturaModal(false)}>
        <div className="modal" style={{ maxWidth: 640 }}>
          <div className="modal-title">Inwentura Magazynu Instant</div>
          <div className="info-box" style={{ marginBottom: 10 }}>Wpisz rzeczywisty stan każdej partii. Różnice zostaną zapisane jako korekty inwentury.</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom: 12 }}><label>Data inwentury</label><input type="date" value={inwenturaDate} onChange={e => setInwenturaDate(e.target.value)} style={{ width: 180 }} /></div>
          <div style={{ overflowY: 'auto', maxHeight: 400, marginBottom: 10 }}>
            <table style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 5 }}><tr>
                <th>Receptura</th><th>Nr partii</th>
                <th style={{ textAlign: 'right' }}>Stan systemowy (kg)</th>
                <th style={{ textAlign: 'right' }}>Stan rzeczywisty (kg)</th>
                <th style={{ textAlign: 'right' }}>Różnica</th>
              </tr></thead>
              <tbody>
                {inwenturaRows.map((r, idx) => {
                  const diff = parseFloat(r.inwentura_kg || 0) - r.available_kg
                  return (
                    <tr key={r.id} style={{ background: Math.abs(diff) > 0.001 ? '#FAEEDA33' : undefined }}>
                      <td style={{ fontSize: 12 }}><span className="lot" style={{ fontSize: 10 }}>{r.recipe_code}</span> {r.recipe_name}</td>
                      <td><span className="lot" style={{ fontSize: 10 }}>{r.lot_number}</span></td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{r.available_kg.toFixed(3)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" step="0.001" min="0" value={r.inwentura_kg}
                          onChange={e => setInwenturaRows(prev => prev.map((row, i) => i === idx ? {...row, inwentura_kg: e.target.value} : row))}
                          style={{ width: 100, textAlign: 'right', fontSize: 12, padding: '3px 6px' }} />
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 500, color: Math.abs(diff) > 0.001 ? (diff < 0 ? '#A32D2D' : '#085041') : '#888', fontSize: 12 }}>
                        {Math.abs(diff) > 0.001 ? (diff > 0 ? '+' : '') + diff.toFixed(3) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {inwenturaRows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: '#888' }}>Brak partii z dostępnym stanem</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setInwenturaModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveInwentura} disabled={savingInwentura}>
              {savingInwentura ? 'Zapisywanie...' : `Zapisz inwenturę (${inwenturaRows.filter(r => Math.abs(parseFloat(r.inwentura_kg||0) - r.available_kg) > 0.001).length} korekt)`}
            </button>
          </div>
        </div>
      </div>

      {/* Modal WZ */}
      <div className={`modal-overlay ${wzModal?'open':''}`} onClick={e => e.target===e.currentTarget && setWzModal(false)}>
        <div className="modal">
          <div className="modal-title">Wystawienie dokumentu WZ</div>
          {wzGood && <div style={{ background: '#F1EFE8', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}><b>{wzGood.lot_number}</b> — {wzGood.recipe_name}<br />Dostępne: <b>{fmt3(wzGood.available_kg)} kg</b>{wzGood.order_number && <span> · Zlecenie: <b>{wzGood.order_number}</b></span>}</div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data wydania</label><input type="date" value={wzForm.issue_date} onChange={e => wf('issue_date', e.target.value)} /></div>
            <div><label>Ilość do wydania (kg) *</label><input type="number" step="0.001" value={wzForm.quantity_kg} onChange={e => wf('quantity_kg', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Odbiorca</label><input value={wzForm.recipient} onChange={e => wf('recipient', e.target.value)} placeholder="Nazwa firmy / osoby" /></div>
            <div><label>Przewoźnik / transport</label><input value={wzForm.carrier} onChange={e => wf('carrier', e.target.value)} placeholder="np. DHL, własny transport" /></div>
          </div>
          <div><label>Uwagi</label><input value={wzForm.notes} onChange={e => wf('notes', e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setWzModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveWz} disabled={saving}>{saving?'Zapisywanie...':'Wystaw WZ i drukuj'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
