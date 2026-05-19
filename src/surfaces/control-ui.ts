/**
 * The control-plane web UI — a single self-contained HTML page (no framework,
 * no build step) served by the control API at `GET /`.
 *
 * It is a thin client over the control API: every action is a fetch to one of
 * the operator endpoints. Agent-supplied strings (payee, memo) are escaped
 * before they reach the DOM — an untrusted agent must not be able to inject
 * script into the operator's console.
 */

export const CONTROL_UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-wallet · control</title>
<style>
  :root {
    --bg: #0e1116; --panel: #171b22; --panel2: #1e242d; --border: #2a313c;
    --text: #e6e9ef; --muted: #8b95a5; --accent: #4f8cff;
    --danger: #ff5d5d; --ok: #3fb950; --warn: #d29922;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  code, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 22px; border-bottom: 1px solid var(--border);
    position: sticky; top: 0; background: var(--bg); z-index: 5;
  }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .sub { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  main { max-width: 1100px; margin: 0 auto; padding: 22px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px;
  }
  .card h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); margin: 0 0 12px;
  }
  .span2 { grid-column: 1 / -1; }
  .banner {
    border-radius: 10px; padding: 16px 18px; margin-bottom: 18px;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    border: 1px solid var(--border); background: var(--panel);
  }
  .banner.frozen { border-color: var(--danger); background: #2a1416; }
  .banner.live { border-color: var(--ok); }
  .banner .big { font-size: 16px; font-weight: 700; }
  .banner.frozen .big { color: var(--danger); }
  .banner.live .big { color: var(--ok); }
  .btn {
    font: inherit; cursor: pointer; border-radius: 7px; padding: 7px 13px;
    border: 1px solid var(--border); background: var(--panel2);
    color: var(--text);
  }
  .btn:hover { border-color: var(--accent); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-danger { border-color: var(--danger); color: var(--danger); }
  .btn-ok { border-color: var(--ok); color: var(--ok); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #0b1020; font-weight: 600; }
  input, select {
    font: inherit; background: var(--panel2); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px;
  }
  input:focus-visible, select:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .field { margin-bottom: 10px; }
  .row {
    border: 1px solid var(--border); border-radius: 8px; padding: 11px;
    margin-bottom: 9px; background: var(--panel2);
  }
  .row:last-child { margin-bottom: 0; }
  .row .head { display: flex; align-items: baseline; gap: 8px; }
  .row .amount { font-weight: 700; font-size: 15px; }
  .row .meta { color: var(--muted); font-size: 12px; margin-top: 3px; word-break: break-all; }
  .row .actions { margin-top: 9px; display: flex; gap: 8px; }
  .pill {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--border); color: var(--muted);
  }
  .pill.rail { color: var(--accent); border-color: var(--accent); }
  .pill.revoked { color: var(--danger); border-color: var(--danger); }
  .stat { display: flex; justify-content: space-between; padding: 5px 0; }
  .stat .v { font-weight: 700; }
  .bar { height: 6px; background: var(--panel); border-radius: 999px; margin-top: 6px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--accent); }
  .bar > i.hot { background: var(--warn); }
  .bar > i.over { background: var(--danger); }
  .empty { color: var(--muted); font-style: italic; }
  .err { color: var(--danger); font-size: 12px; min-height: 16px; }
  table.audit { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.audit td { padding: 4px 6px; border-bottom: 1px solid var(--border); }
  table.audit .t { color: var(--muted); white-space: nowrap; }
  .grow { flex: 1; min-width: 140px; }
</style>
</head>
<body>
<header>
  <h1>agent-wallet</h1>
  <span class="sub">operator control plane</span>
  <span class="spacer"></span>
  <span id="err" class="err" role="status" aria-live="polite"></span>
  <input id="token" type="password" placeholder="control token"
    aria-label="control token" style="width:150px">
  <button id="refresh" class="btn">Refresh</button>
</header>
<main>
  <div id="banner" class="banner" aria-live="polite"></div>
  <div class="grid">
    <section class="card" aria-labelledby="h-approvals">
      <h2 id="h-approvals">Approval queue</h2>
      <div id="approvals"></div>
    </section>
    <section class="card" aria-labelledby="h-report">
      <h2 id="h-report">Spend report</h2>
      <div id="report"></div>
    </section>
    <section class="card span2" aria-labelledby="h-funding">
      <h2 id="h-funding">Funding source</h2>
      <div id="funding"></div>
      <form id="new-funding" style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field grow"><label for="f-pm">Stripe payment method id</label>
          <input id="f-pm" placeholder="pm_..." required style="width:100%"></div>
        <div class="field"><label for="f-brand">brand</label>
          <input id="f-brand" placeholder="visa" style="width:90px"></div>
        <div class="field"><label for="f-last4">last 4</label>
          <input id="f-last4" placeholder="4242" style="width:80px"></div>
        <div class="field grow"><label for="f-label">label</label>
          <input id="f-label" placeholder="personal card" style="width:100%"></div>
        <div class="field"><button class="btn btn-primary" type="submit">Register</button></div>
      </form>
    </section>
    <section class="card span2" aria-labelledby="h-mandates">
      <h2 id="h-mandates">Mandates</h2>
      <div id="mandates"></div>
      <form id="new-mandate" style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px;">
        <h2>New mandate</h2>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div class="field grow"><label for="m-id">id</label>
            <input id="m-id" required style="width:100%"></div>
          <div class="field grow"><label for="m-by">granted by</label>
            <input id="m-by" required value="operator" style="width:100%"></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
          <div class="field"><label for="m-cap">cap (minor units)</label>
            <input id="m-cap" type="number" min="0" required></div>
          <div class="field"><label for="m-ccy">currency</label>
            <input id="m-ccy" value="USD" required style="width:90px"></div>
          <div class="field"><label for="m-txn">per-txn cap (optional)</label>
            <input id="m-txn" type="number" min="0"></div>
          <div class="field"><label>rails</label>
            <span><label style="display:inline; margin-right:10px;">
              <input type="checkbox" id="m-x402" checked> x402</label>
            <label style="display:inline;">
              <input type="checkbox" id="m-stripe" checked> stripe</label></span></div>
          <div class="field"><button class="btn btn-primary" type="submit">Create mandate</button></div>
        </div>
      </form>
    </section>
    <section class="card span2" aria-labelledby="h-audit">
      <h2 id="h-audit">Recent audit events</h2>
      <div id="audit"></div>
    </section>
  </div>
</main>
<script>
"use strict";
var BUSY = false;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmt(n) {
  return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
}
function shortId(s) { return s ? esc(String(s).slice(0, 8)) : "—"; }
function setErr(m) { document.getElementById("err").textContent = m; }
function getToken() { return sessionStorage.getItem("aw-token") || ""; }

async function j(method, path, body) {
  var headers = {};
  var token = getToken();
  if (token) headers["authorization"] = "Bearer " + token;
  if (body) headers["content-type"] = "application/json";
  var res = await fetch(path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw new Error("unauthorized — set the control token");
  var data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
  return data;
}

function renderBanner(status) {
  var el = document.getElementById("banner");
  if (status.frozen) {
    el.className = "banner frozen";
    el.innerHTML =
      '<span class="big">WALLET FROZEN</span>' +
      '<span class="sub">' + esc(status.reason || "no reason given") + "</span>" +
      '<span class="spacer"></span>' +
      '<button class="btn btn-ok" data-action="unfreeze">Unfreeze</button>';
  } else {
    el.className = "banner live";
    el.innerHTML =
      '<span class="big">WALLET LIVE</span>' +
      '<span class="sub">' + fmt(status.mandates) + " mandate(s) · " +
      fmt(status.pendingApprovals) + " awaiting approval</span>" +
      '<span class="spacer"></span>' +
      '<input id="freeze-reason" placeholder="reason" aria-label="freeze reason">' +
      '<button class="btn btn-danger" data-action="freeze">Freeze wallet</button>';
  }
}

function renderCart(cart) {
  if (!cart || !cart.lineItems || !cart.lineItems.length) return "";
  var merchant = (cart.merchant && (cart.merchant.name || cart.merchant.id)) || "merchant";
  var items = cart.lineItems.map(function (li) {
    var price = li.unitPrice || {};
    return '<div class="meta">&nbsp;&nbsp;· ' + esc(li.quantity) + " × " +
      esc(li.name) + "  (" + fmt(esc(price.amount)) + " " + esc(price.currency) +
      ")" + (li.category ? " — " + esc(li.category) : "") + "</div>";
  }).join("");
  return '<div class="meta">cart from ' + esc(merchant) + "</div>" + items;
}

function renderApprovals(list) {
  var el = document.getElementById("approvals");
  if (!list.length) { el.innerHTML = '<p class="empty">No payments awaiting approval.</p>'; return; }
  el.innerHTML = list.map(function (a) {
    var r = a.request || {};
    var amt = r.amount || {};
    return '<div class="row">' +
      '<div class="head"><span class="amount">' + fmt(esc(amt.amount)) + " " +
        esc(amt.currency) + '</span><span class="pill rail">' + esc(r.rail) + "</span></div>" +
      '<div class="meta">to ' + esc((r.payee && (r.payee.label || r.payee.address)) || "?") +
        (r.memo ? " · " + esc(r.memo) : "") + "</div>" +
      renderCart(r.cart) +
      '<div class="meta">' + esc(a.reason) + "</div>" +
      '<div class="actions">' +
        '<button class="btn btn-ok" data-action="approve" data-id="' + esc(a.approvalId) + '">Approve</button>' +
        '<button class="btn btn-danger" data-action="reject" data-id="' + esc(a.approvalId) + '">Reject</button>' +
      "</div></div>";
  }).join("");
}

function renderReport(rep, integrity) {
  var p = rep.payments || {};
  var ccy = rep.settledByCurrency || {};
  var ccyRows = Object.keys(ccy).map(function (c) {
    return '<div class="stat"><span>settled · ' + esc(c) + '</span><span class="v">' +
      fmt(esc(ccy[c])) + "</span></div>";
  }).join("") || '<div class="stat"><span class="empty">nothing settled yet</span></div>';
  var orders = rep.orders || [];
  var orderRows = orders.map(function (o) {
    return '<div class="meta">order ' + esc(o.orderId) + " · " +
      fmt(esc(o.amount)) + " " + esc(o.currency) + "</div>";
  }).join("");
  var integrityHtml = "";
  if (integrity) {
    integrityHtml = '<div class="stat"><span>ledger integrity</span><span class="v">' +
      (integrity.ok
        ? "verified"
        : "TAMPERED @ seq " + esc(integrity.brokenAt)) +
      "</span></div>";
  }
  document.getElementById("report").innerHTML =
    '<div class="stat"><span>settled</span><span class="v">' + fmt(p.settled || 0) + "</span></div>" +
    '<div class="stat"><span>failed</span><span class="v">' + fmt(p.failed || 0) + "</span></div>" +
    '<div class="stat"><span>denied</span><span class="v">' + fmt(p.denied || 0) + "</span></div>" +
    '<div class="stat"><span>blocked by freeze</span><span class="v">' + fmt(p.blocked || 0) + "</span></div>" +
    ccyRows +
    '<div class="stat"><span>merchant orders</span><span class="v">' + fmt(orders.length) + "</span></div>" +
    orderRows +
    integrityHtml;
}

function renderMandates(list, rep) {
  var el = document.getElementById("mandates");
  var spent = {};
  (rep.mandates || []).forEach(function (m) { spent[m.id] = m.spent; });
  if (!list.length) { el.innerHTML = '<p class="empty">No mandates. Create one below.</p>'; return; }
  el.innerHTML = list.map(function (m) {
    var cap = Number(m.cap.amount);
    var used = Number(spent[m.id] || 0);
    var pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
    var cls = pct >= 100 ? "over" : pct >= 80 ? "hot" : "";
    var rails = (m.rails || []).map(function (r) {
      return '<span class="pill rail">' + esc(r) + "</span>";
    }).join(" ");
    return '<div class="row">' +
      '<div class="head"><span class="amount mono">' + esc(m.id) + "</span>" + rails +
        (m.revoked ? '<span class="pill revoked">revoked</span>' : "") + "</div>" +
      '<div class="meta">granted by ' + esc(m.grantedBy) +
        (m.perTxnCap ? " · per-txn " + fmt(esc(m.perTxnCap.amount)) + " " + esc(m.perTxnCap.currency) : "") +
        (m.expiresAt ? " · expires " + esc(m.expiresAt) : "") + "</div>" +
      '<div class="meta">' + fmt(used) + " / " + fmt(cap) + " " + esc(m.cap.currency) + " used</div>" +
      '<div class="bar"><i class="' + cls + '" style="width:' + pct + '%"></i></div>' +
      (m.revoked ? "" : '<div class="actions"><button class="btn btn-danger" ' +
        'data-action="revoke" data-id="' + esc(m.id) + '">Revoke</button></div>') +
      "</div>";
  }).join("");
}

function renderAudit(list) {
  var el = document.getElementById("audit");
  if (!list.length) { el.innerHTML = '<p class="empty">No events yet.</p>'; return; }
  var rows = list.slice(-25).reverse().map(function (e) {
    var t = (e.at || "").slice(11, 19);
    return "<tr><td class=\\"t\\">" + esc(t) + "</td><td><span class=\\"pill\\">" +
      esc(e.type) + "</span></td><td class=\\"mono t\\">" + shortId(e.paymentId) + "</td></tr>";
  }).join("");
  el.innerHTML = '<table class="audit"><tbody>' + rows + "</tbody></table>";
}

function renderFunding(f) {
  var el = document.getElementById("funding");
  if (!f || !f.registered) {
    el.innerHTML = '<p class="empty">No funding source — register one below to enable card payments.</p>';
    return;
  }
  el.innerHTML =
    '<div class="meta">' +
    esc((f.brand || "card") + " ••" + (f.last4 || "????")) +
    (f.label ? " · " + esc(f.label) : "") + "</div>" +
    '<div class="actions"><button class="btn btn-danger" data-action="clear-funding">Remove</button></div>';
}

async function refresh() {
  try {
    var status = await j("GET", "/status");
    var report = await j("GET", "/report");
    var mandates = await j("GET", "/mandates");
    var approvals = await j("GET", "/approvals");
    var audit = await j("GET", "/audit");
    var funding = await j("GET", "/funding-source");
    var integrity = await j("GET", "/audit/verify");
    renderBanner(status);
    renderApprovals(approvals);
    renderReport(report, integrity);
    renderMandates(mandates, report);
    renderAudit(audit);
    renderFunding(funding);
    setErr("");
  } catch (e) {
    setErr(String(e.message || e));
  }
}

async function act(fn) {
  if (BUSY) return;
  BUSY = true;
  try { await fn(); await refresh(); }
  catch (e) { setErr(String(e.message || e)); }
  finally { BUSY = false; }
}

document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("button[data-action]");
  if (!btn) return;
  var action = btn.getAttribute("data-action");
  var id = btn.getAttribute("data-id");
  if (action === "freeze") {
    var input = document.getElementById("freeze-reason");
    var reason = (input && input.value.trim()) || "frozen by operator";
    act(function () { return j("POST", "/freeze", { reason: reason }); });
  } else if (action === "unfreeze") {
    act(function () { return j("POST", "/unfreeze"); });
  } else if (action === "approve") {
    act(function () { return j("POST", "/approvals/" + id + "/resolve", { approved: true }); });
  } else if (action === "reject") {
    act(function () { return j("POST", "/approvals/" + id + "/resolve", { approved: false }); });
  } else if (action === "revoke") {
    if (confirm("Revoke mandate " + id + "?")) {
      act(function () { return j("POST", "/mandates/" + id + "/revoke"); });
    }
  } else if (action === "clear-funding") {
    if (confirm("Remove the funding source?")) {
      act(function () { return j("DELETE", "/funding-source"); });
    }
  }
});

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("new-mandate").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var ccy = document.getElementById("m-ccy").value.trim();
  var rails = [];
  if (document.getElementById("m-x402").checked) rails.push("x402");
  if (document.getElementById("m-stripe").checked) rails.push("stripe");
  var mandate = {
    id: document.getElementById("m-id").value.trim(),
    grantedBy: document.getElementById("m-by").value.trim(),
    cap: { amount: document.getElementById("m-cap").value, currency: ccy },
    rails: rails
  };
  var txn = document.getElementById("m-txn").value;
  if (txn) mandate.perTxnCap = { amount: txn, currency: ccy };
  act(function () {
    return j("POST", "/mandates", mandate).then(function () {
      document.getElementById("new-mandate").reset();
    });
  });
});

document.getElementById("new-funding").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var source = {
    paymentMethodId: document.getElementById("f-pm").value.trim(),
    brand: document.getElementById("f-brand").value.trim() || undefined,
    last4: document.getElementById("f-last4").value.trim() || undefined,
    label: document.getElementById("f-label").value.trim() || undefined
  };
  act(function () {
    return j("POST", "/funding-source", source).then(function () {
      document.getElementById("new-funding").reset();
    });
  });
});

(function initToken() {
  // A token passed as ?token=... is captured, then stripped from the address
  // bar so it does not linger in history or get shoulder-surfed.
  var urlToken = new URLSearchParams(location.search).get("token");
  if (urlToken) {
    sessionStorage.setItem("aw-token", urlToken);
    history.replaceState({}, "", location.pathname);
  }
  var input = document.getElementById("token");
  input.value = getToken();
  input.addEventListener("change", function () {
    var t = input.value.trim();
    if (t) sessionStorage.setItem("aw-token", t);
    else sessionStorage.removeItem("aw-token");
    refresh();
  });
})();

refresh();
setInterval(function () { if (!BUSY) refresh(); }, 5000);
</script>
</body>
</html>`;
