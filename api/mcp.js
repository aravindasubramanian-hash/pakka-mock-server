// Pakka Mock MCP Server  —  api/mcp.js
// Implements MCP Streamable HTTP transport (JSON-RPC 2.0 over POST)
// 17 tools: Delhivery (6) | Pine Labs gaps (6) | Onsitego (3) | Gnani (2)
// Deploy on Vercel; register the URL https://<your-app>.vercel.app/api/mcp on AgenticOrg.

'use strict';

// ─────────────────────────────────────────────
// STATIC MOCK DATA  (matches KB household H001)
// ─────────────────────────────────────────────

const SERVICEABLE_PINCODES = new Set([
  '122001','122002','122003','122004','122005',
  '122006','122007','122008','122009','122010',
  '110001','110002','110003','110010','110011',
  '110012','110013','110014','110015','110016',
  '110017','110018','110019','110020',
]);

const ENTITLEMENTS = {
  'VLT-AC-2024-10234': {
    found: true,
    serial: 'VLT-AC-2024-10234',
    appliance_id: 'AC-10234',
    brand: 'Voltas',
    model: '1.5T 5-Star Split AC',
    contract_id: 'W-VLT-AC-2024-10234',
    charge_schedule: [
      { charge: 'Visit / inspection / diagnosis (includes gas check, gas pressure check, leak check)', household_pays_rs: 0, clause: 'CL-VLT-3.5' },
      { charge: 'Refrigerant gas refill to complete or rework the covered compressor repair (last repair 2026-08-12)', household_pays_rs: 0, clause: 'CL-VLT-3.5' },
      { charge: 'Refrigerant gas refill for any other cause', household_pays_rs: null, clause: null, note: 'Not stated in contract: ask the centre for an itemised written quote; treat as ambiguous (R6) until clarified' },
      { charge: 'Compressor replacement and its standard labour', household_pays_rs: 0, clause: 'CL-VLT-3.2 / CL-VLT-3.4' },
      { charge: 'Damage from a proven external electrical event', household_pays_rs: 'per quote', clause: 'CL-VLT-6.1', note: 'Exclusion applies only with documentary evidence' },
      { charge: 'Optional accessories / upgrades', household_pays_rs: 'per quote', clause: 'CL-VLT-7.2' },
    ],
    contract_type: 'Manufacturer Warranty',
    status: 'ACTIVE',
    expiry_date: '2027-04-17',
    covered_components: [
      { component: 'Compressor', clause: 'CL-VLT-3.2', deductible_rs: 0 },
      { component: 'Labour for compressor replacement', clause: 'CL-VLT-3.4', deductible_rs: 0 },
      { component: 'Refrigerant gas for covered compressor repair', clause: 'CL-VLT-3.5', deductible_rs: 0 },
    ],
    visit_charge_rs: 0,
    diagnosis_charge_rs: 0,
    inspection_charge_rs: 0,
    clause_text: {
      'CL-VLT-3.2': 'Compressor replacement is covered under warranty.',
      'CL-VLT-3.4': 'Standard labour for compressor replacement is included.',
      'CL-VLT-3.5': 'Inspection, diagnosis and visit charges for in-warranty breakdowns are Rs 0. Refrigerant gas required to complete or rework a covered compressor repair is covered.',
      'CL-VLT-6.1': 'Damage caused by proven external electrical events is excluded. Documentary evidence required for this exclusion claim.',
      'CL-VLT-7.2': 'Optional accessories and non-contractual upgrades are excluded from warranty coverage.',
    },
    exclusions: [
      { reason: 'External electrical damage', clause: 'CL-VLT-6.1', requires_written_evidence: true },
      { reason: 'Optional accessories / non-contractual upgrades', clause: 'CL-VLT-7.2', requires_written_evidence: false },
    ],
    prior_claims: [
      { date: '2026-08-12', type: 'Compressor repair', status: 'CLOSED' },
      { date: '2026-09-30', type: 'Diagnostic visit', status: 'CLOSED' },
    ],
  },

  'IFB-WM-2023-20881': {
    found: true,
    serial: 'IFB-WM-2023-20881',
    appliance_id: 'WM-20881',
    brand: 'IFB',
    model: 'Front Load Washing Machine 8kg',
    contract_id: 'AMC-IFB-WM-2026-20881',
    charge_schedule: [
      { charge: 'Visit / inspection / diagnosis', household_pays_rs: 0, clause: 'AMC-IFB-2.1' },
      { charge: 'Standard labour for covered breakdowns', household_pays_rs: 0, clause: 'AMC-IFB-2.1' },
      { charge: 'Consumables (e.g. detergent, filters)', household_pays_rs: 'per quote', clause: 'AMC-IFB-3.1' },
    ],
    contract_type: 'Annual Maintenance Contract',
    status: 'ACTIVE',
    expiry_date: '2027-06-01',
    covered_components: [
      { component: 'Standard labour for covered breakdowns', clause: 'AMC-IFB-2.1', deductible_rs: 0 },
      { component: '2 preventive maintenance visits per AMC year', clause: 'AMC-IFB-2.2', deductible_rs: 0 },
    ],
    visit_charge_rs: 0,
    diagnosis_charge_rs: 0,
    inspection_charge_rs: 0,
    exclusions: [
      { reason: 'Consumables not automatically included', clause: 'AMC-IFB-3.1', requires_written_evidence: false },
    ],
    prior_claims: [],
  },

  'LG-RF-2022-30772': {
    found: true,
    serial: 'LG-RF-2022-30772',
    appliance_id: 'RF-30772',
    brand: 'LG',
    model: 'Double Door Refrigerator',
    contract_id: null,
    contract_type: null,
    status: 'NOT_COVERED',
    expiry_date: null,
    covered_components: [],
    visit_charge_rs: null,
    note: 'No active manufacturer warranty or AMC. All repairs are paid; household-liable amount comes from the provider itemised quotation.',
    charge_schedule: [ { charge: 'All visits, parts and labour', household_pays_rs: 'per itemised quote', clause: null } ],
  },
};


// Find an entitlement by serial, appliance ID or contract ID, ignoring case/spaces.
function findEntitlement(key) {
  if (!key) return null;
  const k = String(key).trim().toUpperCase().replace(/\s+/g, '');
  for (const e of Object.values(ENTITLEMENTS)) {
    if ([e.serial, e.appliance_id, e.contract_id].filter(Boolean).some(v => v.toUpperCase() === k)) return e;
  }
  return null;
}

// In-memory stores (reset on cold start — fine for demo)
const serviceRequests = new Map();
const orders = new Map();
const shipments = new Map();
let srSeq = 1000, ordSeq = 5000;

function uid() { return `${Date.now()}-${Math.floor(Math.random() * 9999)}`; }

// ─────────────────────────────────────────────
// TOOL HANDLERS
// ─────────────────────────────────────────────

function delhivery_pincode_serviceability({ pin }) {
  const ok = SERVICEABLE_PINCODES.has(String(pin));
  return {
    pin: String(pin),
    serviceable: ok,
    edd: ok ? '2-3 business days' : null,
    error: ok ? null : `Pincode ${pin} is not currently serviceable by Delhivery`,
  };
}

function delhivery_create_shipment({ waybill, name, add, pin, phone, product_desc, cod = 0, payment_mode = 'Prepaid' }) {
  if (!SERVICEABLE_PINCODES.has(String(pin)))
    return { success: false, error: `Pincode ${pin} not serviceable — run delhivery_pincode_serviceability first` };
  const edd = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const record = { waybill, name, add, pin, phone, product_desc, cod, payment_mode, status: 'CREATED', edd, created_at: new Date().toISOString() };
  shipments.set(waybill, record);
  return { success: true, package: { waybill, status: 'CREATED', edd } };
}

// Scenario E8: no rider in the default 10:00-14:00 slot; the 14:00-18:00 slot has one.
function delhivery_pickup_request({ pickup_location, pickup_date, waybill, pickup_time = '10:00-14:00' }) {
  if (String(pickup_time).replace(/\s/g, '') !== '14:00-18:00') {
    return {
      success: false, waybill, pickup_date, pickup_time,
      status: 'NO_RIDER_AVAILABLE',
      error: 'No rider available for the requested pickup slot.',
      next_available_slot: { pickup_date, pickup_time: '14:00-18:00' },
    };
  }
  return {
    success: true,
    pickup_id: `PU-${uid()}`,
    waybill, pickup_location, pickup_date, pickup_time,
    status: 'PICKUP_SCHEDULED',
  };
}

function delhivery_track_shipment({ waybill }) {
  const s = shipments.get(waybill);
  if (!s) return { success: false, error: `Waybill ${waybill} not found. Was delhivery_create_shipment called first?` };
  return {
    success: true, waybill,
    status: 'IN_TRANSIT',
    current_location: 'Gurugram Sorting Hub',
    edd: s.edd,
    events: [
      { timestamp: new Date(Date.now() - 3600000).toISOString(), status: 'PICKUP_DONE', location: 'Supplier Warehouse' },
      { timestamp: new Date().toISOString(), status: 'IN_TRANSIT', location: 'Gurugram Sorting Hub' },
    ],
  };
}

// Fixed road distances (Google Maps, Oct 2026) so runs are repeatable. Keyed by pincode pair.
const ROAD_KM = {
  '201301|122003': { km: 47, min: 95 },   // Sector 62 Noida -> Sector 45 Gurugram
  '122001|122003': { km: 8,  min: 25 },
  '122002|122003': { km: 6,  min: 20 },
  '122018|122003': { km: 9,  min: 25 },   // service centre area -> household
  '110001|122003': { km: 32, min: 70 },
};
function delhivery_maps_distance_matrix({ origin, destination }) {
  const pin = s => (String(s || '').match(/\b\d{6}\b/) || [null])[0];
  const a = pin(origin), b = pin(destination);
  let d = a && b && (ROAD_KM[`${a}|${b}`] || ROAD_KM[`${b}|${a}`]);
  if (!d && a && b) {
    if (a === b) d = { km: 3, min: 12 };
    else if (a.slice(0, 3) === b.slice(0, 3)) d = { km: 10, min: 30 };   // same city
    else d = { km: 40, min: 85 };                                        // cross-city NCR
  }
  if (!d) return { origin, destination, error: 'Give origin and destination with 6-digit pincodes' };
  return {
    origin, destination,
    distance_km: d.km,
    duration_minutes: d.min,
    within_25km_service_radius: d.km <= 25,
    source: 'fixed table (Google Maps road distance)',
  };
}

function delhivery_entitlement_gate({ serial, part_code, service_event_id }) {
  const ent = findEntitlement(serial);
  if (!ent) {
    return {
      dispatch_allowed: false,
      reason: `Serial ${serial} not found in entitlement records. Treat as UNVERIFIED; dispatch blocked.`,
      serial, part_code, service_event_id,
    };
  }
  if (ent.status === 'NOT_COVERED') {
    return {
      dispatch_allowed: false,
      reason: 'No active warranty or AMC for this appliance. Parts must be procured on a paid basis; dispatch not authorised by Onsitego.',
      serial, part_code, service_event_id, entitlement_status: ent.status,
    };
  }
  return {
    dispatch_allowed: true,
    reason: `Entitlement verified under ${ent.contract_id} (${ent.contract_type}, expires ${ent.expiry_date}). Dispatch authorised.`,
    contract_id: ent.contract_id,
    entitlement_status: ent.status,
    serial, part_code, service_event_id,
  };
}

// ──── Pine Labs gaps ────

// Scenario E9b: any order of exactly Rs 1,800 (180000 paise) is declined for low balance.
function pinelabs_create_order({ merchant_order_id, amount, currency = 'INR', customer_ref, pre_auth = false, description = '' }) {
  if (Number(amount) === 180000) {
    return { success: false, merchant_order_id, status: 'DECLINED', error_code: 'INSUFFICIENT_BALANCE', error: 'Payment declined: insufficient balance on the customer instrument.' };
  }
  const order_id = `PL-ORD-${++ordSeq}`;
  const status = pre_auth ? 'PRE_AUTH_CREATED' : 'CREATED';
  orders.set(order_id, { order_id, merchant_order_id, amount, currency, customer_ref, pre_auth, description, status, created_at: new Date().toISOString() });
  logEvent(merchant_order_id || description, `Pine Labs ${status} ${order_id} Rs ${(amount/100).toFixed(0)}`, { order_id, merchant_order_id });
  return {
    order_id, merchant_order_id, status, amount, currency, pre_auth,
    created_at: orders.get(order_id).created_at,
    message: pre_auth
      ? `Pre-auth hold of Rs ${(amount / 100).toFixed(2)} created. Capture with pinelabs_capture_order after service is CORROBORATED.`
      : `Order of Rs ${(amount / 100).toFixed(2)} created.`,
  };
}

function pinelabs_capture_order({ order_id, amount }) {
  const o = findOrder(order_id);
  if (!o) return { success: false, error: `Order ${order_id} not found` };
  if (o.status === 'CAPTURED') return { success: false, error: 'Order already captured' };
  if (o.status === 'CANCELLED') return { success: false, error: 'Cannot capture a cancelled order' };
  if (amount > o.amount) return { success: false, error: `Capture Rs ${(amount/100).toFixed(2)} exceeds pre-auth Rs ${(o.amount/100).toFixed(2)}` };
  o.status = 'CAPTURED'; o.captured_amount = amount; o.captured_at = new Date().toISOString();
  logEvent(o.merchant_order_id || o.description, `Pine Labs ${o.order_id} captured Rs ${(amount/100).toFixed(0)}`, { order_id: o.order_id });
  // Scenario E9a: capture of exactly Rs 1,200 succeeds at Pine Labs but the reply times out.
  if (Number(amount) === 120000 && !o.timeout_shown) {
    o.timeout_shown = true;
    return { success: null, order_id, status: 'UNKNOWN', error_code: 'GATEWAY_TIMEOUT', error: 'Capture request timed out. Outcome unknown — check order status before any retry.' };
  }
  return { success: true, order_id, status: 'CAPTURED', captured_amount: amount, captured_at: o.captured_at, message: `Rs ${(amount/100).toFixed(2)} charged.` };
}

function pinelabs_cancel_order({ order_id, reason = 'Household requested cancellation' }) {
  const o = findOrder(order_id);
  if (!o) return { success: false, error: `Order ${order_id} not found` };
  if (o.status === 'CAPTURED') return { success: false, error: 'Cannot cancel a captured order — use pinelabs_create_refund instead' };
  o.status = 'CANCELLED'; o.cancelled_at = new Date().toISOString(); o.cancel_reason = reason;
  logEvent(o.merchant_order_id || o.description, `Pine Labs hold ${o.order_id} cancelled — ${reason}`, { order_id: o.order_id });
  return { success: true, order_id, status: 'CANCELLED', cancelled_at: o.cancelled_at, message: 'Pre-auth released. No charge made to household.' };
}

function findOrder(id) { return orders.get(id) || [...orders.values()].reverse().find(o => o.merchant_order_id === id); }
function pinelabs_get_order({ order_id }) {
  const o = findOrder(order_id);
  if (!o) return { found: false, order_id, error: `Order ${order_id} not found. Check merchant_order_id if you do not have the Pine Labs order_id.` };
  return { found: true, ...o };
}

function pinelabs_create_payment_link({ merchant_order_id, amount, currency = 'INR', customer_ref, expiry_minutes = 60, description = '' }) {
  const link_id = `PL-LINK-${uid()}`;
  const expiry = new Date(Date.now() + expiry_minutes * 60000).toISOString();
  return {
    link_id,
    merchant_order_id,
    payment_url: `https://pakka-mock-server.vercel.app/mock-pay/${link_id}`,
    amount, currency, customer_ref,
    expiry_at: expiry, status: 'ACTIVE',
    message: `Payment link Rs ${(amount/100).toFixed(2)} — valid ${expiry_minutes} min. Send to household via WhatsApp.`,
  };
}

function pinelabs_create_refund({ order_id, amount, reason = 'Service not performed or charge not owed' }) {
  const o = orders.get(order_id);
  if (!o) return { success: false, error: `Order ${order_id} not found` };
  if (o.status !== 'CAPTURED') return { success: false, error: `Cannot refund — order status is ${o.status}. Only CAPTURED orders can be refunded.` };
  return {
    success: true,
    refund_id: `PL-REF-${uid()}`,
    order_id, refund_amount: amount, reason,
    status: 'REFUND_INITIATED',
    estimated_credit_days: '5-7 business days',
    message: `Refund Rs ${(amount/100).toFixed(2)} initiated.`,
  };
}

// ──── Onsitego ────

function onsitego_entitlement_lookup({ serial }) {
  // Scenario E10: malformed partner reply — coverage fields missing.
  if (/MALFORMED/i.test(String(serial))) {
    return { found: true, serial, appliance_id: null, status: 'ACTIVE', contract_id: 'W-UNKNOWN', covered_components: null, exclusions: null, expiry_date: null };
  }
  const ent = findEntitlement(serial);
  if (!ent) {
    return {
      found: false, serial,
      status: 'NOT_FOUND',
      message: `No entitlement record for serial ${serial}. Coverage is UNVERIFIED — apply R17.`,
    };
  }
  // Include the household's service history so one call covers R1 (memory) and R4 (entitlement).
  const today = istToday();
  return { ...ent, service_history: SERVICE_MEMORY[ent.appliance_id] || [], household: HOUSEHOLD, today: `${today} (${dayName(today)})`, next_bookable_dates: nextWorkingDays(today, 3) };
}

// Dates in IST. The booking system honours the customer's stored availability (H001: Mon-Sat).
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function istToday() { const d = new Date(Date.now() + 5.5 * 3600000); return d.toISOString().slice(0, 10); }
function dayName(iso) { const d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? null : DAYS[d.getUTCDay()]; }
function nextWorkingDays(fromIso, n) {
  const out = []; let d = new Date(fromIso + 'T12:00:00Z');
  while (out.length < n) { d = new Date(d.getTime() + 86400000); if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10) + ' (' + DAYS[d.getUTCDay()] + ')'); }
  return out;
}
function onsitego_book_service({ serial, fault_description, preferred_date, preferred_slot = 'morning', contact_name, contact_phone, address, pincode }) {
  const today = istToday();
  if (!preferred_date || isNaN(new Date(preferred_date + 'T12:00:00Z'))) {
    return { success: false, error: 'preferred_date must be YYYY-MM-DD', today, next_available_dates: nextWorkingDays(today, 3) };
  }
  if (preferred_date <= today) {
    return { success: false, error: `Earliest bookable date is tomorrow. Today is ${today} (${dayName(today)}).`, next_available_dates: nextWorkingDays(today, 3) };
  }
  if (dayName(preferred_date) === 'Sunday') {
    return { success: false, error: `${preferred_date} is a Sunday, outside household H001 window (Mon-Sat 10:00-18:00).`, next_available_dates: nextWorkingDays(preferred_date, 3) };
  }
  const sr_id = `OSG-SR-${++srSeq}`;
  const ent = findEntitlement(serial);
  const paid = !ent || ent.status === 'NOT_COVERED';
  const slots = { morning: '10:00–13:00', afternoon: '13:00–17:00', evening: '17:00–19:00' };
  const record = {
    sr_id, serial, fault_description, preferred_date,
    confirmed_slot: slots[preferred_slot] || preferred_slot,
    contact_name, contact_phone, address, pincode,
    service_type: paid ? 'PAID' : 'WARRANTY',
    contract_id: ent ? ent.contract_id : null,
    technician_name: paid ? 'Ramesh Kumar' : 'Suresh Sharma',
    technician_phone: paid ? '98765-00001' : '98765-00002',
    status: 'BOOKED',
    created_at: new Date().toISOString(),
  };
  serviceRequests.set(sr_id, record);
  logEvent(serial, `Service booked ${sr_id} for ${preferred_date} ${record.confirmed_slot} (${record.service_type})`, { service_request_id: sr_id, evidence: 'CLAIMED' });
  return {
    success: true,
    service_request_id: sr_id,
    status: 'BOOKED',
    service_type: record.service_type,
    contract_id: record.contract_id,
    technician_name: record.technician_name,
    technician_phone: record.technician_phone,
    confirmed_date: preferred_date,
    confirmed_slot: record.confirmed_slot,
    note: paid
      ? 'No warranty/AMC found — booked as paid service. Charges apply per technician quote.'
      : `Booked under ${ent.contract_type} ${ent.contract_id}.`,
  };
}

// Seeded records so status checks work even after the server restarts. OSG-SR-0777 = scenario E7.
const SEEDED_SR = {
  'OSG-SR-0777': {
    sr_id: 'OSG-SR-0777', serial: 'VLT-AC-2024-10234', fault_description: 'AC not cooling',
    preferred_date: '2026-10-05', confirmed_slot: '10:00–13:00', service_type: 'WARRANTY', contract_id: 'W-VLT-AC-2024-10234',
    technician_name: 'Suresh Sharma', technician_phone: '98765-00002', status: 'TECHNICIAN_EN_ROUTE',
    technician_location: 'Sector 62, Noida 201301', technician_eta_claimed_minutes: 10, household_pincode: '122003',
  },
};
// OSG-SR-0500: demo visit booked yesterday for today. Technician on site; once a dispute exists the centre marks it completed.
function seededToday(id) {
  if (id !== 'OSG-SR-0500') return null;
  const today = istToday();
  const disputed = [...disputes.values()].some(d => resolveAppliance(d.serial) === 'AC-10234');
  return {
    sr_id: 'OSG-SR-0500', serial: 'VLT-AC-2024-10234', fault_description: 'AC not cooling', preferred_date: today,
    confirmed_slot: '10:00–13:00', service_type: 'WARRANTY', contract_id: 'W-VLT-AC-2024-10234',
    technician_name: 'Suresh Sharma', technician_phone: '98765-00002', centre: 'VSC-GGN-01',
    status: disputed ? 'COMPLETED_BY_PROVIDER' : 'TECHNICIAN_ON_SITE',
    provider_note: disputed ? 'Centre reports gas pressure checked and topped up; AC cooling restored. Awaiting household confirmation.' : 'Technician on site, diagnosing.',
  };
}
function onsitego_service_status({ service_request_id }) {
  const sr = serviceRequests.get(service_request_id) || SEEDED_SR[service_request_id] || seededToday(service_request_id);
  if (!sr) return { found: false, service_request_id, error: 'Service request not found. Check the ID returned by onsitego_book_service.' };
  return { found: true, ...sr };
}

// Capability 2b: dispute a charge with the authorised centre through the service request.
const disputes = new Map();
function onsitego_raise_dispute({ service_request_id, serial, charge_rs, reason, clause, evidence_requested }) {
  const ent = findEntitlement(serial);
  const centre = ent && ent.brand === 'Voltas' ? 'VSC-GGN-01' : ent && ent.brand === 'IFB' ? 'IFB-GGN-02' : ent && ent.brand === 'LG' ? 'LG-GGN-03' : 'UNKNOWN';
  const dispute_id = `DSP-${String(serial || 'X').slice(-5)}-${Date.now().toString().slice(-6)}`;
  const rec = { dispute_id, service_request_id, serial, charge_rs, reason, clause, evidence_requested, centre, status: 'SENT_TO_CENTRE', raised_at: new Date().toISOString() };
  disputes.set(dispute_id, rec);
  logEvent(serial, `Dispute ${dispute_id} raised: Rs ${charge_rs} — ${reason}`, { dispute_id, clause, evidence: 'UNRECONCILED' });
  return { success: true, ...rec, response_due: 'within 4 hours', note: `Dispute delivered to ${centre} via Onsitego service request.` };
}
function onsitego_dispute_status({ dispute_id, serial }) {
  let d = disputes.get(dispute_id);
  if (!d && serial) { const list = [...disputes.values()].filter(x => resolveAppliance(x.serial) === resolveAppliance(serial)); d = list[list.length - 1]; }
  if (!d) return { found: false, dispute_id, status: 'PENDING', note: 'No centre response yet.' };
  if (/3\.5/.test(String(d.clause)) || (resolveAppliance(d.serial) === 'AC-10234' && /gas|visit|inspect|diagnos/i.test(String(d.reason)) && !/refill|top.?up|pcb|electric/i.test(String(d.reason)))) {
    return { found: true, ...d, status: 'CHARGE_WITHDRAWN', centre_response: 'Inspection/gas check is in-warranty diagnosis under CL-VLT-3.5. Charge of Rs ' + (d.charge_rs ?? '') + ' withdrawn. Rs 0 payable.' };
  }
  if (/6\.1|electrical|pcb|voltage/i.test(`${d.clause} ${d.reason}`)) {
    return { found: true, ...d, status: 'EXCLUSION_MAINTAINED', centre_response: 'Centre maintains electrical-event exclusion. Evidence provided: technician job sheet only; no surge report or stabiliser fault record.' };
  }
  return { found: true, ...d, status: 'UNDER_REVIEW', centre_response: 'Centre reviewing the dispute.' };
}

// Household profile (synthetic, mirrors KB file pakka_kb_01). Returned with lookups so bookings use real facts.
const HOUSEHOLD = {
  household_id: 'H001',
  decision_maker: 'Arjun Mehta', contact_phone: '9000000001',
  alternate_contact: 'Neha Mehta', alternate_phone: '9000000002',
  address: 'Sector 45, Gurugram, Haryana', pincode: '122003',
  service_window: 'Monday-Saturday 10:00-18:00 IST (no Sundays)',
  spend_limit_rs: 2000,
  language: 'English; Hindi-English mix acceptable',
  pine_labs_customer_ref: 'PL-CUST-H001',
  appliances: [
    { appliance_id: 'AC-10234', type: 'Split AC', brand: 'Voltas', serial: 'VLT-AC-2024-10234', cover: 'Warranty to 2027-04-17' },
    { appliance_id: 'WM-20881', type: 'Washing machine', brand: 'IFB', serial: 'IFB-WM-2023-20881', cover: 'AMC to 2027-06-01' },
    { appliance_id: 'RF-30772', type: 'Refrigerator', brand: 'LG', serial: 'LG-RF-2022-30772', cover: 'None (paid repairs)' },
  ],
};
function resolveAppliance(x) {
  const q = String(x || '').toLowerCase();
  const ent = findEntitlement(x);
  if (ent) return ent.appliance_id;
  if (/\bac\b|air ?con|split/.test(q)) return 'AC-10234';
  if (/wash|wm\b|ifb/.test(q)) return 'WM-20881';
  if (/fridge|refrig|rf\b|lg/.test(q)) return 'RF-30772';
  return null;
}

// Pakka's own service memory (appliance record + event log). Seeded from the household's documents.
const SERVICE_MEMORY = {
  'AC-10234': [
    { date: '2026-08-12', event: 'Compressor repair under warranty W-VLT-AC-2024-10234', amount_rs: 0, evidence: 'RECONCILED' },
    { date: '2026-08-18', event: 'Stabiliser (5 kVA) inspected, functional', amount_rs: 0, evidence: 'RECONCILED' },
    { date: '2026-09-30', event: 'Diagnostic visit', amount_rs: 0, evidence: 'RECONCILED' },
  ],
  'WM-20881': [],
  'RF-30772': [],
};
function memKey(id) {
  return resolveAppliance(id) || String(id || '').toUpperCase();
}
function openItems() {
  const items = [];
  for (const o of orders.values()) if (['PRE_AUTH_CREATED', 'CREATED'].includes(o.status)) items.push({ type: 'payment_hold', order_id: o.order_id, merchant_order_id: o.merchant_order_id, amount_rs: o.amount / 100, status: o.status, appliance_id: resolveAppliance(o.merchant_order_id || o.description) });
  for (const d of disputes.values()) if (!['CHARGE_WITHDRAWN'].includes(d.status)) items.push({ type: 'dispute', dispute_id: d.dispute_id, charge_rs: d.charge_rs, appliance_id: resolveAppliance(d.serial) });
  for (const r of serviceRequests.values()) if (r.status === 'BOOKED') items.push({ type: 'service_request', service_request_id: r.sr_id, date: r.preferred_date, appliance_id: resolveAppliance(r.serial) });
  return items;
}
function service_memory_read({ appliance_id }) {
  const k = memKey(appliance_id);
  if (!(k in SERVICE_MEMORY)) return { found: false, appliance_id, household: HOUSEHOLD, open_items: openItems(), note: 'Appliance not identified. open_items lists everything still open for the household (holds, disputes, jobs).' };
  const a = HOUSEHOLD.appliances.find(x => x.appliance_id === k);
  const today = istToday();
  return { found: true, appliance: a, household: HOUSEHOLD, events: SERVICE_MEMORY[k], open_items: openItems().filter(x => x.appliance_id === k), today: `${today} (${dayName(today)})` };
}
function service_memory_append({ appliance_id, event, amount_rs = 0, evidence_status = 'CLAIMED', next_due_date = null }) {
  const k = memKey(appliance_id);
  if (!(k in SERVICE_MEMORY)) return { success: false, error: 'Unknown appliance.' };
  const entry = { date: new Date().toISOString().slice(0, 10), event, amount_rs, evidence: evidence_status, next_due_date };
  SERVICE_MEMORY[k].push(entry);
  return { success: true, appliance_id: k, appended: entry, total_events: SERVICE_MEMORY[k].length };
}

// ──── Gnani ────

async function gnani_speech_to_text({ audio_url, language, audio_format = 'wav' }) {
  const key = process.env.GNANI_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://asr.gnani.ai/api/v1/asr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url, language, format: audio_format }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const d = await r.json();
        return { success: true, transcript: d.transcript || d.text, language, confidence: d.confidence || null, source: 'gnani_live' };
      }
    } catch (_) { /* fall through to mock */ }
  }
  const MOCKS = {
    'hi-IN':    'मेरा एसी बिल्कुल ठंडा नहीं हो रहा, सुबह से बंद है।',
    'ta-IN':    'என் ஏசி குளிர்ச்சி இல்லாமல் இயங்குகிறது.',
    'en-IN':    'My air conditioner stopped cooling since this morning.',
    'hi-IN-en': 'Yaar mera AC bilkul cool nahi kar raha, koi gas leak toh nahi?',
  };
  return { success: true, transcript: MOCKS[language] || 'Audio transcription (mock).', language, confidence: 0.91, source: 'mock' };
}

async function gnani_text_to_speech({ text, language, voice = 'female', output_format = 'wav' }) {
  const key = process.env.GNANI_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://tts.gnani.ai/api/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, voice, format: output_format }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const d = await r.json();
        return { success: true, audio_url: d.audio_url, duration_seconds: d.duration, source: 'gnani_live' };
      }
    } catch (_) { /* fall through to mock */ }
  }
  return {
    success: true,
    audio_url: `https://pakka-mock.vercel.app/mock-audio/${language}-${uid()}.wav`,
    duration_seconds: Math.ceil(text.length / 12),
    text, language, voice, source: 'mock',
  };
}

// ─────────────────────────────────────────────
// TOOL DEFINITIONS (MCP schema)
// ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'onsitego_raise_dispute',
    description: 'Challenge a doorstep charge with the brand-authorised service centre through the Onsitego service request. Cite the entitlement clause; request written evidence if an exclusion is claimed. Returns a dispute_id.',
    inputSchema: { type: 'object', properties: {
      service_request_id: { type: 'string', description: 'Onsitego service request ID if known' },
      serial: { type: 'string', description: 'Appliance serial number' },
      charge_rs: { type: 'number', description: 'Amount the technician is asking, in Rs' },
      reason: { type: 'string', description: 'Why the charge is disputed' },
      clause: { type: 'string', description: 'Entitlement clause cited, e.g. CL-VLT-3.5' },
      evidence_requested: { type: 'string', description: 'Written evidence requested from the centre, if any' },
    }, required: ['serial', 'charge_rs', 'reason'] },
  },
  {
    name: 'onsitego_dispute_status',
    description: "Get the service centre's response to a dispute raised with onsitego_raise_dispute.",
    inputSchema: { type: 'object', properties: { dispute_id: { type: 'string', description: 'Dispute ID' } }, required: ['dispute_id'] },
  },
  {
    name: 'service_memory_read',
    description: "Read the household's service record and event log for an appliance (prior repairs, payments, evidence status). Call first on any trigger (R1).",
    inputSchema: { type: 'object', properties: { appliance_id: { type: 'string', description: 'Appliance ID (e.g. AC-10234) or serial' } }, required: ['appliance_id'] },
  },
  {
    name: 'service_memory_append',
    description: 'Append a service event to the appliance record (R23): what was done, amount, evidence status, next due date.',
    inputSchema: { type: 'object', properties: {
      appliance_id: { type: 'string', description: 'Appliance ID or serial' },
      event: { type: 'string', description: 'What happened' },
      amount_rs: { type: 'number', description: 'Amount paid or held, Rs' },
      evidence_status: { type: 'string', description: 'CLAIMED | CORROBORATED | RECONCILED | UNRECONCILED' },
      next_due_date: { type: 'string', description: 'Next service due date YYYY-MM-DD, if any' },
    }, required: ['appliance_id', 'event'] },
  },
  {
    name: 'delhivery_pincode_serviceability',
    description: 'Check whether a pincode is serviceable by Delhivery for parts delivery. Call before creating a shipment.',
    inputSchema: { type: 'object', properties: { pin: { type: 'string', description: '6-digit pincode' } }, required: ['pin'] },
  },
  {
    name: 'delhivery_create_shipment',
    description: 'Create a Delhivery parts shipment to the household address. Run delhivery_entitlement_gate and delhivery_pincode_serviceability first.',
    inputSchema: {
      type: 'object',
      properties: {
        waybill:      { type: 'string', description: 'Unique waybill / tracking number' },
        name:         { type: 'string', description: 'Recipient full name' },
        add:          { type: 'string', description: 'Recipient full delivery address' },
        pin:          { type: 'string', description: 'Recipient pincode' },
        phone:        { type: 'string', description: 'Recipient phone number' },
        product_desc: { type: 'string', description: 'Description of parts being shipped' },
        cod:          { type: 'number', description: 'Cash-on-delivery amount in Rs (0 for prepaid)' },
        payment_mode: { type: 'string', description: "'Prepaid' or 'COD'" },
      },
      required: ['waybill','name','add','pin','phone','product_desc'],
    },
  },
  {
    name: 'delhivery_pickup_request',
    description: 'Request Delhivery to pick up a shipment from a supplier or warehouse.',
    inputSchema: {
      type: 'object',
      properties: {
        pickup_location: { type: 'string', description: 'Name of pickup location' },
        pickup_date:     { type: 'string', description: 'Date in YYYY-MM-DD' },
        waybill:         { type: 'string', description: 'Waybill number of shipment to pick up' },
        pickup_time:     { type: 'string', description: "Time window e.g. '10:00-14:00'" },
      },
      required: ['pickup_location','pickup_date','waybill'],
    },
  },
  {
    name: 'delhivery_track_shipment',
    description: 'Track a Delhivery shipment to get current status and ETA.',
    inputSchema: {
      type: 'object',
      properties: { waybill: { type: 'string', description: 'Waybill number to track' } },
      required: ['waybill'],
    },
  },
  {
    name: 'delhivery_maps_distance_matrix',
    description: "Get road distance and travel time between the technician's location and the household. Use to validate technician ETA.",
    inputSchema: {
      type: 'object',
      properties: {
        origin:      { type: 'string', description: 'Origin address, pincode, or location name' },
        destination: { type: 'string', description: 'Destination address, pincode, or location name' },
      },
      required: ['origin','destination'],
    },
  },
  {
    name: 'delhivery_entitlement_gate',
    description: 'Verify that parts dispatch is authorised by entitlement before creating a Delhivery shipment. Blocked → do not dispatch; go to R6/R18.',
    inputSchema: {
      type: 'object',
      properties: {
        serial:           { type: 'string', description: 'Appliance serial number' },
        part_code:        { type: 'string', description: 'Part code or name to dispatch' },
        service_event_id: { type: 'string', description: 'Service event ID this dispatch is for' },
      },
      required: ['serial','part_code','service_event_id'],
    },
  },
  {
    name: 'pinelabs_create_order',
    description: 'Create a Pine Labs payment order. Set pre_auth=true to hold the household-liable amount without charging — capture only after service is CORROBORATED.',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_order_id: { type: 'string', description: 'Unique reference — use service event ID, e.g. SE-AC-10234-2026-10-03' },
        amount:            { type: 'number', description: 'Amount in paise (Rs 1 = 100 paise, so Rs 650 → 65000)' },
        currency:          { type: 'string', description: "Always 'INR'" },
        customer_ref:      { type: 'string', description: 'Customer reference — use PL-CUST-H001 for Household H001' },
        pre_auth:          { type: 'boolean', description: 'true = hold without charging; false = charge immediately' },
        description:       { type: 'string', description: 'Short description of the charge' },
      },
      required: ['merchant_order_id','amount','currency','customer_ref'],
    },
  },
  {
    name: 'pinelabs_capture_order',
    description: 'Capture (charge) a pre-authorised Pine Labs order. Call only after service is CORROBORATED and within the household spend limit or with explicit approval.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Pine Labs order_id returned by pinelabs_create_order' },
        amount:   { type: 'number', description: 'Amount in paise to capture (≤ pre-auth amount)' },
      },
      required: ['order_id','amount'],
    },
  },
  {
    name: 'pinelabs_cancel_order',
    description: 'Cancel a Pine Labs order or release a pre-auth hold. Use when household says do not pay, or service is not corroborated, or charge contradicts entitlement.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Pine Labs order_id to cancel' },
        reason:   { type: 'string', description: 'Reason for cancellation' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'pinelabs_get_order',
    description: 'Get current status of a Pine Labs order. ALWAYS call this before creating a new order or retrying when payment status is unknown or timed out. Never double-charge.',
    inputSchema: {
      type: 'object',
      properties: { order_id: { type: 'string', description: 'Pine Labs order_id to check' } },
      required: ['order_id'],
    },
  },
  {
    name: 'pinelabs_create_payment_link',
    description: 'Create a self-service payment link to send to the household (declined card, low balance, or household prefers to pay directly). One link only — no retries.',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_order_id: { type: 'string', description: 'Unique order reference' },
        amount:            { type: 'number', description: 'Amount in paise' },
        currency:          { type: 'string', description: "Always 'INR'" },
        customer_ref:      { type: 'string', description: 'Customer reference' },
        expiry_minutes:    { type: 'number', description: 'Link validity in minutes (default 60)' },
        description:       { type: 'string', description: 'Payment description shown to household' },
      },
      required: ['merchant_order_id','amount','currency','customer_ref'],
    },
  },
  {
    name: 'pinelabs_create_refund',
    description: 'Initiate a refund for a captured Pine Labs order — use for service recurrence refund or charge not owed.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Pine Labs order_id to refund' },
        amount:   { type: 'number', description: 'Refund amount in paise' },
        reason:   { type: 'string', description: 'Reason for refund' },
      },
      required: ['order_id','amount'],
    },
  },
  {
    name: 'onsitego_entitlement_lookup',
    description: 'Look up warranty or AMC entitlement for an appliance by serial number. Returns covered components, clause text, exclusions, deductible, expiry, past claims AND the household service history (so no separate memory read is needed).',
    inputSchema: {
      type: 'object',
      properties: { serial: { type: 'string', description: 'Appliance serial number, e.g. VLT-AC-2024-10234' } },
      required: ['serial'],
    },
  },
  {
    name: 'onsitego_book_service',
    description: 'Book a service visit through Onsitego. Returns technician details and confirmed slot. Run onsitego_entitlement_lookup first.',
    inputSchema: {
      type: 'object',
      properties: {
        serial:            { type: 'string', description: 'Appliance serial number' },
        fault_description: { type: 'string', description: 'Fault as reported by household' },
        preferred_date:    { type: 'string', description: 'Preferred date YYYY-MM-DD' },
        preferred_slot:    { type: 'string', description: "'morning' (10-13) | 'afternoon' (13-17) | 'evening' (17-19)" },
        contact_name:      { type: 'string', description: 'Contact person at service location' },
        contact_phone:     { type: 'string', description: 'Contact phone' },
        address:           { type: 'string', description: 'Full service address' },
        pincode:           { type: 'string', description: 'Pincode of service location' },
      },
      required: ['serial','fault_description','preferred_date','contact_name','contact_phone','address','pincode'],
    },
  },
  {
    name: 'onsitego_service_status',
    description: 'Get the current status of a service request booked through Onsitego.',
    inputSchema: {
      type: 'object',
      properties: { service_request_id: { type: 'string', description: 'Onsitego service request ID, e.g. OSG-SR-1001' } },
      required: ['service_request_id'],
    },
  },
  {
    name: 'gnani_speech_to_text',
    description: 'Transcribe a household voice note to text (R2). Supports hi-IN (Hindi), ta-IN (Tamil), en-IN (English), hi-IN-en (Hinglish). Always transcribe before processing voice input.',
    inputSchema: {
      type: 'object',
      properties: {
        audio_url:    { type: 'string', description: 'URL of audio file (WAV / MP3 / OGG)' },
        language:     { type: 'string', description: "'hi-IN' | 'ta-IN' | 'en-IN' | 'hi-IN-en'" },
        audio_format: { type: 'string', description: "'wav' | 'mp3' | 'ogg' — default wav" },
      },
      required: ['audio_url','language'],
    },
  },
  {
    name: 'gnani_text_to_speech',
    description: 'Synthesise a spoken reply (R2). Use to read back amounts, ticket numbers, or confirmations on voice calls.',
    inputSchema: {
      type: 'object',
      properties: {
        text:          { type: 'string', description: 'Text to speak' },
        language:      { type: 'string', description: "'hi-IN' | 'ta-IN' | 'en-IN'" },
        voice:         { type: 'string', description: "'female' | 'male' — default female" },
        output_format: { type: 'string', description: "'wav' | 'mp3' — default wav" },
      },
      required: ['text','language'],
    },
  },
];

// ─────────────────────────────────────────────
// PERSISTENCE (Upstash Redis via REST). Falls back to memory if not configured.
// ─────────────────────────────────────────────
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const STATE_KEY = 'pakka_state_v1';
function todayBookingEvent() {
  const y = new Date(Date.now() + 5.5 * 3600000 - 86400000).toISOString().slice(0, 10);
  return { date: y, event: `Service booked OSG-SR-0500 for ${istToday()} 10:00–13:00 (WARRANTY), technician Suresh Sharma`, service_request_id: 'OSG-SR-0500', evidence: 'CLAIMED' };
}
SERVICE_MEMORY['AC-10234'].push(todayBookingEvent());
const SEED_MEMORY = JSON.parse(JSON.stringify(SERVICE_MEMORY));
async function kv(cmd) {
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}
function fillMap(m, obj) { m.clear(); for (const [k, v] of Object.entries(obj || {})) m.set(k, v); }
function resetState() {
  serviceRequests.clear(); orders.clear(); shipments.clear(); disputes.clear();
  for (const k of Object.keys(SERVICE_MEMORY)) delete SERVICE_MEMORY[k];
  Object.assign(SERVICE_MEMORY, JSON.parse(JSON.stringify(SEED_MEMORY)));
  SERVICE_MEMORY['AC-10234'] = SERVICE_MEMORY['AC-10234'].filter(e => e.service_request_id !== 'OSG-SR-0500').concat([todayBookingEvent()]);
  srSeq = 1000; ordSeq = 5000;
}
async function loadState() {
  if (!KV_URL || !KV_TOKEN) return 'memory';
  try {
    const raw = await kv(['GET', STATE_KEY]);
    if (!raw) return 'kv-empty';
    const st = JSON.parse(raw);
    fillMap(serviceRequests, st.serviceRequests); fillMap(orders, st.orders); fillMap(shipments, st.shipments); fillMap(disputes, st.disputes);
    for (const k of Object.keys(SERVICE_MEMORY)) delete SERVICE_MEMORY[k];
    Object.assign(SERVICE_MEMORY, st.memory || JSON.parse(JSON.stringify(SEED_MEMORY)));
    srSeq = st.srSeq || 1000; ordSeq = st.ordSeq || 5000;
    return 'kv';
  } catch (e) { console.error('[pakka-mock] kv load failed', String(e)); return 'kv-error'; }
}
async function saveState() {
  if (!KV_URL || !KV_TOKEN) return;
  const st = { serviceRequests: Object.fromEntries(serviceRequests), orders: Object.fromEntries(orders), shipments: Object.fromEntries(shipments), disputes: Object.fromEntries(disputes), memory: SERVICE_MEMORY, srSeq, ordSeq };
  try { await kv(['SET', STATE_KEY, JSON.stringify(st)]); } catch (e) { console.error('[pakka-mock] kv save failed', String(e)); }
}
// Partner systems write their events into the household record (like webhooks), so a later run can find IDs.
function logEvent(idOrSerial, event, extra = {}) {
  const k = resolveAppliance(idOrSerial);
  if (!k || !(k in SERVICE_MEMORY)) return;
  SERVICE_MEMORY[k].push({ date: istToday(), event, ...extra });
}

// One server, four connectors: ?rail=delhivery|pinelabs|onsitego|gnani
// returns only that rail's tools. No rail = all 17.
const RAILS = ['delhivery', 'pinelabs', 'onsitego', 'gnani', 'pl'];
function toolsForRail(rail) {
  if (!rail || !RAILS.includes(rail)) return TOOLS;
  // Platform workaround (03 Oct 2026): AgenticOrg's authorized_tools check accepts only tools
  // discovered on mcp_pinelabs_pakka, so that connector exposes the full catalogue.
  if (rail === 'pinelabs') return TOOLS;
  // Test 03 Oct: same 17 tools, every name prefixed "pinelabs_" (platform accepts only pinelabs_* names).
  if (rail === 'pl') return TOOLS.map(t => t.name.startsWith('pinelabs_') ? t : { ...t, name: 'pinelabs_' + t.name });
  return TOOLS.filter(t => t.name.startsWith(rail + '_'));
}


// AgenticOrg may send arguments as a JSON string or wrapped (e.g. {input:{...}}). Unwrap to a flat object.
function normalizeArgs(a) {
  if (a == null) return {};
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { return { serial: a }; } }
  for (let i = 0; i < 3 && a && typeof a === 'object'; i++) {
    const keys = Object.keys(a);
    if (keys.length === 1 && ['input','arguments','args','kwargs','params','parameters','tool_input'].includes(keys[0])) {
      a = a[keys[0]];
      if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { return { serial: a }; } }
    } else break;
  }
  // Accept common aliases for serial
  if (a && a.serial == null) a.serial = a.serial_number || a.serialNumber || a.appliance_serial || a.appliance_id;
  return a || {};
}

// ─────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────

// AgenticOrg may send a qualified or display name, e.g. "mcp_onsitego_pakka:onsitego_entitlement_lookup",
// "mcp_onsitego_pakka__onsitego_entitlement_lookup" or "Onsitego Entitlement Lookup". Map it back to our name.
function resolveToolName(raw) {
  if (!raw) return raw;
  const names = TOOLS.map(t => t.name);
  let n = String(raw).trim().split(/[:.\/]/).pop().toLowerCase().replace(/[\s-]+/g, '_');
  if (names.includes(n)) return n;
  return names.find(t => n.endsWith(t)) || n;  // also covers pinelabs_onsitego_* -> onsitego_*
}

async function callTool(name, args) {
  name = resolveToolName(name);
  switch (name) {
    case 'delhivery_pincode_serviceability': return delhivery_pincode_serviceability(args);
    case 'delhivery_create_shipment':        return delhivery_create_shipment(args);
    case 'delhivery_pickup_request':         return delhivery_pickup_request(args);
    case 'delhivery_track_shipment':         return delhivery_track_shipment(args);
    case 'delhivery_maps_distance_matrix':   return delhivery_maps_distance_matrix(args);
    case 'delhivery_entitlement_gate':       return delhivery_entitlement_gate(args);
    case 'pinelabs_create_order':            return pinelabs_create_order(args);
    case 'pinelabs_capture_order':           return pinelabs_capture_order(args);
    case 'pinelabs_cancel_order':            return pinelabs_cancel_order(args);
    case 'pinelabs_get_order':               return pinelabs_get_order(args);
    case 'pinelabs_create_payment_link':     return pinelabs_create_payment_link(args);
    case 'pinelabs_create_refund':           return pinelabs_create_refund(args);
    case 'onsitego_entitlement_lookup':      return onsitego_entitlement_lookup(args);
    case 'onsitego_book_service':            return onsitego_book_service(args);
    case 'onsitego_service_status':          return onsitego_service_status(args);
    case 'onsitego_raise_dispute':           return onsitego_raise_dispute(args);
    case 'onsitego_dispute_status':          return onsitego_dispute_status(args);
    case 'service_memory_read':              return service_memory_read(args);
    case 'service_memory_append':            return service_memory_append(args);
    case 'gnani_speech_to_text':             return await gnani_speech_to_text(args);
    case 'gnani_text_to_speech':             return await gnani_text_to_speech(args);
    default: throw { code: -32601, message: `Tool not found: ${name}` };
  }
}

// ─────────────────────────────────────────────
// VERCEL REQUEST HANDLER
// ─────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — AgenticOrg may call from a different origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-ID');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const rail = (req.query && req.query.rail) || null;
  const railTools = toolsForRail(rail);

  // Health check (GET). ?reset=pakka-demo restores the seeded demo state (for re-recording).
  if (req.method === 'GET' && req.query && req.query.reset === 'pakka-demo') {
    resetState(); await saveState();
    res.status(200).json({ status: 'reset', store: KV_URL ? 'kv' : 'memory' });
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', server: 'pakka-mock-mcp', version: '1.13.0', store: (KV_URL && KV_TOKEN) ? 'kv' : 'memory', rail: rail || 'all', tools: railTools.map(t => t.name) });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body;
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Body must be JSON' }); return; }

  const { jsonrpc, method, params, id } = body;
  console.log('[pakka-mock] rpc', method, 'rail=' + (rail || 'all'));

  // Notifications require no response
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    res.status(202).end();
    return;
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: rail ? `${rail}_pakka` : 'pakka-mock-server', version: '1.0.0' },
        };
        break;

      case 'tools/list':
        result = { tools: railTools };
        break;

      case 'tools/call': {
        if (!params || !params.name) throw { code: -32602, message: 'Missing params.name' };
        // Rail only filters tools/list. Calls are accepted on any rail, because the
        // platform may route a tool through a different connector URL than it listed it on.
        const args = normalizeArgs(params.arguments);
        console.log('[pakka-mock] call', JSON.stringify({ rail, tool: params.name, resolved: resolveToolName(params.name), raw: params.arguments, args }));
        const store = await loadState();
        const toolResult = await callTool(params.name, args);
        await saveState();
        console.log('[pakka-mock] store', store);
        if (toolResult && typeof toolResult === 'object') toolResult._received_args = args;
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }

      case 'ping':
        result = {};
        break;

      default:
        return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    res.status(200).json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    console.error('[pakka-mock] error', JSON.stringify(err), 'method=' + method, 'params=' + JSON.stringify(params));
    if (method === 'tools/call') {
      return res.status(200).json({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message || String(err), tool_requested: params && params.name, known_tools: TOOLS.map(t => t.name) }) }] } });
    }
    res.status(200).json({
      jsonrpc: '2.0', id,
      error: { code: err.code || -32603, message: err.message || 'Internal server error' },
    });
  }
};
