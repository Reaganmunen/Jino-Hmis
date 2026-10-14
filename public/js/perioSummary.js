/* ============================================================
   PERIO SUMMARY — the one place the chart totals are calculated.
   Loaded in the browser (window.PerioSummary) for the live totals,
   and required by the server (src/controllers/perioChartController.js)
   for the summary stored with each chart, so the two can never drift.

   Conventions:
     PD  = probing depth in mm (0-15)
     REC = recession in mm. Positive = gum margin has moved apical to the
           CEJ; negative = margin sits coronal to the CEJ (overgrowth).
     CAL = clinical attachment loss = PD + REC (never shown below 0).
   BOP / plaque are only counted at sites that have a PD recorded.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PerioSummary = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SITES = ['DB', 'B', 'MB', 'DL', 'L', 'ML'];

  function round1(n) { return Math.round(n * 10) / 10; }

  // Rough guide only: dentists decide the stage (it also depends on bone loss,
  // tooth loss and complexity). Based on the largest CAL recorded.
  function stageHint(maxCal) {
    if (maxCal == null || maxCal < 1) return null;
    if (maxCal <= 2) return 'I';
    if (maxCal <= 4) return 'II';
    return 'III or IV';
  }

  function compute(teeth) {
    var out = {
      teeth_missing: 0, teeth_examined: 0, sites_measured: 0,
      mean_pd: null, pd_4_5: 0, pd_6_plus: 0, pct_pd_4_plus: null,
      bop_sites: 0, bop_pct: null, plaque_sites: 0, plaque_pct: null,
      mean_cal: null, max_pd: null, max_pd_tooth: null, max_cal: null, max_cal_tooth: null,
      cal_3_plus: 0, mobile_teeth: 0, furcation_teeth: 0, stage_hint: null,
    };
    var pdSum = 0;
    var calSum = 0;

    Object.keys(teeth || {}).forEach(function (fdi) {
      var t = teeth[fdi];
      if (!t) return;
      if (t.missing) { out.teeth_missing += 1; return; }

      var any = false;
      SITES.forEach(function (s) {
        var pd = t.pd ? t.pd[s] : undefined;
        if (typeof pd !== 'number') return;
        any = true;
        out.sites_measured += 1;
        pdSum += pd;
        if (pd >= 6) out.pd_6_plus += 1; else if (pd >= 4) out.pd_4_5 += 1;
        if (t.bop && t.bop[s]) out.bop_sites += 1;
        if (t.plq && t.plq[s]) out.plaque_sites += 1;
        if (out.max_pd === null || pd > out.max_pd) { out.max_pd = pd; out.max_pd_tooth = fdi; }

        var rec = (t.rec && typeof t.rec[s] === 'number') ? t.rec[s] : 0;
        var cal = Math.max(0, pd + rec);
        calSum += cal;
        if (cal >= 3) out.cal_3_plus += 1;
        if (out.max_cal === null || cal > out.max_cal) { out.max_cal = cal; out.max_cal_tooth = fdi; }
      });

      if (any) out.teeth_examined += 1;
      if (typeof t.mob === 'number' && t.mob >= 1) out.mobile_teeth += 1;
      if (typeof t.furc === 'number' && t.furc >= 1) out.furcation_teeth += 1;
    });

    if (out.sites_measured > 0) {
      out.mean_pd = round1(pdSum / out.sites_measured);
      out.mean_cal = round1(calSum / out.sites_measured);
      out.pct_pd_4_plus = round1(((out.pd_4_5 + out.pd_6_plus) / out.sites_measured) * 100);
      out.bop_pct = round1((out.bop_sites / out.sites_measured) * 100);
      out.plaque_pct = round1((out.plaque_sites / out.sites_measured) * 100);
    }
    out.stage_hint = stageHint(out.max_cal);
    return out;
  }

  return { SITES: SITES, compute: compute, stageHint: stageHint };
}));