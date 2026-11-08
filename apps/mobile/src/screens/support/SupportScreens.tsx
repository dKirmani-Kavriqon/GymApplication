import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { ticketMessageSchema, ticketSchema, type SupportTicket } from '@gymverse/shared';
import { Button, Card, Divider, EmptyState, ErrorText, Field, IconTile, ListRow, Pill, Screen, Txt } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { tapFeedback } from '../../utils/feedback';
import { useLoad } from '../../utils/useLoad';
import { Gate, emit, timeAgo, useBus, useGymApi } from '../train/common';
import type { ScreenProps } from '../../navigation/featureRoutes';

const STATUS: Record<SupportTicket['status'], { label: string; tone: 'warning' | 'success' | 'muted' }> = {
  open: { label: 'Waiting for the gym', tone: 'warning' },
  answered: { label: 'Gym replied', tone: 'success' },
  closed: { label: 'Resolved', tone: 'muted' },
};

export function StatusPill({ status }: { status: SupportTicket['status'] }) {
  return <Pill label={STATUS[status].label} tone={STATUS[status].tone} testID={`status-${status}`} />;
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');

// ---------- Support home ----------

export function SupportScreen() {
  const nav = useNav();
  const t = useTheme();
  const { api, gymId, gym } = useGymApi();
  const info = useLoad(() => api.supportInfo(gymId), gymId);
  const tickets = useLoad(() => api.tickets(gymId), gymId);
  useBus('tickets:changed', () => void tickets.reload());
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function open(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Could not open that app on this phone.');
    }
  }

  return (
    <Screen
      title="Help & support"
      onBack={nav.pop}
      refreshing={(info.loading && !!info.data) || (tickets.loading && !!tickets.data)}
      onRefresh={() => {
        void info.reload();
        void tickets.reload();
      }}
      footer={<Button label="Message the gym" icon="message-square" onPress={() => nav.push('NewTicket')} testID="message-gym" />}
    >
      <Gate loading={info.loading} error={info.error} ready={!!info.data} onRetry={info.reload}>
        {() => {
          const s = info.data!;
          const contacts: Array<{ icon: IconName; label: string; url: string }> = [];
          if (s.phone) contacts.push({ icon: 'phone', label: 'Call', url: `tel:${s.phone.replace(/[^0-9+]/g, '')}` });
          if (s.whatsapp) contacts.push({ icon: 'message-circle', label: 'WhatsApp', url: `https://wa.me/${digits(s.whatsapp)}` });
          if (s.email) contacts.push({ icon: 'mail', label: 'Email', url: `mailto:${s.email}` });
          return (
            <>
              <Card variant="tint" style={{ gap: 14 }} testID="contact-card">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconTile icon="life-buoy" tone="primary" />
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3" color="heading">
                      Talk to {gym.name}
                    </Txt>
                    <Txt variant="small" color="textMuted">
                      We are happy to help.
                    </Txt>
                  </View>
                </View>
                {contacts.length ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {contacts.map((c) => (
                      <Pressable
                        key={c.label}
                        accessibilityRole="button"
                        accessibilityLabel={c.label}
                        onPress={() => {
                          tapFeedback();
                          void open(c.url);
                        }}
                        style={({ pressed }) => ({ flex: 1, minHeight: 72, borderRadius: t.radius.md, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', gap: 6, transform: [{ scale: pressed ? 0.96 : 1 }] })}
                      >
                        <Icon name={c.icon} size={22} color={t.primaryText} />
                        <Txt variant="smallStrong">{c.label}</Txt>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {s.hours ? (
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Icon name="clock" size={18} color={t.primaryText} />
                    <Txt style={{ flex: 1 }}>{s.hours}</Txt>
                  </View>
                ) : null}
                {s.address ? (
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Icon name="map-pin" size={18} color={t.primaryText} />
                    <Txt style={{ flex: 1 }}>{s.address}</Txt>
                  </View>
                ) : null}
                <ErrorText message={linkError} />
              </Card>

              {s.faqs.length ? (
                <View style={{ gap: 8 }}>
                  <Txt variant="h3" color="heading" accessibilityRole="header">
                    Common questions
                  </Txt>
                  <Card style={{ paddingVertical: 4, gap: 0 }}>
                    {s.faqs.map((f, i) => {
                      const on = openFaq === i;
                      return (
                        <View key={i}>
                          {i > 0 ? <Divider /> : null}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ expanded: on }}
                            accessibilityLabel={f.q}
                            onPress={() => {
                              tapFeedback();
                              setOpenFaq(on ? null : i);
                            }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10 }}
                          >
                            <Txt variant="bodyStrong" style={{ flex: 1 }}>
                              {f.q}
                            </Txt>
                            <Icon name={on ? 'chevron-up' : 'chevron-down'} size={20} color={t.textMuted} />
                          </Pressable>
                          {on ? (
                            <Txt color="textMuted" style={{ paddingBottom: 12 }}>
                              {f.a}
                            </Txt>
                          ) : null}
                        </View>
                      );
                    })}
                  </Card>
                </View>
              ) : null}
            </>
          );
        }}
      </Gate>

      <Txt variant="h3" color="heading" accessibilityRole="header">
        Your conversations
      </Txt>
      <Gate loading={tickets.loading} error={tickets.error} ready={!!tickets.data} onRetry={tickets.reload}>
        {() =>
          tickets.data!.tickets.length === 0 ? (
            <EmptyState icon="message-square" title="No messages yet" body="Ask the gym anything. Replies show up here." />
          ) : (
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {tickets.data!.tickets.map((tk, i) => (
                <View key={tk.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    testID={`ticket-${tk.id}`}
                    icon="message-square"
                    title={tk.subject}
                    subtitle={`Last update: ${timeAgo(tk.updatedAt)}`}
                    onPress={() => nav.push('Ticket', { id: tk.id })}
                    right={<StatusPill status={tk.status} />}
                  />
                </View>
              ))}
            </Card>
          )
        }
      </Gate>
    </Screen>
  );
}

// ---------- Ticket ----------

export function TicketScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const t = useTheme();
  const toast = useToast();
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload, setData } = useLoad(() => api.ticket(gymId, id), `${gymId}|${id}`);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function send() {
    const parsed = ticketMessageSchema.safeParse({ body: reply });
    if (!parsed.success) {
      setActionError(reply.trim() ? 'Messages can be up to 2000 characters.' : 'Write a message first.');
      return;
    }
    setSending(true);
    setActionError(null);
    try {
      const next = await api.replyTicket(gymId, id, parsed.data.body);
      setData(next);
      setReply('');
      emit('tickets:changed');
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function resolve() {
    setResolving(true);
    setActionError(null);
    try {
      const next = await api.setTicketStatus(gymId, id, 'closed');
      setData(next);
      emit('tickets:changed');
      toast.show({ title: 'Marked as resolved', body: 'Reply any time to reopen it.' });
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  return (
    <Screen title={data?.subject ?? 'Conversation'} onBack={nav.pop}>
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const tk = data!;
          return (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <StatusPill status={tk.status} />
                <Txt variant="small" color="textMuted">
                  Started {timeAgo(tk.createdAt)}
                </Txt>
              </View>
              <View style={{ gap: 10 }} testID="messages">
                {tk.messages.map((m) => {
                  const mine = m.from === 'member';
                  return (
                    <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }} testID={`message-${m.id}`}>
                      <View
                        accessibilityLabel={`${mine ? 'You' : m.author.name ?? 'Gym'}: ${m.body}`}
                        style={{
                          maxWidth: '85%',
                          backgroundColor: mine ? t.primary : t.surface,
                          borderRadius: t.radius.lg,
                          borderBottomRightRadius: mine ? 6 : t.radius.lg,
                          borderBottomLeftRadius: mine ? t.radius.lg : 6,
                          borderWidth: mine ? 0 : 1,
                          borderColor: t.border,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          gap: 2,
                        }}
                      >
                        {!mine ? (
                          <Txt variant="smallStrong" color="primaryText">
                            {m.author.name ?? 'Gym'}
                          </Txt>
                        ) : null}
                        <Txt color={mine ? 'onPrimary' : 'text'}>{m.body}</Txt>
                      </View>
                      <Txt variant="small" color="textMuted" style={{ marginTop: 2, marginHorizontal: 6 }}>
                        {timeAgo(m.at)}
                      </Txt>
                    </View>
                  );
                })}
              </View>

              <Card style={{ gap: 10 }}>
                {tk.status === 'closed' ? (
                  <Txt variant="small" color="textMuted">
                    This conversation is resolved. Send a message to reopen it.
                  </Txt>
                ) : null}
                <Field label="Your message" value={reply} onChangeText={setReply} placeholder="Type your message" multiline maxLength={2000} />
                <ErrorText message={actionError} />
                <Button label="Send" icon="send" onPress={send} loading={sending} testID="send-reply" />
                {tk.status !== 'closed' ? <Button label="Mark as resolved" icon="check-circle" variant="ghost" size="md" onPress={resolve} loading={resolving} testID="resolve" /> : null}
              </Card>
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

// ---------- New ticket ----------

export function NewTicketScreen() {
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<{ subject?: string; message?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = ticketSchema.safeParse({ subject, message });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'subject') next.subject = subject.trim() ? 'Use 2 to 120 characters.' : 'Add a short subject.';
        if (issue.path[0] === 'message') next.message = message.trim() ? 'Messages can be up to 2000 characters.' : 'Write your message.';
      }
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const tk = await api.createTicket(gymId, parsed.data.subject, parsed.data.message);
      emit('tickets:changed');
      toast.show({ title: 'Message sent', body: 'The gym will reply here.' });
      nav.pop();
      nav.push('Ticket', { id: tk.id });
    } catch (err) {
      setErrors({ form: (err as Error).message });
      setBusy(false);
    }
  }

  return (
    <Screen title="Message the gym" onBack={nav.pop} footer={<Button label="Send message" icon="send" onPress={submit} loading={busy} testID="send-ticket" />}>
      <Txt color="textMuted">Questions about your plan, lockers, classes or anything else. The team usually replies within a day.</Txt>
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Locker key lost" maxLength={120} error={errors.subject} />
      <Field label="Message" value={message} onChangeText={setMessage} placeholder="Tell us what you need" multiline maxLength={2000} error={errors.message} />
      <ErrorText message={errors.form} />
    </Screen>
  );
}
