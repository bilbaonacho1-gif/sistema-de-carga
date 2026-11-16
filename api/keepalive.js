/**
 * Latido diario: Vercel llama a esta dirección una vez por día (ver "crons" en vercel.json) y ella
 * le pega a la base de usuarios y proyectos. Los proyectos gratis de Supabase se pausan si pasan una
 * semana sin uso; con esto siempre hay actividad y el ingreso no se cae. La clave es la pública.
 */
const API = 'https://yhqjvosqnyhgtpgfvcrt.supabase.co/rest/v1/rpc/sdc_ping'
const KEY = 'sb_publishable_CIyzhTcXxHmVOxzK9-IY2A_QuI3iEDv'

export default async function handler(_req, res) {
  try {
    const r = await fetch(API, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' })
    res.status(r.ok ? 200 : 502).json({ ok: r.ok })
  } catch {
    res.status(502).json({ ok: false })
  }
}
