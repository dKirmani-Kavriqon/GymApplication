import { useEffect, useState, type FormEvent } from 'react';
import { supportInfoSchema, ticketMessageSchema, type Gym, type Role, type SupportInfo, type SupportTicket } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDateTime } from '../lib/format';
import { isAdmin } from '../lib/roles';
import { emptyToNull, validate } from '../lib/validate';
import { Icon } from '../components/Icon';
import { Chip, Empty, ErrorBanner, IconButton, Loading, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

type Status = SupportTicket['status'];
const STATUS_LABEL: Record<Status, string> = { open: 'Open', answered: 'Answered', closed: 'Closed' };
const STATUS_TONE = { open: 'warning', answered: 'success', closed: 'muted' } as const;

// ---------- inbox ----------

function Thread({
  gym,
  ticketId,
  canClose,
  onChanged,
}: {
  gym: Gym;
  ticketId: string;
  canClose: boolean;
  onChanged: (t: SupportTicket) => void;
}) {
  const { data: ticket, error, loading, setData } = useApiData<SupportTicket>(`/gyms/${gym.id}/support/tickets/${ticketId}`);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();

  function apply(t: SupportTicket) {
    setData(t);
    onChanged(t);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(ticketMessageSchema, { body: reply });
    if (!parsed.ok) {
      setActionError('Write a reply first.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      apply(await api.post<SupportTicket>(`/gyms/${gym.id}/support/tickets/${ticketId}/messages`, parsed.data));
      setReply('');
      toast('Reply sent');
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: Status) {
    setBusy(true);
    setActionError(null);
    try {
      apply(await api.patch<SupportTicket>(`/gyms/${gym.id}/support/tickets/${ticketId}`, { status }));
      toast(status === 'closed' ? 'Ticket closed' : 'Ticket reopened');
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !ticket) return <Loading />;
  if (error || !ticket) return <ErrorBanner message={error ?? 'Ticket not found.'} />;

  return (
    <section className="thread stack" aria-label={`Ticket: ${ticket.subject}`}>
      <div className="section-head">
        <div>
          <h2>{ticket.subject}</h2>
          <span className="muted small">
            {ticket.member.name ?? 'Member'} · opened {formatDateTime(ticket.createdAt, gym.timezone)}
          </span>
        </div>
        <div className="card-actions">
          <Chip tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Chip>
          {canClose &&
            (ticket.status === 'closed' ? (
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setStatus('open')} disabled={busy}>
                Reopen
              </button>
            ) : (
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setStatus('closed')} disabled={busy}>
                <Icon name="check" size={16} /> Close ticket
              </button>
            ))}
        </div>
      </div>
      <ol className="messages">
        {ticket.messages.map((m) => (
          <li key={m.id} className={`message message-${m.from}`} data-testid="ticket-message">
            <div className="message-meta">
              <strong>{m.from === 'staff' ? `${m.author.name ?? 'Staff'} (staff)` : (m.author.name ?? 'Member')}</strong>
              <span>{formatDateTime(m.at, gym.timezone)}</span>
            </div>
            <p className="pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {ticket.status !== 'closed' || canClose ? (
        <form className="reply-box" onSubmit={send} noValidate aria-label="Reply to ticket">
          <label className="field">
            <span>Reply</span>
            <textarea rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Hi! Thanks for reaching out…" />
          </label>
          <ErrorBanner message={actionError} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send reply'} <Icon name="send" size={16} />
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small">This ticket is closed.</p>
      )}
    </section>
  );
}

function Inbox({ gym, canClose }: { gym: Gym; canClose: boolean }) {
  const [status, setStatus] = useState<Status | 'all'>('open');
  const path = `/gyms/${gym.id}/support/tickets${status === 'all' ? '' : `?status=${status}`}`;
  const { data, error, loading, setData } = useApiData<{ tickets: SupportTicket[] }>(path);
  const [openId, setOpenId] = useState<string | null>(null);
  const tickets = data?.tickets ?? [];

  useEffect(() => setOpenId(null), [status]);

  return (
    <div className="stack">
      <Tabs
        label="Ticket status"
        sub
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'open', label: 'Open' },
          { id: 'answered', label: 'Answered' },
          { id: 'closed', label: 'Closed' },
          { id: 'all', label: 'All' },
        ]}
      />
      <ErrorBanner message={error} />
      <div className="inbox">
        <section className="card inbox-list" aria-label="Tickets">
          {loading && !data ? (
            <Loading />
          ) : tickets.length === 0 ? (
            <Empty icon="lifebuoy">No {status === 'all' ? '' : `${STATUS_LABEL[status].toLowerCase()} `}tickets.</Empty>
          ) : (
            <ul className="plain-list">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`ticket-item${openId === t.id ? ' is-active' : ''}`}
                    aria-current={openId === t.id ? 'true' : undefined}
                    onClick={() => setOpenId(t.id)}
                    data-testid="ticket"
                  >
                    <span className="ticket-top">
                      <strong>{t.subject}</strong>
                      <Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip>
                    </span>
                    <span className="muted small">
                      {t.member.name ?? 'Member'} · {formatDateTime(t.updatedAt, gym.timezone)}
                    </span>
                    {t.messages.length > 0 && <span className="small clamp-1">{t.messages[t.messages.length - 1].body}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="card inbox-thread">
          {openId ? (
            <Thread
              key={openId}
              gym={gym}
              ticketId={openId}
              canClose={canClose}
              onChanged={(t) => setData((d) => d && { tickets: d.tickets.map((x) => (x.id === t.id ? t : x)) })}
            />
          ) : (
            <Empty icon="chat">Pick a ticket to read the conversation and reply.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- help info ----------

interface InfoForm {
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
  faqs: Array<{ key: number; q: string; a: string }>;
}

let faqKey = 1;

function HelpInfo({ gym }: { gym: Gym }) {
  const { data, error, loading } = useApiData<SupportInfo>(`/gyms/${gym.id}/support`);
  const [form, setForm] = useState<InfoForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (data && !form)
      setForm({
        phone: data.phone ?? '',
        whatsapp: data.whatsapp ?? '',
        email: data.email ?? '',
        address: data.address ?? '',
        hours: data.hours ?? '',
        faqs: data.faqs.map((f) => ({ key: faqKey++, ...f })),
      });
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner message={error} />;
  if (!form) return null;

  const set = (k: Exclude<keyof InfoForm, 'faqs'>) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value });
  const setFaq = (key: number, patch: Partial<{ q: string; a: string }>) =>
    setForm((f) => f && { ...f, faqs: f.faqs.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  const moveFaq = (i: number, dir: -1 | 1) =>
    setForm((f) => {
      if (!f) return f;
      const j = i + dir;
      if (j < 0 || j >= f.faqs.length) return f;
      const faqs = [...f.faqs];
      [faqs[i], faqs[j]] = [faqs[j], faqs[i]];
      return { ...f, faqs };
    });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const parsed = validate(supportInfoSchema, {
      phone: emptyToNull(form.phone),
      whatsapp: emptyToNull(form.whatsapp),
      email: emptyToNull(form.email),
      address: emptyToNull(form.address),
      hours: emptyToNull(form.hours),
      faqs: form.faqs.map(({ q, a }) => ({ q, a })),
    });
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.put<SupportInfo>(`/gyms/${gym.id}/support`, parsed.data);
      toast('Help & support info saved');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save} noValidate aria-label="Support info">
      <section className="card stack">
        <h2>Contact details</h2>
        <p className="muted small">Shown to members under Me → Help & support.</p>
        <div className="form-grid">
          <label className="field span-2">
            <span>Phone</span>
            <input type="tel" value={form.phone} onChange={set('phone')} maxLength={30} placeholder="+91 98765 43210" />
          </label>
          <label className="field span-2">
            <span>WhatsApp</span>
            <input type="tel" value={form.whatsapp} onChange={set('whatsapp')} maxLength={30} placeholder="+91 98765 43210" />
          </label>
          <label className="field span-2">
            <span>Email</span>
            <input type="email" value={form.email} onChange={set('email')} maxLength={120} placeholder="hello@yourgym.in" />
          </label>
          <label className="field span-2">
            <span>Opening hours</span>
            <input value={form.hours} onChange={set('hours')} maxLength={300} placeholder="Mon–Sat 6am–10pm, Sun 7am–12pm" />
          </label>
          <label className="field span-4">
            <span>Address</span>
            <textarea rows={2} value={form.address} onChange={set('address')} maxLength={300} />
          </label>
        </div>
      </section>
      <section className="card stack">
        <div className="section-head">
          <h2>FAQs</h2>
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={() => setForm((f) => f && { ...f, faqs: [...f.faqs, { key: faqKey++, q: '', a: '' }] })}
            disabled={form.faqs.length >= 30}
          >
            <Icon name="plus" size={16} /> Add question
          </button>
        </div>
        {form.faqs.length === 0 ? (
          <p className="muted small">No FAQs yet. Common ones: parking, lockers, freezing a membership, guest passes.</p>
        ) : (
          <ol className="faq-list">
            {form.faqs.map((f, i) => (
              <li key={f.key} className="faq-item" data-testid="faq">
                <div className="faq-fields">
                  <label className="field">
                    <span>Question {i + 1}</span>
                    <input value={f.q} onChange={(e) => setFaq(f.key, { q: e.target.value })} maxLength={200} />
                  </label>
                  <label className="field">
                    <span>Answer {i + 1}</span>
                    <textarea rows={2} value={f.a} onChange={(e) => setFaq(f.key, { a: e.target.value })} maxLength={1000} />
                  </label>
                </div>
                <span className="row-actions">
                  <IconButton icon="arrowUp" label={`Move question ${i + 1} up`} onClick={() => moveFaq(i, -1)} disabled={i === 0} />
                  <IconButton icon="arrowDown" label={`Move question ${i + 1} down`} onClick={() => moveFaq(i, 1)} disabled={i === form.faqs.length - 1} />
                  <IconButton
                    icon="trash"
                    tone="danger"
                    label={`Remove question ${i + 1}`}
                    onClick={() => setForm((cur) => cur && { ...cur, faqs: cur.faqs.filter((x) => x.key !== f.key) })}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <ErrorBanner message={formError} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save support info'}
        </button>
      </div>
    </form>
  );
}

export function Support({ gym, role }: { gym: Gym; role: Role }) {
  const admin = isAdmin(role);
  const [tab, setTab] = useState<'inbox' | 'info'>('inbox');
  return (
    <div className="stack-lg">
      <PageHeader title="Support" subtitle={admin ? 'Answer member questions and keep your help page up to date.' : 'Answer member questions.'} />
      {admin && (
        <Tabs
          label="Support"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'inbox', label: 'Inbox' },
            { id: 'info', label: 'Help info & FAQs' },
          ]}
        />
      )}
      {tab === 'info' && admin ? <HelpInfo gym={gym} /> : <Inbox gym={gym} canClose={admin} />}
    </div>
  );
}
