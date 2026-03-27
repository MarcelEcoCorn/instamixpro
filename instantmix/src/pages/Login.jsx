import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Nieprawidłowy email lub hasło')
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F5F5F2' }}>
      <div style={{ width:'100%', maxWidth:'380px', padding:'0 16px' }}>
        <div style={{ textAlign:'center', marginBottom:'32px' }}>
          <div style={{ fontSize:'24px', fontWeight:'500', color:'#0F6E56' }}>InstantMix Pro</div>
          <div style={{ fontSize:'13px', color:'#5F5E5A', marginTop:'4px' }}>System zarządzania produkcją</div>
        </div>
        <div className="card">
          <div style={{ fontSize:'15px', fontWeight:'500', marginBottom:'16px' }}>Logowanie</div>
          {error && <div className="err-box" style={{ marginBottom:'12px' }}>{error}</div>}
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom:'10px' }}>
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="twoj@email.com" />
            </div>
            <div style={{ marginBottom:'16px' }}>
              <label>Hasło</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width:'100%' }} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Zaloguj się'}
            </button>
          </form>
        </div>
        <div style={{ textAlign:'center', fontSize:'12px', color:'#888780', marginTop:'16px' }}>
          Problemy z dostępem? Skontaktuj się z administratorem.
        </div>
      </div>
    </div>
  )
}
