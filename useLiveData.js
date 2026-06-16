// Live data hook — pulls clients, events, meta_daily from Supabase and
// derives the same per-client metrics the mock dashboard used.
import { useEffect, useState, useMemo } from "react";
import { supabase } from "./supabase.js";

export function useLiveData(periodDays) {
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - periodDays * 86400000).toISOString();
      try {
        const [cRes, eRes, mRes] = await Promise.all([
          supabase.from("clients").select("*").eq("active", true),
          supabase.from("events").select("*").gte("occurred_at", since),
          supabase.from("meta_daily").select("*").gte("date", since.slice(0, 10)),
        ]);
        if (!alive) return;
        if (cRes.error) throw cRes.error;
        if (eRes.error) throw eRes.error;
        if (mRes.error) throw mRes.error;
        setClients(cRes.data || []);
        setEvents(eRes.data || []);
        setMeta(mRes.data || []);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [periodDays]);

  // derive per-client rollups
  const rows = useMemo(() => {
    return clients.map((c) => {
      const ce = events.filter((e) => e.client_id === c.id);
      const cm = meta.filter((m) => m.client_id === c.id);

      const leads = ce.filter((e) => e.kind === "lead").length;
      const charges = ce.filter((e) => e.kind === "charge");
      const credits = ce.filter((e) => e.kind === "credit");
      const booked = charges.length;
      const showed = booked - credits.length;          // a credit = no-show; everything else showed
      const charged = charges.reduce((s, e) => s + Number(e.amount || 0), 0);
      const credited = credits.reduce((s, e) => s + Number(e.amount || 0), 0); // usually 0; included for completeness

      const spend = cm.reduce((s, m) => s + Number(m.spend || 0), 0);
      const meta_leads = cm.reduce((s, m) => s + Number(m.meta_leads || 0), 0);
      const impressions = cm.reduce((s, m) => s + Number(m.impressions || 0), 0);
      const clicks = cm.reduce((s, m) => s + Number(m.clicks || 0), 0);

      // primary lead count is Slack (LeadConnector). meta_leads is cross-check.
      const cpl = leads ? spend / leads : 0;
      const cpb = booked ? spend / booked : 0;
      const cps = showed > 0 ? spend / showed : 0;
      const showRate = booked ? showed / booked : 0;
      const bookRate = leads ? booked / leads : 0;

      // revenue = actual charges minus credited dollars (ForceCharge truth)
      const revenue = (charged - credited) + (c.type === "Retainer" || c.type === "Combo" ? Number(c.retainer || 0) : 0);
      const ourAdCost = c.we_pay_spend ? spend : 0;
      const margin = revenue - ourAdCost;
      const marginPct = revenue ? margin / revenue : 0;

      // break-even per lead, using the client's PPSA rate and the realized show rate
      const beCpl = leads ? Number(c.ppsa_rate || 0) * (showed / leads) : 0;
      const headroom = Number(c.ppsa_rate || 0) - cps;

      // pending: no spend AND no events yet
      const pending = spend === 0 && leads === 0 && booked === 0;

      return {
        ...c,
        leads, booked, showed, charged, credited,
        spend, meta_leads, impressions, clicks,
        cpl, cpb, cps, showRate, bookRate,
        revenue, ourAdCost, margin, marginPct, beCpl, headroom, pending,
        // daily series for the sparkline (margin shape)
        daily: buildDaily(ce, cm, c, periodDays),
      };
    });
  }, [clients, events, meta, periodDays]);

  return { rows, loading, error, refresh: () => setLoading((l) => l) };
}

function buildDaily(events, meta, client, days) {
  const byDay = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay[d] = { date: d, leads: 0, booked: 0, showed: 0, charged: 0, credited: 0, spend: 0 };
  }
  for (const e of events) {
    const d = (e.occurred_at || "").slice(0, 10);
    if (!byDay[d]) continue;
    if (e.kind === "lead") byDay[d].leads++;
    else if (e.kind === "charge") { byDay[d].booked++; byDay[d].charged += Number(e.amount || 0); }
    else if (e.kind === "credit") { byDay[d].credited += Number(e.amount || 0); /* a credit reverses a prior booked */ }
  }
  for (const m of meta) if (byDay[m.date]) byDay[m.date].spend = Number(m.spend || 0);
  // running daily margin estimate
  const out = Object.values(byDay).map((d) => ({
    ...d,
    showed: Math.max(0, d.booked /* - same-day no-show count not separable from credit dates */),
    margin: (d.charged - d.credited) - (client.we_pay_spend ? d.spend : 0),
  }));
  return out;
}
