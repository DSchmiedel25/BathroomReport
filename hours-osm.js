/* OSM opening_hours -> the app's canonical day string.
 *
 * WHY THIS EXISTS
 * The ~56,000 public-restroom records carry their hours in metroInfo.hoursRaw, in OpenStreetMap's
 * opening_hours syntax. The popup printed that text verbatim and nothing else ever read it, so
 * every one of those pins was "unknown" to isLocationOpenNow — including 232 tagged plainly as
 * 24/7. The list, the open-now filter and Bathroom Now's ranking all treat unknown as a separate
 * third state, so those pins sank below locations we knew far less about.
 *
 * This module translates that text into the SAME canonical vocabulary the chain records already
 * use — "24", "HHMM-HHMM", "closed", or null for unknown — so nothing downstream has to change.
 * isLocationOpenNow, formatHrsDisplay and the 150-mile device-clock guard all work unmodified.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 * The grammar is only partly machine-readable. Roughly one value in eight is free text
 * ("during baseball games", "It's a school"), a bare season with no times ("Apr-Oct"), or an
 * explicit "unknown". Those return null and stay honestly unknown. A parser that guessed at them
 * would put a confident "Open now" on a locked school bathroom, which is worse than saying
 * nothing. When any token in a value is unrecognised the WHOLE value returns null rather than
 * parsing the part it understood — a half-understood rule list is how you end up applying
 * Monday's hours on a Sunday.
 */
(function (root) {
  'use strict';

  var DAYS = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var SOLAR = { sunrise: 1, sunset: 1, dawn: 1, dusk: 1 };

  function pad4(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? '0' : '') + h + (m < 10 ? '0' : '') + m;
  }

  /* ---- solar geometry -----------------------------------------------------
   * Sunrise/sunset for a date and position, returned as a UTC timestamp. NOAA's low-precision
   * equations; good to about a minute, which is far finer than "is this park toilet open".
   *
   * The result is read back through the DEVICE clock, exactly like every other timed window in
   * the app. That is only sound while the device is near the location, which is precisely what
   * OPEN_NOW_CONFIDENT_MILES already enforces on any HHMM-HHMM value — so solar hours inherit
   * that guard for free instead of needing their own.
   */
  function solarUTC(date, lat, lng, zenithDeg, wantRise) {
    var rad = Math.PI / 180;
    var start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    var dayOfYear = Math.floor((start - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);

    var lngHour = lng / 15;
    var t = dayOfYear + ((wantRise ? 6 : 18) - lngHour) / 24;

    var M = (0.9856 * t) - 3.289;                                  // mean anomaly
    var L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = ((L % 360) + 360) % 360;                                   // true longitude

    var RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    // Right ascension must land in the same quadrant as L.
    RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
    RA /= 15;

    var sinDec = 0.39782 * Math.sin(L * rad);
    var cosDec = Math.cos(Math.asin(sinDec));

    var cosH = (Math.cos(zenithDeg * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
    // Polar day or polar night — the sun never crosses the horizon here today.
    if (cosH > 1 || cosH < -1) return null;

    var H = wantRise ? 360 - (Math.acos(cosH) / rad) : (Math.acos(cosH) / rad);
    H /= 15;

    var T = H + RA - (0.06571 * t) - 6.622;
    var UT = ((T - lngHour) % 24 + 24) % 24;
    return start + Math.round(UT * 3600000);
  }

  /* Solar event as minutes past midnight on the DEVICE clock, or null when it can't be placed.
   *
   * The equations return a UTC time-of-day, which loses the day when the event falls on the other
   * side of UTC midnight from the local date — a US sunset in summer is past 00:00 UTC, so a
   * naive read placed every one of them on the previous evening. Testing the three neighbouring
   * days and keeping the one whose LOCAL date matches fixes it in both directions and costs
   * nothing.
   */
  function solarMinutes(word, date, lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var rise = (word === 'sunrise' || word === 'dawn');
    // Civil twilight for dawn/dusk (sun 6 deg below horizon); standard refraction for sun up/down.
    var zenith = (word === 'dawn' || word === 'dusk') ? 96 : 90.833;
    var ts = solarUTC(date, lat, lng, zenith, rise);
    if (ts == null) return null;
    for (var k = -1; k <= 1; k++) {
      var d = new Date(ts + k * 86400000);
      if (d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() &&
          d.getDate() === date.getDate()) {
        return d.getHours() * 60 + d.getMinutes();
      }
    }
    // Near the poles the event may genuinely not occur on this local date.
    return null;
  }

  /* ---- token parsers ---- */

  // "08:30" -> 510, "sunrise" -> solar, "24:00" -> 1440. Returns null on anything else.
  function parseTime(tok, ctx) {
    tok = tok.trim().toLowerCase();
    /* Solar words are computed in the DEVICE's timezone, which is a different and weaker
     * assumption than the one clock hours make. "06:00-22:00" is the location's own text and is
     * merely COMPARED against the device clock; "sunrise-sunset" is a number this code GENERATES
     * from the device clock, so with the device in the wrong zone the window itself is wrong —
     * an Albany sunset renders as 00:13 to a browser set to UTC, and that then gets displayed.
     * So solar resolves only when the caller confirms the device is genuinely near the location.
     */
    if (SOLAR[tok]) return ctx.solarOk ? solarMinutes(tok, ctx.date, ctx.lat, ctx.lng) : null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(tok);
    if (!m) return null;
    var h = +m[1], min = +m[2];
    if (h > 24 || min > 59) return null;
    if (h === 24 && min > 0) return null;   // 24:01 is not a time
    return h * 60 + min;
  }

  // "Mo-Su", "Fr,Sa", "Mo-Fr,Su", "PH". Returns a Set of weekday numbers, or null if not a
  // weekday selector at all. PH contributes no days — we can't know the holiday calendar.
  function parseDays(tok) {
    var out = {}, any = false;
    var parts = tok.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim().toLowerCase();
      if (!p) return null;
      if (p === 'ph' || p === 'sh') { any = true; continue; }   // recognised, matches nothing
      var range = /^(su|mo|tu|we|th|fr|sa)\s*-\s*(su|mo|tu|we|th|fr|sa)$/.exec(p);
      if (range) {
        var a = DAYS[range[1]], b = DAYS[range[2]];
        for (var d = a; ; d = (d + 1) % 7) { out[d] = true; if (d === b) break; }
        any = true;
        continue;
      }
      if (DAYS[p] === undefined) return null;
      out[DAYS[p]] = true;
      any = true;
    }
    return any ? out : null;
  }

  // "Apr-Oct", "Mar 1-Oct 31", "Nov 01-Apr 30" (wraps the year), "May". Returns
  // {from:{m,d}, to:{m,d}} or null if this isn't a month selector.
  function parseMonths(tok) {
    var s = tok.trim().toLowerCase().replace(/\s*-\s*/g, '-');
    var one = /^([a-z]{3})(?:\s+(\d{1,2}))?$/;
    var two = /^([a-z]{3})(?:\s+(\d{1,2}))?-([a-z]{3})(?:\s+(\d{1,2}))?$/;
    var m = two.exec(s);
    if (m) {
      if (!MONTHS[m[1]] || !MONTHS[m[3]]) return null;
      return {
        from: { m: MONTHS[m[1]], d: m[2] ? +m[2] : 1 },
        to: { m: MONTHS[m[3]], d: m[4] ? +m[4] : 31 }
      };
    }
    m = one.exec(s);
    if (m && MONTHS[m[1]]) {
      return {
        from: { m: MONTHS[m[1]], d: m[2] ? +m[2] : 1 },
        to: { m: MONTHS[m[1]], d: m[2] ? +m[2] : 31 }
      };
    }
    return null;
  }

  function inMonthRange(range, date) {
    var cur = (date.getMonth() + 1) * 100 + date.getDate();
    var from = range.from.m * 100 + range.from.d;
    var to = range.to.m * 100 + range.to.d;
    return (from <= to) ? (cur >= from && cur <= to) : (cur >= from || cur <= to);
  }

  /* ---- rule splitting ----
   * Rules are separated by ';'. A comma ALSO separates rules in sloppy real-world values
   * ("Mo-Sa 05:00-22:00,Su 10:00-20:00"), but a comma means something else inside a weekday list
   * ("Fr,Sa 09:00-17:00") and inside a time list ("00:00-13:00,14:00-24:00"). The distinguisher
   * that holds across the live data: split only when the text BEFORE the comma already contains a
   * time and the text AFTER it starts with a weekday. Both other uses fail one of those tests.
   */
  function splitRules(str) {
    var chunks = str.split(';');
    var out = [];
    for (var i = 0; i < chunks.length; i++) {
      var buf = '', c = chunks[i];
      var pieces = c.split(',');
      for (var j = 0; j < pieces.length; j++) {
        var candidate = buf ? buf + ',' + pieces[j] : pieces[j];
        var breakHere = j < pieces.length - 1 &&
          /\d{1,2}:\d{2}|sunrise|sunset|dawn|dusk/i.test(candidate) &&
          /^\s*(su|mo|tu|we|th|fr|sa|ph)\b/i.test(pieces[j + 1]);
        buf = candidate;
        if (breakHere) { out.push(buf); buf = ''; }
      }
      if (buf.trim()) out.push(buf);
    }
    return out;
  }

  /* ---- one rule ----
   * Returns {days, months, value} where value is '24' | 'HHMM-HHMM' | 'closed' | 'unknown',
   * or null when the rule contains anything this parser does not recognise.
   */
  function parseRule(rule, ctx) {
    var s = rule.trim();
    if (!s) return null;

    var months = null, days = null;

    /* Leading month/date selector.
     *
     * The day-of-month lookahead is load-bearing: without it "Apr-Oct 07:00-19:00" parsed as
     * "Apr - Oct 7" and swallowed the opening hour as a date, leaving ":00-19:00" behind and
     * failing the whole value. A day number is never followed by a colon; an hour always is.
     */
    var DNUM = '(?:\\s+\\d{1,2}(?!\\s*:))?';
    var mMatch = new RegExp('^((?:[A-Za-z]{3}' + DNUM + ')\\s*-\\s*(?:[A-Za-z]{3}' + DNUM + ')|[A-Za-z]{3}\\s+\\d{1,2}(?!\\s*:))\\s*:?\\s*').exec(s);
    if (mMatch) {
      var mr = parseMonths(mMatch[1]);
      if (mr) { months = mr; s = s.slice(mMatch[0].length).trim(); }
    }
    if (!months) {
      var bare = /^([A-Za-z]{3})\s*:?\s+/.exec(s);
      if (bare && MONTHS[bare[1].toLowerCase()]) {
        months = parseMonths(bare[1]);
        s = s.slice(bare[0].length).trim();
      }
    }

    // Weekday selector.
    var dMatch = /^((?:su|mo|tu|we|th|fr|sa|ph|sh)(?:\s*-\s*(?:su|mo|tu|we|th|fr|sa))?(?:\s*,\s*(?:su|mo|tu|we|th|fr|sa|ph|sh)(?:\s*-\s*(?:su|mo|tu|we|th|fr|sa))?)*)\b\s*/i.exec(s);
    if (dMatch) {
      var dr = parseDays(dMatch[1]);
      if (dr) { days = dr; s = s.slice(dMatch[0].length).trim(); }
    }

    s = s.replace(/\s*:\s*$/, '').trim();
    var low = s.toLowerCase();

    // Bare state keywords.
    if (low === 'off' || low === 'closed') return { days: days, months: months, value: 'closed' };
    if (low === 'unknown' || low === '') return { days: days, months: months, value: 'unknown' };
    // "open" with no times means open, hours unspecified — that is unknown, not 24 hours.
    if (low === 'open') return { days: days, months: months, value: 'unknown' };

    if (low === '24/7' || low === '00:00-24:00') return { days: days, months: months, value: '24' };

    // Open-ended ("10:00+") has no closing time, so no verdict is possible.
    if (/\+\s*$/.test(low)) return { days: days, months: months, value: 'unknown' };

    // Trailing state after the times, e.g. "08:00-19:30 open".
    var tail = /\s+(off|closed|open|unknown)$/.exec(low);
    if (tail) {
      if (tail[1] === 'off' || tail[1] === 'closed') return { days: days, months: months, value: 'closed' };
      low = low.slice(0, tail.index).trim();
    }

    // Time ranges. More than one window a day cannot be said in the canonical single-window
    // format, so those stay unknown rather than being flattened into a span that claims the
    // location is open through its midday closure.
    var ranges = low.split(',');
    if (ranges.length > 1) {
      for (var k = 0; k < ranges.length; k++) {
        if (!/^\s*[\d:]+\s*-\s*[\d:]+\s*$/.test(ranges[k])) return null;
      }
      return { days: days, months: months, value: 'unknown' };
    }

    var parts = low.split('-');
    if (parts.length !== 2) return null;
    var openTok = parts[0].trim(), closeTok = parts[1].trim();
    var open = parseTime(openTok, ctx);
    var close = parseTime(closeTok, ctx);
    // A solar word we could not place (polar day/night, or no coordinates) is unknown, not a
    // parse failure — the rest of the value is still sound.
    if (open === null || close === null) {
      if (SOLAR[openTok] || SOLAR[closeTok]) {
        return { days: days, months: months, value: 'unknown' };
      }
      return null;
    }
    if (open === close) return { days: days, months: months, value: 'unknown' };
    /* A solar endpoint is carried through so the UI can say "Sunrise to sunset" rather than a
     * clock time. The exact minute is real and drives the open/closed verdict, but printing
     * "8:13 PM" implies a fixed closing time that does not exist — it moves every day, and by
     * over three hours across the year. The words are the honest label. */
    var solar = null;
    if (SOLAR[openTok] || SOLAR[closeTok]) {
      solar = {
        open: SOLAR[openTok] ? openTok : null,
        close: SOLAR[closeTok] ? closeTok : null
      };
    }
    if (open === 0 && (close === 1440 || close === 1439)) return { days: days, months: months, value: '24' };
    return {
      days: days, months: months, solar: solar,
      value: pad4(open % 1440) + '-' + pad4(close % 1440)
    };
  }

  /* ---- public entry point ----
   * raw  : the metroInfo.hoursRaw string
   * opts : { date, lat, lng, solarOk }
   *        date    defaults to now
   *        lat/lng the location's coordinates, needed for solar words
   *        solarOk true only when the caller has confirmed the device is near the location
   *                (see the note in parseTime); solar words stay unknown without it
   * returns { value, label }
   *   value : "24" | "HHMM-HHMM" | "closed" | null
   *   label : a display string when the window has a solar endpoint ("Sunrise to sunset"),
   *           otherwise null and the caller formats the clock times as usual
   */
  function todayDetail(raw, opts) {
    var NONE = { value: null, label: null };
    if (raw == null) return NONE;
    var s = String(raw).trim();
    if (!s) return NONE;
    opts = opts || {};
    var ctx = {
      date: opts.date || new Date(),
      lat: Number(opts.lat),
      lng: Number(opts.lng),
      solarOk: !!opts.solarOk
    };

    // Strip quoted comments. A value that is ENTIRELY a comment ("closed in winter") carries no
    // machine-readable hours at all and must stay unknown.
    var hadQuote = s.indexOf('"') !== -1;
    if (hadQuote) s = s.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return NONE;

    if (s.toLowerCase() === '24/7') return { value: '24', label: null };

    // Anything with letters that aren't part of the recognised vocabulary is prose, not a
    // schedule. Catching it here keeps free text out of the rule parser entirely.
    var words = s.toLowerCase().match(/[a-z]+/g) || [];
    var ALLOWED = /^(su|mo|tu|we|th|fr|sa|ph|sh|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sunrise|sunset|dawn|dusk|off|open|closed|unknown)$/;
    for (var w = 0; w < words.length; w++) {
      if (!ALLOWED.test(words[w])) return NONE;
    }

    var rules = splitRules(s);
    if (!rules.length) return NONE;

    var today = ctx.date.getDay();
    var result;          // last matching rule wins, per OSM rule-override semantics
    var solar = null;
    var matchedAny = false;

    for (var i = 0; i < rules.length; i++) {
      var r = parseRule(rules[i], ctx);
      if (!r) return { value: null, label: null };           // one bad rule poisons the value
      if (r.months && !inMonthRange(r.months, ctx.date)) continue;
      if (r.days && !r.days[today]) continue;
      matchedAny = true;
      result = r.value;
      solar = r.solar || null;
    }

    if (!matchedAny || result === 'unknown' || result === undefined) return { value: null, label: null };
    return { value: result, label: solar ? solarLabel(solar, result) : null };
  }

  // "Sunrise to sunset", "Dawn to dusk", "8:00 AM to sunset", "Sunrise to 10:00 PM".
  function solarLabel(solar, value) {
    var parts = value.split('-');
    var open = solar.open || clock12(parts[0]);
    var close = solar.close || clock12(parts[1]);
    return open.charAt(0).toUpperCase() + open.slice(1) + ' to ' + close;
  }

  function clock12(hhmm) {
    var n = parseInt(hhmm, 10);
    if (n === 2400) n = 0;
    var h = Math.floor(n / 100), m = n % 100;
    var ap = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  // Back-compatible shorthand for callers that only need the canonical string.
  function todayCanonical(raw, opts) {
    return todayDetail(raw, opts).value;
  }

  var api = {
    todayCanonical: todayCanonical,
    todayDetail: todayDetail,
    _parseRule: parseRule, _splitRules: splitRules, _solarMinutes: solarMinutes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OsmHours = api;
})(typeof window !== 'undefined' ? window : globalThis);
