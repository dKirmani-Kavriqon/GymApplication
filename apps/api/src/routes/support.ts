import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  supportInfoSchema,
  ticketMessageSchema,
  ticketSchema,
  ticketStatusSchema,
  type SupportInfo,
  type SupportTicket,
  type TicketMessage,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { notFound } from '../errors';
import type { Ctx, GymAccess } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { notify } from '../domain/notifications';

const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;

function mapSupportInfo(r: Row | undefined): SupportInfo {
  return {
    phone: (r?.phone as string) ?? null,
    whatsapp: (r?.whatsapp as string) ?? null,
    email: (r?.email as string) ?? null,
    address: (r?.address as string) ?? null,
    hours: (r?.hours as string) ?? null,
    faqs: store.parseJson<SupportInfo['faqs']>(r?.faqs, []),
  };
}

function mapTicket(db: Db, r: Row): SupportTicket {
  const messages = (
    db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? AND gym_id = ? ORDER BY created_at, rowid').all(r.id as string, r.gym_id as string) as Row[]
  ).map(
    (m): TicketMessage => ({
      id: m.id as string,
      from: m.from_role as TicketMessage['from'],
      author: store.personRef(db, m.author_id as string),
      body: m.body as string,
      at: m.created_at as string,
    }),
  );
  return {
    id: r.id as string,
    subject: r.subject as string,
    status: r.status as SupportTicket['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    member: store.personRef(db, r.user_id as string),
    messages,
  };
}

/** The ticket owner and staff may see a ticket; anyone else gets 404. */
function getTicketRow(db: Db, access: GymAccess, id: string): Row {
  const r = db.prepare('SELECT * FROM support_tickets WHERE id = ? AND gym_id = ?').get(id, access.gym.id) as Row | undefined;
  if (!r || (r.user_id !== access.userId && !store.isStaff(access.role))) throw notFound('Ticket not found');
  return r;
}

export function registerSupportRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.get('/gyms/:gymId/support', async (req) => {
    const { gym } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'support');
    return mapSupportInfo(db.prepare('SELECT * FROM support_info WHERE gym_id = ?').get(gym.id) as Row | undefined);
  });

  app.put('/gyms/:gymId/support', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'support');
    const s = supportInfoSchema.parse(req.body);
    db.prepare(
      `INSERT INTO support_info (gym_id, phone, whatsapp, email, address, hours, faqs, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (gym_id) DO UPDATE SET phone = excluded.phone, whatsapp = excluded.whatsapp, email = excluded.email,
         address = excluded.address, hours = excluded.hours, faqs = excluded.faqs, updated_at = excluded.updated_at`,
    ).run(gym.id, s.phone ?? null, s.whatsapp ?? null, s.email ?? null, s.address ?? null, s.hours ?? null, JSON.stringify(s.faqs), now().toISOString());
    store.audit(db, gym.id, userId, 'support.update', null, now());
    return mapSupportInfo(db.prepare('SELECT * FROM support_info WHERE gym_id = ?').get(gym.id) as Row);
  });

  app.get('/gyms/:gymId/support/tickets', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'support');
    const { status } = z.object({ status: z.enum(TICKET_STATUSES).optional() }).parse(req.query);
    const staff = store.isStaff(role);
    const params: string[] = [gym.id];
    if (!staff) params.push(userId);
    if (status) params.push(status);
    const rows = db
      .prepare(
        `SELECT * FROM support_tickets WHERE gym_id = ? ${staff ? '' : 'AND user_id = ?'} ${status ? 'AND status = ?' : ''}
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(...params) as Row[];
    return { tickets: rows.map((r) => mapTicket(db, r)) };
  });

  app.post('/gyms/:gymId/support/tickets', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'support');
    const t = ticketSchema.parse(req.body);
    const id = randomUUID();
    const ts = now().toISOString();
    tx(db, () => {
      db.prepare("INSERT INTO support_tickets (id, gym_id, user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)").run(
        id,
        gym.id,
        userId,
        t.subject,
        ts,
        ts,
      );
      db.prepare("INSERT INTO ticket_messages (id, gym_id, ticket_id, author_id, from_role, body, created_at) VALUES (?, ?, ?, ?, 'member', ?, ?)").run(
        randomUUID(),
        gym.id,
        id,
        userId,
        t.message,
        ts,
      );
    });
    return reply.status(201).send(mapTicket(db, db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as Row));
  });

  app.get('/gyms/:gymId/support/tickets/:ticketId', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'support');
    const { ticketId } = req.params as { ticketId: string };
    return mapTicket(db, getTicketRow(db, access, ticketId));
  });

  app.post('/gyms/:gymId/support/tickets/:ticketId/messages', async (req) => {
    const access = ctx.gymAccess(req);
    const { gym, userId } = access;
    ctx.featureGuard(gym, 'support');
    const { ticketId } = req.params as { ticketId: string };
    const ticket = getTicketRow(db, access, ticketId);
    const { body } = ticketMessageSchema.parse(req.body);
    // The ticket owner always writes as the member (even a staff member asking their own gym for help).
    const fromStaff = ticket.user_id !== userId;
    const ts = now().toISOString();
    tx(db, () => {
      db.prepare('INSERT INTO ticket_messages (id, gym_id, ticket_id, author_id, from_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        gym.id,
        ticketId,
        userId,
        fromStaff ? 'staff' : 'member',
        body,
        ts,
      );
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ? AND gym_id = ?').run(
        fromStaff ? 'answered' : 'open',
        ts,
        ticketId,
        gym.id,
      );
      if (fromStaff) {
        notify(
          db,
          gym.id,
          ticket.user_id as string,
          {
            kind: 'support_reply',
            title: `Reply: ${ticket.subject as string}`,
            body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
            link: `ticket:${ticketId}`,
          },
          now(),
        );
      }
    });
    return mapTicket(db, getTicketRow(db, access, ticketId));
  });

  app.patch('/gyms/:gymId/support/tickets/:ticketId', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'support');
    const { ticketId } = req.params as { ticketId: string };
    getTicketRow(db, access, ticketId);
    const { status } = ticketStatusSchema.parse(req.body);
    db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ? AND gym_id = ?').run(
      status,
      now().toISOString(),
      ticketId,
      access.gym.id,
    );
    return mapTicket(db, getTicketRow(db, access, ticketId));
  });
}
