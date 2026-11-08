import type { App, Reply } from '../http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { formatInr, type PaymentResult } from '@gymverse/shared';
import { HttpError } from '../errors';
import type { Ctx } from '../context';
import type { Row } from '../store';
import { verifyCheckoutToken } from '../checkout';
import { verifyAndComplete } from '../domain/payments';

/**
 * Hosted checkout. The member app opens `checkoutUrl` (from POST /payments/orders) in the
 * browser; this page runs Razorpay Checkout and reports back, then sends the member to
 * `gymverse://payment/<id>?status=paid|cancelled`. With the mock provider the page offers a
 * "Pay (test)" button instead, so the whole flow works in development.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** JSON that is safe inside a <script> element. */
const BACKSLASH_U = String.fromCharCode(92) + 'u';
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, `${BACKSLASH_U}003c`)
    .replace(LINE_SEPARATORS, (c) => BACKSLASH_U + c.charCodeAt(0).toString(16));

export function checkoutCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://checkout.razorpay.com`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data: https://checkout.razorpay.com https://api.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const STYLE = `
:root{--burgundy:#6B0F1A;--rose:#B54B6A;--beige:#F8F1E7;--ivory:#FAF8F5;--ink:#1F1F1F;--muted:#6B6B6B}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:var(--beige);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
.card{background:var(--ivory);border-radius:20px;box-shadow:0 8px 30px rgba(107,15,26,.12);max-width:420px;width:100%;padding:28px}
.gym{color:var(--burgundy);font-weight:700;font-size:20px;margin:0 0 4px}.plan{color:var(--muted);margin:0 0 20px}
.amount{font-size:36px;font-weight:800;color:var(--burgundy);margin:0 0 24px}.btn{display:block;width:100%;border:0;border-radius:14px;
padding:14px;font-size:17px;font-weight:700;background:var(--burgundy);color:#fff;cursor:pointer}.btn:disabled{opacity:.6}
.link{display:block;text-align:center;margin-top:16px;color:var(--rose)}.status{min-height:24px;margin-top:14px;color:var(--muted);text-align:center}
.note{font-size:13px;color:var(--muted);margin-top:18px;text-align:center}h1{color:var(--burgundy);font-size:22px;margin:0 0 8px}`;

function page(reply: Reply, status: number, title: string, body: string, script?: { config: unknown; code: string; external?: string }) {
  const nonce = randomBytes(16).toString('base64');
  const scripts = script
    ? `${script.external ? `<script nonce="${nonce}" src="${script.external}"></script>` : ''}
<script nonce="${nonce}" type="application/json" id="cfg">${scriptJson(script.config)}</script>
<script nonce="${nonce}">${script.code}</script>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head>
<body><main class="card">${body}</main>${scripts}</body></html>`;
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('content-security-policy', checkoutCsp(nonce))
    .send(html);
}

/** "₹1,500" for whole rupees, "₹1,199.20" otherwise (the shared formatInr would show "₹1,199.2"). */
const priceText = (paise: number) =>
  paise % 100 === 0 ? formatInr(paise) : formatInr(paise - (paise % 100)).replace(/$/, `.${String(paise % 100).padStart(2, '0')}`);

const returnLink = (paymentId: string, status: string) => `gymverse://payment/${encodeURIComponent(paymentId)}?status=${status}`;

function messagePage(reply: Reply, status: number, title: string, text: string, paymentId: string, appStatus: string) {
  return page(
    reply,
    status,
    title,
    `<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="link" href="${esc(returnLink(paymentId, appStatus))}">Return to the app</a>`,
  );
}

// Runs in the browser. Plain ES5, no inline handlers (CSP), config read from the JSON block.
const CLIENT = `(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);
var btn=document.getElementById('pay'),status=document.getElementById('status'),back=document.getElementById('return');
function leave(s){var url='gymverse://payment/'+encodeURIComponent(cfg.paymentId)+'?status='+s;back.href=url;back.hidden=false;window.location.href=url;}
function complete(r){status.textContent='Confirming your payment...';btn.disabled=true;
fetch(cfg.completeUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:cfg.token,
razorpay_payment_id:r.razorpay_payment_id,razorpay_order_id:r.razorpay_order_id,razorpay_signature:r.razorpay_signature})})
.then(function(res){if(!res.ok)throw new Error('not ok');status.textContent='Paid! Taking you back to the app...';leave('paid');})
.catch(function(){status.textContent='We could not confirm the payment yet. If money left your account it will show in the app shortly.';leave('pending');});}
document.getElementById('cancel').addEventListener('click',function(e){e.preventDefault();leave('cancelled');});
if(cfg.mode==='mock'){btn.addEventListener('click',function(){complete({razorpay_payment_id:'pay_test_'+Date.now(),razorpay_order_id:cfg.orderId,razorpay_signature:cfg.mockSignature});});return;}
if(typeof Razorpay==='undefined'){status.textContent='Could not load the payment window. Check your connection and try again.';return;}
var rzp=new Razorpay({key:cfg.keyId,order_id:cfg.orderId,amount:cfg.amount,currency:'INR',name:cfg.gymName,description:cfg.planName,
prefill:{contact:cfg.phone,name:cfg.name||''},theme:{color:'#6B0F1A'},handler:complete,modal:{ondismiss:function(){leave('cancelled');}}});
rzp.on('payment.failed',function(){leave('cancelled');});
btn.addEventListener('click',function(){rzp.open();});
})();`;

export function registerCheckoutRoutes(app: App, ctx: Ctx): void {
  const { db, now, payments } = ctx;

  const loadPayment = (paymentId: string, userId: string) =>
    db
      .prepare(
        `SELECT p.*, pl.name AS plan_name, g.name AS gym_name, g.suspended AS gym_suspended, u.phone, u.name AS user_name
         FROM payments p JOIN plans pl ON pl.id = p.plan_id JOIN gyms g ON g.id = p.gym_id JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.user_id = ? AND u.deleted_at IS NULL`,
      )
      .get(paymentId, userId) as Row | undefined;

  app.get('/pay/:paymentId', async (req, reply) => {
    const { paymentId } = req.params as { paymentId: string };
    const { t } = z.object({ t: z.string().max(1000).optional() }).parse(req.query);
    const token = verifyCheckoutToken(t, paymentId, ctx.secret, now());
    if (!token.ok && token.reason === 'expired') {
      return messagePage(reply, 410, 'This payment link has expired', 'Go back to the app and tap Pay again to get a fresh link.', paymentId, 'cancelled');
    }
    const pay = token.ok ? loadPayment(paymentId, token.userId) : undefined;
    if (!pay) {
      return messagePage(reply, 403, "This payment link isn't valid", 'Open the payment again from the GymVerse app.', paymentId, 'cancelled');
    }
    if (pay.gym_suspended === 1) {
      return messagePage(reply, 403, 'Payments are paused', "This gym's account is paused. Please contact the gym.", paymentId, 'cancelled');
    }
    if (pay.status === 'paid') {
      return messagePage(reply, 200, 'Already paid', 'This membership payment is complete. You can return to the app.', paymentId, 'paid');
    }
    const mode = payments.name === 'razorpay' ? 'razorpay' : 'mock';
    const amount = pay.amount_paise as number;
    return page(
      reply,
      200,
      `Pay ${pay.gym_name as string}`,
      `<p class="gym">${esc(pay.gym_name as string)}</p><p class="plan">${esc(pay.plan_name as string)} membership</p>
<p class="amount">${esc(priceText(amount))}</p>
<button class="btn" id="pay" type="button">${mode === 'mock' ? 'Pay (test)' : 'Pay with Razorpay'}</button>
<p class="status" id="status" role="status" aria-live="polite"></p>
<a class="link" id="cancel" href="${esc(returnLink(paymentId, 'cancelled'))}">Cancel and go back</a>
<a class="link" id="return" hidden href="${esc(returnLink(paymentId, 'cancelled'))}">Return to the app</a>
<p class="note">${mode === 'mock' ? 'Test mode: no money is charged.' : 'Payments are processed securely by Razorpay.'}</p>`,
      {
        external: mode === 'razorpay' ? 'https://checkout.razorpay.com/v1/checkout.js' : undefined,
        code: CLIENT,
        config: {
          mode,
          paymentId,
          token: t,
          completeUrl: `/pay/${encodeURIComponent(paymentId)}/complete`,
          keyId: payments.keyId ?? null,
          orderId: pay.provider_order_id,
          amount,
          gymName: pay.gym_name,
          planName: pay.plan_name,
          phone: pay.phone,
          name: pay.user_name,
          ...(mode === 'mock' && payments.mockSignatureFor ? { mockSignature: payments.mockSignatureFor(pay.provider_order_id as string) } : {}),
        },
      },
    );
  });

  app.post('/pay/:paymentId/complete', async (req): Promise<PaymentResult> => {
    const { paymentId } = req.params as { paymentId: string };
    const body = z
      .object({
        t: z.string().min(1).max(1000),
        razorpay_payment_id: z.string().min(1).max(100),
        razorpay_order_id: z.string().min(1).max(100),
        razorpay_signature: z.string().min(1).max(200),
      })
      .parse(req.body);
    const token = verifyCheckoutToken(body.t, paymentId, ctx.secret, now());
    if (!token.ok) {
      throw token.reason === 'expired'
        ? new HttpError(410, 'checkout_expired', 'This payment link has expired. Start again from the app.')
        : new HttpError(403, 'bad_checkout_token', "This payment link isn't valid.");
    }
    const pay = loadPayment(paymentId, token.userId);
    if (!pay) throw new HttpError(403, 'bad_checkout_token', "This payment link isn't valid.");
    if (pay.gym_suspended === 1) throw new HttpError(403, 'gym_suspended', "This gym's account is paused. Please contact the gym.");
    if (pay.provider_order_id !== body.razorpay_order_id) throw new HttpError(400, 'order_mismatch', 'That payment belongs to a different order.');
    return verifyAndComplete(db, payments, pay, body.razorpay_payment_id, body.razorpay_signature, now());
  });
}
