// Ads campaign intelligence for Diagrams & Graphs (see css/56-chart-ads-insights.css).
//
// What it does: when an uploaded sheet looks like ad campaign data (a Spend column plus at least
// one of Impressions / Clicks / Conversions / Revenue), it finds those columns, groups rows by
// campaign, calculates CTR, CPC, CPM, CPA, conversion rate and ROAS, and writes plain-English
// insights (dead spend, money-losing campaigns, spend vs result imbalance, best campaign to scale,
// funnel problems, trend). It shows them as an "Ads performance" card at the top of the Insights
// panel and adds one-click charts (ROAS, CPA, CTR, conversion rate, spend share vs result share).
//
// It does not edit js/42-diagrams-graphs.js. It wraps two functions from it (dgOnUploadParsed and
// dgRenderInsightsStrip) and reads the upload from dgUploadParsed. To undo: remove the css and
// script lines for this file from workspace.html.
//
// The analysis part (DGAds.analyze) is pure and is covered by test/chart-ads-insights.test.js.
(function (root) {
  'use strict';

  // ───────────────────────── column detection ─────────────────────────

  function tok(h) {
    return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  }

  // Headers that already hold a ratio or a rate are never used as a base number, we calculate our own.
  var DERIVED = /(^|\s)(ctr|cpc|cpm|cpa|cpl|cpp|cpi|roas|roi|rate|per|ratio|avg|average|frequency|rank|score|share|percent|pct)(\s|$)|%/;

  var ROLE_PATTERNS = {
    spend: [/(^|\s)(spend|spent|cost|costs)(\s|$)/, /(^|\s)budget(\s|$)/],
    impressions: [/(^|\s)(impressions?|impr)(\s|$)/, /(^|\s)(views|reach)(\s|$)/],
    clicks: [/(^|\s)clicks?(\s|$)/],
    revenue: [/(^|\s)(revenue|conversion value|conv value|purchase value|purchases value|sales value|order value|income|gmv|sales amount)(\s|$)/],
    // Tried in this order, so a real "Conversions" column wins over "Leads" when a sheet has both.
    conversions: [
      /(^|\s)(conversions?|conv|results?)(\s|$)/,
      /(^|\s)(purchases?|orders?|sign ?ups?|signups?|installs?|acquisitions?|registrations?|transactions?|bookings?)(\s|$)/,
      /(^|\s)(leads?|enquiries|inquiries)(\s|$)/
    ]
  };

  var LABEL_PATTERNS = [
    /(^|\s)campaigns?(\s|$)/,
    /(^|\s)(ad ?sets?|ad ?groups?|adgroups?)(\s|$)/,
    /(^|\s)(ad name|ad|ads|creatives?)(\s|$)/,
    /(^|\s)(channels?|platforms?|sources?|mediums?|networks?|publishers?|placements?|audiences?|keywords?)(\s|$)/
  ];

  var AGG_LABEL = /^(grand\s+)?(total|subtotal|sum|overall|all campaigns|average|avg)\b/i;

  function numericShare(rows, idx, parse) {
    var seen = 0, ok = 0;
    for (var i = 0; i < rows.length && seen < 200; i++) {
      var c = rows[i][idx];
      if (c == null || String(c).trim() === '') continue;
      seen++;
      // The app reads "CAM-001" as the number 1, so an ID like that must not count as numeric.
      var txt = String(c).replace(/lakhs?|crores?|million|billion|thousand|\brs\b|\binr\b|\busd\b|\beur\b|\bgbp\b|\bcr\b/gi, '');
      if (/[a-z]{2,}/i.test(txt)) continue;
      if (isFinite(parse(c))) ok++;
    }
    return seen ? ok / seen : 0;
  }

  function detectColumns(headers, rows, h) {
    var n = headers.length, info = [];
    for (var i = 0; i < n; i++) {
      var isDate = !!(h.isDateCol && h.isDateCol(i));
      info.push({ i: i, t: tok(headers[i]), date: isDate, num: isDate ? 0 : numericShare(rows, i, h.parseNum) });
    }
    var used = {}, cols = {};
    function pick(role) {
      var pats = ROLE_PATTERNS[role];
      for (var p = 0; p < pats.length; p++) {
        for (var k = 0; k < info.length; k++) {
          var c = info[k];
          if (used[c.i] || c.date || c.num < 0.6 || DERIVED.test(c.t)) continue;
          if (pats[p].test(c.t)) { used[c.i] = true; return c.i; }
        }
      }
      return -1;
    }
    // Order matters: revenue is claimed before conversions so "Conversion value" is money, not a count.
    cols.spend = pick('spend');
    cols.revenue = pick('revenue');
    cols.impressions = pick('impressions');
    cols.clicks = pick('clicks');
    cols.conversions = pick('conversions');

    var textCols = info.filter(function (c) { return !c.date && c.num < 0.6; });
    cols.label = -1;
    for (var p = 0; p < LABEL_PATTERNS.length && cols.label < 0; p++) {
      for (var k = 0; k < textCols.length; k++) {
        if (LABEL_PATTERNS[p].test(textCols[k].t)) { cols.label = textCols[k].i; break; }
      }
    }
    if (cols.label < 0 && textCols.length) cols.label = textCols[0].i;
    var dateCol = info.filter(function (c) { return c.date; })[0];
    cols.date = dateCol ? dateCol.i : -1;
    return cols;
  }

  // ───────────────────────── metrics ─────────────────────────

  function metrics(g) {
    var m = {};
    m.ctr = (g.has.impressions && g.has.clicks && g.impressions > 0) ? g.clicks / g.impressions * 100 : null;
    m.cpc = (g.has.clicks && g.clicks > 0) ? g.spend / g.clicks : null;
    m.cpm = (g.has.impressions && g.impressions > 0) ? g.spend / g.impressions * 1000 : null;
    m.cpa = (g.has.conversions && g.conversions > 0) ? g.spend / g.conversions : null;
    m.cvr = (g.has.clicks && g.has.conversions && g.clicks > 0) ? g.conversions / g.clicks * 100 : null;
    m.roas = (g.has.revenue && g.spend > 0) ? g.revenue / g.spend : null;
    return m;
  }

  function sniffCurrency(rows, idx) {
    for (var i = 0; i < rows.length && i < 60; i++) {
      var s = String(rows[i][idx] == null ? '' : rows[i][idx]);
      var m = s.match(/[\u20B9$\u20AC\u00A3\u00A5]/);
      if (m) return m[0];
      if (/\brs\.?|\binr\b/i.test(s)) return '\u20B9';
    }
    return '';
  }

  // Many sheets put the sign in the header only, like "Spent (\u20B9)".
  function sniffHeaderCurrency(hd) {
    var t = String(hd == null ? '' : hd);
    var m = t.match(/[\u20B9$\u20AC\u00A3\u00A5]/);
    if (m) return m[0];
    return /\((rs\.?|inr)\)/i.test(t) ? '\u20B9' : '';
  }

  function makeMoney(sym) {
    return function (v) {
      if (v == null || !isFinite(v)) return '-';
      var a = Math.abs(v);
      var s = a.toLocaleString(undefined, a >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (v < 0 ? '-' : '') + sym + s;
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ───────────────────────── analysis ─────────────────────────

  // headers: string[], rows: any[][], h: { parseNum(cell), parseDate(cell), isDateCol(idx) }
  function analyze(headers, rows, h) {
    if (!headers || !rows || !rows.length) return { isAds: false, reason: 'empty' };
    var cols = detectColumns(headers, rows, h);
    var hasBase = cols.clicks >= 0 || cols.impressions >= 0 || cols.conversions >= 0 || cols.revenue >= 0;
    if (cols.spend < 0 || !hasBase) return { isAds: false, reason: 'no ad columns', cols: cols };

    var has = {
      impressions: cols.impressions >= 0, clicks: cols.clicks >= 0,
      conversions: cols.conversions >= 0, revenue: cols.revenue >= 0
    };
    var sym = sniffCurrency(rows, cols.spend) || sniffHeaderCurrency(headers[cols.spend]);
    var money = makeMoney(sym);

    var map = {}, order = [], skipped = 0, missingCells = 0, cellCount = 0, dated = [];
    function parseOrNaN(c) { return h.parseNum(c); }

    rows.forEach(function (r) {
      var label = cols.label >= 0 ? String(r[cols.label] == null ? '' : r[cols.label]).trim() : '';
      if (cols.label >= 0 && (!label || AGG_LABEL.test(label))) { skipped++; return; }
      var sp = parseOrNaN(r[cols.spend]);
      if (!isFinite(sp)) { skipped++; return; }
      var key = cols.label >= 0 ? label.toLowerCase() : '__all';
      var g = map[key];
      if (!g) {
        g = map[key] = { label: cols.label >= 0 ? label : 'All campaigns', spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, rows: 0, has: has };
        order.push(key);
      }
      g.rows++; g.spend += sp;
      ['impressions', 'clicks', 'conversions', 'revenue'].forEach(function (f) {
        if (!has[f]) return;
        cellCount++;
        var v = parseOrNaN(r[cols[f]]);
        if (isFinite(v)) g[f] += v; else missingCells++;
      });
      if (cols.date >= 0 && h.parseDate) {
        var d = h.parseDate(r[cols.date]);
        if (d) dated.push({ t: d.getTime ? d.getTime() : +d, spend: sp,
          conv: has.conversions ? (isFinite(parseOrNaN(r[cols.conversions])) ? parseOrNaN(r[cols.conversions]) : 0) : 0,
          rev: has.revenue ? (isFinite(parseOrNaN(r[cols.revenue])) ? parseOrNaN(r[cols.revenue]) : 0) : 0 });
      }
    });

    var groups = order.map(function (k) { var g = map[k]; g.m = metrics(g); return g; });
    if (!groups.length) return { isAds: false, reason: 'no usable rows', cols: cols };

    var tot = { label: 'Total', spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, has: has };
    groups.forEach(function (g) {
      tot.spend += g.spend; tot.impressions += g.impressions; tot.clicks += g.clicks;
      tot.conversions += g.conversions; tot.revenue += g.revenue;
    });
    tot.m = metrics(tot);
    groups.forEach(function (g) {
      g.spendShare = tot.spend > 0 ? g.spend / tot.spend * 100 : 0;
      g.convShare = (has.conversions && tot.conversions > 0) ? g.conversions / tot.conversions * 100 : null;
      g.revShare = (has.revenue && tot.revenue > 0) ? g.revenue / tot.revenue * 100 : null;
      g.resultShare = g.revShare != null ? g.revShare : g.convShare;
    });
    groups.sort(function (a, b) { return b.spend - a.spend; });

    var resultName = has.revenue ? 'revenue' : (has.conversions ? 'conversions' : null);

    var a = {
      isAds: true, cols: cols, has: has, sym: sym, money: money, groups: groups, total: tot,
      resultName: resultName, skippedRows: skipped, missingPct: cellCount ? missingCells / cellCount * 100 : 0,
      headers: headers, hasLabel: cols.label >= 0, dated: dated.length
    };
    a.insights = buildInsights(a, dated);
    a.notes = buildNotes(a);
    return a;
  }

  function judgeable(a, g) {
    var t = a.total;
    if (!(t.spend > 0) || g.spend < 0.03 * t.spend) return false;
    if (a.has.conversions) return g.conversions >= 5;
    if (a.has.clicks) return g.clicks >= 30;
    return true;
  }

  function buildInsights(a, dated) {
    var out = [], t = a.total, M = a.money, groups = a.groups, has = a.has;
    var many = groups.length > 1;
    function add(kind, rank, html) { out.push({ kind: kind, rank: rank, html: html }); }
    function names(list) {
      var l = list.slice(0, 3).map(function (g) { return '<b>' + esc(g.label) + '</b>'; });
      if (list.length > 3) l.push((list.length - 3) + ' more');
      return l.join(', ');
    }
    var x = function (v) { return (Math.round(v * 100) / 100).toFixed(2) + 'x'; };
    var p0 = function (v) { return Math.round(v) + '%'; };

    // 1) Dead spend: real money, nothing back.
    if (many && (has.conversions || has.revenue)) {
      var dead = groups.filter(function (g) {
        var zero = has.conversions ? g.conversions === 0 : g.revenue === 0;
        return zero && g.spendShare >= 5;
      });
      if (dead.length) {
        var deadSpend = dead.reduce(function (s, g) { return s + g.spend; }, 0);
        add('bad', 1, 'Spend with no ' + (has.conversions ? 'conversions' : 'revenue') + ': ' + names(dead) +
          ' used ' + M(deadSpend) + ' (' + p0(deadSpend / t.spend * 100) + ' of total spend) and returned nothing. Pause or rework these first.');
      }
    }

    // 2) Losing money.
    if (has.revenue) {
      var losing = groups.filter(function (g) { return g.m.roas != null && g.m.roas < 1 && g.revenue > 0 && g.spendShare >= 5; });
      if (losing.length) {
        var w = losing.slice().sort(function (p, q) { return p.m.roas - q.m.roas; })[0];
        add('bad', 2, '<b>' + esc(w.label) + '</b> returns ' + M(w.m.roas) + ' for every ' + (a.sym || '') + '1 spent (ROAS ' + x(w.m.roas) +
          '). At these numbers it loses money before any other cost.' + (losing.length > 1 ? ' ' + (losing.length - 1) + ' other campaign' + (losing.length > 2 ? 's are' : ' is') + ' also under 1.00x.' : ''));
      } else if (t.m.roas != null && t.m.roas < 1 && t.spend > 0) {
        add('bad', 2, 'Overall ROAS is ' + x(t.m.roas) + ': the account returns less revenue than it spends.');
      }
    }

    // 3) Spend vs result imbalance and under-funded winners.
    if (many && a.resultName) {
      var j = groups.filter(function (g) { return judgeable(a, g) && g.resultShare != null; });
      var heavy = j.filter(function (g) { return g.spendShare - g.resultShare >= 5 && g.spendShare >= 1.5 * Math.max(g.resultShare, 0.1); })
        .sort(function (p, q) { return (q.spendShare - q.resultShare) - (p.spendShare - p.resultShare); });
      if (heavy.length) {
        var hv = heavy[0];
        add('warn', 3, '<b>' + esc(hv.label) + '</b> takes ' + p0(hv.spendShare) + ' of spend but brings only ' + p0(hv.resultShare) +
          ' of ' + a.resultName + '. Moving part of its budget to stronger campaigns is the quickest win here.');
      }
      var star = j.filter(function (g) { return g.resultShare - g.spendShare >= 5 && g.resultShare >= 1.5 * g.spendShare; })
        .sort(function (p, q) { return (q.resultShare - q.spendShare) - (p.resultShare - p.spendShare); })[0];
      if (star) {
        add('good', 4, '<b>' + esc(star.label) + '</b> brings ' + p0(star.resultShare) + ' of ' + a.resultName + ' on ' + p0(star.spendShare) +
          ' of spend. It is under-funded for how well it performs, so it is the first one to scale.');
      }
    }

    // 4) Best performer (only when it is a fair comparison).
    if (many) {
      var jj = groups.filter(function (g) { return judgeable(a, g); });
      if (jj.length >= 2) {
        if (has.revenue) {
          var br = jj.filter(function (g) { return g.m.roas != null; }).sort(function (p, q) { return q.m.roas - p.m.roas; })[0];
          if (br && t.m.roas != null && br.m.roas > t.m.roas * 1.1) {
            add('good', 5, 'Best return: <b>' + esc(br.label) + '</b> at ROAS ' + x(br.m.roas) + ', against ' + x(t.m.roas) + ' across everything.');
          }
        } else if (has.conversions) {
          var bc = jj.filter(function (g) { return g.m.cpa != null; }).sort(function (p, q) { return p.m.cpa - q.m.cpa; })[0];
          if (bc && t.m.cpa != null && bc.m.cpa < t.m.cpa * 0.9) {
            add('good', 5, 'Cheapest conversions: <b>' + esc(bc.label) + '</b> at ' + M(bc.m.cpa) + ' each, against ' + M(t.m.cpa) + ' overall.');
          }
        }
        // 5) CPA spread.
        if (has.conversions) {
          var cp = jj.filter(function (g) { return g.m.cpa != null; }).sort(function (p, q) { return p.m.cpa - q.m.cpa; });
          if (cp.length >= 2) {
            var lo = cp[0], hi = cp[cp.length - 1];
            if (lo.m.cpa > 0 && hi.m.cpa / lo.m.cpa >= 2) {
              add('info', 6, 'Cost per conversion ranges from ' + M(lo.m.cpa) + ' (<b>' + esc(lo.label) + '</b>) to ' + M(hi.m.cpa) +
                ' (<b>' + esc(hi.label) + '</b>), about ' + (Math.round(hi.m.cpa / lo.m.cpa * 10) / 10) + 'x apart.');
            }
          }
        }
        // 6) Funnel diagnosis against the blended numbers.
        if (has.clicks && has.impressions) {
          var clickNoConv = has.conversions ? jj.filter(function (g) {
            return g.m.ctr != null && g.m.cvr != null && t.m.ctr && t.m.cvr && g.m.ctr >= 1.25 * t.m.ctr && g.m.cvr <= 0.6 * t.m.cvr;
          }).sort(function (p, q) { return q.spend - p.spend; }) : [];
          if (clickNoConv.length) {
            add('warn', 7, names(clickNoConv) + ' gets clicks well above average but converts well below it. The ad is doing its job, so look at the landing page or the offer.');
          }
          var weakAd = jj.filter(function (g) {
            return g.m.ctr != null && g.m.cpm != null && t.m.ctr && t.m.cpm && g.m.ctr <= 0.6 * t.m.ctr && g.m.cpm >= 0.9 * t.m.cpm;
          }).sort(function (p, q) { return q.spend - p.spend; });
          if (weakAd.length) {
            add('warn', 8, names(weakAd) + ' pays a normal price to be shown but few people click. Test a new creative or headline.');
          }
        }
      }
    }

    // 7) Trend over time (first half of dated rows vs second half).
    if (dated.length >= 8) {
      var d = dated.slice().sort(function (p, q) { return p.t - q.t; });
      var mid = Math.floor(d.length / 2), A = { s: 0, c: 0, r: 0 }, B = { s: 0, c: 0, r: 0 };
      d.forEach(function (r, i) { var T = i < mid ? A : B; T.s += r.spend; T.c += r.conv; T.r += r.rev; });
      if (has.revenue && A.s > 0 && B.s > 0 && A.r > 0) {
        var r1 = A.r / A.s, r2 = B.r / B.s, ch = (r2 - r1) / r1 * 100;
        if (Math.abs(ch) >= 15) add(ch > 0 ? 'good' : 'warn', 9, 'ROAS ' + (ch > 0 ? 'improved ' : 'dropped ') + p0(Math.abs(ch)) + ' in the second half of the period (' + x(r1) + ' to ' + x(r2) + ').');
      } else if (has.conversions && A.c > 0 && B.c > 0 && A.s > 0 && B.s > 0) {
        var c1 = A.s / A.c, c2 = B.s / B.c, cc = (c2 - c1) / c1 * 100;
        if (Math.abs(cc) >= 15) add(cc < 0 ? 'good' : 'warn', 9, 'Cost per conversion ' + (cc < 0 ? 'fell ' : 'rose ') + p0(Math.abs(cc)) + ' in the second half of the period (' + M(c1) + ' to ' + M(c2) + ').');
      }
    }

    var sev = { bad: 0, warn: 1, good: 2, info: 3 };
    out.sort(function (p, q) { return (sev[p.kind] - sev[q.kind]) || (p.rank - q.rank); });
    return out.slice(0, 6);
  }

  function buildNotes(a) {
    var n = [], has = a.has;
    if (!has.conversions && !has.revenue) n.push('No Conversions or Revenue column found, so CPA and ROAS are skipped. Add one to unlock them.');
    else if (!has.revenue) n.push('No Revenue column found, so ROAS is skipped.');
    else if (!has.conversions) n.push('No Conversions column found, so CPA and conversion rate are skipped.');
    if (!has.impressions && has.clicks) n.push('No Impressions column found, so CTR and CPM are skipped.');
    if (!a.hasLabel) n.push('No campaign column found, so everything is read as one campaign.');
    if (a.skippedRows) n.push(a.skippedRows + ' row' + (a.skippedRows === 1 ? '' : 's') + ' left out (blank names, totals, or no spend value).');
    if (a.missingPct >= 20) n.push(Math.round(a.missingPct) + '% of the number cells were empty and counted as zero. Check the sheet.');
    if (a.groups.length === 1 && a.hasLabel) n.push('Only one campaign found. Upload more than one to compare.');
    return n;
  }

  // ───────────────────────── browser UI ─────────────────────────

  var state = { src: null, analysis: null };

  function fmtRatio(v) { return v == null ? '-' : (Math.round(v * 100) / 100).toFixed(2) + 'x'; }
  function fmtPct(v) { return v == null ? '-' : (Math.round(v * 100) / 100).toFixed(2) + '%'; }
  function fmtInt(v) { return Math.round(v).toLocaleString(); }

  function currentUpload() {
    try { return (typeof dgUploadParsed !== 'undefined') ? dgUploadParsed : null; } catch (e) { return null; }
  }

  function helpers() {
    return {
      parseNum: function (c) { return typeof dgParseNumericCell === 'function' ? dgParseNumericCell(c) : parseFloat(c); },
      parseDate: function (c) { return typeof dgParseDateCell === 'function' ? dgParseDateCell(c) : null; },
      isDateCol: function (i) { return typeof dgColumnIsDate === 'function' ? !!dgColumnIsDate(i) : false; }
    };
  }

  function ensureAnalysis() {
    var up = currentUpload();
    if (!up) { state.src = null; state.analysis = null; return null; }
    if (state.src === up && state.analysis) return state.analysis;
    state.src = up;
    try { state.analysis = analyze(up.headers, up.rows, helpers()); }
    catch (e) { if (root.console) console.warn('Ads analysis failed', e); state.analysis = { isAds: false, reason: 'error' }; }
    return state.analysis;
  }

  function cardHtml(a) {
    var M = a.money, t = a.total, tm = t.m, has = a.has;
    var tiles = [['Spend', M(t.spend)]];
    if (has.conversions) tiles.push(['Conversions', fmtInt(t.conversions)]);
    if (tm.cpa != null) tiles.push(['Cost / conv.', M(tm.cpa)]);
    if (tm.roas != null) tiles.push(['ROAS', fmtRatio(tm.roas)]);
    if (tm.ctr != null) tiles.push(['CTR', fmtPct(tm.ctr)]);
    if (tm.cpc != null) tiles.push(['CPC', M(tm.cpc)]);
    tiles = tiles.slice(0, 6);

    var btns = [];
    if (a.groups.some(function (g) { return g.m.roas != null; })) btns.push(['roas', 'ROAS']);
    if (a.groups.some(function (g) { return g.m.cpa != null; })) btns.push(['cpa', 'Cost per conv.']);
    if (a.groups.some(function (g) { return g.m.ctr != null; })) btns.push(['ctr', 'CTR']);
    if (a.groups.some(function (g) { return g.m.cvr != null; })) btns.push(['cvr', 'Conv. rate']);
    if (a.groups.length > 1 && a.resultName) btns.push(['share', 'Spend vs ' + (a.resultName === 'revenue' ? 'revenue' : 'results')]);

    var headline = M(t.spend) + ' spent' + (a.hasLabel ? ' across ' + a.groups.length + ' campaign' + (a.groups.length === 1 ? '' : 's') : '') +
      (has.conversions ? ', ' + fmtInt(t.conversions) + ' conversions' + (tm.cpa != null ? ' at ' + M(tm.cpa) + ' each' : '') : '') +
      (tm.roas != null ? ', ROAS ' + fmtRatio(tm.roas) : '') + '.';

    return '' +
      '<div class="dg-ads-head"><span class="dg-ads-badge">Ads campaign data</span><span class="dg-ads-headline">' + esc(headline) + '</span></div>' +
      '<div class="dg-ads-tiles">' + tiles.map(function (t2) { return '<div class="dg-ads-tile"><span>' + esc(t2[0]) + '</span><b>' + esc(t2[1]) + '</b></div>'; }).join('') + '</div>' +
      (a.insights.length ? '<div class="dg-ads-list">' + a.insights.map(function (i) { return '<div class="dg-ads-ins ' + i.kind + '">' + i.html + '</div>'; }).join('') + '</div>'
        : '<div class="dg-ads-ins info">Nothing stands out yet. The campaigns perform within a similar range, or there is not enough volume to judge them fairly.</div>') +
      (btns.length ? '<div class="dg-ads-actions"><span>Chart it</span>' + btns.map(function (b) { return '<button type="button" onclick="DGAds.chart(\'' + b[0] + '\')">' + esc(b[1]) + '</button>'; }).join('') + '</div>' : '') +
      (a.notes.length ? '<div class="dg-ads-notes">' + a.notes.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('') + '</div>' : '');
  }

  function renderCard() {
    var scroll = document.querySelector('#dgInsightsPanel .dg-insights-scroll');
    if (!scroll) return;
    var a = ensureAnalysis();
    var card = document.getElementById('dgAdsCard');
    if (!a || !a.isAds) { if (card) card.remove(); return; }
    var sub = document.getElementById('dgInsightsHeadSub');
    if (sub) sub.textContent = 'Detected as Ads campaign data';
    if (card && card.getAttribute('data-ads-src') === String(a.groups.length + ':' + a.total.spend) && card.parentNode === scroll && card.__a === a) return;
    if (!card) {
      card = document.createElement('div');
      card.id = 'dgAdsCard';
      card.className = 'dg-ads-card';
    }
    card.__a = a;
    card.setAttribute('data-ads-src', String(a.groups.length + ':' + a.total.spend));
    card.innerHTML = cardHtml(a);
    if (card.parentNode !== scroll) scroll.insertBefore(card, scroll.firstChild);
  }

  function setFormat(fmt, a) {
    var sel = document.getElementById('dgFormatSelect');
    if (typeof dgState !== 'undefined') {
      if (fmt === 'currency') {
        if (a.sym) dgState.currencySymbol = a.sym; else fmt = 'plain';
      }
      dgState.formatUserSet = true;
    }
    if (sel) sel.value = fmt;
    if (typeof dgSyncFormatUI === 'function') dgSyncFormatUI();
  }

  function setTitle(t) {
    var el = document.getElementById('dgTitleInput');
    if (el) el.value = t;
    if (typeof dgState !== 'undefined') dgState.title = t;
  }

  var GROUPED = ['grouped', 'hstacked', 'tornado', '3d-grouped-bar'];

  function chart(kind) {
    var a = state.analysis;
    if (!a || !a.isAds || typeof dgState === 'undefined') return;
    var scheme = (typeof dgCurrentScheme === 'function') ? dgCurrentScheme() : ['#4E7DA6'];

    if (kind === 'share') {
      var list = a.groups.filter(function (g) { return g.resultShare != null; }).slice(0, 12);
      if (list.length < 2) return;
      var rn = a.resultName === 'revenue' ? 'revenue' : 'conversions';
      dgState.groupedCategories = list.map(function (g) { return g.label; });
      dgState.groupedSeries = [
        { name: 'Share of spend %', color: scheme[0], values: list.map(function (g) { return Math.round(g.spendShare * 10) / 10; }) },
        { name: 'Share of ' + rn + ' %', color: scheme[1 % scheme.length], values: list.map(function (g) { return Math.round(g.resultShare * 10) / 10; }) }
      ];
      setFormat('percent', a);
      setTitle('Share of spend vs share of ' + rn);
      if (GROUPED.indexOf(dgState.type) === -1) dgSetType('grouped'); else dgRender();
      if (typeof toast === 'function') toast('A campaign whose spend bar is taller than its ' + rn + ' bar is taking more than it gives back', 'info');
      return;
    }

    var def = {
      roas: { title: 'ROAS by campaign (return on ad spend, %)', fmt: 'percent', val: function (g) { return g.m.roas == null ? null : Math.round(g.m.roas * 1000) / 10; } },
      cpa: { title: 'Cost per conversion by campaign', fmt: 'currency', val: function (g) { return g.m.cpa == null ? null : Math.round(g.m.cpa * 100) / 100; } },
      ctr: { title: 'Click-through rate by campaign', fmt: 'percent', val: function (g) { return g.m.ctr == null ? null : Math.round(g.m.ctr * 100) / 100; } },
      cvr: { title: 'Conversion rate by campaign', fmt: 'percent', val: function (g) { return g.m.cvr == null ? null : Math.round(g.m.cvr * 100) / 100; } }
    }[kind];
    if (!def) return;
    var items = a.groups.map(function (g) { return { g: g, v: def.val(g) }; }).filter(function (x) { return x.v != null; });
    if (!items.length) return;
    items.sort(function (p, q) { return q.v - p.v; });
    var cut = items.length > 30;
    items = items.slice(0, 30);
    // Leaving a grouped view first, because dgSetType copies grouped data back into rows when it switches.
    if (GROUPED.indexOf(dgState.type) !== -1) dgSetType('bar');
    dgState.sameColorMode = false;
    var same = document.getElementById('dgSameColorToggle'); if (same) same.checked = false;
    dgState.rows = items.map(function (x, i) { return { label: x.g.label, value: x.v, color: scheme[i % scheme.length] }; });
    setFormat(def.fmt, a);
    setTitle(def.title);
    dgRender();
    if (typeof toast === 'function') toast(def.title + (cut ? ' (top 30 by spend)' : ''), 'success');
  }

  function wrap(name, after) {
    var orig = root[name];
    if (typeof orig !== 'function' || orig.__adsWrapped) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { after(); } catch (e) { if (root.console) console.warn('Ads insights', e); }
      return r;
    };
    w.__adsWrapped = true;
    root[name] = w;
  }

  function init() {
    wrap('dgOnUploadParsed', renderCard);
    wrap('dgRenderInsightsStrip', renderCard);
    renderCard();
  }

  var api = { analyze: analyze, detectColumns: detectColumns, chart: chart, refresh: renderCard };
  root.DGAds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
