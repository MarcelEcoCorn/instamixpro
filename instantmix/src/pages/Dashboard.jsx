import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState({ batches:0, kg:0, ingredients:0, expiring:0, blocked:0, bg:0 })
  const [topRecipes, setTopRecipes] = useState([])
  const [expiringBatches, setExpiringBatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const now = new Date()
    const month = now.toISOString().slice(0,7)
    const in30 = new Date(now.getTime() + 30*24*3600*1000).toISOString().slice(0,10)

    const [{ data: prod }, { data: stock }, { data: expiring }] = await Promise.all([
      supabase.from('v_production').select('recipe_code,recipe_name,quantity_kg,production_line').gte('production_date', month+'-01'),
      supabase.from('ingredient_batches').select('status, quantity_kg, expiry_date'),
      supabase.from('ingredient_batches').select('*, ingredients(code,name)').eq('status','dopuszczona').lte('expiry_date', in30).gte('expiry_date', now.toISOString().slice(0,10)).order('expiry_date')
    ])

    const byRecipe = {}
    let totalKg = 0, bgCount = 0
    for (const b of (prod || [])) {
      totalKg += parseFloat(b.quantity_kg)
      if (b.production_line === 'bezglutenowa') bgCount++
      if (!byRecipe[b.recipe_code]) byRecipe[b.recipe_code] = { name: b.recipe_name, kg: 0 }
      byRecipe[b.recipe_code].kg += parseFloat(b.quantity_kg)
    }
    const sorted = Object.entries(byRecipe).sort((a,b) => b[1].kg - a[1].kg)
    const maxKg = sorted[0]?.[1].kg || 1

    setStats({
      batches: (prod||[]).length,
      kg: totalKg,
      ingredients: (stock||[]).filter(s => s.status==='dopuszczona').length,
      expiring: expiring?.length || 0,
      blocked: (stock||[]).filter(s => s.status==='wstrzymana').length,
      bg: bgCount
    })
    setTopRecipes(sorted.map(([code, v]) => ({ code, ...v, pct: Math.round((v.kg/maxKg)*100) })))
    setExpiringBatches(expiring || [])
    setLoading(false)
  }

  const month = new Date().toLocaleDateString('pl-PL', { month:'long', year:'numeric' })

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Dashboard</div><div className="page-sub">{month}</div></div>
        <button className="btn btn-sm" onClick={load}>Odśwież</button>
      </div>

      {loading ? <div style={{ textAlign:'center', padding:40 }}><span className="spinner" /></div> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(120px,1fr))' }}>
            <div className="stat-card"><div className="stat-label">Partie (mies.)</div><div className="stat-val">{stats.batches}</div></div>
            <div className="stat-card"><div className="stat-label">Produkcja (kg)</div><div className="stat-val">{stats.kg.toLocaleString('pl-PL')}</div></div>
            <div className="stat-card"><div className="stat-label">Bezglutenowe</div><div className="stat-val">{stats.bg}</div></div>
            <div className="stat-card"><div className="stat-label">Skł. na stanie</div><div className="stat-val">{stats.ingredients}</div></div>
            <div className="stat-card"><div className="stat-label">Wygasa w 30 dni</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.expiring}</div></div>
            <div className="stat-card"><div className="stat-label">Wstrzymane</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.blocked}</div></div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="card">
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Produkcja wg receptury (bieżący miesiąc)</div>
              {topRecipes.length === 0 && <div className="muted">Brak danych w bieżącym miesiącu</div>}
              {topRecipes.map(r => (
                <div key={r.code} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                    <span>{r.code} — {r.name}</span><span style={{ fontWeight:500 }}>{r.kg.toLocaleString('pl-PL')} kg</span>
                  </div>
                  <div style={{ height:8, background:'#F1EFE8', borderRadius:999 }}>
                    <div style={{ height:8, width:`${r.pct}%`, background:'#1D9E75', borderRadius:999, transition:'width .5s' }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Partie wygasające w ciągu 30 dni</div>
              {expiringBatches.length === 0 && <div className="b-ok" style={{ padding:10, borderRadius:8, fontSize:13 }}>Brak wygasających partii</div>}
              {expiringBatches.map(b => {
                const days = Math.ceil((new Date(b.expiry_date) - new Date()) / (24*3600*1000))
                return (
                  <div key={b.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'0.5px solid #D3D1C7', fontSize:13 }}>
                    <div>
                      <div style={{ fontWeight:500 }}>{b.ingredients?.name}</div>
                      <div className="muted">{b.delivery_lot} | {b.quantity_kg} kg</div>
                    </div>
                    <span className={`badge ${days <= 7 ? 'b-err' : 'b-warn'}`}>{days} dni</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
