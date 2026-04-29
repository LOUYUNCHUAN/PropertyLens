/**
 * PropertyLens — PropertyGuru content script
 * Scrapes HDB listing details and calls the local FastAPI backend.
 */

const API_BASE = 'http://localhost:8000'
const BUYER_STUDIO_ORIGIN = 'http://localhost:5173'

/**
 * Same string as web login (localStorage hdb_user).
 * If unset in the popup, default to "user" so Shortlist matches the web demo login.
 */
function getStoredUsername() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['propertylens_username'], (r) => {
        const v = String(r.propertylens_username || '').trim()
        resolve(v || 'user')
      })
    } catch {
      resolve('user')
    }
  })
}

const MATURE_ESTATES = new Set([
  'ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT MERAH', 'BUKIT TIMAH',
  'CENTRAL AREA', 'CLEMENTI', 'GEYLANG', 'KALLANG/WHAMPOA',
  'MARINE PARADE', 'PASIR RIS', 'QUEENSTOWN', 'SERANGOON', 'TAMPINES', 'TOA PAYOH'
])

const TOWN_DEFAULTS = {
  'TAMPINES':        { mrt: 0.4, cbd: 16.5 },
  'BEDOK':           { mrt: 0.4, cbd: 13.0 },
  'JURONG WEST':     { mrt: 0.6, cbd: 21.0 },
  'JURONG EAST':     { mrt: 0.3, cbd: 18.0 },
  'SENGKANG':        { mrt: 0.3, cbd: 16.0 },
  'PUNGGOL':         { mrt: 0.3, cbd: 18.5 },
  'WOODLANDS':       { mrt: 0.4, cbd: 24.0 },
  'YISHUN':          { mrt: 0.3, cbd: 19.5 },
  'HOUGANG':         { mrt: 0.5, cbd: 13.5 },
  'ANG MO KIO':      { mrt: 0.3, cbd: 10.5 },
  'BISHAN':          { mrt: 0.3, cbd: 9.0 },
  'TOA PAYOH':       { mrt: 0.3, cbd: 6.5 },
  'QUEENSTOWN':      { mrt: 0.5, cbd: 4.5 },
  'BUKIT MERAH':     { mrt: 0.5, cbd: 5.0 },
  'CLEMENTI':        { mrt: 0.4, cbd: 10.0 },
  'GEYLANG':         { mrt: 0.4, cbd: 5.5 },
  'SERANGOON':       { mrt: 0.4, cbd: 9.5 },
  'MARINE PARADE':   { mrt: 0.5, cbd: 7.0 },
  'PASIR RIS':       { mrt: 0.4, cbd: 19.5 },
  'KALLANG/WHAMPOA': { mrt: 0.4, cbd: 4.5 },
  'CENTRAL AREA':    { mrt: 0.3, cbd: 2.0 },
  'BUKIT TIMAH':     { mrt: 0.6, cbd: 10.0 },
  'CHOA CHU KANG':   { mrt: 0.3, cbd: 22.5 },
  'BUKIT BATOK':     { mrt: 0.4, cbd: 17.5 },
  'BUKIT PANJANG':   { mrt: 0.5, cbd: 20.0 },
  'SEMBAWANG':       { mrt: 0.5, cbd: 25.5 }
}

function normaliseFlatType(raw) {
  const r = raw.toUpperCase()
  if (r.includes('EXEC')) return 'EXECUTIVE'
  if (r.includes('5')) return '5 ROOM'
  if (r.includes('4')) return '4 ROOM'
  if (r.includes('3')) return '3 ROOM'
  if (r.includes('2')) return '2 ROOM'
  if (r.includes('1')) return '1 ROOM'
  return '4 ROOM'
}

function getStructuredData() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '{}')
      if (data['@type'] === 'RealEstateListing') {
        return data
      }
    } catch {
      // ignore
    }
  }
  return null
}

const BEDROOM_TO_FLAT_TYPE = {
  1: '2 ROOM',
  2: '3 ROOM',
  3: '4 ROOM',
  4: '5 ROOM',
  5: 'EXECUTIVE'
}

function extractBlockStreetFromLd(ld) {
  if (!ld) return null
  const o = ld.object || ld
  const addr = o && o.address
  if (!addr) return null
  const line = typeof addr === 'string' ? addr : (addr.streetAddress || '')
  if (!line || typeof line !== 'string') return null
  const re = /(?:blk|block)\s*(\d+[A-Za-z]?)\s*[,.]?\s+(.+)/i
  const m = line.trim().match(re)
  if (m) {
    const block = m[1].trim()
    let street = m[2].replace(/\s+/g, ' ').trim().toUpperCase()
    street = sanitiseStreetName(street)
    street = stripLeadingBlockDuplicates(block, street)
    return { block, street_name: street }
  }
  return null
}

/** Heuristic: BLK 123 … Street Name from visible text / title */
function extractBlockStreetFromText(rawText) {
  const t = rawText.replace(/\s+/g, ' ')

  const re = /(?:blk|block)\s*(\d+[A-Za-z]?)\s*[,.]?\s+([^,\n|#·]+?)(?=\s*[,|#·]|\s+SG\d|\s+SINGAPORE|$)/i
  const m = t.match(re)
  if (m) {
    const block = m[1].trim()
    let street = m[2].replace(/\s+/g, ' ').trim().toUpperCase()
    street = street.replace(/\s+(HDB|LEASEHOLD|99-YEAR).*$/i, '').trim()
    street = sanitiseStreetName(street)
    street = stripLeadingBlockDuplicates(block, street)
    return { block, street_name: street }
  }
  return { block: '', street_name: '' }
}

/**
 * PropertyGuru titles often repeat the block before the street ("BLK 267 267 BISHAN ST 24 …").
 * Strip one or more leading tokens that equal the block (case-insensitive).
 */
function stripLeadingBlockDuplicates(block, street) {
  const b = String(block || '').trim().toUpperCase()
  if (!b || !street) return street || ''
  const parts = String(street).trim().toUpperCase().split(/\s+/).filter(Boolean)
  while (parts.length && parts[0] === b) {
    parts.shift()
  }
  return parts.join(' ')
}

function sanitiseStreetName(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''

  const PG_NOISE =
    /\b(GALLERY|OVERVIEW|LOCATION|AMENITIES|MORTGAGE|PRICE HISTORY|FLOOR PLAN|DESCRIPTION|WHAT'S NEARBY|SCHOOLS|MRT|BUS|FOOD|SHOPPING|HEALTHCARE|LISTED ON|SHOW ALL MEDIA|VIEW ALL(?:\s+PHOTOS)?|ALL MEDIA|MORE PHOTOS|VIRTUAL TOUR|CONTACT AGENT|SAVE|SHARE)\b/i
  const idx = s.search(PG_NOISE)
  if (idx > 0) s = s.slice(0, idx).trim()

  s = s.replace(/\s+S\$\s*\d+.*$/i, '').trim()

  const MAX_LEN = 48
  if (s.length > MAX_LEN) {
    const words = s.split(/\s+/)
    let result = ''
    for (const w of words) {
      if ((result + ' ' + w).trim().length > MAX_LEN) break
      result = (result + ' ' + w).trim()
    }
    s = result
  }

  return s.trim()
}

function extractSectionText(rootText, label, nextLabels) {
  const upper = rootText.toUpperCase()
  const startIdx = upper.indexOf(label.toUpperCase())
  if (startIdx === -1) return null
  const slice = upper.slice(startIdx + label.length)
  let end = slice.length
  for (const next of nextLabels) {
    const idx = slice.indexOf(next.toUpperCase())
    if (idx !== -1 && idx < end) end = idx
  }
  return slice.slice(0, end)
}

function extractDistancesMeters(textChunk) {
  if (!textChunk) return []
  const matches = [...textChunk.matchAll(/(\d{2,4})\s*M\b/g)]
  return matches.map((m) => parseInt(m[1], 10)).filter((n) => !Number.isNaN(n))
}

/**
 * Maps scraped fields → PropertyLens PredictRequest (hybrid-friendly when block+street+sale_month set).
 */
function buildPredictPayload(data) {
  const now = new Date()
  const y = data.year != null ? data.year : now.getFullYear()
  const mo = data.month_num != null ? data.month_num : now.getMonth() + 1
  const sale_month = `${y}-${String(mo).padStart(2, '0')}`

  const sm = Math.min(50, Math.max(1, Math.round(data.storey_mid || 8)))
  const storey_range =
    data.storey_range && String(data.storey_range).trim()
      ? String(data.storey_range).trim().toUpperCase()
      : `${String(sm).padStart(2, '0')} TO ${String(sm).padStart(2, '0')}`

  let lcd = data.lease_commence_date
  if (lcd == null || Number.isNaN(lcd)) {
    const rly = data.remaining_lease_years || 75
    lcd = Math.round(y - (99 - rly))
  }
  lcd = Math.max(1960, Math.min(2035, Math.round(lcd)))

  let rly = data.remaining_lease_years
  if (rly == null || Number.isNaN(rly)) {
    rly = Math.max(1, Math.min(99, 99 - (y - lcd)))
  }
  rly = Math.max(1, Math.min(99, rly))

  return {
    floor_area_sqm: Number(data.floor_area_sqm),
    storey_mid: Number(data.storey_mid),
    remaining_lease_years: rly,
    lease_commence_date: lcd,
    dist_nearest_mrt_km: data.dist_nearest_mrt_km,
    dist_to_cbd_km: data.dist_to_cbd_km,
    dist_nearest_primary_school_km: data.dist_nearest_primary_school_km,
    dist_nearest_top_school_km: data.dist_nearest_top_school_km,
    dist_nearest_hawker_km: data.dist_nearest_hawker_km,
    dist_nearest_market_km: data.dist_nearest_market_km,
    mrt_count_within_1km: data.mrt_count_within_1km,
    primary_schools_within_1km: data.primary_schools_within_1km,
    primary_schools_within_2km: data.primary_schools_within_2km,
    top_school_within_1km: data.top_school_within_1km,
    top_school_within_2km: data.top_school_within_2km,
    hawkers_within_500m: data.hawkers_within_500m,
    town: data.town,
    flat_type: data.flat_type,
    is_mature_estate: data.is_mature_estate,
    block: data.block ? String(data.block).trim() : '',
    street_name: data.street_name ? String(data.street_name).trim().toUpperCase() : '',
    storey_range,
    sale_month,
    year: y,
    month_num: mo
  }
}

function scrapeListingData() {
  const data = {}
  const now = new Date()
  const currentYear = now.getFullYear()

  const rawText = document.body.innerText || ''
  const pageText = rawText
  const upperText = rawText.toUpperCase()
  const cleanText = rawText.replace(/,/g, '')

  const ld = getStructuredData()
  if (ld) {
    if (ld.offers && ld.offers.price) {
      const p = parseInt(String(ld.offers.price), 10)
      if (!Number.isNaN(p)) data.asking_price = p
    }
    if (Array.isArray(ld.additionalProperty)) {
      const bedProp = ld.additionalProperty.find(
        (prop) =>
          prop &&
          typeof prop.name === 'string' &&
          prop.name.toLowerCase() === 'bedrooms'
      )
      if (bedProp && typeof bedProp.value === 'string') {
        const beds = parseInt(bedProp.value, 10)
        const mapped = BEDROOM_TO_FLAT_TYPE[beds]
        if (mapped) data.flat_type = mapped
      }
    }
    const fromLd = extractBlockStreetFromLd(ld)
    if (fromLd) {
      data.block = fromLd.block
      data.street_name = fromLd.street_name
    }
  }

  if (!data.asking_price) {
    const priceSelectors = [
      '[data-testid="listing-price"]',
      '.price-wrapper .price',
      'span[class*="price"]',
      'h2[class*="price"]',
      '.listing-price'
    ]
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel)
      if (el) {
        const m = el.textContent.replace(/,/g, '').match(/\d{5,8}/)
        if (m) { data.asking_price = parseInt(m[0], 10); break }
      }
    }
  }
  if (!data.asking_price) {
    const m = cleanText.match(/S\$ ?(\d{5,8})/i)
    if (m) {
      data.asking_price = parseInt(m[1], 10)
    }
  }

  let areaSqm = null
  const sqftMatch = cleanText.match(/(\d{3,5})\s*sqft/i)
  if (sqftMatch) {
    const sqft = parseInt(sqftMatch[1], 10)
    if (!Number.isNaN(sqft)) {
      areaSqm = Math.round(sqft * 0.0929)
    }
  }
  if (areaSqm == null) {
    const sqmMatch = cleanText.match(/(\d{2,4})\s*sqm/i)
    if (sqmMatch) {
      const sqm = parseInt(sqmMatch[1], 10)
      if (!Number.isNaN(sqm)) areaSqm = sqm
    }
  }

  const topMatch = pageText.match(/TOP\s+in\s+(1[89]\d{2}|20[0-2]\d)/i)
  if (topMatch) {
    const topYear = parseInt(topMatch[1], 10)
    if (!Number.isNaN(topYear)) {
      data.lease_commence_date = topYear
      data.remaining_lease_years = 99 - (currentYear - topYear)
    }
  }

  const mrtMetresMatch = pageText.match(/(\d+)\s*m\s*\(\s*\d+\s*mins?\s*\)\s*from.*?MRT/i)
  const mrtKmMatch = pageText.match(/([\d.]+)\s*km\s*from.*?MRT/i)
  if (mrtMetresMatch) {
    const metres = parseInt(mrtMetresMatch[1], 10)
    if (!Number.isNaN(metres)) {
      data.dist_nearest_mrt_km = parseFloat((metres / 1000).toFixed(2))
    }
  } else if (mrtKmMatch) {
    const kmVal = parseFloat(mrtKmMatch[1])
    if (!Number.isNaN(kmVal)) data.dist_nearest_mrt_km = kmVal
  }

  if (!data.flat_type) {
    const flatTypeTextMatch =
      pageText.match(/(\d)\s*[-\s]?(?:room|rm)\s*(?:flat|hdb)?/i) ||
      pageText.match(/(executive|exec)\s*(?:flat|hdb|apartment)?/i)

    if (flatTypeTextMatch) {
      const num = parseInt(flatTypeTextMatch[1], 10)
      if (!Number.isNaN(num) && num >= 1 && num <= 5) {
        data.flat_type = `${num} ROOM`
      } else {
        data.flat_type = 'EXECUTIVE'
      }
    }
  }
  data.flat_type = data.flat_type || '4 ROOM'

  if (areaSqm == null) {
    const defaults = { '1 ROOM': 35, '2 ROOM': 45, '3 ROOM': 68, '4 ROOM': 93, '5 ROOM': 113, EXECUTIVE: 143 }
    areaSqm = defaults[data.flat_type] || 93
  }
  data.floor_area_sqm = areaSqm

  let storeyMid = 8
  const floorNumMatch =
    pageText.match(/(?:floor|level|storey)\s*(\d{1,2})/i) ||
    pageText.match(/#(\d{1,2})-/i)
  const highFloorMatch = pageText.match(/high\s*floor/i)
  const midFloorMatch = pageText.match(/mid\s*floor/i)
  const lowFloorMatch = pageText.match(/low\s*floor/i)
  if (floorNumMatch) {
    storeyMid = Math.min(parseInt(floorNumMatch[1], 10), 50)
  } else if (highFloorMatch) {
    storeyMid = 20
  } else if (midFloorMatch) {
    storeyMid = 10
  } else if (lowFloorMatch) {
    storeyMid = 4
  }
  data.storey_mid = storeyMid

  const breadcrumbSelectors = [
    '[data-testid="breadcrumb"]',
    'nav[aria-label="breadcrumb"]',
    '.breadcrumb',
    'ol[class*="breadcrumb"]'
  ]
  let townFound = null
  for (const sel of breadcrumbSelectors) {
    const el = document.querySelector(sel)
    if (el && el.textContent) {
      const text = el.textContent.toUpperCase()
      let bestTown = null
      let bestIdx = Infinity
      for (const town of Object.keys(TOWN_DEFAULTS)) {
        const idx = text.indexOf(town)
        if (idx >= 0 && idx < bestIdx) {
          bestIdx = idx
          bestTown = town
        }
      }
      if (bestTown) {
        townFound = bestTown
        break
      }
    }
  }
  if (!townFound) {
    const slug = window.location.pathname.toLowerCase()
    for (const town of Object.keys(TOWN_DEFAULTS)) {
      const token = town.toLowerCase().replace(/\//g, '').replace(/\s+/g, '-')
      if (slug.includes(token)) {
        townFound = town
        break
      }
    }
  }
  if (!townFound) {
    let bestTown = null
    let bestIdx = Infinity
    for (const town of Object.keys(TOWN_DEFAULTS)) {
      const idx = upperText.indexOf(town)
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx
        bestTown = town
      }
    }
    townFound = bestTown
  }
  data.town = townFound || 'BISHAN'

  if (data.lease_commence_date && !data.remaining_lease_years) {
    data.remaining_lease_years = 99 - (currentYear - data.lease_commence_date)
  } else if (!data.lease_commence_date && data.remaining_lease_years) {
    data.lease_commence_date = currentYear - (99 - data.remaining_lease_years)
  }
  if (!data.remaining_lease_years) data.remaining_lease_years = 75

  if (data.remaining_lease_years < 1) data.remaining_lease_years = 1
  if (data.remaining_lease_years > 99) data.remaining_lease_years = 99

  const townData = TOWN_DEFAULTS[data.town] || { mrt: 0.5, cbd: 10.0 }
  data.is_mature_estate = MATURE_ESTATES.has(data.town) ? 1 : 0
  if (data.dist_nearest_mrt_km == null) data.dist_nearest_mrt_km = townData.mrt
  data.dist_to_cbd_km = townData.cbd
  if (data.dist_nearest_hawker_km == null) data.dist_nearest_hawker_km = 0.3
  if (data.dist_nearest_market_km == null) data.dist_nearest_market_km = 0.5
  if (data.dist_nearest_primary_school_km == null) data.dist_nearest_primary_school_km = 0.5
  if (data.dist_nearest_top_school_km == null) {
    data.dist_nearest_top_school_km = data.is_mature_estate ? 0.8 : 1.5
  }
  if (data.mrt_count_within_1km == null) {
    data.mrt_count_within_1km = data.is_mature_estate ? 2 : 1
  }
  if (data.primary_schools_within_1km == null) {
    data.primary_schools_within_1km = data.is_mature_estate ? 3 : 1
  }
  if (data.primary_schools_within_2km == null) {
    data.primary_schools_within_2km = data.is_mature_estate ? 6 : 3
  }
  if (data.top_school_within_1km == null) {
    data.top_school_within_1km = data.is_mature_estate ? 1 : 0
  }
  if (data.top_school_within_2km == null) {
    data.top_school_within_2km = data.is_mature_estate ? 1 : 0
  }
  if (data.hawkers_within_500m == null) {
    data.hawkers_within_500m = data.is_mature_estate ? 2 : 1
  }

  const listedMatch = pageText.match(/Listed\s+on\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(20\d{2})/i)
  if (listedMatch) {
    const day = parseInt(listedMatch[1], 10)
    const monthStr = listedMatch[2].toLowerCase()
    const yearVal = parseInt(listedMatch[3], 10)
    const monthMap = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    }
    const m = monthMap[monthStr.slice(0, 3)]
    if (!Number.isNaN(yearVal) && m) {
      data.year = yearVal
      data.month_num = m
    }
  }
  if (!data.year) data.year = currentYear
  if (!data.month_num) data.month_num = now.getMonth() + 1

  try {
    const nearbyRoot = Array.from(document.querySelectorAll('section, div')).find(
      (el) =>
        el.textContent &&
        el.textContent.includes("What's nearby") &&
        el.textContent.includes('MRT/LRT')
    )
    if (nearbyRoot) {
      const txt = nearbyRoot.innerText || nearbyRoot.textContent || ''
      const mrtChunk = extractSectionText(txt, 'MRT/LRT', ['Bus', 'Schools', 'Food', 'Shopping', 'Healthcare'])
      const mrtDistances = extractDistancesMeters(mrtChunk)
      if (mrtDistances.length) {
        const minM = Math.min(...mrtDistances)
        const km = Math.round((minM / 1000) * 100) / 100
        if (km > 0 && km < 30) {
          data.dist_nearest_mrt_km = km
        }
        const count1km = mrtDistances.filter((d) => d <= 1000).length
        if (count1km > 0) {
          data.mrt_count_within_1km = count1km
        }
      }

      const schoolsChunk = extractSectionText(txt, 'Schools', ['Bus', 'MRT/LRT', 'Food', 'Shopping', 'Healthcare'])
      const schoolDistances = extractDistancesMeters(schoolsChunk)
      if (schoolDistances.length) {
        const minSchoolKm = Math.round((Math.min(...schoolDistances) / 1000) * 100) / 100
        if (minSchoolKm > 0 && minSchoolKm < 30) {
          data.dist_nearest_primary_school_km = minSchoolKm
        }
        const within1 = schoolDistances.filter((d) => d <= 1000).length
        const within2 = schoolDistances.filter((d) => d <= 2000).length
        if (within1) data.primary_schools_within_1km = within1
        if (within2) data.primary_schools_within_2km = within2
      }

      const foodChunk = extractSectionText(txt, 'Food & Drink', ['Shopping', 'Healthcare', 'Bus', 'MRT/LRT', 'Schools'])
      const foodDistances = extractDistancesMeters(foodChunk)
      if (foodDistances.length) {
        const minFoodKm = Math.round((Math.min(...foodDistances) / 1000) * 100) / 100
        if (minFoodKm > 0 && minFoodKm < 30) {
          data.dist_nearest_hawker_km = minFoodKm
        }
        const hawkerWithin500 = foodDistances.filter((d) => d <= 500).length
        if (hawkerWithin500) data.hawkers_within_500m = hawkerWithin500
      }
    }
  } catch {
    // keep defaults
  }

  if (!data.block || !data.street_name) {
    const headings = Array.from(document.querySelectorAll('h1, h2, [data-testid="listing-title"]'))
    for (const h of headings) {
      const fromH = extractBlockStreetFromText(h.textContent || '')
      if (fromH.block && fromH.street_name) {
        data.block = data.block || fromH.block
        data.street_name = data.street_name || fromH.street_name
        break
      }
    }
  }
  if (!data.block && !data.street_name) {
    const fromText = extractBlockStreetFromText(rawText)
    if (fromText.block) data.block = fromText.block
    if (fromText.street_name) data.street_name = fromText.street_name
  }
  if (data.street_name) {
    data.street_name = sanitiseStreetName(data.street_name)
    if (data.block) {
      data.street_name = stripLeadingBlockDuplicates(data.block, data.street_name)
    }
  }

  return data
}

async function getEstimate(flatData) {
  const body = buildPredictPayload(flatData)
  const [predictRes, shapRes] = await Promise.all([
    fetch(`${API_BASE}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    fetch(`${API_BASE}/api/explain/shap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flat: body })
    })
  ])

  const prediction = await predictRes.json()
  if (!predictRes.ok) {
    const d = prediction?.detail
    const msg = Array.isArray(d)
      ? d.map((x) => (x && (x.msg || x.type)) || JSON.stringify(x)).join('; ')
      : typeof d === 'string'
        ? d
        : JSON.stringify(prediction)
    throw new Error(msg || `Predict failed (${predictRes.status})`)
  }

  const shapRaw = await shapRes.json()
  const shap =
    shapRes.ok && shapRaw && Array.isArray(shapRaw.shap_values)
      ? shapRaw
      : { shap_values: [] }

  return { prediction, shap, requestBody: body }
}

function getVerdict(listingPrice, mlEstimate, cbrCheck) {
  if (!listingPrice) return { text: 'Fair Value Unknown', color: '#4a7c6f', gapPct: null }
  const mlGap = (listingPrice - mlEstimate) / mlEstimate

  if (cbrCheck && cbrCheck.flag && cbrCheck.direction === 'cbr_higher' && cbrCheck.cbr_median) {
    const cbrGap = (listingPrice - cbrCheck.cbr_median) / cbrCheck.cbr_median
    const gapPct = (cbrGap * 100).toFixed(1)
    if (cbrGap > 0.05) return { text: '⚠️ Overpriced', color: '#c0392b', gapPct, ref: 'CBR' }
    if (cbrGap < -0.05) return { text: '✅ Good Value', color: '#4a7c6f', gapPct, ref: 'CBR' }
    return { text: '✅ Fair Price', color: '#4a7c6f', gapPct, ref: 'CBR' }
  }

  const gapPct = (mlGap * 100).toFixed(1)
  if (mlGap > 0.10) return { text: '⚠️ Overpriced', color: '#c0392b', gapPct, ref: 'AI' }
  if (mlGap < -0.05) return { text: '✅ Good Value', color: '#4a7c6f', gapPct, ref: 'AI' }
  return { text: '✅ Fairly Priced', color: '#c8791a', gapPct, ref: 'AI' }
}

function buildOverlay(flatData, prediction, shap, requestBody) {
  const fmt = (n) => `$${Math.round(n).toLocaleString()}`
  const cbrCheck = prediction.cbr_check || null

  const verdict = getVerdict(flatData.asking_price, prediction.predicted_price, cbrCheck)
  const verdictColor = verdict.color
  const verdictText = verdict.text
  const gapPct = verdict.gapPct

  const cbrCautionHtml = cbrCheck && cbrCheck.flag && cbrCheck.direction === 'cbr_higher'
    ? `<div style="font-size:11px; color:#92400e; margin-top:4px;">
        🟡 Model may underestimate — CBR: ${fmt(cbrCheck.cbr_median)} (+${cbrCheck.divergence_pct}%)
       </div>`
    : ''

  const top3 = (shap.shap_values || [])
    .slice(0, 3)
    .map(
      (f) => `
      <div class="xai-shap-row">
        <span class="xai-shap-feat">${f.feature.replace(/_/g, ' ')}</span>
        <span class="xai-shap-val" style="color:${
          f.shap_value >= 0 ? '#4a7c6f' : '#c0392b'
        }">
          ${f.shap_value >= 0 ? '+' : ''}${fmt(f.shap_value)}
        </span>
      </div>
    `
    )
    .join('')

  const hybridHint =
    flatData.block && flatData.street_name
      ? ''
      : '<div style="font-size:10px;color:#92400e;margin:6px 14px 0;">Add block/street in Buyer if scrape missed them — hybrid lookup works best with full address.</div>'

  return `
    <div id="xai-overlay" class="xai-overlay">
      <div class="xai-header">
        <div class="xai-logo">
          <div class="xai-logo-icon">P</div>
          <span class="xai-logo-text">Property<span style="color:#4a7c6f">Lens</span></span>
        </div>
        <button type="button" class="xai-close" aria-label="Close">✕</button>
      </div>

      <div class="xai-verdict" style="background:${verdictColor}15; border: 1px solid ${verdictColor}40">
        <div>
          <span style="color:${verdictColor}; font-weight:700; font-size:13px">${verdictText}</span>
          ${gapPct
            ? `<span style="color:${verdictColor}; font-size:12px; margin-left:8px">${
                Number(gapPct) > 0 ? '+' : ''
              }${gapPct}% vs ${verdict.ref || 'AI'}</span>`
            : ''}
        </div>
        ${cbrCautionHtml}
      </div>
      ${hybridHint}

      <div class="xai-prices">
        <div class="xai-price-col">
          <div class="xai-price-label">Model estimate</div>
          <div class="xai-price-val">${fmt(prediction.predicted_price)}</div>
          <div class="xai-price-sub">${fmt(
            prediction.confidence_low
          )} – ${fmt(prediction.confidence_high)}</div>
        </div>
        ${
          flatData.asking_price
            ? `
        <div class="xai-divider"></div>
        <div class="xai-price-col">
          <div class="xai-price-label">Asking Price</div>
          <div class="xai-price-val" style="color:${verdictColor}">${fmt(
            flatData.asking_price
          )}</div>
          <div class="xai-price-sub">${fmt(
            prediction.price_per_sqm
          )}/sqm est.</div>
        </div>
        `
            : ''
        }
      </div>

      <div class="xai-details">
        <div class="xai-detail-chip">${flatData.town}</div>
        <div class="xai-detail-chip">${flatData.flat_type}</div>
        <div class="xai-detail-chip">${
          flatData.floor_area_sqm
        } sqm</div>
        <div class="xai-detail-chip">Floor ${flatData.storey_mid}</div>
        <div class="xai-detail-chip">${
          flatData.remaining_lease_years
        }yr lease</div>
        ${
          flatData.is_mature_estate
            ? '<div class="xai-detail-chip xai-mature">Mature</div>'
            : ''
        }
      </div>

      <div class="xai-section-label">Top price drivers (SHAP proxy)</div>
      <div class="xai-shap">${top3}</div>

      <div class="xai-actions">
        <button type="button" id="xai-open-buyer" class="xai-nav-btn">
          Open in Buyer
        </button>
        <button type="button" id="xai-save-shortlist" class="xai-nav-btn xai-nav-btn-secondary">
          Save to shortlist
        </button>
      </div>

      <div class="xai-footer">
        Hybrid Cluster Ensemble · R² ~0.9658 · RMSE ~$37.8k · MAPE 4.01%
      </div>
    </div>
  `
}

function injectLoadingOverlay() {
  const el = document.createElement('div')
  el.id = 'xai-overlay'
  el.className = 'xai-overlay'
  el.innerHTML = `
    <div class="xai-header">
      <div class="xai-logo">
        <div class="xai-logo-icon">P</div>
        <span class="xai-logo-text">Property<span style="color:#4a7c6f">Lens</span></span>
      </div>
      <button type="button" class="xai-close" aria-label="Close">✕</button>
    </div>
    <div class="xai-loading">
      <div class="xai-spinner"></div>
      <span>Analysing listing...</span>
    </div>
  `
  document.body.appendChild(el)
  const close = el.querySelector('.xai-close')
  if (close) {
    close.addEventListener('click', () => el.remove())
  }
  return el
}

async function main() {
  const url = window.location.href
  const pageText = (document.body.innerText || '').toUpperCase()

  const isListingPage = url.includes('/property-for-sale/') || url.includes('/listing/')
  if (!isListingPage) return

  const isHDB =
    pageText.includes('HDB') ||
    pageText.includes('99-YEAR LEASE') ||
    url.toLowerCase().includes('hdb-for-sale')
  if (!isHDB) return

  if (document.getElementById('xai-overlay')) return

  const flatData = scrapeListingData()
  if (!flatData) return

  injectLoadingOverlay()

  try {
    const { prediction, shap, requestBody } = await getEstimate(flatData)
    const overlay = document.getElementById('xai-overlay')
    if (overlay) {
      overlay.outerHTML = buildOverlay(flatData, prediction, shap, requestBody)
      const newOverlay = document.getElementById('xai-overlay')
      const closeBtn = newOverlay && newOverlay.querySelector('.xai-close')
      if (closeBtn && newOverlay) {
        closeBtn.addEventListener('click', () => newOverlay.remove())
      }
      const btn = newOverlay && newOverlay.querySelector('#xai-open-buyer')
      if (btn) {
        btn.addEventListener('click', () => {
          const params = new URLSearchParams()
          const saleY = flatData.year || new Date().getFullYear()
          const saleM = flatData.month_num || new Date().getMonth() + 1
          const sale_month = `${saleY}-${String(saleM).padStart(2, '0')}`
          const sm = Math.min(50, Math.max(1, Math.round(flatData.storey_mid || 8)))
          const storey_range =
            flatData.storey_range ||
            `${String(sm).padStart(2, '0')} TO ${String(sm).padStart(2, '0')}`

          const prefill = {
            town: flatData.town,
            flat_type: flatData.flat_type,
            block: flatData.block || '',
            street_name: flatData.street_name || '',
            storey_range,
            sale_month,
            floor_area_sqm: flatData.floor_area_sqm,
            lease_commence_date: flatData.lease_commence_date,
            storey_mid: flatData.storey_mid,
            remaining_lease_years: flatData.remaining_lease_years,
            is_mature_estate: flatData.is_mature_estate,
            dist_nearest_mrt_km: flatData.dist_nearest_mrt_km,
            dist_to_cbd_km: flatData.dist_to_cbd_km,
            dist_nearest_primary_school_km: flatData.dist_nearest_primary_school_km,
            dist_nearest_top_school_km: flatData.dist_nearest_top_school_km,
            dist_nearest_hawker_km: flatData.dist_nearest_hawker_km,
            dist_nearest_market_km: flatData.dist_nearest_market_km,
            mrt_count_within_1km: flatData.mrt_count_within_1km,
            primary_schools_within_1km: flatData.primary_schools_within_1km,
            primary_schools_within_2km: flatData.primary_schools_within_2km,
            top_school_within_1km: flatData.top_school_within_1km,
            top_school_within_2km: flatData.top_school_within_2km,
            hawkers_within_500m: flatData.hawkers_within_500m,
            year: flatData.year,
            month_num: flatData.month_num,
            asking_price: flatData.asking_price
          }
          Object.entries(prefill).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') {
              params.set(k, String(v))
            }
          })
          window.open(`${BUYER_STUDIO_ORIGIN}/buyer?${params.toString()}`, '_blank')
        })
      }
      const saveBtn = newOverlay && newOverlay.querySelector('#xai-save-shortlist')
      if (saveBtn && requestBody) {
        saveBtn.addEventListener('click', async () => {
          const u = await getStoredUsername()
          saveBtn.disabled = true
          const label = saveBtn.textContent
          try {
            const res = await fetch(`${API_BASE}/api/wishlist/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: u,
                listing_price: flatData.asking_price || null,
                source: 'extension',
                listing_url: window.location.href,
                payload: requestBody
              })
            })
            if (!res.ok) {
              const t = await res.text()
              throw new Error(t || res.statusText)
            }
            saveBtn.textContent = 'Saved ✓'
          } catch (e) {
            console.error(e)
            window.alert('Could not save to shortlist. Is the API running on port 8000?')
            saveBtn.disabled = false
            saveBtn.textContent = label
          }
        })
      }
    }
  } catch (err) {
    const overlay = document.getElementById('xai-overlay')
    if (overlay) {
      overlay.innerHTML += `
        <div style="padding:16px;color:#c0392b;font-size:12px">
          ⚠️ Could not connect to PropertyLens API.<br>Run <code>uvicorn</code> in <code>backend/</code> on port 8000.
        </div>
      `
    }
    console.error('PropertyLens extension error:', err)
  }
}

main()
let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(main, 1500)
  }
}).observe(document, { subtree: true, childList: true })
