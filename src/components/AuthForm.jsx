import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Icon } from '@iconify/react'
import { supabase } from '../supabase/client'
import { useNavigate } from 'react-router-dom'
import { apiAxios } from '../lib/apiRuntime'

export default function AuthForm() {
  const { register, handleSubmit } = useForm()
  const [isSigningUp, setIsSigningUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [cooldown, setCooldown] = useState(0)
  const [signupPolicy, setSignupPolicy] = useState(null)
  const navigate = useNavigate()
  const publicSignupEnabled = !!signupPolicy?.publicSignupEnabled
  const emailField = register('email', { required: true })
  const passwordField = register('password', { required: true })

  useEffect(() => {
    let t
    if (cooldown > 0) {
      t = setInterval(() => setCooldown((c) => c - 1), 1000)
    }
    return () => clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    let mounted = true
    async function loadSignupPolicy() {
      try {
        const resp = await apiAxios({ method: 'get', url: '/api/public/signup-policy' })
        if (!mounted) return
        if (resp.data?.ok) setSignupPolicy(resp.data.data)
      } catch (e) {
        if (mounted) setSignupPolicy(null)
      }
    }
    loadSignupPolicy()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (signupPolicy && !publicSignupEnabled && isSigningUp) {
      setIsSigningUp(false)
    }
  }, [signupPolicy, publicSignupEnabled, isSigningUp])

  async function onSubmit(data) {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (isSigningUp) {
        const resp = await apiAxios({
          method: 'post',
          url: '/api/public/sign-up',
          data: {
            email: data.email,
            password: data.password
          }
        })
        if (!resp.data?.ok) throw new Error('Failed to create account')
        setSuccess('Akun berhasil dibuat. Silakan cek email untuk verifikasi lalu login.')
        setIsSigningUp(false)
        try {
          const p = await apiAxios({ method: 'get', url: '/api/public/signup-policy' })
          if (p.data?.ok) setSignupPolicy(p.data.data)
        } catch (e) {}
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password
        })
        if (signInError) throw signInError
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData?.session?.access_token
        if (!accessToken) throw new Error('Sesi login tidak ditemukan')
        try {
          await apiAxios({
            method: 'get',
            url: '/api/session-access',
            headers: { Authorization: `Bearer ${accessToken}` }
          })
        } catch (accessErr) {
          await supabase.auth.signOut()
          throw accessErr
        }
        navigate('/dashboard')
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Auth error', err)
      }
      const status = err?.response?.status || err?.status
      const apiError = err?.response?.data?.error
      const message = apiError?.message || err?.message || (err?.error_description ?? null) || JSON.stringify(err)
      const normalizedMessage = String(message || '').trim()

      if (status === 429 || /too many requests/i.test(message)) {
        setError('Too many requests. Please wait 30 seconds before trying again.')
        setCooldown(30)
      } else if (status === 403) {
        if ((apiError?.code || '') === 'EMAIL_NOT_ALLOWED') {
          setError('Akun ini tidak masuk allowlist internal. Hubungi pemilik aplikasi.')
        } else if ((apiError?.code || '') === 'SIGNUP_DISABLED') {
          setError('Pendaftaran akun dinonaktifkan. Hubungi owner untuk dibuatkan akun.')
        } else {
          setError(normalizedMessage || 'Akses ditolak.')
        }
      } else if (status === 400) {
        if (/email_not_confirmed|Email not confirmed/i.test(normalizedMessage)) {
          setError('Email belum dikonfirmasi. Periksa email Anda untuk link verifikasi atau minta admin mengkonfirmasi akun dari Supabase Dashboard.')
        } else if (/invalid login credentials/i.test(normalizedMessage)) {
          setError('Email/password salah, atau akun belum ada di project Supabase yang sedang aktif.')
          if (typeof window !== 'undefined') {
            window.alert('Email/password salah. Silakan cek dan coba lagi.')
          }
        } else {
          const detail = err?.response?.data ?? err?.response ?? null
          setError(`Login gagal: ${normalizedMessage}${detail ? ' - ' + JSON.stringify(detail) : ''}`)
        }
      } else if (status === 409) {
        setError(normalizedMessage)
      } else {
        setError(typeof normalizedMessage === 'string' ? normalizedMessage : JSON.stringify(normalizedMessage))
      }
    } finally {
      setLoading(false)
    }
  }

  function onInvalid(validationErrors) {
    const emailMissing = !!validationErrors?.email
    const passwordMissing = !!validationErrors?.password

    let message = 'Email dan password wajib diisi.'
    if (emailMissing && !passwordMissing) {
      message = 'Email wajib diisi.'
    } else if (!emailMissing && passwordMissing) {
      message = 'Password wajib diisi.'
    }

    setError(message)
    if (typeof window !== 'undefined') {
      window.alert(message)
    }
  }

  const statusMessage = error || success || ''
  const statusStyle = success && !error ? { color: '#2ecc71' } : undefined

  return (
    <div className={`auth-sample-page${isPasswordFocused ? ' hands-cover' : ''}`}>
      <div className="bg-animation">
        <div id="stars"></div>
        <div id="stars2"></div>
        <div id="stars3"></div>
        <div id="stars4"></div>
      </div>

      <div className="login">
        <form className="form" noValidate onSubmit={handleSubmit(onSubmit, onInvalid)}>
          <div className="inputs">
            <Icon icon="mdi:account" className="fa" aria-hidden="true" />
            <input
              id="email"
              type="email"
              placeholder="Email"
              autoComplete="username"
              {...emailField}
            />
            <br />
            <Icon icon="mdi:lock" className="fa" aria-hidden="true" />
            <input
              id="password"
              type="password"
              placeholder="Password"
              autoComplete={isSigningUp ? 'new-password' : 'current-password'}
              {...passwordField}
              onFocus={() => setIsPasswordFocused(true)}
              onBlur={(event) => {
                passwordField.onBlur(event)
                setIsPasswordFocused(false)
              }}
            />
            <br />
          </div>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="submit" disabled={loading || cooldown > 0}>
              {loading
                ? 'PROCESSING...'
                : isSigningUp
                  ? 'CREATE ACCOUNT'
                  : cooldown > 0
                    ? `RETRY IN ${cooldown}S`
                    : 'LOGIN'}
            </button>
          </div>
          {publicSignupEnabled && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setIsSigningUp((v) => !v)}
                disabled={loading}
                style={{
                  fontSize: 12,
                  textTransform: 'none',
                  backgroundColor: 'rgba(20, 26, 38, 0.52)',
                  boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.18)'
                }}
              >
                {isSigningUp ? 'Have an account? Sign in' : "Don't have account? Sign up"}
              </button>
            </div>
          )}
          <div id="loginStatus" className="status" style={statusStyle}>{statusMessage}</div>
        </form>
      </div>

      <div className="backg">
        <div className={`panda${success ? ' success' : ''}`}>
          <div className="earl"></div>
          <div className="earr"></div>
          <div className="face">
            <div className="blshl"></div>
            <div className="blshr"></div>
            <div className="eyel"><div className="eyeball1"></div></div>
            <div className="eyer"><div className="eyeball2"></div></div>
            <div className="nose"><div className="line"></div></div>
            <div className="mouth">
              <div className="m"><div className="m1"></div></div>
              <div className="mm"><div className="m1"></div></div>
            </div>
          </div>
        </div>
      </div>
      <div className="pawl"><div className="p1"><div className="p2"></div><div className="p3"></div><div className="p4"></div></div></div>
      <div className="pawr"><div className="p1"><div className="p2"></div><div className="p3"></div><div className="p4"></div></div></div>
      <div className="handl"></div>
      <div className="handr"></div>
    </div>
  )
}
