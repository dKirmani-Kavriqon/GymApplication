import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { formatInr, type CouponQuote, type PaymentResult, type Plan } from '@gymverse/shared';
import { Button, ErrorText, Field, IconTile, Skeleton, Sheet, Txt } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../state/session';
import { useGym } from '../state/hooks';
import { useTheme } from '../theme/ThemeContext';
import { formatDate } from '../utils/format';
import { successFeedback, tapFeedback } from '../utils/feedback';
import { useLoad } from '../utils/useLoad';

/**
 * Renew in 3 taps (PRD §7): pick plan → Pay → receipt.
 * With the dev mock gateway the payment completes immediately; in production
 * this is where Razorpay/Stripe checkout opens (UPI, cards, autopay).
 */
export function RenewSheet({ visible, onClose, onPaid }: { visible: boolean; onClose: () => void; onPaid: () => void }) {
  const { api } = useSession();
  const gym = useGym();
  const t = useTheme();
  const { data, error } = useLoad(() => (visible ? api.plans(gym.id) : Promise.resolve(null)), `${gym.id}:${visible}`);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<CouponQuote | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const plan = selected ?? data?.plans[0] ?? null;
  const applied = quote && plan && quote.plan.id === plan.id ? quote : null;

  async function applyCode() {
    if (!plan || !code.trim()) return;
    setCodeError(null);
    try {
      setQuote(await api.quoteCoupon(gym.id, code.trim(), plan.id));
    } catch (err) {
      setQuote(null);
      setCodeError((err as Error).message);
    }
  }

  async function pay() {
    if (!plan) return;
    setBusy(true);
    setPayError(null);
    try {
      const order = applied ? await api.createOrderWithCoupon(gym.id, plan.id, applied.code) : await api.createOrder(gym.id, plan.id);
      if (order.status === 'paid') {
        // A 100% coupon: nothing to charge, the membership is already extended.
        successFeedback();
        setResult({ paymentId: order.paymentId, status: 'paid', membershipEndsAt: '', receiptNumber: '' });
        onPaid();
        return;
      }
      if (order.mockSignature) {
        // Development gateway: complete instantly.
        const res = await api.verifyPayment(gym.id, order.paymentId, `pay_mock_${Date.now()}`, order.mockSignature);
        successFeedback();
        setResult(res);
        onPaid();
        return;
      }
      if (!order.checkoutUrl) throw new Error('Online payment is not set up for this gym yet. Please pay at the front desk.');
      // Production: Razorpay's hosted checkout (UPI, cards, netbanking) in an in-app browser.
      const session = await WebBrowser.openAuthSessionAsync(order.checkoutUrl, 'gymverse://payment');
      const returned = session.type === 'success' ? session.url : '';
      if (!/status=paid/.test(returned)) {
        // The webhook may still complete it; check once before giving up.
        const check = await api.payment(gym.id, order.paymentId).catch(() => null);
        if (check?.status !== 'paid') {
          throw new Error(
            /status=pending/.test(returned)
              ? "We're still confirming your payment with the bank. It will show in Me within a few minutes."
              : 'Payment was not completed. You have not been charged.',
          );
        }
      }
      const paid = await api.payment(gym.id, order.paymentId);
      successFeedback();
      setResult({ paymentId: paid.id, status: 'paid', membershipEndsAt: paid.membershipEndsAt ?? '', receiptNumber: paid.receiptNumber ?? '' });
      onPaid();
    } catch (err) {
      setPayError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setResult(null);
    setSelected(null);
    setPayError(null);
    setQuote(null);
    setCode('');
    setCodeOpen(false);
    setCodeError(null);
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={close} title={result ? undefined : 'Choose a plan'} testID="renew-sheet">
      {result ? (
        <View testID="payment-success" style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
          <IconTile icon="check" size={72} tone="primary" />
          <Txt variant="h1" color="heading">
            You're all set!
          </Txt>
          <Txt variant="body" align="center">
            {result.membershipEndsAt ? `Membership active until ${formatDate(result.membershipEndsAt)}` : 'Your membership has been extended.'}
          </Txt>
          {result.receiptNumber ? (
            <Txt variant="small" color="textMuted" align="center">
              Receipt {result.receiptNumber}
            </Txt>
          ) : null}
          <Button label="Done" onPress={close} />
        </View>
      ) : (
        <>
          {!data ? (
            error ? <ErrorText message={error} /> : <Skeleton />
          ) : data.plans.length === 0 ? (
            <Txt variant="body" color="textMuted">
              Your gym hasn't added plans to the app yet. Please ask at the front desk.
            </Txt>
          ) : (
            data.plans.map((p) => {
              const on = plan?.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${p.name}, ${formatInr(p.pricePaise)}`}
                  onPress={() => {
                    tapFeedback();
                    setSelected(p);
                  }}
                  style={{ borderRadius: t.radius.lg, padding: 16, borderWidth: 2, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.tint : t.surface, gap: 4 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Txt variant="h3" color="heading">
                      {p.name}
                    </Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Txt variant="h3" color="heading">
                        {formatInr(p.pricePaise)}
                      </Txt>
                      {on ? <Icon name="check-circle" size={20} color={t.primaryText} /> : null}
                    </View>
                  </View>
                  <Txt variant="small" color="textMuted">
                    {p.durationDays} days{p.benefits.length ? ` · ${p.benefits.join(' · ')}` : ''}
                  </Txt>
                </Pressable>
              );
            })
          )}
          {plan ? (
            codeOpen ? (
              <View style={{ gap: 8 }} testID="coupon">
                <Field label="Coupon code" autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={(v) => { setCode(v); setCodeError(null); }} onSubmitEditing={applyCode} />
                <Button label="Apply code" variant="soft" size="md" onPress={() => void applyCode()} />
                <ErrorText message={codeError} />
                {applied ? (
                  <Txt variant="bodyStrong" color="success" testID="coupon-applied">
                    {applied.code} applied: you save {formatInr(applied.discountPaise)}
                  </Txt>
                ) : null}
              </View>
            ) : (
              <Button label="Have a coupon code?" variant="ghost" size="md" icon="tag" onPress={() => setCodeOpen(true)} />
            )
          ) : null}
          <ErrorText message={payError} />
          {plan ? (
            <Button testID="pay" label={applied?.finalPaise === 0 ? 'Activate for free' : `Pay ${formatInr(applied ? applied.finalPaise : plan.pricePaise)}`} icon="credit-card" onPress={pay} loading={busy} />
          ) : null}
          <Button label="Not now" variant="ghost" onPress={close} />
        </>
      )}
    </Sheet>
  );
}
