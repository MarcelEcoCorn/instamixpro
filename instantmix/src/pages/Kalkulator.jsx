import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Kalkulator() {
  const { profile } = useAuth()
  const canEdit = ['admin', 'technolog'].includes(profile?.role)

  const [recipes, setRecipes] = useState([])
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [mass, setMass] = useState(250)
  const [fifoResult, setFifoResult] = useState([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [prodForm, setProdForm] = useState({ operator: '', foreman: '', notes: '', order_id: '' })
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  useEffect(() => { loadOrders(); loadClients() }, [])

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id,number,name').order('number')
    setClients(data || [])
  }

  async function loadOrders() {
    setOrdersLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*, recipes(code, name, version, client)')
      .in('status', ['nowe', 'w_realizacji'])
      .order('ship_date', { ascending: true })
    setOrders(data || [])
    setOrdersLoading(false)
  }

  useEffect(() => {
    supabase.from('recipes')
      .select('*, recipe_items(*, ingredients(*))')
      .eq('status', 'dopuszczona')
      .order('client,code')
      .then(({ data }) => setRecipes(data || []))
  }, [])

  const filteredRecipes = selectedClient
    ? recipes.filter(r => r.client_id === selectedClient)
    : recipes

  async function calculate() {
    if (!selectedRecipe || !mass) return
    setLoading(true)

    const { data: allUsed } = await supabase
      .from('production_batch_items')
      .select('ingredient_batch_id, quantity_used_kg')
    const usedMap = {}
    for (const u of (allUsed||[])) {
      usedMap[u.ingredient_batch_id] = (usedMap[u.ingredient_batch_id]||0) + parseFloat(u.quantity_used_kg)
    }

    const { data: stockAll } = await supabase
      .from('v_stock')
      .select('*')
      .eq('status', 'dopuszczona')
      .order('received_date', { ascending: true })

    const availableMap = {}
    for (const s of (stockAll||[])) {
      const used = usedMap[s.id]||0
      const avail = parseFloat(s.current_kg) - used
      if (avail > 0.001) {
        if (!availableMap[s.ingredient_id]) availableMap[s.ingredient_id] = []
        availableMap[s.ingredient_id].push({
          id: s.id, delivery_lot: s.delivery_lot, current_kg: s.current_kg,
          available: parseFloat(avail.toFixed(3)), received_date: s.received_date
        })
      }
    }

    const result = []
    for (const item of selectedRecipe.recipe_items.sort((a, b) => a.sort_order - b.sort_order)) {
      const needed = parseFloat(((mass * item.percentage) / 100).toFixed(3))
      const rows = availableMap[item.ingredient_id] || []
      let remaining = needed
      const lots = []
      for (const row of rows) {
        if (remaining <= 0.001) break
        const take = Math.min(remaining, row.available)
        if (take > 0.001) {
          lots.push({ lot: row.delivery_lot, batch_id: row.id, ingredient_batch_id: row.id, kg: parseFloat(take.toFixed(3)), available: row.available })
          remaining = parseFloat((remaining - take).toFixed(3))
        }
      }
      result.push({ ...item, needed, lots, shortage: remaining > 0.001 ? remaining : 0, ingredient: item.ingredients })
    }
    setFifoResult(result)
    setLoading(false)
  }

  useEffect(() => { if (selectedRecipe && mass) calculate() }, [selectedRecipe, mass])

  const allergens = [...new Set(fifoResult.filter(r => r.ingredient?.has_allergen).map(r => r.ingredient.allergen_type))]
  const hasShortage = fifoResult.some(r => r.shortage > 0)

  async function generateLotNumber() {
    const year = new Date().getFullYear()
    // Pobierz MAX numer z istniejących partii — nie count(), tylko max lot_number
    const { data } = await supabase
      .from('production_batches')
      .select('lot_number')
      .like('lot_number', `PROD-${year}-%`)
      .order('lot_number', { ascending: false })
      .limit(1)
    let nextNum = 1
    if (data && data.length > 0) {
      const lastLot = data[0].lot_number // np. "PROD-2026-0042"
      const parts = lastLot.split('-')
      const lastNum = parseInt(parts[2] || '0', 10)
      nextNum = lastNum + 1
    }
    return `PROD-${year}-${String(nextNum).padStart(4, '0')}`
  }

  async function createProductionBatch() {
    setSaving(true)
    const lotNumber = await generateLotNumber()
    const { data: pb, error } = await supabase.from('production_batches').insert({
      lot_number: lotNumber,
      recipe_id: selectedRecipe.id,
      quantity_kg: mass,
      operator: prodForm.operator,
      foreman: prodForm.foreman,
      notes: prodForm.notes,
      technologist: profile?.full_name,
      client: selectedRecipe.client || null,
      created_by: profile?.id
    }).select().single()
    if (!error) {
      const items = fifoResult.flatMap((r) =>
        r.lots.map((l, li) => ({
          production_batch_id: pb.id,
          ingredient_batch_id: l.ingredient_batch_id,
          ingredient_id: r.ingredient_id,
          quantity_used_kg: l.kg,
          fifo_order: li + 1
        }))
      )
      await supabase.from('production_batch_items').insert(items)
      if (prodForm.order_id) {
        await supabase.from('orders').update({
          status: 'w_realizacji',
          production_batch_id: pb.id,
          updated_at: new Date().toISOString()
        }).eq('id', prodForm.order_id)
      }
    }
    setSaving(false)
    setModal(false)
    setProdForm(p => ({ ...p, order_id: '' }))
    loadOrders()
    alert(error ? 'Błąd: ' + error.message : `Partia ${lotNumber} utworzona!`)
  }

  function printChecklist() {
    const now = new Date()
    const dateStr = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    const allergenBlock = allergens.length > 0
      ? `<div class="allergen-box"><strong>⚠ ALERGENY W TEJ PARTII:</strong> ${allergens.join(', ')}</div>`
      : `<div class="no-allergen-box">✓ Brak alergenów w tej partii</div>`
    const rows = fifoResult.map((r, idx) => {
      const lotsText = r.lots.length > 0
        ? r.lots.map((l, i) => `${l.lot}${r.lots.length > 1 ? ` (FIFO ${i + 1}: ${l.kg} kg)` : ''}`).join('<br>')
        : '<span style="color:#A32D2D">BRAK W MAGAZYNIE</span>'
      return `<tr>
        <td class="check-cell"><div class="checkbox"></div></td>
        <td class="num">${idx + 1}</td>
        <td class="code">${r.ingredient?.code || ''}</td>
        <td class="name">${r.ingredient?.name || ''}</td>
        <td class="kg"><strong>${r.needed.toFixed(3)}</strong></td>
        <td class="lot-cell">${lotsText}</td>
        <td class="allergy-cell">${r.ingredient?.has_allergen ? `<span class="tag-allergy">${r.ingredient.allergen_type}</span>` : '—'}</td>
        <td class="verify-cell"><div class="checkbox"></div></td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Zlecenie produkcji - ${selectedRecipe.code}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#000;padding:16px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;border-bottom:2px solid #0F6E56;padding-bottom:10px}
.company{font-size:16px;font-weight:bold;color:#0F6E56}.doc-title{font-size:13px;font-weight:bold;margin-top:4px}
.lot-badge{background:#E1F5EE;border:1px solid #1D9E75;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:bold;color:#0F6E56;margin-top:4px;display:inline-block}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}
.info-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px}
.info-value{font-size:12px;font-weight:bold}
.section-title{font-size:11px;font-weight:bold;background:#0F6E56;color:#fff;padding:5px 10px;margin-bottom:0}
table{width:100%;border-collapse:collapse;margin-bottom:10px}
th{background:#F1EFE8;font-size:9px;font-weight:bold;text-transform:uppercase;padding:5px 6px;border:1px solid #D3D1C7;text-align:left}
td{padding:5px 6px;border:1px solid #D3D1C7;vertical-align:middle;font-size:10px}
tr:nth-child(even) td{background:#FAFAF8}
.check-cell{width:24px;text-align:center}.checkbox{width:14px;height:14px;border:1.5px solid #333;border-radius:2px;margin:0 auto}
.num{width:20px;text-align:center;color:#888}.code{width:70px;font-family:monospace;font-size:10px}
.kg{width:70px;text-align:right}.lot-cell{font-family:monospace;font-size:9px}
.verify-cell{width:60px;text-align:center}.allergy-cell{width:70px}
.tag-allergy{background:#FCEBEB;color:#791F1F;border:1px solid #F09595;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:bold}
.total-row td{background:#E1F5EE!important;font-weight:bold}
.allergen-box{background:#FCEBEB;border:1.5px solid #E24B4A;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#501313}
.no-allergen-box{background:#E1F5EE;border:1px solid #1D9E75;border-radius:4px;padding:6px 12px;margin-bottom:10px;font-size:11px;color:#085041}
.signature-section{margin-top:16px;border:1px solid #D3D1C7;border-radius:4px;padding:12px}
.signature-title{font-size:11px;font-weight:bold;margin-bottom:12px;border-bottom:1px solid #D3D1C7;padding-bottom:6px}
.signature-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
.signature-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:24px}
.signature-line{border-bottom:1px solid #333;margin-bottom:4px}.signature-name{font-size:9px;color:#888}
.footer{margin-top:10px;font-size:9px;color:#888;text-align:center;border-top:1px solid #D3D1C7;padding-top:6px}
.instructions{background:#F1EFE8;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:10px}
.instructions strong{display:block;margin-bottom:4px}
@media print{body{padding:8px}@page{margin:10mm;size:A4}}</style></head><body>
<div class="header">
  <div>
    <div class="company">InstantMix Pro</div>
    <div class="doc-title">Zlecenie produkcji / Checklista dozowania</div>
    <div class="lot-badge">Numer partii zostanie nadany po zatwierdzeniu</div>
  </div>
  <div style="text-align:right;font-size:10px;color:#555">
    <div>Data wydruku: <strong>${dateStr}</strong></div>
    <div>Godzina: <strong>${timeStr}</strong></div>
    <div style="margin-top:4px">Wydrukował: <strong>${profile?.full_name || '—'}</strong></div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">Kod receptury</div><div class="info-value">${selectedRecipe.code}</div></div>
  <div class="info-box"><div class="info-label">Nazwa mieszanki</div><div class="info-value">${selectedRecipe.name}</div></div>
  <div class="info-box"><div class="info-label">Wersja receptury</div><div class="info-value">${selectedRecipe.version}</div></div>
  <div class="info-box"><div class="info-label">Klient</div><div class="info-value">${selectedRecipe.client || '—'}</div></div>
  <div class="info-box"><div class="info-label">Masa wsadu</div><div class="info-value">${mass} kg</div></div>
  <div class="info-box"><div class="info-label">Linia produkcyjna</div><div class="info-value">${selectedRecipe.production_line === 'bezglutenowa' ? 'BEZGLUTENOWA' : 'Zwykła'}</div></div>
</div>
${allergenBlock}
<div class="instructions"><strong>Instrukcja dla operatora:</strong>Odważyć każdy składnik zgodnie z podaną ilością (kg). Po odważeniu zaznaczyć checkbox w kolumnie "Odważono". Po zweryfikowaniu przez brygadzistę zaznaczyć checkbox w kolumnie "Weryfikacja". Gotowy wsad przekazać do mieszania.</div>
<div class="section-title">Lista składników do dozowania — metoda FIFO</div>
<table><thead><tr>
  <th class="check-cell">Odważ.</th><th class="num">Lp.</th><th class="code">Kod skł.</th>
  <th>Nazwa składnika</th><th class="kg">Ilość (kg)</th><th>Partia dostawy (FIFO)</th>
  <th class="allergy-cell">Alergen</th><th class="verify-cell">Weryfik.</th>
</tr></thead><tbody>
${rows}
<tr class="total-row"><td></td><td></td><td colspan="2" style="text-align:right">SUMA WSADU:</td>
<td style="text-align:right">${fifoResult.reduce((s, r) => s + r.needed, 0).toFixed(3)} kg</td><td colspan="3"></td></tr>
</tbody></table>
<div class="signature-section">
  <div class="signature-title">Potwierdzenie wykonania — podpisy</div>
  <div class="signature-grid">
    <div><div class="signature-label">Operator / Dozujący</div><div class="signature-line"></div><div class="signature-name">Imię, nazwisko i podpis</div><div style="margin-top:8px;font-size:9px;color:#888">Data: _______________</div></div>
    <div><div class="signature-label">Brygadzista (weryfikacja)</div><div class="signature-line"></div><div class="signature-name">Imię, nazwisko i podpis</div><div style="margin-top:8px;font-size:9px;color:#888">Data: _______________</div></div>
    <div><div class="signature-label">Technolog (zatwierdził recepturę)</div><div class="signature-line"></div><div class="signature-name">Imię, nazwisko i podpis</div><div style="margin-top:8px;font-size:9px;color:#888">Data: _______________</div></div>
  </div>
  <div style="margin-top:12px;border-top:1px solid #D3D1C7;padding-top:8px">
    <div class="signature-label">Uwagi / odstępstwa od receptury:</div>
    <div style="border-bottom:1px solid #ccc;margin-top:20px"></div>
    <div style="border-bottom:1px solid #ccc;margin-top:14px"></div>
  </div>
</div>
<div class="footer">InstantMix Pro &nbsp;|&nbsp; Dokument wygenerowany automatycznie &nbsp;|&nbsp; ${dateStr} ${timeStr} &nbsp;|&nbsp; Wydrukował: ${profile?.full_name || '—'} &nbsp;|&nbsp; Wyłącznie do użytku wewnętrznego</div>
<script>window.onload = function() { window.print(); }</script>
</body></html>`
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Kalkulator receptur</div>
          <div className="page-sub">Dostęp: Technolog (edycja), Brygadzista (odczyt)</div>
        </div>
        {fifoResult.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={printChecklist}>Drukuj zlecenie produkcji</button>
        )}
      </div>

      <div className="card" style={{ marginBottom:10 }}>
        <div style={{ fontWeight:500, fontSize:13, marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>Zlecenia do zrealizowania</span>
          <button className="btn btn-sm" onClick={loadOrders}>Odśwież</button>
        </div>
        {ordersLoading ? (
          <div className="muted" style={{ fontSize:12 }}>Ładowanie...</div>
        ) : orders.length === 0 ? (
          <div className="muted" style={{ fontSize:12 }}>Brak aktywnych zleceń</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ minWidth:600 }}>
              <thead><tr>
                <th>Nr zlecenia</th><th>Klient</th><th>Receptura</th>
                <th style={{ textAlign:'right' }}>Ilość (kg)</th><th>Data wysyłki</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {orders.map(o => {
                  const days = Math.ceil((new Date(o.ship_date) - new Date()) / (1000*60*60*24))
                  return (
                    <tr key={o.id} style={{ background: days <= 3 ? '#FCEBEB55' : days <= 7 ? '#FAEEDA33' : undefined }}>
                      <td><span className="lot">{o.order_number}</span></td>
                      <td style={{ fontWeight:500 }}>{o.client}</td>
                      <td style={{ fontSize:12 }}>{o.recipes?.name} <span className="muted">({o.recipes?.version})</span></td>
                      <td style={{ textAlign:'right', fontWeight:500 }}>{parseFloat(o.quantity_kg).toLocaleString('pl-PL')} kg</td>
                      <td>
                        <span className="muted">{o.ship_date}</span>
                        {days < 0 && <span className="badge b-err" style={{ fontSize:10, marginLeft:4 }}>Po terminie</span>}
                        {days >= 0 && days <= 3 && <span className="badge b-err" style={{ fontSize:10, marginLeft:4 }}>{days}d</span>}
                        {days > 3 && days <= 7 && <span className="badge b-warn" style={{ fontSize:10, marginLeft:4 }}>{days}d</span>}
                      </td>
                      <td><span className={`badge ${o.status==='nowe'?'b-info':'b-warn'}`}>{o.status==='nowe'?'Nowe':'W realizacji'}</span></td>
                      <td>
                        <button className="btn btn-sm btn-primary" style={{ fontSize:11 }} onClick={() => {
                          const recipe = recipes.find(r => r.id === o.recipe_id)
                          if (recipe) { setSelectedRecipe(recipe); setSelectedClient(recipe.client_id||'') }
                          setMass(parseFloat(o.quantity_kg))
                          setProdForm(p => ({ ...p, order_id: o.id }))
                          window.scrollTo(0, document.body.scrollHeight)
                        }}>Załaduj</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="fr">
          <div>
            <label>Klient (filtr receptur)</label>
            <select value={selectedClient} onChange={e => {
              setSelectedClient(e.target.value)
              setSelectedRecipe(null)
              setFifoResult([])
            }}>
              <option value="">— wszyscy klienci —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Receptura</label>
            <select value={selectedRecipe?.id || ''} onChange={e => setSelectedRecipe(filteredRecipes.find(r => r.id === e.target.value) || null)} disabled={!canEdit}>
              <option value="">— wybierz recepturę —</option>
              {filteredRecipes.map(r => <option key={r.id} value={r.id}>{r.client ? r.client + ' › ' : ''}{r.code} › {r.name} ({r.version})</option>)}
            </select>
          </div>
          <div>
            <label>Masa wsadu (kg)</label>
            <input type="number" min="1" step="1" value={mass} onChange={e => setMass(parseFloat(e.target.value))} disabled={!canEdit} />
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /> Obliczam FIFO...</div>}

        {!loading && fifoResult.length > 0 && (
          <>
            <div className="divider" />
            <div className="info-box">FIFO aktywne — składniki dozowane z najstarszych partii (wg daty przyjęcia)</div>
            {hasShortage && <div className="warn-box">Niedobór magazynowy — brak wystarczającej ilości niektórych składników.</div>}
            {allergens.length > 0 && <div className="err-box">Alergeny w partii: {allergens.join(', ')}</div>}

            <div className="card-0" style={{ marginBottom: 12 }}>
              <table>
                <thead><tr>
                  <th>Kod skł.</th><th>Nazwa</th><th style={{ textAlign: 'right' }}>Potrzeba (kg)</th>
                  <th>Partia FIFO</th><th>Kg z partii</th><th>Alergen</th>
                </tr></thead>
                <tbody>
                  {fifoResult.map(r => {
                    const totalAvail = r.lots.reduce((s,l) => s+l.kg, 0)
                    const hasShortageItem = r.shortage > 0.001
                    return r.lots.length > 0 ? [
                      ...r.lots.map((l, i) => (
                        <tr key={`${r.id}-${i}`} style={{ background: hasShortageItem ? '#FAEEDA33' : r.lots.length > 1 && i === 0 ? '#E6F1FB33' : undefined }}>
                          <td>{i === 0 && <span className="lot">{r.ingredient?.code}</span>}</td>
                          <td>{i === 0 && r.ingredient?.name}</td>
                          <td style={{ fontWeight: i === 0 ? 500 : undefined, textAlign: 'right' }}>{i === 0 ? r.needed.toFixed(3) : ''}</td>
                          <td><span className="lot">{l.lot}</span>{r.lots.length > 1 && <span className="fifo-badge">FIFO {i + 1}</span>}</td>
                          <td style={{ textAlign: 'right' }}>{l.kg.toFixed(3)}</td>
                          <td>{i === 0 && r.ingredient?.has_allergen ? <span className="badge b-err">{r.ingredient.allergen_type}</span> : ''}</td>
                        </tr>
                      )),
                      hasShortageItem ? (
                        <tr key={`${r.id}-shortage`} style={{ background:'#FCEBEB55' }}>
                          <td colSpan={2} style={{ paddingLeft:24, color:'#A32D2D', fontSize:11 }}>⚠ Niedobór składnika</td>
                          <td style={{ textAlign:'right', color:'#A32D2D', fontWeight:500 }}>{r.needed.toFixed(3)}</td>
                          <td style={{ color:'#A32D2D', fontSize:11 }}>Dostępne: <b>{totalAvail.toFixed(3)} kg</b> · Brakuje: <b>{r.shortage.toFixed(3)} kg</b></td>
                          <td colSpan={2}><span className="badge b-err">NIEDOBÓR</span></td>
                        </tr>
                      ) : null
                    ] : (
                      <tr key={r.id} style={{ background:'#FCEBEB55' }}>
                        <td><span className="lot">{r.ingredient?.code}</span></td>
                        <td>{r.ingredient?.name}</td>
                        <td style={{ fontWeight: 500, textAlign: 'right', color:'#A32D2D' }}>{r.needed.toFixed(3)}</td>
                        <td colSpan={2}><span className="badge b-err">BRAK W MAGAZYNIE</span> <span className="muted" style={{fontSize:11}}>Dostępne: 0 kg · Brakuje: {r.needed.toFixed(3)} kg</span></td>
                        <td>{r.ingredient?.has_allergen ? <span className="badge b-err">{r.ingredient.allergen_type}</span> : ''}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: '#E1F5EE' }}>
                    <td colSpan={2} style={{ fontWeight: 500, textAlign: 'right' }}>SUMA wsadu</td>
                    <td style={{ fontWeight: 500, textAlign: 'right' }}>{fifoResult.reduce((s, r) => s + r.needed, 0).toFixed(3)} kg</td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {canEdit && !hasShortage && (
              <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}>
                Zatwierdź i utwórz partię produkcji
              </button>
            )}
          </>
        )}

        {!loading && !selectedRecipe && (
          <div style={{ textAlign: 'center', padding: 24, color: '#888' }}>
            Wybierz klienta i recepturę, aby zobaczyć dozowanie FIFO.
          </div>
        )}
      </div>

      <div className={`modal-overlay ${modal ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">Zatwierdzenie partii produkcji</div>
          <div style={{ background: '#F1EFE8', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}>
            Receptura: <b>{selectedRecipe?.code} — {selectedRecipe?.name} {selectedRecipe?.version}</b><br />
            Klient: <b>{selectedRecipe?.client || '—'}</b><br />
            Masa wsadu: <b>{mass} kg</b><br />
            Technolog: <b>{profile?.full_name}</b>
          </div>
          <div className="fr">
            <div><label>Operator (imię, nazwisko)</label><input value={prodForm.operator} onChange={e => setProdForm(p => ({ ...p, operator: e.target.value }))} /></div>
            <div><label>Brygadzista</label><input value={prodForm.foreman} onChange={e => setProdForm(p => ({ ...p, foreman: e.target.value }))} /></div>
          </div>
          <div><label>Uwagi</label><input value={prodForm.notes} onChange={e => setProdForm(p => ({ ...p, notes: e.target.value }))} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={createProductionBatch} disabled={saving}>
              {saving ? 'Tworzenie...' : 'Zatwierdź i zapisz'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
