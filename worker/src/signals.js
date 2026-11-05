// What a page asks for, from a plain description of its forms (collected inside the browser), and how old
// its domain is (from RDAP). Pure functions; the browser and RDAP are outside, so tests need neither.

// A few second-level suffixes, so "fake-sbi.co.in" is compared as "fake-sbi.co.in", not "co.in".
const TWO_LEVEL = new Set(['co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'edu.in', 'res.in', 'gov.in', 'nic.in',
  'co.uk', 'org.uk', 'com.au', 'com.br', 'co.za', 'com.sg', 'com.cn', 'com.hk']);
export function registrable(host) {
  const parts = String(host).toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

// Field names in phishing kits use _ and - as separators ("otp_code", "upi-pin"), so they count as spaces here.
const words = (f) => [f.name, f.id, f.placeholder, f.label, f.autocomplete, f.ariaLabel].filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ');
const RULES = {
  otpForm: (f, w) => f.autocomplete === 'one-time-code' || /\botp\b|one ?time|verification code|ओटीपी/.test(w),
  pinForm: (f, w) => /upi ?pin|\bmpin\b|\bpin\b/.test(w) && !/pin ?code|pincode|postal/.test(w),
  cardForm: (f, w) => /^cc-/.test(f.autocomplete || '') || /card ?(no|num)|cardnumber|\bcvv\b|\bcvc\b|expiry|exp ?date/.test(w),
  aadhaarForm: (f, w) => /aadhaa?r|आधार|\buid\b/.test(w),
};

// forms: [{ action, fields: [{ type, name, id, placeholder, label, autocomplete, ariaLabel }] }]
export function formSignals(forms, pageUrl) {
  const found = new Set();
  const pageSite = registrable(new URL(pageUrl).hostname);
  for (const form of forms || []) {
    for (const f of form.fields || []) {
      const w = words(f);
      for (const [signal, test] of Object.entries(RULES)) if (test(f, w)) found.add(signal);
      if (f.type === 'password' && form.action) {
        let site = pageSite;
        try {
          site = registrable(new URL(form.action, pageUrl).hostname);
        } catch {
          // a broken action stays on the page's own site
        }
        if (site !== pageSite) found.add('passwordOffsite');
      }
    }
  }
  return [...found];
}

// Days since the domain was registered, from an RDAP response; null when RDAP does not say.
export function domainAgeDays(rdap, now = new Date()) {
  const reg = (rdap?.events || []).find((e) => e.eventAction === 'registration')?.eventDate;
  const t = Date.parse(reg || '');
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
}

export const YOUNG_DAYS = 30;
