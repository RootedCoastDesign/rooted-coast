// lib/pq/tenants.js
// ─────────────────────────────────────────────────────────────────────────────
// ROOTED COAST QUOTES — tenant registry.
//
// One deployment serves every client site. A "tenant" is one contractor: their
// branding, where their leads go, which questions the homeowner answers, and
// which photos we ask for.
//
// Adding a client is editing this file. Nothing else changes.
//
// The three fields that decide whether a lead is worth a 40-minute drive:
//   jobTypes     — what kind of work it is
//   questions    — the five things that change the price or the truck load
//   photoPrompts — telling the homeowner WHAT to shoot is the whole product.
//                  "Send photos" gets you a blurry cabinet. "Wide shot of the
//                  whole wall, close-up of the damage, the label on the unit"
//                  gets you something you can quote from.
//
// SECURITY: allowedOrigins gates who may POST a lead. Keep it tight — it is the
// only thing standing between a client's inbox and someone else's form spam.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Reusable question fragments ──────────────────────────────────────────────
// Every trade needs these two, worded the same way, so the lead page and the
// notification email can always show a timeline and an address.

const Q_TIMING = {
  id: 'timing',
  label: 'How soon do you need this done?',
  type: 'single',
  required: true,
  options: [
    'Emergency — today if possible',
    'This week',
    'Next few weeks',
    'Just planning ahead / getting a number',
  ],
};

const Q_ACCESS = {
  id: 'access',
  label: 'Anything we should know before we come out?',
  type: 'text',
  required: false,
  hint: 'Dogs, gate codes, stairs, parking, renter vs. owner, hours you are home.',
};

// ── Trade presets ────────────────────────────────────────────────────────────
// A preset is a starting point. Any tenant can override jobTypes, questions or
// photoPrompts with their own; see the tenant records at the bottom.

const PRESETS = {

  painting: {
    jobTypes: [
      'Exterior — whole house',
      'Exterior — trim, doors or deck only',
      'Interior — one or two rooms',
      'Interior — whole house',
      'Cabinets',
      'Fence or outbuilding',
      'Something else',
    ],
    questions: [
      {
        id: 'size',
        label: 'Roughly how big is the job?',
        type: 'single',
        required: true,
        options: [
          'One room or one small surface',
          'A few rooms, or one side of the house',
          'Whole house, one story',
          'Whole house, two stories',
          'Not sure — we will see when we walk it',
        ],
      },
      {
        id: 'surface',
        label: 'What shape is the existing paint in?',
        type: 'single',
        required: true,
        options: [
          'Good — just want a new color',
          'Some peeling or chalking',
          'Bad — bare wood showing, lots of prep',
          'Never been painted',
        ],
      },
      {
        id: 'substrate',
        label: 'What are we painting?',
        type: 'multi',
        required: false,
        options: ['Wood siding', 'Cedar shingles', 'T1-11', 'Hardie / fiber cement', 'Stucco', 'Vinyl', 'Metal', 'Drywall', 'Cabinets', 'Not sure'],
      },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The whole thing', hint: 'Stand back far enough to get the full wall, room or house in one frame.' },
      { label: 'The worst spot', hint: 'Close up on the peeling, damage or repair — the part that worries you.' },
      { label: 'A second angle', hint: 'The other side, or a corner shot that shows trim and edges.' },
    ],
  },

  'appliance-repair': {
    jobTypes: [
      'Refrigerator or freezer',
      'Washer',
      'Dryer',
      'Dishwasher',
      'Oven, stove or range',
      'Microwave or range hood',
      'Ice machine',
      'Commercial refrigeration',
      'Something else',
    ],
    questions: [
      {
        id: 'symptom',
        label: 'What is it doing?',
        type: 'single',
        required: true,
        options: [
          'Will not turn on at all',
          'Runs but does not heat / cool',
          'Leaking water',
          'Loud noise or grinding',
          'Error code on the display',
          'Something else — described below',
        ],
      },
      {
        id: 'age',
        label: 'Roughly how old is the unit?',
        type: 'single',
        required: true,
        options: ['Under 5 years', '5 to 10 years', 'Over 10 years', 'No idea'],
      },
      {
        id: 'detail',
        label: 'Anything else about the problem?',
        type: 'text',
        required: false,
        hint: 'When it started, what you have already tried, the exact error code.',
      },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The whole appliance', hint: 'Full unit, where it sits, doors closed.' },
      { label: 'The model and serial plate', hint: 'Usually inside the door, on the back, or under the lid. This one saves a trip — it tells us the parts before we drive out.' },
      { label: 'The problem', hint: 'The leak, the error code on the screen, the burnt spot.' },
    ],
  },

  cleaning: {
    jobTypes: [
      'Recurring commercial janitorial',
      'One-time deep clean',
      'Move-out or turnover clean',
      'Post-construction clean',
      'Floor care — strip, wax, carpet',
      'Window cleaning',
      'Something else',
    ],
    questions: [
      {
        id: 'sqft',
        label: 'Roughly how big is the space?',
        type: 'single',
        required: true,
        options: [
          'Under 1,000 sq ft',
          '1,000 to 3,000 sq ft',
          '3,000 to 10,000 sq ft',
          'Over 10,000 sq ft',
          'Not sure',
        ],
      },
      {
        id: 'frequency',
        label: 'How often?',
        type: 'single',
        required: true,
        options: ['One time only', 'Weekly', 'Two or three times a week', 'Nightly', 'Monthly', 'Not sure yet'],
      },
      {
        id: 'scope',
        label: 'What needs covering?',
        type: 'multi',
        required: false,
        options: ['Restrooms', 'Break room or kitchen', 'Offices', 'Hard floors', 'Carpet', 'Windows', 'Trash and recycling', 'Common areas', 'Warehouse or shop floor'],
      },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The main space', hint: 'Wide shot from the doorway so we can see the layout and the floor type.' },
      { label: 'Restrooms or the hardest area', hint: 'The part that takes the most time.' },
      { label: 'Floors up close', hint: 'Tile, vinyl, carpet or concrete — it changes the equipment we bring.' },
    ],
  },

  roofing: {
    jobTypes: ['Leak repair', 'Full re-roof', 'Gutters', 'Moss or cleaning', 'Skylight or flashing', 'Storm damage', 'Something else'],
    questions: [
      { id: 'material', label: 'What is on the roof now?', type: 'single', required: true, options: ['Composition shingle', 'Metal', 'Cedar shake', 'Flat / torch-down', 'Tile', 'Not sure'] },
      { id: 'stories', label: 'How many stories?', type: 'single', required: true, options: ['One', 'Two', 'Three or more', 'Split level'] },
      { id: 'leaking', label: 'Is it leaking inside right now?', type: 'single', required: true, options: ['Yes, actively', 'Only in heavy rain', 'No — planning ahead'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The whole house from the street', hint: 'Far enough back to see the full roof line.' },
      { label: 'The problem area', hint: 'Zoom in from the ground — please do not climb up for this.' },
      { label: 'Inside damage', hint: 'Ceiling stain, wet insulation, attic if you can reach it safely.' },
    ],
  },

  plumbing: {
    jobTypes: ['Leak', 'Clogged drain', 'Water heater', 'Toilet', 'Faucet or fixture', 'Repipe', 'Well or pump', 'Something else'],
    questions: [
      { id: 'water_off', label: 'Is water actively running or leaking?', type: 'single', required: true, options: ['Yes — right now', 'I shut the water off', 'No, it is intermittent', 'No'] },
      { id: 'fixture_age', label: 'How old is the house or the fixture?', type: 'single', required: true, options: ['Under 10 years', '10 to 30 years', 'Over 30 years', 'No idea'] },
      { id: 'detail', label: 'What happened?', type: 'text', required: false, hint: 'When it started and what you have already tried.' },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The fixture or appliance', hint: 'Full shot including the shutoff valves and supply lines.' },
      { label: 'The leak or damage', hint: 'Close up on the wet spot, drip or corrosion.' },
      { label: 'Under the sink / behind the unit', hint: 'The pipe connections. This is the shot that tells us what fittings to bring.' },
    ],
  },

  electrical: {
    jobTypes: ['Outlet or switch not working', 'Panel upgrade', 'New circuit', 'EV charger', 'Lighting', 'Generator or transfer switch', 'Inspection or repair list', 'Something else'],
    questions: [
      { id: 'scope', label: 'What is going on?', type: 'single', required: true, options: ['Something stopped working', 'Breaker keeps tripping', 'Adding something new', 'Buying or selling — need it fixed for inspection', 'Burning smell or sparks'] },
      { id: 'panel', label: 'Do you know your panel brand or amperage?', type: 'text', required: false, hint: 'Federal Pacific, Zinsco, 100A, 200A. A photo of the panel label covers this.' },
      { id: 'house_age', label: 'Roughly how old is the house?', type: 'single', required: true, options: ['Under 20 years', '20 to 50 years', 'Over 50 years', 'No idea'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The electrical panel, door open', hint: 'Straight on, breakers visible. Do not remove the inner cover.' },
      { label: 'The outlet, switch or fixture', hint: 'Close enough to read any labels.' },
      { label: 'Where the new work would go', hint: 'Wide shot of the wall, garage or driveway.' },
    ],
  },

  hvac: {
    jobTypes: ['Heat pump', 'Furnace', 'Mini split', 'Ductwork', 'Water heater', 'Maintenance', 'New install or replacement', 'Something else'],
    questions: [
      { id: 'symptom', label: 'What is it doing?', type: 'single', required: true, options: ['No heat', 'No cooling', 'Runs constantly', 'Making noise', 'Error code', 'Nothing wrong — want a quote on new equipment'] },
      { id: 'age', label: 'How old is the system?', type: 'single', required: true, options: ['Under 5 years', '5 to 15 years', 'Over 15 years', 'No idea'] },
      { id: 'sqft', label: 'Roughly how big is the house?', type: 'single', required: false, options: ['Under 1,000 sq ft', '1,000 to 2,000 sq ft', '2,000 to 3,000 sq ft', 'Over 3,000 sq ft'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The outdoor unit', hint: 'Whole unit plus a few feet around it.' },
      { label: 'The data plate', hint: 'The sticker with model and serial. Saves us a parts trip.' },
      { label: 'The indoor unit or thermostat', hint: 'Include any error code on the display.' },
    ],
  },

  flooring: {
    jobTypes: ['Carpet', 'LVP or laminate', 'Hardwood', 'Tile', 'Subfloor repair', 'Refinishing', 'Something else'],
    questions: [
      { id: 'rooms', label: 'Which areas?', type: 'multi', required: true, options: ['Living room', 'Bedrooms', 'Kitchen', 'Bathrooms', 'Hallway', 'Stairs', 'Whole house'] },
      { id: 'sqft', label: 'Roughly how many square feet?', type: 'single', required: true, options: ['Under 200', '200 to 500', '500 to 1,000', 'Over 1,000', 'Not sure'] },
      { id: 'existing', label: 'What is down now, and does it need to come out?', type: 'text', required: false, hint: 'Old carpet, tile over concrete, subfloor is soft in one corner…' },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The room from the doorway', hint: 'So we can see the size and the transitions.' },
      { label: 'The existing floor up close', hint: 'Close enough to see what it is made of.' },
      { label: 'Any damage or soft spots', hint: 'Water stains, buckling, gaps at the walls.' },
    ],
  },

  landscaping: {
    jobTypes: ['Yard cleanup', 'Regular mowing and maintenance', 'Tree or brush removal', 'New planting or beds', 'Hardscape — patio, wall, path', 'Fence', 'Irrigation', 'Something else'],
    questions: [
      { id: 'lot', label: 'Roughly how big is the area?', type: 'single', required: true, options: ['Small city lot', 'Quarter acre', 'Half to one acre', 'Over an acre', 'Not sure'] },
      { id: 'condition', label: 'What shape is it in?', type: 'single', required: true, options: ['Maintained, just needs regular service', 'Overgrown but manageable', 'Badly overgrown — has not been touched in years', 'Bare ground / new build'] },
      { id: 'access', label: 'Can a truck and trailer get back there?', type: 'single', required: false, options: ['Yes, easy access', 'Tight — narrow gate or steep drive', 'No vehicle access, hand carry only', 'Not sure'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The whole area', hint: 'Stand at the edge and get as much in frame as you can.' },
      { label: 'The worst part', hint: 'The blackberries, the dead tree, the spot that made you call.' },
      { label: 'The access route', hint: 'The gate, driveway or side yard we would bring equipment through.' },
    ],
  },

  general: {
    jobTypes: ['Repair', 'Remodel', 'New construction', 'Maintenance', 'Inspection or estimate only', 'Something else'],
    questions: [
      { id: 'describe', label: 'What needs doing?', type: 'text', required: true, hint: 'A sentence or two is plenty — the photos do the rest.' },
      { id: 'size', label: 'Roughly how big a job is this?', type: 'single', required: true, options: ['Half a day', 'A day or two', 'About a week', 'Several weeks', 'No idea'] },
      { id: 'property', label: 'What kind of property?', type: 'single', required: false, options: ['House I own', 'House I rent', 'Rental I own', 'Commercial', 'Vacation rental'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'The whole area', hint: 'Wide shot showing context.' },
      { label: 'The problem, close up', hint: 'The part you want fixed.' },
      { label: 'A second angle', hint: 'Anything else that helps us understand the space.' },
    ],
  },
};

// ── Tenants ──────────────────────────────────────────────────────────────────
// notifyEmail may hold more than one address. sms is optional and only used if
// a Twilio key is configured (see lib/pq/notify.js) — leave it null otherwise.
//
// allowedOrigins: exact scheme+host, no trailing slash. Include both apex and
// www if the client's site answers on both.

// In this public copy every notification address is a placeholder. The real ones are kept out of the repository.
const TENANTS = {

  // Replaces the four-field estimate form that used to post to web3forms.
  // The widget sits inside their dark #estimate section, so the theme below is
  // pulled straight from their stylesheet rather than approximated.
  'england-brothers': {
    slug: 'england-brothers',
    name: 'England Brothers Painting',
    legalName: 'England Brothers Painting LLC',
    trade: 'painting',
    city: 'Bandon, Oregon',
    phone: '+15415510920',
    notifyEmail: ['leads@england-brothers.example'],
    sms: null,
    siteUrl: 'https://englandbrotherspainting.com',
    allowedOrigins: [
      'https://englandbrotherspainting.com',
      'https://www.englandbrotherspainting.com',
    ],

    brand: {
      color: '#B70202',        // --accent, their button red
      text: '#FAF3E3',         // --accent-ink
      accent: '#C79A55',       // --brass. Their red is unreadable as small text
                               // on #14100D, which is why their own eyebrows
                               // are brass. Same reason here.
      surface: 'dark',         // it sits in the dark .estimate panel
      dark: {
        bg: '#14100D',         // --dark
        panel: '#1E1813',      // --dark-2, what their inputs use
        line: '#3A3025',       // --dark-line
        lineSoft: '#3A3025',
        head: '#F2E9D6',       // --dark-ink
        body: '#B9AC96',       // --dark-soft
        dim: '#9A8D79',
        bad: '#FF8A80',
      },
      radius: '0px',           // --radius:0px — square corners everywhere
      font: "'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif",
      headFont: "'Anton','Arial Narrow',Impact,sans-serif",
      headUppercase: true,
      headSpacing: '.015em',
    },

    // Painters cannot price from photos — every job gets walked and measured
    // before a number goes on paper. Say so. The photos earn their place by
    // telling the brothers what they are walking into: how much prep, how many
    // stories, whether it is a half-day or a week. Never promise a price here.
    // Photos are optional for the brothers: a homeowner who cannot get a good
    // shot still gets a callback, and the walk-through covers the rest.
    photosRequired: false,
    heading: 'Show us the job',
    intro: 'We walk and measure every job before we price it. Photos tell us what to bring and how long to plan for, so the walk-through is the last step instead of the first phone call.',
    doneNote: 'England Brothers Painting has your {photos} and your answers. Expect a call within one business day to set up the walk-through.',

    // Their old form let people tick several kinds of work at once, so the
    // job types below are their chip vocabulary and question 3 keeps the
    // multi-select. Dropping that would have been a step backwards from the
    // form this replaces.
    jobTypes: [
      'Exterior',
      'Interior',
      'Cabinets',
      'Deck, fence or railing',
      'Pressure washing',
      'New construction',
    ],

    questions: [
      {
        id: 'size',
        label: 'Roughly how big is the job?',
        type: 'single',
        required: true,
        options: [
          'One room or one small surface',
          'A few rooms, or one side of the house',
          'Whole house, one story',
          'Whole house, two stories',
          'Not sure — we will see when we walk it',
        ],
      },
      {
        id: 'surface',
        label: 'What shape is the existing paint in?',
        type: 'single',
        required: true,
        options: [
          'Good — just want a new color',
          'Some peeling or chalking',
          'Bad — bare wood showing, lots of prep',
          'Never been painted',
        ],
      },
      {
        id: 'also',
        label: 'Anything else while we are out there?',
        type: 'multi',
        required: false,
        hint: 'Tick anything you would want in the same quote.',
        options: [
          'Exterior', 'Interior', 'Cabinets', 'Deck, fence or railing',
          'Pressure washing', 'Trim and doors only', 'Outbuilding or shop',
        ],
      },
      {
        id: 'timing',
        label: 'How soon?',
        type: 'single',
        required: true,
        options: ['As soon as you can', 'Next few months', 'Planning ahead'],
      },
      {
        id: 'access',
        label: 'Anything else we should know?',
        type: 'text',
        required: false,
        hint: 'Colors you have in mind, dogs, gate codes, parking, stories, or anything the photos do not show.',
      },
    ],

    photoPrompts: [
      { label: 'The whole thing', hint: 'Stand back far enough to get the full wall, room or house in one frame.' },
      { label: 'The worst spot', hint: 'Close up on the peeling, damage or repair — the part that worries you.' },
      { label: 'A second angle', hint: 'The other side, or a corner shot that shows the trim and the eaves.' },
    ],
  },

  'coastal-appliance': {
    slug: 'coastal-appliance',
    name: 'Coastal Appliance Repair',
    legalName: 'Coastal Appliance Repair LLC',
    trade: 'appliance-repair',
    city: 'Coos Bay, Oregon',
    phone: '+15412948228',
    notifyEmail: ['leads@coastal-appliance.example'],
    sms: null,
    siteUrl: 'https://www.coastalappliancerepairllc.com',
    allowedOrigins: [
      'https://coastalappliancerepairllc.com',
      'https://www.coastalappliancerepairllc.com',
    ],
    // The widget mounts inside their .form-card, which is a light panel with a
    // 2px ink border. Values below are copied out of their :root rather than
    // approximated.
    brand: {
      color: '#136080',        // --accent
      text: '#F3FAFC',         // --accent-ink
      surface: 'light',        // their site is light, unlike England Brothers
      light: {
        bg: '#F5F7F8',
        panel: '#E7EDF0',
        line: '#14263A',       // the ink border their .form-card uses
        lineSoft: '#D2DBE0',
        head: '#14263A',
        body: '#51606E',
        dim: '#51606E',
      },
      radius: '2px',
      font: "'Sora',system-ui,sans-serif",
      headFont: "'Anton','Arial Narrow',sans-serif",
      headUppercase: true,
    },
    intro: 'Photograph the model plate and we can bring the part on the first trip.',
    ...PRESETS['appliance-repair'],
  },

  'hne-cleaning': {
    slug: 'hne-cleaning',
    name: 'H&E Cleaning Co',
    legalName: 'H&E Cleaning Co LLC',
    trade: 'cleaning',
    city: 'Coos Bay, Oregon',
    phone: '',
    notifyEmail: [],
    sms: null,
    siteUrl: 'https://hnecleaningco.com',
    allowedOrigins: [
      'https://hnecleaningco.com',
      'https://www.hnecleaningco.com',
    ],
    brand: { color: '#2E6E4F', text: '#FFFFFF' },
    intro: 'Show us the space and we will send a real bid, not a range.',
    ...PRESETS.cleaning,
  },

  // Andrew Remodel and Construction — Starter site, built 2026-09-07.
  // Clean and light: Schibsted Grotesk display, Hanken Grotesk body, black and
  // white with Rams royal and Sol as small accents only. The widget mounts in .rcd-quote, a white card with
  // a 1px --line border. Values are copied from their css/style.css :root.
  'andrew-remodel': {
    slug: 'andrew-remodel',
    name: 'Andrew Remodel and Construction',
    legalName: 'Andrew Remodel and Construction LLC',
    trade: 'roofing',
    city: 'Coos Bay, Oregon',
    phone: '+15415515494',
    notifyEmail: ['leads@andrew-remodel.example'],
    sms: null,
    siteUrl: 'https://andrewremodel.com',
    allowedOrigins: [
      'https://andrewremodel.com',
      'https://www.andrewremodel.com',
      'https://andrew-remodel.vercel.app',
    ],
    brand: {
      color: '#111111',        // --btn, the one filled button is black
      text: '#FFFFFF',
      accent: '#003594',       // --label, Rams royal for small ink
      surface: 'light',
      light: {
        bg: '#FFFFFF',         // --panel, the .rcd-quote card
        panel: '#F3F3F3',      // --paper-2, inputs
        line: '#E1E1E1',       // --line
        lineSoft: '#E1E1E1',
        head: '#111111',       // --ink
        body: '#5A5A5A',       // --ink-soft
        dim: '#5A5A5A',
      },
      radius: '6px',
      btnRing: '#FFA300',      // --accent, the gold ring every site button carries
      btnRingWidth: '3px',     // --ring on the site
      btnHover: '#FFA300',     // site rule: a button fills with its ring colour on hover
      btnHoverText: '#111111',
      font: "'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif",
      headFont: "'Schibsted Grotesk','Helvetica Neue',Arial,sans-serif",
      headUppercase: false,
    },
    // Zachery measures every job in person before pricing it. The photos earn
    // their place by telling him what he is walking into (stories, material,
    // whether it is a repair or a tear-off, which room) so the visit is the
    // last step, not the first phone call. Never promise a number from photos.
    // Photos are optional: a homeowner who cannot get a good shot still gets
    // the call, and the measure covers the rest.
    //
    // Roofing is the lead service but the form takes the whole catalogue
    // (siding, windows, decks, kitchens, baths, drywall, flooring), so the
    // roofing preset's questions are NOT used: "what is on the roof now?" as a
    // required field makes no sense for a bathroom. The material question is
    // optional with an opt-out, and the photo prompts read both ways.
    photosRequired: false,
    heading: 'Request a free estimate',
    intro: 'Every estimate begins with an in-person measurement. A few photos of the roof, siding or room let us arrive prepared, and we will call within one business day to schedule the visit.',
    doneNote: 'Thank you. Andrew Remodel and Construction has received your {photos} and details, and will call within one business day to schedule the measurement. For an active leak, call (541) 551-5494.',
    jobTypes: [
      'Roof replacement',
      'Roof leak or repair',
      'Storm damage',
      'Siding',
      'Windows and doors',
      'Deck',
      'Kitchen or bathroom remodel',
      'Drywall or flooring',
      'Something else',
    ],
    questions: [
      { id: 'describe', label: 'Describe the project', type: 'text', required: true, hint: 'A sentence or two. For roofing: leak, damage, or age. For a remodel: the room and the scope you have in mind.' },
      { id: 'weather', label: 'Is there an active leak or exposure to weather?', type: 'single', required: true, options: ['Yes, active leak', 'Only during heavy rain', 'No, planning ahead'] },
      { id: 'stories', label: 'How many stories is the home?', type: 'single', required: true, options: ['One', 'Two', 'Three or more', 'Split level'] },
      { id: 'roof_material', label: 'What is on the roof now?', type: 'single', required: false,
        showIf: { jobType: ['Roof replacement', 'Roof leak or repair', 'Storm damage'] },
        options: ['Architectural or dimensional shingle', '3-tab shingle', 'Metal', 'Cedar shake', 'Flat or torch-down', 'Tile', 'Not sure'] },
      { id: 'siding_material', label: 'What siding is on the house now?', type: 'single', required: false,
        showIf: { jobType: ['Siding', 'Storm damage'] },
        options: ['Vinyl', 'Wood or cedar lap', 'Cedar shake or shingle', 'T1-11 or plywood', 'Fiber cement', 'Board and batten', 'Stucco', 'Metal', 'Brick or masonry', 'Not sure'] },
      Q_TIMING,
      Q_ACCESS,
    ],
    photoPrompts: [
      { label: 'Wide view', hint: 'Roofing or siding: the home from the street, showing the full roof line. Remodel: the room from the doorway.' },
      { label: 'Area of concern', hint: 'The leak, damaged shingles or storm damage, or the wall, floor or fixture to be replaced. Please photograph from the ground.' },
      { label: 'Interior damage, if any', hint: 'Ceiling staining, wet insulation, soft flooring, or the attic if it can be reached safely.' },
    ],
  },

  // Sandbox tenant. Wide-open origins so you can demo it from anywhere,
  // and leads go to you, not a client. Do not delete — the demo on
  // rootedcoastdesign.com/quote.html points at it.
  demo: {
    slug: 'demo',
    name: 'Demo Contractor',
    legalName: 'Rooted Coast Design',
    trade: 'general',
    city: 'Bandon, Oregon',
    phone: '',
    notifyEmail: ['hello@rootedcoastdesign.com'],
    sms: null,
    siteUrl: 'https://www.rootedcoastdesign.com',
    allowedOrigins: ['*'],
    brand: { color: '#00617A', text: '#FFFFFF' },
    intro: 'This is a live demo. Real photos, real email — it just comes to Rooted Coast Design instead of a contractor.',
    ...PRESETS.general,
  },
};

// ── Accessors ────────────────────────────────────────────────────────────────

function getTenant(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return TENANTS[slug.toLowerCase().trim()] || null;
}

// The subset the browser is allowed to see. Never ship notifyEmail or
// allowedOrigins to the client — no reason to hand a scraper the inbox.
function publicConfig(t) {
  if (!t) return null;
  return {
    slug: t.slug,
    name: t.name,
    trade: t.trade,
    city: t.city,
    intro: t.intro,
    heading: t.heading || null,
    doneNote: t.doneNote || null,
    photosRequired: t.photosRequired !== false,   // default: required
    brand: t.brand,
    jobTypes: t.jobTypes,
    questions: t.questions,
    photoPrompts: t.photoPrompts,
  };
}

function originAllowed(t, origin) {
  if (!t) return false;
  const list = t.allowedOrigins || [];
  if (list.includes('*')) return true;
  if (!origin) return false;
  return list.includes(String(origin).replace(/\/$/, ''));
}

module.exports = { TENANTS, PRESETS, getTenant, publicConfig, originAllowed };
