import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, ShieldCheck,
  DollarSign, Phone, CalendarCheck, Eye, Zap, Wallet, Target, Plus, X, LogOut, Clock
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { supabase } from "./supabase.js";
import { LOGO_URI } from "./logo.js";
import Login from "./Login.jsx";
import { useLiveData } from "./useLiveData.js";

/* ---------- helpers ---------- */
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n || 0)).toLocaleString();
const pct = (n) => Math.round((n || 0) * 100) + "%";
const initials = (n) => (n || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const AVATAR = ["#0B95E8", "#34D399", "#FBBF24", "#A78BFA", "#F26157", "#22D3EE"];
const avatarColor = (n) => AVATAR[(n || "").length % AVATAR.length];

const TIERS = { good: "#34D399", watch: "#FBBF24", borderline: "#F5A524", probcut: "#F2784B", cut: "#F26157" };
const TIER_LABEL = { good: "Good", watch: "Watch", borderline: "Borderline", probcut: "Prob cut", cut: "Cut" };
function band(ratio) {
  if (ratio < 0.75) return "good";
  if (ratio < 0.9) return "watch";
  if (ratio < 1.0) return "borderline";
  if (ratio < 1.3) return "probcut";
  return "cut";
}
const COLORS = { green: "#34D399", amber: "#FBBF24", red: "#F26157", pending: "#6A7891" };

function assess(d) {
  if (d.pending) return { level: "pending", flags: [], headline: "Awaiting first sync" };
  const flags = [];
  if (d.we_pay_spend) {
    if (d.cps > d.ppsa_rate && d.showed > 0) flags.push({ level: "red", metric: "Cost/Show", msg: "Losing per show — cut spend or raise rate" });
    else if (d.cps > 0.85 * d.ppsa_rate && d.showed > 0) flags.push({ level: "amber", metric: "Cost/Show", msg: "Margin per show thin — optimize" });
    if (d.cpl > d.beCpl && d.beCpl > 0) flags.push({ level: "red", metric: "CPL", msg: "CPL above break-even — tighten targeting" });
    else if (d.cpl > 0.85 * d.beCpl && d.beCpl > 0) flags.push({ level: "amber", metric: "CPL", msg: "CPL climbing — watch targeting" });
  }
  const br = d.target_booked ? d.booked / d.target_booked : 1;
  if (br < 0.6) flags.push({ level: "red", metric: "Bookings", msg: "Bookings low — push setter on follow-ups" });
  else if (br < 0.85) flags.push({ level: "amber", metric: "Bookings", msg: "Bookings under target — tighten follow-up" });
  const lr = d.target_leads ? d.leads / d.target_leads : 1;
  if (lr < 0.6) flags.push({ level: "red", metric: "Leads", msg: "Leads low — refresh creative or raise budget" });
  else if (lr < 0.85) flags.push({ level: "amber", metric: "Leads", msg: "Leads under target — refresh creative" });
  if (d.booked >= 5 && d.showRate < 0.6) flags.push({ level: "red", metric: "Show rate", msg: "Show rate low — confirm and remind appts" });
  else if (d.booked >= 5 && d.showRate < 0.68) flags.push({ level: "amber", metric: "Show rate", msg: "Show rate slipping — add reminders" });

  let level;
  if (!d.we_pay_spend) level = "green";
  else if (d.marginPct < -0.05) level = "red";
  else if (d.marginPct < 0.12) level = "amber";
  else level = "green";
  if (flags.some((f) => f.level === "red")) level = "red";
  else if (level !== "red" && flags.some((f) => f.level === "amber")) level = "amber";

  const red = flags.find((f) => f.level === "red"), amber = flags.find((f) => f.level === "amber");
  const headline =
    !d.we_pay_spend && level === "green" && !red && !amber ? "Client-funded — no ad risk to RM" :
    red ? red.msg : amber ? amber.msg : "Profitable — scale spend";
  return { level, flags, headline };
}
const opsFlags = (flags) => flags.filter((f) => ["Bookings", "Leads", "Show rate"].includes(f.metric));

/* ---------- app shell ---------- */
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (data) setProfile(data);
      else {
        // first-time login: create a minimal profile (defaults to CSR/ops). Owner can promote them later.
        const fresh = { id: session.user.id, name: session.user.email.split("@")[0], role: "CSR", access: "ops" };
        await supabase.from("profiles").upsert(fresh);
        setProfile(fresh);
      }
    })();
  }, [session]);

  if (authLoading) return <div className="boot">Loading…<style>{bootCss}</style></div>;
  if (!session) return <Login />;
  if (!profile) return <div className="boot">Setting up your account…<style>{bootCss}</style></div>;

  return <Dashboard user={session.user} profile={profile} />;
}

const bootCss = `.boot{min-height:100vh;display:grid;place-items:center;background:#05070B;color:#586679;font-family:-apple-system,system-ui,sans-serif;font-size:13px;}`;

/* ---------- dashboard ---------- */
function Dashboard({ user, profile }) {
  const [view, setView] = useState("dash");
  const [period, setPeriod] = useState(30);
  const [openId, setOpenId] = useState(null);
  const [sortKey, setSortKey] = useState("risk");
  const [addClient, setAddClient] = useState(false);
  const [addMember, setAddMember] = useState(false);
  const [team, setTeam] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastSync, setLastSync] = useState(new Date());

  const { rows: data, loading, error } = useLiveData(period);
  const isAdmin = profile.access === "full";

  // refresh team list when on team view or when a member is added
  useEffect(() => {
    if (view !== "team") return;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
      setTeam(data || []);
    })();
  }, [view, refreshTick]);

  useEffect(() => { if (!loading) setLastSync(new Date()); }, [loading]);

  const rows = useMemo(() => data.map((d) => ({ d, a: assess(d) })), [data]);

  const sorted = useMemo(() => {
    const order = { red: 0, amber: 1, green: 2, pending: 3 };
    const arr = [...rows];
    if (sortKey === "risk") arr.sort((x, y) => order[x.a.level] - order[y.a.level] || y.d.margin - x.d.margin);
    if (sortKey === "margin") arr.sort((x, y) => y.d.margin - x.d.margin);
    if (sortKey === "spend") arr.sort((x, y) => y.d.spend - x.d.spend);
    if (sortKey === "booked") arr.sort((x, y) => y.d.booked - x.d.booked);
    return arr;
  }, [rows, sortKey]);

  const totals = useMemo(() => {
    const t = { rev: 0, cost: 0, spend: 0, booked: 0, showed: 0, leads: 0, g: 0, a: 0, r: 0, p: 0 };
    rows.forEach(({ d, a }) => {
      if (a.level === "pending") { t.p++; return; }
      t.rev += d.revenue; t.cost += d.ourAdCost; t.spend += d.spend;
      t.booked += d.booked; t.showed += d.showed; t.leads += d.leads;
      t[a.level === "green" ? "g" : a.level === "amber" ? "a" : "r"]++;
    });
    t.margin = t.rev - t.cost; t.marginPct = t.rev ? t.margin / t.rev : 0;
    t.showRate = t.booked ? t.showed / t.booked : 0;
    return t;
  }, [rows]);

  const syncLabel = useMemo(() => {
    const m = Math.round((Date.now() - lastSync.getTime()) / 60000);
    return m < 1 ? "Synced now" : `Synced ${m}m ago`;
  }, [lastSync, refreshTick]);

  return (
    <div className="rmx">
      <style>{css}</style>

      <header className="bar">
        <div className="brand">
          <img className="logo-img" src={LOGO_URI} alt="Roofmaxxers" />
          <div>
            <div className="brand-name">ROOFMAXXERS</div>
            <div className="brand-sub">PPSA Command</div>
          </div>
          <nav className="nav">
            <button className={view === "dash" ? "on" : ""} onClick={() => setView("dash")}>Performance</button>
            <button className={view === "team" ? "on" : ""} onClick={() => setView("team")}>Team</button>
          </nav>
        </div>
        <div className="bar-right">
          {view === "dash" && (
            <div className="seg">
              <button className={period === 7 ? "on" : ""} onClick={() => setPeriod(7)}>7d</button>
              <button className={period === 30 ? "on" : ""} onClick={() => setPeriod(30)}>30d</button>
            </div>
          )}
          <button className="sync" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw size={13} /> {syncLabel}
          </button>
          <div className="me" title={user.email}>
            <span className="avatar sm" style={{ background: avatarColor(profile.name) }}>{initials(profile.name)}</span>
            <button className="logout" onClick={() => supabase.auth.signOut()} title="Sign out"><LogOut size={13} /></button>
          </div>
        </div>
      </header>

      {error && <div className="banner err">Data error: {error}</div>}
      {loading && data.length === 0 && <div className="banner">Loading live data…</div>}

      {view === "dash" ? (
        <>
          <section className="rollup">
            {isAdmin ? (
              <>
                <Stat big tone={totals.marginPct >= 0.12 ? "green" : totals.marginPct >= -0.05 ? "amber" : "red"}
                  label="Blended margin" value={money(totals.margin)} sub={pct(totals.marginPct) + " of revenue"} icon={<Wallet size={15} />} />
                <Stat label="Revenue" value={money(totals.rev)} sub="charges − credits + retainers" icon={<DollarSign size={15} />} />
                <Stat label="Ad spend RM covers" value={money(totals.cost)} sub={money(totals.spend) + " managed"} icon={<Zap size={15} />} />
                <Stat label="Shows / booked" value={`${totals.showed} / ${totals.booked}`} sub={pct(totals.showRate) + " show rate"} icon={<CalendarCheck size={15} />} />
                <div className="health-card">
                  <div className="stat-label">Portfolio health</div>
                  <div className="health-counts">
                    <span className="hc green"><b>{totals.g}</b> profitable</span>
                    <span className="hc amber"><b>{totals.a}</b> watch</span>
                    <span className="hc red"><b>{totals.r}</b> fix now</span>
                    {totals.p > 0 && <span className="hc pending"><b>{totals.p}</b> pending</span>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Stat big tone="green" label="Leads" value={totals.leads.toLocaleString()} sub={period + "-day total"} icon={<Target size={15} />} />
                <Stat label="Booked" value={totals.booked.toLocaleString()} sub="this period" icon={<CalendarCheck size={15} />} />
                <Stat label="Showed" value={totals.showed.toLocaleString()} sub={pct(totals.showRate) + " show rate"} icon={<Activity size={15} />} />
                <Stat label="Active clients" value={data.length} sub={`${totals.p} awaiting first sync`} icon={<Phone size={15} />} />
              </>
            )}
          </section>

          <div className="toolbar">
            <div className="legend">
              <span><i className="dot green" /> Profitable</span>
              <span><i className="dot amber" /> Break-even — watch</span>
              <span><i className="dot red" /> Loss — fix now</span>
            </div>
            <div className="toolbar-r">
              <div className="sortwrap">
                <label>Sort</label>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="risk">Risk first</option>
                  <option value="margin">Margin</option>
                  <option value="spend">Ad spend</option>
                  <option value="booked">Bookings</option>
                </select>
              </div>
              {isAdmin && <button className="btn primary" onClick={() => setAddClient(true)}><Plus size={15} /> Add client</button>}
            </div>
          </div>

          <div className={"thead " + (isAdmin ? "admin" : "csr")}>
            <span>Client</span><span className="r">Spend</span><span className="r">Leads</span><span className="r">CPL</span>
            <span className="r">Booked</span><span className="r">Show%</span>
            {isAdmin && <span className="r">Cost/Show</span>}{isAdmin && <span className="r">Margin</span>}
            <span>Status</span>
          </div>

          <div className="rows">
            {sorted.map(({ d, a }) => {
              const open = openId === d.id;
              const ops = opsFlags(a.flags);
              const flags = isAdmin ? a.flags : ops;
              const lvl = a.level === "pending" ? "pending" : isAdmin ? a.level : (ops.some((f) => f.level === "red") ? "red" : ops.some((f) => f.level === "amber") ? "amber" : "green");
              const headline = a.level === "pending" ? "Awaiting first sync" : isAdmin ? a.headline : (ops.find((f) => f.level === "red") || ops.find((f) => f.level === "amber"))?.msg || "On track";
              const dash = d.pending;
              return (
                <div key={d.id} className={"row-wrap " + lvl}>
                  <button className={"row " + (isAdmin ? "admin" : "csr")} onClick={() => setOpenId(open ? null : d.id)}>
                    <span className="cli">
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <span className="cli-txt">
                        <span className="cli-name">{d.name}</span>
                        <span className="cli-meta">
                          <em className={"badge t-" + (d.type || "ppsa").toLowerCase()}>{d.type}</em>
                          {d.we_pay_spend ? <em className="badge fund-us">RM funded</em> : <em className="badge fund-cli">Client funded</em>}
                          {d.owner && <span className="cli-area">{d.owner}</span>}
                        </span>
                      </span>
                    </span>
                    <span className="r mono">{dash ? "—" : money(d.spend)}</span>
                    <span className="r mono">{dash ? "—" : d.leads}</span>
                    <span className="r mono">{dash || d.leads === 0 ? "—" : money(d.cpl)}</span>
                    <span className="r mono">{dash ? "—" : d.booked}</span>
                    <span className="r mono">{dash || d.booked === 0 ? "—" : pct(d.showRate)}</span>
                    {isAdmin && <span className="r mono">{dash || !d.we_pay_spend || d.showed === 0 ? "—" : money(d.cps)}</span>}
                    {isAdmin && <span className={"r mono strong " + lvl}>{dash ? "—" : money(d.margin)}</span>}
                    <span className="status"><i className={"dot " + lvl} /><span className="status-msg">{headline}</span></span>
                  </button>
                  {open && <Detail d={d} a={a} flags={flags} isAdmin={isAdmin} period={period} />}
                </div>
              );
            })}
          </div>

          <footer className="foot">Revenue is real ForceCharge dollars (charges − credits) · Ad spend pulled from Meta · Updates every 15 min</footer>
        </>
      ) : (
        <TeamView team={team} isAdmin={isAdmin} onAdd={() => setAddMember(true)} onChange={() => setRefreshTick((t) => t + 1)} />
      )}

      {addClient && <AddClientForm team={team} onClose={() => setAddClient(false)} onAdd={async (c) => {
        const { error } = await supabase.from("clients").insert(c);
        if (error) alert(error.message);
        else setRefreshTick((t) => t + 1);
        setAddClient(false);
      }} />}
      {addMember && <AddMemberForm onClose={() => setAddMember(false)} onAdd={async (m) => {
        alert("To add a real teammate: have them sign in once at the login screen — then you can change their role here. (Email invites coming.)");
        setAddMember(false);
      }} />}
    </div>
  );
}

function Stat({ label, value, sub, icon, big, tone }) {
  return (
    <div className={"stat" + (big ? " big" : "")}>
      <div className="stat-top"><span className="stat-label">{label}</span><span className="stat-ic">{icon}</span></div>
      <div className={"stat-val" + (tone ? " " + tone : "")}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Detail({ d, a, flags, isAdmin, period }) {
  if (d.pending) {
    return (
      <div className="detail pending-detail">
        <div className="pend"><Clock size={15} /> Awaiting first Meta + Slack sync. Spend, leads, bookings and margin appear here after the next pull.</div>
      </div>
    );
  }
  const maxFunnel = Math.max(d.leads, 1);
  const beFill = isAdmin && d.we_pay_spend ? Math.min(d.cps / (Number(d.ppsa_rate) * 1.5 || 1), 1) : 0;
  const bePos = 1 / 1.5;
  const zone = d.cps > d.ppsa_rate ? "red" : d.cps > 0.85 * d.ppsa_rate ? "amber" : "green";

  const showRev = Number(d.ppsa_rate || 0) * d.showRate;
  const kpis = d.we_pay_spend && d.ppsa_rate ? [
    { label: "CPL", value: d.cpl, tier: band(d.beCpl ? d.cpl / d.beCpl : 0) },
    { label: "Cost/booked", value: d.cpb, tier: band(showRev ? d.cpb / showRev : 0) },
    { label: "Cost/show", value: d.cps, tier: band(d.ppsa_rate ? d.cps / d.ppsa_rate : 0) },
  ] : [];
  const rank = { good: 0, watch: 1, borderline: 2, probcut: 3, cut: 4 };
  const biggest = kpis.length ? kpis.reduce((a, b) => (rank[b.tier] > rank[a.tier] ? b : a)) : null;

  return (
    <div className="detail">
      <div className="d-block">
        <div className="d-title">Funnel · {period}d</div>
        <FunnelBar label="Leads" n={d.leads} w={1} tone="dim" />
        <Conv pct={pct(d.bookRate)} text="booking rate" />
        <FunnelBar label="Booked" n={d.booked} w={d.booked / maxFunnel} tone="accent" />
        <Conv pct={pct(d.showRate)} text="show rate" warn={d.booked >= 5 && d.showRate < 0.68} />
        <FunnelBar label="Showed" n={d.showed} w={d.showed / maxFunnel} tone="green" />
        <div className="d-calls">{d.service} · {d.owner || "unassigned"}</div>
      </div>

      <div className="d-block">
        {isAdmin && d.we_pay_spend && d.ppsa_rate ? (
          <>
            <div className="d-title">Margin per show</div>
            <div className="meter">
              <div className="meter-fill" style={{ width: beFill * 100 + "%", background: COLORS[zone] }} />
              <div className="meter-be" style={{ left: bePos * 100 + "%" }}><span>break-even ${d.ppsa_rate}</span></div>
            </div>
            <div className="meter-read">
              <span className="mono" style={{ color: COLORS[zone] }}>{money(d.cps)} cost/show</span>
              <span className="mono" style={{ color: d.headroom >= 0 ? COLORS.green : COLORS.red }}>{d.headroom >= 0 ? "+" : ""}{money(d.headroom)} kept/show</span>
            </div>
            <div className="d-sub">Max payable per lead before break-even: <b className="mono">{money(d.beCpl)}</b> (now {money(d.cpl)}).</div>
            <div className="kpis">
              {kpis.map((k) => (
                <span key={k.label} className="kpi" style={{ borderColor: TIERS[k.tier] }}>
                  <span className="kpi-label">{k.label}</span>
                  <span className="kpi-val mono">{money(k.value)}</span>
                  <span className="kpi-tier" style={{ color: TIERS[k.tier] }}>{TIER_LABEL[k.tier]}</span>
                </span>
              ))}
            </div>
          </>
        ) : isAdmin ? (
          <>
            <div className="d-title">Billing</div>
            <div className="d-sub" style={{ marginTop: 2 }}>{d.we_pay_spend ? "Set a PPSA rate to enable margin tracking." : "Client pays their own ad spend — no media risk to RM."}</div>
            {d.retainer > 0 && <div className="bill"><span>Retainer</span><b className="mono">{money(d.retainer)}/mo</b></div>}
            {(d.type === "PPSA" || d.type === "Combo") && <div className="bill"><span>Charged this period</span><b className="mono">{money(d.charged)}</b></div>}
            {d.credited > 0 && <div className="bill"><span>Credited (no-shows)</span><b className="mono">-{money(d.credited)}</b></div>}
          </>
        ) : (
          <>
            <div className="d-title">This period</div>
            <div className="bill"><span>Leads</span><b className="mono">{d.leads} / {d.target_leads || "—"}</b></div>
            <div className="bill"><span>Booked</span><b className="mono">{d.booked} / {d.target_booked || "—"}</b></div>
            <div className="bill"><span>Showed</span><b className="mono">{d.showed}</b></div>
            <div className="bill"><span>Show rate</span><b className="mono">{d.booked ? pct(d.showRate) : "—"}</b></div>
          </>
        )}
      </div>

      <div className="d-block">
        {isAdmin ? (
          <>
            <div className="d-title">Daily margin · {period}d</div>
            <div className="spark"><ResponsiveContainer width="100%" height={64}><LineChart data={d.daily}><Line type="monotone" dataKey="margin" stroke={COLORS[a.level]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
            <div className="bill"><span>Charged</span><b className="mono">{money(d.charged)}</b></div>
            {d.credited > 0 && <div className="bill"><span>Credited</span><b className="mono">-{money(d.credited)}</b></div>}
            {d.retainer > 0 && <div className="bill"><span>Retainer</span><b className="mono">{money(d.retainer)}</b></div>}
            {d.we_pay_spend && <div className="bill"><span>Ad spend (RM)</span><b className="mono">-{money(d.spend)}</b></div>}
            <div className="bill total"><span>Margin</span><b className="mono" style={{ color: COLORS[a.level] }}>{money(d.margin)} · {pct(d.marginPct)}</b></div>
          </>
        ) : (
          <>
            <div className="d-title">Daily leads · {period}d</div>
            <div className="spark"><ResponsiveContainer width="100%" height={64}><LineChart data={d.daily}><Line type="monotone" dataKey="leads" stroke={COLORS[a.level]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
          </>
        )}
      </div>

      <div className="d-flags">
        <div className="d-title">What to fix</div>
        {biggest && rank[biggest.tier] >= 2 && (
          <div className="constraint"><Zap size={13} /> Biggest constraint: <b>{biggest.label}</b> at {money(biggest.value)}<span style={{ color: TIERS[biggest.tier] }}> · {TIER_LABEL[biggest.tier]}</span></div>
        )}
        {flags.length === 0 ? (
          <div className="flag green"><ShieldCheck size={14} /> On track — keep it running.</div>
        ) : flags.map((f, i) => (
          <div key={i} className={"flag " + f.level}>
            {f.level === "red" ? <AlertTriangle size={14} /> : <Eye size={14} />}
            <b>{f.metric}</b> — {f.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelBar({ label, n, w, tone }) {
  return (
    <div className="fbar">
      <span className="fbar-label">{label}</span>
      <span className="fbar-track"><span className={"fbar-fill " + tone} style={{ width: Math.max(w * 100, 6) + "%" }} /></span>
      <span className="fbar-n mono">{n}</span>
    </div>
  );
}
const Conv = ({ pct, text, warn }) => <div className={"conv" + (warn ? " warn" : "")}>↓ {pct} <span>{text}</span></div>;

/* ---------- team ---------- */
function TeamView({ team, isAdmin, onAdd, onChange }) {
  const ROLES = ["Owner", "Admin / Partner", "Operations Manager", "CSM", "Project Manager", "Setter", "CSR"];
  const setRole = async (id, role) => { await supabase.from("profiles").update({ role }).eq("id", id); onChange(); };
  const setAccess = async (id, access) => { await supabase.from("profiles").update({ access }).eq("id", id); onChange(); };

  return (
    <section className="team">
      <div className="team-head">
        <div>
          <div className="sec-title">Team &amp; access</div>
          <div className="sec-sub">{team.length} people · <b>Full</b> sees revenue &amp; margin · <b>Ops only</b> sees calls, leads &amp; bookings</div>
        </div>
        {isAdmin && <button className="btn primary" onClick={onAdd}><Plus size={15} /> Add team member</button>}
      </div>
      <div className="team-grid">
        {team.map((m) => (
          <div key={m.id} className="member">
            <span className="avatar" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>
            <div className="member-info">
              <div className="member-name">{m.name || "—"}</div>
              {isAdmin ? (
                <>
                  <select className="member-edit" value={m.role || "CSR"} onChange={(e) => setRole(m.id, e.target.value)}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <select className="member-edit" value={m.access || "ops"} onChange={(e) => setAccess(m.id, e.target.value)}>
                    <option value="full">Full · financials</option>
                    <option value="ops">Ops only</option>
                  </select>
                </>
              ) : (
                <>
                  <div className="member-role">{m.role}</div>
                  <div className={"access " + m.access}>{m.access === "full" ? "Full" : "Ops only"}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- modals ---------- */
function Modal({ title, sub, onClose, onSubmit, submitLabel, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div className="modal-title">{title}</div>{sub && <div className="modal-sub">{sub}</div>}</div>
          <button className="x" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
function Seg({ value, onChange, options }) {
  return <div className="seg fld-seg">{options.map((o) => <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>;
}

function AddClientForm({ onAdd, onClose, team }) {
  const owners = team.map((t) => t.name).filter(Boolean);
  const [name, setName] = useState(""); const [area, setArea] = useState(""); const [service, setService] = useState("Roofing");
  const [type, setType] = useState("PPSA"); const [fund, setFund] = useState("rm"); const [account, setAccount] = useState("universal");
  const [campaignMatch, setCampaignMatch] = useState(""); const [adAccount, setAdAccount] = useState("act_52692019451927");
  const [rate, setRate] = useState(200); const [ret, setRet] = useState(0);
  const [tB, setTB] = useState(24); const [tL, setTL] = useState(100);
  const [owner, setOwner] = useState(owners[0] || "");
  const submit = () => {
    if (!name.trim()) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    onAdd({
      id, name: name.trim(), area: area.trim(), service, owner, type,
      we_pay_spend: fund === "rm",
      ad_account_id: account === "own" ? adAccount : "act_52692019451927",
      campaign_match: account === "universal" ? (campaignMatch.trim() || name.trim().split(" ")[0]) : null,
      ppsa_rate: Number(rate) || 0, retainer: Number(ret) || 0,
      target_booked: Number(tB) || 0, target_leads: Number(tL) || 0, active: true,
    });
  };
  return (
    <Modal title="Add client" sub="Lands as pending until the next Meta + Slack sync" onClose={onClose} onSubmit={submit} submitLabel="Add client">
      <div className="field"><label>Company name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="XYZ Roofing" /></div>
      <div className="grid2">
        <div className="field"><label>Service</label><select value={service} onChange={(e) => setService(e.target.value)}><option>Roofing</option><option>Gutters</option><option>Cabinets</option></select></div>
        <div className="field"><label>Service area</label><input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Boise, ID" /></div>
      </div>
      <div className="field"><label>Metric owner</label><select value={owner} onChange={(e) => setOwner(e.target.value)}>{owners.length ? owners.map((o) => <option key={o}>{o}</option>) : <option value="">(no team members yet)</option>}</select></div>
      <div className="field"><label>Engagement type</label><Seg value={type} onChange={setType} options={[{ v: "PPSA", label: "PPSA" }, { v: "Retainer", label: "Retainer" }, { v: "Combo", label: "Combo" }]} /></div>
      <div className="grid2">
        <div className="field"><label>Ad funding</label><Seg value={fund} onChange={setFund} options={[{ v: "rm", label: "RM funded" }, { v: "client", label: "Client funded" }]} /></div>
        <div className="field"><label>Ad account</label><Seg value={account} onChange={setAccount} options={[{ v: "own", label: "Own" }, { v: "universal", label: "Universal" }]} /></div>
      </div>
      {account === "own" && <div className="field"><label>Ad account ID</label><input value={adAccount} onChange={(e) => setAdAccount(e.target.value)} placeholder="act_..." /></div>}
      {account === "universal" && <div className="field"><label>Campaign name match</label><input value={campaignMatch} onChange={(e) => setCampaignMatch(e.target.value)} placeholder="e.g. KAB (matched inside RM-roofs-...-...)" /></div>}
      <div className="grid2">
        {type !== "Retainer" && <div className="field"><label>PPSA rate / show ($)</label><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>}
        {type !== "PPSA" && <div className="field"><label>Retainer ($/mo)</label><input type="number" value={ret} onChange={(e) => setRet(e.target.value)} /></div>}
      </div>
      <div className="grid2">
        <div className="field"><label>Target booked / mo</label><input type="number" value={tB} onChange={(e) => setTB(e.target.value)} /></div>
        <div className="field"><label>Target leads / mo</label><input type="number" value={tL} onChange={(e) => setTL(e.target.value)} /></div>
      </div>
      <div className="hint">Slack channels for this client: add them in Supabase → <b>slack_channels</b> table (we'll move this into the UI next).</div>
    </Modal>
  );
}

function AddMemberForm({ onAdd, onClose }) {
  return (
    <Modal title="Add team member" sub="" onClose={onClose} onSubmit={() => onAdd({})} submitLabel="OK">
      <div className="hint" style={{ fontSize: "12.5px", lineHeight: 1.6 }}>
        To add a teammate: <br />
        1. Share the dashboard URL with them<br />
        2. They sign in with their email (magic link)<br />
        3. Their name appears here as <b>CSR / Ops only</b><br />
        4. You promote them to the right role and access level
      </div>
    </Modal>
  );
}

/* ---------- styles ---------- */
const css = `
.rmx{--ink:#05070B;--ink2:#080B11;--panel:#0E131C;--panel2:#141C28;--line:#1F2837;--line2:#161D29;
  --text:#EAF1F8;--dim:#94A2B8;--faint:#586679;--brand:#0B95E8;--brand2:#38B0F5;
  --green:#34D399;--amber:#FBBF24;--red:#F26157;--pending:#6A7891;
  --mono:ui-monospace,'SF Mono','Cascadia Code',Menlo,monospace;
  background:radial-gradient(120% 80% at 82% -12%,#0A1726 0%,var(--ink) 52%);color:var(--text);min-height:100vh;width:100%;
  font-family:-apple-system,system-ui,'Segoe UI',sans-serif;font-size:13px;-webkit-font-smoothing:antialiased;}
.rmx *{box-sizing:border-box;}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}

.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 22px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(20,30,48,.6),rgba(10,14,22,.4));backdrop-filter:blur(8px);position:sticky;top:0;z-index:5;}
.brand{display:flex;align-items:center;gap:11px;}
.logo-img{height:30px;width:auto;display:block;}
.brand-name{font-weight:700;letter-spacing:.18em;font-size:12.5px;}
.brand-sub{color:var(--faint);font-size:11px;letter-spacing:.04em;}
.nav{display:flex;gap:2px;margin-left:14px;padding-left:14px;border-left:1px solid var(--line);}
.nav button{background:none;border:none;color:var(--dim);font-family:inherit;font-size:13px;cursor:pointer;padding:7px 11px;border-radius:7px;}
.nav button:hover{color:var(--text);}
.nav button.on{color:var(--text);background:var(--panel);}
.bar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.seg{display:flex;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;}
.seg button{background:none;border:none;color:var(--dim);padding:6px 11px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:5px;font-family:inherit;}
.seg button.on{background:var(--panel2);color:var(--text);box-shadow:inset 0 0 0 1px var(--brand);}
.sync{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;}
.sync:hover{color:var(--text);}
.me{display:flex;align-items:center;gap:6px;}
.avatar{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:11.5px;flex-shrink:0;}
.avatar.sm{width:28px;height:28px;font-size:10.5px;}
.logout{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:8px;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;}
.logout:hover{color:var(--text);}

.btn{border-radius:8px;padding:8px 13px;font-size:12.5px;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;}
.btn.primary{background:linear-gradient(160deg,var(--brand2),var(--brand));color:#fff;box-shadow:0 2px 12px -4px rgba(11,149,232,.6);}
.btn.primary:hover{filter:brightness(1.07);}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--dim);}
.btn.ghost:hover{color:var(--text);border-color:var(--faint);}

.banner{padding:10px 22px;color:var(--dim);font-size:12px;background:var(--panel);border-bottom:1px solid var(--line2);}
.banner.err{color:#FCB5AE;background:rgba(242,97,87,.08);}

.rollup{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr 1.1fr;gap:12px;padding:18px 22px;}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 15px;}
.stat.big{background:linear-gradient(155deg,var(--panel2),var(--panel));border-color:#2A3650;}
.stat-top{display:flex;justify-content:space-between;align-items:center;}
.stat-label{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.08em;}
.stat-ic{color:var(--faint);}
.stat-val{font-family:var(--mono);font-size:26px;font-weight:600;margin-top:8px;letter-spacing:-.01em;}
.stat.big .stat-val{font-size:30px;}
.stat-val.green{color:var(--green);}.stat-val.amber{color:var(--amber);}.stat-val.red{color:var(--red);}
.stat-sub{color:var(--dim);font-size:11.5px;margin-top:4px;}
.health-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 15px;}
.health-counts{display:flex;flex-direction:column;gap:6px;margin-top:9px;}
.hc{font-size:12px;color:var(--dim);display:flex;align-items:baseline;gap:7px;}
.hc b{font-family:var(--mono);font-size:16px;}
.hc.green b{color:var(--green);}.hc.amber b{color:var(--amber);}.hc.red b{color:var(--red);}.hc.pending b{color:var(--pending);}

.toolbar{display:flex;justify-content:space-between;align-items:center;padding:4px 22px 12px;gap:12px;flex-wrap:wrap;}
.legend{display:flex;gap:18px;color:var(--dim);font-size:11.5px;}
.legend span{display:flex;align-items:center;gap:7px;}
.toolbar-r{display:flex;align-items:center;gap:12px;}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.dot.green{background:var(--green);box-shadow:0 0 8px -1px var(--green);}
.dot.amber{background:var(--amber);box-shadow:0 0 8px -1px var(--amber);}
.dot.red{background:var(--red);box-shadow:0 0 8px -1px var(--red);}
.dot.pending{background:var(--pending);}
.sortwrap{display:flex;align-items:center;gap:8px;color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em;}
.sortwrap select{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:6px 8px;font-family:inherit;font-size:12px;text-transform:none;letter-spacing:0;}

.thead,.row{display:grid;align-items:center;gap:10px;grid-template-columns:minmax(230px,2.4fr) .8fr .6fr .7fr .7fr .7fr .8fr .9fr minmax(220px,1.7fr);}
.thead.csr,.row.csr{grid-template-columns:minmax(230px,2.6fr) .8fr .6fr .7fr .7fr .7fr minmax(220px,1.9fr);}
.thead{padding:0 22px 8px;color:var(--faint);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--line2);}
.thead .r{text-align:right;}
.rows{padding:0 14px;}
.row-wrap{border-bottom:1px solid var(--line2);border-left:3px solid transparent;}
.row-wrap.red{border-left-color:var(--red);}.row-wrap.amber{border-left-color:var(--amber);}
.row-wrap.green{border-left-color:var(--green);}.row-wrap.pending{border-left-color:var(--pending);}
.row{width:100%;text-align:left;background:none;border:none;color:var(--text);cursor:pointer;padding:12px 8px;font-family:inherit;font-size:13px;}
.row:hover{background:var(--panel);}
.row .r{text-align:right;}
.cli{display:flex;align-items:flex-start;gap:7px;color:var(--dim);}
.cli-txt{display:flex;flex-direction:column;gap:5px;min-width:0;}
.cli-name{color:var(--text);font-weight:600;font-size:13.5px;}
.cli-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
.badge{font-style:normal;font-size:10px;padding:2px 7px;border-radius:5px;letter-spacing:.02em;background:var(--panel2);color:var(--dim);border:1px solid var(--line);}
.t-ppsa{color:#9FD0FF;}.t-retainer{color:#C7B5FF;}.t-combo{color:#7DE3C4;}
.fund-us{color:var(--brand2);}.fund-cli{color:var(--faint);}
.cli-area{font-size:10.5px;color:var(--faint);}
.row .mono{color:var(--text);}
.row .mono.strong{font-weight:600;}
.row .mono.strong.green{color:var(--green);}.row .mono.strong.amber{color:var(--amber);}.row .mono.strong.red{color:var(--red);}.row .mono.strong.pending{color:var(--pending);}
.status{display:flex;align-items:center;gap:8px;}
.status-msg{color:var(--dim);font-size:12px;line-height:1.3;}

.detail{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;padding:6px 16px 20px;background:linear-gradient(180deg,var(--panel),var(--ink2));border-top:1px solid var(--line2);}
.pending-detail{display:block;}
.pend{display:flex;align-items:center;gap:9px;color:var(--dim);font-size:12.5px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;}
.pend svg{color:var(--pending);}
.d-block{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:13px 14px;}
.d-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin-bottom:11px;}
.d-sub{font-size:11.5px;color:var(--dim);margin-top:9px;line-height:1.45;}
.d-calls{font-size:11px;color:var(--faint);margin-top:11px;}
.fbar{display:flex;align-items:center;gap:9px;margin:3px 0;}
.fbar-label{width:52px;font-size:11px;color:var(--dim);}
.fbar-track{flex:1;height:18px;background:#0C121C;border-radius:5px;overflow:hidden;}
.fbar-fill{display:block;height:100%;border-radius:5px;}
.fbar-fill.dim{background:#39485E;}.fbar-fill.accent{background:var(--brand);}.fbar-fill.green{background:var(--green);}
.fbar-n{width:34px;text-align:right;font-size:12px;}
.conv{font-size:10.5px;color:var(--faint);margin:2px 0 2px 60px;}
.conv span{opacity:.7;}.conv.warn{color:var(--amber);}
.meter{position:relative;height:26px;background:#0C121C;border-radius:6px;overflow:hidden;margin-top:2px;}
.meter-fill{height:100%;border-radius:6px 0 0 6px;transition:width .5s;}
.meter-be{position:absolute;top:0;height:100%;border-left:2px dashed var(--dim);}
.meter-be span{position:absolute;top:-16px;left:-30px;font-size:9.5px;color:var(--dim);white-space:nowrap;}
.meter-read{display:flex;justify-content:space-between;margin-top:14px;font-size:12px;}
.bill{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--dim);padding:5px 0;}
.bill b{color:var(--text);}
.bill.total{border-top:1px solid var(--line);margin-top:5px;padding-top:9px;color:var(--text);font-weight:600;}
.spark{margin:-4px -4px 8px;}
.kpis{display:flex;gap:6px;margin-top:11px;}
.kpi{flex:1;border:1px solid var(--line);border-left-width:3px;border-radius:7px;padding:7px 8px;display:flex;flex-direction:column;gap:2px;background:var(--panel);}
.kpi-label{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);}
.kpi-val{font-size:13px;}
.kpi-tier{font-size:10px;font-weight:600;}
.constraint{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin-bottom:4px;}
.constraint svg{color:var(--brand2);}
.d-flags{grid-column:1/-1;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:13px 14px;}
.flag{display:flex;align-items:center;gap:9px;font-size:12px;padding:7px 10px;border-radius:7px;margin-top:7px;color:var(--text);}
.flag b{font-weight:600;}
.flag.red{background:rgba(242,97,87,.1);color:#FCB5AE;}.flag.red svg{color:var(--red);}
.flag.amber{background:rgba(251,191,36,.09);color:#F4D58A;}.flag.amber svg{color:var(--amber);}
.flag.green{background:rgba(52,211,153,.08);color:#9CE6CD;}.flag.green svg{color:var(--green);}
.foot{padding:18px 22px 28px;color:var(--faint);font-size:11px;border-top:1px solid var(--line2);}

.team{padding:20px 22px 40px;}
.team-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;gap:12px;flex-wrap:wrap;}
.sec-title{font-size:17px;font-weight:600;}
.sec-sub{color:var(--dim);font-size:12px;margin-top:4px;}
.sec-sub b{color:var(--text);}
.team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;}
.member{display:flex;align-items:flex-start;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;}
.member .avatar{width:40px;height:40px;border-radius:10px;font-size:14px;}
.member-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
.member-name{font-weight:600;font-size:13.5px;}
.member-role{color:var(--dim);font-size:12px;}
.member-edit{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:4px 6px;font-family:inherit;font-size:11.5px;width:100%;}
.access{font-size:10.5px;display:inline-block;padding:3px 7px;border-radius:5px;}
.access.full{color:var(--brand2);background:rgba(11,149,232,.1);}
.access.ops{color:var(--dim);background:var(--panel2);}

.overlay{position:fixed;inset:0;background:rgba(4,7,13,.66);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:50;padding:18px;}
.modal{width:100%;max-width:480px;background:var(--ink2);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 60px -12px rgba(0,0,0,.7);max-height:90vh;display:flex;flex-direction:column;}
.modal-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 18px 12px;border-bottom:1px solid var(--line2);}
.modal-title{font-size:15px;font-weight:600;}
.modal-sub{color:var(--faint);font-size:11.5px;margin-top:3px;}
.x{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:8px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;}
.x:hover{color:var(--text);}
.modal-body{padding:16px 18px;overflow-y:auto;}
.field{margin-bottom:13px;}
.field label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);margin-bottom:6px;}
.field input,.field select{width:100%;background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:13px;}
.field input:focus,.field select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(11,149,232,.18);}
.field input::placeholder{color:var(--faint);}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
.fld-seg{width:100%;}
.fld-seg button{flex:1;justify-content:center;padding:9px 8px;}
.hint{font-size:11px;color:var(--faint);margin-top:6px;line-height:1.5;background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:9px 11px;}
.modal-foot{display:flex;justify-content:flex-end;gap:9px;padding:13px 18px;border-top:1px solid var(--line2);}

@media(max-width:880px){
  .rollup{grid-template-columns:1fr 1fr;}
  .detail{grid-template-columns:1fr;}
  .thead{display:none;}
  .row,.row.csr{grid-template-columns:1fr auto;row-gap:8px;}
  .row .r{display:none;}
  .row .status{grid-column:1/-1;}
  .grid2{grid-template-columns:1fr;}
}
`;
