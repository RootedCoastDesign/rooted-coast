// The site's own quote form endpoint. The work is in lib/quote/core.js.
//   POST /api/quote   saves the request and emails it to hello@, with a confirmation to the visitor
//   GET  /api/quote?id=...&sig=...   the private page the email links to
// Needs BLOB_READ_WRITE_TOKEN and RESEND_API_KEY in Vercel (both already used by the photo-quote tool).
'use strict';
module.exports = require('../lib/quote/core');
