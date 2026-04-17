import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Magazyn() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAlert, setFilterAlert] = useState('wszystkie')
  const [editingMin, setEditingMin] = useState({})
  const [savingMin, setSavingMin] = useState({})
  const [expandedId, setExpandedId] = useState(null)
  const [batchDetails, setBatchDetails] = useState({})

  const [bilansDat1, setBilansDat1] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().slice(0,10)
  })
  const [bilansDat2, setBilansDat2] = useState(new Date().toISOString().slice(0,10))
  const [bilansMode, setBilansMode] = useState('miesiac')
  const [showBilans, setShowBilans] = useState(false)
  const [bilansData, setBilansData] = useState([])
  const [bilansLoading, setBilansLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: ingredients } = await supabase
      .from('ingredients').select('id,code,name,has_allergen,allergen_type,minimum_stock_kg')
      .eq('status','aktywny').order('code')
    const { data: stock } = await supabase.from('v_stock').select('*')
    const { data: used } = await supabase.from('production_batch_items').select('ingredient_id,quantity_used_kg, production_batches!inner(id)')

    const stockMap = {}
    for (const s of (stock||[])) {
      if (!stockMap[s.ingredient_id]) stockMap[s.ingredient_id] = { total:0, original:0, corrections:0, value:0, batches:[] }
      stockMap[s.ingredient_id].original += parseFloat(s.original_kg||0)
      stockMap[s.ingredient_id].corrections += parseFloat(s.corrections_kg||0)
      if (s.status==='dopuszczona') {
        const currentKg = parseFloat(s.current_kg||0)
        stockMap[s.ingredient_id].total += currentKg
        const price = parseFloat(s.unit_price_pln||0)
        if (price > 0) stockMap[s.ingredient_id].value += currentKg * price
        stockMap[s.ingredient_id].batches.push({...s, batch_value: price > 0 ? currentKg * price : null})
      }
    }
    const usedMap = {}
    for (const u of (used||[])) {
      usedMap[u.ingredient_id] = (usedMap[u.ingredient_id]||0) + parseFloat(u.quantity_used_kg||0)
    }
    const result = (ingredients||[]).map(ing => {
      const availableStock = stockMap[ing.id]?.total||0
      const originalStock = stockMap[ing.id]?.original||0
      const correctionsTotal = stockMap[ing.id]?.corrections||0
      const usedTotal = usedMap[ing.id]||0
      const current = Math.max(0, availableStock - usedTotal)
      const minimum = parseFloat(ing.minimum_stock_kg||0)
      const batchCount = stockMap[ing.id]?.batches?.length||0

      let remaining_used = usedTotal
      let currentValue = 0
      const batches = (stockMap[ing.id]?.batches||[]).slice().sort((a,b) => new Date(a.received_date) - new Date(b.received_date))
      for (const b of batches) {
        const bKg = parseFloat(b.current_kg||0)
        const bPrice = parseFloat(b.unit_price_pln||0)
        const afterUse = Math.max(0, bKg - remaining_used)
        remaining_used = Math.max(0, remaining_used - bKg)
        if (bPrice > 0 && afterUse > 0) currentValue += afterUse * bPrice
      }

      let alert = 'ok'
      if (minimum>0) {
        if (current===0) alert='empty'
        else if (current<=minimum) alert='critical'
        else if (current<=minimum*1.5) alert='warning'
      }
      if (current===0&&minimum===0) alert='empty'
      return { id:ing.id, code:ing.code, name:ing.name, has_allergen:ing.has_allergen,
        allergen_type:ing.allergen_type,
        in_stock:parseFloat(originalStock.toFixed(3)),
        corrections_total:parseFloat(correctionsTotal.toFixed(3)),
        used_total:parseFloat(usedTotal.toFixed(3)),
        current:parseFloat(current.toFixed(3)),
        value:parseFloat(currentValue.toFixed(2)),
        minimum, batch_count:batchCount, alert }
    })
    setRows(result)
    setLoading(false)
  }

  async function loadBatchDetails(ingredientId) {
    if (expandedId === ingredientId) { setExpandedId(null); return }
    const { data } = await supabase
      .from('v_stock').select('*').eq('ingredient_id', ingredientId)
      .order('received_date', { ascending: true })
    setBatchDetails(p => ({ ...p, [ingredientId]: data||[] }))
    setExpandedId(ingredientId)
  }

  const filtered = rows.filter(r => {
    const matchQ = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase())
    const matchAlert = filterAlert==='wszystkie' ? true :
      filterAlert==='alerty' ? ['critical','warning','empty'].includes(r.alert) :
      filterAlert==='krytyczne' ? ['critical','empty'].includes(r.alert) :
      filterAlert==='ok' ? r.alert==='ok' : true
    return matchQ && matchAlert
  })

  const stats = {
    total: rows.length,
    critical: rows.filter(r => ['critical','empty'].includes(r.alert)&&r.minimum>0).length,
    warning: rows.filter(r => r.alert==='warning').length,
    empty: rows.filter(r => r.current===0).length,
  }

  const totalValue = filtered.reduce((s,r) => s + r.value, 0)

  async function saveMinimum(ingredientId, value) {
    setSavingMin(p => ({ ...p, [ingredientId]:true }))
    await supabase.from('ingredients').update({ minimum_stock_kg: parseFloat(value)||0 }).eq('id',ingredientId)
    setSavingMin(p => ({ ...p, [ingredientId]:false }))
    setEditingMin(p => ({ ...p, [ingredientId]:undefined }))
    load()
  }

  function alertBadge(r) {
    if (r.alert==='empty') return <span className="badge b-err">Brak</span>
    if (r.alert==='critical') return <span className="badge b-err">Krytyczny</span>
    if (r.alert==='warning') return <span className="badge b-warn">Niski</span>
    return <span className="badge b-ok">OK</span>
  }

  function alertRowStyle(r) {
    if (r.alert==='empty'||r.alert==='critical') return { background:'#FCEBEB55' }
    if (r.alert==='warning') return { background:'#FAEEDA33' }
    return {}
  }

  function stockBar(r) {
    if (r.minimum===0) return null
    const pct = Math.min(100, Math.round((r.current/(r.minimum*2))*100))
    const color = r.alert==='critical'||r.alert==='empty' ? '#E24B4A' : r.alert==='warning' ? '#EF9F27' : '#1D9E75'
    return (
      <div style={{ height:6, background:'#F1EFE8', borderRadius:999, marginTop:3, width:80 }}>
        <div style={{ height:6, width:`${pct}%`, background:color, borderRadius:999 }} />
      </div>
    )
  }

  function setMiesiac() {
    const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
    const first = `${y}-${String(m+1).padStart(2,'0')}-01`
    const lastDay = new Date(y, m+1, 0).getDate()
    const last = `${y}-${String(m+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    setBilansDat1(first); setBilansDat2(last); setBilansMode('miesiac')
  }

  function setKwartal() {
    const now = new Date(); const y = now.getFullYear(); const q = Math.floor(now.getMonth()/3)
    const firstMonth = q*3+1; const lastMonth = q*3+3
    const first = `${y}-${String(firstMonth).padStart(2,'0')}-01`
    const lastDay = new Date(y, lastMonth, 0).getDate()
    const last = `${y}-${String(lastMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    setBilansDat1(first); setBilansDat2(last); setBilansMode('kwartal')
  }

  function setRok() {
    const y = new Date().getFullYear()
    setBilansDat1(`${y}-01-01`); setBilansDat2(`${y}-12-31`); setBilansMode('rok')
  }

  async function obliczBilans() {
    setBilansLoading(true); setShowBilans(true)
    const d1 = bilansDat1, d2 = bilansDat2

    const { data: ingredients } = await supabase
      .from('ingredients').select('id,code,name').eq('status','aktywny').order('code')

    // Przychód w okresie (przyjęcia)
    const { data: przyj } = await supabase
      .from('ingredient_batches')
      .select('ingredient_id, quantity_kg, unit_price_pln, received_date')
      .gte('received_date', d1).lte('received_date', d2)

    // Korekty w okresie
    const { data: korektyw } = await supabase
      .from('stock_corrections')
      .select('ingredient_batch_id, delta_kg, event_date, ingredient_batches(ingredient_id, unit_price_pln)')
      .gte('event_date', d1).lte('event_date', d2)

    // Rozchód w okresie (produkcja)
    const { data: prod } = await supabase
      .from('production_batch_items')
      .select('ingredient_id, quantity_used_kg, ingredient_batches(unit_price_pln), production_batches(production_date)')

    // BO: stan przed d1
    // Przyjęcia przed d1
    const { data: przyjBefore } = await supabase
      .from('ingredient_batches')
      .select('ingredient_id, quantity_kg, unit_price_pln, received_date')
      .lt('received_date', d1)

    // Korekty przed d1
    const { data: korBefore } = await supabase
      .from('stock_corrections')
      .select('ingredient_batch_id, delta_kg, event_date, ingredient_batches(ingredient_id, unit_price_pln)')
      .lt('event_date', d1)

    // Rozchód przed d1
    const { data: prodBefore } = await supabase
      .from('production_batch_items')
      .select('ingredient_id, quantity_used_kg, ingredient_batches(unit_price_pln), production_batches(production_date)')

    // --- Buduj mapy ---
    const przychMap = {}, przychValMap = {}
    const korMap = {}, korValMap = {}
    const rozchMap = {}, rozchValMap = {}
    const boMap = {}, boValMap = {}

    // Przychód w okresie
    for (const p of (przyj||[])) {
      przychMap[p.ingredient_id] = (przychMap[p.ingredient_id]||0) + parseFloat(p.quantity_kg)
      const val = parseFloat(p.unit_price_pln||0) * parseFloat(p.quantity_kg)
      if (val > 0) przychValMap[p.ingredient_id] = (przychValMap[p.ingredient_id]||0) + val
    }

    // Korekty w okresie
    for (const k of (korektyw||[])) {
      const ingId = k.ingredient_batches?.ingredient_id
      if (!ingId) continue
      korMap[ingId] = (korMap[ingId]||0) + parseFloat(k.delta_kg)
      const price = parseFloat(k.ingredient_batches?.unit_price_pln||0)
      if (price > 0) korValMap[ingId] = (korValMap[ingId]||0) + parseFloat(k.delta_kg) * price
    }

    // Rozchód w okresie
    for (const p of (prod||[])) {
      if (!p.production_batches?.production_date) continue
      if (p.production_batches.production_date >= d1 && p.production_batches.production_date <= d2) {
        rozchMap[p.ingredient_id] = (rozchMap[p.ingredient_id]||0) + parseFloat(p.quantity_used_kg)
        const price = parseFloat(p.ingredient_batches?.unit_price_pln||0)
        if (price > 0) rozchValMap[p.ingredient_id] = (rozchValMap[p.ingredient_id]||0) + parseFloat(p.quantity_used_kg) * price
      }
    }

    // BO: przyjęcia przed d1
    for (const p of (przyjBefore||[])) {
      boMap[p.ingredient_id] = (boMap[p.ingredient_id]||0) + parseFloat(p.quantity_kg)
      const val = parseFloat(p.unit_price_pln||0) * parseFloat(p.quantity_kg)
      if (val > 0) boValMap[p.ingredient_id] = (boValMap[p.ingredient_id]||0) + val
    }
    // BO: minus korekty przed d1
    for (const k of (korBefore||[])) {
      const ingId = k.ingredient_batches?.ingredient_id
      if (!ingId) continue
      boMap[ingId] = (boMap[ingId]||0) + parseFloat(k.delta_kg)
      const price = parseFloat(k.ingredient_batches?.unit_price_pln||0)
      if (price > 0) boValMap[ingId] = (boValMap[ingId]||0) + parseFloat(k.delta_kg) * price
    }
    // BO: minus rozchód przed d1 (ilość i wartość)
    for (const p of (prodBefore||[])) {
      if (!p.production_batches?.production_date) continue
      if (p.production_batches.production_date < d1) {
        boMap[p.ingredient_id] = (boMap[p.ingredient_id]||0) - parseFloat(p.quantity_used_kg)
        const price = parseFloat(p.ingredient_batches?.unit_price_pln||0)
        if (price > 0) boValMap[p.ingredient_id] = (boValMap[p.ingredient_id]||0) - parseFloat(p.quantity_used_kg) * price
      }
    }

    // FIFO wartościowe — pobierz wszystkie partie z cenami posortowane wg daty przyjęcia
    const { data: allBatchesFifo } = await supabase
      .from('ingredient_batches')
      .select('id, ingredient_id, quantity_kg, unit_price_pln, received_date')
      .order('ingredient_id')
      .order('received_date', { ascending: true })

    // Pobierz CAŁE zużycie produkcyjne z przypisanymi cenami partii
    const { data: allProdUsed } = await supabase
      .from('production_batch_items')
      .select('ingredient_id, quantity_used_kg, ingredient_batch_id, ingredient_batches(unit_price_pln), production_batches(production_date)')

    // Korekty wszystkie z cenami
    const { data: allCorrs } = await supabase
      .from('stock_corrections')
      .select('ingredient_batch_id, delta_kg, event_date, ingredient_batches(ingredient_id, unit_price_pln)')

    // Funkcja FIFO wartościowa — oblicza wartość BZ dla danego składnika
    // Logika: symuluj FIFO — odejmuj zużycie i korekty od kolejnych partii (wg daty przyjęcia)
    function calcFifoVal(ingId) {
      // Partie tego składnika wg FIFO
      const ingBatches = (allBatchesFifo||[])
        .filter(b => b.ingredient_id === ingId && parseFloat(b.unit_price_pln||0) > 0)
        .map(b => ({
          id: b.id,
          remaining: parseFloat(b.quantity_kg),
          price: parseFloat(b.unit_price_pln)
        }))
      if (ingBatches.length === 0) return null

      // Korekty inwentury — modyfikują ilość w partiach
      for (const k of (allCorrs||[])) {
        const ingId2 = k.ingredient_batches?.ingredient_id
        if (ingId2 !== ingId) continue
        const batch = ingBatches.find(b => b.id === k.ingredient_batch_id)
        if (batch) batch.remaining += parseFloat(k.delta_kg)
      }

      // Odejmij zużycie produkcyjne (wszystkie partie produkcyjne <= d2)
      // Zużycie w kolejności daty produkcji — starsze partie zużywają starsze składniki
      const usedForIng = (allProdUsed||[])
        .filter(p => p.ingredient_id === ingId && p.production_batches?.production_date <= d2)
        .sort((a,b) => (a.production_batches?.production_date||'') < (b.production_batches?.production_date||'') ? -1 : 1)

      for (const u of usedForIng) {
        // Znajdź partię składnika której to zużycie dotyczy
        const batch = ingBatches.find(b => b.id === u.ingredient_batch_id)
        if (batch) batch.remaining -= parseFloat(u.quantity_used_kg)
      }

      // BZ wartość = suma pozostałości × cena dla każdej partii
      let bzVal = 0
      for (const b of ingBatches) {
        const rem = Math.max(0, b.remaining)
        bzVal += rem * b.price
      }
      return parseFloat(bzVal.toFixed(2))
    }

    const bilans = (ingredients||[]).map(ing => {
      const bo = parseFloat(Math.max(0, boMap[ing.id]||0).toFixed(3))
      const przych = parseFloat((przychMap[ing.id]||0).toFixed(3))
      const kor = parseFloat((korMap[ing.id]||0).toFixed(3))
      const rozch = parseFloat((rozchMap[ing.id]||0).toFixed(3))
      const bz = parseFloat(Math.max(0, bo + przych + kor - rozch).toFixed(3))
      const boVal = parseFloat(Math.max(0, boValMap[ing.id]||0).toFixed(2))
      const przychVal = parseFloat((przychValMap[ing.id]||0).toFixed(2))
      const korVal = parseFloat((korValMap[ing.id]||0).toFixed(2))
      const rozchVal = parseFloat((rozchValMap[ing.id]||0).toFixed(2))
      // BZ wartość — FIFO wartościowe: dokładne co do grosza
      const bzValFifo = calcFifoVal(ing.id)
      const bzVal = bzValFifo !== null ? bzValFifo : parseFloat(Math.max(0, boVal + przychVal + korVal - rozchVal).toFixed(2))
      return { id:ing.id, code:ing.code, name:ing.name, bo, przych, kor, rozch, bz, boVal, przychVal, korVal, rozchVal, bzVal }
    }).filter(r => r.bo>0||r.przych>0||r.kor!==0||r.rozch>0||r.bz>0)

    setBilansData(bilans); setBilansLoading(false)
  }

  const fmt = v => v.toLocaleString('pl-PL',{minimumFractionDigits:3,maximumFractionDigits:3})
  const fmtVal = v => v > 0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : v < 0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'
  const hasValues = bilansData.some(r => r.boVal > 0 || r.przychVal > 0 || r.bzVal > 0)

  function printBilans() {
    const d1str = new Date(bilansDat1).toLocaleDateString('pl-PL')
    const d2str = new Date(bilansDat2).toLocaleDateString('pl-PL')
    const valCol = hasValues
    const colCount = valCol ? 10 : 7

    const fv = v => v > 0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : v < 0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'
    const rowsHtml = bilansData.map((r,i) => `
      <tr>
        <td>${i+1}</td>
        <td style="font-family:monospace;font-size:8px">${r.code}</td>
        <td>${r.name}</td>
        <td style="text-align:right">${r.bo.toFixed(3)}</td>
        <td style="text-align:right;color:#555;font-size:8px">${r.boVal > 0 ? r.boVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</td>
        <td style="text-align:right;color:#085041">${r.przych.toFixed(3)}</td>
        <td style="text-align:right;color:#085041;font-size:8px">${r.przychVal > 0 ? r.przychVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</td>
        <td style="text-align:right;color:${r.kor<0?'#A32D2D':'#633806'}">${r.kor!==0?(r.kor>0?'+':'')+r.kor.toFixed(3):'—'}</td>
        <td style="text-align:right;color:${r.kor<0?'#A32D2D':'#633806'};font-size:8px">${r.kor!==0 ? (r.korVal !== 0 ? r.korVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—') : '—'}</td>
        <td style="text-align:right;color:#7B3F00">${r.rozch.toFixed(3)}</td>
        <td style="text-align:right;color:#7B3F00;font-size:8px">${r.rozchVal > 0 ? r.rozchVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</td>
        <td style="text-align:right;font-weight:bold;color:#0C447C">${r.bz.toFixed(3)}</td>
        <td style="text-align:right;font-weight:bold;color:#3C3489;font-size:8px">${r.bzVal > 0 ? r.bzVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</td>
        <td></td>
      </tr>`).join('')

    const sumaHtml = `
      <tr class="total">
        <td colspan="3" style="text-align:right">SUMA:</td>
        <td style="text-align:right">${bilansData.reduce((s,r)=>s+r.bo,0).toFixed(3)}</td>
        <td style="text-align:right;font-size:8px">${bilansData.reduce((s,r)=>s+r.boVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
        <td style="text-align:right;color:#085041">${bilansData.reduce((s,r)=>s+r.przych,0).toFixed(3)}</td>
        <td style="text-align:right;color:#085041;font-size:8px">${bilansData.reduce((s,r)=>s+r.przychVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
        <td style="text-align:right">${bilansData.reduce((s,r)=>s+r.kor,0).toFixed(3)}</td>
        <td style="text-align:right;font-size:8px">${bilansData.reduce((s,r)=>s+r.korVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
        <td style="text-align:right;color:#7B3F00">${bilansData.reduce((s,r)=>s+r.rozch,0).toFixed(3)}</td>
        <td style="text-align:right;color:#7B3F00;font-size:8px">${bilansData.reduce((s,r)=>s+r.rozchVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
        <td style="text-align:right;font-weight:bold">${bilansData.reduce((s,r)=>s+r.bz,0).toFixed(3)}</td>
        <td style="text-align:right;font-weight:bold;font-size:8px">${bilansData.reduce((s,r)=>s+r.bzVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
        <td></td>
      </tr>`

    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Bilans magazynowy</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;padding:14px}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}
.company{font-size:15px;font-weight:bold;color:#0F6E56}
.title{font-size:12px;font-weight:bold;margin-top:3px}
.period{font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:10px}
th{background:#0F6E56;color:#fff;padding:5px;border:1px solid #085041;font-size:8px;text-align:left}
td{padding:4px 5px;border:1px solid #D3D1C7;font-size:9px}
tr:nth-child(even) td{background:#FAFAF8}
.total td{background:#E1F5EE!important;font-weight:bold}
.sig{margin-top:16px;border:1px solid #D3D1C7;border-radius:4px;padding:12px}
.sig-title{font-weight:bold;font-size:10px;border-bottom:1px solid #D3D1C7;padding-bottom:6px;margin-bottom:12px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}
.sig-box{}
.sig-label{font-size:9px;font-weight:bold;color:#333;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:20px}
.sig-line{border-bottom:1.5px solid #333;margin-bottom:4px}
.sig-sub{font-size:8px;color:#888}
.footer{margin-top:8px;font-size:8px;color:#888;text-align:center;border-top:1px solid #D3D1C7;padding-top:5px}
@media print{@page{margin:8mm;size:A4 landscape}}
</style></head><body>
<div class="header">
  <div>
    <div class="company">InstantMix Pro</div>
    <div class="title">Bilans magazynowy składników</div>
    <div class="period">Okres: ${d1str} — ${d2str}</div>
  </div>
  <div style="text-align:right;font-size:9px;color:#555">
    Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} ${new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}<br>
    Wydrukował: ${profile?.full_name||'—'}
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:22px">Lp.</th>
    <th style="width:60px">Kod</th>
    <th>Nazwa składnika</th>
    <th style="width:65px;text-align:right">BO (kg)</th>
    <th style="width:70px;text-align:right">Wart. BO</th>
    <th style="width:65px;text-align:right">Przychód (kg)</th>
    <th style="width:70px;text-align:right">Wart. przyj.</th>
    <th style="width:60px;text-align:right">Korekty (kg)</th>
    <th style="width:70px;text-align:right">Wart. kor.</th>
    <th style="width:65px;text-align:right">Rozchód (kg)</th>
    <th style="width:70px;text-align:right">Wart. rozch.</th>
    <th style="width:65px;text-align:right">BZ (kg)</th>
    <th style="width:70px;text-align:right">Wart. BZ</th>
    <th style="width:60px">Uwagi</th>
  </tr></thead>
  <tbody>${rowsHtml}${sumaHtml}</tbody>
</table>
<div class="sig">
  <div class="sig-title">Potwierdzenie bilansu magazynowego</div>
  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-label">Sporządził</div>
      <div class="sig-line"></div>
      <div class="sig-sub">Imię, nazwisko i podpis</div>
      <div style="margin-top:8px;font-size:8px;color:#888">Data: _______________</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Weryfikował</div>
      <div class="sig-line"></div>
      <div class="sig-sub">Imię, nazwisko i podpis</div>
      <div style="margin-top:8px;font-size:8px;color:#888">Data: _______________</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Zatwierdził</div>
      <div class="sig-line"></div>
      <div class="sig-sub">Imię, nazwisko i podpis</div>
      <div style="margin-top:8px;font-size:8px;color:#888">Data: _______________</div>
    </div>
  </div>
</div>
<div class="footer">InstantMix Pro | Bilans magazynowy | ${d1str} — ${d2str} | ${profile?.full_name||'—'}</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close()
  }

  function printInventory() {
    const dateStr = new Date().toLocaleDateString('pl-PL')
    const timeStr = new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})
    const tableRows = filtered.map((r,i) => `<tr><td>${i+1}</td><td style="font-family:monospace">${r.code}</td><td>${r.name}</td><td style="text-align:right">${r.in_stock.toFixed(3)}</td><td style="text-align:right">${r.corrections_total !== 0 ? (r.corrections_total > 0 ? '+' : '') + r.corrections_total.toFixed(3) : '—'}</td><td style="text-align:right">${r.used_total.toFixed(3)}</td><td style="text-align:right"><strong>${r.current.toFixed(3)}</strong></td><td style="text-align:right">${r.value > 0 ? r.value.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}</td><td style="text-align:right">${r.minimum>0?r.minimum.toFixed(3):'—'}</td><td>${r.alert==='empty'?'<span style="color:#791F1F;font-weight:bold">Brak</span>':r.alert==='critical'?'<span style="color:#791F1F;font-weight:bold">Krytyczny</span>':r.alert==='warning'?'<span style="color:#633806">Niski</span>':'OK'}</td><td></td></tr>`).join('')
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Inwentura magazynowa</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;padding:14px}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}
.company{font-size:15px;font-weight:bold;color:#0F6E56}.title{font-size:12px;font-weight:bold;margin-top:3px}
table{width:100%;border-collapse:collapse;margin-bottom:10px}
th{background:#0F6E56;color:#fff;padding:5px;border:1px solid #085041;font-size:8px;text-align:left}
td{padding:4px 5px;border:1px solid #D3D1C7}tr:nth-child(even) td{background:#FAFAF8}
.total td{background:#E1F5EE!important;font-weight:bold}
.sig{margin-top:14px;border:1px solid #D3D1C7;border-radius:4px;padding:10px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:10px}
.sig-line{border-bottom:1px solid #333;margin-bottom:3px;margin-top:20px}
.sig-label{font-size:8px;color:#888;text-transform:uppercase}
@media print{@page{margin:8mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div class="title">Inwentura magazynowa składników</div><div style="font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px">Stan na dzień: ${dateStr}</div></div><div style="text-align:right;font-size:9px;color:#555">Wygenerowano: ${dateStr} ${timeStr}<br>Wydrukował: ${profile?.full_name||'—'}</div></div>
<table><thead><tr><th style="width:22px">Lp.</th><th style="width:60px">Kod</th><th>Nazwa składnika</th><th style="width:70px;text-align:right">Przyjęto (kg)</th><th style="width:60px;text-align:right">Korekty (kg)</th><th style="width:70px;text-align:right">Zużyto (kg)</th><th style="width:70px;text-align:right">Stan (kg)</th><th style="width:90px;text-align:right">Wartość (zł)</th><th style="width:70px;text-align:right">Minimum (kg)</th><th style="width:60px">Status</th><th style="width:100px">Uwagi</th></tr></thead>
<tbody>${tableRows}<tr class="total"><td colspan="3" style="text-align:right">SUMA:</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.in_stock,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.corrections_total,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.used_total,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.current,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.value,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td><td colspan="3"></td></tr></tbody></table>
<div class="sig"><div style="font-weight:bold;font-size:10px;border-bottom:1px solid #D3D1C7;padding-bottom:5px">Potwierdzenie inwentury</div><div class="sig-grid"><div><div class="sig-label">Przeprowadził inwenturę</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził (Brygadzista)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził (Kierownik)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Magazyn składników</div>
          <div className="page-sub">Stan aktualny = przyjęte partie + korekty − zużycie produkcyjne</div>
        </div>
        <div className="flex" style={{ gap:6, flexWrap:'wrap' }}>
          <button className="btn btn-sm" onClick={printInventory}>Drukuj inwenturę</button>
          <button className="btn btn-sm" onClick={load}>Odśwież</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Składników aktywnych</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Stan krytyczny / brak</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.critical}</div></div>
        <div className="stat-card"><div className="stat-label">Stan niski</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.warning}</div></div>
        <div className="stat-card"><div className="stat-label">Wartość magazynu</div><div className="stat-val" style={{ fontSize:16 }}>{totalValue > 0 ? totalValue.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}</div></div>
      </div>

      {/* Bilans magazynowy */}
      <div className="card" style={{ marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <span style={{ fontWeight:500, fontSize:13 }}>Bilans magazynowy</span>
          <div className="flex" style={{ gap:6 }}>
            <button className={`btn btn-sm ${bilansMode==='miesiac'?'btn-primary':''}`} onClick={setMiesiac}>Bieżący miesiąc</button>
            <button className={`btn btn-sm ${bilansMode==='kwartal'?'btn-primary':''}`} onClick={setKwartal}>Bieżący kwartał</button>
            <button className={`btn btn-sm ${bilansMode==='rok'?'btn-primary':''}`} onClick={setRok}>Bieżący rok</button>
            <button className={`btn btn-sm ${bilansMode==='custom'?'btn-primary':''}`} onClick={() => setBilansMode('custom')}>Własny zakres</button>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'auto auto auto auto 1fr', gap:10, alignItems:'end' }}>
          <div><label>Bilans otwarcia na</label><input type="date" value={bilansDat1} onChange={e => { setBilansDat1(e.target.value); setBilansMode('custom') }} /></div>
          <div style={{ paddingTop:20, color:'#888' }}>→</div>
          <div><label>Bilans zamknięcia na</label><input type="date" value={bilansDat2} onChange={e => { setBilansDat2(e.target.value); setBilansMode('custom') }} /></div>
          <button className="btn btn-primary btn-sm" onClick={obliczBilans} style={{ alignSelf:'flex-end' }}>Oblicz bilans</button>
          {showBilans && bilansData.length > 0 && <button className="btn btn-sm" onClick={printBilans} style={{ alignSelf:'flex-end' }}>Drukuj bilans</button>}
        </div>

        {showBilans && (
          <div style={{ marginTop:12 }}>
            {bilansLoading ? (
              <div style={{ textAlign:'center', padding:16 }}><span className="spinner" /> Obliczam bilans...</div>
            ) : bilansData.length === 0 ? (
              <div className="muted" style={{ padding:12 }}>Brak ruchów magazynowych w wybranym okresie.</div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ minWidth:900 }}>
                  <thead><tr>
                    <th>Kod</th>
                    <th>Nazwa składnika</th>
                    <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C' }}>BO (kg)</th>
                    <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C', fontSize:10 }}>Wart. BO</th>
                    <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041' }}>Przychód (kg)</th>
                    <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041', fontSize:10 }}>Wart. przyj.</th>
                    <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100' }}>Korekty (kg)</th>
                    <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100', fontSize:10 }}>Wart. kor.</th>
                    <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00' }}>Rozchód (kg)</th>
                    <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00', fontSize:10 }}>Wart. rozch.</th>
                    <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489' }}>BZ (kg)</th>
                    <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489', fontSize:10 }}>Wart. BZ</th>
                  </tr></thead>
                  <tbody>
                    {bilansData.map(r => (
                      <tr key={r.id}>
                        <td><span className="lot">{r.code}</span></td>
                        <td style={{ fontWeight:500 }}>{r.name}</td>
                        <td style={{ textAlign:'right', color:'#0C447C' }}>{fmt(r.bo)}</td>
                        <td style={{ textAlign:'right', color:'#0C447C', fontSize:11 }}>{fmtVal(r.boVal)}</td>
                        <td style={{ textAlign:'right', color:'#085041', fontWeight:500 }}>{fmt(r.przych)}</td>
                        <td style={{ textAlign:'right', color:'#085041', fontSize:11 }}>{fmtVal(r.przychVal)}</td>
                        <td style={{ textAlign:'right', color: r.kor < 0 ? '#A32D2D' : r.kor > 0 ? '#085041' : '#888', fontWeight:500 }}>
                          {r.kor !== 0 ? (r.kor > 0 ? '+' : '') + fmt(r.kor) : '—'}
                        </td>
                        <td style={{ textAlign:'right', color: r.korVal < 0 ? '#A32D2D' : '#E65100', fontSize:11 }}>
                          {r.kor !== 0 ? fmtVal(r.korVal) : '—'}
                        </td>
                        <td style={{ textAlign:'right', color:'#7B3F00', fontWeight:500 }}>{fmt(r.rozch)}</td>
                        <td style={{ textAlign:'right', color:'#7B3F00', fontSize:11 }}>{fmtVal(r.rozchVal)}</td>
                        <td style={{ textAlign:'right', color:'#3C3489', fontWeight:700 }}>{fmt(r.bz)}</td>
                        <td style={{ textAlign:'right', color:'#3C3489', fontWeight:600, fontSize:11 }}>{fmtVal(r.bzVal)}</td>
                      </tr>
                    ))}
                    <tr style={{ background:'#F1EFE8' }}>
                      <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA</td>
                      <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(bilansData.reduce((s,r)=>s+r.bo,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, fontSize:11 }}>{fmtVal(bilansData.reduce((s,r)=>s+r.boVal,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#085041' }}>{fmt(bilansData.reduce((s,r)=>s+r.przych,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#085041', fontSize:11 }}>{fmtVal(bilansData.reduce((s,r)=>s+r.przychVal,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#E65100' }}>{fmt(bilansData.reduce((s,r)=>s+r.kor,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#E65100', fontSize:11 }}>{fmtVal(bilansData.reduce((s,r)=>s+r.korVal,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00' }}>{fmt(bilansData.reduce((s,r)=>s+r.rozch,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00', fontSize:11 }}>{fmtVal(bilansData.reduce((s,r)=>s+r.rozchVal,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489' }}>{fmt(bilansData.reduce((s,r)=>s+r.bz,0))}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489', fontSize:11 }}>{fmtVal(bilansData.reduce((s,r)=>s+r.bzVal,0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex" style={{ marginBottom:12, gap:8, flexWrap:'wrap' }}>
        <input className="search" placeholder="Szukaj składnika..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
        {['wszystkie','alerty','krytyczne','ok'].map(f => (
          <button key={f} className="btn btn-sm" onClick={() => setFilterAlert(f)}
            style={{ background:filterAlert===f?'#1D9E75':undefined, color:filterAlert===f?'#fff':undefined, borderColor:filterAlert===f?'#1D9E75':undefined }}>
            {f==='wszystkie'?'Wszystkie':f==='alerty'?'Wszystkie alerty':f==='krytyczne'?'Krytyczne':'OK'}
          </button>
        ))}
      </div>

      {isAdmin && <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>Jako Admin możesz edytować minimalne stany — kliknij wartość w kolumnie "Minimum (kg)".</div>}

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:960 }}>
          <thead><tr>
            <th style={{ width:32 }}></th>
            <th>Kod</th><th>Nazwa składnika</th>
            <th style={{ textAlign:'right' }}>Przyjęto (kg)</th>
            <th style={{ textAlign:'right' }}>Korekty (kg)</th>
            <th style={{ textAlign:'right' }}>Zużyto (kg)</th>
            <th style={{ textAlign:'right' }}>Stan aktualny (kg)</th>
            <th style={{ textAlign:'right' }}>Wartość (zł)</th>
            <th style={{ textAlign:'right' }}>Minimum (kg)</th>
            <th>Status</th>
            <th style={{ textAlign:'center' }}>Partie</th>
            <th>Alergen</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ textAlign:'center', padding:32, color:'#888' }}><span className="spinner" /> Obliczam stany...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
            {!loading && filtered.map(r => (
              <React.Fragment key={r.id}>
                <tr style={alertRowStyle(r)}>
                  <td style={{ textAlign:'center' }}>
                    <button onClick={() => loadBatchDetails(r.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                      {expandedId===r.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{r.code}</span></td>
                  <td style={{ fontWeight:500 }}>{r.name}</td>
                  <td style={{ textAlign:'right', color:'#085041' }}>{r.in_stock.toFixed(3)}</td>
                  <td style={{ textAlign:'right', color: r.corrections_total < 0 ? '#A32D2D' : r.corrections_total > 0 ? '#085041' : '#888' }}>
                    {r.corrections_total !== 0 ? (r.corrections_total > 0 ? '+' : '') + r.corrections_total.toFixed(3) : '—'}
                  </td>
                  <td style={{ textAlign:'right', color:'#633806' }}>{r.used_total.toFixed(3)}</td>
                  <td style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{r.current.toFixed(3)}</div>
                    {stockBar(r)}
                  </td>
                  <td style={{ textAlign:'right', color: r.value > 0 ? '#3C3489' : '#888', fontWeight: r.value > 0 ? 500 : 400 }}>
                    {r.value > 0 ? r.value.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}
                  </td>
                  <td style={{ textAlign:'right' }}>
                    {isAdmin ? (
                      editingMin[r.id]!==undefined ? (
                        <div className="flex" style={{ gap:4, justifyContent:'flex-end' }}>
                          <input type="number" step="0.1" min="0" defaultValue={editingMin[r.id]} id={`min-${r.id}`}
                            style={{ width:80, padding:'3px 6px', fontSize:12 }}
                            onKeyDown={e => { if(e.key==='Enter') saveMinimum(r.id,e.target.value); if(e.key==='Escape') setEditingMin(p=>({...p,[r.id]:undefined})) }}/>
                          <button className="btn btn-sm btn-primary" style={{ padding:'3px 8px', fontSize:11 }}
                            onClick={() => saveMinimum(r.id, document.getElementById(`min-${r.id}`).value)}
                            disabled={savingMin[r.id]}>{savingMin[r.id]?'...':'Zapisz'}</button>
                          <button className="btn btn-sm" style={{ padding:'3px 6px', fontSize:11 }}
                            onClick={() => setEditingMin(p=>({...p,[r.id]:undefined}))}>✕</button>
                        </div>
                      ) : (
                        <span onClick={() => setEditingMin(p=>({...p,[r.id]:r.minimum}))}
                          style={{ cursor:'pointer', borderBottom:'1px dashed #B4B2A9', paddingBottom:1 }}>
                          {r.minimum>0 ? r.minimum.toFixed(3) : <span className="muted">ustaw →</span>}
                        </span>
                      )
                    ) : <span>{r.minimum>0?r.minimum.toFixed(3):<span className="muted">—</span>}</span>}
                  </td>
                  <td>{alertBadge(r)}</td>
                  <td style={{ textAlign:'center', color:'#5F5E5A' }}>{r.batch_count}</td>
                  <td>{r.has_allergen?<span className="badge b-err">{r.allergen_type}</span>:<span className="muted">—</span>}</td>
                </tr>
                {expandedId===r.id && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={12} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'8px 16px 10px 40px' }}>
                        <div style={{ fontSize:12, fontWeight:500, marginBottom:6, color:'#0F6E56' }}>Partie na stanie — {r.name}</div>
                        {!batchDetails[r.id] || batchDetails[r.id].length===0 ? (
                          <div className="muted" style={{ fontSize:12 }}>Brak dopuszczonych partii na stanie</div>
                        ) : (
                          <table style={{ width:'auto', minWidth:500 }}>
                            <thead><tr>
                              <th>Nr partii dostawy</th><th>Data przyjęcia</th><th>Data ważności</th>
                              <th style={{ textAlign:'right' }}>Stan (kg)</th>
                              <th style={{ textAlign:'right' }}>Wartość (zł)</th>
                              <th>Status</th>
                            </tr></thead>
                            <tbody>
                              {batchDetails[r.id].map(b => {
                                const isExpiring = b.expiry_date && (new Date(b.expiry_date)-new Date()) < 30*24*3600*1000 && new Date(b.expiry_date)>new Date()
                                const isExpired = b.expiry_date && new Date(b.expiry_date) < new Date()
                                const hasCorr = parseFloat(b.corrections_kg||0) !== 0
                                return (
                                  <tr key={b.id}>
                                    <td><span className="lot">{b.delivery_lot}</span></td>
                                    <td className="muted">{b.received_date}</td>
                                    <td style={{ color: isExpired?'#A32D2D':isExpiring?'#BA7517':undefined, fontWeight: isExpiring||isExpired?500:undefined }}>
                                      {b.expiry_date||'—'}
                                      {isExpiring && <span className="badge b-warn" style={{ marginLeft:6, fontSize:10 }}>Wygasa wkrótce</span>}
                                      {isExpired && <span className="badge b-err" style={{ marginLeft:6, fontSize:10 }}>Przeterminowana</span>}
                                    </td>
                                    <td style={{ textAlign:'right' }}>
                                      {hasCorr && <span style={{ textDecoration:'line-through', color:'#888', marginRight:6, fontSize:11 }}>{parseFloat(b.original_kg).toFixed(3)}</span>}
                                      <span style={{ fontWeight:700, color: hasCorr ? '#A32D2D' : undefined }}>{parseFloat(b.current_kg).toFixed(3)}</span>
                                      {hasCorr && <span style={{ fontSize:10, color:'#A32D2D', marginLeft:4 }}>({parseFloat(b.corrections_kg)>0?'+':''}{parseFloat(b.corrections_kg).toFixed(3)})</span>}
                                    </td>
                                    <td style={{ textAlign:'right', color: (parseFloat(b.unit_price_pln||0) > 0) ? '#3C3489' : '#888', fontSize:12 }}>
                                      {parseFloat(b.unit_price_pln||0) > 0
                                        ? (parseFloat(b.current_kg) * parseFloat(b.unit_price_pln)).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł'
                                        : '—'}
                                    </td>
                                    <td><span className={`badge ${b.status==='dopuszczona'?'b-ok':'b-err'}`}>{b.status}</span></td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && stats.critical>0 && (
        <div className="err-box" style={{ marginTop:10 }}>
          Uwaga: {stats.critical} {stats.critical===1?'składnik wymaga':'składniki wymagają'} uzupełnienia.
        </div>
      )}
    </div>
  )
}
