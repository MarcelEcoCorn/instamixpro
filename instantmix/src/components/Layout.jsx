import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const NAV = [
  { id: 'receptury',  label: 'Receptury',          roles: ['admin','technolog'] },
  { id: 'skladniki',  label: 'Składniki',           roles: ['admin'] },
  { id: 'partie',     label: 'Partie składników',   roles: ['admin','technolog'] },
  { id: 'kalkulator', label: 'Kalkulator',          roles: ['admin','technolog','brygadzista'] },
  { id: 'produkcja',  label: 'Produkcja',           roles: ['admin','technolog','brygadzista','sprzedaz'] },
  { id: 'dashboard',  label: 'Dashboard',           roles: ['admin','technolog','brygadzista','sprzedaz'] },
  { id: 'eksport',    label: 'Eksport / kopia',     roles: ['admin','technolog'] },
]

const ROLE_LABELS = { admin:'Admin', technolog:'Technolog', brygadzista:'Brygadzista', sprzedaz:'Sprzedaż' }

export default function Layout({ page, setPage, children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'brygadzista'
  const visibleNav = NAV.filter(n => n.roles.includes(role))

  async function logout() { await supabase.auth.signOut() }

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ background:'#fff', borderBottom:'0.5px solid #D3D1C7', padding:'0 16px', display:'flex', alignItems:'center', height:'52px', gap:'12px', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ fontSize:'15px', fontWeight:'500' }}>
          Instant<span style={{ color:'#1D9E75' }}>Mix</span> Pro
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'#CECBF6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'500', color:'#3C3489' }}>
            {profile?.full_name?.slice(0,2).toUpperCase() || 'U'}
          </div>
          <span style={{ fontSize:'13px', color:'#5F5E5A' }}>{profile?.full_name || 'Użytkownik'}</span>
          <span className="badge b-ok" style={{ fontSize:'10px' }}>{ROLE_LABELS[role]}</span>
          <button className="btn btn-sm" onClick={logout}>Wyloguj</button>
        </div>
      </div>

      <div style={{ background:'#fff', borderBottom:'0.5px solid #D3D1C7', display:'flex', padding:'0 16px', overflowX:'auto' }}>
        {visibleNav.map(n => (
          <button key={n.id} onClick={() => setPage(n.id)} style={{
            padding:'12px 14px', fontSize:'13px', border:'none', background:'none', cursor:'pointer',
            borderBottom: page === n.id ? '2px solid #1D9E75' : '2px solid transparent',
            color: page === n.id ? '#0F6E56' : '#5F5E5A',
            fontWeight: page === n.id ? '500' : '400',
            whiteSpace:'nowrap', transition:'all .15s'
          }}>{n.label}</button>
        ))}
      </div>

      <div style={{ flex:1, padding:'16px', maxWidth:'1140px', width:'100%', margin:'0 auto' }}>
        {children}
      </div>
    </div>
  )
}
