import React, { useState } from "react";
import { supabase } from "./supabase.js";
import { LOGO_URI } from "./logo.js";
import { Mail } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div className="login">
      <style>{css}</style>
      <div className="login-card">
        <img className="login-logo" src={LOGO_URI} alt="Roofmaxxers" />
        <div className="login-title">PPSA Command</div>
        <div className="login-sub">Sign in to continue</div>

        {sent ? (
          <div className="sent">
            <Mail size={20} />
            <div>
              <b>Check your inbox.</b>
              <div className="sent-sub">We sent a sign-in link to {email}.</div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <label>Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@roofmaxxers.com"
              required
              autoFocus
            />
            {err && <div className="login-err">{err}</div>}
            <button type="submit" disabled={busy || !email}>
              {busy ? "Sending…" : "Send sign-in link"}
            </button>
            <div className="login-foot">No password needed. We email you a single-use link.</div>
          </form>
        )}
      </div>
    </div>
  );
}

const css = `
.login{min-height:100vh;display:grid;place-items:center;padding:24px;
  background:radial-gradient(120% 80% at 82% -12%,#0A1726 0%,#05070B 52%);}
.login-card{width:100%;max-width:380px;background:#0E131C;border:1px solid #1F2837;
  border-radius:16px;padding:32px 28px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);}
.login-logo{height:36px;display:block;margin-bottom:18px;}
.login-title{font-size:18px;font-weight:600;color:#EAF1F8;letter-spacing:-.01em;}
.login-sub{color:#586679;font-size:12.5px;margin-top:3px;}
.login-form{margin-top:24px;display:flex;flex-direction:column;}
.login-form label{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#586679;margin-bottom:6px;}
.login-form input{background:#10151F;border:1px solid #1F2837;color:#EAF1F8;border-radius:8px;
  padding:11px 12px;font-family:inherit;font-size:13px;outline:none;}
.login-form input:focus{border-color:#0B95E8;box-shadow:0 0 0 3px rgba(11,149,232,.18);}
.login-form button{margin-top:14px;background:linear-gradient(160deg,#38B0F5,#0B95E8);color:#fff;
  border:0;border-radius:8px;padding:11px;font-family:inherit;font-size:13px;font-weight:600;
  cursor:pointer;box-shadow:0 2px 12px -4px rgba(11,149,232,.6);}
.login-form button:disabled{opacity:.5;cursor:wait;}
.login-form button:hover:not(:disabled){filter:brightness(1.06);}
.login-foot{color:#586679;font-size:11px;margin-top:14px;line-height:1.5;}
.login-err{color:#F26157;font-size:12px;margin-top:8px;}
.sent{display:flex;gap:11px;margin-top:20px;padding:14px;background:#10151F;border:1px solid #1F2837;border-radius:10px;color:#94A2B8;font-size:12.5px;align-items:flex-start;}
.sent svg{color:#0B95E8;flex-shrink:0;margin-top:2px;}
.sent b{color:#EAF1F8;}
.sent-sub{font-size:11.5px;margin-top:3px;color:#586679;}
`;
